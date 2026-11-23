# Design language

TRNV is an object you operate, not a screen you look at. The rules below keep it
that way as features arrive.

## The two faces

**Every control has a printed function and a held function.** Tap does the thing;
hold opens the thing behind it. While you hold, **the display says what the hold
is doing** — the second face is never hidden knowledge.

| Control | Printed (tap) | Held | Origin |
|---------|---------------|------|--------|
| TEMPO | tempo on/off, ± sets BPM | record length in bars | owner |
| TRACK / TAPE boxes | select and arm a track | open that track's takes | agent |

The screen-reader hint on each control speaks the held function, so the rule holds
without sight (`docs/accessibility.md`).

## No menus, only layers

One hold opens one line and two values; ± edits; release commits. Nothing is more
than one hold away. The face is code — SVG and views — so depth costs no bundle
and no storage. The only heavy things are audio (device-local) and they stay that
way.

## Five LED states

| State | Means | Example |
|-------|-------|---------|
| **Off** | available, unused | an empty step |
| **Dim** | set, not active | a take that exists but is not playing |
| **Lit** | active now | playing, or the selected mode |
| **Hot** | attention, limit, danger | record armed, loop points, tape end |
| **Blinking** | waiting for you | IN set with no OUT |

Colour carries meaning but never alone — every state also has a word, a shape, or
a spoken form. Red is record/armed; amber is loop points and limits; white is
playing/locked; grey is available.

**Stacks, not dots, for anything you play:** a step's velocity is a stack of up to
four cells, read at a glance like the Aira compacts. The ten-dot ladder remains
the meter primitive.

## Two postures

- **Hold** — portrait. Wheel dominant, controls around it, one hand. The
  instrument.
- **Bench** — landscape. Wheel as jog wheel on the left, steps or pads on the
  right, display in the centre. The editor.

Both are first-class; neither is a fallback. The wheel-as-editor thesis is most
obvious in Bench, where the wheel sits where a jog wheel sits on a video or
broadcast controller.

## Voice

Labels are engraved and short: one word or one number, upper case, no sentences on
the face. Spoken phrases are the opposite — plain, complete, and specific
("Loop in, zero twelve point four"). The face is a machine; the voice is a
colleague.

## What we are not

Not a stylised copy of any hardware, including the machine that inspired the
layout. The ergonomics are borrowed on purpose — wheels sit where hands expect
them — but the identity is TRNV: the wheel is the instrument, tape physics are the
behaviour, and the panel is line art rather than a replica.
