// Where the tape head goes when a finger is on the timeline.
//
// Pure arithmetic, kept out of the screen so the awkward cases can be tested: a
// coordinate the platform did not supply, a strip with no width yet, a drag past
// either end. It returns null rather than a number it cannot stand behind,
// because a head position that is not a number takes the whole transport down
// with it: the tape stops advancing, the span label reads NaN, and the deck looks
// dead while it says it is playing.
export function tapeTimeAt(pageX, box, span) {
  const left = box && Number.isFinite(box.left) ? box.left : 0;
  const width = box && Number.isFinite(box.width) && box.width > 0 ? box.width : 0;
  const length = Number.isFinite(span) && span > 0 ? span : 0;
  if (!Number.isFinite(pageX) || !width || !length) return null;
  const frac = Math.max(0, Math.min(1, (pageX - left) / width));
  return frac * length;
}

export default { tapeTimeAt };
