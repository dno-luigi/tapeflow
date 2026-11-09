import React, { useRef, useState } from 'react';
import { View, Pressable, Text, PanResponder, StyleSheet } from 'react-native';
import { useTheme } from '../../ui/theme';
import { AppImage } from '../../ui/kit';
import { ART } from '../../constants/artwork';
import EngravedText from '../EngravedText';

const FADER_H = 110;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function takeLegend(track) {
  const takes = (track && track.takes) || [];
  if (!takes.length) return '';
  const active = takes.find((k) => k.id === track.activeTakeId) || takes[takes.length - 1];
  return `TAKE ${active && active.n ? active.n : takes.length}`;
}

export default function ChannelStrip({ index, track, recording, onArm, onTape, onLevel, onPan, onLabelLong }) {
  const t = useTheme();
  const level = typeof track.level === 'number' ? track.level : 0.7;
  const pan = typeof track.pan === 'number' ? track.pan : 0;
  const [dragLevel, setDragLevel] = useState(null);
  const [dragPan, setDragPan] = useState(null);
  const startLevel = useRef(level);
  const lastTap = useRef(0);
  const cb = useRef({});
  cb.current = { onLevel, onPan };

  const fader = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { startLevel.current = levelRef.current; },
    onPanResponderMove: (e, g) => {
      const v = clamp(startLevel.current - g.dy / FADER_H, 0, 1);
      levelRef.current = v;
      setDragLevel(v);
    },
    onPanResponderRelease: () => { cb.current.onLevel && cb.current.onLevel(levelRef.current); setDragLevel(null); },
  })).current;
  const levelRef = useRef(level);
  if (dragLevel === null) levelRef.current = level;

  const knob = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      const now = Date.now();
      if (now - lastTap.current < 300) { panRef.current = 0; setDragPan(0); cb.current.onPan && cb.current.onPan(0); }
      lastTap.current = now;
    },
    onPanResponderMove: (e) => {
      const { locationX, locationY } = e.nativeEvent;
      const a = (Math.atan2(locationX - 22, -(locationY - 22)) * 180) / Math.PI;
      const v = clamp(a / 135, -1, 1);
      panRef.current = v;
      setDragPan(v);
    },
    onPanResponderRelease: () => { cb.current.onPan && cb.current.onPan(panRef.current); setDragPan(null); },
  })).current;
  const panRef = useRef(pan);
  if (dragPan === null) panRef.current = pan;

  const shownLevel = dragLevel === null ? level : dragLevel;
  const shownPan = dragPan === null ? pan : dragPan;
  const legend = takeLegend(track);
  const armed = !!track.armed;

  return (
    <View style={[st.wrap, { borderColor: t.border }]}>
      <Pressable onLongPress={onLabelLong} delayLongPress={350} style={st.label} accessibilityLabel={`Track ${index + 1}, hold for takes`}>
        <EngravedText size={11} color={t.text}>{`TRK ${index + 1}`}</EngravedText>
        <EngravedText size={11} color={t.warning}>{legend || ' '}</EngravedText>
      </Pressable>

      <Pressable
        onPress={onArm}
        accessibilityLabel={`Arm track ${index + 1}`}
        style={[st.arm, { backgroundColor: armed ? t.accent : t.accentSoft, borderColor: armed ? t.accent : t.border, shadowColor: t.accent, shadowOpacity: armed ? (recording ? 1 : 0.8) : 0, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } }]}
      >
        <Text style={[t.font.label, { color: armed ? t.onAccent : t.textMuted, fontSize: 11, lineHeight: 14 }]}>ARM</Text>
      </Pressable>

      <Pressable onPress={onTape} accessibilityLabel={`Tape sound track ${index + 1}`} style={st.tapeHit}>
        <EngravedText size={11} color={t.textMuted}>TAPE</EngravedText>
        <View style={[st.track, { backgroundColor: track.tapeSound ? t.warning : t.border }]}>
          <View style={[st.thumb, { backgroundColor: t.text, alignSelf: track.tapeSound ? 'flex-end' : 'flex-start' }]} />
        </View>
      </Pressable>

      <View style={st.faderBox} {...fader.panHandlers}>
        <View style={[st.slot, { backgroundColor: '#000', borderColor: t.border }]} />
        <View pointerEvents="none" style={[st.cap, { top: (1 - shownLevel) * (FADER_H - 28) }]}>
          <AppImage source={ART.faderCap} contentFit="contain" style={{ width: 36, height: 28 }} />
        </View>
      </View>

      <View style={st.knobBox} {...knob.panHandlers}>
        <View pointerEvents="none" style={{ transform: [{ rotate: `${shownPan * 135}deg` }] }}>
          <AppImage source={ART.panKnob} contentFit="contain" style={{ width: 44, height: 44 }} />
        </View>
      </View>
      <EngravedText size={11} color={t.textMuted}>PAN</EngravedText>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', paddingVertical: 4, borderRightWidth: StyleSheet.hairlineWidth },
  label: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  arm: { width: 56, height: 32, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  tapeHit: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  track: { width: 28, height: 14, borderRadius: 7, padding: 2, marginTop: 2 },
  thumb: { width: 10, height: 10, borderRadius: 5 },
  faderBox: { width: 56, height: FADER_H, alignItems: 'center', marginVertical: 4 },
  slot: { position: 'absolute', top: 0, bottom: 0, width: 6, borderRadius: 3, borderWidth: StyleSheet.hairlineWidth },
  cap: { position: 'absolute', width: 36, height: 28 },
  knobBox: { width: 44, height: 44 },
});
