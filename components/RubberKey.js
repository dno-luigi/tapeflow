import React, { useRef } from 'react';
import { Animated, Pressable, View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../ui/theme';
import EngravedText from './EngravedText';

export default function RubberKey({
  label,
  onPress,
  onPressIn,
  onPressOut,
  height = 56,
  active = false,
  variant = 'rubber',
  disabled = false,
  glyph,
  style,
}) {
  const t = useTheme();
  const scale = useRef(new Animated.Value(1)).current;

  const isRed = variant === 'red';
  const lit = active;
  // Obsidian glass, not moulded rubber: unlit keys are smoked glass with a
  // hairline edge, and a lit key is the one place colour is allowed to bloom.
  const bg = lit ? (isRed ? t.accent : t.accents[0]) : isRed ? t.accentSoft : 'rgba(255,255,255,0.06)';
  const ink = lit ? (isRed ? t.text : t.bg) : isRed ? t.accent : t.text;
  const edge = lit ? (isRed ? t.accent : t.accents[0]) : 'rgba(255,255,255,0.14)';

  const handleIn = (e) => {
    Animated.spring(scale, { toValue: 0.95, stiffness: 400, damping: 18, mass: 1, useNativeDriver: true }).start();
    Haptics.selectionAsync().catch(() => {});
    if (onPressIn) onPressIn(e);
  };
  const handleOut = (e) => {
    Animated.spring(scale, { toValue: 1, stiffness: 300, damping: 14, mass: 1, useNativeDriver: true }).start();
    if (onPressOut) onPressOut(e);
  };

  return (
    <Animated.View style={[{ flex: 1, transform: [{ scale }], opacity: disabled ? 0.4 : 1 }, style]}>
      <Pressable
        disabled={disabled}
        onPress={onPress}
        onPressIn={handleIn}
        onPressOut={handleOut}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled, selected: active }}
        style={{
          height,
          minWidth: 44,
          borderRadius: 10,
          backgroundColor: bg,
          borderWidth: 1,
          borderColor: edge,
          borderBottomWidth: 3,
          borderBottomColor: lit ? edge : 'rgba(0,0,0,0.45)',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 4,
          shadowColor: lit ? (isRed ? t.accent : t.accents[0]) : '#000',
          shadowOffset: { width: 0, height: lit ? 0 : 2 },
          shadowOpacity: lit ? 0.6 : 0.35,
          shadowRadius: lit ? 10 : 4,
          elevation: lit ? 6 : 3,
        }}
      >
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: 10, overflow: 'hidden' }]}>
          <LinearGradient
            colors={lit ? ['rgba(255,255,255,0.30)', 'rgba(255,255,255,0)'] : ['rgba(255,255,255,0.16)', 'rgba(255,255,255,0.02)', 'rgba(255,255,255,0)']}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.6, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </View>
        {glyph ? (
          <View style={{ marginBottom: label ? 2 : 0 }}>
            <Ionicons name={glyph} size={20} color={ink} />
          </View>
        ) : null}
        {label ? (
          <EngravedText size={11} color={ink} numberOfLines={1}>
            {label}
          </EngravedText>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}
