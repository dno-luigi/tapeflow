// A take, moved in key but not in speed or length.
//
// The browser can change a media element's speed, and it can hold the pitch while
// it does (that is pitch lock), but it has no way to move the pitch on its own.
// So a key change is rendered: the take is decoded, shifted by the semitones,
// written back out as a WAV and played from there. It is rendered once per key
// and kept, so holding +/- and scrubbing does not re-render anything.
import { decodeUri, channelArrays } from './buffers';
import { pitchShift } from './dsp';
import { encodeWav } from './wav';

const cache = new Map(); // `${uri}#${semis}` -> url | 'rendering' | false

// One render at a time. Decoding a take, shifting it and writing a WAV is all
// main-thread work, and four takes rendered at once is a storm that starves the
// players — heard as the music falling over. The hand keeps the original sounding
// until its copy is ready, so a queue costs nothing but a moment.
let queue = Promise.resolve();
const after = (job) => {
  queue = queue.then(job, job).then(() => new Promise((r) => setTimeout(r, 40)));
  return queue;
};

// Renders are cached per take and key, and every one holds a whole extra copy of
// the take, so the key is quantised to five cents before it is rendered. Nobody
// hears the difference between +2.350 and +2.355, and it keeps a drag from
// filling memory with takes.
export const KEY_STEP = 0.05;

export function quantizeKey(semis) {
  const s = Math.max(-12, Math.min(12, Number(semis) || 0));
  return Math.round(s / KEY_STEP) * KEY_STEP;
}

export function keyedKey(uri, semis) {
  return uri + '#' + quantizeKey(semis).toFixed(2);
}

/** True once the pitched copy of this take at this key is ready. */
export function keyShiftReady(uri, semis) {
  const hit = cache.get(keyedKey(uri, semis));
  return typeof hit === 'string';
}

/**
 * The url to play for this take at this key, or null while it is being rendered
 * (the caller keeps playing the unshifted take until then, so the tape never
 * goes silent for it).
 */
export function shiftedUri(uri, semis) {
  const s = quantizeKey(semis);
  if (!uri || Math.abs(s) < 0.001) return uri;
  const key = keyedKey(uri, s);
  const hit = cache.get(key);
  if (typeof hit === 'string') return hit;
  if (hit) return null;

  cache.set(key, 'rendering');
  after(async () => {
    try {
      const buffer = await decodeUri(uri);
      if (!buffer) {
        cache.set(key, false);
        return;
      }
      const shifted = pitchShift(channelArrays(buffer), s);
      if (!shifted || !shifted[0]) {
        cache.set(key, false);
        return;
      }
      const blob = encodeWav(shifted, buffer.sampleRate, false);
      cache.set(key, URL.createObjectURL(blob));
    } catch (e) {
      cache.set(key, false);
    }
  })();
  return null;
}

/** Drop every rendered key for a take that was deleted. */
export function forgetKeyShifts(uri) {
  Array.from(cache.keys()).forEach((k) => {
    if (k.indexOf(uri + '#') === 0) {
      const url = cache.get(k);
      if (typeof url === 'string') {
        try { URL.revokeObjectURL(url); } catch (e) { /* already gone */ }
      }
      cache.delete(k);
    }
  });
}

export default { shiftedUri, keyShiftReady, forgetKeyShifts };
