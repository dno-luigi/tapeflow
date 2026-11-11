// One track's level, as a thin bar along the bottom of its key.
//
// The mix already respected a track's level — buildItems hands `track.level` to
// the mixer as the take's volume, and the mixer ramps changes — there was simply
// no way to set it, so four tracks played at whatever balance their takes landed
// at. The control belongs on the key it affects rather than in a separate mixer:
// a track and its level are one thing.
//
// The drag owns the value while the finger is down. Committing on every move
// would write the whole session to the device dozens of times a second, so the
// level is handed over once, on release.
import React, { useRef, useState } from 'react';
import { View, PanResponder, StyleSheet } from 'react-native';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export default function TrackLevel({ index, value, color, fill, style, onChange }) {
  const [drag, setDrag] = useState(null);
  const width = useRef(80);
  const next = useRef(value);
  const cb = useRef(onChange);
  cb.current = onChange;

  const at = (x) => {
    // A coordinate the platform did not supply must not move the fader: a level of
    // NaN draws an empty bar and mixes that track out with nothing to explain it.
    if (!Number.isFinite(x)) return;
    const v = clamp01(x / Math.max(1, width.current));
    next.current = v;
    setDrag(v);
  };

  const pan = useRef(
    PanResponder.create({
      // The bar is its own zone: a touch that starts here sets the level, it does
      // not arm the track. The rest of the key still does.
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => at(e.nativeEvent.locationX),
      onPanResponderMove: (e) => at(e.nativeEvent.locationX),
      onPanResponderRelease: () => {
        if (typeof cb.current === 'function') cb.current(next.current);
        setDrag(null);
      },
      onPanResponderTerminate: () => setDrag(null),
    })
  ).current;

  const settled = clamp01(Number(value) || 0);
  const shown = drag === null ? settled : drag;

  return (
    <View
      {...pan.panHandlers}
      onLayout={(e) => { width.current = e.nativeEvent.layout.width || 80; }}
      style={[st.hit, style]}
      accessibilityRole="adjustable"
      accessibilityLabel={`Track ${index + 1} level ${Math.round(settled * 100)} percent, drag to set`}
      accessibilityValue={{ text: Math.round(shown * 100) + '%' }}
    >
      <View pointerEvents="none" style={[st.track, { borderColor: color }]}>
        <View style={[st.fill, { width: Math.round(shown * 100) + '%', backgroundColor: fill }]} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  hit: { height: 14, justifyContent: 'center' },
  track: { height: 6, borderRadius: 3, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 2 },
});
