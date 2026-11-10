import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Alert,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../ui/theme';
import { AppImage } from '../ui/kit';
import { ObsidianBackdrop } from '../ui/glass';
// (Sign In is reached from Welcome and from the Back Panel account plate.)
import { ART } from '../constants/artwork';
import NavBar from '../components/NavBar';
// Email + password, against our own Worker (worker/index.js). The Google and
// Apple buttons were backed by WRON's OAuth broker and are gone with it.
import { signIn, signUp } from '../lib/auth';

export default function SignInScreen() {
  const t = useTheme();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const goBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Welcome');
  };

  const openDeck = () => navigation.navigate('Deck');

  const submit = async () => {
    const e = email.trim();
    if (!e || e.indexOf('@') < 1) {
      Alert.alert('Check your email', 'Enter the email address you want to use.');
      return;
    }
    if (password.length < 1) {
      Alert.alert('Add a password', 'Enter your password to continue.');
      return;
    }
    setBusy(true);
    try {
      if (creating) {
        await signUp({ email: e, password, name: e.split('@')[0] });
      } else {
        await signIn({ email: e, password });
      }
      setPassword('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      openDeck();
    } catch (err) {
      if (creating) {
        Alert.alert('Could not create account', (err && err.message) || 'Try again in a moment.');
      } else {
        const msg = String((err && err.message) || '').toLowerCase();
        const network = /network|timeout|timed out|offline|fetch|connection/.test(msg);
        if (network) {
          Alert.alert('Could not reach the server', 'Check your connection and try again.');
        } else {
          Alert.alert("That email and password don't match.");
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const fieldStyle = [
    t.font.body,
    styles.field,
    { backgroundColor: t.surface, borderColor: t.border, color: t.text, borderRadius: 14 },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ObsidianBackdrop />
      <View style={{ paddingTop: insets.top }}>
        <NavBar title="Account" onBack={goBack} />
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: 24,
            paddingTop: 32,
            paddingBottom: insets.bottom + 24,
          }}
        >
          <Text
            style={[
              t.font.title,
              {
                color: t.text,
                fontSize: 28,
                lineHeight: Math.round(28 * 1.3),
                textTransform: 'uppercase',
                letterSpacing: 1,
              },
            ]}
          >
            Keep your tapes with you
          </Text>
          <Text
            style={[
              t.font.body,
              {
                color: t.textMuted,
                fontSize: 16,
                lineHeight: Math.round(16 * 1.3),
                marginTop: 12,
                marginBottom: 24,
              },
            ]}
          >
            Sign in and your sessions follow you to a new phone. Recording works fine without it.
          </Text>

          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor={t.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            clearButtonMode="while-editing"
            style={fieldStyle}
          />
          <View style={{ height: 12 }} />
          <View>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={t.textMuted}
              secureTextEntry={!showPw}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={submit}
              style={[fieldStyle, { paddingRight: 52 }]}
            />
            <Pressable
              onPress={() => setShowPw(!showPw)}
              accessibilityLabel={showPw ? 'Hide password' : 'Show password'}
              style={styles.eye}
            >
              <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={22} color={t.textMuted} />
            </Pressable>
          </View>

          <Pressable
            onPress={submit}
            disabled={busy}
            style={({ pressed }) => [
              styles.primary,
              { backgroundColor: t.accent, opacity: pressed || busy ? 0.7 : 1 },
            ]}
          >
            {busy ? (
              <ActivityIndicator color={t.onAccent} />
            ) : (
              <Text style={[t.font.label, { color: t.onAccent, fontSize: 16, lineHeight: 21 }]}>
                {creating ? 'Create account' : 'Sign in with email'}
              </Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => setCreating(!creating)}
            accessibilityRole="button"
            accessibilityLabel="Create account"
            style={({ pressed }) => [styles.linkLeft, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text
              style={[
                t.font.caption,
                { color: creating ? t.text : t.textMuted, fontSize: 14, lineHeight: 18, textDecorationLine: 'underline' },
              ]}
            >
              Create account
            </Text>
          </Pressable>

          <Pressable
            onPress={openDeck}
            style={({ pressed }) => [styles.linkCenter, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={[t.font.body, { color: t.textMuted, fontSize: 16, lineHeight: 21 }]}>
              Skip for now
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    height: 56,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
  },
  eye: {
    position: 'absolute',
    right: 0,
    top: 6,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  primary: {
    height: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  linkLeft: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  linkCenter: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
  },
});
