import React from 'react';
import { ImageBackground, View, Text, Pressable, StatusBar, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { ART } from '../constants/artwork';
import { AppImage } from '../ui/kit';
import { useTheme } from '../ui/theme';
import { useStudio } from '../store/StudioContext';

// Spec metrics: 24pt gutters, 12pt gap under the title, 24pt subtitle line height.
const GUTTER = 24;
const TITLE_GAP = 12;
const SUBTITLE_LINE = 24;

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
    <ImageBackground
      source={ART.welcomeBackground}
      resizeMode="cover"
      style={{ flex: 1, width: '100%', height: '100%', backgroundColor: t.bg }}
    >
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <AppImage source={ART.welcomePhoto} contentFit="cover" style={StyleSheet.absoluteFill} />
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.28)' }]}
      />
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
          <Text style={[t.font.display2, { lineHeight: 58, color: '#FFFFFF' }]}>
            Four tracks.{'\n'}One warm machine.
          </Text>
          <Text
            style={[
              t.font.body,
              { fontSize: 17, lineHeight: SUBTITLE_LINE, color: 'rgba(255,255,255,0.9)', marginTop: TITLE_GAP },
            ]}
          >
            Make it yours, one step at a time.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Get started"
          onPress={onStart}
          style={({ pressed }) => [
            styles.cta,
            { backgroundColor: t.accent, borderRadius: t.radius.pill, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[t.font.headline, { color: t.onAccent }]}>Get started</Text>
        </Pressable>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  cta: { height: 56, alignItems: 'center', justifyContent: 'center', width: '100%' },
});
