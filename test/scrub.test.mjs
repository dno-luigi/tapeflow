// The arithmetic under the scrubbable timeline.
//
// Found by dragging the bar on the live build: a coordinate that never arrived
// turned the head position into NaN, and the deck went dead — the tape stopped
// advancing, the span label read NAN:NAN, and the counter kept saying 00:00.0
// because it masks NaN behind `s || 0`. These tests hold the mapping to a real
// number, or to no answer at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tapeTimeAt } from '../lib/audio/scrub.js';

const BOX = { left: 20, width: 300 };
const SPAN = 60;

test('a point on the bar maps to its time on the tape', () => {
  assert.equal(tapeTimeAt(20, BOX, SPAN), 0);
  assert.equal(tapeTimeAt(170, BOX, SPAN), 30);
  assert.equal(tapeTimeAt(320, BOX, SPAN), 60);
});

test('a drag past either end stops at the ends', () => {
  assert.equal(tapeTimeAt(-500, BOX, SPAN), 0);
  assert.equal(tapeTimeAt(9999, BOX, SPAN), SPAN);
});

test('a coordinate the platform did not supply is refused', () => {
  // This is the one that broke the deck: NaN moved the head and poisoned
  // everything downstream of it.
  assert.equal(tapeTimeAt(undefined, BOX, SPAN), null);
  assert.equal(tapeTimeAt(NaN, BOX, SPAN), null);
  assert.equal(tapeTimeAt(Infinity, BOX, SPAN), null);
  assert.equal(tapeTimeAt('170', BOX, SPAN), null);
});

test('a strip with no width yet is refused', () => {
  assert.equal(tapeTimeAt(100, { left: 20, width: 0 }, SPAN), null);
  assert.equal(tapeTimeAt(100, { left: 20, width: NaN }, SPAN), null);
  assert.equal(tapeTimeAt(100, null, SPAN), null);
  assert.equal(tapeTimeAt(100, undefined, SPAN), null);
});

test('a span that is not a length is refused', () => {
  assert.equal(tapeTimeAt(100, BOX, 0), null);
  assert.equal(tapeTimeAt(100, BOX, NaN), null);
  assert.equal(tapeTimeAt(100, BOX, undefined), null);
});

test('the bar offset is honoured, and a missing offset counts as zero', () => {
  assert.equal(tapeTimeAt(170, { left: 170, width: 300 }, SPAN), 0);
  assert.equal(tapeTimeAt(150, { width: 300 }, SPAN), 30);
});
