import React from 'react';
import { Switch, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../ui/theme';
import EngravedText from './EngravedText';

export default function ToggleSwitch({ label, value, onValueChange, helper, compact = false }) {
  const t = useTheme();
  const handle = (next) => {
    Haptics.selectionAsync().catch(() => {});
    if (onValueChange) onValueChange(next);
  };

  if (compact) {
    return (
      <View style={{ alignItems: 'center', justifyContent: 'center', minWidth: 44, minHeight: 44 }}>
        {label ? (
          <EngravedText size={9} color={value ? t.accents[0] : t.textMuted} style={{ marginBottom: 2 }}>
            {label}
          </EngravedText>
        ) : null}
        <Switch
          value={!!value}
          onValueChange={handle}
          accessibilityLabel={label}
          trackColor={{ false: t.border, true: t.accents[0] }}
          thumbColor={value ? t.text : t.textMuted}
          ios_backgroundColor={t.border}
          style={{ transform: [{ scale: 0.75 }] }}
        />
      </View>
    );
  }

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 56,
        paddingVertical: t.spacing.sm,
        paddingHorizontal: t.spacing.md,
        backgroundColor: t.surface,
        borderRadius: t.radius.md,
        borderWidth: 1,
        borderColor: t.border,
      }}
    >
      <View style={{ flex: 1, paddingRight: t.spacing.md }}>
        <EngravedText size={13} color={t.text}>
          {label}
        </EngravedText>
        {helper ? (
          <EngravedText size={11} color={t.textMuted} style={{ textTransform: 'none', letterSpacing: 0.2, marginTop: 2 }}>
            {helper}
          </EngravedText>
        ) : null}
      </View>
      <Switch
        value={!!value}
        onValueChange={handle}
        accessibilityLabel={label}
        trackColor={{ false: t.border, true: t.accents[0] }}
        thumbColor={value ? t.text : t.textMuted}
        ios_backgroundColor={t.border}
      />
    </View>
  );
}
