// Playing takes backwards.
//
// A browser's <audio> element cannot be given a negative playbackRate, so the
// reel used to be silent whenever it spun backwards. The only way to read a tape
// backwards in a browser is to decode the audio and play a reversed copy of it,
// which is what this does: each take is decoded once and kept, a reversed copy
// of the samples is made beside it, and while the tape runs backwards that copy
// is played forward from the mirrored offset. The result is the original audio,
// backwards, at whatever speed the hand is moving the reel.
//
// Web only. There is no AudioContext in the React Native audio path, and native
// keeps the silent spool it had.
import { Platform } from 'react-native';

const DRIFT_LIMIT = 0.35; // seconds of audio drift before a node is re-cut at the playhead
const MIN_SPEED = 0.02;

// uri -> { forward, reverse } once decoded, 'loading' while decoding, false if
// it will never decode (a dead blob URL, an unsupported codec).
const decoded = new Map();
// item id -> the node currently sounding for it
const live = new Map();

let ctx = null;

function audioContext() {
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
  // A context created before any gesture starts suspended; the hand on the reel
  // is the gesture, so this is the moment it is allowed to run.
  if (ctx.state === 'suspended') {
    try {
      ctx.resume();
    } catch (e) {
      /* stays suspended; nothing to do */
    }
  }
  return ctx;
}

function reverseCopy(audioCtx, buffer) {
  const out = audioCtx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const from = buffer.getChannelData(c);
    const to = out.getChannelData(c);
    for (let i = 0, j = from.length - 1; i < from.length; i += 1, j -= 1) to[i] = from[j];
  }
  return out;
}

// Decode a take in the background. Returns the entry if it is ready now, or null
// while it decodes; the next sync a tick later will find it.
function bufferFor(uri) {
  const cached = decoded.get(uri);
  if (cached === 'loading' || cached === false) return null;
  if (cached) return cached;
  const audioCtx = audioContext();
  if (!audioCtx) return null;

  decoded.set(uri, 'loading');
  (async () => {
    try {
      const response = await fetch(uri);
      const bytes = await response.arrayBuffer();
      const forward = await new Promise((resolve, reject) => {
        const maybe = audioCtx.decodeAudioData(bytes.slice(0), resolve, reject);
        if (maybe && maybe.then) maybe.then(resolve, reject);
      });
      decoded.set(uri, { forward, reverse: reverseCopy(audioCtx, forward) });
    } catch (e) {
      // One attempt only: a take that will not decode stays silent rather than
      // being fetched again on every frame.
      decoded.set(uri, false);
    }
  })();
  return null;
}

// Scrub a tape backwards and nodes start and stop constantly, at arbitrary
// points in the file. Cutting one dead centre is a click, so every node is faded
// in over this and faded out over this before it is unplugged.
const FADE = 0.012;

function cut(id) {
  const entry = live.get(id);
  if (!entry) return;
  live.delete(id);
  const ctx = entry.ctx;
  const now = ctx ? ctx.currentTime : 0;
  try {
    if (ctx) {
      entry.gain.gain.cancelScheduledValues(now);
      entry.gain.gain.setValueAtTime(entry.gain.gain.value, now);
      entry.gain.gain.linearRampToValueAtTime(0, now + FADE);
    }
  } catch (e) {
    /* already gone */
  }
  try {
    entry.src.onended = null;
    if (ctx) entry.src.stop(now + FADE + 0.002);
    else entry.src.stop();
  } catch (e) {
    /* already stopped */
  }
  // Unplug only once the fade has actually run.
  setTimeout(() => {
    try { entry.gain.disconnect(); } catch (e) { /* gone */ }
    try { entry.src.disconnect(); } catch (e) { /* gone */ }
  }, Math.round((FADE + 0.012) * 1000));
}

export function stopReverse() {
  Array.from(live.keys()).forEach(cut);
}

/**
 * Sound the takes backwards while the tape runs backwards.
 *
 * `rate` is negative: -0.4 is a slow reverse, -2 a fast one. Anything the caller
 * stops asking for — left the take, changed direction, stopped the tape — is cut
 * on the next call.
 */
export function syncReverse(items, pos, rate) {
  const audioCtx = audioContext();
  if (!audioCtx) return;
  const speed = Math.abs(Number(rate) || 0);
  if (speed < MIN_SPEED) {
    stopReverse();
    return;
  }

  const sounding = new Set();
  (items || []).forEach((item) => {
    if (!item || !item.uri) return;
    const offset = pos - item.start; // tape seconds into this take
    if (!(offset >= 0 && offset < item.duration)) return;

    const entry = bufferFor(item.uri);
    if (!entry) return;

    sounding.add(item.id);
    const { reverse } = entry;
    // Mirrored offset: the reversed copy played from (length - offset) is the
    // original audio at this tape position, read backwards.
    const target = Math.max(0, Math.min(reverse.duration - 0.001, reverse.duration - offset));

    let node = live.get(item.id);
    if (node && node.uri !== item.uri) {
      cut(item.id);
      node = null;
    }
    if (node) {
      const expected = node.beganOffset + speed * (audioCtx.currentTime - node.beganAt);
      if (Math.abs(expected - target) > DRIFT_LIMIT) {
        cut(item.id);
        node = null;
      }
    }

    if (!node) {
      const src = audioCtx.createBufferSource();
      src.buffer = reverse;
      const gain = audioCtx.createGain();
      const volume = typeof item.volume === 'number' ? item.volume : 0.85;
      const at = audioCtx.currentTime;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(volume, at + FADE);
      src.connect(gain);
      gain.connect(audioCtx.destination);
      try {
        src.playbackRate.value = speed;
      } catch (e) {
        /* rate param unsupported; default 1 still plays */
      }
      try {
        src.start(0, target);
      } catch (e) {
        return;
      }
      live.set(item.id, { src, gain, uri: item.uri, ctx: audioCtx, beganAt: audioCtx.currentTime, beganOffset: target });
      return;
    }

    try {
      node.src.playbackRate.value = speed;
      const volume = typeof item.volume === 'number' ? item.volume : 0.85;
      if (Math.abs(node.gain.gain.value - volume) > 0.01) {
        const at = audioCtx.currentTime;
        node.gain.gain.cancelScheduledValues(at);
        node.gain.gain.setValueAtTime(node.gain.gain.value, at);
        node.gain.gain.linearRampToValueAtTime(volume, at + 0.03);
      }
    } catch (e) {
      /* a node that has already ended has nothing to update */
    }
  });

  Array.from(live.keys()).forEach((id) => {
    if (!sounding.has(id)) cut(id);
  });
}

export default { syncReverse, stopReverse };
