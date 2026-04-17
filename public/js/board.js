/* ── State ─────────────────────────────────────────────────────────── */
const slug     = location.pathname.split('/').pop();
let   allItems = [];
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
  // 1. Check auth
  const { user } = await fetch('/api/auth/me').then(r => r.json());
  if (!user) {
    const btn = $('google-signin-btn');
    btn.href = `/auth/google?returnTo=${encodeURIComponent(location.pathname)}`;
    $('login-overlay').classList.remove('hidden');
    return;
  }

  window._myUserId = user.google_id;

  // Show user in header
  const avatar = $('user-avatar');
  if (user.picture) {
    avatar.src = user.picture;
    avatar.style.display = 'block';
  }
  $('user-name-display').textContent = user.name;

  // 2. Load board
  let data;
  try {
    data = await apiFetch('GET', '');
  } catch {
    $('board-404').classList.remove('hidden');
    return;
  }

  document.title = `${data.board.title} — Retros`;
  $('board-title').textContent = data.board.title;
  allItems = data.items;

  $('board-wrap').classList.remove('hidden');
  renderAllItems(allItems);
  startAutoRefresh();
}

/* ── Auto-refresh ──────────────────────────────────────────────────── */
function startAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(async () => {
    try {
      const data = await apiFetch('GET', '');
      allItems = data.items;
      renderAllItems(allItems);
    } catch { /* silent */ }
  }, 20_000);
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
  const scrollTop = container.scrollTop;
  const newIds    = new Set(items.map(i => String(i.id)));

  container.querySelectorAll('.item-card').forEach(el => {
    if (!newIds.has(el.dataset.id)) el.remove();
  });

  items.forEach((item, idx) => {
    const existing = container.querySelector(`.item-card[data-id="${item.id}"]`);
    if (existing) {
      if (existing.dataset.hash !== itemHash(item)) {
        const newEl = htmlToNode(buildItemHtml(item));
        existing.replaceWith(newEl);
        attachItemListeners(newEl, item);
      }
    } else {
      const newEl  = htmlToNode(buildItemHtml(item));
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
  const mine       = item.user_id === window._myUserId;
  const score      = item.vote_score;
  const scoreClass = score > 0 ? 'positive' : score < 0 ? 'negative' : '';
  const upClass    = item.my_vote ===  1 ? 'active-up'   : '';
  const downClass  = item.my_vote === -1 ? 'active-down' : '';

  const avatarHtml = item.author_picture
    ? `<img src="${escHtml(item.author_picture)}" class="user-avatar" style="width:18px;height:18px;border-radius:50%;vertical-align:middle" />`
    : '';

  return `
    <div class="item-card" data-id="${item.id}" data-hash="${escHtml(itemHash(item))}">
      <div class="item-content">${escHtml(item.content)}</div>
      <div class="item-footer">
        <span class="item-author">
          ${avatarHtml}
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
  if (upvoters.length)   html += `<div class="tip-row"><span>👍</span><span class="tip-names">${escHtml(upvoters.join(', '))}</span></div>`;
  if (downvoters.length) html += `<div class="tip-row"><span>👎</span><span class="tip-names">${escHtml(downvoters.join(', '))}</span></div>`;
  return html;
}

function attachItemListeners(el, item) {
  el.querySelectorAll('.vote-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        const updated = await apiFetch('POST', `/items/${item.id}/vote`, { voteType: Number(btn.dataset.vote) });
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
  btn.addEventListener('click', () => closeAddForm(btn.closest('.add-item-form')));
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

document.querySelectorAll('.add-item-form textarea').forEach(ta => {
  ta.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      ta.closest('.add-item-form').querySelector('.submit-add').click();
    }
    if (e.key === 'Escape') closeAddForm(ta.closest('.add-item-form'));
  });
});

function closeAddForm(form) {
  const cat = form.id.replace('form-', '');
  form.classList.add('hidden');
  form.querySelector('textarea').value = '';
  document.querySelector(`.add-toggle-btn[data-category="${cat}"]`)?.classList.remove('hidden');
}

init();
