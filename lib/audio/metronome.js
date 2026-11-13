// A click track, so the TEMPO knob controls something you can hear.
//
// The scheduler is the ordinary one: a coarse timer wakes every 25ms and hands
// WebAudio the exact times of the beats falling inside the next 120ms. Scheduling
// the clicks ahead in the audio clock keeps them from drifting with the timer that
// schedules them, which is what a bare setInterval sounds like after a minute.
//
// No browser is needed to test the arithmetic here: the beat length and the BPM
// limits are pure functions, and the audio only exists once startClick is called.

export const BPM_MIN = 40;
export const BPM_MAX = 240;
export const DEFAULT_BPM = 96;

/** A BPM the deck can keep time to, whatever the key gives it. */
export function clampBpm(value) {
  // Number(null) is 0, and 0 BPM clamps to the slowest tempo instead of meaning
  // "no tempo set" — the same trap a half-set loop point fell into.
  if (value === null || value === undefined || value === '') return DEFAULT_BPM;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_BPM;
  return Math.max(BPM_MIN, Math.min(BPM_MAX, n));
}

/** Seconds per beat at this tempo. */
export function beatSeconds(bpm) {
  return 60 / clampBpm(bpm);
}

let live = null;

export function stopClick() {
  const state = live;
  if (!state) return;
  live = null;
  try { clearInterval(state.timer); } catch (e) { /* already gone */ }
  try { state.ctx.close(); } catch (e) { /* already gone */ }
}

export function clickRunning() {
  return !!live;
}

/**
 * Start clicking at `bpm`, replacing any click already running.
 * Returns false when the platform has no audio context to schedule against.
 */
export function startClick(bpm) {
  stopClick();
  const Ctor = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
  if (!Ctor) return false;
  let ctx;
  try {
    ctx = new Ctor({ latencyHint: 'interactive' });
  } catch (e) {
    return false;
  }
  const state = { ctx, timer: null, next: ctx.currentTime + 0.1, beat: 0 };
  live = state;
  const tick = (at, accent) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = accent ? 1760 : 1174;
    // A short, dry tick: it has to sit under a performance, not over it.
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(0.35, at + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0005, at + 0.035);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.05);
  };
  state.timer = setInterval(() => {
    if (live !== state) return;
    const step = beatSeconds(bpm);
    while (state.next < ctx.currentTime + 0.12) {
      tick(state.next, state.beat === 0);
      state.next += step;
      state.beat = (state.beat + 1) % 4;
    }
  }, 25);
  if (ctx.state === 'suspended') {
    try { ctx.resume(); } catch (e) { /* the key press is the gesture */ }
  }
  return true;
}
