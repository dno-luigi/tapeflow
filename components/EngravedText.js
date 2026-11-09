import React from 'react';
import { Text } from 'react-native';
import { useTheme } from '../ui/theme';

export default function EngravedText({ children, size = 12, color, style, numberOfLines }) {
  const t = useTheme();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        t.font.caption,
        {
          fontSize: size,
          lineHeight: Math.round(size * 1.35),
          color: color || t.textMuted,
          textTransform: 'uppercase',
          letterSpacing: Math.max(1, size * 0.14),
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
