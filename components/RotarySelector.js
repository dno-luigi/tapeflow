import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Svg, { Circle, Line } from 'react-native-svg';
import { useTheme } from '../ui/theme';
import EngravedText from './EngravedText';

export default function RotarySelector({ options = [], value, onChange, size = 120 }) {
  const t = useTheme();
  const list = Array.isArray(options) ? options : [];
  const index = Math.max(0, list.indexOf(value));
  const count = Math.max(1, list.length);
  const span = 240;
  const angleFor = (i) => (count === 1 ? 0 : -span / 2 + (i * span) / (count - 1));

  const anim = useRef(new Animated.Value(angleFor(index))).current;
  const [shown, setShown] = useState(angleFor(index));

  useEffect(() => {
    const id = anim.addListener(({ value: v }) => setShown(v));
    return () => anim.removeListener(id);
  }, [anim]);

  useEffect(() => {
    Animated.spring(anim, {
      toValue: angleFor(index),
      stiffness: 200,
      damping: 11,
      mass: 1,
      useNativeDriver: false,
    }).start();
  }, [index, count, anim]);

  const choose = (i) => {
    if (i < 0 || i >= list.length || list[i] === value) return;
    Haptics.selectionAsync().catch(() => {});
    if (onChange) onChange(list[i]);
  };

  const knob = size * 0.5;
  const c = size / 2;
  const ringR = size * 0.4;
  const rad = ((shown - 90) * Math.PI) / 180;

  return (
    <View style={{ alignItems: 'center' }}>
      <Pressable
        onPress={() => choose((index + 1) % count)}
        accessibilityRole="adjustable"
        accessibilityLabel={'Selector, ' + String(value)}
        style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      >
        <Svg width={size} height={size} viewBox={'0 0 ' + size + ' ' + size}>
          <Circle cx={c} cy={c} r={ringR + 6} fill="none" stroke={t.border} strokeWidth={1} />
          {list.map((opt, i) => {
            const r = ((angleFor(i) - 90) * Math.PI) / 180;
            const on = i === index;
            return (
              <Line
                key={String(opt)}
                x1={c + (ringR + 1) * Math.cos(r)}
                y1={c + (ringR + 1) * Math.sin(r)}
                x2={c + (ringR + 7) * Math.cos(r)}
                y2={c + (ringR + 7) * Math.sin(r)}
                stroke={on ? t.accents[0] : t.textMuted}
                strokeWidth={on ? 2.5 : 1.5}
              />
            );
          })}
          <Circle cx={c} cy={c} r={knob / 2 + 4} fill={t.accents[3]} stroke={t.border} strokeWidth={2} />
          <Circle cx={c} cy={c} r={knob / 2 - 2} fill={t.surface} stroke={t.accents[1]} strokeWidth={1.5} />
          <Line
            x1={c + (knob / 2 - 14) * Math.cos(rad)}
            y1={c + (knob / 2 - 14) * Math.sin(rad)}
            x2={c + (knob / 2 - 3) * Math.cos(rad)}
            y2={c + (knob / 2 - 3) * Math.sin(rad)}
            stroke={t.accents[0]}
            strokeWidth={3}
            strokeLinecap="round"
          />
        </Svg>
      </Pressable>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 4 }}>
        {list.map((opt, i) => (
          <Pressable
            key={String(opt)}
            onPress={() => choose(i)}
            accessibilityRole="button"
            accessibilityLabel={String(opt)}
            style={({ pressed }) => ({
              minHeight: 44,
              minWidth: 44,
              paddingHorizontal: 8,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <EngravedText size={11} color={i === index ? t.accents[0] : t.textMuted}>
              {String(opt)}
            </EngravedText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
