// Writing samples to a WAV the browser (and everything else) reads back exactly
// as they were written. Used by the key shift, which renders a pitched copy of a
// take, and by the export, which renders the whole reel.

const clamp = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);

/**
 * `channels` is an array of Float32Array, all the same length. `float32` true
 * writes IEEE float (32-bit), false writes 24-bit PCM.
 */
export function encodeWav(channels, sampleRate, float32) {
  const numCh = Math.max(1, channels.length);
  const frames = channels[0] ? channels[0].length : 0;
  const bytesPerSample = float32 ? 4 : 3;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, float32 ? 3 : 1, true); // 3 = IEEE float, 1 = PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);

  let at = 44;
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < numCh; c += 1) {
      const sample = clamp(channels[c] ? channels[c][i] : 0);
      if (float32) {
        view.setFloat32(at, sample, true);
        at += 4;
      } else {
        const v = Math.round(sample * 8388607);
        view.setUint8(at, v & 0xff);
        view.setUint8(at + 1, (v >> 8) & 0xff);
        view.setUint8(at + 2, (v >> 16) & 0xff);
        at += 3;
      }
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/** Hands a blob to the browser as a download. Web only. */
export function saveBlob(blob, filename) {
  if (typeof document === 'undefined') return false;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // The click has already handed the data over; keep the URL alive long enough
  // for a slow download to start, then let it go.
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}

export default { encodeWav, saveBlob };
