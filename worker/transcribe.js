/**
 * Speech to text for a take.
 *
 * The browser never holds the provider's key. A take's audio is uploaded to this
 * Worker, which forwards it with the owner's key to a transcription endpoint. The
 * endpoint is configurable because the shape below is the common
 * OpenAI-compatible one, and most services offer it; a provider with a different
 * handshake is a change to the request built here and nothing else.
 *
 *   ASR_URL      full endpoint (default https://api.openai.com/v1/audio/transcriptions)
 *   ASR_MODEL    name sent as `model` (default whisper-1)
 *   ASR_API_KEY  bearer token for the provider. Without it this answers 501 and
 *                the app says transcription is not set up, rather than failing
 *                in a way that looks like the take is broken.
 *
 * An account is required. An unauthenticated route that spends the owner's key
 * on strangers' uploads is an open proxy.
 */
const MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_URL = 'https://api.openai.com/v1/audio/transcriptions';
const DEFAULT_MODEL = 'whisper-1';
const MAX_DETAIL = 300;

export const LIMITS = { bytes: MAX_BYTES };
export const DEFAULTS = { url: DEFAULT_URL, model: DEFAULT_MODEL };

/** Whether an upload of this size is refused. */
export function isTooLarge(bytes) {
  return typeof bytes === 'number' && bytes > MAX_BYTES;
}

// The route answers with a status and a body; the router wraps it in the app's
// JSON and CORS headers, so there is one place that knows about headers.
function refusal(status, error, details) {
  return { status, body: { ok: false, error, details: details || error } };
}

function textFrom(data) {
  if (!data || typeof data !== 'object') return '';
  if (typeof data.text === 'string') return data.text;
  if (typeof data.transcript === 'string') return data.transcript;
  if (data.result && typeof data.result.text === 'string') return data.result.text;
  return '';
}

export async function transcribeTake(request, env, user) {
  if (!user) return refusal(401, 'sign_in_required', 'Sign in to transcribe a take.');

  const key = env && env.ASR_API_KEY;
  if (!key) {
    return refusal(
      501,
      'transcription_not_configured',
      'Transcription is not set up. Add an ASR_API_KEY secret to the Worker and try again.'
    );
  }

  let form = null;
  try {
    form = await request.formData();
  } catch (e) {
    return refusal(400, 'bad_request', 'Send the take as a form upload.');
  }

  const file = form.get('audio') || form.get('file');
  if (!file || typeof file.size !== 'number' || !file.size) {
    return refusal(400, 'audio_required', 'That take has no audio to send.');
  }
  if (isTooLarge(file.size)) {
    return refusal(413, 'audio_too_large', 'That take is too long to transcribe in one go.');
  }

  const language = String(form.get('language') || '').trim();
  const upstream = new FormData();
  upstream.append('file', file, (file.name || 'take') + '');
  upstream.append('model', String((env && env.ASR_MODEL) || DEFAULT_MODEL));
  upstream.append('response_format', 'json');
  if (language) upstream.append('language', language);

  let res;
  try {
    res = await fetch((env && env.ASR_URL) || DEFAULT_URL, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + key },
      body: upstream,
    });
  } catch (e) {
    // The provider was unreachable, which is not the take's fault.
    return refusal(502, 'transcription_failed', 'The transcription service could not be reached.');
  }

  if (!res.ok) {
    let detail = '';
    try {
      detail = String(await res.text()).slice(0, MAX_DETAIL);
    } catch (e) {
      detail = '';
    }
    return refusal(
      502,
      'transcription_failed',
      'The transcription service answered ' + res.status + (detail ? ': ' + detail : '.')
    );
  }

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  const text = textFrom(data).trim();
  if (!text) {
    return refusal(502, 'bad_transcription', 'The transcription service returned no words for that take.');
  }

  return { status: 200, body: { ok: true, text } };
}

export default { transcribeTake, isTooLarge, LIMITS, DEFAULTS };
