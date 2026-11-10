// The reel, drawn rather than photographed.
//
// The deck used to put a photo of a metal tape spool in the middle of the
// machine. A photograph of a reel is a picture of some other device's plastic and
// it cannot follow a new palette, so it looked pasted on. This is the reel as part
// of the instrument: a machined graphite disc with a glass face, concentric
// grooves, a small polished hub, and one orange index mark so the turn is legible.
//
// Everything is drawn in SVG on a 0-100 grid and scaled to `size`, so it is sharp
// at any size and the parent can rotate it with an Animated transform.
import React from 'react';
import Svg, { Defs, RadialGradient, LinearGradient as SvgLinearGradient, Stop, Circle, Line, Ellipse } from 'react-native-svg';

const TICKS = Array.from({ length: 6 }, (_, i) => i * 60);

export default function GlassReel({ size = 260, accent = '#FF4A1C' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        {/* The disc: light where the room hits it, graphite everywhere else. */}
        <RadialGradient id="reelFace" cx="34%" cy="24%" r="82%">
          <Stop offset="0%" stopColor="#F4F6F8" stopOpacity="0.26" />
          <Stop offset="30%" stopColor="#AEB6C0" stopOpacity="0.12" />
          <Stop offset="62%" stopColor="#23272E" stopOpacity="0.72" />
          <Stop offset="100%" stopColor="#0A0B0E" stopOpacity="0.96" />
        </RadialGradient>
        {/* The hub sits proud of the face, so it catches more light. */}
        <RadialGradient id="reelHub" cx="38%" cy="30%" r="72%">
          <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.55" />
          <Stop offset="55%" stopColor="#B9C1CB" stopOpacity="0.18" />
          <Stop offset="100%" stopColor="#0B0C10" stopOpacity="0.92" />
        </RadialGradient>
        <SvgLinearGradient id="reelRim" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.32" />
          <Stop offset="48%" stopColor="#FFFFFF" stopOpacity="0.04" />
          <Stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.16" />
        </SvgLinearGradient>
        <SvgLinearGradient id="reelGloss" x1="0" y1="0" x2="0.8" y2="1">
          <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.22" />
          <Stop offset="60%" stopColor="#FFFFFF" stopOpacity="0.03" />
          <Stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </SvgLinearGradient>
      </Defs>

      <Circle cx="50" cy="50" r="48" fill="url(#reelFace)" />
      <Circle cx="50" cy="50" r="47.5" fill="none" stroke="url(#reelRim)" strokeWidth="1" />

      {/* Machined grooves, thinner as they move out: the thing you see on a disc
          that has been turned, and the only texture on the face. */}
      <Circle cx="50" cy="50" r="41" fill="none" stroke="#FFFFFF" strokeOpacity="0.055" strokeWidth="0.5" />
      <Circle cx="50" cy="50" r="34" fill="none" stroke="#FFFFFF" strokeOpacity="0.05" strokeWidth="0.5" />
      <Circle cx="50" cy="50" r="27" fill="none" stroke="#FFFFFF" strokeOpacity="0.06" strokeWidth="0.55" />
      <Circle cx="50" cy="50" r="20" fill="none" stroke="#FFFFFF" strokeOpacity="0.075" strokeWidth="0.6" />

      {/* Six engraved marks near the rim — they make the rotation readable. */}
      {TICKS.map((deg) => {
        const a = (deg * Math.PI) / 180;
        const r1 = 43.2;
        const r2 = 46.4;
        return (
          <Line
            key={deg}
            x1={50 + r1 * Math.sin(a)}
            y1={50 - r1 * Math.cos(a)}
            x2={50 + r2 * Math.sin(a)}
            y2={50 - r2 * Math.cos(a)}
            stroke="#FFFFFF"
            strokeOpacity="0.14"
            strokeWidth="0.6"
          />
        );
      })}

      {/* The glass face: a soft highlight across the upper left, no hard edge. */}
      <Ellipse cx="36" cy="30" rx="26" ry="15" fill="url(#reelGloss)" transform="rotate(-28 36 30)" />

      <Circle cx="50" cy="50" r="10" fill="url(#reelHub)" />
      <Circle cx="50" cy="50" r="10" fill="none" stroke="#FFFFFF" strokeOpacity="0.20" strokeWidth="0.5" />
      <Circle cx="50" cy="50" r="3.1" fill="#0A0B0E" stroke="#FFFFFF" strokeOpacity="0.16" strokeWidth="0.5" />

      {/* One orange index mark, the same accent as the record lamp. */}
      <Circle cx="50" cy="5.6" r="1.4" fill={accent} fillOpacity="0.95" />
    </Svg>
  );
}
