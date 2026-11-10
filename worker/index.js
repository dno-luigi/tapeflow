/**
 * TapeFlow — Cloudflare Worker.
 *
 * One Worker serves both halves of the app:
 *   /api/*   the account and session-sync API, backed by D1 (env.DB)
 *   the rest the Expo web build in ./dist, served from the ASSETS binding
 *
 * This replaces the WRON backend the app was generated against (wron.ai auth,
 * database and AI endpoints). Accounts are email + password here; sessions are
 * bearer tokens held in `auth_sessions` and scoped rows live in `records`.
 * Ownership is always taken from the token, never from the request body.
 */

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

// Auth is a bearer token in a header, not a cookie, so a wildcard origin does
// not let another site act as the signed-in person. It is what makes the app
// work from the Expo dev server, a native build (Origin: null) and the site.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-max-age': '86400',
};

const ALLOWED_TABLES = new Set(['sessions']);
const MAX_ROW_BYTES = 512 * 1024;
const SESSION_TTL_DAYS = 90;
const PBKDF2_ITERATIONS = 100000;
const DEFAULT_LIST_LIMIT = 200;
const MAX_LIST_LIMIT = 500;

const encoder = new TextEncoder();

// ── small helpers ──────────────────────────────────────────────────────────

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...CORS } });
}

function fail(status, error, details) {
  return json({ ok: false, error, details: details || error }, status);
}

function hex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

function fromHex(value) {
  const clean = String(value || '');
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function randomHex(byteLength) {
  return hex(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return hex(new Uint8Array(digest));
}

// Length-checked, branch-free comparison, so a wrong token does not leak how
// much of the right one it guessed.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : null;
  } catch (e) {
    return null;
  }
}

function isEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// ── passwords ──────────────────────────────────────────────────────────────

async function derive(password, saltHex, iterations) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromHex(saltHex), iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return hex(new Uint8Array(bits));
}

async function hashPassword(password) {
  const salt = randomHex(16);
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${hash}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]) || PBKDF2_ITERATIONS;
  const candidate = await derive(password, parts[2], iterations);
  return safeEqual(candidate, parts[3]);
}

// ── sessions ───────────────────────────────────────────────────────────────

async function createSession(env, userId) {
  const token = randomHex(32);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_DAYS * 86400000);
  await env.DB.prepare(
    'INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  )
    .bind(await sha256Hex(token), userId, now.toISOString(), expires.toISOString())
    .run();
  return token;
}

function bearerToken(request) {
  const header = request.headers.get('authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  return token || null;
}

// The signed-in person, or null. Every row read and write is scoped by this id.
async function requireUser(request, env) {
  const token = bearerToken(request);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.created_at, s.expires_at
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
  )
    .bind(tokenHash)
    .first();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    // Expired: drop it now rather than leaving a row that can never work again.
    await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(tokenHash).run();
    return null;
  }
  return { id: row.id, email: row.email, name: row.name, created_at: row.created_at };
}

// ── auth routes ────────────────────────────────────────────────────────────

async function signUp(request, env) {
  const body = await readJson(request);
  if (!body) return fail(400, 'bad_request', 'Send a JSON body.');

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const name = body.name ? String(body.name).trim().slice(0, 80) || null : null;

  if (!isEmail(email)) return fail(400, 'invalid_email', 'Enter a valid email address.');
  if (password.length < 8) return fail(400, 'weak_password', 'Use at least 8 characters for your password.');

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return fail(409, 'email_taken', 'There is already an account with that email.');

  const id = 'usr_' + randomHex(9);
  const createdAt = new Date().toISOString();
  await env.DB.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, email, name, await hashPassword(password), createdAt)
    .run();

  const token = await createSession(env, id);
  return json({ ok: true, token, user: { id, email, name, created_at: createdAt } }, 201);
}

async function signIn(request, env) {
  const body = await readJson(request);
  if (!body) return fail(400, 'bad_request', 'Send a JSON body.');

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const wrong = () => fail(401, 'invalid_credentials', 'That email or password is not right.');

  if (!isEmail(email) || !password) return wrong();

  const user = await env.DB.prepare('SELECT id, email, name, password_hash, created_at FROM users WHERE email = ?')
    .bind(email)
    .first();
  // Hash even when the address is unknown, so "no such user" and "wrong
  // password" take the same time and cannot be told apart.
  const stored = user ? user.password_hash : `pbkdf2$${PBKDF2_ITERATIONS}$${randomHex(16)}$${randomHex(32)}`;
  const matches = await verifyPassword(password, stored);
  if (!user || !matches) return wrong();

  const token = await createSession(env, user.id);
  return json({
    ok: true,
    token,
    user: { id: user.id, email: user.email, name: user.name, created_at: user.created_at },
  });
}

async function signOutRoute(request, env, user) {
  const token = bearerToken(request);
  if (token) {
    await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  }
  return json({ ok: true, signedOut: !!user });
}

async function meRoute(request, env, user) {
  if (!user) return fail(401, 'sign_in_required', 'Sign in to continue.');
  return json({ ok: true, user });
}

async function deleteAccountRoute(request, env, user) {
  if (!user) return fail(401, 'sign_in_required', 'Sign in to delete your account.');
  // Explicit, in this order: D1 does not enforce ON DELETE CASCADE unless
  // foreign keys are enabled on the connection, so nothing is left behind.
  await env.DB.prepare('DELETE FROM records WHERE user_id = ?').bind(user.id).run();
  await env.DB.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(user.id).run();
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();
  return json({ ok: true, deleted: true });
}

// ── record routes (the app's session rows) ─────────────────────────────────

function rowFromRecord(record) {
  let values = {};
  try {
    values = JSON.parse(record.data) || {};
  } catch (e) {
    values = {};
  }
  // Spread first, then the server's own columns: a client field called `id`
  // cannot overwrite the id the row is actually stored under.
  return { ...values, id: record.id, created_at: record.created_at, updated_at: record.updated_at };
}

function tableFor(body) {
  const table = String(body.table || '');
  return ALLOWED_TABLES.has(table) ? table : null;
}

function valuesFor(body) {
  const values = body.values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) return null;
  let serialised;
  try {
    serialised = JSON.stringify(values);
  } catch (e) {
    return null;
  }
  if (serialised.length > MAX_ROW_BYTES) return null;
  return serialised;
}

async function dbRoute(request, env, user) {
  if (!user) return fail(401, 'sign_in_required', 'Sign in to save this.');

  const body = await readJson(request);
  if (!body) return fail(400, 'bad_request', 'Send a JSON body.');

  const op = String(body.op || '');
  const table = tableFor(body);
  if (!table) return fail(400, 'bad_table', 'That data is not set up.');

  if (op === 'insert') {
    const data = valuesFor(body);
    if (!data) return fail(400, 'bad_values', 'That record could not be stored.');
    const id = 'rec_' + randomHex(9);
    const now = new Date().toISOString();
    await env.DB.prepare(
      'INSERT INTO records (id, user_id, tbl, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(id, user.id, table, data, now, now)
      .run();
    return json({ ok: true, row: rowFromRecord({ id, data, created_at: now, updated_at: now }) });
  }

  if (op === 'update') {
    const id = String(body.id || '');
    const data = valuesFor(body);
    if (!id || !data) return fail(400, 'bad_values', 'That record could not be stored.');
    const now = new Date().toISOString();
    const result = await env.DB.prepare(
      'UPDATE records SET data = ?, updated_at = ? WHERE id = ? AND user_id = ? AND tbl = ?',
    )
      .bind(data, now, id, user.id, table)
      .run();
    if (!result.meta || !result.meta.changes) return json({ ok: true, row: null });
    const stored = await env.DB.prepare('SELECT id, data, created_at, updated_at FROM records WHERE id = ? AND user_id = ?')
      .bind(id, user.id)
      .first();
    return json({ ok: true, row: stored ? rowFromRecord(stored) : null });
  }

  if (op === 'delete') {
    const id = String(body.id || '');
    if (!id) return fail(400, 'bad_request', 'Which record?');
    const result = await env.DB.prepare('DELETE FROM records WHERE id = ? AND user_id = ? AND tbl = ?')
      .bind(id, user.id, table)
      .run();
    return json({ ok: true, deleted: !!(result.meta && result.meta.changes) });
  }

  if (op === 'list') {
    const limit = Math.min(MAX_LIST_LIMIT, Math.max(1, Number(body.limit) || DEFAULT_LIST_LIMIT));
    const offset = Math.max(0, Number(body.offset) || 0);
    // Whitelisted, because these are interpolated: only the two real columns.
    const column = body.orderBy === 'updated_at' ? 'updated_at' : 'created_at';
    const direction = body.descending === true ? 'DESC' : 'ASC';
    const rows = await env.DB.prepare(
      `SELECT id, data, created_at, updated_at FROM records
        WHERE user_id = ? AND tbl = ?
        ORDER BY ${column} ${direction}, rowid ASC
        LIMIT ? OFFSET ?`,
    )
      .bind(user.id, table, limit, offset)
      .all();
    return json({ ok: true, rows: (rows.results || []).map(rowFromRecord) });
  }

  return fail(400, 'bad_op', 'Unknown operation.');
}

// ── router ─────────────────────────────────────────────────────────────────

async function handleApi(request, env) {
  const { pathname } = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (pathname === '/api/health') {
    return json({ ok: true, service: 'tapeflow', time: new Date().toISOString() });
  }

  if (pathname === '/api/auth/signup' && request.method === 'POST') return signUp(request, env);
  if (pathname === '/api/auth/signin' && request.method === 'POST') return signIn(request, env);

  // Everything below needs to know who is asking.
  const user = pathname.startsWith('/api/auth/') || pathname === '/api/db' ? await requireUser(request, env) : null;

  if (pathname === '/api/auth/signout' && request.method === 'POST') return signOutRoute(request, env, user);
  if (pathname === '/api/auth/me' && request.method === 'POST') return meRoute(request, env, user);
  if (pathname === '/api/auth/delete' && request.method === 'POST') return deleteAccountRoute(request, env, user);
  if (pathname === '/api/db' && request.method === 'POST') return dbRoute(request, env, user);

  return fail(404, 'not_found', 'No such endpoint.');
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env);
      } catch (error) {
        // A dropped D1 binding or an unset database is a setup problem, not a
        // client one, and saying so is more useful than a bare 500.
        const message = String((error && error.message) || error);
        console.error('api error', pathname, message);
        return fail(500, 'server_error', 'The server could not finish that. Try again.');
      }
    }

    return env.ASSETS.fetch(request);
  },
};
