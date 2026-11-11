// The transcription route.
//
// The interesting failures are the ones a person can act on: not signed in, no
// key on the server, nothing to send, too much to send, a service that answers
// with no words. Each has its own status and its own code, and the app says each
// one differently. The provider shape is exercised with a stub, so a change to
// the request fields fails here instead of at the first real upload.
import test from 'node:test';
import assert from 'node:assert/strict';
import { transcribeTake, isTooLarge, LIMITS, DEFAULTS } from '../worker/transcribe.js';

const USER = { id: 'usr_1', email: 'a@b.test' };

function upload(names, extra) {
  const form = new FormData();
  (names || ['audio']).forEach((name) => {
    form.append(name, new Blob([new Uint8Array(2048)], { type: 'audio/wav' }), 'take.wav');
  });
  if (extra) Object.keys(extra).forEach((k) => form.append(k, extra[k]));
  return new Request('https://app.test/api/transcribe', { method: 'POST', body: form });
}

async function withFetch(reply, run) {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), init });
    return reply(url, init);
  };
  try {
    const result = await run();
    return { result, seen };
  } finally {
    globalThis.fetch = real;
  }
}

const jsonReply = (body) => async () => new Response(JSON.stringify(body), { status: 200 });

test('a stranger cannot spend the server key', async () => {
  const out = await transcribeTake(upload(), { ASR_API_KEY: 'k' }, null);
  assert.equal(out.status, 401);
  assert.equal(out.body.error, 'sign_in_required');
});

test('without a provider key the route says it is not set up', async () => {
  const out = await transcribeTake(upload(), {}, USER);
  assert.equal(out.status, 501);
  assert.equal(out.body.error, 'transcription_not_configured');
});

test('a take with no audio is refused before anything is sent', async () => {
  const empty = new Request('https://app.test/api/transcribe', { method: 'POST', body: new FormData() });
  const { result, seen } = await withFetch(jsonReply({ text: 'x' }), () =>
    transcribeTake(empty, { ASR_API_KEY: 'k' }, USER)
  );
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'audio_required');
  assert.equal(seen.length, 0);
});

test('an upload over the limit is refused', () => {
  assert.equal(isTooLarge(0), false);
  assert.equal(isTooLarge(LIMITS.bytes), false);
  assert.equal(isTooLarge(LIMITS.bytes + 1), true);
});

test('the take is forwarded with the key, the model and the language', async () => {
  const { result, seen } = await withFetch(jsonReply({ text: '  hello there  ' }), () =>
    transcribeTake(upload(['audio'], { language: 'en' }), { ASR_API_KEY: 'secret-key', ASR_MODEL: 'asr-2' }, USER)
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, text: 'hello there' });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, DEFAULTS.url);
  assert.equal(seen[0].init.headers.authorization, 'Bearer secret-key');

  const sent = seen[0].init.body;
  assert.equal(sent.get('model'), 'asr-2');
  assert.equal(sent.get('response_format'), 'json');
  assert.equal(sent.get('language'), 'en');
  const file = sent.get('file');
  assert.equal(file.size, 2048);
  assert.equal(file.type, 'audio/wav');
});

test('the endpoint and model can be pointed at another service', async () => {
  const { result, seen } = await withFetch(jsonReply({ transcript: 'from another service' }), () =>
    transcribeTake(upload(), { ASR_API_KEY: 'k', ASR_URL: 'https://asr.test/v1/listen' }, USER)
  );
  assert.equal(result.body.text, 'from another service');
  assert.equal(seen[0].url, 'https://asr.test/v1/listen');
  assert.equal(seen[0].init.body.get('model'), DEFAULTS.model);
  assert.equal(seen[0].init.body.get('language'), null);
});

test('a provider refusal is reported with its status, not as an empty transcript', async () => {
  const { result } = await withFetch(async () => new Response('quota exceeded', { status: 429 }), () =>
    transcribeTake(upload(), { ASR_API_KEY: 'k' }, USER)
  );
  assert.equal(result.status, 502);
  assert.equal(result.body.error, 'transcription_failed');
  assert.match(result.body.details, /429/);
  assert.match(result.body.details, /quota exceeded/);
});

test('a provider that is unreachable is not blamed on the take', async () => {
  const { result } = await withFetch(async () => { throw new Error('dns'); }, () =>
    transcribeTake(upload(), { ASR_API_KEY: 'k' }, USER)
  );
  assert.equal(result.status, 502);
  assert.match(result.body.details, /could not be reached/);
});

test('a reply with no words says so', async () => {
  const { result } = await withFetch(jsonReply({ text: '   ' }), () => transcribeTake(upload(), { ASR_API_KEY: 'k' }, USER));
  assert.equal(result.status, 502);
  assert.equal(result.body.error, 'bad_transcription');
});
