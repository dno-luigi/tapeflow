// Session sync for TapeFlow.
//
// The studio's own copy lives on the device (store/StudioContext, AsyncStorage).
// This is the account copy: rows in Cloudflare D1 behind worker/index.js, where
// ownership is stamped from the session token on every write. Never send an
// owner, user or device field, and never try to read another person's rows.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { request } from './api';
import { getToken, currentUser, onAuthChange } from './auth';

const PENDING_KEY = 'tapeflow.db.pending';
const IDMAP_KEY = 'tapeflow.db.idmap';
const REQUEST_TIMEOUT_MS = 30000;

async function call(op, body) {
  const token = await getToken();
  if (!token) {
    // TYPED, not just worded: a screen (and the queue below) catches this exact
    // code, rather than matching on a sentence.
    const needsUser = new Error('Sign in to save this.');
    needsUser.code = 'sign_in_required';
    throw needsUser;
  }
  return request('/api/db', {
    token,
    timeoutMs: REQUEST_TIMEOUT_MS,
    body: Object.assign({ op }, body),
    fallback: 'Could not save your changes.',
  });
}

// ── Writes made before anybody signed in ────────────────────────────────────
//
// A save never fails for want of a sign-in. It is kept on the device and sent
// the moment there is a session, and reads show what is waiting alongside what
// the server has — so the app looks exactly as it would if the write had gone
// through, because from the person's point of view it did.
//
// Unsent work follows the person who made it into the account they sign in
// with. It moves only work that was never stored anywhere, never rows that
// already belong to somebody.
let pending = null;
let idMap = null;
let idMapLoaded = null;
let pendingLoaded = null;
let flushing = false;

async function loadPending() {
  if (pending) return pending;
  if (!pendingLoaded) {
    pendingLoaded = (async () => {
      try {
        const raw = await AsyncStorage.getItem(PENDING_KEY);
        pending = raw ? JSON.parse(raw) : [];
      } catch (e) {
        pending = [];
      }
      if (!Array.isArray(pending)) pending = [];
      return pending;
    })();
  }
  return pendingLoaded;
}

// Returns false when the queue could not be written down. The caller decides
// what that means: for a new write, nothing (it is in memory and this session
// still works); for the flush, stop, because sending more when the record of
// what was sent did not stick is how one row becomes two after a restart.
async function savePending() {
  try {
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(pending || []));
    return true;
  } catch (e) {
    return false;
  }
}

function isSignInRefusal(e) {
  return !!(e && e.code === 'sign_in_required');
}

// A row as the app will see it until it is really stored. The id is local and
// temporary; updateRecord and deleteRecord know how to find it, and the flush
// rewrites it to the server's id once there is one.
function rowFromOps(ops, table, me) {
  let rows = [];
  const byId = {};
  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i];
    if (op.table !== table) continue;
    // Somebody else's unsent work is kept on this device (the flush steps over
    // it) and must not be READ here either. Guest work, made before anybody
    // signed in, is shown: it is about to become this person's on the next
    // flush, which is what the queue is for.
    if (me !== undefined && op.scope && op.scope !== me) continue;
    if (op.kind === 'insert') {
      const row = Object.assign({}, op.values, { id: op.id, created_at: op.at, pending: true });
      byId[op.id] = row;
      rows.push(row);
    } else if (op.kind === 'update' && byId[op.id]) {
      Object.assign(byId[op.id], op.values);
    } else if (op.kind === 'delete' && byId[op.id]) {
      rows = rows.filter((r) => r.id !== op.id);
      delete byId[op.id];
    }
  }
  return rows;
}

function isLocalId(id) {
  return typeof id === 'string' && id.indexOf('local-') === 0;
}

function makeId() {
  let s = '';
  const alphabet = 'abcdef0123456789';
  for (let i = 0; i < 32; i += 1) s += alphabet.charAt(Math.floor(Math.random() * 16));
  return s;
}

// What each local id became once it was really stored. A screen keeps the row
// saveRecord handed it, local id and all, and may edit or delete it minutes
// later — long after the flush gave it a real id.
async function loadIdMap() {
  if (idMap) return idMap;
  if (!idMapLoaded) {
    idMapLoaded = (async () => {
      try {
        const raw = await AsyncStorage.getItem(IDMAP_KEY);
        idMap = raw ? JSON.parse(raw) : {};
      } catch (e) {
        idMap = {};
      }
      if (!idMap || typeof idMap !== 'object') idMap = {};
      return idMap;
    })();
  }
  return idMapLoaded;
}

async function rememberId(localId, serverId) {
  const map = await loadIdMap();
  map[localId] = serverId;
  try {
    await AsyncStorage.setItem(IDMAP_KEY, JSON.stringify(map));
  } catch (e) {
    /* the row is still stored; only its alias is lost */
  }
}

/** The id the server knows this row by, or the local one while it is still waiting. */
async function realId(id) {
  if (!isLocalId(id)) return id;
  const map = await loadIdMap();
  return map[id] || id;
}

/**
 * Who was signed in when an operation was queued, or null for nobody.
 *
 * The person's id, never the session token: a token changes every time somebody
 * signs out and back in, so scoping by it would stop their own work being theirs.
 */
async function whoAmI() {
  try {
    const user = await currentUser();
    return user && user.id ? String(user.id) : null;
  } catch (e) {
    return null;
  }
}

/**
 * Send everything that is waiting, oldest first.
 *
 * Stops at the first failure and keeps the rest: a half-sent queue that retries
 * is recoverable, a queue thrown away because one row was rejected is not. An
 * insert's real id replaces its local one in every later operation, so an edit
 * made before signing in still lands on the right row.
 */
export async function syncPending() {
  if (flushing) return 0;
  const ops = await loadPending();
  if (!ops.length) return 0;
  const me = await whoAmI();
  if (!me) return 0;
  flushing = true;
  let sent = 0;
  // Work made while a DIFFERENT account was signed in is not this account's to
  // store, and it is not ours to throw away either: that person signs back in on
  // this device and it is still theirs. So it is stepped over and left in the
  // queue. Guest work (scope null) is sent, because somebody typing before they
  // make an account is the case this queue exists for.
  const held = [];
  try {
    while (ops.length) {
      const op = ops[0];
      // Held, not persisted-away: writing the shortened queue here means a kill
      // during any later network call loses the other person's work for good.
      if (op.scope && op.scope !== me) {
        held.push(op);
        ops.shift();
        continue;
      }
      try {
        if (op.kind === 'insert') {
          const out = await call('insert', { table: op.table, values: op.values || {} });
          const stored = out && out.row && out.row.id;
          if (stored) {
            for (let i = 1; i < ops.length; i += 1) if (ops[i].id === op.id) ops[i].id = stored;
            await rememberId(op.id, stored);
          }
        } else if (op.kind === 'update') {
          const uid = await realId(op.id);
          if (isLocalId(uid)) {
            ops.shift();
            continue;
          }
          await call('update', { table: op.table, id: uid, values: op.values || {} });
        } else if (op.kind === 'delete') {
          const did = await realId(op.id);
          if (isLocalId(did)) {
            ops.shift();
            continue;
          }
          await call('delete', { table: op.table, id: did });
        }
      } catch (e) {
        // Still nobody signed in, or the network is gone. Keep everything and
        // try again next time; this is not an error the app should see.
        break;
      }
      ops.shift();
      sent += 1;
      if (!(await savePending())) break;
    }
  } finally {
    // Put back everything that belongs to somebody else, oldest first, so the
    // next person to sign in on this device finds their own work waiting.
    // In place, never a new array: a concurrent saveRecord may be holding it.
    if (held.length) ops.unshift(...held);
    flushing = false;
    await savePending();
  }
  return sent;
}

/** How many writes are waiting to be sent. */
export async function pendingCount() {
  const ops = await loadPending();
  return ops.length;
}

/** Create one row. Returns the stored row, including its id. */
export async function saveRecord(table, values) {
  try {
    const out = await call('insert', { table, values: values || {} });
    return out.row;
  } catch (e) {
    if (!isSignInRefusal(e)) throw e;
    const ops = await loadPending();
    const op = {
      kind: 'insert',
      table,
      id: 'local-' + makeId(),
      values: values || {},
      at: new Date().toISOString(),
      scope: await whoAmI(),
    };
    ops.push(op);
    await savePending();
    return Object.assign({}, op.values, { id: op.id, created_at: op.at, pending: true });
  }
}

/** Change one row by id. Returns the updated row, or null if it was not yours. */
export async function updateRecord(table, id, values) {
  // The screen may still be holding the local id of a row that has since been
  // sent. Ask what it became before deciding this is a local edit.
  const target = await realId(id);
  if (isLocalId(target)) {
    const waiting = await loadPending();
    waiting.push({ kind: 'update', table, id: target, values: values || {}, scope: await whoAmI() });
    await savePending();
    const after = rowFromOps(waiting, table, await whoAmI()).filter((r) => r.id === target);
    return after[0] || null;
  }
  try {
    const out = await call('update', { table, id: target, values: values || {} });
    return out.row;
  } catch (e) {
    if (!isSignInRefusal(e)) throw e;
    const ops = await loadPending();
    ops.push({ kind: 'update', table, id: target, values: values || {}, scope: await whoAmI() });
    await savePending();
    return Object.assign({ id: target }, values || {});
  }
}

/** Remove one row by id. */
export async function deleteRecord(table, id) {
  const target = await realId(id);
  if (isLocalId(target)) {
    const waiting = await loadPending();
    waiting.push({ kind: 'delete', table, id: target, scope: await whoAmI() });
    await savePending();
    return true;
  }
  try {
    await call('delete', { table, id: target });
    return true;
  } catch (e) {
    if (!isSignInRefusal(e)) throw e;
    const ops = await loadPending();
    ops.push({ kind: 'delete', table, id: target, scope: await whoAmI() });
    await savePending();
    return true;
  }
}

/**
 * Read this device's rows.
 *
 * options: { limit, offset, orderBy, descending }. Newest first is
 * { orderBy: 'created_at', descending: true }.
 *
 * Anything still waiting to be sent is included, so a screen shows what was
 * just saved whether or not anybody has signed in.
 */
export async function listRecords(table, options) {
  const o = options || {};
  let stored = [];
  try {
    const out = await call('list', {
      table,
      limit: o.limit,
      offset: o.offset,
      orderBy: o.orderBy,
      descending: o.descending === true,
    });
    stored = out.rows || [];
  } catch (e) {
    if (!isSignInRefusal(e)) throw e;
    stored = [];
  }
  // A later page is the server's alone. The server chose its page before this
  // ran, so appending local rows to page two would show them again and push a
  // real row off the end. They belong to the first page, once.
  if (o.offset) return stored;
  const ops = await loadPending();
  if (!ops.length) return stored;
  const local = rowFromOps(ops, table, await whoAmI());
  if (!local.length) return stored;
  const merged = stored.concat(local);
  if (o.orderBy) {
    const key = o.orderBy;
    const dir = o.descending === true ? -1 : 1;
    merged.sort((a, b) => {
      const x = a[key];
      const y = b[key];
      if (x === y) return 0;
      return (x > y ? 1 : -1) * dir;
    });
  }
  return typeof o.limit === 'number' ? merged.slice(0, o.limit) : merged;
}

// Sent the moment somebody signs in, without any screen having to ask. A person
// who fills in onboarding, signs in two screens later and never writes again
// still gets everything they typed.
try {
  onAuthChange((user) => {
    if (user) syncPending();
  });
} catch (e) {
  // No subscription available: the next database call flushes instead.
}

export default { saveRecord, updateRecord, deleteRecord, listRecords, syncPending, pendingCount };
