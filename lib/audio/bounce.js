// Prints a pass the way a tape machine does: the microphone together with the
// tracks that were playing under it, rendered once into a single take. The take
// remembers which tracks it printed, and the mixer leaves those tracks out while
// it plays — a bounce replaces what it printed instead of doubling it.
import { decodeUri } from './buffers';
import { encodeWav } from './wav';
import { resolveTakeUri } from './takeStore';

/**
 * Renders `duration` seconds of microphone + the given tracks into one stereo WAV.
 * `start` is the tape position the pass began at, `rate` the speed it ran at.
 * Returns { blob, uri, peak, sampleRate } or null if there is nothing to print.
 */
export async function renderBounce({ micUri, start, duration, rate, tracks, sourceIndexes }) {
  if (!micUri || !duration || duration <= 0) return null;
  const mic = await decodeUri(micUri);
  if (!mic) return null;
  const Ctor = typeof window !== 'undefined' ? (window.OfflineAudioContext || window.webkitOfflineAudioContext) : null;
  if (!Ctor) return null;

  const speed = Number(rate) > 0 ? Number(rate) : 1;
  const sampleRate = mic.sampleRate || 48000;
  const frames = Math.max(1, Math.round(duration * sampleRate));
  const ctx = new Ctor(2, frames, sampleRate);

  // The microphone ran for the whole pass at real time, so it sits at zero.
  const micSrc = ctx.createBufferSource();
  micSrc.buffer = mic;
  const micGain = ctx.createGain();
  micGain.gain.value = 1;
  micSrc.connect(micGain).connect(ctx.destination);
  micSrc.start(0);

  const wanted = sourceIndexes || [];
  // Only the tracks that really made it in. A track whose audio this page cannot
  // find is not printed, and must not be claimed as printed.
  const used = [];
  for (let k = 0; k < wanted.length; k += 1) {
    const tr = tracks[wanted[k]];
    if (!tr) continue;
    const take = (tr.takes || []).find((x) => x.id === tr.activeTakeId) || null;
    const uri = resolveTakeUri(take);
    if (!uri) continue;
    // Decode every source before starting anything, so a slow file cannot make
    // the bounce start mid-render with half its tracks missing.
    const buf = await decodeUri(uri);
    if (!buf) continue;
    // Where the head stood, in this take's own samples, and how much of the pass
    // it still had left to run at this speed.
    const offset = Math.max(0, (start - (Number(take.start) || 0)) * speed);
    if (offset >= buf.duration) continue;
    const left = Math.min((buf.duration - offset) / speed, duration);
    if (left <= 0) continue;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = speed;
    const gain = ctx.createGain();
    gain.gain.value = typeof tr.level === 'number' ? Math.max(0, Math.min(1, tr.level)) : 0.85;
    src.connect(gain).connect(ctx.destination);
    // The third argument is buffer time, not wall time, so the rate is folded back in.
    src.start(0, offset, left * speed);
    used.push(wanted[k]);
  }

  const rendered = await ctx.startRendering();
  const leftCh = rendered.getChannelData(0);
  const rightCh = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : leftCh;

  // A pass with the music printed into it goes over full scale easily. Scaling the
  // whole mix keeps the balance; clamping each sample would distort the loud half.
  let peak = 0;
  for (let i = 0; i < frames; i += 1) {
    const a = Math.abs(leftCh[i]);
    const b = Math.abs(rightCh[i]);
    if (a > peak) peak = a;
    if (b > peak) peak = b;
  }
  const scale = peak > 0.99 ? 0.99 / peak : 1;
  const outL = new Float32Array(frames);
  const outR = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    outL[i] = leftCh[i] * scale;
    outR[i] = rightCh[i] * scale;
  }

  const blob = encodeWav([outL, outR], sampleRate, false);
  return { blob, uri: URL.createObjectURL(blob), peak: peak * scale, sampleRate, sources: used };
}

export default { renderBounce };
