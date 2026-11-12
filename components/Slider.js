// A horizontal slider for the deck.
//
// It keeps its own drag position so a drag re-renders only the slider, never the
// deck: the parent reads the value from a ref while the hand moves and commits it
// once on release.
import React, { useRef, useState } from 'react';
import { View, PanResponder } from 'react-native';
import EngravedText from './EngravedText';
import { useTheme } from '../ui/theme';

export default function Slider({ label, value, min, max, onChange, onCommit, format }) {
  const t = useTheme();
  const [dragK, setDragK] = useState(null);
  const widthRef = useRef(1);
  const valueRef = useRef(value);
  valueRef.current = value;

  const valueAt = (x) => {
    const k = Math.max(0, Math.min(1, x / Math.max(1, widthRef.current)));
    return min + k * (max - min);
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const v = valueAt(e.nativeEvent.locationX);
        setDragK((v - min) / (max - min));
        onChange && onChange(v);
      },
      onPanResponderMove: (e) => {
        const v = valueAt(e.nativeEvent.locationX);
        setDragK((v - min) / (max - min));
        onChange && onChange(v);
      },
      onPanResponderRelease: () => {
        setDragK(null);
        onCommit && onCommit(valueRef.current);
      },
      onPanResponderTerminate: () => {
        setDragK(null);
        onCommit && onCommit(valueRef.current);
      },
    })
  ).current;

  const k = dragK === null ? (value - min) / (max - min) : dragK;
  const pct = Math.max(0, Math.min(1, k)) * 100;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
        <EngravedText size={9} color={t.textMuted}>{label}</EngravedText>
        <EngravedText size={9} color={t.text}>{format ? format(value) : value.toFixed(2)}</EngravedText>
      </View>
      <View
        onLayout={(e) => { widthRef.current = e.nativeEvent.layout.width || 1; }}
        {...pan.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: format ? format(value) : String(value) }}
        style={{ height: 24, justifyContent: 'center' }}
      >
        <View style={{ height: 3, borderRadius: 2, backgroundColor: t.border }} />
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, width: pct + '%', height: 3, borderRadius: 2, backgroundColor: t.accent }} />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: pct + '%',
            marginLeft: -6,
            width: 12,
            height: 12,
            borderRadius: 6,
            backgroundColor: t.text,
          }}
        />
      </View>
    </View>
  );
}
