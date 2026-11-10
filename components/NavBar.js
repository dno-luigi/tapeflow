import React from 'react';
import { Pressable, View, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../ui/theme';
import { glassStroke } from '../ui/glass';
import EngravedText from './EngravedText';

// A frosted bar that content passes underneath: the blur and the hairline are
// what make it read as glass rather than as a header with a background colour.
export default function NavBar({ title, onBack, right }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top, overflow: 'hidden' }}>
      <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255,255,255,0.035)' }]} />
      <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: t.spacing.sm }}>
        <View style={{ width: 80, alignItems: 'flex-start' }}>
          {onBack ? (
            <Pressable
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={8}
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.5 : 1,
              })}
            >
              <Ionicons name="chevron-back" size={26} color={t.accents[0]} />
            </Pressable>
          ) : null}
        </View>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <EngravedText size={15} color={t.text} numberOfLines={1}>
            {title}
          </EngravedText>
        </View>
        <View style={{ width: 80, alignItems: 'flex-end', justifyContent: 'center' }}>{right || null}</View>
      </View>
      <View pointerEvents="none" style={{ height: StyleSheet.hairlineWidth, backgroundColor: glassStroke }} />
    </View>
  );
}
