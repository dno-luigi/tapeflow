// The tempo arithmetic, run without a browser: a BPM out of range must land on a
// tempo the deck can keep, and the beat length must follow the BPM exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clampBpm, beatSeconds, BPM_MIN, BPM_MAX, DEFAULT_BPM } from '../lib/audio/metronome.js';

test('the beat is sixty seconds over the BPM', () => {
  assert.equal(beatSeconds(120), 0.5);
  assert.equal(beatSeconds(60), 1);
  assert.ok(Math.abs(beatSeconds(96) - 0.625) < 1e-9);
});

test('a tempo outside the knob range is brought to the nearest usable one', () => {
  assert.equal(clampBpm(12), BPM_MIN);
  assert.equal(clampBpm(9999), BPM_MAX);
});

test('a missing or nonsense tempo falls back to the default', () => {
  assert.equal(clampBpm(undefined), DEFAULT_BPM);
  assert.equal(clampBpm(null), DEFAULT_BPM);
  assert.equal(clampBpm('fast'), DEFAULT_BPM);
});

test('the BPM is a whole number of beats per minute', () => {
  assert.equal(clampBpm(96.4), 96);
  assert.equal(clampBpm('118'), 118);
});

test('the beat length is never zero at the top of the range', () => {
  assert.ok(beatSeconds(BPM_MAX) > 0);
  assert.equal(beatSeconds(BPM_MAX), 60 / BPM_MAX);
});
