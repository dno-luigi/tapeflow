// The wheel, drawn rather than photographed.
//
// It is a machined piece of metal, not a spool of tape: a solid brushed face with
// concentric turning rings, a knurled edge cut for a thumb, and one raised hub.
// There are no spoke windows, because there is nothing wound on it — the music is
// digital and the wheel is a controller, so it looks like the controller it is.
//
// Rotation is legible without a moving spool: the knurl is fine and regular, and
// the witness mark at the rim is the one accent-coloured thing that turns, so a
// hand can read the speed off it at a glance.
//
// Everything is drawn in SVG on a 0-100 grid and scaled to `size`, so it stays
// sharp at any size and the parent can rotate it with an Animated transform.
import React from 'react';
import Svg, { Defs, RadialGradient, Stop, Circle, Line } from 'react-native-svg';

const KNURL = 160;
const BRUSH = 120;
const GROOVES = [40.6, 34.8, 29.2, 24.2];

export default function WheelDisc({ size = 260, accent = '#FF4A1C' }) {
  const knurl = [];
  for (let i = 0; i < KNURL; i += 1) {
    const a = ((i * (360 / KNURL)) * Math.PI) / 180;
    const major = i % 16 === 0;
    const r1 = major ? 45.1 : 45.9;
    const r2 = 48.5;
    knurl.push(
      <Line
        key={i}
        x1={50 + r1 * Math.sin(a)}
        y1={50 - r1 * Math.cos(a)}
        x2={50 + r2 * Math.sin(a)}
        y2={50 - r2 * Math.cos(a)}
        stroke={i === 0 ? accent : '#FFFFFF'}
        strokeOpacity={i === 0 ? 0.9 : major ? 0.20 : 0.09}
        strokeWidth={major ? 0.7 : 0.4}
      />
    );
  }

  // Brushed metal: fine radial hairlines, barely there, that read as a turned
  // surface rather than a flat fill.
  const brush = [];
  for (let i = 0; i < BRUSH; i += 1) {
    const a = ((i * (360 / BRUSH)) * Math.PI) / 180;
    brush.push(
      <Line
        key={i}
        x1={50 + 13 * Math.sin(a)}
        y1={50 - 13 * Math.cos(a)}
        x2={50 + 45.5 * Math.sin(a)}
        y2={50 - 45.5 * Math.cos(a)}
        stroke="#FFFFFF"
        strokeOpacity={0.018}
        strokeWidth={0.5}
      />
    );
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        {/* One lift of light from the top left, then a fall to a dark edge: the
            wheel is lit, not painted. */}
        <RadialGradient id="wheelFace" cx="33%" cy="24%" r="82%">
          <Stop offset="0%" stopColor="#41474F" />
          <Stop offset="34%" stopColor="#30363D" />
          <Stop offset="70%" stopColor="#1E2227" />
          <Stop offset="100%" stopColor="#0F1114" />
        </RadialGradient>
        <RadialGradient id="wheelHub" cx="38%" cy="28%" r="78%">
          <Stop offset="0%" stopColor="#6A737E" />
          <Stop offset="52%" stopColor="#2E353C" />
          <Stop offset="100%" stopColor="#0C0F12" />
        </RadialGradient>
      </Defs>

      {/* The face itself. Solid, with a dark seated edge. */}
      <Circle cx="50" cy="50" r="49" fill="url(#wheelFace)" />
      <Circle cx="50" cy="50" r="49" fill="none" stroke="#000000" strokeOpacity="0.55" strokeWidth="1.2" />

      {/* The rim: a polished bevel, then the knurling cut into it. */}
      <Circle cx="50" cy="50" r="47.4" fill="none" stroke="#FFFFFF" strokeOpacity="0.16" strokeWidth="0.6" />
      <Circle cx="50" cy="50" r="45.6" fill="none" stroke="#000000" strokeOpacity="0.4" strokeWidth="0.8" />
      {knurl}

      {/* The turned face: concentric rings with a shadow on one side and a
          highlight on the other, the way a lathe leaves them. */}
      {GROOVES.map((r) => (
        <React.Fragment key={r}>
          <Circle cx="50" cy="50" r={r} fill="none" stroke="#000000" strokeOpacity="0.30" strokeWidth="0.7" />
          <Circle cx="50" cy="50" r={r - 0.6} fill="none" stroke="#FFFFFF" strokeOpacity="0.055" strokeWidth="0.5" />
        </React.Fragment>
      ))}
      {brush}

      {/* The hub: a raised boss on the same centre, with its own bevel and a
          spindle hole. It is what the hand holds. */}
      <Circle cx="50" cy="50" r="12.4" fill="url(#wheelHub)" />
      <Circle cx="50" cy="50" r="12.4" fill="none" stroke="#FFFFFF" strokeOpacity="0.18" strokeWidth="0.6" />
      <Circle cx="50" cy="50" r="12.9" fill="none" stroke="#000000" strokeOpacity="0.45" strokeWidth="0.8" />
      <Circle cx="50" cy="50" r="8.4" fill="none" stroke="#000000" strokeOpacity="0.35" strokeWidth="0.7" />
      <Circle cx="50" cy="50" r="3.1" fill="#0B0D10" stroke="#FFFFFF" strokeOpacity="0.14" strokeWidth="0.5" />
      <Circle cx="50" cy="50" r="1.1" fill="#050607" />

      {/* One index line at the rim, in the record lamp's colour: the accent
          knurl tooth above passes under the pointer, so a turn is readable even
          though the face itself is uniform. */}
      <Line x1="50" y1="5.6" x2="50" y2="9.4" stroke={accent} strokeOpacity="0.95" strokeWidth="1.5" />
    </Svg>
  );
}
