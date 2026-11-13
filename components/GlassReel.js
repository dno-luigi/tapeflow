// The reel, drawn rather than photographed.
//
// A field recorder's disc is a piece of engineering you can read at a glance: a
// matte face, three cut-away spoke windows, a polished hub, and one index mark so
// the turn is legible. It used to be a glossy gradient, which looked like glass
// jewellery and told you nothing about which way the tape was moving. This is
// line art on a matte ground, which is both closer to the machine and cheaper to
// draw every frame.
//
// Everything is drawn in SVG on a 0-100 grid and scaled to `size`, so it is sharp
// at any size and the parent can rotate it with an Animated transform.
import React from 'react';
import Svg, { Defs, RadialGradient, Stop, Circle, Line, Polygon } from 'react-native-svg';

const TICKS = Array.from({ length: 6 }, (_, i) => i * 60);

// The three cut-outs, as one wedge rotated three times. A wedge reads as a
// machined window: wide at the rim, narrow at the hub, like the real spool. The
// narrow end points INWARD, so the three leave a lit ring of face around the hub
// instead of meeting in the middle and reading as one black blob.
const WEDGE = '50,37.5 58.5,21 41.5,21';

export default function GlassReel({ size = 260, accent = '#FF4A1C' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        {/* Barely there: one lift of room light across the face, so the disc is
            not a flat black hole. The face itself is matte. */}
        <RadialGradient id="reelFace" cx="34%" cy="22%" r="86%">
          <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.075" />
          <Stop offset="46%" stopColor="#FFFFFF" stopOpacity="0.015" />
          <Stop offset="100%" stopColor="#000000" stopOpacity="0.28" />
        </RadialGradient>
        <RadialGradient id="reelHub" cx="38%" cy="28%" r="76%">
          <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.42" />
          <Stop offset="58%" stopColor="#9AA3AD" stopOpacity="0.14" />
          <Stop offset="100%" stopColor="#08090B" stopOpacity="0.9" />
        </RadialGradient>
      </Defs>

      {/* The face and its two machined rings. */}
      <Circle cx="50" cy="50" r="48.4" fill="#1A1D21" />
      <Circle cx="50" cy="50" r="48.4" fill="url(#reelFace)" />
      <Circle cx="50" cy="50" r="48" fill="none" stroke="#FFFFFF" strokeOpacity="0.16" strokeWidth="0.7" />
      <Circle cx="50" cy="50" r="43.5" fill="none" stroke="#FFFFFF" strokeOpacity="0.06" strokeWidth="0.5" />

      {/* Three spoke windows, cut clean out of the face. */}
      {[0, 120, 240].map((deg) => (
        <Polygon
          key={deg}
          points={WEDGE}
          fill="#07080A"
          stroke="#FFFFFF"
          strokeOpacity="0.20"
          strokeWidth="0.5"
          transform={'rotate(' + deg + ' 50 50)'}
        />
      ))}

      {/* Six engraved marks near the rim — they make the rotation readable. */}
      {TICKS.map((deg) => {
        const a = (deg * Math.PI) / 180;
        const r1 = 44.4;
        const r2 = 47.2;
        return (
          <Line
            key={deg}
            x1={50 + r1 * Math.sin(a)}
            y1={50 - r1 * Math.cos(a)}
            x2={50 + r2 * Math.sin(a)}
            y2={50 - r2 * Math.cos(a)}
            stroke="#FFFFFF"
            strokeOpacity="0.16"
            strokeWidth="0.6"
          />
        );
      })}

      {/* The hub: a boss with its own shoulder and a spindle hole. */}
      <Circle cx="50" cy="50" r="10.5" fill="url(#reelHub)" />
      <Circle cx="50" cy="50" r="10.5" fill="none" stroke="#FFFFFF" strokeOpacity="0.22" strokeWidth="0.55" />
      <Circle cx="50" cy="50" r="5" fill="#0C0E11" stroke="#FFFFFF" strokeOpacity="0.16" strokeWidth="0.5" />
      <Circle cx="50" cy="50" r="1.7" fill="#040506" />

      {/* One index mark at the rim, the same accent as the record lamp. */}
      <Circle cx="50" cy="6.2" r="1.5" fill={accent} fillOpacity="0.95" />
    </Svg>
  );
}
