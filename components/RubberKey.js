import React, { useRef } from 'react';
import { Animated, Pressable, View } from 'react-native';
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
  const bg = lit ? (isRed ? t.accent : t.accents[0]) : isRed ? t.accentSoft : t.accents[3];
  const ink = lit ? (isRed ? t.text : t.bg) : isRed ? t.accent : t.text;
  const edge = lit ? (isRed ? t.accent : t.accents[0]) : t.border;

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
          borderBottomWidth: 4,
          borderBottomColor: lit ? edge : t.bg,
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
