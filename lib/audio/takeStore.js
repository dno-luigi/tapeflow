// Take audio that survives the page.
//
// A recorded take was kept in a blob URL, and a blob URL only lives as long as
// the page that made it. Reload the deck — or let a deployment reload it — and
// every track still says PLAYS while its player has nothing to play. A recording
// that cannot be heard tomorrow is not a recording, so the audio is written to
// the device the moment a take is saved and read back on the next load.
//
// The WAV blobs are already lossless and self-contained, so they are stored as
// they are. IndexedDB is the only place a browser can keep a file of this size;
// localStorage tops out around five megabytes and is not where megabytes of PCM
// belong.
const DB_NAME = 'tapeflow-audio';
const DB_VERSION = 1;
const STORE = 'takes';

// take id -> object URL made in this page. Never the take's own field: that blob
// URL may belong to a page load that no longer exists.
const urls = new Map();

let dbPromise = null;

const canStore = () => typeof window !== 'undefined' && typeof indexedDB !== 'undefined';

function openDb() {
  if (!canStore()) return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      let request = null;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        resolve(null);
        return;
      }
      request.onupgradeneeded = () => {
        try {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        } catch (e) {
          /* an older schema with the store already there */
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
  }
  return dbPromise;
}

async function fetchBlob(uri) {
  try {
    const res = await fetch(uri);
    if (!res.ok) return null;
    return await res.blob();
  } catch (e) {
    return null;
  }
}

/**
 * Writes a take's audio to the device, and remembers it for this page.
 * Called once, right after the take is saved. Failure is not fatal: the take
 * still plays for as long as this page lives.
 */
export async function rememberTakeAudio(takeId, uri) {
  if (!takeId || !uri) return false;
  urls.set(takeId, uri);
  if (!canStore()) return false;
  const blob = await fetchBlob(uri);
  if (!blob || !blob.size) return false;
  const db = await openDb();
  if (!db) return false;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, takeId);
    return true;
  } catch (e) {
    // A full quota, or a private-mode browser that refuses storage.
    return false;
  }
}

/** The URL this page should play a take from, or null if the audio is gone. */
export async function loadTakeAudio(takeId) {
  if (!takeId) return null;
  if (urls.has(takeId)) return urls.get(takeId);
  const db = await openDb();
  if (!db) return null;
  const blob = await new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(takeId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
  if (!blob || !blob.size) return null;
  let url = null;
  try {
    url = URL.createObjectURL(blob);
  } catch (e) {
    return null;
  }
  urls.set(takeId, url);
  return url;
}

/**
 * The URI to actually play for a take.
 *
 * The stored copy wins whenever this page has one, because the take's own `uri`
 * may be a blob URL from a page that has since gone.
 */
export function resolveTakeUri(take) {
  if (!take) return null;
  const known = take.id ? urls.get(take.id) : null;
  if (known) return known;
  return take.uri || null;
}

/**
 * Reads every take's audio back off the device after a load.
 *
 * Resolves with how many takes were recovered. This deliberately does not touch
 * the session state: the mixer asks `resolveTakeUri` on every tick, so the tape
 * simply starts sounding once the audio is back, with no re-render in between.
 */
export async function hydrateTakeAudio(sessions) {
  if (!canStore()) return 0;
  const takes = [];
  (sessions || []).forEach((session) => {
    (session.tracks || []).forEach((tr) => {
      (tr.takes || []).forEach((take) => {
        if (take && take.id && !urls.has(take.id)) takes.push(take);
      });
    });
  });
  let restored = 0;
  await Promise.all(
    takes.map(async (take) => {
      const url = await loadTakeAudio(take.id);
      if (url) restored += 1;
    })
  );
  return restored;
}

/** True when this take's audio can be found on this page right now. */
export function takeAudioReady(take) {
  return !!(take && take.id && urls.get(take.id));
}

export default { rememberTakeAudio, loadTakeAudio, resolveTakeUri, hydrateTakeAudio, takeAudioReady };
