import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, Text, StatusBar, Alert, Animated, PanResponder, Platform, useWindowDimensions, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Line } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { useAudioRecorder, RecordingPresets, AudioModule, setAudioModeAsync } from 'expo-audio';
import { useTheme } from '../ui/theme';
import { useStudio } from '../store/StudioContext';
import { createMixer, buildItems, supersedeSkip } from '../lib/audio/TapeMixer';
import { applyLevelOverride } from '../lib/audio/mixPlan';
import { wheelTransport, settleRates, DEG_PER_SEC_AT_1X } from '../lib/audio/wheel';
import EngravedText from '../components/EngravedText';
import { Knob, KeyCap, LedLadder } from '../components/hardware';
import TrackLevel from '../components/TrackLevel';
import { pickAudioFile, canImportAudio } from '../lib/audio/importTake';
import { micUnavailableReason, startMicTake, stopMicTake, micTakeLevel } from '../lib/audio/recordTake';
import { startClick, stopClick, clickRunning, beatSeconds, clampBpm, DEFAULT_BPM } from '../lib/audio/metronome';
import { nextRecordBars, passEnd, reachedEnd } from '../lib/audio/bars';
import { renderBounce } from '../lib/audio/bounce';
import { takeAudioReady } from '../lib/audio/takeStore';
import { ObsidianBackdrop, GlassSpecular, glassStroke, glassFill } from '../ui/glass';
import GlassReel from '../components/GlassReel';
import { exportReel, canExport } from '../lib/audio/exportReel';
import { rememberTakeAudio, hydrateTakeAudio } from '../lib/audio/takeStore';
import { tapeTimeAt } from '../lib/audio/scrub';
import { loopJump } from '../lib/audio/loop';
import { TAPE_SECONDS } from '../lib/audio/tape';

// Wheel physics. One turn of the reel per second is the tape's own speed; the
// deck's sensitivity scales it, so a hand turning at a song's pace plays at pace.
const NORMAL = DEG_PER_SEC_AT_1X; // degrees per second at 1x play speed
// The PITCH slider bends the tape's speed, so the key bends with it the way a tape
// does: instant, and it works on a take of any length. The range is deliberately
// gentle — half speed to double is an octave either way.
const PITCH_TRIM_MIN = 0.5;
const PITCH_TRIM_MAX = 2;
const MAXV = 1440; // 12x
// One bar of count-in before a pass, when the click is on: four beats to the bar.
const COUNT_IN = 4;
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
// The key and the tape's bend are the same thing: a semitone is a speed ratio.
const semisToTrim = (s) => Math.pow(2, s / 12);

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
  // The animation loop is built once and must still see the current settings.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const current = sessions.find((s) => s.id === studio.currentSessionId) || null;
  const tracks = [0, 1, 2, 3].map((i) => (current && current.tracks && current.tracks[i]) || { armed: false, takes: [] });
  const cues = (current && current.cues) || [];
  const recorded = (current && current.duration) || 0;
  // A turn's worth of speed. The reference is one turn a second; the setting
  // scales it, so a hand that wants to spin harder can, and one that wants a
  // touch more speed per turn can have that too.
  // Old builds shipped 0.3, 0.6, 1 and 1.2 as defaults and wrote them into saved
  // settings. Those are moved forward once, and only for a deck that has never been
  // tuned on the back panel: a number the hand chose is never overridden, even when
  // it happens to equal an old default. That override was a real trap — the panel
  // showed one value and the reel used another.
  const storedSens = Number(settings.wheelSens);
  const legacySens =
    !storedSens ||
    Math.abs(storedSens) === 0.3 ||
    Math.abs(storedSens) === 0.6 ||
    Math.abs(storedSens) === 1 ||
    Math.abs(storedSens) === 1.2;
  const sensRaw = settings.wheelTuned === true || !legacySens ? storedSens || 0.8 : 0.8;
  const topRaw = Number(settings.wheelCeiling) || 3;
  // The magnitude is how much, the sign is which way: a negative number runs the
  // reel the other way.
  const wheelSens = clamp(Math.abs(sensRaw) || 0.8, 0.1, 4);
  // How fast a hard spin may take the tape, chosen on the back panel.
  const wheelCeiling = clamp(Math.abs(topRaw) || 3, 1.2, 8);
  // Only the speed-per-turn number decides the direction. The top speed just caps
  // it: letting its sign flip the reel meant a negative top silently reversed a
  // reel whose speed number was positive.
  const wheelInvert = sensRaw < 0;
  const invertRef = useRef(wheelInvert);
  invertRef.current = wheelInvert;
  const wheelNormal = DEG_PER_SEC_AT_1X / wheelSens;
  const normalRef = useRef(wheelNormal);
  normalRef.current = wheelNormal;
  // How the reel returns to speed after a hand lets go: SETTLE on the back panel,
  // read every frame like the speed is, because the transport loop is made once.
  // `settleRates` clamps and defaults a missing setting, so a stored 0 survives.
  const settleRef = useRef(settleRates(50));
  settleRef.current = settleRates(Number(settings.wheelSettle));

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
  // `semis` is the key. A key change is a change of the tape's speed, so the
  // readout and the sound move together and nothing has to be rendered.
  // Whether the device has been searched for each take's audio yet. Until it has,
  // a take is not "missing", it is simply not loaded.
  const [audioChecked, setAudioChecked] = useState(false);
  // The fader under the finger, before it is saved: a mix has to be heard while
  // it is being made, not only once the hand comes off.
  const [levelDrag, setLevelDrag] = useState(null);
  const [speed, setSpeed] = useState(1);
  const [semis, setSemis] = useState(0);
  // Each mode key cycles through its own states, exactly as the machine's do, and
  // the ± pair belongs to whichever mode is selected:
  //   PITCH  off → adjusting (speed bends the key) → locked (speed keeps it)
  //   CUE    off → add
  //   LOOP   off → set the IN and OUT points → play the loop
  // One track at a time, cycled from the TAPE boxes. Selecting a box arms that
  // track and disarms the rest, which is the overdub flow a field recorder has;
  // the face then carries one track's level instead of four cards.
  const [selTrack, setSelTrack] = useState(0);
  const selectTrack = (i) => {
    const next = ((i % 4) + 4) % 4;
    setSelTrack(next);
    Haptics.selectionAsync().catch(() => {});
    [0, 1, 2, 3].forEach((j) => safe(() => studio.updateTrack && studio.updateTrack(j, { armed: j === next })));
    flash('TRACK 0' + (next + 1));
  };
  // Tempo. The ± pair drives the BPM while the TEMPO knob is lit, and the click
  // track follows the tempo while a pass is being recorded, so the number on the
  // display is a tempo the deck is keeping rather than a decoration.
  const [bpm, setBpm] = useState(DEFAULT_BPM);
  // Two taps in a row land inside one render, and each would read the same BPM:
  // the ref carries the value between them so a double tap moves two beats.
  const bpmRef = useRef(DEFAULT_BPM);
  bpmRef.current = bpm;
  const [tempoOn, setTempoOn] = useState(false);
  const cycleTempo = () => {
    Haptics.selectionAsync().catch(() => {});
    const next = !tempoOn;
    setTempoOn(next);
    flash(next ? 'TEMPO ' + bpm + ' BPM — ± SETS IT, CLICK ON RECORD' : 'TEMPO OFF · ' + bpm + ' BPM');
  };
  // Held, the TEMPO knob sets how long a pass is. A length turns the deck into
  // the looper: the pass stops itself on the bar and plays back as the loop.
  const cycleRecordBars = () => {
    const next = nextRecordBars(settings.recordBars);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    safe(() => studio.updateSettings && studio.updateSettings({ recordBars: next }));
    flash(next ? 'REC LENGTH ' + next + ' BAR' + (next > 1 ? 'S' : '') : 'REC LENGTH OFF');
  };
  const [pitchMode, setPitchMode] = useState(2); // 2 is locked, the default
  const [cueMode, setCueMode] = useState(0);
  const [loopMode, setLoopMode] = useState(0);
  const [loopIn, setLoopIn] = useState(null);
  const [loopOut, setLoopOut] = useState(null);
  const lock = pitchMode === 2;
  // The animation loop is created once, so it reads the loop from here rather than
  // from a closure that would still be holding the points from the first render.
  const loopRef = useRef({ mode: 0, in: null, out: null });
  loopRef.current = { mode: loopMode, in: loopIn, out: loopOut };
  // The PITCH slider bends the tape's speed, so the key bends with it. 1 is no bend,
  // and it is a ref because the transport reads it every frame: putting it in state
  // re-rendered the whole deck dozens of times a second and froze it.
  const trimRef = useRef(1);
  // What the wheel's turn does. With the key held it is the tempo; with the key free
  // it is the pitch, and a turn moves through the key instead of through the tape.

  const semisRef = useRef(0);
  semisRef.current = semis;
  const speedRef = useRef(1);
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
    angle: 0, vel: 0, pos: 0, dragging: false, mode: 'stop',
    lastMoveT: 0, lastA: 0, hapticAcc: 0, recStart: 0, recTracks: [], handSpun: false,
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
  // The reel IS the transport.
  //
  // A hand on it sets the speed at that moment: turn it at the song's pace and the
  // tape runs at its own, turn it faster and it plays faster, turn it slowly and it
  // still plays — slow and pitched down, like a tape dragged by hand. Spinning it
  // while the deck is stopped sounds too. Backwards is a rewind, which cannot be
  // read backwards, so a reversed copy plays instead (lib/audio/ReverseTape).
  syncRef.current = () => {
    const p = phys;
    // The rule that decides what is heard lives on its own so it can be tested:
    // see lib/audio/wheel.js.
    const t = wheelTransport({
      mode: p.mode,
      dragging: p.dragging,
      vel: p.vel,
      degPerSecAt1x: normalRef.current,
      ceiling: wheelCeiling,
    });
    // Tape pitch: the reel bends the key by bending the speed, so the key and the
    // tempo move together and nothing has to be rendered. Only the wheel's bend is
    // added on top; the transport's own speed is untouched by it.
    // The PITCH slider bends the tape itself, so it multiplies the transport's speed
    // and the key bends with it. A hand on the reel overrides the slider while it is
    // down; the slider is the rest of the time.
    const trim = trimRef.current;
    const bent = Math.abs(trim - 1) > 0.001;
    const transport = p.mode === 'play' || p.mode === 'rec';
    const going = t.playing;
    const rate =
      !t.hand && transport
        ? Math.max(0.0625, Math.min(8, speedRef.current * trim))
        : t.rate;
    // A bounced take carries the tracks it printed, so those tracks are left out
    // while it plays. The printed backing and the live one together is the music
    // twice over — the one failure mode a bounce has.
    const skip = supersedeSkip(tracks, p.mode === 'rec' ? p.recTracks : []);
    // A key change is the tape's own speed, so it is already in `rate` and needs
    // nothing rendered: rendering a pitched copy of every take meant decoding a
    // forty-minute pass and writing it back out, on the main thread, four times
    // over — which froze the deck every time the key was touched.
    const base = buildItems(tracks, skip);
    // A fader being dragged is heard as it moves, before it is written down.
    const items = applyLevelOverride(base, levelDrag ? levelDrag.index : null, levelDrag ? levelDrag.value : NaN);
    try {
      // The TAPE PITCH key governs the reel as well as the tape: with it on, a spin
      // keeps the key and only the tempo moves; with it off, the key rides the speed
      // the way a tape does.
      // In pitch mode the key is meant to bend with the speed, so the mixer is asked
      // for tape pitch rather than a held key.
      mixerRef.current.sync(items, p.pos, going, rate, lock && !bent);
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
      // How long the microphone really recorded, when the platform tells us. A
      // hand on the reel can drag the head faster or slower than real time, so
      // tape travel and audio length are not the same number after a spin.
      let captured = null;
      // Whether the hand drove the reel during the pass. A print is rendered at one
      // rate, and a spun pass has no single rate, so it cannot be printed faithfully.
      const handSpun = phys.handSpun === true;
      try {
        if (Platform.OS === 'web') {
          const take = await stopMicTake();
          uri = take && take.uri;
          peak = take && typeof take.peak === 'number' ? take.peak : null;
          captured = take && typeof take.duration === 'number' ? take.duration : null;
        } else {
          await recorder.stop();
          uri = recorder.uri;
        }
      } catch (e) {
        uri = null;
      }
      safe(() => setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {}));
      // The audio is the truth about how long the pass was. The take is laid down
      // at the length that was actually captured, so a fast spin does not leave a
      // take that plays its real few seconds and then sits silent while the head
      // travels past the rest of the tape it thinks it covers.
      const length = Math.max(0, Math.round((captured > 0 ? captured : dur) * 10) / 10);
      // A dub can be short: a drum stab or a single word is the point of layering
      // a part, and a whole second of minimum threw those away. This still
      // ignores a tap that was never meant to record anything.
      if (length < 0.4) {
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
      if (settings.bounce && Platform.OS === 'web' && !handSpun) {
        try {
          const from = tracks
            .map((tr, i) => i)
            .filter((i) => list.indexOf(i) < 0)
            .filter((i) => {
              const tr = tracks[i] || {};
              const tk = (tr.takes || []).find((x) => x.id === tr.activeTakeId) || null;
              if (!tk || !tk.uri) return false;
              // Only the takes the head actually crossed while the pass was running.
              return (Number(tk.start) || 0) < start + length && (Number(tk.start) || 0) + (Number(tk.duration) || 0) > start;
            });
          if (from.length) {
            const printed = await renderBounce({
              micUri: uri,
              start,
              duration: length,
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
        const takeId = newTakeId();
        list.forEach((i) => studio.addTake && studio.addTake(i, length, undefined, { uri, start, id: takeId, peak, sources }));
        // Write the audio to the device as soon as it exists: a blob URL dies with
        // the page, and a take that cannot be heard after a reload is not saved.
        safe(() => rememberTakeAudio(takeId, uri));
        // A pass the microphone heard nothing on is still saved — its place and
        // length on the tape are real — but it says so rather than looking like
        // audio that has gone missing.
        let said = 'TAKE SAVED · ' + fmtShort(length);
        if (sources) {
          said = 'BOUNCED · ' + fmtShort(length) + (sourcesMissing > 0 ? ' · ' + sourcesMissing + ' HAD NO AUDIO' : '');
        } else if (settings.bounce && Platform.OS === 'web' && handSpun) {
          said = 'TAKE SAVED · NOT PRINTED (HAND ON THE REEL)';
        } else if (peak === 0) {
          said = 'SILENT TAKE · THE MIC HEARD NOTHING';
        }
        flash(said);
      } catch (e) {
        Alert.alert('Could not save the take', (e && e.message) || 'Try again.');
      }
    };
    finish();
  };

  const toMode = (m) => {
    if (phys.mode === 'rec' && m !== 'rec') {
      finishRef.current();
      stopClick();
    }
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
      safe(() => mixerRef.current && mixerRef.current.dispose());
      safe(() => stopClick());
    };
    // eslint-disable-next-line
  }, []);

  // The click follows the tempo while the deck is rolling. It reads the transport's
  // mode rather than the `recording` view of it, because that is worked out further
  // down this component and a dependency array is read where the effect is written:
  // naming it here ran before it existed.
  // It does not stop the click itself: the count-in starts one before the pass does,
  // and the transport stops it on the way out of record.
  useEffect(() => {
    if (mode === 'rec' && tempoOn && !clickRunning()) startClick(bpm);
  }, [mode, tempoOn, bpm]);

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
      const settle = settleRef.current;
      if (p.dragging) {
        // A hand that stops turning lets the sound down gently, not with a drop —
        // at whatever rate SETTLE is set to.
        if (now - p.lastMoveT > 90) p.vel *= Math.exp(-settle.holding * dt);
      } else {
        if (p.mode === 'rec') {
          // Letting go of the reel during a pass settles back to the deck's own
          // speed instead of snapping there: a pass that started slow should be
          // heard arriving at 1x, not jumping to it.
          const target = normalRef.current;
          const k = Math.abs(target) > Math.abs(p.vel) ? settle.speeding : settle.slowing;
          p.vel += (target - p.vel) * (1 - Math.exp(-k * dt));
          if (Math.abs(target - p.vel) < 1) p.vel = target;
        } else {
          const target =
            p.mode === 'play'
              ? normalRef.current * speedRef.current * trimRef.current
              : MODES[p.mode] || 0;
          // Speeding up is quicker than slowing down (the hand has already asked
          // for it), and how long the let-go glides is the SETTLE setting: letting
          // go should sound like the reel finding its speed, not being snatched.
          const k = Math.abs(target) > Math.abs(p.vel) ? settle.speeding : settle.slowing;
          p.vel += (target - p.vel) * (1 - Math.exp(-k * dt));
          if (Math.abs(target - p.vel) < 1) p.vel = target;
        }
        p.angle = (p.angle + p.vel * dt) % 360;
        p.pos += (p.vel / normalRef.current) * dt;
        // Record to the bar. A pass given a length ends itself when the bar comes
        // round, and the region it just made becomes the loop — no hand on STOP,
        // no points to set afterwards. This is the same finish the STOP key runs;
        // it is called while the mode is still 'rec', as that finish expects.
        if (p.mode === 'rec' && Number(settingsRef.current.recordBars) > 0) {
          const end = passEnd(p.recStart, bpmRef.current, settingsRef.current.recordBars);
          if (reachedEnd(p.pos, end)) {
            p.pos = end.out;
            p.vel = 0;
            finishRef.current();
            phys.mode = 'play';
            setMode('play');
            setLoopIn(end.in);
            setLoopOut(end.out);
            setLoopMode(2);
            flash('LOOP ' + fmt(end.in) + ' → ' + fmt(end.out));
          }
        }
        // A loop is the tape running in a circle: at the OUT point the head is put
        // back at IN, and the mixer seeks because its position is the truth. The
        // rule itself lives in lib/audio/loop.js so it can be tested.
        if (p.mode === 'play') {
          const back = loopJump(p.pos, loopRef.current);
          if (back != null) p.pos = back;
        }
        if (p.pos <= 0) {
          p.pos = 0;
          if (p.vel < 0) p.vel = 0;
          if (p.mode === 'rew') { phys.mode = 'stop'; setMode('stop'); }
        } else if (p.pos >= TAPE_SECONDS) {
          p.pos = TAPE_SECONDS;
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
  // Where the reel is on screen. A pointer's own `locationX` is measured against
  // whichever layer it happens to be over, and the reel is a stack of glass and
  // SVG pieces — so a turn read from it lurched and mostly cancelled itself out,
  // which is exactly what a mouse on the web was doing. The wheel's own box is
  // the one stable reference, for a finger and for a mouse alike.
  const wheelNode = useRef(null);
  const wheelBox = useRef({ left: 0, top: 0, size: 300 });
  const measureWheel = () => {
    const node = wheelNode.current;
    if (!node || typeof node.measureInWindow !== 'function') return;
    node.measureInWindow((x, y, w) => {
      wheelBox.current = { left: x, top: y, size: w || wheelSize.current };
    });
  };
  const reelAngleDeg = (e) => {
    const n = (e && e.nativeEvent) || {};
    const box = wheelBox.current;
    const size = box.size || wheelSize.current || 300;
    const hasPage = Number.isFinite(n.pageX) && Number.isFinite(n.pageY);
    const x = hasPage ? n.pageX - box.left : Number(n.locationX);
    const y = hasPage ? n.pageY - box.top : Number(n.locationY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const c = size / 2;
    return (Math.atan2(y - c, x - c) * 180) / Math.PI;
  };
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
      measureWheel();
      const a0 = reelAngleDeg(e);
      if (a0 === null) return;
      phys.lastA = a0;
      phys.lastMoveT = Date.now();
      phys.hapticAcc = 0;
      phys.samples = [];
      phys.acc = 0;
      // The reel is playable during a pass. A take that starts slow and is let go
      // is made by the hand, and there is no physical reason the hand should be
      // refused while the microphone is open — the reel is a performance control
      // for the music, not a lid on the recorder. Only the timeline below stays
      // locked mid-pass, because moving the head would tear where the take sits.
      phys.dragging = true;
      setGrabbed(true);
      Haptics.selectionAsync().catch(() => {});
    },
    onPanResponderMove: (e) => {
      const a = reelAngleDeg(e);
      if (a === null) return;
      let d = a - phys.lastA;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      // The reel can be told to run the other way, for a hand that expects a turn in
      // the opposite direction to mean forward.
      phys.lastA = a;
      // Direction belongs to the speed control; the pitch wheel is always clockwise
      // up, as the hand expects.
      if (invertRef.current) d = -d;
      if (!phys.dragging) return;
      // A pass the hand drove cannot be printed later: remember that it happened.
      if (phys.mode === 'rec') phys.handSpun = true;
      const now = Date.now();
      const dt = Math.max(8, now - phys.lastMoveT) / 1000;
      phys.lastMoveT = now;
      phys.angle = (phys.angle + d) % 360;
      angleVal.setValue(phys.angle);
      // A single fast pointer event is a spike, not a speed. Measure the hand over
      // a short window and ease the tape towards it, so a steady spin holds a
      // steady tempo instead of the sound lurching with every sample.
      phys.acc = (phys.acc || 0) + d;
      phys.samples = phys.samples || [];
      phys.samples.push({ t: now, a: phys.acc });
      while (phys.samples.length > 2 && now - phys.samples[0].t > 160) phys.samples.shift();
      const first = phys.samples[0];
      const span = Math.max(0.04, (now - first.t) / 1000);
      const want = Math.max(-MAXV, Math.min(MAXV, (phys.acc - first.a) / span));
      const step = 6000 * dt;
      phys.vel += Math.max(-step, Math.min(step, want - phys.vel));
      // The reel is a speed control, not a position control. The tape travels at
      // the speed the sound is playing, never at the speed of the finger: moving
      // the head by the hand's travel is what made a fast spin skip down the reel.
      // The rate is the one the transport will actually play, shaping included, so
      // the head can never outrun what is coming out of the speaker.
      const rate = wheelTransport({
        mode: phys.mode,
        dragging: true,
        vel: phys.vel,
        degPerSecAt1x: normalRef.current,
        ceiling: wheelCeiling,
      }).rate;
      phys.pos = Math.max(0, Math.min(TAPE_SECONDS, phys.pos + rate * dt));
      phys.hapticAcc += Math.abs(d);
      if (phys.hapticAcc >= 30) {
        phys.hapticAcc = 0;
        Haptics.selectionAsync().catch(() => {});
      }
    },
    onPanResponderRelease: () => { phys.dragging = false; setGrabbed(false); },
    onPanResponderTerminate: () => { phys.dragging = false; setGrabbed(false); },
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
    phys.pos = Math.max(0, Math.min(TAPE_SECONDS, t));
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
    if (phys.pos >= TAPE_SECONDS - 0.5) phys.pos = 0;
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
    if (phys.pos >= TAPE_SECONDS - 1) {
      flash('TAPE IS FULL');
      return;
    }
    recBusy.current = true;
    try {
      // A bar of count-in when the click is on, before the microphone opens: the
      // clicks are not in the take, and the pass begins on the downbeat instead of
      // wherever the key happened to land.
      if (tempoOn) {
        startClick(bpmRef.current, { lead: COUNT_IN });
        flash('COUNT IN · ' + COUNT_IN);
        await new Promise((resolve) => {
          setTimeout(resolve, Math.round(beatSeconds(bpmRef.current) * COUNT_IN * 1000));
        });
      }
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
      stopClick();
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
    phys.handSpun = false;
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
    if (phys.pos >= TAPE_SECONDS - 1) {
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
    const left = Math.max(0, TAPE_SECONDS - phys.pos);
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
    phys.pos = Math.max(0, Math.min(TAPE_SECONDS, time));
    setHud({ pos: phys.pos, vel: phys.vel });
  };

  const askDelete = (cue, idx) => {
    Alert.alert('Delete ' + (cue.label || 'cue ' + (idx + 1)) + '?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => safe(() => studio.removeCue && studio.removeCue(cue.id)) },
    ]);
  };

  // What a radio reel is playing. A playlist laid on the tape is unreadable by
  // ear alone: its songs all sit on one track, so nothing about the track keys
  // says which one the head is over. The tape position does.
  const radioSongs = [];
  tracks.forEach((tr) => (tr.takes || []).forEach((tk) => { if (tk && tk.radio) radioSongs.push(tk); }));
  const radio = radioSongs.length > 0;
  let onAir = null;
  for (let i = 0; i < radioSongs.length; i += 1) {
    const tk = radioSongs[i];
    const from = Number(tk.start) || 0;
    const off = hud.pos - from;
    if (off < 0 || off >= (Number(tk.duration) || 0)) continue;
    // Two songs only overlap on a reel that was hand-edited; the later one wins,
    // since that is the start the head crossed most recently.
    if (!onAir || from >= (Number(onAir.start) || 0)) onAir = tk;
  }

  // Layout
      // Every fixed band on the face, top to bottom: display panel, control knobs, the
  // mode row, the mode keys with their captions, the sliders, the tape strip, the
  // track keys and the transport. All of those are measured by the layout; the
  // disc takes what is left, and its own box is measured rather than guessed, so
  // it can never push the captions off the bottom of the screen.
  // The disc's measured height. Named apart from `wheelBox`, which is the wheel's
  // position on screen for reading a hand's angle.
  const [discHeight, setDiscHeight] = useState(0);
  const chrome = insets.top + insets.bottom + 58 + 48 + 24 + 46 + 56 + 44 + 70 + 12;
  const size = Math.max(140, Math.min(W - 6, (discHeight || H - chrome) - 48));
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
  const moving = Math.abs(hud.vel) >= 1;
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
        ? 'REMAINING ' + fmtRem(TAPE_SECONDS - hud.pos) + ' · ' + sr + ' kHz · 24-BIT PCM' + (settings.bounce ? ' · BOUNCE' : '')
        : 'TAP A TRACK TO RECORD ONTO IT');
  const active = moving || recording;
  // While a pass is being made the meter is the microphone's own peak. A meter
  // that moves while the input is silent is worse than no meter: it is the one
  // thing that would have said, plainly, that nothing was coming in.
  // Under the head: how much audio the mix is really delivering. The meter used to
  // be a sine wave plus a random number, which moved while the tape was silent —
  // the one thing a meter must never do.
  const mixLevel = (() => {
    let sum = 0;
    for (let i = 0; i < tracks.length; i += 1) {
      const tr = tracks[i];
      const takes = tr.takes || [];
      if (!takes.length) continue;
      const take = takes.find((k) => k.id === tr.activeTakeId) || takes[takes.length - 1];
      if (!take) continue;
      const from = Number(take.start) || 0;
      const dur = Number(take.duration) || 0;
      if (!(dur > 0) || hud.pos < from || hud.pos > from + dur) continue;
      sum += (typeof tr.level === 'number' ? tr.level : 0.75) * 0.45;
    }
    return Math.min(1, sum);
  })();
  const level = recording
    ? Math.max(0, Math.min(1, (hud.mic || 0) * 1.6))
    : moving ? mixLevel : 0;
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
    // The key IS the tape's speed, the way a field recorder's varispeed is: the
    // take bends in pitch at once and no copy of it is ever rendered.
    trimRef.current = clamp(semisToTrim(next), PITCH_TRIM_MIN, PITCH_TRIM_MAX);
    setSemis(next);
    Haptics.selectionAsync().catch(() => {});
  };
  const nudgeSpeed = (dir) => setSpeedValue(speedRef.current + dir * SPEED_STEP);
  const nudgeKey = (dir) => setKeyValue(semisRef.current + dir * KEY_STEP);

  const cyclePitch = () => {
    Haptics.selectionAsync().catch(() => {});
    const next = (pitchMode + 1) % 3;
    setPitchMode(next);
    if (next === 0) {
      // Off means the tape at its own speed, and the key back where it was.
      trimRef.current = 1;
      semisRef.current = 0;
      setSemis(0);
      flash('PITCH OFF — 100%');
    } else if (next === 1) {
      flash('PITCH ADJUST — ± BENDS THE TAPE');
    } else {
      flash('PITCH LOCKED — SPEED KEEPS THE KEY');
    }
  };
  const cycleCue = () => {
    Haptics.selectionAsync().catch(() => {});
    const next = cueMode === 1 ? 0 : 1;
    setCueMode(next);
    flash(next ? 'CUE — ± ADDS AND REMOVES' : 'CUE OFF');
  };
  const cycleLoop = () => {
    Haptics.selectionAsync().catch(() => {});
    const next = (loopMode + 1) % 3;
    setLoopMode(next);
    if (next === 0) flash(loopIn != null && loopOut != null ? 'LOOP OFF' : 'NO LOOP');
    else if (next === 1) flash('LOOP — + SETS IN, − SETS OUT');
    else if (loopIn != null && loopOut != null) flash('LOOP PLAY ' + fmt(loopIn) + ' → ' + fmt(loopOut));
    else flash('SET AN IN AND AN OUT FIRST');
  };
  // The ± pair. What it does is the selected mode's job; with no mode selected it
  // is the transport's speed, which is the one thing always worth a nudge.
  const modeStep = (dir) => {
    if (tempoOn) {
      const next = clampBpm(bpmRef.current + dir);
      if (next === bpmRef.current) return;
      bpmRef.current = next;
      setBpm(next);
      Haptics.selectionAsync().catch(() => {});
      flash('TEMPO ' + next + ' BPM');
      return;
    }
    if (loopMode === 1) {
      if (dir > 0) {
        const at = hud.pos;
        setLoopIn(at);
        if (loopOut != null && loopOut <= at) setLoopOut(null);
        flash('LOOP IN ' + fmt(at));
      } else {
        if (loopIn == null) { flash('SET THE IN POINT FIRST'); return; }
        if (hud.pos <= loopIn) { flash('THE OUT POINT MUST FOLLOW THE IN'); return; }
        setLoopOut(hud.pos);
        flash('LOOP OUT ' + fmt(hud.pos));
      }
      return;
    }
    if (cueMode === 1) {
      if (dir > 0) { dropCue(); return; }
      const last = cues[cues.length - 1];
      if (!last) { flash('NO CUE TO REMOVE'); return; }
      safe(() => studio.removeCue && studio.removeCue(last.id));
      flash('CUE REMOVED');
      return;
    }
    if (pitchMode === 1) { nudgeKey(dir); return; }
    nudgeSpeed(dir);
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

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }} {...swipe.panHandlers}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      {/* Obsidian glass ground: the deck is a slab, not a photograph. */}
      <ObsidianBackdrop />
      <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom + 4 }}>
        {/* The display sits in the middle of the face, as it reads on the machine:
            counter and tempo in the centre, the meters over on the right. */}
        <View style={s.top}>
          <View style={s.topSide} />
          <Pressable
            onPress={() => nav.navigate('Sessions')}
            onLongPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); setOffset(hud.pos); flash('COUNTER RESET'); }}
            delayLongPress={500}
            accessibilityRole="button"
            accessibilityLabel={'Tape counter ' + fmt(display) + '. Open sessions; hold to reset the counter.'}
            style={s.topCenter}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={[t.font.title, s.timecode, { color: recording ? t.danger : t.text }]}>{fmt(display)}</Text>
              <View style={[s.recLamp, { backgroundColor: recording ? t.danger : 'rgba(255,255,255,0.13)' }]} />
            </View>
            <EngravedText size={9} color={tempoOn ? t.accent : t.textMuted} numberOfLines={1} style={{ marginTop: 1 }}>
              {(recording ? 'REC · ' : '') + ((current && current.name) || 'UNTITLED TAPE') + ' · ' + bpm + ' BPM'
                + (Number(settings.recordBars) > 0 ? ' · ' + settings.recordBars + ' BAR' : '')}
            </EngravedText>
          </Pressable>
          {/* Two channels. The takes on the tape are mono, so both carry the same
              signal and both ladders read it; they part company the day a stereo
              take reaches the mix. */}
          <View style={s.topSideEnd}>
            <View style={s.meter}>
              <EngravedText size={7} color={t.textMuted}>{recording ? 'IN' : 'OUT'}</EngravedText>
              <View style={s.meterPair}>
                <LedLadder level={level} rows={9} />
                <LedLadder level={level} rows={9} />
              </View>
              <EngravedText size={6} color={'rgba(255,255,255,0.3)'}>L  R</EngravedText>
            </View>
          </View>
        </View>

        {/* The knobs: each one opens a part of the machine. */}
        {/* The knobs, grouped the way they are on the case: the recording side on
            the left, the pages on the right. */}
        <View style={s.knobRow}>
          <View style={s.knobGroup}>
            <Knob
              label="TEMPO"
              size={36}
              active={tempoOn || Number(settings.recordBars) > 0}
              onPress={cycleTempo}
              onLongPress={cycleRecordBars}
              delayLongPress={400}
              accessibilityLabel={
                (tempoOn ? 'Tempo: set the BPM with ±' : 'Tempo off')
                + (Number(settings.recordBars) > 0 ? ', record length ' + settings.recordBars + ' bars' : ', hold for record length')
              }
            />
            <Knob
              label="TAKES"
              size={36}
              onPress={() => nav.navigate('Takes', { track: Math.max(0, tracks.findIndex((tr) => tr.armed)) })}
              accessibilityLabel="Open the takes on the armed track"
            />
            {canImportAudio() ? (
              <Knob label="IMPORT" size={36} onPress={onImport} accessibilityLabel="Import an audio file as a take" />
            ) : null}
            <Knob label="SAVE" size={36} onPress={onExport} accessibilityLabel="Save the reel as a WAV file" />
          </View>
          <View style={s.knobGroup}>
            <Knob label="RADIO" size={36} active={radio} onPress={() => nav.navigate('Radio')} accessibilityLabel="Tape radio, put a playlist on the reel" />
            <Knob label="SETTINGS" size={36} onPress={() => nav.navigate('Back Panel')} accessibilityLabel="Flip to the back panel" />
            <Knob label="LIBRARY" size={36} onPress={() => nav.navigate('Sessions')} accessibilityLabel="Open the tape library" />
          </View>
        </View>

        {/* Mode indicators and the four track boxes, as printed on the panel. */}
        <View style={s.statusRow}>
          {/* The three modes, in the manual's colours: grey off, red adjusting,
              white locked or playing. Each word is the key that cycles it. */}
          <Pressable onPress={cycleCue} accessibilityRole="button" accessibilityLabel="Cue mode">
            <EngravedText size={10} color={cueMode === 1 ? t.danger : cues.length > 0 ? t.text : 'rgba(255,255,255,0.32)'}>CUE</EngravedText>
          </Pressable>
          <Pressable onPress={cyclePitch} accessibilityRole="button" accessibilityLabel="Pitch mode">
            <EngravedText size={10} color={pitchMode === 1 ? t.danger : pitchMode === 2 ? t.text : 'rgba(255,255,255,0.32)'}>PITCH</EngravedText>
          </Pressable>
          <Pressable onPress={cycleLoop} accessibilityRole="button" accessibilityLabel="Loop mode">
            <EngravedText size={10} color={loopMode === 1 ? t.danger : loopMode === 2 ? t.text : 'rgba(255,255,255,0.32)'}>LOOP</EngravedText>
          </Pressable>
          <EngravedText size={9} color={'rgba(255,255,255,0.22)'} style={{ marginLeft: 2 }}>TAPE</EngravedText>
          <View style={{ flex: 1 }} />
          <View style={s.tapeChips}>
            {tracks.map((tr, i) => (
              <Pressable
                key={i}
                onPress={() => selectTrack(i)}
                accessibilityRole="button"
                accessibilityLabel={'Select track ' + (i + 1) + (tr.armed ? ', armed' : '')}
                style={[s.tapeChip, tr.armed && { backgroundColor: t.accent, borderColor: t.accent }]}
              >
                <Text style={[t.font.caption, { color: tr.armed ? t.onAccent : t.textMuted, fontSize: 9, lineHeight: 12 }]}>{'0' + (i + 1)}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* What the head is over, on a radio reel: every song sits on one track, so
            nothing else on the face names the one that is playing. */}
        {radio ? (
          <View
            style={s.onAir}
            accessible
            accessibilityLabel={
              onAir
                ? 'Playing ' + (onAir.title || 'a song') + (onAir.artist ? ' by ' + onAir.artist : '')
                : 'Between songs on this radio reel'
            }
          >
            <View style={[s.onAirLamp, { backgroundColor: onAir ? (moving ? t.accent : t.warning) : glassStroke }]} />
            <View style={{ flex: 1, minWidth: 0 }}>
              {onAir ? (
                <>
                  <EngravedText size={11} color={moving ? t.accent : t.text} numberOfLines={1}>{onAir.title || 'Untitled track'}</EngravedText>
                  <EngravedText size={9} color={t.textMuted} numberOfLines={1}>
                    {(onAir.artist || 'Unknown artist') + (onAir.preview ? ' · PREVIEW' : '')}
                  </EngravedText>
                </>
              ) : (
                <EngravedText size={10} color={t.textMuted} numberOfLines={1}>BETWEEN SONGS · SPIN TO THE NEXT</EngravedText>
              )}
            </View>
            {onAir && onAir.n ? (
              <EngravedText size={9} color={t.textMuted}>{onAir.n + '/' + radioSongs.length}</EngravedText>
            ) : null}
          </View>
        ) : null}

        {/* The disc: the largest thing on the screen, because it is the instrument. */}
        <View style={s.wheelArea} onLayout={(e) => setDiscHeight(e.nativeEvent.layout.height || 0)}>
          {/* Printed on the case over the disc, still while the spool turns. */}
          <View pointerEvents="none" style={s.wordmark}>
            <Text style={[t.font.title, s.wordmarkTitle]}>TRNV</Text>
            <EngravedText size={8} color={t.textMuted}>4-TRACK DIGITAL TAPE RECORDER</EngravedText>
          </View>
          <View
            ref={wheelNode}
            onLayout={() => { wheelSize.current = size; measureWheel(); }}
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
          </View>
          {/* The mode keys and the one ± pair, as they sit below the disc on the
              machine. The pair belongs to whichever mode is selected. */}
          <View style={s.functionRow}>
            {/* − and + sit at the two ends of the wheel, the three modes spread
                between them: the pair belongs to the mode, not to the row. */}
            <Knob label="−" size={34} onPress={() => modeStep(-1)} accessibilityLabel="Minus" />
            <View style={s.modeGroup}>
            <Knob
              label="CUE"
              size={34}
              active={cueMode === 1}
              onPress={cycleCue}
              accessibilityLabel={cueMode === 1 ? 'Cue: add and remove with ±' : 'Cue off'}
            />
            <Knob
              label="PITCH"
              size={34}
              active={pitchMode === 1}
              onPress={cyclePitch}
              accessibilityLabel={pitchMode === 1 ? 'Pitch adjusting' : pitchMode === 2 ? 'Pitch locked' : 'Pitch off'}
            />
            <Knob
              label="LOOP"
              size={34}
              active={loopMode !== 0}
              onPress={cycleLoop}
              accessibilityLabel={loopMode === 1 ? 'Loop: set the points' : loopMode === 2 ? 'Loop playing' : 'Loop off'}
            />
            </View>
            <Knob label="+" size={34} onPress={() => modeStep(1)} accessibilityLabel="Plus" />
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
          {/* The IN point on its own, so setting it is something you can see. */}
          {loopIn != null && loopOut == null ? (
            <View pointerEvents="none" style={[s.loopIn, { left: px(loopIn) - 1, backgroundColor: t.warning }]} />
          ) : null}
          {/* The loop, drawn on the tape where it sits. */}
          {loopIn != null && loopOut != null ? (
            <View
              pointerEvents="none"
              style={[
                s.loopBar,
                {
                  left: px(loopIn),
                  width: Math.max(3, px(loopOut) - px(loopIn)),
                  backgroundColor: loopMode === 2 ? t.accent : 'rgba(255,255,255,0.22)',
                },
              ]}
            />
          ) : null}
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

        {/* A message while there is something to say, and — with LOOP selected —
            the points themselves, kept on screen. A hint that disappears after two
            seconds leaves the loop looking like it did nothing. */}
        {legendMsg ? (
          <EngravedText size={10} color={t.accent} style={{ textAlign: 'center', marginTop: 2 }}>{legendMsg}</EngravedText>
        ) : loopMode === 1 ? (
          <EngravedText size={10} color={t.warning} style={{ textAlign: 'center', marginTop: 2 }}>
            {'IN ' + (loopIn != null ? fmt(loopIn) : '—') + ' · OUT ' + (loopOut != null ? fmt(loopOut) : '—') + '   + SETS IN   − SETS OUT'}
          </EngravedText>
        ) : loopMode === 2 && loopIn != null && loopOut != null ? (
          <EngravedText size={10} color={t.accent} style={{ textAlign: 'center', marginTop: 2 }}>
            {'LOOP PLAYING ' + fmt(loopIn) + ' → ' + fmt(loopOut)}
          </EngravedText>
        ) : null}

        {/* Arm row and cue */}
        <View style={s.armRow}>
          {tracks.map((tr, i) => {
            if (i !== selTrack) return null; // one track on the face; the TAPE boxes cycle
            const armed = !!tr.armed;
            const n = (tr.takes || []).length;
            const activeTake = (tr.takes || []).find((k) => k.id === tr.activeTakeId) || (tr.takes || [])[n - 1];
            const silent = !!(activeTake && activeTake.peak === 0);
            // A take whose file this page cannot find is silence with a reason: say
            // so on the track instead of letting it claim to play.
            // A radio song is a remote URL, not a take stored on this device: it
            // has no local copy to find and must not be reported as missing.
            const remote = !!(activeTake && /^https?:/i.test(activeTake.uri || ''));
            const noAudio = !!(audioChecked && activeTake && !silent && !remote && !takeAudioReady(activeTake));
            const songsOnIt = (tr.takes || []).filter((k) => k && k.radio).length;
            return (
              <View
                key={i}
                style={[
                  s.arm,
                  {
                    backgroundColor: armed ? 'rgba(255,255,255,0.045)' : glassFill,
                    borderColor: armed ? t.accent : glassStroke,
                    shadowColor: t.accent,
                    shadowOpacity: 0,
                    shadowRadius: 10,
                    shadowOffset: { width: 0, height: 0 },
                  },
                ]}
              >
                {/* The key arms the track. The level bar sits over its lower edge as
                    a sibling, not inside it: a touch on the fader that also armed the
                    track would make every level change a recording decision. */}
                <Pressable
                  onPress={() => toggleArm(i)}
                  onLongPress={() => nav.navigate('Takes', { track: i })}
                  delayLongPress={350}
                  accessibilityRole="button"
                  accessibilityLabel={'Track ' + (i + 1) + (armed ? ' armed' : ' not armed') + ', hold for takes'}
                  style={({ pressed }) => [s.armKey, { opacity: pressed ? 0.75 : 1 }]}
                >
                  <Text style={[t.font.label, { color: armed ? t.text : t.textMuted, fontSize: 11, lineHeight: 14 }]}>{'TRK ' + (i + 1)}</Text>
                  <Text style={[t.font.caption, { color: armed ? t.warning : t.textMuted, fontSize: 10, lineHeight: 13, opacity: 0.95 }]}>
                    {armed ? 'REC HERE' : silent ? 'SILENT' : noAudio ? 'NO AUDIO' : songsOnIt > 0 ? songsOnIt + ' SONGS' : n > 0 ? (anyArmed ? 'PLAYS' : n === 1 ? '1 TAKE' : n + ' TAKES') : 'EMPTY'}
                  </Text>
                </Pressable>
                {/* The track's level. The mix already used it; this sets it. */}
                <TrackLevel
                  index={i}
                  value={typeof tr.level === 'number' ? tr.level : 0.75}
                  color={armed ? t.onAccent : glassStroke}
                  fill={armed ? t.onAccent : t.warning}
                  textColor={armed ? t.onAccent : t.textMuted}
                  onDrag={(v) => setLevelDrag({ index: i, value: v })}
                  onChange={(v) => {
                    setLevelDrag(null);
                    safe(() => studio.updateTrack && studio.updateTrack(i, { level: v }));
                  }}
                  style={s.trackLevel}
                />
              </View>
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

        {/* Transport: the three capture keys, then the two wind keys, captioned
            underneath the way they are printed on the case. */}
        <Animated.View style={[s.transport, { transform: [{ translateX: shake }] }]}>
          {/* Two housings, as on the case: the capture keys, then the wind keys. */}
          <View style={[s.housing, { flex: 3 }]}>
            <KeyCap
              tone="record"
              label="REC"
              onPress={onRecord}
              accessibilityLabel={recording ? 'Stop recording' : 'Record'}
              active={recording || anyArmed}
            />
            <KeyCap
              icon={mode === 'play' ? 'pause' : 'play'}
              label={mode === 'play' ? 'PAUSE' : 'PLAY'}
              onPress={onPlay}
              accessibilityLabel={mode === 'play' ? 'Pause' : 'Play'}
              active={mode === 'play'}
            />
            <KeyCap icon="stop" label="STOP" onPress={onStop} accessibilityLabel="Stop, double tap for start of tape" />
          </View>
          <View style={[s.housing, { flex: 2 }]}>
            <KeyCap icon="play-back" label="REW" onPress={onRew} accessibilityLabel="Rewind" active={mode === 'rew'} />
            <KeyCap icon="play-forward" label="FF" onPress={onFF} accessibilityLabel="Fast forward" active={mode === 'ff'} />
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  top: { height: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  topSide: { flex: 1 },
  topSideEnd: { flex: 1, alignItems: 'flex-end' },
  topCenter: { minHeight: 56, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },

  timecode: { fontSize: 34, lineHeight: 38, letterSpacing: 1.5, fontVariant: ['tabular-nums'] },
  recLamp: {
    width: 9,
    height: 9,
    borderRadius: 5,
    marginLeft: 10,
    shadowColor: '#FF3B1F',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 8,
  },
  knobRow: { height: 48, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 16 },
  knobGroup: { flexDirection: 'row', gap: 16 },
  statusRow: { height: 24, flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 18 },
  meter: { alignItems: 'center', justifyContent: 'center', gap: 1 },
  meterPair: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  tapeChips: { flexDirection: 'row', gap: 4 },
  tapeChip: {
    width: 20,
    height: 14,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Printed on the disc's face, as it is on the machine, rather than stacked above
  // it: the disc is the biggest thing on the screen and has room for its own name.
  wordmark: { position: 'absolute', top: 44, left: 0, right: 0, alignItems: 'center', zIndex: 2 },
  wordmarkTitle: { fontSize: 15, lineHeight: 19, letterSpacing: 5, color: 'rgba(255,255,255,0.55)' },
  onAir: { height: 34, marginTop: 6, marginHorizontal: 18, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 8, borderWidth: 1, borderColor: glassStroke, backgroundColor: glassFill },
  onAirLamp: { width: 6, height: 6, borderRadius: 3 },
  wheelArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // alignSelf: the wheel area centres its children, and a centred row would shrink
  // to its own width — the ± pair has to reach the edges of the wheel, not sit in
  // the middle of the screen.
  functionRow: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginTop: 4, paddingHorizontal: 8 },
  modeGroup: { flex: 1, flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 4 },
  loopBar: { position: 'absolute', top: 10, height: 3, borderRadius: 2 },
  loopIn: { position: 'absolute', top: 8, width: 2, height: 30, borderRadius: 1 },

  strip: { height: 56, marginHorizontal: 20, justifyContent: 'center' },
  stripBar: { height: 14, borderRadius: 3, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  playhead: { position: 'absolute', width: 2, height: 26, top: 12 },
  grip: { position: 'absolute', width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, top: 19 },
  flag: { position: 'absolute', top: 2, width: 18, height: 16, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  stripLabels: { position: 'absolute', left: 0, right: 0, bottom: 2, flexDirection: 'row', justifyContent: 'space-between' },
  armRow: { height: 44, flexDirection: 'row', marginHorizontal: 14, marginTop: 2, gap: 6 },
  arm: { flex: 1, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  armKey: { flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  trackLevel: { marginHorizontal: 6, marginBottom: 3 },
  cueKey: { width: 46, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  transport: { flexDirection: 'row', marginHorizontal: 14, gap: 10, marginTop: 8 },
  housing: {
    flexDirection: 'row',
    gap: 3,
    padding: 3,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    backgroundColor: 'rgba(255,255,255,0.035)',
  },
});
