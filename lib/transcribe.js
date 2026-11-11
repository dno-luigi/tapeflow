// Turning a take into text.
//
// A take's audio lives on this device, so it is uploaded to the app's own Worker
// (worker/transcribe.js), which forwards it to the configured speech-to-text
// service. The provider's key stays on the server: a key in the browser is a key
// given away.
import { Platform } from 'react-native';
import { API_BASE } from './api';
import { getToken } from './auth';
import { takeBlob } from './audio/takeStore';

export function canTranscribe() {
  return Platform.OS === 'web' && typeof FormData !== 'undefined';
}

// Each refusal means something different to the person holding the phone, so each
// gets its own sentence rather than one "could not transcribe".
const MESSAGES = {
  sign_in_required: 'Sign in to transcribe a take.',
  transcription_not_configured: 'Transcription is not set up on this server yet.',
  audio_too_large: 'That take is too long to transcribe in one go.',
  audio_required: 'That take has no audio to send.',
  bad_transcription: 'The service returned no words for that take.',
  transcription_failed: 'The transcription service could not read that take.',
};

const fail = (code, message) => {
  const err = new Error(message || MESSAGES[code] || 'Could not transcribe that take.');
  err.code = code;
  return err;
};

/**
 * Uploads one take and resolves with its transcript.
 *
 * Throws an Error carrying `.code`, so a screen can say what happened instead of
 * a single "failed".
 */
export async function transcribeTake(take) {
  if (!canTranscribe()) throw fail('unsupported', 'Transcription is not available in this build.');
  if (!take || !take.id) throw fail('audio_required', 'Pick a take first.');

  const token = await getToken();
  if (!token) throw fail('sign_in_required');

  const blob = await takeBlob(take.id);
  if (!blob) throw fail('audio_required', 'That take’s audio is not on this device any more.');

  const body = new FormData();
  body.append('audio', blob, take.id + '.wav');

  let res;
  try {
    res = await fetch(API_BASE + '/api/transcribe', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body,
    });
  } catch (e) {
    throw fail('network', 'Could not reach the server. Check your connection and try again.');
  }

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  if (!res.ok || !data || data.ok !== true) {
    const code = (data && data.error) || 'transcription_failed';
    throw fail(code, data && data.details);
  }
  return String(data.text || '').trim();
}

export default { transcribeTake, canTranscribe };
