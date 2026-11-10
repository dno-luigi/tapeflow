import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveRecord, updateRecord, deleteRecord } from '../lib/db';

const STORAGE_KEY = 'studio:v1';

const DEFAULT_SETTINGS = {
  input: 'Built-in microphone',
  sampleRate: 96000,
  // 24-bit PCM, not 32-bit float: a float WAV is the better recording, but it is
  // the one format a browser's own player can refuse to play, and a track that
  // plays silence is worse than a track with two bits fewer.
  float32: false,
  masterTape: false,
  reminderOn: false,
  reminderTime: { hour: 19, minute: 0 },
  reminderDays: [1, 2, 3, 4, 5],
  reminderId: null,
};

const DEFAULT_TRANSPORT = { mode: 'stopped', position: 0, direction: 1 };

function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function createdLabel() {
  const d = new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return months[d.getMonth()] + ' ' + d.getDate() + ', ' + hh + ':' + mm;
}

function emptyTrack() {
  return { armed: false, tapeSound: false, level: 0.75, pan: 0, activeTakeId: null, takes: [] };
}

function emptySession(name) {
  return {
    id: uid('s'),
    name: name || 'Untitled reel',
    duration: 0,
    trackCount: 4,
    sizeMB: 0,
    createdLabel: createdLabel(),
    tracks: [emptyTrack(), emptyTrack(), emptyTrack(), emptyTrack()],
    cues: [],
  };
}

function recompute(session) {
  const tracks = session.tracks || [];
  let takeCount = 0;
  let longest = 0;
  tracks.forEach((tr) => {
    (tr.takes || []).forEach((tk) => {
      takeCount += 1;
      if ((tk.duration || 0) > longest) longest = tk.duration || 0;
    });
  });
  const sizeMB = Math.round(takeCount * longest * 0.35 * 10) / 10;
  return {
    ...session,
    duration: Math.max(session.duration || 0, longest),
    trackCount: tracks.length,
    sizeMB,
  };
}

// Audio files live on this phone only, so their paths are not sent to the account.
function stripUris(tracks) {
  return (tracks || []).map((tr) => ({
    ...tr,
    takes: (tr.takes || []).map((tk) => {
      const copy = { ...tk };
      delete copy.uri;
      return copy;
    }),
  }));
}

function toRow(s) {
  return {
    local_id: s.id,
    name: s.name,
    duration: s.duration,
    track_count: s.trackCount,
    size_mb: s.sizeMB,
    created_label: s.createdLabel,
    tracks: stripUris(s.tracks),
    cues: s.cues,
  };
}

const StudioContext = createContext({
  ready: false,
  onboardingDone: false,
  completeOnboarding: () => {},
  sessions: [],
  currentSessionId: null,
  currentSession: null,
  transport: DEFAULT_TRANSPORT,
  setTransport: () => {},
  settings: DEFAULT_SETTINGS,
  createSession: () => null,
  openSession: () => {},
  renameSession: () => {},
  duplicateSession: () => null,
  deleteSession: () => {},
  setActiveTake: () => {},
  deleteTake: () => {},
  addTake: () => {},
  bounceTakes: () => {},
  addCue: () => {},
  removeCue: () => {},
  updateTrack: () => {},
  updateSettings: () => {},
});

export function StudioProvider({ children }) {
  const [ready, setReady] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [transport, setTransportState] = useState(DEFAULT_TRANSPORT);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const remoteIds = useRef({});
  const syncTimers = useRef({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const data = raw ? JSON.parse(raw) : null;
        if (!alive) return;
        if (data && typeof data === 'object') {
          setOnboardingDone(!!data.onboardingDone);
          const list = Array.isArray(data.sessions) ? data.sessions : [];
          if (list.length > 0) {
            setSessions(list);
            setCurrentSessionId(data.currentSessionId && list.some((s) => s.id === data.currentSessionId) ? data.currentSessionId : list[0].id);
          } else {
            const first = emptySession('Reel 1');
            setSessions([first]);
            setCurrentSessionId(first.id);
          }
          setSettings({ ...DEFAULT_SETTINGS, ...(data.settings || {}) });
          remoteIds.current = data.remoteIds && typeof data.remoteIds === 'object' ? data.remoteIds : {};
        } else {
          const first = emptySession('Reel 1');
          setSessions([first]);
          setCurrentSessionId(first.id);
        }
      } catch (e) {
        const first = emptySession('Reel 1');
        setSessions([first]);
        setCurrentSessionId(first.id);
      }
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const payload = JSON.stringify({
      onboardingDone,
      sessions,
      currentSessionId,
      settings,
      remoteIds: remoteIds.current,
    });
    AsyncStorage.setItem(STORAGE_KEY, payload).catch(() => {});
  }, [ready, onboardingDone, sessions, currentSessionId, settings]);

  const scheduleSync = useCallback((session) => {
    if (!session) return;
    const id = session.id;
    if (syncTimers.current[id]) clearTimeout(syncTimers.current[id]);
    syncTimers.current[id] = setTimeout(async () => {
      try {
        const remote = remoteIds.current[id];
        if (remote) {
          await updateRecord('sessions', remote, toRow(session));
        } else {
          const row = await saveRecord('sessions', toRow(session));
          if (row && row.id) remoteIds.current[id] = row.id;
        }
      } catch (e) {
        // The device copy stays authoritative; the next change retries the sync.
      }
    }, 800);
  }, []);

  useEffect(() => {
    const timers = syncTimers.current;
    return () => {
      Object.keys(timers).forEach((k) => clearTimeout(timers[k]));
    };
  }, []);

  const patchSession = useCallback(
    (id, fn) => {
      let changed = null;
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== id) return s;
          changed = recompute(fn(s));
          return changed;
        })
      );
      if (changed) scheduleSync(changed);
    },
    [scheduleSync]
  );

  const completeOnboarding = useCallback(() => setOnboardingDone(true), []);

  const setTransport = useCallback((patch) => {
    setTransportState((prev) => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }));
  }, []);

  const createSession = useCallback(
    (name) => {
      const s = emptySession((name || '').trim() || 'Untitled reel');
      setSessions((prev) => [s, ...prev]);
      setCurrentSessionId(s.id);
      setTransportState(DEFAULT_TRANSPORT);
      scheduleSync(s);
      return s.id;
    },
    [scheduleSync]
  );

  const openSession = useCallback((id) => {
    setCurrentSessionId(id);
    setTransportState(DEFAULT_TRANSPORT);
  }, []);

  const renameSession = useCallback(
    (id, name) => {
      const clean = (name || '').trim();
      if (!clean) return;
      patchSession(id, (s) => ({ ...s, name: clean }));
    },
    [patchSession]
  );

  const duplicateSession = useCallback(
    (id) => {
      let copy = null;
      setSessions((prev) => {
        const src = prev.find((s) => s.id === id);
        if (!src) return prev;
        copy = {
          ...JSON.parse(JSON.stringify(src)),
          id: uid('s'),
          name: src.name + ' copy',
          createdLabel: createdLabel(),
        };
        const idx = prev.findIndex((s) => s.id === id);
        const next = prev.slice();
        next.splice(idx + 1, 0, copy);
        return next;
      });
      if (copy) scheduleSync(copy);
      return copy ? copy.id : null;
    },
    [scheduleSync]
  );

  const deleteSession = useCallback(
    (id) => {
      const remote = remoteIds.current[id];
      if (syncTimers.current[id]) clearTimeout(syncTimers.current[id]);
      delete remoteIds.current[id];
      if (remote) {
        deleteRecord('sessions', remote).catch(() => {});
      }
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id);
        if (next.length === 0) {
          const fresh = emptySession('Reel 1');
          setCurrentSessionId(fresh.id);
          return [fresh];
        }
        setCurrentSessionId((cur) => (cur === id ? next[0].id : cur));
        return next;
      });
    },
    []
  );

  const updateTrack = useCallback(
    (index, patch, sessionId) => {
      const id = sessionId || currentSessionId;
      if (!id) return;
      patchSession(id, (s) => ({
        ...s,
        tracks: s.tracks.map((tr, i) => (i === index ? { ...tr, ...patch } : tr)),
      }));
    },
    [currentSessionId, patchSession]
  );

  const setActiveTake = useCallback(
    (trackIndex, takeId, sessionId) => {
      const id = sessionId || currentSessionId;
      if (!id) return;
      patchSession(id, (s) => ({
        ...s,
        tracks: s.tracks.map((tr, i) =>
          i === trackIndex && tr.takes.some((tk) => tk.id === takeId) ? { ...tr, activeTakeId: takeId } : tr
        ),
      }));
    },
    [currentSessionId, patchSession]
  );

  // extra: { uri, start } — the recorded audio file and where on the tape it begins.
  const addTake = useCallback(
    (trackIndex, duration, sessionId, extra) => {
      const id = sessionId || currentSessionId;
      if (!id) return;
      const info = extra || {};
      patchSession(id, (s) => ({
        ...s,
        tracks: s.tracks.map((tr, i) => {
          if (i !== trackIndex) return tr;
          const n = tr.takes.reduce((m, tk) => Math.max(m, tk.n || 0), 0) + 1;
          const take = {
            // The caller can name the take, so the audio it is about to store can
            // be filed under that same name.
            id: info.id || uid('t'),
            n,
            duration: Math.max(0, Number(duration) || 0),
            start: Math.max(0, Number(info.start) || 0),
            uri: info.uri || null,
            // The peak the microphone actually delivered, so a take that captured
            // nothing can say so instead of looking like a take.
            peak: typeof info.peak === 'number' ? info.peak : null,
            createdLabel: createdLabel(),
          };
          return { ...tr, takes: [...tr.takes, take], activeTakeId: take.id };
        }),
      }));
    },
    [currentSessionId, patchSession]
  );

  const deleteTake = useCallback(
    (trackIndex, takeId, sessionId) => {
      const id = sessionId || currentSessionId;
      if (!id) return;
      patchSession(id, (s) => ({
        ...s,
        tracks: s.tracks.map((tr, i) => {
          if (i !== trackIndex) return tr;
          const takes = tr.takes.filter((tk) => tk.id !== takeId);
          const activeTakeId =
            tr.activeTakeId === takeId ? (takes.length ? takes[takes.length - 1].id : null) : tr.activeTakeId;
          return { ...tr, takes, activeTakeId };
        }),
      }));
    },
    [currentSessionId, patchSession]
  );

  const bounceTakes = useCallback(
    (trackIndex, sessionId) => {
      const id = sessionId || currentSessionId;
      if (!id) return;
      patchSession(id, (s) => ({
        ...s,
        tracks: s.tracks.map((tr, i) => {
          if (i !== trackIndex || tr.takes.length < 2) return tr;
          const active = tr.takes.find((tk) => tk.id === tr.activeTakeId) || tr.takes[tr.takes.length - 1];
          return { ...tr, takes: [{ ...active, n: 1 }], activeTakeId: active.id };
        }),
      }));
    },
    [currentSessionId, patchSession]
  );

  const addCue = useCallback(
    (position, sessionId) => {
      const id = sessionId || currentSessionId;
      if (!id) return;
      const pos = Math.max(0, Number(position) || 0);
      patchSession(id, (s) => {
        const n = (s.cues || []).length + 1;
        const cue = { id: uid('c'), position: pos, label: 'Cue ' + n };
        const cues = [...(s.cues || []), cue].sort((a, b) => a.position - b.position);
        return { ...s, cues };
      });
    },
    [currentSessionId, patchSession]
  );

  const removeCue = useCallback(
    (cueId, sessionId) => {
      const id = sessionId || currentSessionId;
      if (!id) return;
      patchSession(id, (s) => ({ ...s, cues: (s.cues || []).filter((c) => c.id !== cueId) }));
    },
    [currentSessionId, patchSession]
  );

  const updateSettings = useCallback((patch) => {
    setSettings((prev) => ({ ...prev, ...(patch || {}) }));
  }, []);

  const currentSession = useMemo(
    () => sessions.find((s) => s.id === currentSessionId) || null,
    [sessions, currentSessionId]
  );

  const value = useMemo(
    () => ({
      ready,
      onboardingDone,
      completeOnboarding,
      sessions,
      currentSessionId,
      currentSession,
      transport,
      setTransport,
      settings,
      createSession,
      openSession,
      renameSession,
      duplicateSession,
      deleteSession,
      setActiveTake,
      deleteTake,
      addTake,
      bounceTakes,
      addCue,
      removeCue,
      updateTrack,
      updateSettings,
    }),
    [
      ready,
      onboardingDone,
      completeOnboarding,
      sessions,
      currentSessionId,
      currentSession,
      transport,
      setTransport,
      settings,
      createSession,
      openSession,
      renameSession,
      duplicateSession,
      deleteSession,
      setActiveTake,
      deleteTake,
      addTake,
      bounceTakes,
      addCue,
      removeCue,
      updateTrack,
      updateSettings,
    ]
  );

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export const AppStoreProvider = StudioProvider;

export function useStudio() {
  return useContext(StudioContext);
}
