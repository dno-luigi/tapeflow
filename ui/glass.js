// The deck's surface language: a machined graphite slab, not a light show.
//
// The reference object is a field recorder cut from one piece of dark metal with
// a glass window in it. So the ground is neutral and almost black, with nothing
// coloured anywhere in it: a very slightly lifted top, a vignette that keeps the
// eye on the centre, and a plain line where surfaces meet. The only saturated
// light in the app is the record lamp and the amber keys.
//
//   ObsidianBackdrop — the ground. Neutral gradient + vignette + a faint sheen.
//   GlassPanel       — a frosted surface: blur of what is behind it, a barely
//                      there white fill, a hairline edge, a top-edge specular.
//   GlassSpecular    — the sweep used on the reel so the disc reads as glass.
//
// expo-blur and expo-linear-gradient are already in the app and both render on
// web, so there is no second visual language to keep in sync.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, Stop, Circle, Rect } from 'react-native-svg';

export const obsidian = '#08090B';
export const glassFill = 'rgba(255,255,255,0.048)';
export const glassFillStrong = 'rgba(255,255,255,0.085)';
export const glassStroke = 'rgba(255,255,255,0.10)';
export const glassHighlight = 'rgba(255,255,255,0.18)';

const SHEEN = ['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.022)', 'rgba(255,255,255,0)'];

export function ObsidianBackdrop({ style }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: obsidian }, style]}>
      <LinearGradient
        colors={['#0C0D10', '#08090B', '#050608']}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* A vignette and a lift of light across the top. Nothing coloured: the
          ground stays a dark metal that the glass panels sit on. */}
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="vignette" cx="50%" cy="42%" r="78%">
            <Stop offset="52%" stopColor="#000000" stopOpacity="0" />
            <Stop offset="100%" stopColor="#000000" stopOpacity="0.6" />
          </RadialGradient>
          <RadialGradient id="topLight" cx="50%" cy="0%" r="68%">
            <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.055" />
            <Stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#vignette)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#topLight)" />
      </Svg>
    </View>
  );
}

/**
 * A frosted panel. `radius` rounds it, `style` is the caller's sizing and colour
 * overrides, and children sit above the blur and the sheen.
 */
export function GlassPanel({ children, style, radius = 18, intensity = 24 }) {
  return (
    <View
      style={[
        {
          borderRadius: radius,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: glassStroke,
          backgroundColor: glassFill,
        },
        styles.shadow,
        style,
      ]}
    >
      <BlurView intensity={intensity} tint="dark" style={StyleSheet.absoluteFill} />
      <LinearGradient
        pointerEvents="none"
        colors={SHEEN}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.6, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}

// The thin specular line that sits across the top of a piece of glass. Dropped
// into the reel so the disc reads as a lens rather than a hole.
export function GlassSpecular({ style }) {
  return (
    <LinearGradient
      pointerEvents="none"
      colors={['rgba(255,255,255,0.18)', 'rgba(255,255,255,0.025)', 'rgba(255,255,255,0)']}
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.75, y: 1 }}
      style={style}
    />
  );
}

const styles = StyleSheet.create({
  shadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 22,
    elevation: 6,
  },
});

export default { ObsidianBackdrop, GlassPanel, GlassSpecular, glassStroke, glassFill, glassFillStrong, glassHighlight, obsidian };
