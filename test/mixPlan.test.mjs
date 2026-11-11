// The rules that decide whether the deck has any sound in it.
//
// Two silent-deck bugs have already shipped from this code: bounces that each
// printed the other's track and so excluded every track, and takes whose audio
// was gone still being handed to a player. Both were found by ear on a live
// build. These tests hold the rules still, so the next change to a bounce or to
// take storage fails here instead of in a session that records silence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildItems, supersedeSkip, applyLevelOverride } from '../lib/audio/mixPlan.js';
import { rememberTakeAudio, resolveTakeUri } from '../lib/audio/takeStore.js';

// A copy of the audio this page holds, and one left over from a page that has
// since gone. Only the first can be played.
const LIVE = (id) => `blob:live-${id}`;
const DEAD = (id) => `blob:dead-${id}`;

// One track holding one active take. Passing `sources` makes that take a print:
// the track indexes it mixed together.
function trackWith(id, sources) {
  const take = { id, uri: DEAD(id), start: 0, duration: 1 };
  if (sources) take.sources = sources;
  return { activeTakeId: id, level: 0.85, takes: [take] };
}

// Saving a take does this, so afterwards this "page" can play it.
const live = (id) => rememberTakeAudio(id, LIVE(id));

const ids = (items) => items.map((it) => it.id);

test('a plain take is left out when a print contains it', async () => {
  await live('plain-1');
  await live('print-1');
  const tracks = [trackWith('plain-1'), trackWith('print-1', [0])];

  const skip = supersedeSkip(tracks, []);
  assert.deepEqual(skip, [0]);
  assert.deepEqual(ids(buildItems(tracks, skip)), ['print-1']);
});

test('two prints that printed each other do not cancel the deck', async () => {
  await live('mut-b');
  await live('mut-a');
  // Each bounce printed the other's track. The union of the two used to cover
  // every track, so buildItems came back empty and the transport ran with no
  // players in it — the deck was silent and said it was playing.
  const tracks = [trackWith('mut-b', [1]), trackWith('mut-a', [0])];

  const skip = supersedeSkip(tracks, []);
  assert.deepEqual(skip, []);
  assert.equal(buildItems(tracks, skip).length, 2);
});

test('a session of nothing but prints still has takes to play', async () => {
  await live('p-a');
  await live('p-b');
  await live('p-c');
  // The session from the live check: a take on TRK 1, a print of it on TRK 2,
  // and a print of both on TRK 3.
  const tracks = [
    trackWith('p-a', [2]),
    trackWith('p-b', [0, 2]),
    trackWith('p-c', [0, 1]),
  ];

  const items = buildItems(tracks, supersedeSkip(tracks, []));
  assert.equal(items.length, 3, 'every print keeps its own player');
});

test('a print never supersedes the track it sits on', async () => {
  await live('self-1');
  const tracks = [trackWith('self-1', [0])];

  assert.deepEqual(supersedeSkip(tracks, []), []);
  assert.deepEqual(ids(buildItems(tracks, [])), ['self-1']);
});

test('armed tracks stay excluded and the print rule adds to them', async () => {
  await live('arm-0');
  await live('arm-1');
  await live('arm-2');
  const tracks = [trackWith('arm-0'), trackWith('arm-1', [0]), trackWith('arm-2')];

  const skip = supersedeSkip(tracks, [2]);
  assert.deepEqual(skip.slice().sort(), [0, 2]);
  assert.deepEqual(ids(buildItems(tracks, skip)), ['arm-1']);
});

test('a source that is not a track is ignored', async () => {
  await live('junk-0');
  // A track cleared after the bounce was made leaves an index with nothing at it.
  const tracks = [trackWith('junk-0', [7, null])];

  assert.deepEqual(supersedeSkip(tracks, []), []);
});

test('a track level is the volume the mixer plays it at', async () => {
  await live('vol-1');
  const set = (level) => {
    const trk = trackWith('vol-1');
    if (level === undefined) delete trk.level;
    else trk.level = level;
    return buildItems([trk], [])[0].volume;
  };
  // What the level bar on each key sets, and what the fader is worth: a level is
  // the gain the take is played at, kept inside 0..1 whatever gets stored.
  assert.equal(set(0.3), 0.3);
  assert.equal(set(1), 1);
  assert.equal(set(4), 1);
  assert.equal(set(-2), 0);
  assert.equal(set(undefined), 0.85);
});

test('a fader being dragged is heard before it is saved', () => {
  const items = [
    { id: 'a', track: 0, volume: 0.75 },
    { id: 'b', track: 1, volume: 0.75 },
  ];
  const out = applyLevelOverride(items, 1, 0.2);
  assert.equal(out[1].volume, 0.2, 'the dragged track follows the finger');
  assert.equal(out[0].volume, 0.75, 'the other tracks are untouched');
  assert.equal(items[1].volume, 0.75, 'the saved items are not mutated');

  assert.equal(applyLevelOverride(items, 1, 4)[1].volume, 1);
  assert.equal(applyLevelOverride(items, 1, -1)[1].volume, 0);
  // Nothing to override: no fader down, or a coordinate that never arrived.
  assert.equal(applyLevelOverride(items, null, 0.5), items);
  assert.equal(applyLevelOverride(items, 1, NaN), items);
});

test('a print carries the tracks it printed', async () => {
  await live('bounce-1');
  const items = buildItems([trackWith('bounce-1', [2, 3])], []);

  assert.equal(items[0].bounced, true);
  assert.deepEqual(items[0].sources, [2, 3]);
  assert.equal(items[0].track, 0);
});

test('a blob url from a page that has gone resolves to nothing', () => {
  // No copy on this page, so the audio is gone: handing this URL to a player is
  // how a track ends up saying PLAYS while holding a player with no duration.
  assert.equal(resolveTakeUri({ id: 'gone-1', uri: DEAD('gone-1') }), null);
});

test('an imported file keeps playing', () => {
  const uri = 'https://example.test/take.wav';
  assert.equal(resolveTakeUri({ id: 'import-1', uri }), uri);
});

test("the copy this page holds wins over the take's own url", async () => {
  const take = { id: 'copy-1', uri: DEAD('copy-1') };
  assert.equal(resolveTakeUri(take), null);

  await live('copy-1');
  assert.equal(resolveTakeUri(take), LIVE('copy-1'));
});

test('a take with nothing to play is not offered to the mixer', async () => {
  await live('alive-2');
  const deadTrack = trackWith('dead-2');
  const liveTrack = {
    activeTakeId: 'alive-2',
    level: 0.5,
    takes: [{ id: 'alive-2', uri: DEAD('alive-2'), start: 0.25, duration: 2 }],
  };

  const items = buildItems([deadTrack, liveTrack], []);
  assert.deepEqual(ids(items), ['alive-2']);
  assert.equal(items[0].track, 1);
  assert.equal(items[0].volume, 0.5);
  assert.equal(items[0].start, 0.25);
  assert.equal(items[0].duration, 2);
});

test('a track with no active take offers nothing, and null is not a take', () => {
  const empty = { activeTakeId: 'not-there', takes: [trackWith('other').takes[0]] };
  assert.deepEqual(buildItems([empty], []), []);
  assert.equal(resolveTakeUri(null), null);
});
