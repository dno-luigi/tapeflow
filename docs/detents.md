# Detents

The wheel is the instrument. A detent is the smallest unit of feel it can report,
and this file fixes the numbers so the feel is designed rather than emergent.

## Resolution

**24 detents per revolution (15.0°).** The hardware-encoder norm, in the range a
thumb can tick without fatigue, and coarse enough that a whole bar fits in one turn.

## One detent, per function

| Function | One detent | One revolution |
|----------|-----------|----------------|
| Tempo | 1 BPM | 24 BPM |
| Key / pitch | 0.05 semitone (5 cents, the existing `KEY_STEP`) | 1.2 semitones |
| Loop point trim (IN/OUT) | 10 ms | 240 ms |
| Scrub, slow zone | 1 frame of history | — (see zones) |
| Step / page | 1 step | **16 steps = one bar** |
| Tape position (fast) | 100 ms | 2.4 s |

**One revolution = one bar.** At 16 steps per turn a step is 22.5°, so the
physical gesture and the musical structure agree; four turns walk a 64-step
pattern when patterns grow past one page.

## The magnetic model

A detent is not a rounded number, it is a slot with edges.

- Within **60%** of a detent's arc the value stays pinned to that detent.
- Past **60%** the next detent engages.
- Releasing back crosses at **40%** — hysteresis, so a value resting on a boundary
  cannot chatter between two neighbours.

Without the 60/40 split every boundary buzzes; with it the wheel feels machined.

## Detents shape values, never sound

The wheel's angular velocity always drives the tape continuously and audibly.
Snapping applies to the *value being edited*, never to the transport. This is the
line between a jog wheel and a quantiser.

## Velocity zones (scrub)

| Zone | Angular speed | Meaning |
|------|---------------|---------|
| Fine | < 90 °/s | sample-accurate nudge |
| Medium | 90–360 °/s | 10 ms steps |
| Coarse | 360–900 °/s | 100 ms steps |
| Shuttle | > 900 °/s | the tape runs at the hand's speed, as it does now |

## The haptic contract

Three strengths, each with a meaning:

| Tier | Fires on |
|------|----------|
| **Soft** (selection) | every detent |
| **Medium** (light impact) | musical landmarks: beat, cue, loop point, page edge, zero |
| **Hard** (heavy impact) | crossing IN/OUT while the tape runs; the ends of the tape |

Rate-capped at **one pulse per 40 ms**. Faster than that, pulses coalesce (every
2nd, then every 4th crossing) and the strength rises a tier, so a flick still
feels like a flick instead of a buzz.

Every haptic event also carries a **spoken phrase** — see `docs/accessibility.md`.
One event, two channels, so a physical machine later maps the same event onto a
motor and an LED.

## Where it lives

`lib/input/detents.js`, pure, no React:

```js
detentIndex(angleDeg, spacingDeg)            // which slot the wheel is in
engagement(angleDeg, spacing, { stick, release }) // value with hysteresis
velocityZone(degPerSec)                      // fine | medium | coarse | shuttle
pulsePlan(crossings, { minGapMs })           // [{ tier, spoken }] after coalescing
```

Tests (`test/detents.test.mjs`) must cover: no chatter at a boundary, 60/40
asymmetry, zone thresholds, coalescing at speed, and one-rev-per-bar.

## Inputs that are not fingers

Mouse wheel and arrow keys move one detent. `Shift` is coarse, `Alt` fine.
Screen readers do not drag: they use increment/decrement actions on an
`adjustable` control, which must call the same function the drag calls.
