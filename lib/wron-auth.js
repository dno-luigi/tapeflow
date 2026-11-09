// Wron auth. Generated - do not edit.
//
// Accounts for this app. The key below is a public app identifier, not a
// secret: it says which app is calling. Passwords are never stored on the
// device and never leave this file except over https to Wron.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Linking, Platform } from 'react-native';

// Optional, and GUARDED. expo-web-browser opens Google in a sheet the app can
// close itself, which is much better than throwing someone out to Safari. It is
// not always present - a preview may not have it - and an unresolvable import
// takes the whole bundle down before a screen renders, so it is required rather
// than imported.
var WebBrowser = null;
try {
  WebBrowser = require('expo-web-browser');
} catch (e) {
  WebBrowser = null;
}

// Apple's native sheet. Present in a real build and absent in the Expo Go
// preview, which is exactly the difference signInWithApple reports.
var AppleAuth = null;
try {
  AppleAuth = require('expo-apple-authentication');
} catch (e) {
  AppleAuth = null;
}

// Which shell this is running in. Expo Go cannot do Sign in with Apple at all:
// the bundle id there belongs to Expo, so even where the sheet appears the
// credential comes back for THEIR app rather than this one.
function inExpoGo() {
  try {
    var Constants = require('expo-constants').default;
    return !!Constants && Constants.appOwnership === 'expo';
  } catch (e) {
    return false;
  }
}

var BASE = 'https://www.wron.ai' + '/api/agent/' + 'deac5386e6bf253c461d2004';
var APP_KEY = 'wron_app_cnY752qxV7rQf8rhkqIsdsRQ2J4lRjaEdPp9cUfc3lc';
var TOKEN_KEY = 'wron.auth.token';
// The SAME key lib/wron-db.js uses, so one install is one device to the server.
// Without it every caller is the anonymous bucket, and the whole app shares one
// allowance: five sign-ups in an hour and the sixth real person is refused.
var DEVICE_KEY = 'wron.device.id';
// Tokens whose revocation could not be delivered, kept so a later launch can
// finish signing out properly. A LIST, not a slot: the server revokes by token,
// so one undelivered revocation must not be dropped because a later sign-out
// succeeded and cleared the space.
var PENDING_REVOKE_KEY = 'wron.auth.pendingRevoke';

// A sign-in is a person waiting and looking at the screen. Long enough for a
// slow network, short enough that a dead server becomes an error they can
// retry rather than a spinner with no end.
var REQUEST_TIMEOUT_MS = 20000;
// How long to wait for someone to finish with Google, including reading a
// consent screen and typing a password they had forgotten.
var GOOGLE_TIMEOUT_MS = 180000;
var POLL_INTERVAL_MS = 1500;

// The session, in memory. Read from storage once on first use; after that this
// is the answer, so no screen pays a disk read to know who is signed in.
var cached = null;
var loading = null;
var listeners = [];
// Bumped by every remember(). A read that started before a sign-in must not
// finish after it and put the old answer back: the person would be signed in
// and the app would not know it.
var generation = 0;

// A stable per-install id, shared with lib/wron-db.js so the server sees one
// device rather than two.
var devicePromise = null;
function makeDeviceId() {
  var s = '';
  var alphabet = 'abcdef0123456789';
  for (var i = 0; i < 32; i++) s += alphabet.charAt(Math.floor(Math.random() * 16));
  return s;
}
async function deviceId() {
  if (!devicePromise) {
    devicePromise = (async function () {
      try {
        var existing = await AsyncStorage.getItem(DEVICE_KEY);
        if (existing) return existing;
        var fresh = makeDeviceId();
        await AsyncStorage.setItem(DEVICE_KEY, fresh);
        return fresh;
      } catch (e) {
        return makeDeviceId();
      }
    })();
  }
  return devicePromise;
}

function announce() {
  var user = cached ? cached.user : null;
  for (var i = 0; i < listeners.length; i++) {
    try {
      listeners[i](user);
    } catch (e) {}
  }
}

async function load() {
  if (cached) return cached;
  // Started once, awaited by EVERYONE. A second caller arriving while the disk
  // is being read used to skip this block and return the still-empty cache, so
  // on a cold start one screen saw the session and another saw nobody, and a
  // database call went out signed-out and came back refused.
  if (!loading) {
    loading = (async function () {
      try {
        var raw = await AsyncStorage.getItem(TOKEN_KEY);
        if (!raw) return null;
        var saved = JSON.parse(raw);
        if (saved && saved.token && saved.user) return saved;
        return null;
      } catch (e) {
        // Storage unavailable or a corrupt value. Signed out is the safe answer,
        // and it is recoverable by signing in again.
        return null;
      }
    })();
  }
  var at = generation;
  var fromStorage = await loading;
  loading = null;
  // Only if nothing changed while the disk was being read. remember() bumps the
  // generation, so a sign-in or a sign-out that landed first wins.
  if (generation === at && !cached) cached = fromStorage;
  return cached;
}

async function remember(session) {
  generation++;
  cached = session;
  try {
    if (session) await AsyncStorage.setItem(TOKEN_KEY, JSON.stringify(session));
    else await AsyncStorage.removeItem(TOKEN_KEY);
  } catch (e) {
    // The session still works for this run; it just will not survive a restart.
  }
  announce();
}

// What went wrong, in a sentence. The sign-in wording is the default; a call that is not a sign-in
// passes its own fallback, so a failed delete never reads "That email or password is not right."
function readable(status, json, fallback) {
  if (json && json.details) return json.details;
  if (status === 429) return 'Too many attempts. Wait a minute and try again.';
  if (fallback) return fallback;
  if (status === 401) return 'That email or password is not right.';
  if (status === 409) return 'There is already an account with that email.';
  if (status === 503) return 'Accounts are not set up for this app yet.';
  return 'Could not sign you in. Try again.';
}

async function post(path, body, token, fallback) {
  var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = controller ? setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS) : null;
  var headers = { 'Content-Type': 'application/json', 'X-Wron-Key': APP_KEY, 'X-Wron-Device': await deviceId() };
  if (token) headers['X-Wron-Session'] = token;
  var res;
  try {
    res = await fetch(BASE + path, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body || {}),
      signal: controller ? controller.signal : undefined,
    });
  } catch (e) {
    if (timer) clearTimeout(timer);
    var aborted = e && (e.name === 'AbortError' || String(e.message || '').indexOf('Abort') >= 0);
    var lost = new Error(aborted ? 'That took too long. Check your connection and try again.' : 'Could not reach the server. Check your connection and try again.');
    // No answer came back, which is not the same as no: the server may have done it.
    lost.code = 'network';
    throw lost;
  }
  if (timer) clearTimeout(timer);
  var json = await res.json().catch(function () { return {}; });
  if (!res.ok || !json.ok) {
    var err = new Error(readable(res.status, json, fallback));
    err.code = (json && json.error) || 'request_failed';
    err.status = res.status;
    throw err;
  }
  return json;
}

// ── Signing in ─────────────────────────────────────────────────────────────

// Create an account. Returns the user.
export async function signUp(opts) {
  var out = await post('/auth/signup', {
    email: opts && opts.email,
    password: opts && opts.password,
    name: (opts && opts.name) || null,
  });
  await remember({ token: out.token, user: out.user });
  return out.user;
}

// Sign in with an email and a password. Returns the user.
export async function signIn(opts) {
  var out = await post('/auth/signin', { email: opts && opts.email, password: opts && opts.password });
  await remember({ token: out.token, user: out.user });
  return out.user;
}

// Sign in with Google.
//
// The whole exchange happens on Wron's own https pages and this app POLLS for
// the result. It does NOT come back through a deep link, on purpose: this app
// may be running inside Expo Go under a url it does not own, where no custom
// scheme exists and Google would refuse one anyway. Polling behaves the same
// in every place this app can run.
export async function signInWithGoogle() {
  // On an iPhone, Google opens in the system sign-in sheet and the result comes
  // back to THIS app as a one-time code, which is the only thing that can collect
  // it. Polling by request id alone let anyone who started a sign-in send its link
  // to someone else and collect THEIR session (security review, 2026-10-10). The
  // sheet works in Expo Go and in a real build, with no scheme to register.
  if (Platform.OS === 'ios' && WebBrowser && WebBrowser.openAuthSessionAsync) {
    var sheet = await post('/auth/google/start', { mode: 'session' });
    var result = await WebBrowser.openAuthSessionAsync(sheet.url, 'wronauth://google');
    if (!result || result.type !== 'success' || !result.url) throw new Error('Sign-in was cancelled.');
    var code = (String(result.url).match(/[?&]code=([^&#]+)/) || [])[1];
    if (!code) throw new Error('That sign-in did not finish. Try again.');
    var done = await post('/auth/google/poll', { requestId: sheet.requestId, code: decodeURIComponent(code) });
    if (done.status !== 'complete') throw new Error('That sign-in did not finish. Try again.');
    await remember({ token: done.token, user: done.user });
    return done.user;
  }
  var started = await post('/auth/google/start', {});
  var opened = false;
  try {
    if (WebBrowser && WebBrowser.openBrowserAsync) {
      // Not awaited: it resolves when the sheet closes, and the poll below is
      // what actually tells us the sign-in finished.
      WebBrowser.openBrowserAsync(started.url);
      opened = true;
    }
  } catch (e) {
    opened = false;
  }
  if (!opened) {
    try {
      await Linking.openURL(started.url);
    } catch (e) {
      throw new Error('Could not open the sign-in page.');
    }
  }

  var deadline = Date.now() + GOOGLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise(function (r) { setTimeout(r, POLL_INTERVAL_MS); });
    var out;
    try {
      out = await post('/auth/google/poll', { requestId: started.requestId });
    } catch (e) {
      // A blip mid-poll is not a failed sign-in. Keep waiting; the deadline is
      // what ends this, not one bad response.
      continue;
    }
    if (out.status === 'complete') {
      try {
        if (WebBrowser && WebBrowser.dismissBrowser) WebBrowser.dismissBrowser();
      } catch (e) {}
      await remember({ token: out.token, user: out.user });
      return out.user;
    }
  }
  try {
    if (WebBrowser && WebBrowser.dismissBrowser) WebBrowser.dismissBrowser();
  } catch (e) {}
  throw new Error('That sign-in did not finish. Try again.');
}

// Sign in with Apple, through the system sheet.
//
// A real build only. In the Expo Go preview this says so and stops, rather than
// failing in a way that reads like a bug in the app: the preview runs under
// Expo's own bundle id, and Apple issues its token to whichever app asked, so
// there is nothing here that could be made to work.
export async function signInWithApple() {
  if (inExpoGo() || !AppleAuth || !AppleAuth.signInAsync) {
    Alert.alert('Needs a real build', 'You need to push to TestFlight to test Sign in with Apple. It works in the built app.');
    var notHere = new Error('You need to push to TestFlight to test Sign in with Apple.');
    notHere.code = 'needs_build';
    throw notHere;
  }

  var credential;
  try {
    credential = await AppleAuth.signInAsync({
      requestedScopes: [
        AppleAuth.AppleAuthenticationScope.FULL_NAME,
        AppleAuth.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (e) {
    // The person closed the sheet. Not an error worth showing them.
    if (e && (e.code === 'ERR_REQUEST_CANCELED' || e.code === 'ERR_CANCELED')) {
      var cancelled = new Error('Sign-in cancelled.');
      cancelled.code = 'cancelled';
      throw cancelled;
    }
    throw new Error('That sign-in did not finish. Try again.');
  }

  // fullName comes back ONCE, on the very first authorization for this app, and
  // never again. It is sent with the token because this is the only moment it
  // exists anywhere.
  // authorizationCode: the server trades it for the token it revokes at Apple if this person deletes their
  // account, as Apple asks.
  var out = await post('/auth/apple', {
    identityToken: credential.identityToken,
    fullName: credential.fullName || null,
    authorizationCode: credential.authorizationCode || null,
  });
  await remember({ token: out.token, user: out.user });
  return out.user;
}

// True when signInWithApple already told the person why it stopped, so a screen
// can catch it and do nothing rather than showing a second message.
export function isHandled(err) {
  return !!(err && (err.code === 'needs_build' || err.code === 'cancelled'));
}

// Sign out on this device. Also tells the server, so the token stops working.
export async function signOut() {
  var session = await load();
  var token = session && session.token;

  // REVOKED FIRST, and awaited. Clearing the device only makes the token
  // invisible here; the server keeps accepting it, so a copy taken from this
  // device still reaches the account until it expires. That is the difference
  // between signing out and hiding the key.
  var revoked = false;
  if (token) {
    try {
      await post('/auth/signout', {}, token);
      revoked = true;
    } catch (e) {
      revoked = false;
    }
  }

  // Local state goes either way: the person asked to sign out, and being
  // offline must not keep them signed in.
  await remember(null);

  // A revocation that did not happen is remembered and retried, so a token is
  // not left live for its full ninety days because the network was down for a
  // second. Added to the list; nothing else is removed, because each token is
  // revoked separately and this one's failure says nothing about the others.
  if (token && !revoked) await queueRevoke(token);
}

// Delete the signed-in person's account and everything this app saved for them,
// then sign out on this device. Apple requires it in every app where people make
// an account (guideline 5.1.1(v)). It cannot be undone, so the screen asks first.
export async function deleteAccount() {
  var session = await load();
  var token = session && session.token;
  if (!token) {
    var none = new Error('Sign in to delete your account.');
    none.code = 'sign_in_required';
    throw none;
  }
  try {
    await post('/auth/delete', {}, token, 'Your account could not be deleted. Try again.');
  } catch (e) {
    // The server no longer knows this session, so this device is signed out
    // whatever happens next; the person signs in again to finish.
    if (e && e.code === 'sign_in_required') await remember(null);
    // The answer was lost, not refused: the line can drop after the server has
    // deleted the account. A session the server no longer knows says it did, so
    // this device signs out and reports it done rather than keeping a dead
    // session whose saves are all refused. One it still knows says it did not.
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

// Whether the server has forgotten this session (asked after a delete whose answer was lost).
async function sessionGone(token) {
  try {
    await post('/auth/me', {}, token, 'Could not check your account. Try again.');
    return false;
  } catch (e) {
    return !!e && e.code === 'sign_in_required';
  }
}

async function readQueue() {
  var raw = null;
  try {
    raw = await AsyncStorage.getItem(PENDING_REVOKE_KEY);
  } catch (e) {
    return [];
  }
  if (!raw) return [];
  try {
    var list = JSON.parse(raw);
    if (Array.isArray(list)) return list.filter(function (t) { return typeof t === 'string' && t; });
    if (typeof list === 'string' && list) return [list];
  } catch (e) {
    // An earlier build of this client wrote the token here as a bare string.
    // An app already on somebody's phone carries that shape, and reading it as
    // an empty queue would quietly drop the one revocation it was keeping.
  }
  return typeof raw === 'string' && raw.indexOf('wron_sess_') === 0 ? [raw] : [];
}

// Every read-change-write on the queue goes through here, one at a time.
//
// Both paths touch the same key and both have an await in the middle: a
// sign-out that fails while a retry is walking the list would otherwise have
// its token written and then overwritten by the retry's older copy, and that
// session stays live for its full ninety days. Serialising is enough, because
// this is one JavaScript runtime.
var queueLock = Promise.resolve();
function withQueue(change) {
  var next = queueLock.then(async function () {
    var list = await readQueue();
    var updated = await change(list);
    try {
      // A ceiling, so a device offline for months does not carry an unbounded
      // list. The oldest go first; they are closest to expiring anyway.
      if (updated.length) await AsyncStorage.setItem(PENDING_REVOKE_KEY, JSON.stringify(updated.slice(-20)));
      else await AsyncStorage.removeItem(PENDING_REVOKE_KEY);
    } catch (e) {}
  });
  // A failure in one change must not wedge every later one.
  queueLock = next.catch(function () {});
  return next;
}

async function queueRevoke(token) {
  await withQueue(async function (list) {
    if (list.indexOf(token) < 0) list.push(token);
    return list;
  });
}

// Retry a revocation that could not be delivered. Called on launch by
// onAuthChange, which every app sets up at the top.
async function flushPendingRevoke() {
  var attempted = await readQueue();
  if (!attempted.length) return;

  var delivered = [];
  for (var i = 0; i < attempted.length; i++) {
    try {
      await post('/auth/signout', {}, attempted[i]);
      delivered.push(attempted[i]);
    } catch (e) {
      // Still no network for this one. It stays for the next launch.
    }
  }

  // The queue is re-read here rather than overwritten with the list this
  // started from. A sign-out that failed while the network calls above were in
  // flight has already added its token, and writing the older list back would
  // drop it.
  await withQueue(async function (current) {
    return current.filter(function (t) { return delivered.indexOf(t) < 0; });
  });
}

// ── Reading the session ────────────────────────────────────────────────────

// Who is signed in, or null. Safe to call on every render.
export async function currentUser() {
  var session = await load();
  return session ? session.user : null;
}

// The session token, or null. lib/wron-db.js uses this; screens should not need it.
export async function getToken() {
  var session = await load();
  return session ? session.token : null;
}

// Called with the user (or null) whenever it changes. Returns an unsubscribe.
// Call it from a top-level effect so the whole app re-renders on sign-out.
export function onAuthChange(fn) {
  if (typeof fn !== 'function') return function () {};
  listeners.push(fn);
  // Every app calls this once at the top, which makes it the reliable moment to
  // finish a sign-out the network interrupted.
  flushPendingRevoke();
  load().then(function (s) {
    try {
      fn(s ? s.user : null);
    } catch (e) {}
  });
  return function () {
    var i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

// True when this error is the database saying "nobody is signed in".
// Catch it around a save and offer sign-in, rather than showing a generic failure.
export function isSignInRequired(err) {
  return !!(err && err.code === 'sign_in_required');
}

export default {
  signUp: signUp, signIn: signIn, signInWithGoogle: signInWithGoogle,
  signInWithApple: signInWithApple, signOut: signOut, deleteAccount: deleteAccount,
  currentUser: currentUser, getToken: getToken, onAuthChange: onAuthChange,
  isSignInRequired: isSignInRequired, isHandled: isHandled,
};
