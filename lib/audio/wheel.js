// What the reel is asking the tape to do.
//
// The reel is the transport, not a speed dial: a hand on it sets the speed at that
// moment. Turn it at the song's own pace and the tape runs at its own pace; turn it
// faster and it plays faster; turn it slowly and it still plays, slow and pitched
// down, because that is what a hand-dragged tape does. Spinning a stopped tape
// sounds too — the deck had been silent unless Play was pressed, which is not how
// a reel feels.
//
// It is pure so it can be tested without a browser: this rule decides whether
// anything is heard at all, and a floor that is too high is a wheel that appears
// broken at slow speeds.
export const DEG_PER_SEC_AT_1X = 120; // one turn every three seconds is the tape's own speed
// The slowest and fastest a browser's media element will play. A hand can ask for
// less than this, but nothing would come out of the speaker, so these are the
// edges of the hand's range — and the mixer must not be tighter than they are.
export const ELEMENT_MIN = 0.0625;
export const ELEMENT_MAX = 4;
export const HAND_MIN = ELEMENT_MIN; // below this the hand is holding the tape still
export const HAND_MAX = ELEMENT_MAX; // a fast flick is a fast, pitched-up tape
export const SETTING_MIN = 0.5; // the speed control's floor, unchanged
export const SETTING_MAX = 2; // and its ceiling
export const LIVE_MIN = 0.12; // a transport starting up is briefly slow: it is not yet heard

/**
 * { mode, dragging, vel } -> { playing, rate, magnitude, hand }
 *
 * `vel` is degrees per second of the reel. `rate` is signed, and is what the takes
 * are played at — zero when nothing should sound.
 */
export function wheelTransport(input) {
  const opts = input || {};
  const speed = (Number(opts.vel) || 0) / DEG_PER_SEC_AT_1X;
  const magnitude = Math.abs(speed);
  const hand = opts.dragging === true;
  const live = opts.mode === 'play' || opts.mode === 'rec';
  // Fast-forward and rewind are spooling, not listening: the hand does not make
  // those audible.
  const spooling = opts.mode === 'ff' || opts.mode === 'rew';
  const driven = hand && !spooling && magnitude >= HAND_MIN;
  const playing = driven || (live && !hand && magnitude > LIVE_MIN);

  if (!playing) return { playing: false, rate: 0, magnitude: 0, hand: driven };

  // A hand may go slower than the speed control allows and faster than it, because
  // a hand is not a setting. Without a hand, the control's range is the range.
  const ceiling = driven ? HAND_MAX : SETTING_MAX;
  const floor = driven ? HAND_MIN : SETTING_MIN;
  const shown = Math.min(ceiling, Math.max(floor, magnitude));
  return { playing: true, rate: speed < 0 ? -shown : shown, magnitude: shown, hand: driven };
}

export default {
  wheelTransport,
  DEG_PER_SEC_AT_1X,
  HAND_MIN,
  HAND_MAX,
  ELEMENT_MIN,
  ELEMENT_MAX,
  SETTING_MIN,
  SETTING_MAX,
};
