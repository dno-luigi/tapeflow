# Roadmap

Each phase ships on its own and is testable on a phone before the next begins.
Scope is deliberately small; the ambition lives in the sequence, not in any single
release.

## Phase 0 — Identity (this pass)

Rename to TRNV: app name and slug, package, wordmark, README, worker's health
string, alert copy. Keep data identity (`tapeflow` Worker, D1, storage keys) —
see decisions 1 and 2. Five design documents land with it.

**Done when:** the app says TRNV everywhere a person can see it, tests pass, the
live build is healthy, and no stored session or recording is orphaned.

## Phase 1 — The wheel tells you where you are

Pure detent module (`lib/input/detents.js`) with hysteresis and velocity zones;
haptics on native; the spoken layer (`announce()` wrapper, verbosity setting,
accessible increment/decrement on the wheel and the ± pair).

**Done when:** detent tests pass; VoiceOver/TalkBack can change tempo, pitch and
loop points without sight; the owner confirms the feel on a device.

## Phase 2 — Sample

A WebAudio buffer engine beside the element player: decode takes to memory, fire
regions with envelopes. Slices are `{ takeId, start, end, gain, pitch }` stored on
the take. Pads replace the track strip in the SAMPLE lens; the wheel trims slice
edges with detents.

**Done when:** a recorded take can be sliced and fired from pads with no audible
gap between hits, and slices survive a reload.

## Phase 3 — Steps

16 steps, 4 tracks, one pattern, one page. Timing from a shared transport clock
(the lookahead scheduler the click already uses) — not `setInterval`. Pattern is
JSON inside the session row, so no schema change.

Then 64 steps as four pages with page LEDs and the wheel flipping pages.

**Done when:** a pattern plays in time with the click and the tape loop, survives
a reload, and step timing drifts no more than a few milliseconds over four bars.

## Phase 4 — Performance

Pattern chaining, mute/solo, render a performance to WAV (building on
`exportReel` and `bounce`), and Bench-mode editing as the default posture when
steps are present.

## Not now

- Cloud sync of audio (needs R2; today audio is device-local by design).
- Anything that forks the deck into separate "modes" with separate transports.
- Menus. Ever.
