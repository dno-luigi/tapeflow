import React, { useEffect, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../ui/theme';

const SWEEP = 90;

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
      <Line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={v > 0.72 ? t.danger : t.accents[0]} strokeWidth={long ? 1.8 : 1} />
    );
  }

  const redStart = pointAt(0.72, radius - 4);
  const redEnd = pointAt(1, radius - 4);
  const redArc =
    'M' + redStart[0] + ' ' + redStart[1] +
    ' A' + (radius - 4) + ' ' + (radius - 4) + ' 0 0 1 ' + redEnd[0] + ' ' + redEnd[1];

  const glow = Math.round(shown * 0.35 * 255).toString(16).padStart(2, '0');

  return (
    <View style={{ width, height, borderRadius: 8, overflow: 'hidden', backgroundColor: t.surface, borderWidth: 1, borderColor: t.border }}>
      <Svg width={width} height={height} viewBox={'0 0 ' + w + ' ' + h} preserveAspectRatio="xMidYMid slice">
        <Rect x={0} y={0} width={w} height={h} fill={t.accents[0]} fillOpacity={0.9} />
        <Rect x={0} y={0} width={w} height={h} fill={t.accents[0] + glow} />
        <Path d={redArc} stroke={t.danger} strokeWidth={4} fill="none" strokeOpacity={0.85} />
        {ticks}
        <SvgText x={14} y={h - 8} fontSize={11} fill={t.bg} fillOpacity={0.8}>VU</SvgText>
        {label ? (
          <SvgText x={w - 14} y={h - 8} fontSize={11} fill={t.bg} fillOpacity={0.8} textAnchor="end">
            {String(label).toUpperCase()}
          </SvgText>
        ) : null}
        <Line x1={px} y1={py} x2={nx} y2={ny} stroke={t.bg} strokeWidth={2.2} strokeLinecap="round" />
        <Circle cx={px} cy={py} r={9} fill={t.bg} />
      </Svg>
    </View>
  );
}
