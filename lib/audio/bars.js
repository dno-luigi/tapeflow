// Recording to the bar: the looper.
//
// A pass given a length does not wait for a hand on the STOP key. When the bar
// arrives it ends itself, and the region it just recorded becomes the loop, so a
// part can be laid down against its own repeat.
//
// All of it is arithmetic — which is why it lives here rather than inside the
// deck's animation loop: the bar boundary is the one thing that has to be exact,
// and it can be checked without a microphone.

export const BEATS_PER_BAR = 4; // the deck's bars are 4/4, as the machine's are
export const RECORD_BARS = [0, 1, 2, 4, 8, 16]; // 0 is off

/** How long `bars` bars last at this tempo. 0 means the length is off. */
export function barSeconds(bpm, bars) {
  const n = Number(bars);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const tempo = Number(bpm) > 0 ? Number(bpm) : 96;
  return (n * BEATS_PER_BAR * 60) / tempo;
}

/** The next record length in the cycle. An unknown value starts at one bar. */
export function nextRecordBars(current) {
  const i = RECORD_BARS.indexOf(Number(current));
  if (i < 0) return RECORD_BARS[1];
  return RECORD_BARS[(i + 1) % RECORD_BARS.length];
}

/**
 * The region a pass makes when it is recorded to a length: where it started and
 * where the bar falls. Null when no length is set.
 */
export function passEnd(start, bpm, bars) {
  const length = barSeconds(bpm, bars);
  if (!length) return null;
  const from = Number(start) || 0;
  return {
    in: from,
    out: Math.round((from + length) * 1000) / 1000,
    length,
  };
}

/** Whether the head has reached the bar that ends the pass. */
export function reachedEnd(pos, end) {
  if (!end) return false;
  const p = Number(pos);
  if (!Number.isFinite(p)) return false;
  // A hair of tolerance: the head moves in whole frames, and a bar that arrives
  // one sample late is still the bar.
  return p >= end.out - 1e-6;
}
