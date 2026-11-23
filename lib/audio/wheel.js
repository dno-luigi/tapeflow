// What the reel is asking the deck to do.
//
// The reel is the transport, not a speed dial: a hand on it sets the speed at that
// moment. Turn it at the song's own pace and it plays at its own pace; turn it
// faster and it plays faster; turn it slowly and it still plays, slow and pitched
// down. Spinning a stopped deck sounds too — it had been silent unless Play was
// pressed, which is not how a wheel feels.
//
// This is a homage to the field recorder's motorised wheel, not a simulation of a
// tape: the wheel is a digital controller and the music is files. So the rule here
// is about the wheel, not about a transport. A hand on the reel is heard in every
// mode, fast-forward and rewind included; the keys only decide where the head
// goes when no hand is on it. Nothing is muted because a tape would have been.
//
// Fast is never silent: past the element's limit the rate is clamped, because a
// hand spinning harder should sound faster, not like a deck that has given up.
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
// A wind key is a button, not a switch: it goes down at a walking pace, and the
// longer it is held the faster the tape runs, up to the top. A tap winds for a
// moment; holding is how the head is walked to the end of the reel.
export const WIND_START = DEG_PER_SEC_AT_1X * 2; // 2x when the key goes down
export const WIND_TOP = DEG_PER_SEC_AT_1X * 12; // 12x once it has been held
export const WIND_RAMP = 1.8; // seconds to reach the top

/** How fast a held wind key moves the tape, from how long it has been down. */
export function windSpeed(heldMs) {
  const held = Number(heldMs);
  const k = Number.isFinite(held) ? Math.max(0, Math.min(1, held / (WIND_RAMP * 1000))) : 0;
  // Squared, so the first moment of the hold is calm and the climb comes later.
  return WIND_START + (WIND_TOP - WIND_START) * k * k;
}

export const SETTING_MIN = 0.5; // the speed control's floor, unchanged
export const SETTING_MAX = 2; // and its ceiling
export const LIVE_MIN = 0.12; // a transport starting up is briefly slow: it is not yet heard

/**
 * How fast the reel returns to the transport's speed once the hand lets go.
 *
 * Half of the fun of the wheel is in the let-go, so it is a setting rather than a
 * constant: 0% stops dead in a tenth of a second, 100% coasts for a couple of
 * seconds, and 50% is the feel the deck shipped with. The rates are exponential
 * decays per second; `speeding` is getting up to speed, `slowing` coming back
 * down, `holding` a hand that is on the reel but has stopped moving.
 */
export function settleRates(percent) {
  const asked = Number(percent);
  const p = Number.isFinite(asked) ? Math.max(0, Math.min(100, asked)) : 50;
  // A quarter of the standard time constant at 0%, four times it at 100%.
  const mul = Math.pow(4, (p - 50) / 50);
  return { slowing: 1.4 / mul, speeding: 5 / mul, holding: 3 / mul };
}

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
  // How fast a hard spin may take the tape. The deck sets this; the default is the
  // starting point, not the law.
  const asked = Number(opts.ceiling);
  const top = Number.isFinite(asked) && asked > 1 ? Math.min(ELEMENT_MAX, asked) : HAND_CEILING;
  const speed = (Number(opts.vel) || 0) / base;
  const magnitude = Math.abs(speed);
  const hand = opts.dragging === true;
  const live = opts.mode === 'play' || opts.mode === 'rec';
  // The wheel is the instrument in every mode. Fast-forward and rewind move the head
  // when the hand is off, but a hand on the reel sounds whatever key is down: there
  // is no reason a digital wheel has to go quiet because a key is held.
  const driven = hand && magnitude >= HAND_MIN;
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
      ? 1 + (top - 1) * Math.tanh((magnitude - 1) / (top - 1))
      : magnitude;
  const ceiling = driven ? top : SETTING_MAX;
  const floor = driven ? HAND_MIN : SETTING_MIN;
  const shown = Math.min(ceiling, Math.max(floor, shaped));
  return { playing: true, rate: speed < 0 ? -shown : shown, magnitude: shown, hand: driven };
}

export default {
  wheelTransport,
  settleRates,
  windSpeed,
  DEG_PER_SEC_AT_1X,
  HAND_MIN,
  HAND_MAX,
  HAND_CEILING,
  ELEMENT_MIN,
  ELEMENT_MAX,
  SETTING_MIN,
  SETTING_MAX,
};
