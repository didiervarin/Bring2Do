import { guess, emojiFor, normalize } from './catalog.js';

const $ = (sel) => document.querySelector(sel);
const NAMES = { flo: 'Flo', pouille: 'Pouille', both: 'Les deux' };
const POLL_MS = 5000;

const state = {
  me: null,
  vapidPublicKey: null,
  items: [],
  tasks: [],
  badge: 0,
  view: 'courses',
  filter: 'mine',
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
let mutationSeq = 0; // incrémenté à chaque modification locale
let inflight = 0;    // modifications en cours d'envoi

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* vide */ }
  if (res.status === 401 && path !== '/api/login') {
    showLogin();
    throw new Error('Non connecté');
  }
  if (!res.ok) throw new Error(data?.error || `Erreur ${res.status}`);
  return data;
}

async function mutate(method, path, body) {
  mutationSeq++;
  inflight++;
  try {
    return await api(method, path, body);
  } catch (e) {
    toast(e.message);
    throw e;
  } finally {
    inflight--;
    refresh();
  }
}

async function refresh() {
  const seq = mutationSeq;
  try {
    const s = await api('GET', '/api/state');
    if (seq !== mutationSeq || inflight) return; // une modification est en cours : on attend la suivante
    state.items = s.items;
    state.tasks = s.tasks;
    state.badge = s.badge;
    showAvatar(s.avatar);
    serverOffset = s.now - Date.now();
    render();
  } catch { /* hors ligne : on garde l'affichage */ }
}
let serverOffset = 0;
const now = () => Date.now() + serverOffset;

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer;
function toast(text, actionLabel, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(text)}</span>${actionLabel ? `<button type="button">${esc(actionLabel)}</button>` : ''}`;
  el.hidden = false;
  if (actionLabel) el.querySelector('button').onclick = () => { el.hidden = true; action(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

const pad = (n) => String(n).padStart(2, '0');
function toLocalInput(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v) {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}
function startOfDay(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
const hhmm = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

function formatDue(ms) {
  const days = Math.round((startOfDay(ms) - startOfDay(now())) / 86400e3);
  if (days === 0) return `Aujourd'hui ${hhmm(ms)}`;
  if (days === 1) return `Demain ${hhmm(ms)}`;
  if (days === -1) return `Hier ${hhmm(ms)}`;
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (new Date(ms).getFullYear() !== new Date(now()).getFullYear()) opts.year = 'numeric';
  return `${new Date(ms).toLocaleDateString('fr-FR', opts)} ${hhmm(ms)}`;
}

function parseItemInput(raw) {
  const [name, ...rest] = raw.split(',');
  return { name: name.trim().replace(/^./, (c) => c.toUpperCase()), spec: rest.join(',').trim() };
}

// ---------------------------------------------------------------------------
// Connexion
// ---------------------------------------------------------------------------
let loginUser = null;

function showLogin() {
  stopPolling();
  $('#app').hidden = true;
  $('#login').hidden = false;
  try { navigator.clearAppBadge?.(); } catch { /* ignore */ }
}

document.querySelectorAll('.who-btn').forEach((b) => b.addEventListener('click', () => {
  loginUser = b.dataset.user;
  document.querySelectorAll('.who-btn').forEach((x) => x.classList.toggle('active', x === b));
  $('#login-user').value = NAMES[loginUser];
  $('#login-submit').disabled = false;
  $('#login-pass').focus();
}));

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!loginUser) return;
  $('#login-error').textContent = '';
  $('#login-submit').disabled = true;
  try {
    await api('POST', '/api/login', { user: loginUser, password: $('#login-pass').value });
    $('#login-pass').value = '';
    await start();
  } catch (err) {
    $('#login-error').textContent = err.message;
  } finally {
    $('#login-submit').disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------
async function start() {
  let me;
  try { me = await api('GET', '/api/me'); } catch (e) {
    if ($('#app').hidden) { showLogin(); if (e.message !== 'Non connecté') $('#login-error').textContent = e.message; }
    return;
  }
  state.me = me.user;
  state.vapidPublicKey = me.vapidPublicKey;
  $('#me-name').textContent = me.name;
  $('#login').hidden = true;
  $('#app').hidden = false;
  setView(location.hash === '#taches' ? 'taches' : 'courses');
  await refresh();
  startPolling();
  syncPushSubscription();
}

let pollTimer = null;
function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS);
}
function stopPolling() { clearInterval(pollTimer); pollTimer = null; }

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.me) refresh();
});
window.addEventListener('hashchange', () => {
  if (location.hash === '#taches') setView('taches');
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
function setView(v) {
  state.view = v;
  $('#view-courses').hidden = v !== 'courses';
  $('#view-taches').hidden = v !== 'taches';
  $('#title').textContent = v === 'courses' ? 'Courses' : 'Tâches';
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === v));
  window.scrollTo({ top: 0 });
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  history.replaceState(null, '', t.dataset.view === 'taches' ? '#taches' : '#');
  setView(t.dataset.view);
}));

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------
function render() {
  renderCourses();
  renderTasks();
  const toBuy = state.items.filter((i) => i.on_list).length;
  const cc = $('#count-courses');
  cc.hidden = !toBuy; cc.textContent = toBuy;
  const ct = $('#count-taches');
  ct.hidden = !state.badge; ct.textContent = state.badge;
  updateAppBadge();
}

function updateAppBadge() {
  try {
    if (!('setAppBadge' in navigator)) return;
    if (state.badge > 0) navigator.setAppBadge(state.badge);
    else navigator.clearAppBadge();
  } catch { /* non supporté */ }
}

// --- Courses -----------------------------------------------------------------
function tileHtml(item, recent) {
  const by = !recent && item.added_by ? NAMES[item.added_by]?.[0] : '';
  return `<button type="button" class="tile${recent ? ' recent' : ''}" data-id="${item.id}">
    ${by ? `<span class="by" title="Ajouté par ${esc(NAMES[item.added_by])}">${esc(by)}</span>` : ''}
    <span class="e">${emojiFor(item)}</span>
    <span class="n">${esc(item.name)}</span>
    ${item.spec ? `<span class="s">${esc(item.spec)}</span>` : ''}
  </button>`;
}

function renderCourses() {
  const toBuy = state.items.filter((i) => i.on_list);
  let html = '';
  if (!toBuy.length) {
    html = `<p class="empty">La liste est vide 🎉</p>`;
  } else {
    // Liste unique, dans l'ordre d'ajout (le plus récent à la fin)
    const list = [...toBuy].sort((a, b) => a.updated_at - b.updated_at);
    html = `<div class="tiles">${list.map((i) => tileHtml(i, false)).join('')}</div>`;
  }
  $('#to-buy').innerHTML = html;

  const recent = state.items.filter((i) => !i.on_list)
    .sort((a, b) => (b.last_used_at || b.updated_at) - (a.last_used_at || a.updated_at))
    .slice(0, 24);
  $('#recent-wrap').hidden = !recent.length;
  $('#recent').innerHTML = recent.map((i) => tileHtml(i, true)).join('');
}

// Appui court = basculer ; appui long = modifier
function bindTiles(container) {
  let timer = null, startX = 0, startY = 0, longPressed = false, target = null;
  container.addEventListener('pointerdown', (e) => {
    target = e.target.closest('.tile');
    if (!target) return;
    longPressed = false; startX = e.clientX; startY = e.clientY;
    timer = setTimeout(() => {
      longPressed = true;
      navigator.vibrate?.(10);
      openItemSheet(target.dataset.id);
    }, 480);
  });
  const cancel = () => { clearTimeout(timer); timer = null; };
  container.addEventListener('pointermove', (e) => {
    if (timer && (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10)) cancel();
  });
  container.addEventListener('pointerup', cancel);
  container.addEventListener('pointercancel', cancel);
  container.addEventListener('contextmenu', (e) => { if (e.target.closest('.tile')) e.preventDefault(); });
  container.addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    if (longPressed) { longPressed = false; return; }
    toggleItem(tile.dataset.id, tile);
  });
}
bindTiles($('#to-buy'));
bindTiles($('#recent'));
// « Récemment utilisés » : articles masqués par défaut, un appui sur le titre les affiche ou les masque.
$('#recent-toggle').addEventListener('click', () => {
  const open = $('#recent').hidden;
  $('#recent').hidden = !open;
  $('#recent-toggle').setAttribute('aria-expanded', String(open));
});

function toggleItem(id, tileEl) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  const onList = !item.on_list;
  const prevSpec = item.spec;
  tileEl?.classList.add('leaving');
  item.on_list = onList ? 1 : 0;
  if (!onList) { item.last_used_at = now(); item.spec = ''; } else { item.added_by = state.me; item.updated_at = now(); }
  setTimeout(render, 160);
  mutate('PATCH', `/api/items/${id}`, { on_list: onList }).then(() => {
    if (!onList) {
      toast(`${item.name} retiré`, 'Annuler', () => {
        item.on_list = 1; item.spec = prevSpec; render();
        mutate('PATCH', `/api/items/${id}`, { on_list: true, spec: prevSpec });
      });
    }
  }).catch(() => {});
}

// Ajout et suggestions
const itemInput = $('#item-input');
itemInput.addEventListener('input', renderSuggestions);
itemInput.addEventListener('blur', () => setTimeout(() => { $('#suggestions').hidden = true; }, 200));
itemInput.addEventListener('focus', renderSuggestions);

function renderSuggestions() {
  const raw = itemInput.value;
  const box = $('#suggestions');
  const { name, spec } = parseItemInput(raw);
  const q = normalize(name);
  if (!q) { box.hidden = true; return; }
  const matches = state.items
    .filter((i) => normalize(i.name).includes(q))
    .sort((a, b) => (normalize(a.name).startsWith(q) ? 0 : 1) - (normalize(b.name).startsWith(q) ? 0 : 1)
      || (b.last_used_at || 0) - (a.last_used_at || 0))
    .slice(0, 6);
  const exact = matches.some((i) => normalize(i.name) === q);
  const g = guess(name);
  let html = '';
  for (const i of matches) {
    html += `<button type="button" data-id="${i.id}"><span class="e">${emojiFor(i)}</span><span>${esc(i.name)}${spec ? ` <span class="muted">(${esc(spec)})</span>` : ''}</span><span class="tag">${i.on_list ? 'déjà dans la liste' : ''}</span></button>`;
  }
  if (!exact) {
    html += `<button type="button" data-new="1"><span class="e">${g.emoji || '➕'}</span><span>Ajouter « ${esc(name)} »${spec ? ` <span class="muted">(${esc(spec)})</span>` : ''}</span></button>`;
  }
  box.innerHTML = html;
  box.hidden = false;
}

$('#suggestions').addEventListener('pointerdown', (e) => e.preventDefault()); // garde le clavier ouvert
$('#suggestions').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const { name, spec } = parseItemInput(itemInput.value);
  if (b.dataset.new) addItem(name, spec);
  else addItem(state.items.find((i) => i.id === b.dataset.id)?.name || name, spec);
});

$('#add-item').addEventListener('submit', (e) => {
  e.preventDefault();
  const { name, spec } = parseItemInput(itemInput.value);
  if (!name) return;
  const existing = state.items.find((i) => normalize(i.name) === normalize(name));
  addItem(existing ? existing.name : name, spec);
});

function addItem(name, spec) {
  if (!name) return;
  itemInput.value = '';
  $('#suggestions').hidden = true;
  const existing = state.items.find((i) => normalize(i.name) === normalize(name));
  const body = { name, spec };
  if (existing) {
    if (!existing.on_list) existing.updated_at = now();
    existing.on_list = 1; existing.spec = spec; existing.added_by = state.me;
  } else {
    state.items.push({ id: `tmp${Math.random()}`, name, spec, on_list: 1, added_by: state.me, updated_at: now() });
  }
  render();
  mutate('POST', '/api/items', body).catch(() => {});
}

// Feuille d'édition d'un article
let editingItem = null;

function openItemSheet(id) {
  const item = state.items.find((i) => i.id === id);
  if (!item || id.startsWith('tmp')) return;
  editingItem = item;
  $('#item-name').value = item.name;
  $('#item-spec').value = item.spec || '';
  $('#item-sheet').showModal();
}
$('#item-cancel').addEventListener('click', () => $('#item-sheet').close());
$('#item-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const it = editingItem;
  const body = { name: $('#item-name').value.trim(), spec: $('#item-spec').value.trim() };
  if (!body.name) return;
  Object.assign(it, body);
  $('#item-sheet').close();
  render();
  mutate('PATCH', `/api/items/${it.id}`, body).catch(() => {});
});
$('#item-delete').addEventListener('click', () => {
  const it = editingItem;
  if (!confirm(`Supprimer « ${it.name} » définitivement (aussi des articles récents) ?`)) return;
  state.items = state.items.filter((i) => i !== it);
  $('#item-sheet').close();
  render();
  mutate('DELETE', `/api/items/${it.id}`).catch(() => {});
});

// --- Tâches ------------------------------------------------------------------
document.querySelectorAll('.filter .seg').forEach((b) => b.addEventListener('click', () => {
  state.filter = b.dataset.filter;
  document.querySelectorAll('.filter .seg').forEach((x) => x.classList.toggle('active', x === b));
  renderTasks();
}));

function taskHtml(t) {
  const late = !t.done && t.due_at && t.due_at <= now();
  const parts = [];
  if (t.due_at) parts.push(`<span class="due${late ? ' late' : ''}">${late ? '⏰ ' : '🗓 '}${esc(formatDue(t.due_at))}</span>`);
  parts.push(t.private ? `<span class="chip ${t.assignee}">🔒 Privée</span>` : `<span class="chip ${t.assignee}">${esc(NAMES[t.assignee])}</span>`);
  if (t.done && t.done_by) parts.push(`<span>fait par ${esc(NAMES[t.done_by])}</span>`);
  return `<div class="task${t.done ? ' done' : ''}" data-id="${t.id}">
    <button type="button" class="check" aria-label="${t.done ? 'Marquer non faite' : 'Marquer faite'}">${t.done ? '✓' : ''}</button>
    <div class="task-body"><div class="task-title">${esc(t.title)}</div><div class="task-sub">${parts.join('')}</div></div>
  </div>`;
}

function renderTasks() {
  const n = now();
  const todayEnd = startOfDay(n) + 86400e3;
  let tasks = state.tasks;
  if (state.filter === 'mine') tasks = tasks.filter((t) => t.assignee === state.me || t.assignee === 'both');
  const open = tasks.filter((t) => !t.done);
  const groups = [
    ['En retard', open.filter((t) => t.due_at && t.due_at <= n), 'late-group'],
    ["Aujourd'hui", open.filter((t) => t.due_at && t.due_at > n && t.due_at < todayEnd), ''],
    ['À venir', open.filter((t) => t.due_at && t.due_at >= todayEnd), ''],
    ['Sans échéance', open.filter((t) => !t.due_at).sort((a, b) => b.created_at - a.created_at), ''],
  ];
  let html = '';
  for (const [label, list, cls] of groups) {
    if (!list.length) continue;
    html += `<section class="${cls}"><h2 class="section-title">${label} · ${list.length}</h2><div class="group">${list.map(taskHtml).join('')}</div></section>`;
  }
  if (!open.length) html += `<p class="empty">Rien à faire 🎉</p>`;
  $('#task-list').innerHTML = html;
}

$('#task-list').addEventListener('click', (e) => {
  const row = e.target.closest('.task');
  if (!row) return;
  const t = state.tasks.find((x) => x.id === row.dataset.id);
  if (!t) return;
  if (e.target.closest('.check')) {
    t.done = t.done ? 0 : 1;
    t.done_at = t.done ? now() : null;
    t.done_by = t.done ? state.me : null;
    if (t.done) state.badge = Math.max(0, state.badge - (t.due_at && t.due_at <= now() && (t.assignee === state.me || t.assignee === 'both') ? 1 : 0));
    render();
    const wasDone = !!t.done;
    mutate('PATCH', `/api/tasks/${t.id}`, { done: wasDone }).then(() => {
      if (wasDone) toast('Tâche faite ✓', 'Annuler', () => {
        t.done = 0; t.done_at = null; t.done_by = null; render();
        mutate('PATCH', `/api/tasks/${t.id}`, { done: false });
      });
    }).catch(() => {});
  } else if (!t.id.startsWith('tmp')) {
    openTaskSheet(t);
  }
});

// Toucher la barre « Nouvelle tâche » ouvre directement la fiche (comme +),
// dès le contact du doigt et sans donner le focus au champ (sinon il faut toucher deux fois).
$('#add-task').addEventListener('submit', (e) => { e.preventDefault(); $('#task-more').click(); });
$('#task-input').addEventListener('pointerdown', (e) => { e.preventDefault(); $('#task-more').click(); });
$('#task-input').addEventListener('focus', () => $('#task-more').click());
// + : fiche complète (date, heure, attribution…) pré-remplie avec le titre tapé dans la barre.
$('#task-more').addEventListener('click', (e) => {
  e.preventDefault();
  const title = $('#task-input').value.trim();
  $('#task-input').blur();
  if (!$('#task-sheet').open) openTaskSheet(null, title);
});

// Feuille d'une tâche
let editingTask = null;
let sheetAssignee = 'both';
function setAssignee(a) {
  sheetAssignee = a;
  document.querySelectorAll('#task-assignee button').forEach((b) => b.classList.toggle('active', b.dataset.a === a));
}
document.querySelectorAll('#task-assignee button').forEach((b) => b.addEventListener('click', () => {
  if (!$('#task-private').checked) setAssignee(b.dataset.a);
}));
// Privée : attribuée uniquement à l'auteur, les autres choix sont verrouillés.
function applyPrivate() {
  const priv = $('#task-private').checked;
  const author = editingTask ? editingTask.created_by : state.me;
  if (priv) setAssignee(author);
  document.querySelectorAll('#task-assignee button').forEach((b) => { b.disabled = priv && b.dataset.a !== author; });
}
$('#task-private').addEventListener('change', applyPrivate);

function openTaskSheet(task, title = '') {
  editingTask = task;
  $('#task-sheet-title').textContent = task ? 'Modifier la tâche' : 'Nouvelle tâche';
  $('#task-title').value = task ? task.title : title;
  $('#task-due').value = task?.due_at ? toLocalInput(task.due_at) : '';
  setAssignee(task ? task.assignee : state.me);
  $('#task-private').checked = !!task?.private;
  // Seul l'auteur peut changer ce réglage.
  $('#task-private-row').hidden = !!task && task.created_by !== state.me;
  applyPrivate();
  $('#task-delete').hidden = !task;
  $('#task-meta').textContent = task
    ? `Créée par ${NAMES[task.created_by] || '?'} le ${new Date(task.created_at).toLocaleDateString('fr-FR')}`
    : '';
  $('#task-sheet').showModal();
  if (!task) $('#task-title').focus();
}
$('#task-cancel').addEventListener('click', () => $('#task-sheet').close());
$('#task-due-clear').addEventListener('click', () => { $('#task-due').value = ''; });

$('#quick-dates').addEventListener('click', (e) => {
  const q = e.target.closest('button')?.dataset.q;
  if (!q) return;
  const d = new Date(now());
  if (q === 'tonight') { d.setHours(19, 0, 0, 0); if (d.getTime() <= now()) d.setDate(d.getDate() + 1); }
  if (q === 'tomorrow') { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
  if (q === 'weekend') { const add = (6 - d.getDay() + 7) % 7 || 7; d.setDate(d.getDate() + add); d.setHours(10, 0, 0, 0); }
  $('#task-due').value = toLocalInput(d.getTime());
});

$('#task-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const body = {
    title: $('#task-title').value.trim(),
    due_at: fromLocalInput($('#task-due').value),
    assignee: sheetAssignee,
  };
  if (!editingTask || editingTask.created_by === state.me) body.private = $('#task-private').checked ? 1 : 0;
  if (!body.title) return;
  $('#task-sheet').close();
  $('#task-input').value = '';
  if (editingTask) {
    Object.assign(editingTask, body);
    render();
    mutate('PATCH', `/api/tasks/${editingTask.id}`, body).catch(() => {});
  } else {
    state.tasks.push({ id: `tmp${Math.random()}`, ...body, done: 0, created_by: state.me, created_at: now() });
    render();
    mutate('POST', '/api/tasks', body).catch(() => {});
  }
});
$('#task-delete').addEventListener('click', () => {
  const t = editingTask;
  if (!confirm(`Supprimer « ${t.title} » ?`)) return;
  state.tasks = state.tasks.filter((x) => x !== t);
  $('#task-sheet').close();
  render();
  mutate('DELETE', `/api/tasks/${t.id}`).catch(() => {});
});

// Fermer une feuille en touchant le fond
document.querySelectorAll('dialog.sheet').forEach((d) => d.addEventListener('click', (e) => {
  if (e.target === d) d.close();
}));

// ---------------------------------------------------------------------------
// Réglages et notifications
// ---------------------------------------------------------------------------
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function urlB64ToUint8Array(b64) {
  const s = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function getRegistration() {
  if (!('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker.register('/sw.js');
}

async function updatePushStatus() {
  const status = $('#push-status');
  const enableBtn = $('#push-enable');
  const testBtn = $('#push-test');
  $('#install-help').hidden = isStandalone();
  if (!pushSupported()) {
    status.textContent = isStandalone()
      ? 'Ce navigateur ne gère pas les notifications.'
      : "Installe d'abord l'app sur l'écran d'accueil (voir ci-dessous).";
    enableBtn.hidden = true; testBtn.hidden = true;
    return;
  }
  const reg = await getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (Notification.permission === 'denied') {
    status.textContent = 'Notifications refusées. Réactive-les dans Réglages iOS → Notifications → Bring2Do.';
    enableBtn.hidden = true; testBtn.hidden = true;
  } else if (sub && Notification.permission === 'granted') {
    status.textContent = 'Activées sur cet iPhone ✓ Tu seras prévenu(e) à l’échéance de tes tâches.';
    enableBtn.hidden = true; testBtn.hidden = false;
  } else {
    status.textContent = 'Désactivées sur cet appareil.';
    enableBtn.hidden = false; testBtn.hidden = true;
  }
}

async function syncPushSubscription() {
  // Réenvoie l'abonnement existant (utile si le serveur l'a perdu).
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    const reg = await getRegistration();
    const sub = await reg.pushManager.getSubscription();
    if (sub) await api('POST', '/api/push/subscribe', sub.toJSON());
  } catch { /* ignore */ }
}

// --- Photo / logo -------------------------------------------------------------
let avatarVersion = null;
function showAvatar(v) {
  if (v === avatarVersion) return;
  avatarVersion = v;
  const url = v ? `/api/avatar?v=${v}` : '';
  $('#avatar-btn').hidden = !v;
  $('#avatar-remove').hidden = !v;
  if (v) $('#avatar-img').src = url;
  $('#avatar-preview').style.backgroundImage = v ? `url("${url}")` : '';
}
// Recadre l'image au centre en carré 256 px, en JPEG, pour rester légère.
function squareJpeg(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const src = URL.createObjectURL(file);
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 256, 256);
      ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
      URL.revokeObjectURL(src);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error('Image illisible')); };
    img.src = src;
  });
}
$('#avatar-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = await squareJpeg(file);
    const r = await api('PUT', '/api/avatar', { data });
    showAvatar(r.avatar);
    toast('Image enregistrée ✓');
  } catch (err) { toast(err.message); }
});
$('#avatar-remove').addEventListener('click', async () => {
  try { const r = await api('DELETE', '/api/avatar'); showAvatar(r.avatar); } catch (err) { toast(err.message); }
});
$('#avatar-btn').addEventListener('click', () => $('#open-settings').click());

$('#open-settings').addEventListener('click', async () => {
  $('#settings-sheet').showModal();
  updatePushStatus();
});

$('#push-enable').addEventListener('click', async () => {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { updatePushStatus(); return; }
    const reg = await getRegistration();
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(state.vapidPublicKey),
      });
    }
    await api('POST', '/api/push/subscribe', sub.toJSON());
    toast('Notifications activées ✓');
    updateAppBadge();
  } catch (e) {
    toast(`Impossible d’activer : ${e.message}`);
  }
  updatePushStatus();
});

$('#push-test').addEventListener('click', async () => {
  try {
    await api('POST', '/api/push/test');
    toast('Test envoyé. Verrouille l’iPhone pour le voir arriver.');
  } catch (e) { toast(e.message); }
});

$('#logout').addEventListener('click', async () => {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    if (sub) {
      await api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
  } catch { /* ignore */ }
  await api('POST', '/api/logout').catch(() => {});
  $('#settings-sheet').close();
  state.me = null;
  showLogin();
});

// ---------------------------------------------------------------------------
if ('serviceWorker' in navigator) getRegistration().catch(() => {});
start();

// ---------------------------------------------------------------------------
// Clavier iPhone : la page n'est plus redimensionnée par le clavier (sinon, à sa
// fermeture, iOS laisse parfois la barre et les onglets coincés au milieu de l'écran).
// On mesure la hauteur du clavier pour ne remonter la barre « J'ai besoin… » que pendant la saisie.
// ---------------------------------------------------------------------------
(function keyboardOffset() {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', `${kb > 60 ? Math.round(kb) : 0}px`);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  // Après fermeture du clavier, on remet la page d'aplomb.
  document.addEventListener('focusout', () => setTimeout(() => {
    update();
    if (!document.activeElement || document.activeElement === document.body) window.scrollTo(window.scrollX, window.scrollY);
  }, 300));
  update();
})();

// Bouton + des barres de saisie : on garde le focus du champ pendant l'appui,
// sinon la barre bouge à la fermeture du clavier et l'appui tombe à côté.
document.querySelectorAll('.add-bar .icon-btn').forEach((b) => b.addEventListener('pointerdown', (e) => {
  if (b.closest('.add-bar').querySelector('input') === document.activeElement) e.preventDefault();
}));
