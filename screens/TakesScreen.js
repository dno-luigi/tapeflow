import React, { useMemo, useState, useEffect, useRef } from 'react';
import { View, Text, Pressable, Alert, ScrollView, StyleSheet } from 'react-native';
import Svg, { Path, Line } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { useTheme } from '../ui/theme';
import { spacing } from '../ui/design-tokens';
import { useStudio } from '../store/StudioContext';
import EngravedText from '../components/EngravedText';
import { canTranscribe, transcribeTake } from '../lib/transcribe';

const W = 360;
const H = 88;
// The spec's 56 is the height of the action row, not a type size.
const ACTION_H = 56;

function wavePath(seed) {
  let s = (seed || 1) * 9301 + 49297;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  let d = '';
  for (let x = 0; x < W; x += 3) {
    const env = 0.35 + 0.65 * Math.abs(Math.sin(x / 41 + seed));
    const a = (H / 2 - 6) * env * (0.3 + rnd() * 0.7);
    d += `M${x} ${H / 2 - a} L${x} ${H / 2 + a} `;
  }
  return d;
}

export default function TakesScreen({ navigation, route }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const studio = useStudio() || {};
  const sessions = studio.sessions || [];
  const session = sessions.find((s) => s.id === studio.currentSessionId) || sessions[0];
  const trackIndex = Math.max(0, Math.min(3, route?.params?.track ?? 1));
  const track = session?.tracks?.[trackIndex];
  const takes = track?.takes || [];
  const cues = session?.cues || [];

  const [activeId, setActiveId] = useState(track?.activeTakeId);
  const [playingId, setPlayingId] = useState(null);
  const [notice, setNotice] = useState('');
  const [transcribing, setTranscribing] = useState(false);
  const [transcriptError, setTranscriptError] = useState('');
  const playerRef = useRef(null);

  const releasePlayer = () => {
    const p = playerRef.current;
    playerRef.current = null;
    if (!p) return;
    try { p.pause(); } catch (e) {}
    try { p.remove(); } catch (e) {}
  };

  useEffect(() => () => releasePlayer(), []);

  useEffect(() => {
    if (activeId == null && track?.activeTakeId != null) setActiveId(track.activeTakeId);
  }, [track?.activeTakeId]);

  const ordered = useMemo(() => {
    const list = [...takes].sort((a, b) => (b.n || 0) - (a.n || 0));
    const top = list.find((x) => x.id === activeId);
    return top ? [top, ...list.filter((x) => x.id !== activeId)] : list;
  }, [takes, activeId]);

  const activeTake = takes.find((x) => x.id === activeId) || ordered[0];
  const deletable = [...takes].filter((x) => x.id !== activeId).sort((a, b) => (a.n || 0) - (b.n || 0))[0];

  const close = () => {
    releasePlayer();
    navigation.goBack();
  };

  const onDone = () => {
    try {
      if (activeId != null && activeId !== track?.activeTakeId) {
        studio.setActiveTake?.(trackIndex, activeId);
      }
    } catch (e) {
      Alert.alert('Could not apply take', e?.message || 'Try again.');
      return;
    }
    close();
  };

  const onAudition = async (take) => {
    if (playingId === take.id) {
      releasePlayer();
      setPlayingId(null);
      return;
    }
    releasePlayer();
    setPlayingId(null);
    if (!take.uri) {
      Alert.alert('No audio on this take', 'This take was made before sound recording was on. Record a new take to hear it.');
      return;
    }
    try {
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      const player = createAudioPlayer({ uri: take.uri });
      player.addListener('playbackStatusUpdate', (status) => {
        if (status && status.didJustFinish && playerRef.current === player) {
          releasePlayer();
          setPlayingId(null);
        }
      });
      playerRef.current = player;
      setPlayingId(take.id);
      player.play();
    } catch (e) {
      releasePlayer();
      setPlayingId(null);
      Alert.alert('Could not play take', e?.message || 'Try again.');
    }
  };

  const onDelete = () => {
    if (!deletable) {
      Alert.alert('Nothing to delete', 'The active take cannot be deleted.');
      return;
    }
    Alert.alert(`Delete take ${deletable.n}?`, "This can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          try {
            if (playingId === deletable.id) {
              releasePlayer();
              setPlayingId(null);
            }
            studio.deleteTake?.(trackIndex, deletable.id);
            setNotice(`Take ${deletable.n} deleted`);
          } catch (e) {
            Alert.alert('Could not delete take', e?.message || 'Try again.');
          }
        },
      },
    ]);
  };

  const onBounce = () => {
    try {
      studio.bounceTakes?.(trackIndex);
      setNotice('Kept the active take on this track');
      Alert.alert('Bounced', 'The active take is now the only take on this track.');
    } catch (e) {
      Alert.alert('Could not bounce', e?.message || 'Try again.');
    }
  };

  // Words for the active take. The audio is offline in this browser, so the take
  // is uploaded to the app's own server, which is the only place the speech-to-text
  // key lives.
  const onTranscribe = async () => {
    if (!activeTake || transcribing) return;
    setTranscriptError('');
    setTranscribing(true);
    try {
      const text = await transcribeTake(activeTake);
      studio.setTakeTranscript?.(trackIndex, activeTake.id, text);
      setNotice(`Transcript saved with TAKE ${activeTake.n}`);
    } catch (e) {
      setTranscriptError(e?.message || 'Could not transcribe that take.');
    } finally {
      setTranscribing(false);
    }
  };

  const wave = useMemo(() => wavePath(activeTake?.n || 1), [activeTake?.n]);

  return (
    <View style={[styles.dim, { paddingTop: insets.top + 44 }]}>
      <View style={[styles.sheet, { backgroundColor: t.surface, borderColor: t.border, paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.grabber}>
          <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: t.textMuted, opacity: 0.6 }} />
        </View>
        <View style={styles.header}>
          <Pressable onPress={close} style={styles.hbtn} accessibilityLabel="Cancel">
            <Text style={[t.font.caption, { color: t.textMuted, fontSize: 16, lineHeight: 21 }]}>Cancel</Text>
          </Pressable>
          <EngravedText size={15} color={t.text}>{`TRK ${trackIndex + 1} · TAKES`}</EngravedText>
          <Pressable onPress={onDone} style={[styles.hbtn, { alignItems: 'flex-end' }]} accessibilityLabel="Done">
            <Text style={[t.font.label, { color: t.accent, fontSize: 16, lineHeight: 21 }]}>Done</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.gutter ?? 20, paddingBottom: spacing.md }}>
          <View style={[styles.wave, { borderColor: t.border }]}>
            <View style={styles.flags}>
              {cues.slice(0, 8).map((c, i) => (
                <View key={c.id ?? i} style={{ position: 'absolute', left: `${Math.min(92, 8 + i * 30)}%`, top: 2 }}>
                  <Ionicons name="flag" size={14} color={i === 1 ? t.accent : t.warning} />
                </View>
              ))}
            </View>
            <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
              <Path d={wave} stroke={t.warning} strokeWidth={1.5} />
              <Line x1={W * 0.36} y1={0} x2={W * 0.36} y2={H} stroke={t.text} strokeWidth={1.5} />
            </Svg>
          </View>

          <View style={{ marginTop: spacing.md }}>
            {ordered.length === 0 ? (
              <View style={[styles.empty, { borderColor: t.border }]}>
                <Text style={[t.font.body, { color: t.textMuted, textAlign: 'center' }]}>
                  No takes on this track yet. Arm it and press record on the deck.
                </Text>
              </View>
            ) : (
              ordered.map((take, i) => {
                const isActive = take.id === activeId;
                return (
                  <Pressable
                    key={take.id}
                    onPress={() => setActiveId(take.id)}
                    style={({ pressed }) => [
                      styles.label,
                      {
                        marginLeft: i * 8,
                        marginTop: i === 0 ? 0 : -6,
                        zIndex: 10 - i,
                        backgroundColor: t.accents?.[4] || t.text,
                        opacity: pressed ? 0.85 : 1,
                        borderLeftColor: isActive ? t.accent : t.accents?.[2] || t.border,
                      },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[t.font.label, { color: t.bg, fontSize: 15, lineHeight: Math.round(15 * 1.3) }]}>
                        {`TAKE ${take.n} · ${take.duration}s · ${take.createdLabel}${isActive ? ' · ' : ''}`}
                        {isActive ? <Text style={{ color: t.accent }}>ACTIVE</Text> : null}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => onAudition(take)}
                      style={[styles.play, { backgroundColor: t.bg }]}
                      accessibilityLabel={playingId === take.id ? `Stop take ${take.n}` : `Play take ${take.n}`}
                    >
                      <Ionicons name={playingId === take.id ? 'stop' : 'play'} size={18} color={t.text} />
                    </Pressable>
                  </Pressable>
                );
              })
            )}
          </View>

          <Text style={[t.font.body, { color: t.textMuted, fontSize: 14, lineHeight: Math.round(14 * 1.3), marginTop: spacing.md }]}>
            Earlier takes are kept. Tap one to swap it in, or press play to hear it.
          </Text>
          {notice ? (
            <Text style={[t.font.label, { color: t.success, fontSize: 14, lineHeight: Math.round(14 * 1.3), marginTop: 8 }]}>{notice}</Text>
          ) : null}
          {activeTake ? (
            <Text style={[t.font.caption, { color: t.textMuted, fontSize: 12, lineHeight: Math.round(12 * 1.3), marginTop: 4 }]}>
              {`Deck will play TAKE ${activeTake.n}`}
            </Text>
          ) : null}

          {canTranscribe() ? (
            <View style={[styles.transcript, { borderColor: t.border }]}>
              <View style={styles.transcriptHead}>
                <EngravedText size={11} color={t.textMuted}>TRANSCRIPT</EngravedText>
                <Pressable
                  onPress={onTranscribe}
                  disabled={!activeTake || transcribing}
                  accessibilityLabel={activeTake ? `Transcribe take ${activeTake.n}` : 'Transcribe a take'}
                  style={({ pressed }) => [
                    styles.transcribeBtn,
                    { borderColor: t.border, opacity: !activeTake ? 0.4 : pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text style={[t.font.label, { color: t.accent, fontSize: 12, lineHeight: 16 }]}>
                    {transcribing ? 'LISTENING…' : activeTake && activeTake.transcript ? 'TRANSCRIBE AGAIN' : 'TRANSCRIBE TAKE'}
                  </Text>
                </Pressable>
              </View>
              {activeTake && activeTake.transcript ? (
                <Text selectable style={[t.font.body, { color: t.text, fontSize: 14, lineHeight: 20 }]}>
                  {activeTake.transcript}
                </Text>
              ) : (
                <Text style={[t.font.caption, { color: t.textMuted, fontSize: 12, lineHeight: 17 }]}>
                  {activeTake ? 'No words yet. Transcribe this take to read it back.' : 'Pick a take to transcribe.'}
                </Text>
              )}
              {transcriptError ? (
                <Text style={[t.font.caption, { color: t.danger, fontSize: 12, lineHeight: 17, marginTop: 6 }]}>
                  {transcriptError}
                </Text>
              ) : null}
            </View>
          ) : null}

          <View style={styles.actions}>
            <Pressable
              onPress={onBounce}
              disabled={takes.length === 0}
              accessibilityLabel="Keep only the active take"
              style={({ pressed }) => [
                styles.bounce,
                {
                  backgroundColor: t.accents?.[3] || t.surface,
                  borderColor: t.border,
                  opacity: takes.length === 0 ? 0.4 : pressed ? 0.8 : 1,
                },
              ]}
            >
              <Text style={[t.font.label, { color: t.text, fontSize: 16, lineHeight: Math.round(16 * 1.3) }]}>
                Keep active take only
              </Text>
            </Pressable>
            <Pressable
              onPress={onDelete}
              disabled={!deletable}
              style={[styles.del, { opacity: deletable ? 1 : 0.4 }]}
              accessibilityLabel="Delete take"
            >
              <Text style={[t.font.label, { color: t.danger, fontSize: 16, lineHeight: Math.round(16 * 1.3) }]}>Delete take</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    flex: 1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  grabber: { alignItems: 'center', paddingTop: 8, paddingBottom: 4 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    minHeight: 48,
  },
  hbtn: { minWidth: 70, minHeight: 44, justifyContent: 'center' },
  wave: {
    height: 88,
    backgroundColor: '#000',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    overflow: 'hidden',
  },
  flags: { position: 'absolute', left: 0, right: 0, top: 0, height: 18, zIndex: 2 },
  label: {
    minHeight: 72,
    borderRadius: 6,
    borderLeftWidth: 6,
    paddingLeft: 12,
    paddingRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  play: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  empty: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, padding: 24 },
  transcript: { marginTop: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, padding: 12 },
  transcriptHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  transcribeBtn: { minHeight: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: 24, gap: 12 },
  bounce: {
    flex: 1,
    minHeight: ACTION_H,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  del: { minHeight: ACTION_H, minWidth: 100, alignItems: 'center', justifyContent: 'center' },
});
