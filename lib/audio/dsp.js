// Changing a take's speed and key without changing the other.
//
// A tape does both at once: turn it faster and the voice rises with it, which is
// exactly what the hand on the reel does. A speed changer — the thing this adds —
// is the opposite: change the speed and leave the key where it is, or move the
// key and leave the speed where it is.
//
// Resampling alone can only do one of those (it changes both together), so the
// key change is resampling plus a time stretch that puts the length back, and a
// pitch-locked speed change is a time stretch on its own. The stretch is WSOLA:
// overlapping windows, each placed where the audio actually continues from the
// one before it, which is what stops it sounding like a flanger.
//
// Everything here works on plain channel arrays, so the same code renders the
// live key change and the exported file.

const WINDOW = 2048;
// Half a window of overlap: every output sample is covered by exactly two
// windows, so the crossfade is smooth and the cost stays low.
const HOP = WINDOW / 2;
// How far the alignment search may move a window from its nominal place, and how
// coarsely it looks. 16-sample steps are inaudible in the result and keep a
// three-minute take to a fraction of a second of work.
const SEARCH = 512;
const SEARCH_STEP = 16;
const CORR_STRIDE = 8;

// A Hann window, built once.
const fit = (() => {
  const w = new Float32Array(WINDOW);
  for (let i = 0; i < WINDOW; i += 1) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WINDOW);
  return w;
})();

/**
 * Resample by `ratio` (2 = twice as fast and an octave up). Linear interpolation:
 * the takes are already at the device's rate, and this is used at the edges of a
 * pitch shift rather than as the whole answer.
 */
export function resample(channels, ratio) {
  const r = Math.max(0.01, Number(ratio) || 1);
  const inLen = channels[0] ? channels[0].length : 0;
  const outLen = Math.max(1, Math.floor(inLen / r));
  return channels.map((src) => {
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i += 1) {
      const p = i * r;
      const i0 = Math.floor(p);
      const f = p - i0;
      const a = src[i0] || 0;
      const b = i0 + 1 < src.length ? src[i0 + 1] : a;
      out[i] = a + (b - a) * f;
    }
    return out;
  });
}

// Nearest window start to `nominal` whose audio best continues the stretch at
// `natural`, the point the previous window's tail was heading for.
function alignStart(ref, natural, nominal, inLen) {
  let best = nominal;
  let bestScore = -Infinity;
  for (let delta = -SEARCH; delta <= SEARCH; delta += SEARCH_STEP) {
    const cand = nominal + delta;
    if (cand < 0 || cand + WINDOW >= inLen) continue;
    let num = 0;
    let den = 0;
    for (let i = 0; i < HOP; i += CORR_STRIDE) {
      const a = ref[natural + i] || 0;
      const b = ref[cand + i] || 0;
      num += a * b;
      den += b * b;
    }
    const score = den > 1e-9 ? num / Math.sqrt(den) : 0;
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  return best;
}

/**
 * Change the duration without changing the pitch. `ratio` is the new length over
 * the old one: 2 is twice as long, 0.5 is half.
 */
export function timeStretch(channels, ratio) {
  const r = Math.max(0.05, Math.min(20, Number(ratio) || 1));
  const inLen = channels[0] ? channels[0].length : 0;
  if (!inLen) return channels.map(() => new Float32Array(0));
  const outLen = Math.max(1, Math.round(inLen * r));
  const analyseHop = Math.max(1, Math.round(HOP / r));
  const ref = channels[0];

  const out = channels.map(() => new Float32Array(outLen));
  const norm = new Float32Array(outLen);

  let prevStart = -1;
  for (let n = 0; ; n += 1) {
    const at = n * HOP;
    if (at >= outLen) break;
    const nominal = Math.min(n * analyseHop, Math.max(0, inLen - WINDOW));
    const natural = prevStart >= 0 ? Math.min(prevStart + HOP, Math.max(0, inLen - WINDOW)) : nominal;
    const start = prevStart >= 0 ? alignStart(ref, natural, nominal, inLen) : nominal;

    for (let c = 0; c < channels.length; c += 1) {
      const src = channels[c];
      const dst = out[c];
      const count = Math.min(WINDOW, outLen - at);
      for (let i = 0; i < count; i += 1) {
        const p = start + i;
        if (p < 0 || p >= inLen) continue;
        dst[at + i] += src[p] * fit[i];
      }
    }
    const count = Math.min(WINDOW, outLen - at);
    for (let i = 0; i < count; i += 1) norm[at + i] += fit[i];
    prevStart = start;
  }

  // Undo the window overlap so the level is the original level.
  for (let c = 0; c < channels.length; c += 1) {
    const dst = out[c];
    for (let i = 0; i < outLen; i += 1) {
      const w = norm[i];
      if (w > 1e-4) dst[i] /= w;
    }
  }
  return out;
}

/**
 * Move the key by whole semitones, leaving the duration alone.
 * Two steps: resample (which moves the pitch and the length together) and then
 * stretch the length back to where it was.
 */
export function pitchShift(channels, semitones) {
  const s = Math.max(-24, Math.min(24, Math.round(Number(semitones) || 0)));
  if (!s) return channels;
  const ratio = Math.pow(2, s / 12);
  return timeStretch(resample(channels, ratio), ratio);
}

export default { resample, timeStretch, pitchShift };
