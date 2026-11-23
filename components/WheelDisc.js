// The wheel, drawn rather than photographed.
//
// It is one piece of turned metal, not a spool: a solid brushed face with a
// polished rim bevel, a fine grip band cut into the edge, and a shallow raised
// boss at the centre. There are no spoke windows and no spindle hole, because
// nothing is wound on it — the music is digital, so the wheel is a controller and
// looks like one.
//
// Rotation stays legible without a moving spool: the grip band is fine and regular
// and the one accent index mark at the rim turns under a fixed pointer, so a hand
// can read the speed at a glance.
//
// Everything is drawn in SVG on a 0-100 grid and scaled to `size`, so it stays
// sharp at any size and the parent can rotate it with an Animated transform.
import React from 'react';
import Svg, { Defs, RadialGradient, Stop, Circle, Line } from 'react-native-svg';

const GRIP = 200;
const BRUSH = 140;

export default function WheelDisc({ size = 260, accent = '#FF4A1C' }) {
  // The grip band: short fine teeth right at the edge, so the rim reads as
  // knurled rather than grooved. A turned disc, not a record.
  const grip = [];
  for (let i = 0; i < GRIP; i += 1) {
    const a = ((i * (360 / GRIP)) * Math.PI) / 180;
    const r1 = i % 4 === 0 ? 47.0 : 47.7;
    const r2 = 49.0;
    grip.push(
      <Line
        key={i}
        x1={50 + r1 * Math.sin(a)}
        y1={50 - r1 * Math.cos(a)}
        x2={50 + r2 * Math.sin(a)}
        y2={50 - r2 * Math.cos(a)}
        stroke="#FFFFFF"
        strokeOpacity={i % 4 === 0 ? 0.16 : 0.07}
        strokeWidth={0.4}
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
        x1={50 + 9 * Math.sin(a)}
        y1={50 - 9 * Math.cos(a)}
        x2={50 + 45 * Math.sin(a)}
        y2={50 - 45 * Math.cos(a)}
        stroke="#FFFFFF"
        strokeOpacity={0.02}
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
          <Stop offset="0%" stopColor="#4E555E" />
          <Stop offset="36%" stopColor="#3A4048" />
          <Stop offset="72%" stopColor="#272C32" />
          <Stop offset="100%" stopColor="#171A1E" />
        </RadialGradient>
        {/* The centre boss is raised, so it catches the light at the top left and
            falls away at the bottom right — no hole, nothing to see through. */}
        <RadialGradient id="wheelBoss" cx="34%" cy="26%" r="80%">
          <Stop offset="0%" stopColor="#7A838E" />
          <Stop offset="46%" stopColor="#464D56" />
          <Stop offset="100%" stopColor="#23282E" />
        </RadialGradient>
      </Defs>

      {/* The face, solid, with a dark seated edge. */}
      <Circle cx="50" cy="50" r="49" fill="url(#wheelFace)" />
      <Circle cx="50" cy="50" r="49" fill="none" stroke="#000000" strokeOpacity="0.55" strokeWidth="1.2" />

      {/* The rim: a polished bevel, then the grip cut into it. */}
      <Circle cx="50" cy="50" r="47.9" fill="none" stroke="#FFFFFF" strokeOpacity="0.20" strokeWidth="0.6" />
      <Circle cx="50" cy="50" r="47.1" fill="none" stroke="#000000" strokeOpacity="0.45" strokeWidth="0.7" />
      {grip}

      {/* One turning circle inside the bevel — a lathe line, not a stack of
          grooves: this is the only ring on the face. */}
      <Circle cx="50" cy="50" r="44.2" fill="none" stroke="#000000" strokeOpacity="0.22" strokeWidth="0.6" />
      <Circle cx="50" cy="50" r="43.7" fill="none" stroke="#FFFFFF" strokeOpacity="0.06" strokeWidth="0.5" />
      {brush}

      {/* The boss: one shallow raised centre with its shoulder and a small
          engraved dimple. It is what the thumb finds. */}
      <Circle cx="50" cy="50" r="11" fill="url(#wheelBoss)" />
      <Circle cx="50" cy="50" r="11" fill="none" stroke="#FFFFFF" strokeOpacity="0.16" strokeWidth="0.6" />
      <Circle cx="50" cy="50" r="11.5" fill="none" stroke="#000000" strokeOpacity="0.35" strokeWidth="0.7" />
      <Circle cx="50" cy="50" r="3.4" fill="none" stroke="#000000" strokeOpacity="0.30" strokeWidth="1" />
      <Circle cx="50" cy="50" r="3.9" fill="none" stroke="#FFFFFF" strokeOpacity="0.10" strokeWidth="0.5" />

      {/* The index: one accent tooth at the rim, on the top of the face, passing
          under the pointer. Coordinates are page-space on the 0-100 grid, so the
          rim is at y ≈ 3, not at 47. */}
      <Line x1="50" y1="5.2" x2="50" y2="9" stroke={accent} strokeOpacity="0.95" strokeWidth="1.6" />
    </Svg>
  );
}
