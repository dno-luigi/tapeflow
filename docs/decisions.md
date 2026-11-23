# Decisions

One line per settled choice, with the reason and **who first said it**. The origin
column exists so an idea keeps its author: several of the best ones came from the
owner of the machine, not the agent.

| # | Decision | Why | Origin |
|---|----------|-----|--------|
| 1 | The app is called **TRNV** | Vowel-less "turn": a spin, a coinage, and the only clear candidate — WHORL already names a 16-step slicer, SPNDL is phonetically an existing jog-wheel music player, ARBR is taken in class 9 | user shortlist, cleared by agent |
| 2 | **Rename is identity only.** Worker name, D1 database, storage keys and the audio worklet keep `tapeflow` | They point at live data. Renaming the Worker creates a new origin, renaming the D1 database needs a migration, renaming localStorage/IndexedDB keys silently orphans every session and every recording | agent |
| 3 | Pitch is the tape's speed, never a rendered copy | Rendering a shifted WAV of every take froze the deck; varispeed bends key and tempo together like tape | user ("no chipmunk pitch shift") |
| 4 | **Every control has two faces:** a printed function and a held function, and the display announces the held function while it is held | Form and function stay equally apparent; it turns one knob into a control with depth instead of a knob plus a menu | **user** (the TEMPO hold) |
| 5 | **No menus, only layers.** One hold opens one line and two values; ± edits; release commits. Nothing is more than one hold away | Keeps the face a face; adds no screens, no assets, no storage | user constraint ("not a lot of menus") |
| 6 | LOOP keeps its points **on screen** while they are being set, and draws IN as soon as it exists | A hint that fades after two seconds looks like a control that did nothing | agent (from user's report) |
| 7 | A record length (1/2/4/8/16 bars) ends the pass on the bar and the region becomes the loop | A looper that needs no extra key and no points setting | user ("record to the bar") |
| 8 | One bar of count-in before a pass, mic opened **after** the count | The clicks are not in the take, and the take starts on the downbeat | user |
| 9 | Tempo drives a click track; a tempo that never sounds is decoration | Gives the BPM a job and the count-in a clock | agent |
| 10 | Meter reads the mix under the head; never a random walk | A meter that moves while the tape is silent is a lie — and the old OUT meter was exactly that | agent |
| 11 | Takes are mono; L and R ladders therefore read the same signal | Honest: the columns are real and will separate the day a stereo take reaches the mix | agent |
| 12 | **Accessibility is a design constraint, not a feature list** — haptics for geometry, speech for value, sound for musical truth; never colour alone | A wheel with detents and spoken values is usable without sight, which is a stronger claim than any visual polish | **user** |
| 13 | Eyes-up operation is the default; verbosity is a setting (Off / Landmarks / Everything) | Announcing every detent is a stutter; announcing on settle is information | agent |
| 14 | Steps are pages of 16, never a hardcoded 16 | 16 now, 64 later, without repainting the house | user (Aira-style) |
| 15 | Layouts are named: **Hold** (portrait) and **Bench** (landscape) | The reflow you noticed by turning the phone is a working posture, not an accident | user (discovery), agent (naming) |
| 16 | Detents shape values, never sound | Scrub stays continuous and audible; snapping is for edits | agent |

## Open

- Where the sampler's audio engine lands (element playback is right for long takes, wrong for sixteenth-note retriggering).
- Whether TRNV ships with a pattern per session or per track first.
- Bundle identifier: `app.tapeflow.recorder` until a store listing exists; free to change before the first submission.
