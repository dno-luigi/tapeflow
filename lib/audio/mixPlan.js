// What the deck plays, and what a print replaces.
//
// These two rules live apart from the mixer because they are the ones that
// decide whether there is any sound at all: which take each track offers, and
// which takes a bounce supersedes. Get them wrong and the tape runs with no
// players in it, or with players whose audio is gone. Keeping them free of the
// audio platform means they can be checked without a speaker or a browser.
//
// The `.js` extension is for Node's resolver, which has no Metro-style guessing;
// Metro and the web bundle accept it too.
import { resolveTakeUri } from './takeStore.js';

// Turns a session's tracks into the list of takes that should be heard.
// `exclude` is a list of track indexes to leave out (the ones being recorded).
export function buildItems(tracks, exclude) {
  const skip = exclude || [];
  const out = [];
  (tracks || []).forEach((tr, i) => {
    if (!tr || skip.indexOf(i) >= 0) return;
    const takes = tr.takes || [];
    const take = takes.find((k) => k.id === tr.activeTakeId) || null;
    // The take's own field is only a hint: its blob URL dies with the page that
    // made it, so ask the store which copy is playable now.
    const uri = resolveTakeUri(take);
    if (!take || !uri) return;
    out.push({
      id: take.id,
      // Which track this came from, so the deck can work out what a bounce printed.
      track: i,
      uri,
      start: Number(take.start) || 0,
      duration: Number(take.duration) || 0,
      volume: typeof tr.level === 'number' ? Math.max(0, Math.min(1, tr.level)) : 0.85,
      // Tracks this take printed, when it is a bounce.
      sources: Array.isArray(take.sources) ? take.sources : null,
      bounced: Array.isArray(take.sources) && take.sources.length > 0,
    });
  });
  return out;
}

// Which tracks a bounced take supersedes while it plays.
//
// Only plain material is replaced. A source that is itself a print is left alone:
// two bounces that each printed the other's track would otherwise exclude every
// track at once, and the deck would run with no players and no sound in it. The
// take's own track is never a source of itself.
export function supersedeSkip(tracks, baseSkip) {
  const deck = tracks || [];
  const skip = (baseSkip || []).slice();
  const isPrint = (i) => {
    const tr = deck[i] || {};
    const take = (tr.takes || []).find((k) => k.id === tr.activeTakeId) || null;
    return !!(take && Array.isArray(take.sources) && take.sources.length);
  };
  buildItems(tracks, skip).forEach((it) => {
    if (!it.bounced) return;
    (it.sources || []).forEach((j) => {
      // A stale index — a track that has since been cleared — is not a track, so
      // there is nothing there to leave out.
      if (!deck[j]) return;
      if (j === it.track || isPrint(j)) return;
      if (skip.indexOf(j) < 0) skip.push(j);
    });
  });
  return skip;
}

// A level being dragged, put on the take that is playing right now.
//
// The fader saves to the session on release, but a mix has to be heard while it
// is being made: this hands the finger's value to the mixer without writing the
// session on every pixel of the drag.
export function applyLevelOverride(items, index, value) {
  const list = items || [];
  if (index === null || index === undefined || !Number.isFinite(value)) return list;
  const gain = Math.max(0, Math.min(1, value));
  return list.map((it) => (it.track === index ? { ...it, volume: gain } : it));
}

export default { buildItems, supersedeSkip, applyLevelOverride };
