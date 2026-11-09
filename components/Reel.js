import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Line, Path } from 'react-native-svg';
import { useTheme } from '../ui/theme';

export default function Reel({ size = 140, angle = 0, fill = 0.5, color }) {
  const t = useTheme();
  const steel = color || t.accents[1];
  const amount = Math.max(0, Math.min(1, Number.isFinite(fill) ? fill : 0));
  const a = Number.isFinite(angle) ? angle : 0;
  const c = 50;
  const hub = 14;
  const flange = 46;
  const tapeR = hub + 4 + amount * (flange - hub - 8);
  const spokes = [0, 120, 240];

  const windowPath = (start) => {
    const r1 = hub + 5;
    const r2 = flange - 9;
    const half = 36;
    const p = (r, deg) => {
      const rad = ((start + deg) * Math.PI) / 180;
      return [c + r * Math.cos(rad), c + r * Math.sin(rad)];
    };
    const [x1, y1] = p(r1, -half);
    const [x2, y2] = p(r2, -half);
    const [x3, y3] = p(r2, half);
    const [x4, y4] = p(r1, half);
    return (
      'M' + x1 + ' ' + y1 +
      ' L' + x2 + ' ' + y2 +
      ' A' + r2 + ' ' + r2 + ' 0 0 1 ' + x3 + ' ' + y3 +
      ' L' + x4 + ' ' + y4 +
      ' A' + r1 + ' ' + r1 + ' 0 0 0 ' + x1 + ' ' + y1 + ' Z'
    );
  };

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Circle cx={c} cy={c} r={flange + 2} fill={t.bg} />
        <Circle cx={c} cy={c} r={tapeR} fill={t.accents[3]} />
        <Circle cx={c} cy={c} r={tapeR} fill="none" stroke={t.border} strokeWidth={1} />
        <G rotation={a} origin="50, 50">
          <Circle cx={c} cy={c} r={flange} fill="none" stroke={steel} strokeWidth={3} />
          {spokes.map((s) => (
            <Path key={s} d={windowPath(s + 60)} fill={t.bg} fillOpacity={0.55} stroke={steel} strokeWidth={1.2} />
          ))}
          {spokes.map((s) => (
            <Line
              key={'l' + s}
              x1={c}
              y1={c}
              x2={c + (flange - 3) * Math.cos((s * Math.PI) / 180)}
              y2={c + (flange - 3) * Math.sin((s * Math.PI) / 180)}
              stroke={steel}
              strokeWidth={2.4}
            />
          ))}
          <Circle cx={c} cy={c} r={hub} fill={t.surface} stroke={steel} strokeWidth={2} />
          {spokes.map((s) => (
            <Circle
              key={'n' + s}
              cx={c + (hub - 4.5) * Math.cos(((s + 30) * Math.PI) / 180)}
              cy={c + (hub - 4.5) * Math.sin(((s + 30) * Math.PI) / 180)}
              r={2}
              fill={steel}
            />
          ))}
          <Circle cx={c} cy={c} r={2.2} fill={t.bg} />
        </G>
      </Svg>
    </View>
  );
}
