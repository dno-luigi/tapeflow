// Wron database client. Generated - do not edit.
//
// Rows are stored on Wron's server, not on the device. Ownership is stamped by
// the server on every write: never send an owner, user or device field, and
// never try to read another caller's rows, because there is no way to ask for
// them.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getToken, currentUser, onAuthChange } from './wron-auth';

var APP_ID = 'deac5386e6bf253c461d2004';
var APP_KEY = 'wron_app_cnY752qxV7rQf8rhkqIsdsRQ2J4lRjaEdPp9cUfc3lc';
var BASE = 'https://www.wron.ai';
var ENDPOINT = BASE + '/api/agent/' + APP_ID + '/db';
var DEVICE_KEY = 'wron.device.id';

// A phone on a bad connection must fail rather than hang. A spinner with no end
// is worse than an error: there is nothing to retry and nothing to read.
var REQUEST_TIMEOUT_MS = 30000;

var devicePromise = null;

function makeId() {
  var s = '';
  var alphabet = 'abcdef0123456789';
  for (var i = 0; i < 32; i++) s += alphabet.charAt(Math.floor(Math.random() * 16));
  return s;
}

// One id per install, kept so the same device sees its own rows after a restart.
// Not a user identity: it is hashed with the app id server-side and cannot be
// correlated across apps.
async function deviceId() {
  if (!devicePromise) {
    devicePromise = (async function () {
      try {
        var existing = await AsyncStorage.getItem(DEVICE_KEY);
        if (existing) return existing;
        var fresh = makeId();
        await AsyncStorage.setItem(DEVICE_KEY, fresh);
        return fresh;
      } catch (e) {
        // Storage unavailable: still work, just not across restarts.
        return makeId();
      }
    })();
  }
  return devicePromise;
}

async function call(op, body) {
  var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = controller ? setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS) : null;
  var device = await deviceId();
  var headers = {
    'Content-Type': 'application/json',
    'X-Wron-Key': APP_KEY,
    'X-Wron-Device': device,
  };
  var session = await getToken();
  if (session) headers['X-Wron-Session'] = session;

  var res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(Object.assign({ op: op }, body)),
      signal: controller ? controller.signal : undefined,
    });
  } catch (e) {
    var aborted = e && (e.name === 'AbortError' || String(e.message || '').indexOf('Abort') >= 0);
    throw new Error(aborted ? 'That took too long. Check your connection and try again.' : 'Could not reach the server.');
  } finally {
    if (timer) clearTimeout(timer);
  }

  var data = null;
  try { data = await res.json(); } catch (e) { data = null; }

  if (!res.ok || !data || data.ok !== true) {
    var detail = data && data.details ? data.details : null;
    if (res.status === 401 && data && data.error === 'sign_in_required') {
      // TYPED, not just worded. A screen catches this exact code to offer
      // sign-in; anything else it would have to match on a sentence.
      var needsUser = new Error(detail || 'Sign in to save this.');
      needsUser.code = 'sign_in_required';
      throw needsUser;
    }
    if (res.status === 404 && data && data.error === 'no_table') {
      throw new Error(detail || 'That data is not set up yet.');
    }
    if (res.status === 429) throw new Error(detail || 'Too many changes at once. Try again shortly.');
    if (res.status === 503) throw new Error(detail || 'Storage is not available for this app yet.');
    if (res.status === 507) throw new Error(detail || 'This app has run out of storage.');
    throw new Error(detail || 'Could not save your changes.');
  }
  return data;
}

// ── Writes made before anybody signed in ────────────────────────────────────
//
// In an app with accounts the server refuses a write without a session, and for
// a long time that refusal was the app's problem: every screen had to catch it,
// offer sign-in and retry, and the screens that did not left somebody stuck on
// an onboarding step they could not finish. That is not a thing to keep asking
// for. It is the client's job.
//
// So a save never fails for want of a sign-in. It is kept here, on the device,
// and sent the moment there is a session. Reads show what is waiting alongside
// what the server has, so the app looks exactly as it would if the write had
// gone through, because from the person's point of view it did.
//
// This is the same shape as offline persistence in every database SDK that has
// it, and the same shape as linking an anonymous account: unsent work follows
// the person who made it into the account they sign in with. It moves only work
// that was never stored anywhere, never rows that already belong to somebody.
var QUEUE = true;
var PENDING_KEY = 'wron.db.pending.' + APP_ID;
var IDMAP_KEY = 'wron.db.idmap.' + APP_ID;
var pending = null;
var idMap = null;
var idMapLoaded = null;
var pendingLoaded = null;
var flushing = false;

async function loadPending() {
  if (pending) return pending;
  if (!pendingLoaded) {
    pendingLoaded = (async function () {
      try {
        var raw = await AsyncStorage.getItem(PENDING_KEY);
        pending = raw ? JSON.parse(raw) : [];
      } catch (e) {
        pending = [];
      }
      if (!Array.isArray(pending)) pending = [];
      // An op from an older build of this client tagged its scope with a session
      // token rather than a person, and a token never matches a user id, so those
      // writes would sit here unsendable forever. This client has not shipped, so
      // the only devices that can hold them are ours; they are read as guest work,
      // which is what they were in every case that can actually exist.
      for (var i = 0; i < pending.length; i++) {
        if (pending[i] && pending[i].v !== 2) { pending[i].scope = null; pending[i].v = 2; }
      }
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
  var rows = [];
  var byId = {};
  for (var i = 0; i < ops.length; i++) {
    var op = ops[i];
    if (op.table !== table) continue;
    // Somebody else's unsent work is kept on this device (the flush steps over
    // it) and must not be READ here either. Guest work, made before anybody
    // signed in, is shown: it is about to become this person's on the next
    // flush, which is what the queue is for.
    if (me !== undefined && op.scope && op.scope !== me) continue;
    if (op.kind === 'insert') {
      var row = Object.assign({}, op.values, { id: op.id, created_at: op.at, pending: true });
      byId[op.id] = row;
      rows.push(row);
    } else if (op.kind === 'update' && byId[op.id]) {
      Object.assign(byId[op.id], op.values);
    } else if (op.kind === 'delete' && byId[op.id]) {
      rows = rows.filter(function (r) { return r.id !== op.id; });
      delete byId[op.id];
    }
  }
  return rows;
}

function isLocalId(id) {
  return typeof id === 'string' && id.indexOf('local-') === 0;
}

// What each local id became once it was really stored.
//
// A screen keeps the row saveRecord handed it, local id and all, and may edit or
// delete it minutes later — long after the flush gave it a real id. Without this
// that edit was queued against an id the server has never heard of and thrown
// away by the next flush, silently. Kept on the device because the screen holding
// the id survives a restart too.
async function loadIdMap() {
  if (idMap) return idMap;
  if (!idMapLoaded) {
    idMapLoaded = (async function () {
      try {
        var raw = await AsyncStorage.getItem(IDMAP_KEY);
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
  var map = await loadIdMap();
  map[localId] = serverId;
  try { await AsyncStorage.setItem(IDMAP_KEY, JSON.stringify(map)); } catch (e) {}
}

/** The id the server knows this row by, or the local one while it is still waiting. */
async function realId(id) {
  if (!isLocalId(id)) return id;
  var map = await loadIdMap();
  return map[id] || id;
}

/**
 * Who was signed in when an operation was queued, or null for nobody.
 *
 * The person's id, never the session token. A token changes every time somebody
 * signs out and back in, so scoping by it meant their own work stopped being
 * theirs the moment they signed in again.
 */
async function whoAmI() {
  if (!QUEUE) return null;
  try {
    var user = await currentUser();
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
  if (!QUEUE || flushing) return 0;
  var ops = await loadPending();
  if (!ops.length) return 0;
  var me = await whoAmI();
  if (!me) return 0;
  flushing = true;
  var sent = 0;
  // Work made while a DIFFERENT account was signed in is not this account's to
  // store, and it is not ours to throw away either: that person signs back in on
  // this device and it is still theirs. So it is stepped over and left in the
  // queue. Guest work (scope null) is sent, because somebody typing before they
  // make an account is the case this queue exists for, and it follows them in,
  // the way linking an anonymous account does everywhere.
  var held = [];
  try {
    while (ops.length) {
      var op = ops[0];
      // Held, not persisted-away: writing the shortened queue here meant a kill
      // during any later network call lost the other person's work for good,
      // because the restore only happens in finally (Greptile on #66). In memory
      // it is out of the way; on disk it never stops existing.
      if (op.scope && op.scope !== me) { held.push(op); ops.shift(); continue; }
      try {
        if (op.kind === 'insert') {
          var out = await call('insert', { table: op.table, values: op.values || {} });
          var stored = out && out.row && out.row.id;
          if (stored) {
            for (var i = 1; i < ops.length; i++) if (ops[i].id === op.id) ops[i].id = stored;
            // And for the screen that is still holding the local id.
            await rememberId(op.id, stored);
          }
        } else if (op.kind === 'update') {
          var uid = await realId(op.id);
          if (isLocalId(uid)) { ops.shift(); continue; }
          await call('update', { table: op.table, id: uid, values: op.values || {} });
        } else if (op.kind === 'delete') {
          var did = await realId(op.id);
          if (isLocalId(did)) { ops.shift(); continue; }
          await call('delete', { table: op.table, id: did });
        }
      } catch (e) {
        // Still nobody signed in, or the network is gone. Keep everything and
        // try again next time; this is not an error the app should see.
        break;
      }
      ops.shift();
      sent++;
      if (!(await savePending())) break;
    }
  } finally {
    // Put back everything that belongs to somebody else, oldest first, so the
    // next person to sign in on this device finds their own work waiting.
    if (held.length) {
      // In place, never a new array: a concurrent saveRecord awaited whoAmI()
      // holding THIS array, and swapping it meant that push landed on an
      // abandoned copy while savePending wrote the replacement - a pending row
      // that neither survived restart nor synced (Greptile on #66).
      ops.unshift(...held);
    }
    flushing = false;
    await savePending();
  }
  return sent;
}

/** How many writes are waiting to be sent. For a quiet "saved on this device" note. */
export async function pendingCount() {
  if (!QUEUE) return 0;
  var ops = await loadPending();
  return ops.length;
}

/** Create one row. Returns the stored row, including its id. */
export async function saveRecord(table, values) {
  try {
    var out = await call('insert', { table: table, values: values || {} });
    return out.row;
  } catch (e) {
    if (!QUEUE || !isSignInRefusal(e)) throw e;
    var ops = await loadPending();
    var op = { kind: 'insert', table: table, id: 'local-' + makeId(), values: values || {}, at: new Date().toISOString(), scope: await whoAmI(), v: 2 };
    ops.push(op);
    await savePending();
    return Object.assign({}, op.values, { id: op.id, created_at: op.at, pending: true });
  }
}

/** Change one row by id. Returns the updated row, or null if it was not yours. */
export async function updateRecord(table, id, values) {
  // The screen may still be holding the local id of a row that has since been
  // sent. Ask what it became before deciding this is a local edit.
  var target = QUEUE ? await realId(id) : id;
  if (QUEUE && isLocalId(target)) {
    var waiting = await loadPending();
    waiting.push({ kind: 'update', table: table, id: target, values: values || {}, scope: await whoAmI(), v: 2 });
    await savePending();
    var after = rowFromOps(waiting, table, await whoAmI()).filter(function (r) { return r.id === target; });
    return after[0] || null;
  }
  try {
    var out = await call('update', { table: table, id: target, values: values || {} });
    return out.row;
  } catch (e) {
    if (!QUEUE || !isSignInRefusal(e)) throw e;
    var ops = await loadPending();
    ops.push({ kind: 'update', table: table, id: target, values: values || {}, scope: await whoAmI(), v: 2 });
    await savePending();
    return Object.assign({ id: target }, values || {});
  }
}

/** Remove one row by id. */
export async function deleteRecord(table, id) {
  var target = QUEUE ? await realId(id) : id;
  if (QUEUE && isLocalId(target)) {
    var waiting = await loadPending();
    waiting.push({ kind: 'delete', table: table, id: target, scope: await whoAmI(), v: 2 });
    await savePending();
    return true;
  }
  try {
    await call('delete', { table: table, id: target });
    return true;
  } catch (e) {
    if (!QUEUE || !isSignInRefusal(e)) throw e;
    var ops = await loadPending();
    ops.push({ kind: 'delete', table: table, id: target, scope: await whoAmI(), v: 2 });
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
  var o = options || {};
  var stored = [];
  try {
    var out = await call('list', {
      table: table,
      limit: o.limit,
      offset: o.offset,
      orderBy: o.orderBy,
      descending: o.descending === true,
    });
    stored = out.rows || [];
  } catch (e) {
    if (!QUEUE || !isSignInRefusal(e)) throw e;
    stored = [];
  }
  if (!QUEUE) return stored;
  // A later page is the server's alone. The server chose its page before this
  // ran, so appending local rows to page two would show them again and push a
  // real row off the end. They belong to the first page, once.
  if (o.offset) return stored;
  var ops = await loadPending();
  if (!ops.length) return stored;
  var local = rowFromOps(ops, table, await whoAmI());
  if (!local.length) return stored;
  var merged = stored.concat(local);
  if (o.orderBy) {
    var key = o.orderBy;
    var dir = o.descending === true ? -1 : 1;
    merged.sort(function (a, b) {
      var x = a[key], y = b[key];
      if (x === y) return 0;
      return (x > y ? 1 : -1) * dir;
    });
  }
  return typeof o.limit === 'number' ? merged.slice(0, o.limit) : merged;
}

export default { saveRecord, updateRecord, deleteRecord, listRecords, syncPending, pendingCount };

// Sent the moment somebody signs in, without any screen having to ask. A person
// who fills in onboarding, signs in two screens later and never writes again
// still gets everything they typed.
try {
  onAuthChange(function (user) { if (user) syncPending(); });
} catch (e) {
  // No subscription available: the next database call flushes instead.
}
