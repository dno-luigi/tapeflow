// Recording to the bar, run without a browser: the bar has to land exactly where
// the tempo says, and a pass has to end on it rather than near it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { barSeconds, nextRecordBars, passEnd, reachedEnd, RECORD_BARS, BEATS_PER_BAR } from '../lib/audio/bars.js';

test('a bar at 120 BPM is two seconds, whatever the length', () => {
  assert.equal(barSeconds(120, 1), 2);
  assert.equal(barSeconds(120, 4), 8);
  assert.equal(barSeconds(120, 8), 16);
});

test('the bar follows the tempo', () => {
  assert.equal(barSeconds(96, 1), (BEATS_PER_BAR * 60) / 96);
  assert.equal(barSeconds(60, 2), 8);
});

test('no length set means no bar comes', () => {
  assert.equal(barSeconds(120, 0), 0);
  assert.equal(barSeconds(120, null), 0);
  assert.equal(passEnd(0, 120, 0), null);
});

test('a pass leaves the loop its own length behind', () => {
  assert.deepEqual(passEnd(10, 120, 2), { in: 10, out: 14, length: 4 });
});

test('the pass ends on the bar, not a frame past it', () => {
  const end = passEnd(0, 120, 1);
  assert.equal(reachedEnd(1.99, end), false);
  assert.equal(reachedEnd(2, end), true);
  assert.equal(reachedEnd(2.4, end), true); // a frame that overshot still ends it
  assert.equal(reachedEnd(2, null), false);
});

test('the record length cycles through the choices and back to off', () => {
  let n = 0;
  const seen = [];
  for (let i = 0; i < RECORD_BARS.length; i += 1) {
    seen.push(n);
    n = nextRecordBars(n);
  }
  assert.deepEqual(seen, RECORD_BARS);
  assert.equal(n, 0); // and round again
});

test('a nonsense record length starts at one bar rather than off', () => {
  assert.equal(nextRecordBars(undefined), 1);
  assert.equal(nextRecordBars(3), 1);
});
