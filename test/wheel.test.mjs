// The reel as a transport.
//
// Found by playing the deck: spinning the wheel slowly produced silence, and
// spinning a stopped tape produced nothing at all, so the hand felt disconnected
// from the sound. These tests hold the two things that were wrong — a slow hand
// must be heard, and the hand alone must be able to start the tape — and the range
// the hand is allowed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  wheelTransport,
  DEG_PER_SEC_AT_1X,
  HAND_MIN,
  HAND_MAX,
  ELEMENT_MIN,
  ELEMENT_MAX,
} from '../lib/audio/wheel.js';

const turn = (fraction) => DEG_PER_SEC_AT_1X * fraction;

test('a hand turning at the song’s pace plays at the song’s pace', () => {
  const out = wheelTransport({ mode: 'stop', dragging: true, vel: turn(1) });
  assert.equal(out.playing, true);
  assert.equal(out.rate, 1);
});

test('calibration: one turn a second is normal speed', () => {
  // A quick, comfortable turn — not a slow crank — has to land on 1x. The old
  // three-seconds-per-turn calibration put an ordinary spin at 2–3x and into the
  // ceiling.
  const at = (degPerSec) => wheelTransport({ mode: 'play', dragging: true, vel: degPerSec }).rate;
  assert.equal(at(360), 1);
  assert.equal(at(720), 2);
  assert.equal(at(180), 0.5);
  assert.equal(at(90), 0.25);
  // Faster than the element can go still sounds, at the element's limit.
  assert.equal(at(3600), 8);
});

test('a slow hand still sounds — slowly', () => {
  // 0.1x used to sit under the playable floor and came out as silence.
  const out = wheelTransport({ mode: 'stop', dragging: true, vel: turn(0.1) });
  assert.equal(out.playing, true);
  assert.equal(out.rate, 0.1);
  assert.equal(wheelTransport({ mode: 'play', dragging: true, vel: turn(0.3) }).rate, 0.3);
});

test('a fast hand plays fast, up to the tape’s limit', () => {
  assert.equal(wheelTransport({ mode: 'stop', dragging: true, vel: turn(2) }).rate, 2);
  assert.equal(wheelTransport({ mode: 'stop', dragging: true, vel: turn(3) }).rate, 3);
  // Beyond the limit it is still heard, not silenced.
  const flung = wheelTransport({ mode: 'stop', dragging: true, vel: turn(9) });
  assert.equal(flung.playing, true);
  assert.equal(flung.rate, HAND_MAX);
});

test('spinning a stopped tape sounds, and letting go stops it', () => {
  assert.equal(wheelTransport({ mode: 'stop', dragging: true, vel: turn(1) }).playing, true);
  // Released: the hand is off, the transport is stopped, so the tape is silent even
  // though the reel is still coasting.
  assert.deepEqual(wheelTransport({ mode: 'stop', dragging: false, vel: turn(1) }), {
    playing: false,
    rate: 0,
    magnitude: 0,
    hand: false,
  });
});

test('holding the reel still is silence', () => {
  assert.equal(wheelTransport({ mode: 'play', dragging: true, vel: 0 }).playing, false);
  assert.equal(wheelTransport({ mode: 'play', dragging: true, vel: turn(0.01) }).playing, false);
  assert.equal(wheelTransport({ mode: 'stop', dragging: true, vel: HAND_MIN * DEG_PER_SEC_AT_1X }).playing, true);
});

test('the mixer cannot clamp what the hand asks for', () => {
  // The mixer bounds playback to what a media element can do. The hand's range has
  // to fit inside that bound, or a slow spin comes out speeded up and the wheel
  // feels disconnected from the sound — which is exactly what it did.
  assert.ok(HAND_MIN >= ELEMENT_MIN, 'a slow hand must be playable, not clamped');
  assert.ok(HAND_MAX <= ELEMENT_MAX, 'a fast hand must not exceed the element');
  assert.ok(wheelTransport({ mode: 'stop', dragging: true, vel: turn(0.1) }).rate >= ELEMENT_MIN);
});

test('the hand sets the direction', () => {
  assert.equal(wheelTransport({ mode: 'stop', dragging: true, vel: -turn(1) }).rate, -1);
  assert.equal(wheelTransport({ mode: 'play', dragging: true, vel: -turn(0.5) }).rate, -0.5);
});

test('play keeps the speed control’s range, and its start-up gate', () => {
  // Played by the transport, not the hand: 100% is 1, and the control's floor and
  // ceiling hold.
  assert.equal(wheelTransport({ mode: 'play', dragging: false, vel: turn(1) }).rate, 1);
  assert.equal(wheelTransport({ mode: 'play', dragging: false, vel: turn(0.2) }).rate, 0.5);
  assert.equal(wheelTransport({ mode: 'play', dragging: false, vel: turn(9) }).rate, 2);
  // A transport easing up to speed is not heard yet.
  assert.equal(wheelTransport({ mode: 'play', dragging: false, vel: turn(0.1) }).playing, false);
  assert.equal(wheelTransport({ mode: 'rec', dragging: false, vel: turn(1) }).rate, 1);
});

test('fast-forward and rewind stay spooling', () => {
  assert.equal(wheelTransport({ mode: 'ff', dragging: true, vel: turn(1) }).playing, false);
  assert.equal(wheelTransport({ mode: 'rew', dragging: true, vel: -turn(1) }).playing, false);
  assert.equal(wheelTransport({ mode: 'ff', dragging: false, vel: turn(12) }).playing, false);
});

test('a reel that is not moving asks for nothing', () => {
  assert.equal(wheelTransport({ mode: 'stop', dragging: false, vel: 0 }).playing, false);
  assert.equal(wheelTransport({ mode: 'stop' }).playing, false);
  assert.equal(wheelTransport().playing, false);
  assert.equal(wheelTransport({ mode: 'stop', dragging: true, vel: NaN }).playing, false);
});
