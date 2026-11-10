// Accounts for TapeFlow, against the Worker in worker/index.js.
//
// The session is a bearer token kept on the device. Passwords are typed here
// and sent over https; they are never stored on the device.
//
// Sign in with Google and Sign in with Apple are NOT here. They depended on
// WRON's hosted OAuth broker, which this app no longer talks to; wiring them up
// again means registering an OAuth client and choosing a callback scheme, which
// is a separate job from moving the backend.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { request } from './api';

const TOKEN_KEY = 'tapeflow.auth.session';
// Tokens whose revocation could not be delivered, so a later launch can finish
// signing out properly. A list, not a slot: each token is revoked separately.
const PENDING_REVOKE_KEY = 'tapeflow.auth.pendingRevoke';

// The session, in memory. Read from storage once on first use; after that this
// is the answer, so no screen pays a disk read to know who is signed in.
let cached = null;
let loading = null;
const listeners = [];
// Bumped by every remember(). A read that started before a sign-in must not
// finish after it and put the old answer back.
let generation = 0;

function announce() {
  const user = cached ? cached.user : null;
  for (let i = 0; i < listeners.length; i += 1) {
    try {
      listeners[i](user);
    } catch (e) {
      /* a listener that throws must not stop the others */
    }
  }
}

async function load() {
  if (cached) return cached;
  if (!loading) {
    loading = (async () => {
      try {
        const raw = await AsyncStorage.getItem(TOKEN_KEY);
        if (!raw) return null;
        const saved = JSON.parse(raw);
        if (saved && saved.token && saved.user) return saved;
        return null;
      } catch (e) {
        // Storage unavailable or a corrupt value. Signed out is the safe answer,
        // and it is recoverable by signing in again.
        return null;
      }
    })();
  }
  const at = generation;
  const fromStorage = await loading;
  loading = null;
  if (generation === at && !cached) cached = fromStorage;
  return cached;
}

async function remember(session) {
  generation += 1;
  cached = session;
  try {
    if (session) await AsyncStorage.setItem(TOKEN_KEY, JSON.stringify(session));
    else await AsyncStorage.removeItem(TOKEN_KEY);
  } catch (e) {
    // The session still works for this run; it just will not survive a restart.
  }
  announce();
}

// ── Signing in ─────────────────────────────────────────────────────────────

/** Create an account. Returns the user. */
export async function signUp(opts) {
  const out = await request('/api/auth/signup', {
    body: {
      email: opts && opts.email,
      password: opts && opts.password,
      name: (opts && opts.name) || null,
    },
  });
  await remember({ token: out.token, user: out.user });
  return out.user;
}

/** Sign in with an email and a password. Returns the user. */
export async function signIn(opts) {
  const out = await request('/api/auth/signin', {
    body: { email: opts && opts.email, password: opts && opts.password },
  });
  await remember({ token: out.token, user: out.user });
  return out.user;
}

/**
 * Sign out on this device, and tell the server so the token stops working.
 *
 * Clearing the device only makes the token invisible here. The server would keep
 * accepting it, so a copy taken from this device still reaches the account until
 * it expires — that is the difference between signing out and hiding the key.
 */
export async function signOut() {
  const session = await load();
  const token = session && session.token;

  let revoked = false;
  if (token) {
    try {
      await request('/api/auth/signout', { token, body: {} });
      revoked = true;
    } catch (e) {
      revoked = false;
    }
  }

  // Local state goes either way: the person asked to sign out, and being
  // offline must not keep them signed in.
  await remember(null);

  // A revocation that did not happen is remembered and retried, so a token is
  // not left live for its full ninety days because the network was down.
  if (token && !revoked) await queueRevoke(token);
}

/**
 * Delete the signed-in person's account and everything stored for it, then sign
 * out on this device. Apple requires it in every app where people make an
 * account (guideline 5.1.1(v)); it cannot be undone.
 */
export async function deleteAccount() {
  const session = await load();
  const token = session && session.token;
  if (!token) {
    const none = new Error('Sign in to delete your account.');
    none.code = 'sign_in_required';
    throw none;
  }
  try {
    await request('/api/auth/delete', { token, body: {}, fallback: 'Your account could not be deleted. Try again.' });
  } catch (e) {
    if (e && e.code === 'sign_in_required') await remember(null);
    // The answer was lost, not refused: the line can drop after the server has
    // deleted the account. Ask whether it still knows this session.
    if (e && e.code === 'network' && (await sessionGone(token))) {
      await remember(null);
      return true;
    }
    throw e;
  }
  // Only after the server said yes. Forgetting first would show a deleted
  // account to someone whose account is still there.
  await remember(null);
  return true;
}

async function sessionGone(token) {
  try {
    await request('/api/auth/me', { token, body: {} });
    return false;
  } catch (e) {
    return !!e && e.code === 'sign_in_required';
  }
}

// ── the revocation queue ───────────────────────────────────────────────────

async function readQueue() {
  let raw = null;
  try {
    raw = await AsyncStorage.getItem(PENDING_REVOKE_KEY);
  } catch (e) {
    return [];
  }
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (Array.isArray(list)) return list.filter((t) => typeof t === 'string' && t);
    if (typeof list === 'string' && list) return [list];
  } catch (e) {
    /* fall through */
  }
  return [];
}

// Every read-change-write on the queue goes through here, one at a time: both
// paths touch the same key and both await in the middle, so a sign-out failing
// while a retry walks the list could otherwise drop a token.
let queueLock = Promise.resolve();
function withQueue(change) {
  const next = queueLock.then(async () => {
    const list = await readQueue();
    const updated = await change(list);
    try {
      // A ceiling, so a device offline for months does not carry an unbounded
      // list. The oldest go first; they are closest to expiring anyway.
      if (updated.length) await AsyncStorage.setItem(PENDING_REVOKE_KEY, JSON.stringify(updated.slice(-20)));
      else await AsyncStorage.removeItem(PENDING_REVOKE_KEY);
    } catch (e) {
      /* nothing to do about storage being full */
    }
  });
  queueLock = next.catch(() => {});
  return next;
}

async function queueRevoke(token) {
  await withQueue(async (list) => {
    if (list.indexOf(token) < 0) list.push(token);
    return list;
  });
}

// Retry a revocation that could not be delivered. Called on launch by
// onAuthChange, which the Back Panel sets up at the top.
async function flushPendingRevoke() {
  const attempted = await readQueue();
  if (!attempted.length) return;

  const delivered = [];
  for (let i = 0; i < attempted.length; i += 1) {
    try {
      await request('/api/auth/signout', { token: attempted[i], body: {} });
      delivered.push(attempted[i]);
    } catch (e) {
      // Still no network for this one. It stays for the next launch.
    }
  }

  // Re-read rather than writing the list this started from: a sign-out that
  // failed while these calls were in flight has already added its token.
  await withQueue(async (current) => current.filter((t) => delivered.indexOf(t) < 0));
}

// ── reading the session ────────────────────────────────────────────────────

/** Who is signed in, or null. Safe to call on every render. */
export async function currentUser() {
  const session = await load();
  return session ? session.user : null;
}

/** The session token, or null. lib/db.js uses this; screens should not need it. */
export async function getToken() {
  const session = await load();
  return session ? session.token : null;
}

/**
 * Called with the user (or null) whenever it changes. Returns an unsubscribe.
 * Call it from a top-level effect so the whole app re-renders on sign-out.
 */
export function onAuthChange(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.push(fn);
  // Every app calls this once at the top, which makes it the reliable moment to
  // finish a sign-out the network interrupted.
  flushPendingRevoke();
  load().then((s) => {
    try {
      fn(s ? s.user : null);
    } catch (e) {
      /* ignore */
    }
  });
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/** True when this error is the API saying "nobody is signed in". */
export function isSignInRequired(err) {
  return !!(err && err.code === 'sign_in_required');
}

export default {
  signUp,
  signIn,
  signOut,
  deleteAccount,
  currentUser,
  getToken,
  onAuthChange,
  isSignInRequired,
};
