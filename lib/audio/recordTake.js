// Recording off the browser's microphone, without expo-audio in the middle.
//
// expo-audio's web recorder works in a browser that has a microphone, but it
// reports every failure as the same thing: AudioModule.web.ts catches whatever
// getUserMedia threw and returns `granted: false`. A page served over plain http
// (where navigator.mediaDevices does not exist at all), a browser that was told
// "block" once, a machine with no input device, and a device another app is
// holding all arrive at the deck as "microphone is off", which is wrong three
// times out of four and leaves nothing to act on.
//
// It also builds a new MediaRecorder on every prepareToRecordAsync and never
// stops the previous stream, and its stop() resolves off a `dataavailable` event
// that some browsers do not fire when the track was already ended.
//
// So the web path is here instead: one stream per recording, a mime type the
// browser admits it can produce, an honest reason when it cannot start, and a
// stop() that always settles. Takes come out in the same shape the file import
// produces — a blob URL the mixer already knows how to play — so nothing
// downstream changes.
//
// iOS and Android keep using expo-audio, where the microphone is always there.
import { Platform } from 'react-native';

const isWeb = () => Platform.OS === 'web';

// Safari cannot produce webm, Chrome cannot produce mp4 on every platform, and
// opus is what a field recorder wants when it is available.
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
];

let session = null;

function fail(code, short, message) {
  const err = new Error(message);
  err.code = code;
  err.short = short;
  return err;
}

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  for (let i = 0; i < MIME_CANDIDATES.length; i += 1) {
    if (MediaRecorder.isTypeSupported(MIME_CANDIDATES[i])) return MIME_CANDIDATES[i];
  }
  return '';
}

// Why the microphone cannot be used here at all, or null if it is worth asking
// the browser. Checked before the request so a plain-http page is told so
// instead of being blamed for a permission it was never able to grant.
export function micUnavailableReason() {
  if (!isWeb()) return null;
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      code: 'no-window',
      short: 'NO MICROPHONE HERE',
      message: 'The microphone is not available in this app.',
    };
  }
  if (window.isSecureContext === false) {
    return {
      code: 'insecure',
      short: 'MIC NEEDS HTTPS',
      message:
        'Browsers only hand a page the microphone over https, or on localhost. This page is on plain http, so no browser can give it a microphone. Open the https deployment, or run the app on localhost.',
    };
  }
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    return {
      code: 'no-api',
      short: 'THIS BROWSER CANNOT RECORD',
      message:
        'This browser does not expose the microphone API, so the deck cannot record here. Chrome, Edge, Firefox and Safari all can.',
    };
  }
  if (typeof MediaRecorder === 'undefined') {
    return {
      code: 'no-recorder',
      short: 'THIS BROWSER CANNOT RECORD',
      message:
        'This browser has no MediaRecorder, so there is nothing to capture audio with. Chrome, Edge, Firefox and Safari all have it.',
    };
  }
  return null;
}

// getUserMedia's failures, said in terms a person can act on.
function describe(e, fallbackMessage) {
  const name = (e && e.name) || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return fail(
      'denied',
      'MIC BLOCKED · ALLOW IT IN THE ADDRESS BAR',
      'The browser refused the microphone. Allow it for this site (the icon at the left of the address bar, or the site settings), then press REC again.',
    );
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return fail(
      'no-device',
      'NO MICROPHONE FOUND',
      'No microphone is connected to this device, so there is nothing to record from. Plug one in, or bring audio in with the upload key at the top of the deck.',
    );
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return fail(
      'busy',
      'MICROPHONE IS BUSY',
      'Something else is holding the microphone. Close the other app or tab that is recording and press REC again.',
    );
  }
  if (name === 'AbortError') {
    return fail('aborted', 'MIC START WAS CANCELLED', 'The browser cancelled the microphone. Press REC again.');
  }
  return fail(
    'unknown',
    'MICROPHONE FAILED',
    fallbackMessage || (e && e.message) || 'The microphone could not be opened.',
  );
}

export function canRecordFromMic() {
  return isWeb() && typeof MediaRecorder !== 'undefined' && micUnavailableReason() === null;
}

export function micTakeActive() {
  return !!session;
}

/**
 * Opens the microphone and starts filling a take. Rejects with `{ code, short,
 * message }` — `short` is sized for the deck's legend, `message` for a dialog.
 */
export async function startMicTake() {
  if (!isWeb()) {
    throw fail('not-web', 'NO MIC ON THIS PLATFORM', 'The microphone is recorded through expo-audio on iOS and Android.');
  }
  const blocked = micUnavailableReason();
  if (blocked) throw blocked;
  // One stream at a time: a second REC must not leave the first one open, and
  // on a phone two open inputs can make the second request fail outright.
  if (session) await stopMicTake().catch(() => {});

  // No echo cancellation, noise suppression or auto gain: this is a field
  // recorder, and the tape's own speed and mixing effects are the point. They
  // are hints, not requirements, so a device that refuses them still records.
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (e) {
    if (e && (e.name === 'OverconstrainedError' || e.name === 'TypeError')) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e2) {
        throw describe(e2);
      }
    } else {
      throw describe(e);
    }
  }

  const mimeType = pickMimeType();
  let recorder;
  try {
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  } catch (e) {
    try { stream.getTracks().forEach((track) => track.stop()); } catch (x) { /* already gone */ }
    throw describe(e, 'The browser could not open a recorder for the microphone.');
  }

  const chunks = [];
  recorder.addEventListener('dataavailable', (e) => {
    if (e.data && e.data.size) chunks.push(e.data);
  });

  try {
    // A timeslice, not a single blob at stop: a tab that is closed mid-take
    // still has the audio it already produced.
    recorder.start(500);
  } catch (e) {
    try { stream.getTracks().forEach((track) => track.stop()); } catch (x) { /* already gone */ }
    throw describe(e, 'The browser refused to start recording. If another tab is recording, close it.');
  }

  session = {
    stream,
    recorder,
    chunks,
    mimeType: mimeType || recorder.mimeType || 'audio/webm',
    startedAt: Date.now(),
  };
  return { mimeType: session.mimeType };
}

/**
 * Stops the microphone and resolves `{ uri, duration, size, mimeType }`, or null
 * when nothing was captured. Never rejects and never hangs: a browser that does
 * not fire `dataavailable` on stop still gets a promise that settles.
 */
export function stopMicTake() {
  const s = session;
  session = null;
  if (!s) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      // Releases the browser's recording indicator even when the take is empty.
      try { s.stream.getTracks().forEach((track) => track.stop()); } catch (e) { /* already stopped */ }
      let uri = null;
      let size = 0;
      let type = s.mimeType;
      try {
        const blob = new Blob(s.chunks, { type: s.mimeType });
        size = blob.size;
        type = blob.type || s.mimeType;
        if (size) uri = URL.createObjectURL(blob);
      } catch (e) {
        uri = null;
      }
      resolve(uri ? { uri, size, mimeType: type, duration: Math.max(0, (Date.now() - s.startedAt) / 1000) } : null);
    };
    s.recorder.addEventListener('stop', finish, { once: true });
    s.recorder.addEventListener('error', finish, { once: true });
    try {
      s.recorder.stop();
    } catch (e) {
      finish();
    }
    setTimeout(finish, 2000);
  });
}

export default { canRecordFromMic, micUnavailableReason, startMicTake, stopMicTake, micTakeActive };
