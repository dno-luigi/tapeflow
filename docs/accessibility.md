# Accessibility

The deck puts information out on four channels: sound, haptics, touch geometry,
and text. Three of them do not need eyes. This file is the contract that keeps
them honest.

## The law

**Haptics say geometry. Speech says value. Sound says musical truth.**

One channel answers one question, so nothing competes:

- *Where am I?* — the detent tick; a medium pulse at landmarks (beat, cue, loop
  point, page edge, zero).
- *What is it now?* — a spoken value, **after the wheel settles** (~300 ms idle)
  or when a landmark is crossed. Announce on commit, not on move: announcing every
  detent is a stutter, and a stutter is noise, and noise is what makes an
  interface unusable without sight.
- *Does it sound right?* — the tape, undented, exactly as it plays now.

## Never colour alone

Every LED state carries a word or a shape as well as a colour. The ladder is
invisible to the person we are designing for, and barely readable in sunlight by
everyone else. Five states: off, dim, lit, hot, blinking — each with a fixed
meaning (see `docs/design-language.md`).

## Screen readers

The mapping is not an invention: **VoiceOver's two-finger rotate and TalkBack's
swipe up/down are the gestures for an `adjustable` control — and that gesture is a
jog wheel.** The wheel is exposed as `adjustable` with increment/decrement
actions calling the same function the drag calls, so a blind user turns the wheel
with a gesture they already know.

Requirements:

- Every control has a label, a value, and a hint that says what the *hold* does.
- `accessibilityValue` reflects live state, formatted the same way the display
  writes it, so what is seen and what is spoken cannot drift.
- State changes that matter (record armed, loop set, take saved, microphone
  silent) are announced, not only drawn.

## Verbosity

A setting on the back panel: **Off / Landmarks / Everything**.

- Off — haptics only.
- Landmarks — announces at beats, cues, loop points, page edges, limits (default).
- Everything — every committed value.

## Limits, stated plainly

- **Haptics are native-only.** iOS Safari has no vibration API, so the web build
  cannot tick. That is a platform fact, not a bug to chase.
- **The level ladder is not announced continuously.** It has no action behind it;
  announcing it is chatter. The value worth speaking is "the microphone heard
  nothing", which the deck already says in words.
- **Device testing is the owner's.** VoiceOver on iOS and TalkBack on Android can
  be verified as firing here; "is this a good experience" cannot be checked
  without ears and hands on a phone.

## Definition of done, per control

A control is accessible when: it has a label; it reports a value; it can be
changed without sight or with a screen reader; the change is confirmed on at
least one non-visual channel; and it has a documented hold function the hint
speaks.
