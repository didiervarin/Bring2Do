import { generateVapidKeys, sendPush } from './push.js';

// ---------------------------------------------------------------------------
// Utilisateurs : les mots de passe sont des secrets Cloudflare
// (FLO_PASSWORD et POUILLE_PASSWORD), jamais stockés dans le code.
// ---------------------------------------------------------------------------
const USERS = {
  flo: { name: 'Flo', secret: 'FLO_PASSWORD' },
  pouille: { name: 'Pouille', secret: 'POUILLE_PASSWORD' },
};
const ASSIGNEES = ['flo', 'pouille', 'both'];
const SESSION_DAYS = 365;
const MAX_ATTEMPTS = 8;          // essais de mot de passe ratés…
const ATTEMPT_WINDOW = 15 * 60e3; // …par fenêtre de 15 minutes
const NOTIFY_MAX_LATE = 24 * 3600e3; // pas de notif pour une échéance passée depuis plus de 24 h

// ---------------------------------------------------------------------------
// Schéma de la base D1 : créé automatiquement au premier appel.
// ---------------------------------------------------------------------------
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS login_attempts (user TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS items (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
     spec TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'autre',
     on_list INTEGER NOT NULL DEFAULT 1, added_by TEXT,
     updated_at INTEGER NOT NULL, last_used_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS tasks (
     id TEXT PRIMARY KEY, title TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
     due_at INTEGER, assignee TEXT NOT NULL DEFAULT 'both',
     done INTEGER NOT NULL DEFAULT 0, done_at INTEGER, done_by TEXT,
     created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
     notified INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS subscriptions (
     endpoint TEXT PRIMARY KEY, user TEXT NOT NULL, p256dh TEXT NOT NULL,
     auth TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks (done, notified, due_at)`,
];

let schemaReady = null;
function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s))).catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

const err = (message, status = 400) => json({ error: message }, status);

function randomToken(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

const newId = () => randomToken(10);

export function nameKey(name) {
  return String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const clean = (v, max) => String(v ?? '').trim().slice(0, max);

async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

function formatDue(ms) {
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}

// ---------------------------------------------------------------------------
// Clés VAPID : générées une seule fois et conservées dans D1.
// ---------------------------------------------------------------------------
async function getVapid(env) {
  const row = await env.DB.prepare(`SELECT value FROM config WHERE key = 'vapid'`).first();
  if (row) return JSON.parse(row.value);
  const keys = await generateVapidKeys();
  await env.DB.prepare(`INSERT OR IGNORE INTO config (key, value) VALUES ('vapid', ?)`).bind(JSON.stringify(keys)).run();
  const again = await env.DB.prepare(`SELECT value FROM config WHERE key = 'vapid'`).first();
  return JSON.parse(again.value);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
async function currentUser(request, env) {
  const token = getCookie(request, 'sid');
  if (!token) return null;
  const row = await env.DB.prepare(`SELECT user, expires_at FROM sessions WHERE token = ?`).bind(token).first();
  if (!row || row.expires_at < Date.now()) return null;
  return row.user;
}

function sessionCookie(token, maxAge) {
  return `sid=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

async function login(request, env) {
  const body = await readJson(request);
  const user = String(body.user || '').toLowerCase();
  const password = String(body.password || '');
  if (!USERS[user]) return err('Utilisateur inconnu', 400);

  const expected = env[USERS[user].secret];
  if (!expected) return err(`Mot de passe non configuré (secret ${USERS[user].secret} manquant)`, 500);

  const now = Date.now();
  await env.DB.prepare(`DELETE FROM login_attempts WHERE at < ?`).bind(now - ATTEMPT_WINDOW).run();
  const { n } = await env.DB.prepare(`SELECT COUNT(*) AS n FROM login_attempts WHERE user = ?`).bind(user).first();
  if (n >= MAX_ATTEMPTS) return err('Trop d’essais. Réessaie dans 15 minutes.', 429);

  if (!(await safeEqual(password, expected))) {
    await env.DB.prepare(`INSERT INTO login_attempts (user, at) VALUES (?, ?)`).bind(user, now).run();
    return err('Mot de passe incorrect', 401);
  }

  await env.DB.prepare(`DELETE FROM login_attempts WHERE user = ?`).bind(user).run();
  await env.DB.prepare(`DELETE FROM sessions WHERE expires_at < ?`).bind(now).run();
  const token = randomToken();
  const maxAge = SESSION_DAYS * 86400;
  await env.DB.prepare(`INSERT INTO sessions (token, user, expires_at) VALUES (?, ?, ?)`)
    .bind(token, user, now + maxAge * 1000).run();
  return json({ user, name: USERS[user].name }, 200, { 'Set-Cookie': sessionCookie(token, maxAge) });
}

async function logout(request, env) {
  const token = getCookie(request, 'sid');
  if (token) await env.DB.prepare(`DELETE FROM sessions WHERE token = ?`).bind(token).run();
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
}

// ---------------------------------------------------------------------------
// Données
// ---------------------------------------------------------------------------
async function dueCount(env, user, now = Date.now()) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM tasks
     WHERE done = 0 AND due_at IS NOT NULL AND due_at <= ? AND (assignee = ? OR assignee = 'both')`,
  ).bind(now, user).first();
  return row.n;
}

async function getState(env, user) {
  const [items, tasks, badge] = await Promise.all([
    env.DB.prepare(
      `SELECT id, name, spec, category, on_list, added_by, updated_at, last_used_at FROM items
       ORDER BY on_list DESC, COALESCE(last_used_at, updated_at) DESC LIMIT 400`).all(),
    env.DB.prepare(
      `SELECT id, title, note, due_at, assignee, done, done_at, done_by, created_by, created_at, updated_at FROM tasks
       WHERE done = 0 ORDER BY due_at IS NULL, due_at, created_at`).all(),
    dueCount(env, user),
  ]);
  return { me: user, items: items.results, tasks: tasks.results, badge, now: Date.now() };
}

// --- Courses -----------------------------------------------------------------
async function addItem(request, env, user) {
  const body = await readJson(request);
  const name = clean(body.name, 60);
  if (!name) return err('Nom vide');
  const key = nameKey(name);
  const spec = clean(body.spec, 60);
  const category = clean(body.category, 30) || 'autre';
  const now = Date.now();
  const existing = await env.DB.prepare(`SELECT id FROM items WHERE name_key = ?`).bind(key).first();
  if (existing) {
    await env.DB.prepare(
      `UPDATE items SET spec = ?, added_by = ?, updated_at = CASE WHEN on_list = 1 THEN updated_at ELSE ? END,
       on_list = 1, category = CASE WHEN ? THEN ? ELSE category END WHERE id = ?`)
      .bind(spec, user, now, body.category ? 1 : 0, category, existing.id).run();
    return json({ id: existing.id });
  }
  const id = newId();
  await env.DB.prepare(
    `INSERT INTO items (id, name, name_key, spec, category, on_list, added_by, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
    .bind(id, name, key, spec, category, user, now).run();
  return json({ id }, 201);
}

async function updateItem(request, env, user, id) {
  const body = await readJson(request);
  const item = await env.DB.prepare(`SELECT * FROM items WHERE id = ?`).bind(id).first();
  if (!item) return err('Article introuvable', 404);
  const now = Date.now();
  let { name, name_key, spec, category, on_list, last_used_at, added_by, updated_at } = item;
  if (body.name !== undefined) {
    const n = clean(body.name, 60);
    if (!n) return err('Nom vide');
    const k = nameKey(n);
    if (k !== name_key) {
      const clash = await env.DB.prepare(`SELECT id FROM items WHERE name_key = ? AND id != ?`).bind(k, id).first();
      if (clash) return err('Un article porte déjà ce nom', 409);
    }
    name = n; name_key = k;
  }
  if (body.spec !== undefined) spec = clean(body.spec, 60);
  if (body.category !== undefined) category = clean(body.category, 30) || 'autre';
  if (body.on_list !== undefined) {
    const next = body.on_list ? 1 : 0;
    if (next === 0 && on_list === 1) { last_used_at = now; spec = ''; }
    if (next === 1 && on_list === 0) { added_by = user; updated_at = now; } // remis en fin de liste
    on_list = next;
  }
  await env.DB.prepare(
    `UPDATE items SET name = ?, name_key = ?, spec = ?, category = ?, on_list = ?, last_used_at = ?, added_by = ?, updated_at = ?
     WHERE id = ?`)
    .bind(name, name_key, spec, category, on_list, last_used_at, added_by, updated_at, id).run();
  return json({ ok: true });
}

async function deleteItem(env, id) {
  await env.DB.prepare(`DELETE FROM items WHERE id = ?`).bind(id).run();
  return json({ ok: true });
}

// --- Tâches ------------------------------------------------------------------
function parseDue(v) {
  if (v === null || v === '' || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

async function addTask(request, env, user) {
  const body = await readJson(request);
  const title = clean(body.title, 200);
  if (!title) return err('Titre vide');
  const due = parseDue(body.due_at);
  if (due === undefined) return err('Échéance invalide');
  const assignee = ASSIGNEES.includes(body.assignee) ? body.assignee : 'both';
  const now = Date.now();
  const id = newId();
  // Une échéance déjà très ancienne à la création ne déclenche pas de notification.
  const notified = due !== null && due < now - NOTIFY_MAX_LATE ? 1 : 0;
  await env.DB.prepare(
    `INSERT INTO tasks (id, title, note, due_at, assignee, created_by, created_at, updated_at, notified)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, title, clean(body.note, 2000), due, assignee, user, now, now, notified).run();
  return json({ id }, 201);
}

async function updateTask(request, env, user, id) {
  const body = await readJson(request);
  const t = await env.DB.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(id).first();
  if (!t) return err('Tâche introuvable', 404);
  const now = Date.now();
  let { title, note, due_at, assignee, done, done_at, done_by, notified } = t;
  if (body.title !== undefined) {
    title = clean(body.title, 200);
    if (!title) return err('Titre vide');
  }
  if (body.note !== undefined) note = clean(body.note, 2000);
  if (body.due_at !== undefined) {
    const d = parseDue(body.due_at);
    if (d === undefined) return err('Échéance invalide');
    if (d !== due_at) notified = d !== null && d < now - NOTIFY_MAX_LATE ? 1 : 0;
    due_at = d;
  }
  if (body.assignee !== undefined) {
    if (!ASSIGNEES.includes(body.assignee)) return err('Attribution invalide');
    if (body.assignee !== assignee && due_at !== null && due_at > now) notified = 0;
    assignee = body.assignee;
  }
  if (body.done !== undefined) {
    const d = body.done ? 1 : 0;
    if (d !== done) {
      done = d;
      done_at = d ? now : null;
      done_by = d ? user : null;
    }
  }
  await env.DB.prepare(
    `UPDATE tasks SET title = ?, note = ?, due_at = ?, assignee = ?, done = ?, done_at = ?, done_by = ?,
     notified = ?, updated_at = ? WHERE id = ?`)
    .bind(title, note, due_at, assignee, done, done_at, done_by, notified, now, id).run();
  return json({ ok: true });
}

async function deleteTask(env, id) {
  await env.DB.prepare(`DELETE FROM tasks WHERE id = ?`).bind(id).run();
  return json({ ok: true });
}

// --- Notifications -----------------------------------------------------------
async function subscribe(request, env, user) {
  const body = await readJson(request);
  const endpoint = String(body.endpoint || '');
  const p256dh = String(body.keys?.p256dh || '');
  const auth = String(body.keys?.auth || '');
  if (!endpoint.startsWith('https://') || !p256dh || !auth) return err('Abonnement invalide');
  await env.DB.prepare(
    `INSERT INTO subscriptions (endpoint, user, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user = excluded.user, p256dh = excluded.p256dh, auth = excluded.auth`)
    .bind(endpoint, user, p256dh, auth, Date.now()).run();
  return json({ ok: true });
}

async function unsubscribe(request, env) {
  const body = await readJson(request);
  if (body.endpoint) await env.DB.prepare(`DELETE FROM subscriptions WHERE endpoint = ?`).bind(String(body.endpoint)).run();
  return json({ ok: true });
}

async function notifyUser(env, user, data) {
  const subs = (await env.DB.prepare(`SELECT * FROM subscriptions WHERE user = ?`).bind(user).all()).results;
  if (!subs.length) return { sent: 0, subscriptions: 0 };
  const vapid = await getVapid(env);
  const subject = env.VAPID_SUBJECT || 'mailto:admin@example.com';
  let sent = 0;
  for (const sub of subs) {
    try {
      const status = await sendPush(sub, data, vapid, subject);
      if (status === 404 || status === 410) {
        await env.DB.prepare(`DELETE FROM subscriptions WHERE endpoint = ?`).bind(sub.endpoint).run();
      } else if (status >= 200 && status < 300) {
        sent++;
      } else {
        console.log('push refusé', status, sub.endpoint.slice(0, 60));
      }
    } catch (e) {
      console.log('push en erreur', e?.message);
    }
  }
  return { sent, subscriptions: subs.length };
}

async function testPush(env, user) {
  const badge = await dueCount(env, user);
  const r = await notifyUser(env, user, {
    title: 'Test de notification',
    body: `Bonjour ${USERS[user].name}, les notifications fonctionnent.`,
    badge,
    tag: 'test',
    url: '/',
  });
  if (!r.subscriptions) return err('Aucun appareil abonné pour toi. Active d’abord les notifications.', 409);
  return json(r);
}

// Appelé chaque minute par le déclencheur planifié.
export async function checkDueTasks(env, now = Date.now()) {
  await ensureSchema(env);
  // Les tâches faites sont supprimées (après une minute, le temps de pouvoir « Annuler »).
  await env.DB.prepare(`DELETE FROM tasks WHERE done = 1 AND (done_at IS NULL OR done_at < ?)`).bind(now - 60e3).run();
  const due = (await env.DB.prepare(
    `SELECT * FROM tasks WHERE done = 0 AND notified = 0 AND due_at IS NOT NULL AND due_at <= ? ORDER BY due_at LIMIT 50`)
    .bind(now).all()).results;
  let notifications = 0;
  for (const t of due) {
    // On marque d'abord, pour ne jamais notifier deux fois la même échéance.
    const upd = await env.DB.prepare(`UPDATE tasks SET notified = 1 WHERE id = ? AND notified = 0`).bind(t.id).run();
    if (!upd.meta?.changes) continue;
    if (t.due_at < now - NOTIFY_MAX_LATE) continue;
    const targets = t.assignee === 'both' ? ['flo', 'pouille'] : [t.assignee];
    for (const user of targets) {
      const badge = await dueCount(env, user, now);
      const r = await notifyUser(env, user, {
        title: `⏰ ${t.title}`,
        body: `Échéance : ${formatDue(t.due_at)}${t.note ? '\n' + t.note.slice(0, 120) : ''}`,
        badge,
        tag: `task-${t.id}`,
        url: '/#taches',
      });
      notifications += r.sent;
    }
  }
  return { due: due.length, notifications };
}

// ---------------------------------------------------------------------------
// Routage
// ---------------------------------------------------------------------------
async function handleApi(request, env, url) {
  const method = request.method;
  const path = url.pathname.replace(/\/+$/, '');

  // Protection CSRF : les écritures doivent venir de notre propre origine.
  if (method !== 'GET') {
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return err('Origine refusée', 403);
  }

  if (path === '/api/login' && method === 'POST') return login(request, env);
  if (path === '/api/logout' && method === 'POST') return logout(request, env);

  const user = await currentUser(request, env);
  if (!user) return err('Non connecté', 401);

  if (path === '/api/me' && method === 'GET') {
    const vapid = await getVapid(env);
    return json({ user, name: USERS[user].name, vapidPublicKey: vapid.publicKey });
  }
  if (path === '/api/state' && method === 'GET') return json(await getState(env, user));

  if (path === '/api/items' && method === 'POST') return addItem(request, env, user);
  let m = path.match(/^\/api\/items\/([a-f0-9]+)$/);
  if (m && method === 'PATCH') return updateItem(request, env, user, m[1]);
  if (m && method === 'DELETE') return deleteItem(env, m[1]);

  if (path === '/api/tasks' && method === 'POST') return addTask(request, env, user);
  m = path.match(/^\/api\/tasks\/([a-f0-9]+)$/);
  if (m && method === 'PATCH') return updateTask(request, env, user, m[1]);
  if (m && method === 'DELETE') return deleteTask(env, m[1]);

  if (path === '/api/push/subscribe' && method === 'POST') return subscribe(request, env, user);
  if (path === '/api/push/unsubscribe' && method === 'POST') return unsubscribe(request, env);
  if (path === '/api/push/test' && method === 'POST') return testPush(env, user);

  return err('Introuvable', 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        await ensureSchema(env);
        return await handleApi(request, env, url);
      } catch (e) {
        console.log('erreur API', e?.stack || e);
        return err('Erreur serveur', 500);
      }
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkDueTasks(env).then((r) => {
      if (r.due) console.log('échéances', JSON.stringify(r));
    }));
  },
};
