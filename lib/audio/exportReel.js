// Saving the reel as a file.
//
// What lands on disk is what the deck would have played: every active take, in
// its place on the tape, at its track level, with the speed and the key the deck
// is set to. A pitch-locked speed change is stretched rather than resampled, so
// the file is a speed changer's output and not a chipmunk; with the lock off it
// is a tape's, sped up and bent together.
import { Platform } from 'react-native';
import { decodeUri, channelArrays } from './buffers';
import { pitchShift, timeStretch, resample } from './dsp';
import { encodeWav, saveBlob } from './wav';

export function canExport() {
  return Platform.OS === 'web';
}

function cleanName(name) {
  const base = String(name || 'reel')
    .replace(/[^a-z0-9 _-]+/gi, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
  return base || 'reel';
}

/**
 * Renders `items` (from buildItems) to a WAV and hands it to the browser.
 * Resolves `{ filename, seconds, sampleRate }`.
 */
export async function exportReel(opts) {
  if (!canExport()) throw new Error('Saving a file is web-only for now.');
  const items = (opts.items || []).filter((it) => it && it.uri);
  if (!items.length) throw new Error('Nothing on the tape to save yet.');
  const speed = Math.max(0.5, Math.min(2, Number(opts.speed) || 1));
  // Fractional: the deck's key control moves in five-cent steps.
  const semis = Math.max(-12, Math.min(12, Number(opts.semitones) || 0));
  const lock = opts.pitchLock === true;

  const rendered = [];
  for (const take of items) {
    const buffer = await decodeUri(take.uri);
    if (!buffer) continue;
    let channels = channelArrays(buffer);
    if (Math.abs(semis) > 0.001) channels = pitchShift(channels, semis);
    if (Math.abs(speed - 1) > 0.001) {
      channels = lock ? timeStretch(channels, 1 / speed) : resample(channels, speed);
    }
    rendered.push({ take, channels, sampleRate: buffer.sampleRate });
  }
  if (!rendered.length) throw new Error('Those takes could not be read back.');

  const sampleRate = rendered[0].sampleRate;
  let frames = 0;
  rendered.forEach(({ take, channels }) => {
    const start = Math.round(Math.max(0, Number(take.start) || 0) * sampleRate);
    frames = Math.max(frames, start + channels[0].length);
  });
  if (!frames) throw new Error('Nothing on the tape to save yet.');

  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  rendered.forEach(({ take, channels }) => {
    const start = Math.round(Math.max(0, Number(take.start) || 0) * sampleRate);
    const gain = typeof take.volume === 'number' ? take.volume : 0.85;
    const l = channels[0];
    const r = channels[1] || channels[0];
    const n = Math.min(l.length, frames - start);
    for (let i = 0; i < n; i += 1) {
      left[start + i] += l[i] * gain;
      right[start + i] += r[i] * gain;
    }
  });

  // Four tracks summed can pass full scale even when each one is fine. Bring the
  // whole thing down rather than let the file clip.
  let peak = 0;
  for (let i = 0; i < frames; i += 1) {
    const a = Math.abs(left[i]);
    const b = Math.abs(right[i]);
    if (a > peak) peak = a;
    if (b > peak) peak = b;
  }
  if (peak > 0.999) {
    const k = 0.999 / peak;
    for (let i = 0; i < frames; i += 1) {
      left[i] *= k;
      right[i] *= k;
    }
  }

  const tags = [];
  if (Math.abs(semis) > 0.001) tags.push('key' + (semis > 0 ? '+' : '-') + Math.abs(semis).toFixed(2));
  if (Math.abs(speed - 1) > 0.001) tags.push(Math.round(speed * 100) + 'pc');
  const filename = [cleanName(opts.name)].concat(tags).join('-') + '.wav';

  const blob = encodeWav([left, right], sampleRate, false);
  if (!saveBlob(blob, filename)) throw new Error('This browser cannot save files.');
  return { filename, seconds: frames / sampleRate, sampleRate };
}

export default { exportReel, canExport };
