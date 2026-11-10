// Local session reminders.
//
// Everything here is on the device — expo-notifications and the system clock.
// Nothing is sent anywhere, which is why it survived the move off WRON: the
// original file also carried chat, vision, transcription and push-registration
// helpers that called wron.ai, and none of those are used by the app.
import { Platform, Alert } from 'react-native';

// Required at module scope, but GUARDED: the handler has to be set before any
// notification arrives, and an unresolvable import would take the whole bundle
// down before a single screen renders.
let Notifications = null;
try {
  Notifications = require('expo-notifications');
} catch (e) {
  Notifications = null;
}

// Expo's docs are explicit: "The default behavior when the handler is not set or
// does not respond in time is NOT to show the notification." Set it lazily and
// the first notification of a session is silently dropped.
if (Notifications && Notifications.setNotificationHandler) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
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
  } catch (e) {
    /* the prompt below still tells the truth if this fails */
  }
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

/**
 * Schedule a local reminder. `when` may be a Date, a number of seconds, or
 * { hour, minute } / { weekday, hour, minute } for a repeat.
 * Returns the identifier — keep it so you can cancel this one later.
 *
 * Forgiving on purpose: calls arrive as scheduleReminder({ title, body, when })
 * or scheduleReminder(title, body, when) just as often, and an API that only
 * accepts one spelling is an API that gets called wrongly.
 */
export async function scheduleReminder(a, b, c) {
  requireNotifications();
  let title = null;
  let body = null;
  let when = null;
  const pick = (o) => {
    if (!o || typeof o !== 'object' || o instanceof Date) return;
    if (title == null && typeof o.title === 'string') title = o.title;
    if (body == null && typeof o.body === 'string') body = o.body;
    if (when == null && (o.when != null || o.date != null || o.trigger != null)) {
      when = o.when != null ? o.when : o.date != null ? o.date : o.trigger;
    }
    if (when == null && (o.hour != null || o.seconds != null || o.weekday != null || o.type != null)) when = o;
  };
  pick(a);
  pick(b);
  pick(c);
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
    trigger,
  });
}

export async function cancelReminder(id) {
  if (!Notifications) return;
  try {
    if (id) return await Notifications.cancelScheduledNotificationAsync(id);
    return await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (e) {
    return undefined;
  }
}

// What is currently scheduled. Useful for a screen that should show the truth
// rather than what the app believes it did.
export async function scheduledReminders() {
  if (!Notifications) return [];
  try {
    return await Notifications.getAllScheduledNotificationsAsync();
  } catch (e) {
    return [];
  }
}

export { Alert };
