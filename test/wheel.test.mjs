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
  HAND_CEILING,
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
  assert.equal(at(180), 0.5);
  assert.equal(at(90), 0.25);
  // Above the tape's own speed the hand is compressed, so a spin that is twice the
  // calibration is a little under twice the speed — and no spin passes the ceiling.
  assert.ok(at(720) > 1.8 && at(720) < 2, 'twice the turn is a little under twice the speed');
  assert.ok(at(3600) <= HAND_CEILING && at(3600) > 2.9, 'a fling approaches the ceiling, never passes it');
});

test('a slow hand still sounds — slowly', () => {
  // 0.1x used to sit under the playable floor and came out as silence.
  const out = wheelTransport({ mode: 'stop', dragging: true, vel: turn(0.1) });
  assert.equal(out.playing, true);
  assert.equal(out.rate, 0.1);
  assert.equal(wheelTransport({ mode: 'play', dragging: true, vel: turn(0.3) }).rate, 0.3);
});

test('a fast hand plays fast, but a fling does not run away', () => {
  const at = (f) => wheelTransport({ mode: 'stop', dragging: true, vel: turn(f) }).rate;
  assert.ok(at(2) > 1.8 && at(2) < 2);
  assert.ok(at(3) > 2.5 && at(3) <= HAND_CEILING);
  // Harder spins still climb, but by less and less: this is the complaint that a
  // fast spin went too fast, and the reason the top is compressed.
  assert.ok(at(4) > at(2));
  assert.ok(at(6) - at(4) < at(4) - at(2), 'each extra turn buys less speed than the last');
  // Beyond the limit it is still heard, never silenced.
  const flung = wheelTransport({ mode: 'stop', dragging: true, vel: turn(9) });
  assert.equal(flung.playing, true);
  assert.ok(Math.abs(flung.rate - HAND_CEILING) < 0.01);
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

test('the deck can set how much speed a turn is worth', () => {
  // The default reference is one turn a second; a deck with a different sensitivity
  // passes its own. More speed per turn means a smaller base.
  const at = (vel, base) => wheelTransport({ mode: 'play', dragging: true, vel, degPerSecAt1x: base }).rate;
  assert.equal(at(200, 200), 1);
  assert.ok(Math.abs(at(400, 200) - 1.92) < 0.02, 'twice the hand speed, compressed');
  assert.ok(Math.abs(at(200, 100) - 1.92) < 0.02, 'half the base is the same request');
  assert.equal(at(200, 400), 0.5);
  assert.equal(at(360), 1, 'with no base given, one turn a second is 1x');
  // A nonsense base falls back to the reference rather than dividing by zero.
  assert.equal(at(360, 0), 1);
  assert.equal(at(360, NaN), 1);
});

test('the mixer cannot clamp what the hand asks for', () => {
  // The mixer bounds playback to what a media element can do. The hand's range has
  // to fit inside that bound, or a slow spin comes out speeded up and the wheel
  // feels disconnected from the sound — which is exactly what it did.
  assert.ok(HAND_MIN >= ELEMENT_MIN, 'a slow hand must be playable, not clamped');
  assert.ok(HAND_MAX <= ELEMENT_MAX, 'a fast hand must not exceed the element');
  assert.ok(wheelTransport({ mode: 'stop', dragging: true, vel: turn(0.1) }).rate >= ELEMENT_MIN);
});

test('the deck can set the top speed a hard spin reaches', () => {
  const at = (ceiling) => wheelTransport({ mode: 'play', dragging: true, vel: turn(20), ceiling }).rate;
  assert.ok(at(2) <= 2 && at(2) > 1.9, 'a low top holds a fling near 2x');
  assert.ok(at(6) <= 6 && at(6) > 5.5, 'a high top lets a fling reach further');
  // A nonsense ceiling falls back to the default rather than removing the limit.
  assert.ok(Math.abs(at(NaN) - HAND_CEILING) < 0.01);
  assert.ok(Math.abs(at(0.5) - HAND_CEILING) < 0.01);
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
