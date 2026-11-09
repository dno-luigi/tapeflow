import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../../ui/theme';
import VUMeter from '../VUMeter';

export default function TapeBox({ name, meta, size, onPress, onLongPress, tall, wide, empty }) {
  const t = useTheme();
  const height = tall ? 300 : 144;
  const paper = t.accents[4];
  const typed = { fontFamily: Platform_mono(), color: t.bg };
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={empty}
      accessibilityRole="button"
      accessibilityLabel={empty ? meta : name + ', ' + meta}
      style={({ pressed }) => [
        styles.box,
        { minHeight: height, backgroundColor: t.bg, borderColor: t.border, opacity: pressed ? 0.8 : 1 },
        wide ? { minHeight: 144 } : null,
      ]}
    >
      <View style={[styles.spine, { backgroundColor: t.accents[3], borderRightColor: t.border }]}>
        <View style={[styles.spineBand, { backgroundColor: t.accent }]} />
        <View style={[styles.spineBand, { backgroundColor: t.accents[1] }]} />
        <View style={[styles.spineBand, { backgroundColor: t.accent }]} />
      </View>
      <View style={styles.body}>
        <View style={[styles.label, { backgroundColor: paper, borderColor: t.accents[1] }]}>
          {empty ? (
            <Text style={[typed, { fontSize: 16, lineHeight: 22 }]}>{meta}</Text>
          ) : (
            <>
              <Text
                style={[
                  typed,
                  {
                    fontSize: tall ? 26 : 18,
                    lineHeight: tall ? 34 : 24,
                    fontStyle: 'italic',
                    fontWeight: '600',
                    transform: [{ rotate: '-2deg' }],
                  },
                ]}
              >
                {name}
              </Text>
              <Text style={[typed, { fontSize: 13, lineHeight: 18, marginTop: 6, opacity: 0.8 }]}>{meta}</Text>
            </>
          )}
        </View>
        {empty ? null : (
          <View style={styles.foot}>
            <VUMeter width={tall ? 90 : 60} height={tall ? 54 : 36} level={0.5} label="" />
            <Text style={[t.font.caption, { color: t.textMuted, fontSize: 12, lineHeight: 16, textTransform: 'uppercase', letterSpacing: 1 }]}>{size}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

function Platform_mono() {
  // Typewriter feel without needing a bundled font.
  const { Platform } = require('react-native');
  return Platform.OS === 'ios' ? 'Courier' : 'monospace';
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  spine: { width: 20, borderRightWidth: StyleSheet.hairlineWidth, justifyContent: 'space-evenly', paddingVertical: 10 },
  spineBand: { height: 6, width: '100%' },
  body: { flex: 1, padding: 10, justifyContent: 'space-between', gap: 8 },
  label: { borderRadius: 2, padding: 10, borderWidth: StyleSheet.hairlineWidth },
  foot: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
});
