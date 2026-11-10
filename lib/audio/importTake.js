// Taking audio off a file instead of off a microphone.
//
// The web recorder is expo-audio over the browser's MediaRecorder, which needs a
// real input device. A machine or browser with none reports getUserMedia as
// NotFoundError, and there is nothing the deck can do about that except say so —
// so this is the other way in: pick an audio file and it becomes a take, exactly
// like a recording, with the same wheel, effects and mixing afterwards.
//
// Web only on purpose. On iOS and Android the microphone is always there.
import { Platform } from 'react-native';

export function canImportAudio() {
  return Platform.OS === 'web' && typeof document !== 'undefined';
}

// Reads a blob URL's duration. MediaRecorder output has no reliable header
// duration, and a file that will not report one still plays, so an unknown
// length is 0 here and the caller decides what to do with it.
function probeDuration(uri) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', () => done(Number.isFinite(audio.duration) ? audio.duration : 0), { once: true });
    audio.addEventListener('error', () => done(0), { once: true });
    // Some containers never fire loadedmetadata; a take with an unknown length
    // is better than a picker that never returns.
    setTimeout(() => done(Number.isFinite(audio.duration) ? audio.duration : 0), 3000);
    audio.src = uri;
  });
}

/**
 * Ask for an audio file. Resolves `{ uri, name, duration }` where `uri` is a
 * blob URL playable by the mixer; rejects with `code: 'cancelled'` when the
 * picker was dismissed.
 */
export function pickAudioFile() {
  if (!canImportAudio()) {
    return Promise.reject(new Error('Importing audio is only available in the browser.'));
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.setAttribute('data-tapeflow-import', '1');
    input.style.position = 'fixed';
    input.style.left = '-10000px';
    document.body.appendChild(input);

    let settled = false;
    const cleanup = () => {
      try {
        input.remove();
      } catch (e) {
        /* already gone */
      }
    };
    const cancelled = () => {
      if (settled) return;
      settled = true;
      cleanup();
      const err = new Error('Nothing chosen.');
      err.code = 'cancelled';
      reject(err);
    };

    input.addEventListener('cancel', cancelled);
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) {
        cancelled();
        return;
      }
      if (settled) return;
      settled = true;
      cleanup();
      try {
        const uri = URL.createObjectURL(file);
        const duration = await probeDuration(uri);
        resolve({ uri, name: file.name || 'Imported audio', duration });
      } catch (e) {
        reject(e);
      }
    });

    input.click();
  });
}

export default { pickAudioFile, canImportAudio };
