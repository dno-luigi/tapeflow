import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, Modal, Alert, Linking, Platform, PanResponder, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../ui/theme';
import { AppImage } from '../ui/kit';
import { ART } from '../constants/artwork';
import { useStudio } from '../store/StudioContext';
import { currentUser, onAuthChange, signOut, deleteAccount } from '../lib/auth';
import { scheduleReminder, cancelReminder, askNotificationPermission } from '../lib/reminders';
import EngravedText from '../components/EngravedText';
import { ObsidianBackdrop } from '../ui/glass';
import RotarySelector from '../components/RotarySelector';
import ToggleSwitch from '../components/ToggleSwitch';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const WEEKDAY_NUM = { Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6 };
const INPUTS = ['INTERNAL MIC', 'USB-C'];
const RATES = ['48 kHz', '96 kHz'];
const pad = (n) => String(n).padStart(2, '0');

function parseTime(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return { h: 19, m: 30 };
  return { h: Math.min(23, Number(m[1])), m: Math.min(59, Number(m[2])) };
}

function Section({ title, t, children }) {
  return (
    <View style={{ marginTop: 24 }}>
      <View style={styles.sectionHead}>
        <EngravedText size={12} color={t.textMuted}>{title}</EngravedText>
        <View style={[styles.line, { backgroundColor: t.border }]} />
      </View>
      {children}
    </View>
  );
}

export default function BackPanelScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const studio = useStudio() || {};
  const settings = studio.settings || {};
  const sessions = studio.sessions || [];
  const session = sessions.find((s) => s.id === studio.currentSessionId) || null;
  const tracks = session?.tracks || [];
  const updateSettings = studio.updateSettings;
  const updateTrack = studio.updateTrack;

  const [user, setUser] = useState(null);
  const [timeOpen, setTimeOpen] = useState(false);
  const [draft, setDraft] = useState({ h: 19, m: 30 });

  const input = String(settings.input || 'USB-C').toUpperCase().includes('USB') ? 'USB-C' : 'INTERNAL MIC';
  const rate = parseInt(settings.sampleRate, 10) === 48 ? 48 : 96;
  const float32 = settings.float32 !== false;
  const masterTape = !!settings.masterTape;
  const reminderOn = !!settings.reminderOn;
  const time = parseTime(settings.reminderTime);
  const days = Array.isArray(settings.reminderDays) ? settings.reminderDays : [];
  const usbFound = Platform.OS === 'ios' || Platform.OS === 'android';
  const onMic = input === 'INTERNAL MIC' || !usbFound;

  useEffect(() => {
    let alive = true;
    currentUser().then((u) => alive && setUser(u || null)).catch(() => alive && setUser(null));
    const off = onAuthChange((u) => setUser(u || null));
    return () => { alive = false; if (typeof off === 'function') off(); };
  }, []);

  useEffect(() => {
    if (onMic && rate > 48 && updateSettings) updateSettings({ sampleRate: 48 });
  }, [onMic, rate]);

  const goDeck = useCallback(() => navigation.navigate('Deck'), [navigation]);

  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 24 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
    onPanResponderRelease: (_, g) => { if (g.dx > 70) goDeck(); },
  }), [goDeck]);

  const buzz = () => { try { Haptics.selectionAsync(); } catch (e) {} };

  const reschedule = async (on, h, m, dayList, oldIds) => {
    for (const id of oldIds || []) {
      try { await cancelReminder(id); } catch (e) {}
    }
    if (!on) return [];
    const body = 'Time to roll tape.';
    const ids = [];
    if (dayList.length === 0) {
      ids.push(await scheduleReminder('Session reminder', body, { hour: h, minute: m }));
    } else {
      for (const d of dayList) {
        ids.push(await scheduleReminder('Session reminder', body, { weekday: WEEKDAY_NUM[d], hour: h, minute: m }));
      }
    }
    return ids.filter(Boolean);
  };

  const applySchedule = async (patch) => {
    const next = { on: reminderOn, h: time.h, m: time.m, days, ...patch };
    try {
      const ids = await reschedule(next.on, next.h, next.m, next.days, settings.reminderIds);
      updateSettings && updateSettings({
        reminderOn: next.on,
        reminderTime: `${pad(next.h)}:${pad(next.m)}`,
        reminderDays: next.days,
        reminderIds: ids,
      });
    } catch (err) {
      Alert.alert('Could not set the reminder', err?.message || 'Try again in a moment.');
    }
  };

  const toggleReminder = async (v) => {
    if (v) {
      let ok = false;
      try { ok = await askNotificationPermission(); } catch (e) { ok = false; }
      if (!ok) {
        updateSettings && updateSettings({ reminderOn: false });
        Alert.alert('Notifications are off for TapeFlow. Turn them on in Settings.');
        return;
      }
    }
    await applySchedule({ on: v });
  };

  const toggleDay = (d) => {
    buzz();
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
    if (reminderOn) applySchedule({ days: next });
    else updateSettings && updateSettings({ reminderDays: next });
  };

  const openTime = () => { setDraft({ h: time.h, m: time.m }); setTimeOpen(true); };
  const confirmTime = () => {
    setTimeOpen(false);
    if (reminderOn) applySchedule({ h: draft.h, m: draft.m });
    else updateSettings && updateSettings({ reminderTime: `${pad(draft.h)}:${pad(draft.m)}` });
  };

  const confirmSignOut = () => {
    Alert.alert(`Sign out of ${user?.email || 'this account'}?`, 'Recordings stay on this phone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: async () => {
        try { await signOut(); } catch (err) { Alert.alert('Could not sign out', err?.message || 'Try again.'); }
      } },
    ]);
  };

  const confirmDeleteAccount = () => {
    Alert.alert('Delete account?', 'This permanently deletes your account. Recordings stay on this phone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await deleteAccount(); } catch (err) { Alert.alert('Could not delete account', err?.message || 'Try again.'); }
      } },
    ]);
  };

  const legend = input === 'USB-C'
    ? (usbFound ? 'USB-C: FOCUSRITE SOLO' : 'No USB-C device found. Using phone mic.')
    : 'INTERNAL MIC';

  const amber = t.accents?.[0] || t.warning;

  const Key = ({ label, icon, onPress }) => (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [styles.key, { backgroundColor: t.accents?.[3] || t.surface, borderColor: t.border, opacity: pressed ? 0.7 : 1 }]}>
      <Ionicons name={icon} size={20} color={amber} />
      <EngravedText size={13} color={t.text}>{label}</EngravedText>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }} {...pan.panHandlers}>
      <ObsidianBackdrop />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: insets.top + 4, paddingBottom: insets.bottom + 24, paddingHorizontal: 20 }} showsVerticalScrollIndicator={false}>
        <View style={styles.top}>
          <View style={{ flex: 1 }}>
            <EngravedText size={12} color={t.textMuted}>{`REAR · SESSION: ${session?.name || 'Untitled 1'}`}</EngravedText>
          </View>
          <Pressable onPress={goDeck} accessibilityRole="button" accessibilityLabel="Flip back to the deck" style={styles.flip} hitSlop={6}>
            <Ionicons name="chevron-back" size={24} color={t.text} />
          </Pressable>
        </View>

        <Section title="INPUT" t={t}>
          <View style={styles.rowCenter}>
            <View style={styles.jackWrap}>
              <View style={[styles.jack, { borderColor: t.textMuted, backgroundColor: t.bg }]}>
                <View style={[styles.jackInner, { backgroundColor: t.border }]} />
              </View>
              <EngravedText size={11} color={t.textMuted}>USB-C</EngravedText>
            </View>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <RotarySelector options={INPUTS} value={input} onChange={(v) => { buzz(); updateSettings && updateSettings({ input: v }); }} size={72} />
            </View>
          </View>
          <View style={[styles.rowCenter, { marginTop: 8 }]}>
            <View style={{ flex: 1 }}>
              <EngravedText size={12} color={input === 'USB-C' && !usbFound ? t.warning : t.textMuted}>{legend}</EngravedText>
            </View>
            <View style={styles.vu}>
              <AppImage source={ART.vuMeter} contentFit="contain" style={{ width: 84, height: 52 }} />
            </View>
          </View>
          <Text style={[t.font.body, { fontSize: 14, lineHeight: 20, color: t.textMuted, marginTop: 8 }]}>
            {`${rate} kHz / ${float32 ? '32-bit float' : '24-bit'} · Phone mic capped at 48 kHz`}
          </Text>
        </Section>

        <Section title="QUALITY" t={t}>
          <View style={styles.rowCenter}>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <RotarySelector options={RATES} value={`${rate} kHz`} onChange={(v) => {
                buzz();
                const r = parseInt(v, 10);
                if (r > 48 && onMic) {
                  Alert.alert('Phone mic capped at 48 kHz', 'Choose a USB-C interface to record at 96 kHz.');
                  return;
                }
                updateSettings && updateSettings({ sampleRate: r });
              }} size={72} />
            </View>
            <View style={{ flex: 1 }}>
              <ToggleSwitch label="32-BIT FLOAT" value={float32} onValueChange={(v) => { buzz(); updateSettings && updateSettings({ float32: v }); }} />
            </View>
          </View>
          {onMic ? (
            <Text style={[t.font.body, { fontSize: 14, lineHeight: 20, color: t.textMuted, marginTop: 8 }]}>
              Sample rate is held at 48 kHz while the phone mic is the input.
            </Text>
          ) : null}
        </Section>

        <Section title="TAPE" t={t}>
          <ToggleSwitch label="MASTER TAPE SOUND" value={masterTape} helper="Adds saturation, hiss and flutter. Off is clean."
            onValueChange={(v) => { buzz(); updateSettings && updateSettings({ masterTape: v }); }} />
          <View style={[styles.rowCenter, { marginTop: 12, justifyContent: 'space-between' }]}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={{ flex: 1, alignItems: 'center' }}>
                <ToggleSwitch compact label={`TRK ${i + 1}`} value={!!tracks[i]?.tapeSound}
                  onValueChange={(v) => { buzz(); updateTrack && updateTrack(i, { tapeSound: v }); }} />
              </View>
            ))}
          </View>
        </Section>

        <Section title="REMINDER" t={t}>
          <ToggleSwitch label="SESSION REMINDER" value={reminderOn} onValueChange={toggleReminder} helper="Stays on this phone." />
          <Pressable onPress={openTime} accessibilityRole="button" style={({ pressed }) => [styles.timeRow, { borderColor: t.border, backgroundColor: t.surface, opacity: pressed ? 0.7 : 1 }]}>
            <Text style={[t.font.label, { color: t.text, fontSize: 15, lineHeight: 20 }]}>{`Remind me at ${pad(time.h)}:${pad(time.m)}`}</Text>
            <Ionicons name="chevron-down" size={18} color={t.textMuted} />
          </Pressable>
          <View style={styles.chips}>
            {DAYS.map((d) => {
              const on = days.includes(d);
              return (
                <Pressable key={d} onPress={() => toggleDay(d)} accessibilityRole="button" accessibilityState={{ selected: on }}
                  style={[styles.chip, { backgroundColor: on ? t.accent : t.surface, borderColor: on ? t.accent : t.border }]}>
                  <Text style={[t.font.label, { fontSize: 13, lineHeight: 17, color: on ? t.onAccent : t.textMuted }]}>{d}</Text>
                </Pressable>
              );
            })}
          </View>
        </Section>

        <View style={[styles.rowCenter, { marginTop: 24, gap: 12 }]}>
          <Key label="SESSIONS" icon="albums-outline" onPress={() => navigation.navigate('Sessions')} />
        </View>

        <View style={[styles.account, { borderColor: t.border, backgroundColor: t.surface }]}>
          <Ionicons name="person-circle-outline" size={28} color={t.textMuted} />
          <View style={{ flex: 1, marginHorizontal: 12 }}>
            {user ? (
              <>
                <EngravedText size={11} color={t.textMuted}>SIGNED IN AS</EngravedText>
                <Text style={[t.font.label, { fontSize: 15, lineHeight: 20, color: t.text }]}>{user.email || user.name}</Text>
              </>
            ) : (
              <EngravedText size={12} color={t.textMuted}>Not signed in</EngravedText>
            )}
          </View>
          {user ? (
            <Pressable onPress={confirmSignOut} accessibilityRole="button" style={styles.textBtn}>
              <Text style={[t.font.label, { fontSize: 15, lineHeight: 20, color: t.accent }]}>Sign out</Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => navigation.navigate('Sign In')} accessibilityRole="button" style={styles.textBtn}>
              <Text style={[t.font.label, { fontSize: 15, lineHeight: 20, color: t.accent }]}>Sign in</Text>
            </Pressable>
          )}
        </View>

        {user ? (
          <Pressable onPress={confirmDeleteAccount} accessibilityRole="button" style={[styles.textBtn, { alignSelf: 'flex-start', marginTop: 8 }]}>
            <Text style={[t.font.label, { fontSize: 15, lineHeight: 20, color: t.danger }]}>Delete account</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <Modal visible={timeOpen} transparent animationType="slide" onRequestClose={() => setTimeOpen(false)}>
        <View style={styles.modalWrap}>
          <View style={[styles.sheet, { backgroundColor: t.surface, borderColor: t.border, paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.sheetHead}>
              <Pressable onPress={() => setTimeOpen(false)} style={styles.textBtn} accessibilityRole="button">
                <Text style={[t.font.label, { fontSize: 17, lineHeight: 22, color: t.textMuted }]}>Cancel</Text>
              </Pressable>
              <EngravedText size={13} color={t.text}>REMIND ME AT</EngravedText>
              <Pressable onPress={confirmTime} style={styles.textBtn} accessibilityRole="button">
                <Text style={[t.font.label, { fontSize: 17, lineHeight: 22, color: t.accent }]}>Done</Text>
              </Pressable>
            </View>
            <View style={[styles.rowCenter, { justifyContent: 'center', gap: 32 }]}>
              {[['h', 24], ['m', 60]].map(([k, mod]) => (
                <View key={k} style={{ alignItems: 'center' }}>
                  <Pressable accessibilityLabel={`Increase ${k === 'h' ? 'hour' : 'minute'}`} style={styles.step}
                    onPress={() => { buzz(); setDraft((d) => ({ ...d, [k]: (d[k] + (k === 'm' ? 5 : 1)) % mod })); }}>
                    <Ionicons name="chevron-up" size={26} color={t.text} />
                  </Pressable>
                  <Text style={[t.font.title, { fontSize: 44, lineHeight: 58, color: amber }]}>{pad(draft[k])}</Text>
                  <Pressable accessibilityLabel={`Decrease ${k === 'h' ? 'hour' : 'minute'}`} style={styles.step}
                    onPress={() => { buzz(); setDraft((d) => ({ ...d, [k]: (d[k] - (k === 'm' ? 5 : 1) + mod) % mod })); }}>
                    <Ionicons name="chevron-down" size={26} color={t.text} />
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  flip: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 12 },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
  rowCenter: { flexDirection: 'row', alignItems: 'center' },
  jackWrap: { alignItems: 'center', gap: 6, width: 88 },
  jack: { width: 56, height: 28, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  jackInner: { width: 36, height: 8, borderRadius: 4 },
  vu: { width: 84, height: 52, alignItems: 'center', justifyContent: 'center' },
  timeRow: { marginTop: 12, minHeight: 48, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chips: { flexDirection: 'row', gap: 8, marginTop: 12 },
  chip: { flex: 1, minHeight: 44, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  key: { flex: 1, height: 56, borderRadius: 14, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  account: { marginTop: 16, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 12, flexDirection: 'row', alignItems: 'center', minHeight: 56 },
  textBtn: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 16 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  step: { width: 56, height: 44, alignItems: 'center', justifyContent: 'center' },
});
