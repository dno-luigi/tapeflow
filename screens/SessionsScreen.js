import React from 'react';
import { View, Text, Pressable, ScrollView, Alert, ActionSheetIOS, Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../ui/theme';
import { spacing } from '../ui/design-tokens';
import NavBar from '../components/NavBar';
import { useStudio } from '../store/StudioContext';
import TapeBox from '../components/Sessions/TapeBox';

function fmt(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

export default function SessionsScreen() {
  const t = useTheme();
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const studio = useStudio() || {};
  const sessions = studio.sessions || [];

  const open = (s) => {
    studio.openSession && studio.openSession(s.id);
    nav.navigate('Deck');
  };

  const doDelete = (s) => {
    Alert.alert('Delete ' + s.name + '? This can\'t be undone.', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => studio.deleteSession && studio.deleteSession(s.id) },
    ]);
  };

  const doRename = (s) => {
    if (Platform.OS === 'ios' && Alert.prompt) {
      Alert.prompt('Rename session', undefined, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Save', onPress: (v) => {
          const n = (v || '').trim();
          if (!n) { Alert.alert('Add a name first', 'A session needs a name.'); return; }
          studio.renameSession && studio.renameSession(s.id, n);
        } },
      ], 'plain-text', s.name);
    } else {
      const n = s.name.replace(/ \(renamed\)$/, '') + ' (renamed)';
      studio.renameSession && studio.renameSession(s.id, n);
      Alert.alert('Renamed', 'Session is now "' + n + '".');
    }
  };

  const doDuplicate = (s) => {
    studio.duplicateSession && studio.duplicateSession(s.id);
  };

  const actions = (s) => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: s.name, options: ['Rename', 'Duplicate', 'Delete', 'Cancel'], destructiveButtonIndex: 2, cancelButtonIndex: 3 },
        (i) => { if (i === 0) doRename(s); else if (i === 1) doDuplicate(s); else if (i === 2) doDelete(s); }
      );
    } else {
      Alert.alert(s.name, undefined, [
        { text: 'Rename', onPress: () => doRename(s) },
        { text: 'Duplicate', onPress: () => doDuplicate(s) },
        { text: 'Delete', style: 'destructive', onPress: () => doDelete(s) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  const createNew = () => {
    const nums = sessions.map((s) => { const m = /^Untitled (\d+)$/.exec(s.name || ''); return m ? Number(m[1]) : 0; });
    const next = Math.max(1, ...nums) + 1;
    studio.createSession && studio.createSession('Untitled ' + next);
    nav.navigate('Deck');
  };

  const totalMB = sessions.reduce((a, s) => a + (Number(s.sizeMB) || 0), 0);
  const gb = (totalMB / 1000).toFixed(1);
  const [big, ...rest] = sessions;
  // Beside the big tile: the first two of the rest. Anything after goes wide underneath.
  const left = rest.slice(0, 2);
  const right = rest.slice(2);

  const props = (s) => ({
    name: s.name,
    meta: fmt(s.duration) + ' · ' + (s.trackCount || 0) + ' tracks · ' + (s.createdLabel || ''),
    size: (s.sizeMB || 0) + ' MB',
    onPress: () => open(s),
    onLongPress: () => actions(s),
  });

  return (
    <View style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top }]}>
      <NavBar
        title="Sessions"
        onBack={() => nav.goBack()}
        right={
          <Pressable onPress={createNew} accessibilityRole="button" accessibilityLabel="New session" style={styles.new}>
            <Text style={[t.font.label, { color: t.accent }]}>New</Text>
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.gutter || 20, paddingTop: 12, paddingBottom: insets.bottom + 24 }}>
        {sessions.length === 0 ? (
          <TapeBox empty name="" meta="No tapes yet. Press record on the deck." size="" tall />
        ) : (
          <View style={styles.grid}>
            <View style={styles.col}>
              <TapeBox {...props(big)} tall />
            </View>
            <View style={styles.col}>
              {left.map((s) => <TapeBox key={s.id} {...props(s)} />)}
            </View>
          </View>
        )}
        {right.length > 0 ? (
          <View style={{ marginTop: 12 }}>
            {right.map((s) => <TapeBox key={s.id} {...props(s)} wide />)}
          </View>
        ) : null}
        <Text style={[t.font.body, { color: t.textMuted, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 24 }]}>
          {sessions.length + ' sessions · ' + gb + ' GB on this phone'}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  new: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', gap: 12 },
  col: { flex: 1, gap: 12 },
});
