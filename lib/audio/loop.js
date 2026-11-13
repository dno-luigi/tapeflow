// Where the head goes when a loop is playing.
//
// A loop is not a mode of playback, it is one rule: when the tape reaches the OUT
// point, put it back at IN. Keeping the rule here rather than inside the deck's
// animation loop means it can be run without a browser, which is the only way to
// know it wraps exactly once and only when it should.
//
// `loop` is { mode, in, out }: mode 0 off, 1 setting the points, 2 playing.
// Returns the position to jump to, or null to let the tape run on.

export function loopJump(pos, loop) {
  if (!loop || loop.mode !== 2) return null;
  // A point that was never set must be caught before Number() is asked, because
  // Number(null) is 0: a half-set loop would otherwise wrap the head to the very
  // start of the tape and trap it there.
  if (loop.in == null || loop.out == null) return null;
  const inPoint = Number(loop.in);
  const outPoint = Number(loop.out);
  if (!Number.isFinite(inPoint) || !Number.isFinite(outPoint)) return null;
  // A loop with no length is not a loop; a half-set one must not trap the head.
  if (outPoint <= inPoint) return null;
  if (!Number.isFinite(pos)) return null;
  if (pos < outPoint) return null;
  return inPoint;
}

export default { loopJump };
