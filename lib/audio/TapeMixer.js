// Plays the recorded takes through the phone's speaker, kept in step with the tape position.
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';

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

  const drop = (id) => {
    const e = entries[id];
    delete entries[id];
    if (!e) return;
    try { e.player.pause(); } catch (err) {}
    try { e.player.remove(); } catch (err) {}
  };

  // items: from buildItems. pos: tape seconds. playing: whether tape is moving forward at play speed.
  const sync = (items, pos, playing, rate) => {
    const list = items || [];
    const wanted = {};
    list.forEach((it) => { wanted[it.id] = true; });
    Object.keys(entries).forEach((id) => { if (!wanted[id]) drop(id); });
    // Tape speed, not a 0.5–2 "rate": a hand on the reel can drag the tape down
    // to a crawl or flick it up to four times, and the pitch follows the tape
    // (setPlaybackRate is called without a pitch-correction quality on purpose).
    const r = Math.max(0.25, Math.min(4, Math.round((Number(rate) || 1) * 100) / 100));

    list.forEach((it) => {
      let e = entries[it.id];
      if (!e) {
        try {
          e = { player: createAudioPlayer({ uri: it.uri }), on: false, vol: -1, rate: -1 };
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
          e.player.volume = it.volume;
          e.vol = it.volume;
        }
        if (e.rate !== r) {
          if (typeof e.player.setPlaybackRate === 'function') e.player.setPlaybackRate(r);
          e.rate = r;
        }
        // The tape's position is the truth. A hand on the reel moves the
        // playhead faster than any seek loop can follow, so if the audio has
        // drifted off it — a scrub, or a speed change while it was already
        // running — pull the audio back onto the playhead.
        if (shouldPlay && e.on) {
          const here = typeof e.player.currentTime === 'number' ? e.player.currentTime : offset;
          if (Math.abs(here - offset) > 0.3) {
            const s = e.player.seekTo(offset);
            if (s && s.catch) s.catch(() => {});
          }
        }
        if (shouldPlay && !e.on) {
          const s = e.player.seekTo(offset);
          if (s && s.catch) s.catch(() => {});
          e.player.play();
          e.on = true;
        } else if (!shouldPlay && e.on) {
          e.player.pause();
          e.on = false;
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
