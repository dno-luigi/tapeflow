// Wron AI — talks to the app owner's primary AI provider through Wron.
// The key below is a public app identifier, not a secret: it says which app is
// calling. The real provider key lives on the server and never ships here.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, Alert } from 'react-native';

// Required at module scope, but GUARDED. The handler below has to be set before
// any notification arrives, so this cannot be deferred into a function — and a
// bare top-level import cannot be used either: this file is imported by every
// app, and in a preview where expo-notifications is unavailable an unresolvable
// import takes the entire bundle down before a single screen renders.
let Notifications = null;
try {
  Notifications = require('expo-notifications');
} catch (e) {
  Notifications = null;
}

const BASE = 'https://www.wron.ai/api/agent/deac5386e6bf253c461d2004';
const APP_KEY = 'wron_app_cnY752qxV7rQf8rhkqIsdsRQ2J4lRjaEdPp9cUfc3lc';
const PUSH_TOKEN_KEY = 'wron.pushToken.deac5386e6bf253c461d2004';

// A stable per-install id, so one device cannot be mistaken for the whole app
// when limits are applied. Anonymous: random, never a user identity.
let deviceId = null;
async function device() {
  if (deviceId) return deviceId;
  try {
    let v = await AsyncStorage.getItem('wron.device');
    if (!v) {
      v = String(Date.now()) + Math.random().toString(36).slice(2, 10);
      await AsyncStorage.setItem('wron.device', v);
    }
    deviceId = v;
  } catch (e) {
    deviceId = 'anon';
  }
  return deviceId;
}

// Vision and scraping are genuinely slow — 10 to 30 seconds is normal — so the
// ceiling is generous. But it MUST exist: a fetch with no timeout against an
// unreachable server does not fail, it hangs, and the screen shows a spinner
// forever with nothing to retry. Seen on a real phone 2026-09-19, where the
// device could not reach the dev machine and the app simply sat at 'Identifying'.
var REQUEST_TIMEOUT_MS = 45000;

async function post(path, body, timeoutMs) {
  var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs || REQUEST_TIMEOUT_MS) : null;
  var res;
  try {
    res = await fetch(BASE + path, {
      method: 'POST',
      // X-Wron-Client: this client was written for the owner's main AI provider, not only OpenAI.
      headers: { 'Content-Type': 'application/json', 'X-Wron-Key': APP_KEY, 'X-Wron-Device': await device(), 'X-Wron-Client': '2' },
      body: JSON.stringify(body),
      signal: controller ? controller.signal : undefined,
    });
  } catch (e) {
    if (timer) clearTimeout(timer);
    // Aborted, offline, or the server is not reachable from this device — all
    // the same to the person holding the phone, and all need a retry, not a spinner.
    var aborted = e && (e.name === 'AbortError' || String(e.message || '').indexOf('Abort') >= 0);
    throw new Error(aborted ? 'That took too long. Check your connection and try again.' : 'Could not reach the server. Check your connection and try again.');
  }
  if (timer) clearTimeout(timer);
  const json = await res.json().catch(function () { return {}; });
  if (!res.ok || !json.ok) throw new Error(json.details || json.error || 'AI request failed');
  return json;
}

// ── Asking before anything goes to an AI ──────────────────────────────────
// Apple wants an app to say when what people send goes to a third-party AI, and
// to ask first (App Store review guideline 5.1.2(i)). Asked once, before the
// first AI request, and kept on the phone; "Not now" is not kept, so the next
// try asks again. Not in the web preview: Apple never sees it, and a dialog
// there either does nothing or is blocked.
var AI_CONSENT_KEY = 'wron.aiConsent';
var AI_CONSENT_YES = /^(1|true|yes|allow|allowed|granted|accepted|agreed)$/i;
var aiConsentGiven = false;
var aiConsentAsking = null;

// Resolves true once the person allows it. Call it at a moment that suits the
// app (an onboarding step, say); otherwise the first AI request asks.
export async function askAiConsent() {
  if (aiConsentGiven || Platform.OS === 'web' || typeof Alert === 'undefined' || !Alert || typeof Alert.alert !== 'function') return true;
  try {
    var saved = await AsyncStorage.getItem(AI_CONSENT_KEY);
    if (saved && AI_CONSENT_YES.test(String(saved).trim())) { aiConsentGiven = true; return true; }
  } catch (e) {}
  if (!aiConsentAsking) {
    aiConsentAsking = new Promise(function (resolve) {
      Alert.alert(
        'Before you use AI',
        'To answer you, what you type, and any photo or recording you add, is sent to an AI service. It is not sold or used for ads.',
        [
          { text: 'Not now', style: 'cancel', onPress: function () { resolve(false); } },
          { text: 'Allow', onPress: function () { resolve(true); } },
        ],
        { cancelable: true, onDismiss: function () { resolve(false); } }
      );
    }).then(async function (yes) {
      aiConsentAsking = null;
      if (yes) {
        aiConsentGiven = true;
        try { await AsyncStorage.setItem(AI_CONSENT_KEY, 'allowed'); } catch (e) {}
      }
      return yes;
    });
  }
  return aiConsentAsking;
}

async function consented() {
  if (!(await askAiConsent())) throw new Error('This needs your OK to use AI. Try again and choose Allow.');
}

// One structured task. Pass a JSON schema and the answer matches it.
// `image` is a data URL ("data:image/jpeg;base64,...") — send a photo and the
// model can see it.
export async function act(opts) {
  await consented();
  const json = await post('/act', {
    instruction: opts.instruction,
    input: opts.input,
    image: opts.image,
    schema: opts.schema,
    alias: opts.alias || (opts.image ? 'vision' : 'fast'),
    maxTokens: opts.maxTokens,
  });
  return json.data;
}

// A conversational turn. messages: [{ role: 'user' | 'assistant', content: '...' }]
export async function chat(messages, opts) {
  await consented();
  const json = await post('/chat', {
    messages: messages,
    system: (opts && opts.system) || undefined,
    alias: (opts && opts.alias) || 'fast',
    maxTokens: (opts && opts.maxTokens) || undefined,
  });
  return json.reply;
}

// Read one public page as markdown. The app owner declares which domains their
// app may read; anything else is refused by the server.
export async function scrape(url) {
  const json = await post('/scrape', { url: url });
  return json.data;
}

// Web search. Returns [{ title, url, description }].
export async function search(query, opts) {
  const json = await post('/search', { query: query, limit: (opts && opts.limit) || 5 });
  return json.data;
}

// Perplexity Search API, when the app owner connected that account.
export async function research(query, opts) {
  await consented();
  const json = await post('/research', { query: query, limit: (opts && opts.limit) || 5 });
  return json.data;
}

// ElevenLabs voice features, when the app owner connected that account.
// Returns { audioBase64, mimeType }; write the bytes to a local file for playback.
export async function speak(text, voiceId) {
  await consented();
  const json = await post('/speech', { action: 'speak', text: text, voiceId: voiceId });
  return json.data;
}

// Pass base64 from a recorder and its MIME type. Returns the transcript text.
export async function transcribe(audioBase64, mimeType) {
  await consented();
  const json = await post('/speech', { action: 'transcribe', audioBase64: audioBase64, mimeType: mimeType }, 70000);
  return json.data.text;
}

// OpenAI image generation, when the app owner connected that account.
// Returns a data URL suitable for an Image source or for saving locally.
export async function generateImage(prompt) {
  await consented();
  const json = await post('/image', { prompt: prompt }, 100000);
  return json.data.image;
}

// ── Notifications ──────────────────────────────────────────────────────────
// Set at MODULE SCOPE, on purpose. Expo's docs are explicit: "The default
// behavior when the handler is not set or does not respond in time is NOT to
// show the notification." Set it lazily and the first notification of a session
// is silently dropped — the app looks broken and nothing is logged.
// shouldShowAlert is deprecated; banner and list replaced it.
if (Notifications && Notifications.setNotificationHandler) {
  Notifications.setNotificationHandler({
    handleNotification: async function () {
      return {
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      };
    },
  });
}

// One place to say why a reminder cannot be set, rather than a null crash.
function requireNotifications() {
  if (!Notifications) throw new Error('Reminders are not available in this preview');
  return Notifications;
}

// Android 13+ shows no permission prompt until a channel exists, so this must
// run BEFORE requesting — not after, which asks for a permission the user is
// never offered. A no-op on iOS.
async function ensureChannel() {
  if (Platform.OS !== 'android' || !Notifications) return;
  try {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  } catch (e) {}
}

function iosProvisional(perm) {
  return !!(perm && perm.ios && perm.ios.status === Notifications.IosAuthorizationStatus.PROVISIONAL);
}

export async function askNotificationPermission() {
  if (!Notifications) return false;
  try {
    await ensureChannel();
    const current = await Notifications.getPermissionsAsync();
    // iOS permissions are granular: provisional counts as allowed.
    if (current.granted || iosProvisional(current)) return true;
    if (current.canAskAgain === false) return false;
    const asked = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    return !!asked.granted || iosProvisional(asked);
  } catch (e) {
    return false;
  }
}

// Turn the thing an app naturally has into a trigger expo actually accepts.
// Every schedulable trigger needs an explicit type field — the old bare
// { hour, minute, repeats } shape is not valid input.
function toTrigger(when) {
  const T = requireNotifications().SchedulableTriggerInputTypes;
  if (when instanceof Date) return { type: T.DATE, date: when };
  if (typeof when === 'number') {
    // A timestamp in the future, or a number of seconds from now.
    if (when > 1000000000000) return { type: T.DATE, date: new Date(when) };
    return { type: T.TIME_INTERVAL, seconds: Math.max(1, Math.round(when)) };
  }
  if (when && typeof when === 'object') {
    if (when.type) return when; // already a real trigger
    if (when.date) return { type: T.DATE, date: when.date instanceof Date ? when.date : new Date(when.date) };
    if (when.weekday != null) return { type: T.WEEKLY, weekday: when.weekday, hour: when.hour || 0, minute: when.minute || 0 };
    if (when.hour != null) return { type: T.DAILY, hour: when.hour, minute: when.minute || 0 };
    if (when.seconds != null) {
      // iOS ignores a repeating interval under 60 seconds.
      const secs = Math.max(when.repeats ? 60 : 1, Math.round(when.seconds));
      return { type: T.TIME_INTERVAL, seconds: secs, repeats: !!when.repeats };
    }
  }
  return null;
}

// Schedule a local reminder. `when` may be a Date, a number of seconds, or
// { hour, minute } / { weekday, hour, minute } for a repeat.
// Returns the identifier — keep it so you can cancel this one later.
export async function scheduleReminder(a, b, c) {
  requireNotifications();
  // Forgiving on purpose. A positional (title, body, when) is unmemorable, and
  // a real app has an id plus a payload — so calls arrive as
  // scheduleReminder({ title, body, when }) or
  // scheduleReminder(someId, date, { title, body, when }) just as often.
  // Measured 2026-09-19: a generated plant app called the third shape, every
  // reminder threw, and the app looked broken. An API that only accepts one
  // spelling is an API that gets called wrongly.
  let title = null, body = null, when = null;
  const pick = function (o) {
    if (!o || typeof o !== 'object' || o instanceof Date) return;
    if (title == null && typeof o.title === 'string') title = o.title;
    if (body == null && typeof o.body === 'string') body = o.body;
    if (when == null && (o.when != null || o.date != null || o.trigger != null)) when = o.when != null ? o.when : (o.date != null ? o.date : o.trigger);
    if (when == null && (o.hour != null || o.seconds != null || o.weekday != null || o.type != null)) when = o;
  };
  pick(a); pick(b); pick(c);
  // Anything left that looks like a time, in the order it was passed.
  for (const v of [a, b, c]) {
    if (when == null && (v instanceof Date || typeof v === 'number')) when = v;
  }
  if (title == null && typeof a === 'string' && !(b instanceof Date)) title = a;
  if (body == null && typeof b === 'string') body = b;
  if (when == null) when = c != null ? c : b;

  const trigger = toTrigger(when);
  if (!trigger) throw new Error('Could not work out when to remind you');
  const ok = await askNotificationPermission();
  if (!ok) throw new Error('Notifications are turned off');
  return Notifications.scheduleNotificationAsync({
    content: { title: title || 'Reminder', body: body || '' },
    trigger: trigger,
  });
}

export async function cancelReminder(id) {
  if (!Notifications) return;
  try {
    if (id) return await Notifications.cancelScheduledNotificationAsync(id);
    return await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (e) {}
}

// What is currently scheduled. Useful for a settings screen that should show
// the truth rather than what the app believes it did.
export async function scheduledReminders() {
  if (!Notifications) return [];
  try {
    return await Notifications.getAllScheduledNotificationsAsync();
  } catch (e) {
    return [];
  }
}

// Register this install for REMOTE pushes. Needs a real device — a simulator
// has no APNs token — and returns null where that is not possible, so callers
// must handle null rather than assume it worked.
export async function registerForPush() {
  if (!Notifications) return null;
  try {
    const Device = require('expo-device');
    if (Device && Device.isDevice === false) return null;
    const ok = await askNotificationPermission();
    if (!ok) return null;
    // projectId is required; without it getExpoPushTokenAsync throws.
    const Constants = require('expo-constants').default;
    const projectId =
      (Constants && Constants.expoConfig && Constants.expoConfig.extra && Constants.expoConfig.extra.eas && Constants.expoConfig.extra.eas.projectId) ||
      (Constants && Constants.easConfig && Constants.easConfig.projectId) ||
      null;
    if (!projectId) return null;
    const t = await Notifications.getExpoPushTokenAsync({ projectId: projectId });
    const token = t && t.data ? t.data : null;
    if (!token) return null;
    await post('/push/register', { token: token, platform: Platform.OS });
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
    return token;
  } catch (e) {
    return null;
  }
}

// Stop Wron campaigns for this install when the user turns them off.
export async function unregisterForPush() {
  try {
    const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    if (!token) return;
    await post('/push/unregister', { token: token });
    await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
  } catch (e) {
    // Keep the token locally so a later opt-out attempt can retry.
  }
}

export default {
  act: act, chat: chat, scrape: scrape, search: search, research: research,
  speak: speak, transcribe: transcribe, generateImage: generateImage,
  askAiConsent: askAiConsent,
  askNotificationPermission: askNotificationPermission,
  scheduleReminder: scheduleReminder, cancelReminder: cancelReminder,
  scheduledReminders: scheduledReminders,
  registerForPush: registerForPush,
  unregisterForPush: unregisterForPush,
};
