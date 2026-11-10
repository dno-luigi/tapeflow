// Plays the recorded takes through the phone's speaker, kept in step with the tape position.
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { syncReverse, stopReverse } from './ReverseTape';

// Turns a session's tracks into the list of takes that should be heard.
// `exclude` is a list of track indexes to leave out (the ones being recorded).
export function buildItems(tracks, exclude) {
  const skip = exclude || [];
  const out = [];
  (tracks || []).forEach((tr, i) => {
    if (!tr || skip.indexOf(i) >= 0) return;
    const takes = tr.takes || [];
    const take = takes.find((k) => k.id === tr.activeTakeId) || null;
    if (!take || !take.uri) return;
    out.push({
      id: take.id,
      uri: take.uri,
      start: Number(take.start) || 0,
      duration: Number(take.duration) || 0,
      volume: typeof tr.level === 'number' ? Math.max(0, Math.min(1, tr.level)) : 0.85,
    });
  });
  return out;
}

export function createMixer() {
  const entries = {};

  try {
    const p = setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
    if (p && p.catch) p.catch(() => {});
  } catch (e) {
    // audio mode unavailable; playback still tries
  }

  // A level change over a few dozen milliseconds, on its own timer. The deck's
  // clock ticks 20 times a second, which is far too coarse to hide a jump in
  // volume — and a jump in volume is a click.
  const ramp = (e, target, ms, done) => {
    if (e.fadeTimer) {
      clearInterval(e.fadeTimer);
      e.fadeTimer = null;
    }
    const from = e.gainNow || 0;
    const steps = Math.max(1, Math.round(ms / 12));
    let i = 0;
    e.fadeTimer = setInterval(() => {
      i += 1;
      const k = Math.min(1, i / steps);
      e.gainNow = from + (target - from) * k;
      try { e.player.volume = e.gainNow; } catch (err) { /* already gone */ }
      if (k >= 1) {
        clearInterval(e.fadeTimer);
        e.fadeTimer = null;
        if (done) done();
      }
    }, 12);
  };

  const drop = (id) => {
    const e = entries[id];
    delete entries[id];
    if (!e) return;
    if (e.fadeTimer) {
      clearInterval(e.fadeTimer);
      e.fadeTimer = null;
    }
    try { e.player.pause(); } catch (err) {}
    try { e.player.remove(); } catch (err) {}
  };  // items: from buildItems. pos: tape seconds. playing: whether the tape is
  // moving with the sound on. rate: signed tape speed (negative is backwards).
  const sync = (items, pos, playing, rate) => {
    const list = items || [];
    const wanted = {};
    list.forEach((it) => { wanted[it.id] = true; });
    Object.keys(entries).forEach((id) => { if (!wanted[id]) drop(id); });

    const raw = Number(rate) || 1;
    // The reel's varispeed range: half speed to double, like the speed adjuster
    // on the recorder this is modelled on. Inside that window the take stays
    // clean and the pitch follows the hand; the range is bounded here as well as
    // on the deck so no caller can drag playback somewhere it sounds broken.
    const magnitude = Math.max(0.5, Math.min(2, Math.round(Math.abs(raw) * 100) / 100));
    const r = raw < 0 ? -magnitude : magnitude;

    // A media element cannot run backwards, so while the reel does, a reversed
    // copy of each take is what sounds (lib/audio/ReverseTape) and the elements
    // go quiet. Everything else — a stopped tape, forward playback — is the
    // element's job.
    if (!(playing && r < 0)) stopReverse();
    if (playing && r < 0) {
      Object.keys(entries).forEach((id) => {
        const e = entries[id];
        if (e && e.on) {
          try { e.player.pause(); } catch (err) { /* already stopped */ }
          e.on = false;
        }
      });
      syncReverse(list, pos, r);
      return;
    }

    list.forEach((it) => {
      let e = entries[it.id];
      if (!e) {
        try {
          e = {
            player: createAudioPlayer({ uri: it.uri }),
            on: false,
            vol: -1,
            rate: -1,
            anchorPos: 0,
            anchorAt: 0,
            gainNow: 0,
            fadeTimer: null,
          };
          entries[it.id] = e;
        } catch (err) {
          return;
        }
      }
      const offset = pos - it.start;
      const inside = offset >= 0 && offset < it.duration;
      const shouldPlay = !!playing && inside;
      try {
        if (e.vol !== it.volume) {
          e.vol = it.volume;
          if (e.on) {
            ramp(e, it.volume, 45);
          } else {
            try { e.player.volume = it.volume; } catch (err) { /* not playing */ }
            e.gainNow = it.volume;
          }
        }
        // Only nudge the rate when it really moved: setPlaybackRate on every
        // tick of a slow spin is itself a source of gravel.
        if (e.rate < 0 || Math.abs(e.rate - r) > 0.02) {
          if (typeof e.player.setPlaybackRate === 'function') e.player.setPlaybackRate(r);
          e.rate = r;
          e.anchorPos = offset;
          e.anchorAt = Date.now();
        }
        // The tape's position is the truth, but the player's own currentTime is
        // updated on a timer and lags behind the audio, so comparing against it
        // made this seek on almost every tick — which is heard as a stutter laid
        // over everything else. Work out where the audio should be from when it
        // started and how fast it has run instead, and only correct a real
        // divergence (a scrub, or a speed change it could not follow).
        if (shouldPlay && e.on) {
          const elapsed = (Date.now() - e.anchorAt) / 1000;
          const expected = e.anchorPos + elapsed * Math.abs(r);
          if (Math.abs(expected - offset) > 0.3) {
            const s = e.player.seekTo(offset);
            if (s && s.catch) s.catch(() => {});
            e.anchorPos = offset;
            e.anchorAt = Date.now();
          }
        }
        if (shouldPlay && !e.on) {
          const s = e.player.seekTo(offset);
          if (s && s.catch) s.catch(() => {});
          e.anchorPos = offset;
          e.anchorAt = Date.now();
          // Start from silence and come up: play() on a paused element is a step
          // in the signal, and this happens on every start and every re-entry
          // into a take.
          try { e.player.volume = 0; } catch (err) { /* not playing */ }
          e.gainNow = 0;
          e.player.play();
          e.on = true;
          ramp(e, it.volume, 40);
        } else if (!shouldPlay && e.on) {
          e.on = false;
          ramp(e, 0, 35, () => {
            if (!e.on) {
              try { e.player.pause(); } catch (err) { /* already stopped */ }
            }
          });
        }
      } catch (err) {
        // a single failing player must not stop the others
      }
    });
  };

  const dispose = () => {
    Object.keys(entries).forEach(drop);
  };

  return { sync, dispose };
}

export default createMixer;
