import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../ui/theme';
import { spacing } from '../ui/design-tokens';
import NavBar from '../components/NavBar';
import EngravedText from '../components/EngravedText';
import { ObsidianBackdrop, GlassPanel, glassStroke } from '../ui/glass';
import { useStudio } from '../store/StudioContext';
import { resolveRadio, RADIO_SOURCES, SOURCE_LABEL } from '../lib/radio';

const fmt = (sec) => {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

function Badge({ label, color, border }) {
  return (
    <View style={[s.badge, { borderColor: border }]}>
      <Text style={[s.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export default function RadioScreen() {
  const t = useTheme();
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const studio = useStudio() || {};
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [playlist, setPlaylist] = useState(null);
  const [laying, setLaying] = useState(false);

  const tracks = playlist ? playlist.tracks || [] : [];
  const playable = useMemo(() => tracks.filter((tr) => tr.url), [tracks]);
  const fromAudiomack = !!(playlist && playlist.source === 'audiomack');
  const leftOff = playlist ? Math.max(0, (playlist.total || 0) - playable.length) : 0;
  const runtime = useMemo(
    () => playable.reduce((sum, tr) => sum + (Number(tr.duration) || 0), 0),
    [playable]
  );

  const goBack = () => {
    if (nav.canGoBack()) nav.goBack();
    else nav.navigate('Deck');
  };

  const onImport = async () => {
    const value = link.trim();
    if (!value) {
      setError('Paste a playlist link first.');
      return;
    }
    setBusy(true);
    setError('');
    setPlaylist(null);
    try {
      const found = await resolveRadio(value);
      setPlaylist(found);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      setError((e && e.message) || 'That playlist could not be read. Try another link.');
    } finally {
      setBusy(false);
    }
  };

  const onLay = () => {
    if (!playlist || laying) return;
    setLaying(true);
    try {
      const id = studio.importRadio ? studio.importRadio(playlist) : null;
      if (!id) {
        setError('None of those songs has audio this app can play.');
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      nav.navigate('Deck');
    } catch (e) {
      setError((e && e.message) || 'Could not lay that playlist on the reel.');
    } finally {
      setLaying(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ObsidianBackdrop />
      <NavBar title="Tape Radio" onBack={goBack} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: spacing.md || 16, paddingBottom: insets.bottom + 32 }}
        >
          <Text style={[t.font.caption, { color: t.accent, letterSpacing: 1.2 }]}>PLAYLIST IN · REEL OUT</Text>
          <Text style={[t.font.title, { color: t.text, marginTop: 6, fontSize: 26, lineHeight: 33 }]}>
            Put a playlist on the tape
          </Text>
          <Text style={[t.font.body, { color: t.textMuted, marginTop: 8, lineHeight: 20 }]}>
            Paste a Spotify or Audiomack playlist link. The songs are laid end to end on a fresh
            reel, so the wheel plays through them — spin it faster, drag it slow, run it backwards.
          </Text>

          <GlassPanel radius={14} style={{ marginTop: spacing.md || 16, padding: 10 }}>
            <TextInput
              value={link}
              onChangeText={(v) => {
                setLink(v);
                if (error) setError('');
              }}
              onSubmitEditing={onImport}
              placeholder="https://open.spotify.com/playlist/… or https://audiomack.com/…/playlist/…"
              placeholderTextColor={t.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              accessibilityLabel="Playlist link"
              style={[
                t.font.body,
                {
                  color: t.text,
                  backgroundColor: 'rgba(0,0,0,0.25)',
                  borderColor: t.border,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderRadius: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  minHeight: 44,
                },
              ]}
            />
            <Pressable
              onPress={onImport}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Import playlist"
              style={({ pressed }) => [
                s.importKey,
                {
                  backgroundColor: busy ? t.surface : t.accent,
                  opacity: busy ? 0.6 : pressed ? 0.8 : 1,
                  marginTop: 10,
                },
              ]}
            >
              {busy ? (
                <ActivityIndicator color={t.text} />
              ) : (
                <>
                  <Ionicons name="radio-outline" size={18} color={t.onAccent || '#fff'} />
                  <Text style={[t.font.label, { color: t.onAccent || '#fff', marginLeft: 8, fontSize: 15 }]}>
                    IMPORT PLAYLIST
                  </Text>
                </>
              )}
            </Pressable>
          </GlassPanel>

          {error ? (
            <Text style={[t.font.body, { color: t.danger || t.accent, marginTop: 12, lineHeight: 19 }]}>{error}</Text>
          ) : null}

          {busy ? (
            <Text style={[t.font.caption, { color: t.textMuted, marginTop: 12, letterSpacing: 1 }]}>
              READING THE PLAYLIST AND MATCHING AUDIO…
            </Text>
          ) : null}

          {playlist ? (
            <GlassPanel radius={14} style={{ marginTop: spacing.md || 16, padding: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <EngravedText size={11} color={t.warning}>
                  {SOURCE_LABEL[playlist.source] || 'PLAYLIST'}
                </EngravedText>
                <Badge
                  label={playlist.playable + ' OF ' + playlist.total + ' WITH AUDIO'}
                  color={playlist.playable ? t.success || t.text : t.danger || t.accent}
                  border={glassStroke}
                />
              </View>
              <Text style={[t.font.title, { color: t.text, marginTop: 8, fontSize: 19, lineHeight: 25 }]} numberOfLines={2}>
                {playlist.title}
              </Text>
              <Text style={[t.font.caption, { color: t.textMuted, marginTop: 4 }]}>
                {playable.length + ' songs · ' + fmt(runtime) + ' of tape · 30-second previews'}
              </Text>
              {fromAudiomack ? (
                <Text style={[t.font.caption, { color: t.textMuted, marginTop: 6, lineHeight: 16 }]}>
                  Audiomack keeps its streams on Audiomack, so these are 30-second previews matched
                  from the public iTunes catalogue — not the full songs.
                  {leftOff
                    ? ' ' + leftOff + (leftOff === 1 ? ' song had' : ' songs had') + ' no match and will be left off the reel; they cannot be heard here.'
                    : ' Every song in this list found a preview.'}
                </Text>
              ) : null}

              <View style={{ marginTop: 12 }}>
                {tracks.slice(0, 14).map((tr, i) => (
                  <View key={i} style={[s.row, { borderTopColor: t.border }]}>
                    <Text style={[s.num, { color: t.textMuted }]}>{String(i + 1).padStart(2, '0')}</Text>
                    <View style={{ flex: 1, paddingHorizontal: 8 }}>
                      <Text style={[t.font.body, { color: tr.url ? t.text : t.textMuted }]} numberOfLines={1}>
                        {tr.title}
                      </Text>
                      {tr.artist ? (
                        <Text style={[t.font.caption, { color: t.textMuted, marginTop: 1 }]} numberOfLines={1}>
                          {tr.artist}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={[s.mini, { color: tr.url ? (t.warning || t.accent) : t.textMuted }]}>
                      {tr.url ? (tr.preview ? 'PREVIEW' : 'FULL') : 'NO AUDIO'}
                    </Text>
                  </View>
                ))}
                {tracks.length > 14 ? (
                  <Text style={[t.font.caption, { color: t.textMuted, marginTop: 8 }]}>
                    + {tracks.length - 14} more
                  </Text>
                ) : null}
              </View>

              <Pressable
                onPress={onLay}
                disabled={!playable.length || laying}
                accessibilityRole="button"
                accessibilityLabel="Lay this playlist on a new reel"
                style={({ pressed }) => [
                  s.layKey,
                  {
                    borderColor: playable.length ? t.warning || t.accent : t.border,
                    backgroundColor: 'rgba(0,0,0,0.25)',
                    opacity: playable.length ? (pressed ? 0.75 : 1) : 0.45,
                    marginTop: 14,
                  },
                ]}
              >
                <Ionicons name="disc-outline" size={20} color={t.warning || t.accent} />
                <Text style={[t.font.label, { color: t.warning || t.accent, marginLeft: 8, fontSize: 15 }]}>
                  {leftOff ? 'LAY THE ' + playable.length + ' PLAYABLE ON A NEW REEL' : 'LAY IT ON A NEW REEL'}
                </Text>
              </Pressable>
              <Text style={[t.font.caption, { color: t.textMuted, marginTop: 8, lineHeight: 16 }]}>
                30-second previews only: that is the part of a song Spotify and Audiomack let another
                player have. Your own .m3u or audio link plays in full.
              </Text>
            </GlassPanel>
          ) : null}

          {!playlist && !busy ? (
            <View style={{ marginTop: spacing.lg || 20 }}>
              {RADIO_SOURCES.map((src) => (
                <View key={src.id} style={[s.source, { borderColor: t.border }]}>
                  <EngravedText size={11} color={t.text}>{src.label}</EngravedText>
                  <Text style={[t.font.caption, { color: t.textMuted, marginTop: 3, lineHeight: 16 }]}>
                    {src.detail}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  importKey: {
    minHeight: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  layKey: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  badgeText: { fontSize: 10, letterSpacing: 0.8, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  num: { width: 22, fontSize: 12, letterSpacing: 0.5 },
  mini: { fontSize: 10, letterSpacing: 0.8, fontWeight: '600' },
  source: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
});
