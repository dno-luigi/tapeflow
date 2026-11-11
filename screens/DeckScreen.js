import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, Text, StatusBar, Alert, Animated, PanResponder, Platform, useWindowDimensions, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Line, Polygon } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { useAudioRecorder, RecordingPresets, AudioModule, setAudioModeAsync } from 'expo-audio';
import { useTheme } from '../ui/theme';
import { AppImage } from '../ui/kit';
import { ART } from '../constants/artwork';
import { useStudio } from '../store/StudioContext';
import { createMixer, buildItems, supersedeSkip } from '../lib/audio/TapeMixer';
import EngravedText from '../components/EngravedText';
import VUMeter from '../components/VUMeter';
import { pickAudioFile, canImportAudio } from '../lib/audio/importTake';
import { micUnavailableReason, startMicTake, stopMicTake, micTakeLevel } from '../lib/audio/recordTake';
import { renderBounce } from '../lib/audio/bounce';
import { takeAudioReady } from '../lib/audio/takeStore';
import { ObsidianBackdrop, GlassPanel, GlassSpecular, glassStroke, glassFill } from '../ui/glass';
import GlassReel from '../components/GlassReel';
import { shiftedUri } from '../lib/audio/keyShift';
import { exportReel, canExport } from '../lib/audio/exportReel';
import { rememberTakeAudio, hydrateTakeAudio } from '../lib/audio/takeStore';
import { tapeTimeAt } from '../lib/audio/scrub';

// Wheel physics. One turn of the reel moves SEC_PER_REV seconds of tape at normal speed.
const NORMAL = 120; // degrees per second at 1x play speed
const SEC_PER_REV = 3;
const MAXV = 1440; // 12x
// The reel's varispeed range, the same one the field recorder it is modelled on
// offers: half speed to double. Inside it the take bends in pitch with the hand,
// which is the whole point of the wheel. Past it the tape is spooling rather than
// being played, so the sound drops out — and half speed is as far down as the
// sound goes, rather than smearing into mud.
const PLAYABLE_X = 2;
const SLOWEST_X = 0.5;
const CAPACITY = 2400; // seconds of tape on the reel (40 minutes)
const MODES = { stop: 0, rec: NORMAL, rew: -MAXV, ff: MAXV };
// Fine controls, not presets: the speed moves one percent at a time across the
// reel's whole range and the key five cents at a time, and both can be dragged
// to anywhere in between.
const SPEED_MIN = 0.5;
const SPEED_MAX = 2;
const SPEED_STEP = 0.01;
const KEY_MIN = -12;
const KEY_MAX = 12;
const KEY_STEP = 0.05;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const fmt = (s) => {
  const v = Math.max(0, s || 0);
  const m = Math.floor(v / 60);
  const sec = Math.floor(v % 60);
  const tenth = Math.floor((v * 10) % 10);
  return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0') + '.' + tenth;
};
const fmtRem = (s) => {
  const v = Math.max(0, Math.round(s));
  return String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0');
};
const fmtShort = (s) => {
  const v = Math.max(0, Math.round(s));
  return Math.floor(v / 60) + ':' + String(v % 60).padStart(2, '0');
};
const safe = (fn) => { try { return fn(); } catch (e) { return undefined; } };
// Takes are named by the caller so their audio can be filed under the same name.
const newTakeId = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// A ring of grip marks around the reel, turning with it.
function Bezel({ size, color, accent }) {
  const marks = [];
  for (let i = 0; i < 72; i += 1) {
    const a = ((i * 5) * Math.PI) / 180;
    const major = i % 6 === 0;
    const r1 = major ? 44.5 : 46;
    const r2 = 48.6;
    marks.push(
      <Line
        key={i}
        x1={50 + r1 * Math.sin(a)}
        y1={50 - r1 * Math.cos(a)}
        x2={50 + r2 * Math.sin(a)}
        y2={50 - r2 * Math.cos(a)}
        stroke={i === 0 ? accent : color}
        strokeWidth={major ? 0.9 : 0.5}
      />
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" style={StyleSheet.absoluteFill}>
      {marks}
    </Svg>
  );
}

export default function DeckScreen() {
  const t = useTheme();
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const studio = useStudio() || {};
  const sessions = studio.sessions || [];
  const settings = studio.settings || {};
  const current = sessions.find((s) => s.id === studio.currentSessionId) || null;
  const tracks = [0, 1, 2, 3].map((i) => (current && current.tracks && current.tracks[i]) || { armed: false, takes: [] });
  const cues = (current && current.cues) || [];
  const recorded = (current && current.duration) || 0;

  const [mode, setMode] = useState('stop');
  const [hud, setHud] = useState({ pos: 0, vel: 0 });
  const [grabbed, setGrabbed] = useState(false);
  const [offset, setOffset] = useState(0);
  const [legendMsg, setLegendMsg] = useState('');
  const [stripW, setStripW] = useState(300);
  const [recFrom, setRecFrom] = useState(0);
  // How fast the tape runs when no hand is on the reel, and how far the take is
  // moved in key on top of that. `lock` decides whether a speed change keeps the
  // key (a speed changer) or bends it (a tape).
  // `semis` is the key on the readout, `semisHeard` is the key the audio is at:
  // a key change is rendered into the take, so the sound follows once the hand
  // has settled instead of re-rendering on every pixel of a drag.
  // Whether the device has been searched for each take's audio yet. Until it has,
  // a take is not "missing", it is simply not loaded.
  const [audioChecked, setAudioChecked] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [semis, setSemis] = useState(0);
  const [semisHeard, setSemisHeard] = useState(0);
  const [lock, setLock] = useState(false);
  const speedRef = useRef(1);
  const semisRef = useRef(0);
  const exportBusy = useRef(false);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const mixerRef = useRef(null);
  if (!mixerRef.current) mixerRef.current = createMixer();
  const syncRef = useRef(() => {});
  const recBusy = useRef(false);
  const noInputWarned = useRef(false);

  const angleVal = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const msgTimer = useRef(null);
  const lastStop = useRef(0);
  const finishRef = useRef(() => {});
  const phys = useRef({
    angle: 0, vel: 0, pos: 0, dragging: false, locked: false, mode: 'stop',
    lastMoveT: 0, lastA: 0, hapticAcc: 0, recStart: 0, recTracks: [],
  }).current;

  const flash = (m) => {
    setLegendMsg(m);
    if (msgTimer.current) clearTimeout(msgTimer.current);
    msgTimer.current = setTimeout(() => setLegendMsg(''), 2400);
  };

  useEffect(() => {
    if (studio.ready && !current && sessions.length === 0 && typeof studio.createSession === 'function') {
      safe(() => studio.createSession());
    }
    // eslint-disable-next-line
  }, [studio.ready, sessions.length]);

  // After a reload, every take recorded in an earlier page has a blob URL that no
  // longer resolves. Read the audio back off the device so those tracks can be
  // heard again instead of showing PLAYS over silence.
  useEffect(() => {
    if (!studio.ready || !sessions.length) return;
    let live = true;
    hydrateTakeAudio(sessions)
      .catch(() => {})
      // Only now is a take without audio really without audio, rather than not yet read.
      .then(() => { if (live) setAudioChecked(true); });
    return () => { live = false; };
    // eslint-disable-next-line
  }, [studio.ready, sessions.length, studio.currentSessionId]);

  // While a pass is being made, follow the microphone for the meter, and say so
  // plainly if it is delivering nothing at all. Silence at the input is the one
  // cause of "no sound" that looks exactly like a recorder with no audio in it.
  useEffect(() => {
    if (mode !== 'rec') return undefined;
    const id = setInterval(() => {
      const lvl = micTakeLevel();
      const recent = lvl ? lvl.recent : 0;
      setHud((h) => (h.mic === recent ? h : { ...h, mic: recent }));
      if (lvl && lvl.peak === 0 && lvl.seconds > 1.2 && !noInputWarned.current) {
        noInputWarned.current = true;
        flash('NO INPUT · THE MIC HEARS NOTHING');
      }
    }, 100);
    return () => clearInterval(id);
    // eslint-disable-next-line
  }, [mode]);

  // Keeps the speaker in step with the tape: plays each track's active take at
  // the right spot, at the speed the reel is actually turning.
  //
  // The reel IS the transport. Hold it still and the take stops; drag it slowly
  // and the take plays back pitched down, flick it and the voice speeds up and
  // rises, exactly like a hand on a tape spool. Spinning it backwards is a
  // rewind, which cannot be read backwards, so that is silent while the tape
  // runs in reverse. Beyond PLAYABLE_X the tape is just spooling.
  syncRef.current = () => {
    const p = phys;
    const speed = p.vel / NORMAL; // signed: negative is backwards
    const live = p.mode === 'play' || p.mode === 'rec';
    const magnitude = Math.abs(speed);
    // Stopped means silent, however the reel is turning: only a running tape is
    // heard. Play, and the hand sets the speed in either direction.
    const going = live && magnitude > 0.12 && magnitude <= PLAYABLE_X;
    const clamped = Math.min(PLAYABLE_X, Math.max(SLOWEST_X, magnitude));
    const rate = going ? (speed < 0 ? -1 : 1) * clamped : 0;
    // A bounced take carries the tracks it printed, so those tracks are left out
    // while it plays. The printed backing and the live one together is the music
    // twice over — the one failure mode a bounce has.
    const skip = supersedeSkip(tracks, p.mode === 'rec' ? p.recTracks : []);
    const items = buildItems(tracks, skip).map((it) =>
      // A key change plays a pitched copy of the take, rendered once; until that
      // copy is ready the original keeps playing, so the tape never goes silent
      // for it while it renders.
      semisHeard ? { ...it, uri: shiftedUri(it.uri, semisHeard) || it.uri } : it
    );
    try {
      mixerRef.current.sync(items, p.pos, going, rate, lock);
    } catch (e) {
      // Never silently: a mixer that throws is a tape that stops sounding.
      console.error('[deck] mixer sync failed', e);
    }
  };

  // Stops the microphone and saves one take (with its audio file) per armed track.
  finishRef.current = () => {
    if (phys.mode !== 'rec') return;
    const dur = phys.pos - phys.recStart;
    const start = phys.recStart;
    const list = phys.recTracks.slice();
    phys.recTracks = [];
    const finish = async () => {
      let uri = null;
      let peak = null;
      try {
        if (Platform.OS === 'web') {
          const take = await stopMicTake();
          uri = take && take.uri;
          peak = take && typeof take.peak === 'number' ? take.peak : null;
        } else {
          await recorder.stop();
          uri = recorder.uri;
        }
      } catch (e) {
        uri = null;
      }
      safe(() => setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {}));
      // A dub can be short: a drum stab or a single word is the point of layering
      // a part, and a whole second of minimum threw those away. This still
      // ignores a tap that was never meant to record anything.
      if (dur < 0.4) {
        flash('TOO SHORT · NOTHING SAVED');
        return;
      }
      if (!uri) {
        Alert.alert('Nothing was captured', 'The microphone did not return any audio. Try recording again.');
        return;
      }
      // Print the music into the take when the deck is set to bounce. The pass then
      // stands on its own wherever it is played, and the tracks it printed are left
      // out of the mix while it is heard.
      let sources = null;
      let sourcesMissing = 0;
      if (settings.bounce && Platform.OS === 'web') {
        try {
          const from = tracks
            .map((tr, i) => i)
            .filter((i) => list.indexOf(i) < 0)
            .filter((i) => {
              const tr = tracks[i] || {};
              const tk = (tr.takes || []).find((x) => x.id === tr.activeTakeId) || null;
              if (!tk || !tk.uri) return false;
              // Only the takes the head actually crossed while the pass was running.
              return (Number(tk.start) || 0) < start + dur && (Number(tk.start) || 0) + (Number(tk.duration) || 0) > start;
            });
          if (from.length) {
            const printed = await renderBounce({
              micUri: uri,
              start,
              duration: Math.round(dur * 10) / 10,
              rate: speed || 1,
              tracks,
              sourceIndexes: from,
            });
            if (printed && printed.uri) {
              uri = printed.uri;
              peak = printed.peak;
              // What actually made it in, not what was offered: a track whose audio
              // is gone cannot be printed and must not be excluded from the mix.
              sources = printed.sources && printed.sources.length ? printed.sources : null;
              sourcesMissing = sources ? from.length - sources.length : 0;
            }
          }
        } catch (e) {
          // Keep the microphone take rather than losing the pass to a failed print.
          console.error('[deck] bounce failed, keeping the microphone take', e);
          sources = null;
        }
      }
      try {
        // One decimal, like the import path: a 3.54s take should stop where the
        // audio stops, not 0.46s past it in the mixer.
        const length = Math.round(dur * 10) / 10;
        const takeId = newTakeId();
        list.forEach((i) => studio.addTake && studio.addTake(i, length, undefined, { uri, start, id: takeId, peak, sources }));
        // Write the audio to the device as soon as it exists: a blob URL dies with
        // the page, and a take that cannot be heard after a reload is not saved.
        safe(() => rememberTakeAudio(takeId, uri));
        // A pass the microphone heard nothing on is still saved — its place and
        // length on the tape are real — but it says so rather than looking like
        // audio that has gone missing.
        flash(sources ? 'BOUNCED · ' + fmtShort(dur) + (sourcesMissing > 0 ? ' · ' + sourcesMissing + ' HAD NO AUDIO' : '') : peak === 0 ? 'SILENT TAKE · THE MIC HEARD NOTHING' : 'TAKE SAVED · ' + fmtShort(dur));
      } catch (e) {
        Alert.alert('Could not save the take', (e && e.message) || 'Try again.');
      }
    };
    finish();
  };

  const toMode = (m) => {
    if (phys.mode === 'rec' && m !== 'rec') finishRef.current();
    phys.mode = m;
    setMode(m);
  };

  // Stop the tape when leaving the deck, so nothing keeps playing or recording behind another screen.
  useEffect(() => {
    const off = nav.addListener('blur', () => {
      if (phys.mode !== 'stop') toMode('stop');
    });
    return off;
    // eslint-disable-next-line
  }, [nav]);

  useEffect(() => {
    return () => {
      if (phys.mode === 'rec') safe(() => (Platform.OS === 'web' ? stopMicTake() : recorder.stop()));
      safe(() => stopRepeat());
      safe(() => mixerRef.current && mixerRef.current.dispose());
    };
    // eslint-disable-next-line
  }, []);

  // The animation loop: the reel always turns at its own speed, and tape position follows it.
  useEffect(() => {
    let raf;
    let prev = Date.now();
    let hudT = 0;
    const frame = () => {
      const now = Date.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - prev) / 1000));
      prev = now;
      const p = phys;
      if (p.dragging) {
        if (now - p.lastMoveT > 90) p.vel *= 0.6;
      } else {
        if (p.mode === 'rec') {
          p.vel = NORMAL;
        } else {
          const target = p.mode === 'play' ? NORMAL * speedRef.current : MODES[p.mode] || 0;
          const k = Math.abs(target) > Math.abs(p.vel) ? 5 : target === 0 ? 1.3 : 2.5;
          p.vel += (target - p.vel) * (1 - Math.exp(-k * dt));
          if (Math.abs(target - p.vel) < 1) p.vel = target;
        }
        p.angle = (p.angle + p.vel * dt) % 360;
        p.pos += (p.vel / NORMAL) * dt;
        if (p.pos <= 0) {
          p.pos = 0;
          if (p.vel < 0) p.vel = 0;
          if (p.mode === 'rew') { phys.mode = 'stop'; setMode('stop'); }
        } else if (p.pos >= CAPACITY) {
          p.pos = CAPACITY;
          if (p.vel > 0) p.vel = 0;
          if (p.mode === 'play' || p.mode === 'ff' || p.mode === 'rec') {
            if (p.mode === 'rec') finishRef.current();
            phys.mode = 'stop';
            setMode('stop');
          }
        }
        angleVal.setValue(p.angle);
      }
      if (now - hudT > 50) {
        hudT = now;
        setHud({ pos: p.pos, vel: p.vel });
        syncRef.current();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      if (msgTimer.current) clearTimeout(msgTimer.current);
    };
    // eslint-disable-next-line
  }, []);

  // Grabbing and turning the reel by hand.
  const wheelSize = useRef(300);
  const wheel = useRef(PanResponder.create({
    // Capture on touch-down, not just on start. Without the capture phase the
    // deck's own swipe gesture could take the touch away mid-turn and the reel
    // simply stopped: the hand was moving, the wheel was not.
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      const c = wheelSize.current / 2;
      const { locationX, locationY } = e.nativeEvent;
      phys.lastA = (Math.atan2(locationY - c, locationX - c) * 180) / Math.PI;
      phys.lastMoveT = Date.now();
      phys.hapticAcc = 0;
      if (phys.mode === 'rec') {
        phys.locked = true;
        flash('STOP RECORDING TO SCRUB');
        return;
      }
      phys.locked = false;
      phys.dragging = true;
      setGrabbed(true);
      Haptics.selectionAsync().catch(() => {});
    },
    onPanResponderMove: (e) => {
      if (phys.locked || !phys.dragging) return;
      const c = wheelSize.current / 2;
      const { locationX, locationY } = e.nativeEvent;
      const a = (Math.atan2(locationY - c, locationX - c) * 180) / Math.PI;
      let d = a - phys.lastA;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      phys.lastA = a;
      const now = Date.now();
      const dt = Math.max(8, now - phys.lastMoveT) / 1000;
      phys.lastMoveT = now;
      phys.angle = (phys.angle + d) % 360;
      angleVal.setValue(phys.angle);
      phys.pos = Math.max(0, Math.min(CAPACITY, phys.pos + d / NORMAL));
      const inst = d / dt;
      phys.vel = Math.max(-MAXV, Math.min(MAXV, phys.vel * 0.6 + inst * 0.4));
      phys.hapticAcc += Math.abs(d);
      if (phys.hapticAcc >= 30) {
        phys.hapticAcc = 0;
        Haptics.selectionAsync().catch(() => {});
      }
    },
    onPanResponderRelease: () => { phys.dragging = false; phys.locked = false; setGrabbed(false); },
    onPanResponderTerminate: () => { phys.dragging = false; phys.locked = false; setGrabbed(false); },
  })).current;

  // Flipping to the back panel by swiping is kept, but only from the edge of the
  // screen. The reel owns the middle: a gesture that starts on it belongs to the
  // wheel, at every speed, and nothing else may claim it.
  const swipe = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (e, g) => {
      const fromEdge = g.x0 <= 32 || g.x0 >= W - 32;
      return fromEdge && Math.abs(g.dx) > 40 && Math.abs(g.dx) > Math.abs(g.dy) * 2;
    },
    onPanResponderRelease: (e, g) => { if (g.dx < -60) nav.navigate('Back Panel'); },
  })).current;

  // Dragging the timeline scrubs the tape.
  //
  // The reel is precise but slow across a long reel: a pass that starts at 6:12
  // should be pointable rather than spun to. Everything read in these handlers
  // comes off a ref, because a responder is created once and its closures would
  // otherwise keep the first render's span and layout forever.
  const stripRef = useRef(null);
  const stripBox = useRef({ left: 0, width: 300 });
  const stripMeta = useRef({ span: 60, width: 300 });

  const measureStrip = () => {
    const node = stripRef.current;
    if (!node || typeof node.measureInWindow !== 'function') return;
    node.measureInWindow((x, y, w) => {
      stripBox.current = { left: x, width: w || stripMeta.current.width };
    });
  };

  const headTo = (pageX) => {
    // A coordinate the platform did not supply must not move the head: a head
    // position of NaN stops the tape, empties the bar and reads NAN:NAN, and the
    // deck looks dead while it says it is playing.
    const t = tapeTimeAt(pageX, stripBox.current, stripMeta.current.span);
    if (t === null) return;
    phys.pos = Math.max(0, Math.min(CAPACITY, t));
    // The hand owns the tape head while it is down: the animation loop leaves the
    // position alone and lets the speed fall away, so the finger is not fighting
    // the transport for it.
    phys.dragging = true;
    phys.lastMoveT = Date.now();
    setHud({ pos: phys.pos, vel: phys.vel });
  };

  const stripPan = useRef(
    PanResponder.create({
      // Claimed on movement, not on touch-down: a tap still jumps, a cue flag keeps
      // its hold-to-delete, and a drag anywhere on the strip scrubs.
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (e, g) => Math.abs(g.dx) > 3,
      onMoveShouldSetPanResponderCapture: (e, g) => Math.abs(g.dx) > 3,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e, g) => {
        if (phys.mode === 'rec') {
          // Moving the head mid-pass would tear the take being written.
          phys.stripLocked = true;
          flash('STOP RECORDING TO SCRUB');
          return;
        }
        phys.stripLocked = false;
        Haptics.selectionAsync().catch(() => {});
        headTo(typeof g.moveX === 'number' ? g.moveX : e.nativeEvent.pageX);
      },
      onPanResponderMove: (e, g) => {
        if (phys.stripLocked) return;
        headTo(typeof g.moveX === 'number' ? g.moveX : e.nativeEvent.pageX);
      },
      onPanResponderRelease: () => { phys.dragging = false; phys.stripLocked = false; },
      onPanResponderTerminate: () => { phys.dragging = false; phys.stripLocked = false; },
    })
  ).current;

  // Transport
  const onPlay = () => {
    Haptics.selectionAsync().catch(() => {});
    if (mode === 'play') { toMode('stop'); return; }
    if (phys.pos >= CAPACITY - 0.5) phys.pos = 0;
    const heard = buildItems(tracks, []);
    if (heard.length === 0) flash('NOTHING RECORDED YET · ARM A TRACK AND REC');
    toMode('play');
  };
  const onRew = () => {
    Haptics.selectionAsync().catch(() => {});
    toMode(mode === 'rew' ? 'stop' : 'rew');
  };
  const onFF = () => {
    Haptics.selectionAsync().catch(() => {});
    toMode(mode === 'ff' ? 'stop' : 'ff');
  };
  const onStop = () => {
    Haptics.selectionAsync().catch(() => {});
    const now = Date.now();
    toMode('stop');
    if (now - lastStop.current < 500) {
      phys.pos = 0;
      phys.vel = 0;
      setHud({ pos: 0, vel: 0 });
      setOffset(0);
      flash('BACK TO START');
    }
    lastStop.current = now;
  };
  const onRecord = async () => {
    if (mode === 'rec') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
      toMode('stop');
      return;
    }
    if (recBusy.current) return;
    const armed = tracks.map((tr, i) => (tr.armed ? i : -1)).filter((i) => i >= 0);
    // A four-track recorder layers, so pressing record has to land on a track and
    // leave the others playing — never stop to ask for an arm first. If no track
    // has been chosen, the take goes to the first one still empty.
    let target = armed.length ? armed[0] : -1;
    if (target < 0) {
      const empty = tracks.map((tr, i) => ((tr.takes || []).length ? -1 : i)).filter((i) => i >= 0);
      target = empty.length ? empty[0] : 0;
    }
    // Exactly one record target. A pass that wrote over several tracks at once
    // would wipe the very track it was supposed to play along with, which is how
    // a layered take turns into silence.
    armed.forEach((j) => {
      if (j !== target) safe(() => studio.updateTrack && studio.updateTrack(j, { armed: false }));
    });
    if (!tracks[target].armed) safe(() => studio.updateTrack && studio.updateTrack(target, { armed: true }));
    if (phys.pos >= CAPACITY - 1) {
      flash('TAPE IS FULL');
      return;
    }
    recBusy.current = true;
    try {
      if (Platform.OS === 'web') {
        // The browser path lives in lib/audio/recordTake so the reason a take
        // cannot start survives to the screen. expo-audio answers every web
        // failure with a bare "not granted" — plain http, a blocked microphone
        // and a machine with no input device all look the same through it.
        const blocked = micUnavailableReason();
        if (blocked) {
          flash(blocked.short);
          Alert.alert('The microphone cannot start', blocked.message);
          return;
        }
        // Record at the rate and depth the back panel is set to, losslessly.
        await startMicTake({
          sampleRate: Number(settings.sampleRate) || 48000,
          // 24-bit PCM: the one WAV a browser's own player will play everywhere,
          // including Safari, which can refuse a 32-bit float file and then sound
          // exactly like a recorder with no audio in it.
          float32: false,
        });
      } else {
        const perm = await AudioModule.requestRecordingPermissionsAsync();
        if (!perm || !perm.granted) {
          // The legend carries it too: on the web an Alert can be swallowed, and a
          // record key that does nothing is the worst way to learn this.
          flash('MICROPHONE IS OFF');
          Alert.alert('Microphone is off', 'Allow microphone access for this app in Settings to record sound.');
          return;
        }
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
        await recorder.prepareToRecordAsync();
        recorder.record();
      }
    } catch (e) {
      // Say why it refused. "Could not start recording" alone leaves nothing to
      // act on, and on the web there is no console in front of most people.
      const why = String((e && e.message) || 'unknown error');
      flash((e && e.short) || 'COULD NOT START RECORDING');
      console.error('[deck] could not start recording', e);
      Alert.alert('Could not start recording', why);
      return;
    } finally {
      recBusy.current = false;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    phys.recStart = phys.pos;
    phys.recTracks = [target];
    setRecFrom(phys.pos);
    noInputWarned.current = false;
    toMode('rec');
  };

  // Audio off a file rather than off a microphone: the take lands at the tape
  // head on every armed track (or track 1 if none is armed), and from there it
  // behaves exactly like a recording.
  const onImport = async () => {
    if (mode === 'rec') {
      flash('STOP RECORDING FIRST');
      return;
    }
    if (phys.pos >= CAPACITY - 1) {
      flash('TAPE IS FULL');
      return;
    }
    const armed = tracks.map((tr, i) => (tr.armed ? i : -1)).filter((i) => i >= 0);
    const targets = armed.length ? [armed[0]] : [0];
    let picked;
    try {
      picked = await pickAudioFile();
    } catch (e) {
      if (e && e.code === 'cancelled') return;
      flash('COULD NOT READ THAT FILE');
      Alert.alert('Could not read that file', (e && e.message) || 'Try another audio file.');
      return;
    }
    const left = Math.max(0, CAPACITY - phys.pos);
    // One decimal, not whole seconds: a two-second imported take should stop
    // where the audio stops, not up to a second past it.
    const length = Math.min(Math.max(0.5, Math.round((picked.duration || 30) * 10) / 10), Math.max(0.5, Math.round(left * 10) / 10));
    try {
      const takeId = newTakeId();
      targets.forEach((i) => studio.addTake && studio.addTake(i, length, undefined, { uri: picked.uri, start: phys.pos, id: takeId }));
      safe(() => rememberTakeAudio(takeId, picked.uri));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      flash('TAKE SAVED · ' + fmtShort(length));
    } catch (e) {
      Alert.alert('Could not save the take', (e && e.message) || 'Try again.');
    }
  };

  const toggleArm = (i) => {
    Haptics.selectionAsync().catch(() => {});
    if (mode === 'rec') { flash('STOP BEFORE CHANGING ARMS'); return; }
    if (typeof studio.updateTrack !== 'function') return;
    const wasArmed = !!tracks[i].armed;
    // One target at a time: arming a track lets go of the others, so a second
    // pass lays over the first instead of muting it. This is the whole of
    // layered recording — everything not being written keeps playing.
    tracks.forEach((tr, j) => {
      if (j !== i && tr.armed) safe(() => studio.updateTrack(j, { armed: false }));
    });
    safe(() => studio.updateTrack(i, { armed: !wasArmed }));
  };

  const dropCue = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (typeof studio.addCue === 'function') {
      safe(() => studio.addCue(phys.pos));
      flash('CUE MARKED AT ' + fmtShort(phys.pos));
    }
  };

  const jumpTo = (time) => {
    if (mode === 'rec') { flash('STOP RECORDING TO JUMP'); return; }
    if (!Number.isFinite(time)) return;
    Haptics.selectionAsync().catch(() => {});
    phys.pos = Math.max(0, Math.min(CAPACITY, time));
    setHud({ pos: phys.pos, vel: phys.vel });
  };

  const askDelete = (cue, idx) => {
    Alert.alert('Delete ' + (cue.label || 'cue ' + (idx + 1)) + '?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => safe(() => studio.removeCue && studio.removeCue(cue.id)) },
    ]);
  };

  // Layout
  const chrome = insets.top + insets.bottom + 44 + 64 + 40 + 64 + 56 + 64 + 28 + 64;
  const size = Math.max(170, Math.min(W - 32, H - chrome));
  wheelSize.current = size;

  const span = (() => {
    // A span that is not a number takes the whole timeline with it, so the deck
    // keeps a real length whatever the session reports.
    const reach = Math.max(Number.isFinite(recorded) ? recorded : 0, Number.isFinite(hud.pos) ? hud.pos : 0);
    return Math.max(60, Math.ceil((reach + 10) / 30) * 30);
  })();
  const rawSr = Number(settings.sampleRate) || 96;
  const sr = rawSr > 1000 ? Math.round(rawSr / 1000) : rawSr;
  const anyArmed = tracks.some((tr) => tr.armed);
  const recording = mode === 'rec';
  const display = Math.max(0, hud.pos - offset);
  const speedX = Math.abs(hud.vel) / NORMAL;
  // Read the wheel out as a speed adjuster, the way the recorder it is modelled
  // on does: 100% is the tape at its own speed, 50% is half and 200% is double.
  // The number is clamped to that range, because a hand can flick faster than the
  // tape is allowed to follow and the readout should say what is being heard.
  const speedPct = Math.round(Math.min(PLAYABLE_X, Math.max(SLOWEST_X, speedX)) * 100);
  const moving = Math.abs(hud.vel) >= 1;
  // While the tape is running the reel is the truth, so the readout follows the
  // hand; stopped, it shows the speed the deck is set to. Both are shown at the
  // resolution they are set at — a percent and five cents.
  const speedText = (Math.round(speed * 1000) % 10 === 0 ? String(Math.round(speed * 100)) : (speed * 100).toFixed(1)) + '%';
  const keyText = (semis > 0 ? '+' : semis < 0 ? '−' : '') + Math.abs(semis).toFixed(2);
  // While a pass is being made, say out loud what is being written and what is
  // playing along: layering is invisible otherwise, and "nothing is playing"
  // with no explanation is the failure that makes a recorder feel broken.
  const recTarget = recording && phys.recTracks.length ? phys.recTracks[0] : -1;
  const playAlong = recTarget >= 0
    ? tracks.map((tr, i) => (i !== recTarget && (tr.takes || []).length ? i + 1 : 0)).filter((n) => n > 0)
    : [];
  const legend = legendMsg
    || (recTarget >= 0
      ? 'REC TRK ' + (recTarget + 1) + (playAlong.length ? ' · PLAYING TRK ' + playAlong.join(' + ') : ' · FIRST PASS')
      : anyArmed
        ? 'REMAINING ' + fmtRem(CAPACITY - hud.pos) + ' · ' + sr + ' kHz · 24-BIT PCM' + (settings.bounce ? ' · BOUNCE' : '')
        : 'TAP A TRACK TO RECORD ONTO IT');
  const active = moving || recording;
  // While a pass is being made the meter is the microphone's own peak. A meter
  // that moves while the input is silent is worse than no meter: it is the one
  // thing that would have said, plainly, that nothing was coming in.
  const level = recording
    ? Math.max(0, Math.min(1, (hud.mic || 0) * 1.6))
    : active
      ? Math.min(1, 0.4 + 0.3 * Math.abs(Math.sin(hud.pos * 6.3)) + 0.15 * Math.random() + Math.min(0.2, speedX * 0.03))
      : 0;
  const spin = angleVal.interpolate({ inputRange: [-360, 360], outputRange: ['-360deg', '360deg'] });
  const px = (sec) => Math.max(0, Math.min(stripW, (sec / span) * stripW));
  // The strip's scrub handlers read these, and they change with the layout.
  stripMeta.current = { span, width: stripW };

  const setSpeedValue = (v) => {
    let next = clamp(Math.round(v / SPEED_STEP) * SPEED_STEP, SPEED_MIN, SPEED_MAX);
    if (Math.abs(next - 1) < 0.008) next = 1; // falls back onto the tape's own speed
    next = Math.round(next * 100) / 100;
    if (next === speedRef.current) return;
    speedRef.current = next;
    setSpeed(next);
    Haptics.selectionAsync().catch(() => {});
  };
  const setKeyValue = (v) => {
    let next = clamp(Math.round(v / KEY_STEP) * KEY_STEP, KEY_MIN, KEY_MAX);
    if (Math.abs(next) < 0.03) next = 0; // falls back onto the take's own key
    next = Math.round(next * 100) / 100;
    if (next === semisRef.current) return;
    semisRef.current = next;
    setSemis(next);
    Haptics.selectionAsync().catch(() => {});
  };
  const nudgeSpeed = (dir) => setSpeedValue(speedRef.current + dir * SPEED_STEP);
  const nudgeKey = (dir) => setKeyValue(semisRef.current + dir * KEY_STEP);

  // A tap is one step and a hold is a stream of them. The step on a tap comes
  // from onPress, on release, and the repeat waits before it starts — otherwise
  // a tap would take a step on the way down and a hold would take one too many.
  const repeat = useRef(null);
  const repeatDelay = useRef(null);
  const stopRepeat = () => {
    if (repeatDelay.current) {
      clearTimeout(repeatDelay.current);
      repeatDelay.current = null;
    }
    if (repeat.current) {
      clearInterval(repeat.current);
      repeat.current = null;
    }
  };
  const startRepeat = (fn) => {
    stopRepeat();
    repeatDelay.current = setTimeout(() => {
      repeatDelay.current = null;
      fn();
      repeat.current = setInterval(fn, 70);
    }, 300);
  };

  // The audio follows the hand once it has stopped moving.
  useEffect(() => {
    const id = setTimeout(() => setSemisHeard(semis), 260);
    return () => clearTimeout(id);
  }, [semis]);

  // Dragging a pill: a swipe across the width of the deck covers the whole range,
  // which puts a single percent (or five cents) within a few pixels of the hand.
  const dragFrom = useRef({ speed: 1, key: 0 }).current;
  const finePan = (kind) =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        dragFrom[kind] = kind === 'speed' ? speedRef.current : semisRef.current;
        stopRepeat();
      },
      onPanResponderMove: (e, g) => {
        // Deliberately slow to move: a swipe only reaches about a screen, so a
        // percent has to be several pixels and five cents a fine one. Speed
        // covers its range in a deck and a half, the key in two and a half.
        const across = kind === 'speed' ? Math.max(240, W * 1.8) : Math.max(320, W * 2.6);
        const spread = kind === 'speed' ? SPEED_MAX - SPEED_MIN : KEY_MAX - KEY_MIN;
        const next = dragFrom[kind] + (g.dx / across) * spread;
        if (kind === 'speed') setSpeedValue(next);
        else setKeyValue(next);
      },
    });
  const speedPanRef = useRef(null);
  if (!speedPanRef.current) speedPanRef.current = finePan('speed');
  const speedPan = speedPanRef.current;
  const keyPanRef = useRef(null);
  if (!keyPanRef.current) keyPanRef.current = finePan('key');
  const keyPan = keyPanRef.current;
  const toggleLock = () => {
    Haptics.selectionAsync().catch(() => {});
    const next = !lock;
    setLock(next);
    flash(next ? 'PITCH LOCK · SPEED KEEPS THE KEY' : 'TAPE PITCH · SPEED BENDS THE KEY');
  };
  const onExport = async () => {
    if (mode === 'rec') { flash('STOP RECORDING FIRST'); return; }
    if (!canExport()) {
      Alert.alert('Saving a file is web-only for now', 'Recording and playback work everywhere; writing a WAV needs a browser.');
      return;
    }
    if (exportBusy.current) return;
    // The same rule as playback: a bounced take replaces the tracks it printed.
    const items = buildItems(tracks, supersedeSkip(tracks, []));
    if (items.length === 0) { flash('NOTHING ON THE TAPE YET'); return; }
    exportBusy.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    flash('RENDERING ' + Math.round(speed * 100) + '%' + (semis ? ' · KEY ' + (semis > 0 ? '+' : '') + semis : '') + ' …');
    try {
      const out = await exportReel({ items, name: (current && current.name) || 'reel', speed, semitones: semis, pitchLock: lock });
      flash('SAVED · ' + out.filename);
    } catch (e) {
      flash('COULD NOT SAVE THE FILE');
      Alert.alert('Could not save the file', (e && e.message) || 'Try again.');
    } finally {
      exportBusy.current = false;
    }
  };

  const key = (icon, onPress, label, on) => (
    <GlassPanel key={label} radius={12} style={[s.keyShell, { borderColor: on ? t.warning : glassStroke }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={({ pressed }) => [s.keyInner, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Ionicons name={icon} size={28} color={on ? t.warning : t.text} />
        {on ? <View style={{ position: 'absolute', bottom: 7, width: 20, height: 2, borderRadius: 2, backgroundColor: t.warning }} /> : null}
      </Pressable>
    </GlassPanel>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }} {...swipe.panHandlers}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      {/* Obsidian glass ground: the deck is a slab, not a photograph. */}
      <ObsidianBackdrop />
      <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom + 4 }}>
        {/* Top bar */}
        <View style={s.top}>
          <Pressable onPress={() => nav.navigate('Sessions')} accessibilityRole="button" accessibilityLabel="Open sessions" style={s.topLeft}>
            <Ionicons name="albums-outline" size={20} color={t.warning} />
            <EngravedText size={12} color={t.text} numberOfLines={1} style={{ marginLeft: 8, flexShrink: 1 }}>
              {(current && current.name) || 'Reel'}
            </EngravedText>
          </Pressable>
          {canImportAudio() ? (
            <Pressable onPress={onImport} accessibilityRole="button" accessibilityLabel="Import an audio file as a take" style={s.topBtn}>
              <Ionicons name="cloud-upload-outline" size={22} color={t.textMuted} />
            </Pressable>
          ) : null}
          <Pressable onPress={onExport} accessibilityRole="button" accessibilityLabel="Save the reel as a WAV file" style={s.topBtn}>
            <Ionicons name="download-outline" size={22} color={t.textMuted} />
          </Pressable>
          <Pressable onPress={() => nav.navigate('Back Panel')} accessibilityRole="button" accessibilityLabel="Flip to back panel" style={s.topBtn}>
            <Ionicons name="settings-outline" size={22} color={t.textMuted} />
          </Pressable>
        </View>

        {/* Counter and level */}
        <View style={s.readout}>
          <GlassPanel radius={10} style={[s.counter, { borderColor: recording ? t.accent : glassStroke }]}>
            <Text style={[t.font.title, { color: recording ? t.accent : t.warning, fontSize: 30, lineHeight: 40, letterSpacing: 1 }]}>{fmt(display)}</Text>
            <Pressable
              accessibilityLabel="Reset tape counter, hold"
              hitSlop={14}
              onLongPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); setOffset(hud.pos); flash('COUNTER RESET'); }}
              style={[s.pinhole, { backgroundColor: glassStroke }]}
            />
          </GlassPanel>
          <VUMeter width={112} height={56} level={level} label="IN" />
        </View>

        {/* The one big reel */}
        <View style={s.wheelArea}>
          <View
            style={{ width: size, height: size }}
            {...wheel.panHandlers}
            accessibilityLabel="Tape reel. Drag around to scrub, fling to fast-forward or rewind."
          >
            <Animated.View pointerEvents="none" style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: spin }] }}>
              <View
                style={{
                  position: 'absolute',
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  backgroundColor: glassFill,
                  borderWidth: grabbed ? 2 : 1,
                  borderColor: grabbed ? t.warning : glassStroke,
                }}
              />
              <GlassReel size={size * 0.9} accent={t.accent} />
              <Bezel size={size} color={t.textMuted} accent={t.accent} />
              {/* A lens, not a hole: one specular sweep across the glass. */}
              <GlassSpecular
                style={{ position: 'absolute', left: size * 0.07, top: size * 0.07, width: size * 0.86, height: size * 0.86, borderRadius: size * 0.43 }}
              />
            </Animated.View>
            <View pointerEvents="none" style={[s.notch, { left: size / 2 - 8 }]}>
              <Svg width={16} height={14} viewBox="0 0 16 14">
                <Polygon points="0,0 16,0 8,14" fill={recording ? t.accent : t.warning} />
              </Svg>
            </View>
          </View>
          <View style={s.pillRow}>
            <GlassPanel radius={16} style={[s.pill, { borderColor: recording ? t.accent : glassStroke }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Slower"
                hitSlop={10}
                onPress={() => nudgeSpeed(-1)}
                onPressIn={() => startRepeat(() => nudgeSpeed(-1))}
                onPressOut={stopRepeat}
                style={s.pillStep}
              >
                <Ionicons name="remove" size={16} color={recording ? t.accent : t.warning} />
              </Pressable>
              <View
                {...speedPan.panHandlers}
                style={s.pillValue}
                accessibilityLabel={'Speed ' + speedText + ', drag to fine tune'}
              >
                <EngravedText size={12} color={recording ? t.accent : t.warning}>
                  {recording ? 'REC · 100%' : moving && speedX > PLAYABLE_X ? 'SPOOLING' : speedText}
                </EngravedText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Faster"
                hitSlop={10}
                onPress={() => nudgeSpeed(1)}
                onPressIn={() => startRepeat(() => nudgeSpeed(1))}
                onPressOut={stopRepeat}
                style={s.pillStep}
              >
                <Ionicons name="add" size={16} color={recording ? t.accent : t.warning} />
              </Pressable>
            </GlassPanel>

            <GlassPanel radius={16} style={[s.pill, { borderColor: semis ? t.accent : glassStroke }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Lower the key"
                hitSlop={10}
                onPress={() => nudgeKey(-1)}
                onPressIn={() => startRepeat(() => nudgeKey(-1))}
                onPressOut={stopRepeat}
                style={s.pillStep}
              >
                <Ionicons name="remove" size={16} color={semis ? t.accent : t.warning} />
              </Pressable>
              <View
                {...keyPan.panHandlers}
                style={s.pillValue}
                accessibilityLabel={'Key ' + keyText + ' semitones, drag to fine tune'}
              >
                <EngravedText size={12} color={semis ? t.accent : t.warning}>{'KEY ' + keyText}</EngravedText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Raise the key"
                hitSlop={10}
                onPress={() => nudgeKey(1)}
                onPressIn={() => startRepeat(() => nudgeKey(1))}
                onPressOut={stopRepeat}
                style={s.pillStep}
              >
                <Ionicons name="add" size={16} color={semis ? t.accent : t.warning} />
              </Pressable>
            </GlassPanel>

            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: lock }}
              accessibilityLabel={lock ? 'Pitch lock on: changing the speed keeps the key' : 'Tape pitch: changing the speed bends the key'}
              onPress={toggleLock}
            >
              <GlassPanel radius={16} style={[s.pill, { borderColor: lock ? t.warning : glassStroke }]}>
                <Ionicons name={lock ? 'lock-closed' : 'lock-open'} size={13} color={lock ? t.warning : t.textMuted} />
                <EngravedText size={11} color={lock ? t.warning : t.textMuted} style={{ marginLeft: 5 }}>
                  {lock ? 'PITCH LOCK' : 'TAPE PITCH'}
                </EngravedText>
              </GlassPanel>
            </Pressable>
          </View>
        </View>

        {/* Tape strip: the whole recording, drag the head to scrub, tap to jump */}
        <View
          ref={stripRef}
          {...stripPan.panHandlers}
          onLayout={(e) => { setStripW(e.nativeEvent.layout.width || 300); measureStrip(); }}
          style={s.strip}
        >
          {/* Jump-on-tap sits on its own layer so a drag can take the touch from
              it, while the cue flags above it keep their own press. */}
          <Pressable
            onPress={(e) => {
              const x = e.nativeEvent.locationX;
              if (!Number.isFinite(x)) return;
              jumpTo((x / Math.max(1, stripW)) * span);
            }}
            style={StyleSheet.absoluteFill}
            accessibilityRole="adjustable"
            accessibilityValue={{ text: fmt(hud.pos) }}
            accessibilityLabel="Recording timeline, drag to scrub, tap to jump"
          />
          <View pointerEvents="none" style={[s.stripBar, { backgroundColor: t.accentSoft, borderColor: t.border }]}>
            <View style={{ position: 'absolute', left: 0, width: px(recorded), top: 0, bottom: 0, backgroundColor: t.warning, opacity: 0.35 }} />
            {recording ? (
              <View style={{ position: 'absolute', left: px(recFrom), width: Math.max(2, px(hud.pos) - px(recFrom)), top: 0, bottom: 0, backgroundColor: t.accent }} />
            ) : null}
          </View>
          <View pointerEvents="none" style={[s.playhead, { left: px(hud.pos) - 1, backgroundColor: recording ? t.accent : t.text }]} />
          {/* A grab handle on the head, so the bar reads as something you pull. */}
          <View pointerEvents="none" style={[s.grip, { left: px(hud.pos) - 6, borderColor: recording ? t.accent : t.warning, backgroundColor: t.bg }]} />
          {cues.map((c, i) => (
            <Pressable
              key={c.id || i}
              onPress={() => jumpTo(c.position || 0)}
              onLongPress={() => askDelete(c, i)}
              hitSlop={10}
              accessibilityLabel={'Cue ' + (i + 1) + ', hold to delete'}
              style={[s.flag, { left: Math.min(stripW - 18, Math.max(0, px(c.position || 0) - 9)), backgroundColor: t.warning }]}
            >
              <Text style={[t.font.label, { color: t.bg, fontSize: 11, lineHeight: 14 }]}>{i + 1}</Text>
            </Pressable>
          ))}
          <View pointerEvents="none" style={s.stripLabels}>
            <EngravedText size={10} color={t.textMuted}>0:00</EngravedText>
            <EngravedText size={10} color={t.textMuted}>{fmtShort(span)}</EngravedText>
          </View>
        </View>

        <EngravedText size={12} color={legendMsg ? t.accent : t.textMuted} style={{ textAlign: 'center', marginTop: 4 }}>{legend}</EngravedText>

        {/* Arm row and cue */}
        <View style={s.armRow}>
          {tracks.map((tr, i) => {
            const armed = !!tr.armed;
            const n = (tr.takes || []).length;
            const activeTake = (tr.takes || []).find((k) => k.id === tr.activeTakeId) || (tr.takes || [])[n - 1];
            const silent = !!(activeTake && activeTake.peak === 0);
            // A take whose file this page cannot find is silence with a reason: say
            // so on the track instead of letting it claim to play.
            const noAudio = !!(audioChecked && activeTake && !silent && !takeAudioReady(activeTake));
            return (
              <Pressable
                key={i}
                onPress={() => toggleArm(i)}
                onLongPress={() => nav.navigate('Takes', { track: i })}
                delayLongPress={350}
                accessibilityRole="button"
                accessibilityLabel={'Track ' + (i + 1) + (armed ? ' armed' : ' not armed') + ', hold for takes'}
                style={({ pressed }) => [
                  s.arm,
                  {
                    backgroundColor: armed ? t.accent : glassFill,
                    borderColor: armed ? t.accent : glassStroke,
                    shadowColor: t.accent,
                    shadowOpacity: armed ? 0.8 : 0,
                    shadowRadius: 10,
                    shadowOffset: { width: 0, height: 0 },
                    opacity: pressed ? 0.75 : 1,
                  },
                ]}
              >
                <Text style={[t.font.label, { color: armed ? t.onAccent : t.textMuted, fontSize: 13, lineHeight: 17 }]}>{'TRK ' + (i + 1)}</Text>
                <Text style={[t.font.caption, { color: armed ? t.onAccent : t.textMuted, fontSize: 10, lineHeight: 13, opacity: 0.85 }]}>
                  {armed ? 'REC HERE' : silent ? 'SILENT' : noAudio ? 'NO AUDIO' : n > 0 ? (anyArmed ? 'PLAYS' : n === 1 ? '1 TAKE' : n + ' TAKES') : 'EMPTY'}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={dropCue}
            accessibilityRole="button"
            accessibilityLabel="Drop a cue flag here"
            style={({ pressed }) => [s.cueKey, { backgroundColor: t.surface, borderColor: t.border, opacity: pressed ? 0.7 : 1 }]}
          >
            <Ionicons name="flag" size={18} color={t.warning} />
            <Text style={[t.font.caption, { color: t.textMuted, fontSize: 10, lineHeight: 13 }]}>CUE</Text>
          </Pressable>
        </View>

        {/* Transport */}
        <Animated.View style={[s.transport, { transform: [{ translateX: shake }] }]}>
          {key('play-back', onRew, 'Rewind', mode === 'rew')}
          {key(mode === 'play' ? 'pause' : 'play', onPlay, mode === 'play' ? 'Pause' : 'Play', mode === 'play')}
          {key('stop', onStop, 'Stop, double tap for start of tape', false)}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={recording ? 'Stop recording' : 'Record'}
            onPress={onRecord}
            style={({ pressed }) => [
              s.key,
              {
                backgroundColor: recording || anyArmed ? t.accent : t.accentSoft,
                borderColor: t.accent,
                shadowColor: t.accent,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: recording ? 1 : anyArmed ? 0.7 : 0,
                shadowRadius: recording ? 18 : 12,
                elevation: recording || anyArmed ? 10 : 0,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            {/* The record key is a lamp, not a picture of one. */}
            <View
              style={{
                width: 18,
                height: 18,
                borderRadius: 9,
                backgroundColor: recording ? '#FFFFFF' : t.onAccent,
                opacity: recording || anyArmed ? 1 : 0.45,
                shadowColor: t.accent,
                shadowOpacity: recording ? 1 : 0.7,
                shadowRadius: recording ? 14 : 8,
                shadowOffset: { width: 0, height: 0 },
              }}
            />
          </Pressable>
          {key('play-forward', onFF, 'Fast forward', mode === 'ff')}
        </Animated.View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  top: { height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  topLeft: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', paddingRight: 8 },
  topBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  readout: { height: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  counter: { width: 168, height: 52, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  pinhole: { position: 'absolute', right: 6, bottom: 6, width: 8, height: 8, borderRadius: 4 },
  wheelArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  notch: { position: 'absolute', top: -6, width: 16, height: 14 },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, paddingHorizontal: 4 },
  pill: { height: 32, paddingHorizontal: 4, borderRadius: 16, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  pillStep: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  pillValue: { minWidth: 62, height: 28, alignItems: 'center', justifyContent: 'center' },
  strip: { height: 64, marginHorizontal: 20, justifyContent: 'center' },
  stripBar: { height: 14, borderRadius: 3, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  playhead: { position: 'absolute', width: 2, height: 30, top: 14 },
  grip: { position: 'absolute', width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, top: 23 },
  flag: { position: 'absolute', top: 2, width: 18, height: 16, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  stripLabels: { position: 'absolute', left: 0, right: 0, bottom: 2, flexDirection: 'row', justifyContent: 'space-between' },
  armRow: { height: 56, flexDirection: 'row', marginHorizontal: 12, marginTop: 6, gap: 6 },
  arm: { flex: 1, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  cueKey: { width: 56, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  transport: { flexDirection: 'row', height: 64, marginHorizontal: 12, gap: 6, marginTop: 8 },
  key: { flex: 1, height: 64, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  keyShell: { flex: 1, height: 64 },
  keyInner: { height: 64, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
});
