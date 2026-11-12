// What the reel is asking the tape to do.
//
// The reel is the transport, not a speed dial: a hand on it sets the speed at that
// moment. Turn it at the song's own pace and the tape runs at its own pace; turn it
// faster and it plays faster; turn it slowly and it still plays, slow and pitched
// down, because that is what a hand-dragged tape does. Spinning a stopped tape
// sounds too — the deck had been silent unless Play was pressed, which is not how
// a reel feels.
//
// Fast is never silent: past the element's limit the rate is clamped, because a
// hand spinning harder should sound like a tape running faster, not like a deck
// that has given up.
//
// It is pure so it can be tested without a browser: this rule decides whether
// anything is heard at all, and a floor or a ceiling in the wrong place is a wheel
// that appears broken.
// One turn of the reel per second is the tape's own speed. That is a quick,
// comfortable turn rather than a slow crank: turning at the song's pace should
// play at the song's pace, and a hand has more travel in it than the old
// three-seconds-per-turn calibration assumed — at that rate a normal spin was
// already twice the speed and hit the ceiling.
export const DEG_PER_SEC_AT_1X = 360;
// The slowest and fastest a browser's media element will play. A hand can ask for
// less than the slowest, but nothing would come out of the speaker, so these are
// the edges of the hand's range — and the mixer must not be tighter than they are.
// The top is far above a hand's reach, so spinning faster clamps the speed instead
// of dropping the sound: a tape does not go quiet because you spun it hard.
export const ELEMENT_MIN = 0.0625;
export const ELEMENT_MAX = 8;
export const HAND_MIN = ELEMENT_MIN; // below this the hand is holding the tape still
export const HAND_MAX = ELEMENT_MAX; // a fast flick is a fast, pitched-up tape
// How fast a hard spin can take the tape. Past the tape's own speed the hand gets
// diminishing returns, so spinning harder still speeds it up but approaches this
// instead of running away: a hand on a reel, not a fling. It is well inside the
// element's range, so the top of the hand's travel is always heard.
export const HAND_CEILING = 3;
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
  // How many degrees a turn needs for 1x is a feel, not a fact: the deck passes its
  // own sensitivity, and the default is only the starting point.
  const base =
    Number.isFinite(opts.degPerSecAt1x) && opts.degPerSecAt1x > 0
      ? opts.degPerSecAt1x
      : DEG_PER_SEC_AT_1X;
  const speed = (Number(opts.vel) || 0) / base;
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
  //
  // Above the tape's own speed the hand's result is compressed rather than linear:
  // at 1x it is exactly the hand's speed, and from there it climbs towards the
  // ceiling instead of doubling with every flick. Up to 1x the mapping is untouched,
  // so the calibration — a turn at the song's pace plays at the song's pace — stays
  // exact.
  const shaped =
    driven && magnitude > 1
      ? 1 + (HAND_CEILING - 1) * Math.tanh((magnitude - 1) / (HAND_CEILING - 1))
      : magnitude;
  const ceiling = driven ? HAND_CEILING : SETTING_MAX;
  const floor = driven ? HAND_MIN : SETTING_MIN;
  const shown = Math.min(ceiling, Math.max(floor, shaped));
  return { playing: true, rate: speed < 0 ? -shown : shown, magnitude: shown, hand: driven };
}

export default {
  wheelTransport,
  DEG_PER_SEC_AT_1X,
  HAND_MIN,
  HAND_MAX,
  HAND_CEILING,
  ELEMENT_MIN,
  ELEMENT_MAX,
  SETTING_MIN,
  SETTING_MAX,
};
