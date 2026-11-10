// Decoding takes once, for the parts of the audio path that need the samples
// rather than a media element: the key shift and the export.
import { Platform } from 'react-native';

const cache = new Map(); // uri -> AudioBuffer | 'loading' | false
let ctx = null;

export function audioContext() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    try {
      ctx = new Ctor();
    } catch (e) {
      return null;
    }
  }
  if (ctx.state === 'suspended') {
    try {
      ctx.resume();
    } catch (e) {
      /* stays suspended; decoding still works */
    }
  }
  return ctx;
}

/** Decoded take, or null if it is still decoding or will never decode. */
export function decodedNow(uri) {
  const hit = cache.get(uri);
  return hit && hit !== 'loading' ? hit : null;
}

/** Fetch and decode, once per uri. Resolves null rather than throwing. */
export function decodeUri(uri) {
  const hit = cache.get(uri);
  if (hit && hit !== 'loading') return Promise.resolve(hit);
  if (hit === false) return Promise.resolve(null);
  if (hit === 'loading') {
    // Someone is already decoding it: wait for that one rather than fetching twice.
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        const now = cache.get(uri);
        if (now !== 'loading') resolve(now || null);
        else if (Date.now() - started > 30000) resolve(null);
        else setTimeout(tick, 60);
      };
      tick();
    });
  }

  const audioCtx = audioContext();
  if (!audioCtx) return Promise.resolve(null);

  cache.set(uri, 'loading');
  return (async () => {
    try {
      const response = await fetch(uri);
      const bytes = await response.arrayBuffer();
      const buffer = await new Promise((resolve, reject) => {
        const maybe = audioCtx.decodeAudioData(bytes.slice(0), resolve, reject);
        if (maybe && maybe.then) maybe.then(resolve, reject);
      });
      cache.set(uri, buffer);
      return buffer;
    } catch (e) {
      // One attempt only: a blob that will not decode stays undecoded rather
      // than being fetched again on every frame.
      cache.set(uri, false);
      return null;
    }
  })();
}

export function channelArrays(buffer) {
  const out = [];
  for (let c = 0; c < buffer.numberOfChannels; c += 1) out.push(buffer.getChannelData(c).slice(0));
  return out;
}

export default { audioContext, decodeUri, decodedNow, channelArrays };
