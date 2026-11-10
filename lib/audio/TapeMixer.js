// Plays the recorded takes through the phone's speaker, kept in step with the tape position.
import { Platform } from 'react-native';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { syncReverse, stopReverse } from './ReverseTape';
import { resolveTakeUri } from './takeStore';

const isWeb = () => Platform.OS === 'web';

// One player per take. On the web that is a plain <audio> element built here
// rather than through expo-audio: the deck has to know that a track's player
// really started, and on web expo-audio's player keeps a global gate that can
// decline play() without telling anyone — which is how a four-track recorder
// ends up silent while the tape runs. Owning the element means play(), pause(),
// the rate and the pitch are all in this file.
function openPlayer(uri) {
  if (!isWeb() || typeof Audio === 'undefined') return createAudioPlayer({ uri });
  const el = new Audio(uri);
  el.preload = 'auto';
  return {
    el,
    play: () => {
      const p = el.play();
      if (p && p.catch) p.catch(() => {});
    },
    pause: () => {
      try { el.pause(); } catch (e) { /* already stopped */ }
    },
    seekTo: (t) => {
      try { el.currentTime = Math.max(0, t); } catch (e) { /* not seekable yet */ }
    },
    setPlaybackRate: (r, quality) => {
      try {
        el.playbackRate = r;
        // 'high' is expo-audio's spelling of "hold the pitch while the speed
        // changes"; on the element it is preservesPitch.
        el.preservesPitch = quality === 'high';
      } catch (e) { /* rate unsupported */ }
    },
    remove: () => {
      try {
        el.pause();
        el.removeAttribute('src');
        el.load();
      } catch (e) { /* already gone */ }
    },
    get volume() {
      return el.volume;
    },
    set volume(v) {
      try { el.volume = Math.max(0, Math.min(1, v)); } catch (e) { /* gone */ }
    },
    get currentTime() {
      return el.currentTime;
    },
    // Whether the element is actually running, so the mixer can find out that the
    // platform stopped it instead of assuming its own bookkeeping is the truth.
    get paused() {
      return el.paused;
    },
    get ended() {
      return el.ended;
    },
  };
}

// Turns a session's tracks into the list of takes that should be heard.
// `exclude` is a list of track indexes to leave out (the ones being recorded).
export function buildItems(tracks, exclude) {
  const skip = exclude || [];
  const out = [];
  (tracks || []).forEach((tr, i) => {
    if (!tr || skip.indexOf(i) >= 0) return;
    const takes = tr.takes || [];
    const take = takes.find((k) => k.id === tr.activeTakeId) || null;
    // The take's own field is only a hint: its blob URL dies with the page that
    // made it, so ask the store which copy is playable now.
    const uri = resolveTakeUri(take);
    if (!take || !uri) return;
    out.push({
      id: take.id,
      // Which track this came from, so the deck can work out what a bounce printed.
      track: i,
      uri,
      start: Number(take.start) || 0,
      duration: Number(take.duration) || 0,
      volume: typeof tr.level === 'number' ? Math.max(0, Math.min(1, tr.level)) : 0.85,
      // Tracks this take printed, when it is a bounce.
      sources: Array.isArray(take.sources) ? take.sources : null,
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
  // pitchLock: hold the key while the speed changes, instead of bending it.
  // A player can be paused out from under the mixer. Opening the microphone
  // changes the platform's audio session — iOS switches to play-and-record, and a
  // desktop headset drops from A2DP to its call profile — and the browser pauses
  // media without telling the page. The mixer's own `on` flag then lies: it
  // believes the take is already sounding, never issues play() again, and the
  // music stops exactly when you press record, which is the one moment a layered
  // pass cannot do without it. So believe the player, not the flag.
  const isStalled = (e) => {
    const player = e && e.player;
    if (!player) return false;
    try {
      if (typeof player.paused === 'boolean') return player.paused && !player.ended;
      if (player.el && typeof player.el.paused === 'boolean') return player.el.paused && !player.el.ended;
      // A native player reports its state a moment after a command, so give it
      // half a second before believing a pause.
      if (typeof player.playing === 'boolean') return !player.playing && Date.now() - (e.anchorAt || 0) > 500;
    } catch (err) {
      // If it cannot say, assume it is sounding rather than restart it every tick.
    }
    return false;
  };

  const sync = (items, pos, playing, rate, pitchLock) => {
    const lock = pitchLock === true;
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
      // A key change swaps the take for a pitched copy of it. The element
      // playing the old one has to go, or both would sound at once.
      const existing = entries[it.id];
      if (existing && existing.uri !== it.uri) drop(it.id);
      let e = entries[it.id];
      if (!e) {
        try {
          e = {
            player: openPlayer(it.uri),
            uri: it.uri,
            on: false,
            vol: -1,
            rate: -1,
            lock: !lock,
            anchorPos: 0,
            anchorAt: 0,
            gainNow: 0,
            fadeTimer: null,
          };
          entries[it.id] = e;
        } catch (err) {
          // Worth saying out loud: a take that cannot get a player is silence on
          // a track, and silence with no reason is the worst kind of bug.
          console.error('[mixer] could not open a player for take', it.id, err);
          return;
        }
      }
      const offset = pos - it.start;
      const inside = offset >= 0 && offset < it.duration;
      const shouldPlay = !!playing && inside;
      // Restart anything the platform stopped while it should still be sounding.
      // Bounded: a take whose audio is really gone (a blob URL from a page that has
      // since reloaded) cannot be coaxed back, and retrying it twenty times a
      // second forever is worse than leaving it silent.
      if (e.on && shouldPlay) {
        if (isStalled(e)) {
          e.stalls = (e.stalls || 0) + 1;
          if (e.stalls <= 8) e.on = false;
          else e.dead = true;
        } else {
          e.stalls = 0;
        }
      }
      if (e.dead) {
        try { e.player.pause(); } catch (err) { /* already stopped */ }
        return;
      }
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
        // The second argument is the pitch: 'high' holds the key while the speed
        // changes, which is what the deck's PITCH LOCK asks for, and 'low' lets
        // the key ride with the speed the way a tape does.
        if (e.rate < 0 || Math.abs(e.rate - Math.abs(r)) > 0.01 || e.lock !== lock) {
          if (typeof e.player.setPlaybackRate === 'function') {
            e.player.setPlaybackRate(Math.abs(r), lock ? 'high' : 'low');
          }
          e.rate = Math.abs(r);
          e.lock = lock;
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
        // a single failing player must not stop the others, but it should be
        // possible to find out why it failed
        console.error('[mixer] take failed', it.id, err);
      }
    });
  };

  const dispose = () => {
    Object.keys(entries).forEach(drop);
  };

  return { sync, dispose };
}

export default createMixer;
