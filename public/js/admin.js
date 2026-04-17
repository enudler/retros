/* ── Helpers ───────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

function showView(name) {
  ['login', 'not-admin', 'dashboard'].forEach(v => {
    $(`view-${v}`).classList.toggle('hidden', v !== name);
  });
}

let toastTimer;
function toast(msg, isError = false) {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'show' + (isError ? ' toast-error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3000);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/* ── Init ──────────────────────────────────────────────────────────── */
async function init() {
  const { user } = await api('GET', '/api/auth/me');
  if (!user)          { showView('login');     return; }
  if (!user.is_admin) { showView('not-admin'); return; }

  // Show user info in header
  const info = $('admin-user-info');
  if (user.picture) {
    const img = document.createElement('img');
    img.src = user.picture;
    img.className = 'user-avatar';
    info.appendChild(img);
  }
  info.appendChild(Object.assign(document.createElement('span'), { textContent: user.name }));

  showView('dashboard');
  loadBoards();
}

/* ── Boards ────────────────────────────────────────────────────────── */
async function loadBoards() {
  const boards = await api('GET', '/api/admin/boards');
  renderBoards(boards);
}

function renderBoards(boards) {
  const empty = $('boards-empty');
  const table = $('boards-table');
  const tbody = $('boards-tbody');

  if (!boards.length) {
    empty.classList.remove('hidden');
    table.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  table.classList.remove('hidden');
  tbody.innerHTML = '';

  boards.forEach(b => {
    const url  = `${location.origin}/board/${b.slug}`;
    const date = new Date(b.created_at).toLocaleDateString();
    const tr   = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escHtml(b.title)}</strong></td>
      <td style="color:var(--c-muted);font-size:.82rem">${date}</td>
      <td class="link-cell"><a href="${url}" target="_blank">/board/${escHtml(b.slug)}</a></td>
      <td class="actions-cell">
        <button class="copy-btn" data-url="${url}">Copy link</button>
        <button class="btn btn-danger btn-sm delete-btn" data-id="${b.id}">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.url).then(() => toast('Link copied!'));
    });
  });

  tbody.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this board and all its items?')) return;
      await api('DELETE', `/api/admin/boards/${btn.dataset.id}`);
      toast('Board deleted');
      loadBoards();
    });
  });
}

/* ── Create board ──────────────────────────────────────────────────── */
$('create-form').addEventListener('submit', async e => {
  e.preventDefault();
  const title = $('board-title').value.trim();
  if (!title) return;
  try {
    await api('POST', '/api/admin/boards', { title });
    $('board-title').value = '';
    toast('Board created!');
    loadBoards();
  } catch (err) {
    toast(err.message, true);
  }
});

init();
