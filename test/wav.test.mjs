// A take recorded in blocks is joined into a WAV at stop. If the header does not
// describe the bytes that follow it, the file plays at the wrong speed or not at
// all — so the bytes are checked here, away from a microphone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { wavHeaderBytes, pcmBytes } from '../lib/audio/wav.js';

const ascii = (view, offset, length) => {
  let out = '';
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(view.getUint8(offset + i));
  return out;
};

test('the header describes the take that follows it', () => {
  const view = new DataView(wavHeaderBytes(48000, 1, 3, false));
  assert.equal(view.byteLength, 44);
  assert.equal(ascii(view, 0, 4), 'RIFF');
  assert.equal(ascii(view, 8, 4), 'WAVE');
  assert.equal(ascii(view, 12, 4), 'fmt ');
  assert.equal(ascii(view, 36, 4), 'data');
  assert.equal(view.getUint16(20, true), 1, '24-bit PCM is format 1');
  assert.equal(view.getUint16(22, true), 1, 'one channel');
  assert.equal(view.getUint32(24, true), 48000, 'the rate the mic ran at');
  assert.equal(view.getUint16(34, true), 24, '24 bits');
  assert.equal(view.getUint32(40, true), 3 * 3, 'three frames, three bytes each');
  assert.equal(view.getUint32(4, true), 36 + 9, 'RIFF size counts the data');
});

test('a stereo float take is described as stereo float', () => {
  const view = new DataView(wavHeaderBytes(44100, 2, 10, true));
  assert.equal(view.getUint16(20, true), 3, 'IEEE float');
  assert.equal(view.getUint16(22, true), 2, 'two channels');
  assert.equal(view.getUint32(28, true), 44100 * 8, 'byte rate');
  assert.equal(view.getUint16(32, true), 8, 'block align');
  assert.equal(view.getUint32(40, true), 10 * 8, 'data size');
});

test('samples are written interlaced, clamped and little-endian', () => {
  const bytes = new Uint8Array(pcmBytes([new Float32Array([-1, 0, 1])], false));
  assert.equal(bytes.length, 9);
  assert.deepEqual(Array.from(bytes.slice(0, 3)), [0x01, 0x00, 0x80], 'full negative');
  assert.deepEqual(Array.from(bytes.slice(3, 6)), [0x00, 0x00, 0x00], 'silence');
  assert.deepEqual(Array.from(bytes.slice(6, 9)), [0xff, 0xff, 0x7f], 'full positive');
});

test('stereo blocks interleave left and right', () => {
  const bytes = new Uint8Array(pcmBytes([new Float32Array([1]), new Float32Array([-1])], false));
  assert.deepEqual(Array.from(bytes.slice(0, 3)), [0xff, 0xff, 0x7f], 'left first');
  assert.deepEqual(Array.from(bytes.slice(3, 6)), [0x01, 0x00, 0x80], 'then right');
});

test('a block in float32 keeps the samples exact', () => {
  const bytes = new Uint8Array(pcmBytes([new Float32Array([0.5, -0.5])], true));
  assert.equal(bytes.length, 8);
  const view = new DataView(bytes.buffer);
  assert.equal(view.getFloat32(0, true), 0.5);
  assert.equal(view.getFloat32(4, true), -0.5);
});
