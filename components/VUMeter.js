import React, { useEffect, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../ui/theme';
import { glassStroke } from '../ui/glass';

const SWEEP = 90;

// A meter behind glass, not a coloured slab.
//
// The face used to be filled with the accent colour, which was fine when the
// accent was a deep red and wrong the moment the palette changed: the whole panel
// became a flat block of orange. Now the face is smoked glass like everything
// else, the scale is engraved in grey, only the last two tenths run hot, and the
// needle is the one bright thing on it.
export default function VUMeter({ width = 160, height = 90, level = 0, label }) {
  const t = useTheme();
  const target = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
  const anim = useRef(new Animated.Value(target)).current;
  const [shown, setShown] = useState(target);

  useEffect(() => {
    const id = anim.addListener(({ value }) => setShown(value));
    return () => anim.removeListener(id);
  }, [anim]);

  useEffect(() => {
    Animated.spring(anim, {
      toValue: target,
      stiffness: 220,
      damping: 7,
      mass: 0.9,
      useNativeDriver: false,
    }).start();
  }, [target, anim]);

  const w = 200;
  const h = 120;
  const px = w / 2;
  const py = h + 18;
  const radius = 128;
  const clamped = Math.max(-0.06, Math.min(1.08, shown));
  const deg = -SWEEP / 2 + clamped * SWEEP;
  const rad = ((deg - 90) * Math.PI) / 180;
  const nx = px + radius * 0.96 * Math.cos(rad);
  const ny = py + radius * 0.96 * Math.sin(rad);

  const pointAt = (v, r) => {
    const d = -SWEEP / 2 + v * SWEEP;
    const rr = ((d - 90) * Math.PI) / 180;
    return [px + r * Math.cos(rr), py + r * Math.sin(rr)];
  };

  const ticks = [];
  for (let i = 0; i <= 10; i += 1) {
    const v = i / 10;
    const long = i % 2 === 0;
    const [x1, y1] = pointAt(v, radius - (long ? 12 : 7));
    const [x2, y2] = pointAt(v, radius);
    ticks.push(
      <Line
        key={i}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={v > 0.72 ? t.accent : t.textMuted}
        strokeOpacity={v > 0.72 ? 0.9 : 0.5}
        strokeWidth={long ? 1.6 : 1}
      />
    );
  }

  const hotStart = pointAt(0.72, radius - 4);
  const hotEnd = pointAt(1, radius - 4);
  const hotArc =
    'M' + hotStart[0] + ' ' + hotStart[1] +
    ' A' + (radius - 4) + ' ' + (radius - 4) + ' 0 0 1 ' + hotEnd[0] + ' ' + hotEnd[1];

  return (
    <View
      style={{
        width,
        height,
        borderRadius: 8,
        overflow: 'hidden',
        backgroundColor: 'rgba(255,255,255,0.035)',
        borderWidth: 1,
        borderColor: glassStroke,
      }}
    >
      <Svg width={width} height={height} viewBox={'0 0 ' + w + ' ' + h} preserveAspectRatio="xMidYMid slice">
        <Path d={hotArc} stroke={t.accent} strokeOpacity={0.5} strokeWidth={3} fill="none" />
        {ticks}
        <SvgText x={14} y={h - 8} fontSize={11} fill={t.textMuted} fillOpacity={0.75}>VU</SvgText>
        {label ? (
          <SvgText x={w - 14} y={h - 8} fontSize={11} fill={t.textMuted} fillOpacity={0.75} textAnchor="end">
            {String(label).toUpperCase()}
          </SvgText>
        ) : null}
        <Line
          x1={px}
          y1={py}
          x2={nx}
          y2={ny}
          stroke={t.text}
          strokeOpacity={0.85}
          strokeWidth={1.8}
          strokeLinecap="round"
        />
        <Circle cx={nx} cy={ny} r={2} fill={t.accent} fillOpacity={0.9} />
        <Circle cx={px} cy={py} r={8} fill={t.surfaceAlt} stroke={glassStroke} strokeWidth={1} />
      </Svg>
    </View>
  );
}
