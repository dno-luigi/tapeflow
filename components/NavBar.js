import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../ui/theme';
import EngravedText from './EngravedText';

export default function NavBar({ title, onBack, right }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingTop: insets.top,
        backgroundColor: t.bg,
        borderBottomWidth: 1,
        borderBottomColor: t.border,
      }}
    >
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
    </View>
  );
}
