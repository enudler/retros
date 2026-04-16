/* ── State ─────────────────────────────────────────────────────────── */
const slug        = location.pathname.split('/').pop();
let   mySessionId = null;   // filled from cookie (read via endpoint)
let   myName      = null;
let   allItems    = [];
let   refreshTimer;

/* ── Helpers ───────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let toastTimer;
function toast(msg, isError = false) {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'show' + (isError ? ' toast-error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.className = '', 3000);
}

async function apiFetch(method, path, body) {
  const res = await fetch('/api/boards/' + slug + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/* ── Boot ──────────────────────────────────────────────────────────── */
async function init() {
  let data;
  try {
    data = await apiFetch('GET', '');
  } catch {
    $('board-404').classList.remove('hidden');
    return;
  }

  const { board, participant, items } = data;
  document.title = `${board.title} — Retros`;
  $('board-title').textContent = board.title;

  allItems = items;

  if (!participant) {
    showNameModal();
  } else {
    myName = participant.display_name;
    $('user-name-display').textContent = myName;
    $('board-wrap').classList.remove('hidden');
    renderAllItems(items);
    startAutoRefresh();
  }
}

/* ── Name modal ────────────────────────────────────────────────────── */
function showNameModal() {
  $('name-modal').classList.remove('hidden');
  setTimeout(() => $('display-name').focus(), 50);
}

$('name-form').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('display-name').value.trim();
  if (!name) return;
  try {
    await apiFetch('POST', '/join', { displayName: name });
    myName = name;
    $('user-name-display').textContent = name;
    $('name-modal').classList.add('hidden');
    $('board-wrap').classList.remove('hidden');
    await refresh();
    startAutoRefresh();
  } catch (err) {
    const el = $('name-error');
    el.textContent = err.message;
    el.classList.remove('hidden');
  }
});

/* Change name by clicking the pill */
$('user-pill').addEventListener('click', () => {
  $('display-name').value = myName ?? '';
  $('name-modal').classList.remove('hidden');
  $('display-name').focus();
});

/* ── Auto-refresh ──────────────────────────────────────────────────── */
function startAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(refresh, 20_000);
}

async function refresh() {
  try {
    const data = await apiFetch('GET', '');
    allItems = data.items;
    renderAllItems(allItems);
  } catch { /* silent */ }
}

/* ── Rendering ─────────────────────────────────────────────────────── */
const CATEGORIES = ['keep', 'improve', 'action'];

function renderAllItems(items) {
  CATEGORIES.forEach(cat => {
    const catItems = items.filter(i => i.category === cat);
    $(`count-${cat}`).textContent = catItems.length;
    renderColumn(cat, catItems);
  });
}

function renderColumn(cat, items) {
  const container = $(`items-${cat}`);
  // Keep scroll position
  const scrollTop = container.scrollTop;

  // Preserve open add-forms (don't wipe them)
  const existingCards = new Set(
    [...container.querySelectorAll('.item-card')].map(el => el.dataset.id)
  );
  const newIds = new Set(items.map(i => String(i.id)));

  // Remove stale cards
  container.querySelectorAll('.item-card').forEach(el => {
    if (!newIds.has(el.dataset.id)) el.remove();
  });

  // Insert / update cards
  items.forEach((item, idx) => {
    const existing = container.querySelector(`.item-card[data-id="${item.id}"]`);
    const html = buildItemHtml(item);
    if (existing) {
      // Only re-render if data changed (avoid DOM thrash)
      const newEl = htmlToNode(html);
      if (existing.dataset.hash !== itemHash(item)) {
        existing.replaceWith(newEl);
        attachItemListeners(newEl, item);
      }
    } else {
      const newEl = htmlToNode(html);
      // Insert at correct index
      const sibling = container.children[idx] ?? null;
      container.insertBefore(newEl, sibling);
      attachItemListeners(newEl, item);
    }
  });

  container.scrollTop = scrollTop;
}

function itemHash(item) {
  return `${item.vote_score}|${item.my_vote}|${item.content}|${item.author_name}|${item.upvoters.join(',')}|${item.downvoters.join(',')}`;
}

function buildItemHtml(item) {
  const isOwn    = (item.session_id != null); // server returns session_id for ALL items
  // We detect "own" by comparing session cookie is tricky from JS — server already
  // returns whether my_vote is set; for ownership we rely on DELETE returning 403.
  // Instead, we add data-own="true" only when session_id matches (can't read httpOnly cookie).
  // So we use a trick: server ALWAYS returns session_id in the items list.
  // We need to know our own session_id. We'll store it from a /me endpoint added below.
  const mine     = item.session_id === window._mySessionId;
  const score    = item.vote_score;
  const scoreClass = score > 0 ? 'positive' : score < 0 ? 'negative' : '';
  const upClass   = item.my_vote ===  1 ? 'active-up'   : '';
  const downClass = item.my_vote === -1 ? 'active-down' : '';

  return `
    <div class="item-card" data-id="${item.id}" data-hash="${escHtml(itemHash(item))}">
      <div class="item-content">${escHtml(item.content)}</div>
      <div class="item-footer">
        <span class="item-author" title="${escHtml(item.author_name)}">
          ${escHtml(item.author_name)}${mine ? ' <span style="color:var(--c-primary);font-size:.7rem">(you)</span>' : ''}
        </span>
        <div class="vote-group">
          <button class="vote-btn ${upClass}" data-vote="1" title="Upvote">👍</button>
          <div class="vote-score-wrap">
            <span class="vote-score ${scoreClass}">${score > 0 ? '+' : ''}${score}</span>
            <div class="voters-tip">${buildVotersTip(item.upvoters, item.downvoters)}</div>
          </div>
          <button class="vote-btn ${downClass}" data-vote="-1" title="Downvote">👎</button>
        </div>
        ${mine ? `<button class="delete-btn" title="Delete item">🗑</button>` : ''}
      </div>
    </div>
  `;
}

function buildVotersTip(upvoters, downvoters) {
  if (!upvoters.length && !downvoters.length) {
    return `<span class="tip-empty">No votes yet</span>`;
  }
  let html = '';
  if (upvoters.length) {
    html += `<div class="tip-row"><span>👍</span><span class="tip-names">${escHtml(upvoters.join(', '))}</span></div>`;
  }
  if (downvoters.length) {
    html += `<div class="tip-row"><span>👎</span><span class="tip-names">${escHtml(downvoters.join(', '))}</span></div>`;
  }
  return html;
}

function attachItemListeners(el, item) {
  el.querySelectorAll('.vote-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        const updated = await apiFetch('POST', `/items/${item.id}/vote`, { voteType: Number(btn.dataset.vote) });
        // patch item in allItems
        const idx = allItems.findIndex(i => i.id === item.id);
        if (idx !== -1) allItems[idx] = updated;
        renderAllItems(allItems);
      } catch (err) { toast(err.message, true); }
    });
  });

  const delBtn = el.querySelector('.delete-btn');
  if (delBtn) {
    delBtn.addEventListener('click', async () => {
      if (!confirm('Delete this item?')) return;
      try {
        await apiFetch('DELETE', `/items/${item.id}`);
        allItems = allItems.filter(i => i.id !== item.id);
        renderAllItems(allItems);
      } catch (err) { toast(err.message, true); }
    });
  }
}

function htmlToNode(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
}

/* ── Add-item forms ────────────────────────────────────────────────── */
document.querySelectorAll('.add-toggle-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const cat  = btn.dataset.category;
    const form = $(`form-${cat}`);
    btn.classList.add('hidden');
    form.classList.remove('hidden');
    form.querySelector('textarea').focus();
  });
});

document.querySelectorAll('.cancel-add').forEach(btn => {
  btn.addEventListener('click', () => {
    const form = btn.closest('.add-item-form');
    closeAddForm(form);
  });
});

document.querySelectorAll('.submit-add').forEach(btn => {
  btn.addEventListener('click', async () => {
    const cat     = btn.dataset.category;
    const form    = $(`form-${cat}`);
    const ta      = form.querySelector('textarea');
    const content = ta.value.trim();
    if (!content) { ta.focus(); return; }

    btn.disabled = true;
    try {
      const item = await apiFetch('POST', '/items', { category: cat, content });
      allItems.push(item);
      renderAllItems(allItems);
      ta.value = '';
      closeAddForm(form);
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });
});

// Allow Ctrl+Enter / Cmd+Enter to submit
document.querySelectorAll('.add-item-form textarea').forEach(ta => {
  ta.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      const form = ta.closest('.add-item-form');
      form.querySelector('.submit-add').click();
    }
    if (e.key === 'Escape') {
      closeAddForm(ta.closest('.add-item-form'));
    }
  });
});

function closeAddForm(form) {
  const cat = form.id.replace('form-', '');
  form.classList.add('hidden');
  form.querySelector('textarea').value = '';
  const btn = document.querySelector(`.add-toggle-btn[data-category="${cat}"]`);
  if (btn) btn.classList.remove('hidden');
}

/* ── Session id ────────────────────────────────────────────────────── */
// We need to know our own session id to mark own items.
// The server has it (httpOnly cookie), so we expose it via the board GET.
// We grab it from the participant object once joined.
// Easiest trick: call GET /api/boards/:slug once more after join to get it.
// Actually the session_id is in each item row. We need to know ours.
// We expose a tiny endpoint or read from the join response.
// Simpler: add ?me=1 query to board GET and return mySessionId.

// Actually — looking at the server, it returns items with session_id in the row.
// We just need to know OUR session id. Let's add a /me endpoint in boards.ts.
// For now, let's use the participant join response (display_name matches).
// We'll fetch our session from a dedicated endpoint we'll add.

async function fetchMySessionId() {
  try {
    const res = await fetch('/api/boards/' + slug + '/me');
    const data = await res.json();
    window._mySessionId = data.sessionId ?? null;
  } catch { window._mySessionId = null; }
}

fetchMySessionId().then(() => init());
