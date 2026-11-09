import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, PanResponder, StatusBar, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../ui/theme';
import { AppImage } from '../ui/kit';
import { ART } from '../constants/artwork';
import RubberKey from '../components/RubberKey';
import EngravedText from '../components/EngravedText';
import NavBar from '../components/NavBar';
import { engine } from '../lib/audio/AudioEngine';
import { createMixer, buildItems } from '../lib/audio/TapeMixer';
import { useStudio } from '../store/StudioContext';

const SPEED_IPS = 7.5;

function safe(fn) {
  try {
    if (typeof fn === 'function') return fn();
  } catch (e) {
    return undefined;
  }
  return undefined;
}

function Platter({ size, angle, onDelta, onRelease }) {
  const cb = useRef({ onDelta, onRelease });
  cb.current = { onDelta, onRelease };
  const last = useRef({ a: 0, t: 0 });
  const pan = useMemo(() => {
    const ang = (e) => {
      const { locationX, locationY } = e.nativeEvent;
      return (Math.atan2(locationY - size / 2, locationX - size / 2) * 180) / Math.PI;
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        last.current = { a: ang(e), t: Date.now() };
        cb.current.onDelta(0, 0, true);
      },
      onPanResponderMove: (e) => {
        const a = ang(e);
        let d = a - last.current.a;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        const now = Date.now();
        const dt = Math.max(8, now - last.current.t);
        last.current = { a, t: now };
        cb.current.onDelta(d, (d / dt) * 1000, false);
      },
      onPanResponderRelease: () => cb.current.onRelease(),
      onPanResponderTerminate: () => cb.current.onRelease(),
    });
  }, [size]);
  return (
    <View style={{ width: size, height: size }} {...pan.panHandlers}>
      <View pointerEvents="none" style={{ width: size, height: size, transform: [{ rotate: angle + 'deg' }] }}>
        <AppImage source={ART.reelFull} contentFit="contain" style={{ width: size, height: size }} />
      </View>
    </View>
  );
}

export default function DJModeScreen() {
  const t = useTheme();
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const studio = useStudio() || {};
  const session = studio.currentSession || null;
  const items = buildItems((session && session.tracks) || [], []);

  const [angle, setAngle] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [reversed, setReversed] = useState(false);
  const [pitch, setPitch] = useState(0);
  const [nudge, setNudge] = useState(0);
  const [trackH, setTrackH] = useState(200);

  const st = useRef({ playing: false, reversed: false, pitch: 0, nudge: 0, scratch: 0, angle: 0, dragging: false, trackH: 200, pos: 0 });
  const faderStart = useRef(0);
  const lastTap = useRef(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const mixerRef = useRef(null);
  if (!mixerRef.current) mixerRef.current = createMixer();

  const pushPitch = useCallback(() => {
    const s = st.current;
    const total = s.pitch + s.nudge + s.scratch;
    safe(() => engine.setPitch(total / 100));
  }, []);

  useEffect(() => {
    let raf;
    let prev = Date.now();
    const loop = () => {
      const now = Date.now();
      const dt = (now - prev) / 1000;
      prev = now;
      const s = st.current;
      const rate = Math.max(0.5, Math.min(1.5, 1 + (s.pitch + s.nudge) / 100));
      if (s.playing && !s.dragging) {
        const dir = s.reversed ? -1 : 1;
        s.angle = (s.angle + dir * rate * 200 * dt) % 360;
        s.pos = Math.max(0, s.pos + dir * rate * dt);
        setAngle(s.angle);
      }
      const list = itemsRef.current || [];
      const end = list.reduce((m, it) => Math.max(m, it.start + it.duration), 0);
      if (s.playing && !s.reversed && end > 0 && s.pos > end + 0.5) s.pos = 0;
      // Recorded tape cannot be read backwards, so reverse is silent; forward play is heard.
      safe(() => mixerRef.current.sync(list, s.pos, s.playing && !s.reversed && !s.dragging, rate));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    return () => {
      safe(() => mixerRef.current && mixerRef.current.dispose());
      safe(() => engine.setPitch(0));
      safe(() => engine.stop());
    };
  }, []);

  const goBack = () => {
    st.current.playing = false;
    safe(() => engine.setPitch(0));
    safe(() => engine.stop());
    if (nav.canGoBack()) nav.goBack();
    else nav.navigate('Back Panel');
  };

  const onPlatterDelta = (d, rate, start) => {
    const s = st.current;
    if (start) {
      s.dragging = true;
      return;
    }
    s.angle = (s.angle + d + 360) % 360;
    s.pos = Math.max(0, s.pos + d / 360);
    setAngle(s.angle);
    safe(() => engine.scrub(d / 360));
    s.scratch = Math.max(-16, Math.min(16, rate / 30));
    pushPitch();
  };
  const onPlatterRelease = () => {
    const s = st.current;
    s.dragging = false;
    s.scratch = 0;
    pushPitch();
  };

  const togglePlay = () => {
    const s = st.current;
    s.playing = !s.playing;
    setPlaying(s.playing);
    Haptics.selectionAsync();
    if (s.playing) {
      safe(() => engine.play());
      pushPitch();
    } else {
      safe(() => engine.stop());
    }
  };

  const toggleReverse = () => {
    const s = st.current;
    s.reversed = !s.reversed;
    setReversed(s.reversed);
    Haptics.selectionAsync();
    safe(() => engine.reverse());
    if (!s.playing) {
      s.playing = true;
      setPlaying(true);
      safe(() => engine.play());
    }
    pushPitch();
  };

  const bend = (v) => {
    st.current.nudge = v;
    setNudge(v);
    pushPitch();
  };

  const fader = useMemo(() => {
    const clampPitch = (v) => {
      let x = Math.max(-16, Math.min(16, v));
      if (Math.abs(x) < 0.8) x = 0;
      return Math.round(x * 10) / 10;
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        faderStart.current = st.current.pitch;
      },
      onPanResponderMove: (_, g) => {
        const usable = Math.max(1, st.current.trackH || 200);
        const v = clampPitch(faderStart.current - (g.dy / usable) * 32);
        if (v !== st.current.pitch) {
          if (v === 0) Haptics.selectionAsync();
          st.current.pitch = v;
          setPitch(v);
          pushPitch();
        }
      },
      onPanResponderRelease: (_, g) => {
        if (Math.abs(g.dy) < 6 && Math.abs(g.dx) < 6) {
          const now = Date.now();
          if (now - lastTap.current < 320) {
            st.current.pitch = 0;
            setPitch(0);
            pushPitch();
            Haptics.selectionAsync();
          }
          lastTap.current = now;
        }
      },
    });
  }, [pushPitch]);
  st.current.trackH = trackH;

  const shown = pitch + nudge;
  const pitchText = (shown >= 0 ? '+' : '') + shown.toFixed(1) + '%';
  const speed = Math.abs(shown) < 0.05 ? '7½' : (SPEED_IPS * (1 + shown / 100)).toFixed(1);

  const keyH = 64;
  const chrome = insets.top + 44 + keyH + 34 + insets.bottom + 16;
  const reelSize = Math.max(120, Math.min(260, width - 56, Math.floor((height - chrome - 2 * 56) / 2) + 24));
  const thumbTop = (0.5 - pitch / 32) * trackH;
  const holdText = items.length === 0
    ? 'NO TAKES TO PLAY · RECORD ON THE DECK FIRST'
    : reversed
      ? 'REVERSE IS SILENT · HOLD TO BEND'
      : 'HOLD TO BEND';

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <StatusBar barStyle="light-content" />
      <AppImage source={ART.deckPlate} contentFit="cover" style={StyleSheet.absoluteFill} />
      <View style={{ paddingTop: insets.top }}>
        <NavBar
          title="DJ MODE"
          onBack={goBack}
          right={
            <View style={styles.live}>
              <View style={[styles.lamp, { backgroundColor: t.accent, shadowColor: t.accent }]} />
              <EngravedText size={12} color={t.accent}>LIVE</EngravedText>
            </View>
          }
        />
      </View>

      <View style={styles.middle}>
        <View style={styles.platters}>
          <View style={styles.platterBlock}>
            <Platter size={reelSize} angle={angle} onDelta={onPlatterDelta} onRelease={onPlatterRelease} />
            <View style={styles.legendRow}>
              <EngravedText size={12} color={t.textMuted}>SUPPLY · TRK 1+2</EngravedText>
              <View style={[styles.odo, { borderColor: t.border }]}>
                <EngravedText size={12} color={t.warning}>{'PITCH ' + pitchText}</EngravedText>
              </View>
            </View>
          </View>
          <View style={styles.platterBlock}>
            <Platter size={reelSize} angle={-angle} onDelta={(d, r, s) => onPlatterDelta(-d, -r, s)} onRelease={onPlatterRelease} />
            <View style={styles.legendRow}>
              <EngravedText size={12} color={t.textMuted}>TAKE-UP · TRK 3+4</EngravedText>
              <View style={[styles.odo, { borderColor: t.border }]}>
                <EngravedText size={12} color={t.warning}>{'SPEED ' + speed + ' IPS'}</EngravedText>
              </View>
            </View>
          </View>
        </View>

        <View style={[styles.strip, { backgroundColor: t.surface, borderColor: t.border }]}>
          <EngravedText size={11} color={t.textMuted}>PITCH</EngravedText>
          <EngravedText size={11} color={t.textMuted}>+16%</EngravedText>
          <View style={styles.track} onLayout={(e) => setTrackH(e.nativeEvent.layout.height)} {...fader.panHandlers}>
            <View style={[styles.rail, { backgroundColor: t.border }]} pointerEvents="none" />
            <View style={[styles.detent, { backgroundColor: t.textMuted, top: trackH / 2 }]} pointerEvents="none" />
            <View
              pointerEvents="none"
              style={[styles.cap, { top: thumbTop - 18, backgroundColor: t.textMuted, borderColor: t.text }]}
            >
              <View style={[styles.capLine, { backgroundColor: t.bg }]} />
            </View>
          </View>
          <EngravedText size={11} color={t.textMuted}>-16%</EngravedText>
        </View>
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.keys}>
          <RubberKey
            label="NUDGE −"
            height={keyH}
            onPress={() => Haptics.selectionAsync()}
            onPressIn={() => bend(-6)}
            onPressOut={() => bend(0)}
            style={styles.key}
          />
          <RubberKey label={playing ? 'PAUSE' : 'PLAY'} height={keyH} onPress={togglePlay} style={styles.key} />
          <RubberKey label="REVERSE" height={keyH} active={reversed} onPress={toggleReverse} style={styles.key} />
          <RubberKey
            label="NUDGE +"
            height={keyH}
            onPress={() => Haptics.selectionAsync()}
            onPressIn={() => bend(6)}
            onPressOut={() => bend(0)}
            style={styles.key}
          />
        </View>
        <View style={styles.hold}>
          <EngravedText size={11} color={items.length === 0 ? t.accent : t.textMuted}>{holdText}</EngravedText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  live: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingRight: 12 },
  lamp: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  middle: { flex: 1 },
  platters: { flex: 1, alignItems: 'center', justifyContent: 'space-evenly', paddingRight: 56 },
  platterBlock: { alignItems: 'center' },
  legendRow: { alignItems: 'center', marginTop: 6 },
  odo: {
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  strip: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 56,
    marginVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    paddingVertical: 8,
  },
  track: { flex: 1, width: 56, marginVertical: 6 },
  rail: { position: 'absolute', left: 26, width: 4, top: 0, bottom: 0, borderRadius: 2 },
  detent: { position: 'absolute', left: 12, width: 32, height: 2 },
  cap: {
    position: 'absolute',
    left: 8,
    width: 40,
    height: 36,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  capLine: { width: 28, height: 3, borderRadius: 1 },
  bottom: { paddingHorizontal: 20 },
  keys: { flexDirection: 'row' },
  key: { flex: 1, marginHorizontal: 3 },
  hold: { alignItems: 'center', marginTop: 8 },
});
