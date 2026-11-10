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
import { createMixer, buildItems } from '../lib/audio/TapeMixer';
import EngravedText from '../components/EngravedText';
import VUMeter from '../components/VUMeter';
import { pickAudioFile, canImportAudio } from '../lib/audio/importTake';
import { micUnavailableReason, startMicTake, stopMicTake } from '../lib/audio/recordTake';
import { ObsidianBackdrop, GlassPanel, GlassSpecular, glassStroke, glassFill } from '../ui/glass';
import GlassReel from '../components/GlassReel';

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
const TARGET = { stop: 0, play: NORMAL, rec: NORMAL, rew: -MAXV, ff: MAXV };

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

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const mixerRef = useRef(null);
  if (!mixerRef.current) mixerRef.current = createMixer();
  const syncRef = useRef(() => {});
  const recBusy = useRef(false);

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
    const items = buildItems(tracks, p.mode === 'rec' ? p.recTracks : []);
    safe(() => mixerRef.current.sync(items, p.pos, going, rate));
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
      try {
        if (Platform.OS === 'web') {
          const take = await stopMicTake();
          uri = take && take.uri;
        } else {
          await recorder.stop();
          uri = recorder.uri;
        }
      } catch (e) {
        uri = null;
      }
      safe(() => setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {}));
      if (dur < 1) {
        flash('TOO SHORT · NOTHING SAVED');
        return;
      }
      if (!uri) {
        Alert.alert('Nothing was captured', 'The microphone did not return any audio. Try recording again.');
        return;
      }
      try {
        // One decimal, like the import path: a 3.54s take should stop where the
        // audio stops, not 0.46s past it in the mixer.
        const length = Math.round(dur * 10) / 10;
        list.forEach((i) => studio.addTake && studio.addTake(i, length, undefined, { uri, start }));
        flash('TAKE SAVED · ' + fmtShort(dur));
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
          const target = TARGET[p.mode] || 0;
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
    if (armed.length === 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      flash('ARM A TRACK FIRST');
      shake.setValue(0);
      Animated.sequence([6, -6, 4, -4, 0].map((v) => Animated.timing(shake, { toValue: v, duration: 50, useNativeDriver: true }))).start();
      return;
    }
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
          float32: settings.float32 !== false,
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
    phys.recTracks = armed;
    setRecFrom(phys.pos);
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
    const targets = armed.length ? armed : [0];
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
      targets.forEach((i) => studio.addTake && studio.addTake(i, length, undefined, { uri: picked.uri, start: phys.pos }));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      flash('TAKE SAVED · ' + fmtShort(length));
    } catch (e) {
      Alert.alert('Could not save the take', (e && e.message) || 'Try again.');
    }
  };

  const toggleArm = (i) => {
    Haptics.selectionAsync().catch(() => {});
    if (mode === 'rec') { flash('STOP BEFORE CHANGING ARMS'); return; }
    if (typeof studio.updateTrack === 'function') safe(() => studio.updateTrack(i, { armed: !tracks[i].armed }));
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

  const span = Math.max(60, Math.ceil((Math.max(recorded, hud.pos) + 10) / 30) * 30);
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
  const legend = legendMsg
    || (anyArmed
      ? 'REMAINING ' + fmtRem(CAPACITY - hud.pos) + ' · ' + sr + ' kHz · ' + (settings.float32 === false ? '24-BIT' : '32-BIT FLOAT')
      : 'ARM A TRACK, THEN PRESS REC');
  const active = moving || recording;
  const level = active ? Math.min(1, 0.4 + 0.3 * Math.abs(Math.sin(hud.pos * 6.3)) + 0.15 * Math.random() + Math.min(0.2, speedX * 0.03)) : 0;
  const spin = angleVal.interpolate({ inputRange: [-360, 360], outputRange: ['-360deg', '360deg'] });
  const px = (sec) => Math.max(0, Math.min(stripW, (sec / span) * stripW));

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
          <Pressable onPress={() => nav.navigate('DJ Mode')} accessibilityRole="button" accessibilityLabel="Open DJ mode" style={s.topBtn}>
            <Ionicons name="options" size={22} color={t.textMuted} />
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
          <GlassPanel radius={16} style={[s.speedPill, { borderColor: recording ? t.accent : glassStroke }]}>
            <Ionicons
              name={!moving ? 'pause' : hud.vel > 0 ? 'play' : 'play-back'}
              size={14}
              color={recording ? t.accent : t.warning}
            />
            <EngravedText size={12} color={recording ? t.accent : t.warning} style={{ marginLeft: 6 }}>
              {recording ? 'RECORDING · 100%' : !moving ? 'STOPPED · SPIN TO SCRUB' : speedX > PLAYABLE_X ? 'SPOOLING' : speedPct + '%'}
            </EngravedText>
          </GlassPanel>
        </View>

        {/* Tape strip: the whole recording, tap to jump */}
        <Pressable
          onPress={(e) => jumpTo((e.nativeEvent.locationX / Math.max(1, stripW)) * span)}
          onLayout={(e) => setStripW(e.nativeEvent.layout.width || 300)}
          style={s.strip}
          accessibilityRole="adjustable"
          accessibilityLabel="Recording timeline, tap to jump"
        >
          <View pointerEvents="none" style={[s.stripBar, { backgroundColor: t.accentSoft, borderColor: t.border }]}>
            <View style={{ position: 'absolute', left: 0, width: px(recorded), top: 0, bottom: 0, backgroundColor: t.warning, opacity: 0.35 }} />
            {recording ? (
              <View style={{ position: 'absolute', left: px(recFrom), width: Math.max(2, px(hud.pos) - px(recFrom)), top: 0, bottom: 0, backgroundColor: t.accent }} />
            ) : null}
          </View>
          <View pointerEvents="none" style={[s.playhead, { left: px(hud.pos) - 1, backgroundColor: recording ? t.accent : t.text }]} />
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
        </Pressable>

        <EngravedText size={12} color={legendMsg ? t.accent : t.textMuted} style={{ textAlign: 'center', marginTop: 4 }}>{legend}</EngravedText>

        {/* Arm row and cue */}
        <View style={s.armRow}>
          {tracks.map((tr, i) => {
            const armed = !!tr.armed;
            const n = (tr.takes || []).length;
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
                  {armed ? 'ARMED' : n > 0 ? n + (n === 1 ? ' TAKE' : ' TAKES') : 'EMPTY'}
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
  speedPill: { marginTop: 8, height: 32, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, flexDirection: 'row', alignItems: 'center' },
  strip: { height: 64, marginHorizontal: 20, justifyContent: 'center' },
  stripBar: { height: 14, borderRadius: 3, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  playhead: { position: 'absolute', width: 2, height: 30, top: 14 },
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
