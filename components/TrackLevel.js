// One track's own volume, as a small fader on its key.
//
// The mix already used a track's level — buildItems hands `track.level` to the
// mixer as that take's volume, and the mixer ramps the change — but there was no
// control for it, so a layered pass played at whatever balance its takes landed
// at. This is the control, and it is labelled, capped and numbered rather than a
// bare line: a volume control has to look like one.
//
// The drag owns the value while the finger is down. Committing on every move
// would write the whole session to the device dozens of times a second, so the
// level is handed over once, on release, and the number on the key follows the
// finger meanwhile.
import React, { useRef, useState } from 'react';
import { View, PanResponder, StyleSheet } from 'react-native';
import EngravedText from './EngravedText';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const CAP = 10;

export default function TrackLevel({ index, value, color, fill, textColor, style, onChange }) {
  const [drag, setDrag] = useState(null);
  const [boxW, setBoxW] = useState(0);
  const width = useRef(80);
  const next = useRef(value);
  const cb = useRef(onChange);
  cb.current = onChange;

  const at = (x) => {
    // A coordinate the platform did not supply must not move the fader: a level of
    // NaN empties the bar and mixes that track out with nothing to explain it.
    if (!Number.isFinite(x)) return;
    const v = clamp01(x / Math.max(1, width.current));
    next.current = v;
    setDrag(v);
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => at(e.nativeEvent.locationX),
      onPanResponderMove: (e) => at(e.nativeEvent.locationX),
      onPanResponderRelease: () => {
        // Two decimals: a level is a gain, not a measurement.
        if (typeof cb.current === 'function') cb.current(Number(next.current.toFixed(2)));
        setDrag(null);
      },
      onPanResponderTerminate: () => setDrag(null),
    })
  ).current;

  const settled = clamp01(Number(value) || 0);
  const shown = drag === null ? settled : drag;
  const pct = Math.round(shown * 100);
  // The cap stays inside the slot at both ends.
  const capLeft = Math.max(0, (pct / 100) * Math.max(0, boxW - CAP));

  return (
    <View
      {...pan.panHandlers}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width || 0;
        width.current = w || 80;
        setBoxW(w);
      }}
      style={[st.wrap, style]}
      accessibilityRole="adjustable"
      accessibilityLabel={`Track ${index + 1} volume ${Math.round(settled * 100)} percent, drag to set`}
      accessibilityValue={{ text: Math.round(settled * 100) + '%' }}
    >
      <View pointerEvents="none" style={st.head}>
        <EngravedText size={9} color={textColor}>VOL</EngravedText>
        <EngravedText size={9} color={textColor}>{String(pct)}</EngravedText>
      </View>
      <View pointerEvents="none" style={st.fader}>
        <View style={[st.slot, { borderColor: color }]}>
          <View style={[st.fill, { width: pct + '%', backgroundColor: fill }]} />
        </View>
        <View style={[st.knob, { left: capLeft, backgroundColor: fill, borderColor: color }]} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  fader: { height: 16, justifyContent: 'center' },
  slot: {
    height: 6,
    borderRadius: 3,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  fill: { height: '100%' },
  knob: { position: 'absolute', width: CAP, height: 14, borderRadius: 3, borderWidth: 1, top: 1 },
});
