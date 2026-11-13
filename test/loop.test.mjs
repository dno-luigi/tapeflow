// The loop rule, run without a browser: the head must come back to IN when it
// reaches OUT, and must never be trapped by a half-set loop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loopJump } from '../lib/audio/loop.js';

const playing = (inPoint, outPoint) => ({ mode: 2, in: inPoint, out: outPoint });

test('the head wraps to IN when it reaches OUT', () => {
  assert.equal(loopJump(10, playing(2, 10)), 2);
});

test('the head wraps if it is already past OUT', () => {
  assert.equal(loopJump(10.4, playing(2, 10)), 2);
});

test('the tape runs on before OUT', () => {
  assert.equal(loopJump(9.99, playing(2, 10)), null);
});

test('no loop while it is being set, or while it is off', () => {
  assert.equal(loopJump(10, { mode: 1, in: 2, out: 10 }), null);
  assert.equal(loopJump(10, { mode: 0, in: 2, out: 10 }), null);
});

test('a half-set loop does not trap the head', () => {
  assert.equal(loopJump(10, { mode: 2, in: null, out: 10 }), null);
  assert.equal(loopJump(10, { mode: 2, in: 2, out: null }), null);
});

test('points that do not enclose any tape are ignored', () => {
  assert.equal(loopJump(10, playing(10, 10)), null);
  assert.equal(loopJump(10, playing(12, 4)), null);
});

test('a position that is not a number is left alone', () => {
  assert.equal(loopJump(NaN, playing(2, 10)), null);
});

test('a missing loop is not an error', () => {
  assert.equal(loopJump(10, null), null);
  assert.equal(loopJump(10, undefined), null);
});
