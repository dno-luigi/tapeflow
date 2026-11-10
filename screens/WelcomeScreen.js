import React from 'react';
import { View, Text, Pressable, StatusBar, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../ui/theme';
import { ObsidianBackdrop, GlassPanel } from '../ui/glass';
import { useStudio } from '../store/StudioContext';

// Spec metrics: 24pt gutters, 12pt gap under the title, 24pt subtitle line height.
const GUTTER = 24;
const TITLE_GAP = 12;
const SUBTITLE_LINE = 24;

// The three things this recorder actually does, said once, on the first screen.
const SPECS = [
  ['24-bit / 96 kHz', 'Lossless capture'],
  ['50% … 200%', 'Varispeed on the reel'],
  ['Both directions', 'Scrub backwards with sound'],
];

export default function WelcomeScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const studio = useStudio() || {};

  const onStart = async () => {
    try {
      Haptics.selectionAsync();
    } catch (e) {
      // haptics unavailable; continue
    }
    if (typeof studio.completeOnboarding === 'function') {
      await studio.completeOnboarding();
    }
    navigation.navigate('Sign In');
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <ObsidianBackdrop />
      <View
        style={{
          flex: 1,
          paddingTop: insets.top + GUTTER,
          paddingBottom: insets.bottom + 16,
          paddingHorizontal: GUTTER,
          justifyContent: 'space-between',
        }}
      >
        <View>
          <Text style={[t.font.display2, { lineHeight: 58, color: t.text }]}>
            Four tracks.{'\n'}One obsidian deck.
          </Text>
          <Text
            style={[
              t.font.body,
              { fontSize: 17, lineHeight: SUBTITLE_LINE, color: t.textMuted, marginTop: TITLE_GAP },
            ]}
          >
            Clean digital takes, then bend them by hand on the wheel.
          </Text>
        </View>

        <GlassPanel radius={22} style={{ paddingHorizontal: 18, paddingVertical: 6 }}>
          {SPECS.map(([value, label], i) => (
            <View
              key={label}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingVertical: 13,
                borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                borderTopColor: 'rgba(255,255,255,0.10)',
              }}
            >
              <Text style={[t.font.label, { color: t.text }]}>{value}</Text>
              <Text style={[t.font.caption, { color: t.textMuted }]}>{label}</Text>
            </View>
          ))}
        </GlassPanel>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Get started"
          onPress={onStart}
          style={({ pressed }) => [
            styles.cta,
            {
              backgroundColor: t.accent,
              borderRadius: t.radius.pill,
              opacity: pressed ? 0.85 : 1,
              shadowColor: t.accent,
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.45,
              shadowRadius: 24,
              elevation: 8,
            },
          ]}
        >
          <Text style={[t.font.headline, { color: t.onAccent }]}>Get started</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cta: { height: 56, alignItems: 'center', justifyContent: 'center', width: '100%' },
});
