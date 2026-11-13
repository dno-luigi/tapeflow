// The deck's hardware: knobs, keycaps, lamps.
//
// The deck is a field recorder, so its controls are objects rather than icons —
// a knurled knob with its name printed above it, a key that sits proud of the
// face and says what it does underneath, and a column of LEDs that shows level
// the way a machine does. Everything here is drawn, so it follows the palette,
// and every one of them is a Pressable first: an object you can look at but not
// press is a picture of a control.
//
//   Knob      — a turned metal knob with a pointer, label above.
//   KeyCap    — a raised transport key, caption below. `tone="record"` is the red one.
//   LedLadder — a vertical level ladder, lit from the bottom.
//   SquareLed — one status lamp beside a printed word.
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Defs, Line, RadialGradient, Stop } from 'react-native-svg';
import EngravedText from './EngravedText';
import { useTheme } from '../ui/theme';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const HAIRLINE = 'rgba(255,255,255,0.10)';

export function Knob({ label, icon, onPress, accessibilityLabel, size = 38 }) {
  const t = useTheme();
  return (
    <View style={st.unit}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || label}
        hitSlop={8}
        style={({ pressed }) => [{ width: size, height: size, opacity: pressed ? 0.75 : 1 }]}
      >
        <Svg width={size} height={size} viewBox="0 0 44 44">
          <Defs>
            <RadialGradient id="knobFace" cx="34%" cy="24%" r="80%">
              <Stop offset="0%" stopColor="#40444A" />
              <Stop offset="48%" stopColor="#22252A" />
              <Stop offset="100%" stopColor="#0B0C0E" />
            </RadialGradient>
          </Defs>
          <Circle cx="22" cy="22" r="21" fill="url(#knobFace)" stroke={HAIRLINE} strokeWidth="1" />
          {/* The turned shoulder: one hairline inside the rim, as on a machined knob. */}
          <Circle cx="22" cy="22" r="15.5" fill="none" stroke="rgba(255,255,255,0.055)" strokeWidth="1" />
          {/* The pointer, printed on the top face rather than standing off it. */}
          <Line
            x1="22"
            y1="13.5"
            x2="22"
            y2="7.5"
            stroke={t.text}
            strokeOpacity="0.6"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <Circle cx="22" cy="22" r="2.6" fill="#090A0B" stroke="rgba(255,255,255,0.14)" strokeWidth="0.8" />
        </Svg>
        {icon ? (
          <View pointerEvents="none" style={st.knobIcon}>
            <Ionicons name={icon} size={13} color="rgba(255,255,255,0.55)" />
          </View>
        ) : null}
      </Pressable>
      <EngravedText size={8} color={t.textMuted} style={{ marginTop: 4 }}>
        {label}
      </EngravedText>
    </View>
  );
}

/**
 * A transport key. The caption sits UNDER the key, the way it is printed on the
 * case of the machine, so the row reads as hardware and not as a toolbar.
 */
export function KeyCap({ icon, label, onPress, accessibilityLabel, active, tone = 'default', height = 50 }) {
  const t = useTheme();
  const record = tone === 'record';
  const face = record
    ? [active ? '#5E1B14' : '#33120F', active ? '#8E2A1E' : '#240D0B']
    : [active ? '#2A2D33' : '#202329', '#101114'];
  return (
    <View style={st.keyUnit}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || label}
        style={({ pressed }) => [
          {
            height,
            alignSelf: 'stretch',
            borderRadius: 6,
            borderWidth: 1,
            borderColor: record ? 'rgba(255,80,50,0.45)' : HAIRLINE,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.85 : 1,
            transform: [{ translateY: pressed ? 1 : 0 }],
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 3 },
            shadowOpacity: 0.55,
            shadowRadius: 5,
            backgroundColor: record ? '#3A1512' : '#1B1D21',
          },
        ]}
      >
        {/* Two bands: the key's face, then the light catching its top edge. */}
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: face[0] }]} />
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { top: '55%', backgroundColor: face[1] }]} />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 1,
            backgroundColor: active ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.10)',
          }}
        />
        {record ? (
          <View
            style={{
              width: 11,
              height: 11,
              borderRadius: 6,
              backgroundColor: active ? '#FF3B1F' : t.danger,
              shadowColor: t.danger,
              shadowOpacity: active ? 1 : 0.6,
              shadowRadius: active ? 9 : 5,
              shadowOffset: { width: 0, height: 0 },
            }}
          />
        ) : (
          <Ionicons name={icon} size={20} color={active ? t.text : 'rgba(255,255,255,0.72)'} />
        )}
      </Pressable>
      <EngravedText size={8} color={active ? t.text : t.textMuted} style={{ marginTop: 4 }}>
        {label}
      </EngravedText>
    </View>
  );
}

/** A vertical ladder of lamps, lit from the bottom, the last fifth running hot. */
export function LedLadder({ level = 0, rows = 10 }) {
  const t = useTheme();
  const lit = Math.round(clamp01(Number.isFinite(level) ? level : 0) * rows);
  const hotFrom = rows * 0.8;
  const cells = [];
  for (let i = 0; i < rows; i += 1) {
    const fromBottom = rows - i;
    const on = fromBottom <= lit;
    const hot = fromBottom > hotFrom;
    cells.push(
      <View
        key={i}
        style={{
          width: 8,
          height: 3,
          borderRadius: 1,
          backgroundColor: on ? (hot ? t.danger : t.text) : 'rgba(255,255,255,0.10)',
          opacity: on ? (hot ? 1 : 0.85) : 1,
        }}
      />
    );
  }
  return <View style={{ alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>{cells}</View>;
}

/** One printed word with its lamp, the way a function is marked on a case. */
export function SquareLed({ on, color, size = 6, label }) {
  const t = useTheme();
  const lamp = color || t.warning;
  return (
    <View style={st.statusItem}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: 1,
          backgroundColor: on ? lamp : 'transparent',
          borderWidth: 1,
          borderColor: on ? lamp : 'rgba(255,255,255,0.22)',
          shadowColor: lamp,
          shadowOpacity: on ? 0.9 : 0,
          shadowRadius: 5,
          shadowOffset: { width: 0, height: 0 },
        }}
      />
      {label ? (
        <EngravedText size={9} color={on ? t.text : t.textMuted} style={{ marginLeft: 4 }}>
          {label}
        </EngravedText>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  unit: { alignItems: 'center', justifyContent: 'center' },
  knobIcon: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  keyUnit: { flex: 1, alignItems: 'center' },
  statusItem: { flexDirection: 'row', alignItems: 'center' },
});

export default { Knob, KeyCap, LedLadder, SquareLed };
