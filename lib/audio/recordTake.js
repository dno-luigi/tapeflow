// Recording off the browser's microphone, at full quality.
//
// This used to lean on MediaRecorder, which was the wrong tool twice over. Its
// output is lossy Opus (a memo format, not a recorder format), it decides its own
// sample rate, and its header carries no reliable duration — so a take was only
// ever as good as the encoder felt like being that day.
//
// A field recorder records what the microphone heard. So the browser path now
// takes the raw samples: the microphone goes into an AudioContext at the sample
// rate the back panel asks for, an AudioWorklet copies every frame out as 32-bit
// float, and the take is written as a WAV on stop — 24-bit or 32-bit float,
// whichever the session is set to. Nothing is compressed, nothing is resampled,
// and the length is exact (frames / sample rate) instead of guessed.
//
// expo-audio still handles iOS and Android, where the platform recorder already
// writes a proper file. This module is the web one.
//
// Every export keeps the shape the deck already used, so the screen does not
// care which of the two paths produced the take.
import { Platform } from 'react-native';
import { pcmBytes, wavHeaderBytes } from './wav';

const isWeb = () => Platform.OS === 'web';

// The worklet runs on the audio thread and hands over blocks of samples. It
// accumulates a few thousand frames at a time: posting every 128-frame render
// quantum would flood the main thread for no benefit.
const WORKLET_SOURCE = `
class TapeflowRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = null;
    this.filled = 0;
    this.channels = 0;
  }
  flush() {
    // Report the peak of the block as well: the deck's meter has to show what the
    // microphone is really delivering, so a silent input is visible while the pass
    // is being made instead of being discovered later as an empty take.
    let peak = 0;
    for (let c = 0; c < this.channels; c += 1) {
      const b = this.block[c];
      for (let i = 0; i < this.filled; i += 1) {
        const v = b[i] < 0 ? -b[i] : b[i];
        if (v > peak) peak = v;
      }
    }
    const copy = this.block.map((b) => b.slice(0));
    this.port.postMessage({ blocks: copy, peak }, copy.map((b) => b.buffer));
    this.filled = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const frames = input[0].length;
    if (!this.block) {
      this.channels = input.length;
      this.block = [];
      for (let c = 0; c < this.channels; c += 1) this.block.push(new Float32Array(4096));
    }
    // Fill the block exactly. The first version wrote a whole render quantum and
    // flushed once it had passed 4096 frames, so every flush quietly threw away
    // the frames that did not fit — a small dropout every ~85ms, which is heard
    // as a crackle over everything that was recorded.
    let offset = 0;
    while (offset < frames) {
      const room = 4096 - this.filled;
      const n = Math.min(room, frames - offset);
      for (let c = 0; c < this.channels; c += 1) {
        this.block[c].set(input[c].subarray(offset, offset + n), this.filled);
      }
      this.filled += n;
      offset += n;
      if (this.filled === 4096) this.flush();
    }
    return true;
  }
}
registerProcessor('tapeflow-recorder', TapeflowRecorder);
`;

const BLOCK = 4096;
const MAX_SECONDS = 60 * 60; // one hour of tape; keeps runaway memory bounded

let session = null;
let workletUrl = null;
const workletReady = new Map(); // sample rate -> Promise<void>

function fail(code, short, message) {
  const err = new Error(message);
  err.code = code;
  err.short = short;
  return err;
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
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) {
    return {
      code: 'no-audio-context',
      short: 'THIS BROWSER CANNOT RECORD',
      message: 'This browser has no AudioContext, so there is nothing to capture the microphone with.',
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

// The rate the samples are actually rendered at, and nothing else.
//
// This used to ask for the session's rate (up to 96 kHz). A requested rate the
// device cannot render does not fail: the context opens anyway, and when its
// real rate differs from what was asked, the WAV header describes samples that
// were never captured at that rate. A file like that plays at the wrong speed
// and pitch, which sounds exactly like a broken recorder. So the request is
// gone: the hardware rate is the only truthful value, and it is what the file
// is stamped with.
function makeContext() {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  try {
    const ctx = new Ctor({ latencyHint: 'interactive' });
    if (ctx && ctx.sampleRate >= 22050) return ctx;
    // A machine with no audio device can open a telephone-rate context. Ask once
    // for a real rate before accepting it.
    try { ctx.close(); } catch (e) { /* already gone */ }
  } catch (e) { /* try once more below */ }
  try {
    return new Ctor({ sampleRate: 48000, latencyHint: 'interactive' });
  } catch (e) {
    return null;
  }
}

function ensureWorklet(ctx) {
  const key = ctx.sampleRate;
  if (workletReady.has(key)) return workletReady.get(key);
  let audioWorklet = null;
  try {
    audioWorklet = ctx.audioWorklet;
  } catch (e) {
    audioWorklet = null;
  }
  if (!audioWorklet || typeof audioWorklet.addModule !== 'function') {
    const missing = Promise.reject(new Error('no-audioworklet'));
    missing.catch(() => {});
    workletReady.set(key, missing);
    return missing;
  }
  if (!workletUrl) {
    workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
  }
  const ready = audioWorklet.addModule(workletUrl);
  workletReady.set(key, ready);
  return ready;
}

// Last resort for a browser without AudioWorklet: a ScriptProcessor still hands
// over every frame, it just does it on the main thread.
function scriptProcessorSource(ctx, stream) {
  const source = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(BLOCK, 2, 2);
  const collected = [];
  node.onaudioprocess = (e) => {
    const buffers = [];
    let peak = 0;
    for (let c = 0; c < e.inputBuffer.numberOfChannels; c += 1) {
      const data = e.inputBuffer.getChannelData(c);
      for (let i = 0; i < data.length; i += 1) {
        const v = data[i] < 0 ? -data[i] : data[i];
        if (v > peak) peak = v;
      }
      buffers.push(new Float32Array(data));
    }
    collected.push(buffers);
    if (session) {
      session.channels = buffers.length;
      session.frames += buffers[0].length;
      session.recentPeak = peak;
      if (peak > session.peak) session.peak = peak;
    }
  };
  source.connect(node);
  // A ScriptProcessor only runs while it is connected to something, but it must
  // not reach the speakers: connected straight to the destination it plays the
  // microphone back out loud, and with echo cancellation off that is a feedback
  // howl rather than a recording.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.connect(mute);
  mute.connect(ctx.destination);
  return {
    node,
    collected,
    stop: () => {
      try { node.onaudioprocess = null; } catch (e) { /* already gone */ }
      try { source.disconnect(); } catch (e) { /* already gone */ }
      try { node.disconnect(); } catch (e) { /* already gone */ }
    },
  };
}

/**
 * Opens the microphone and starts filling a take.
 *
 * `options.sampleRate` is the session's rate (48000 or 96000) and
 * `options.float32` picks a 32-bit float or a 24-bit file. Rejects with
 * `{ code, short, message }` — `short` is sized for the deck's legend, `message`
 * for a dialog.
 */
export async function startMicTake(options) {
  if (!isWeb()) {
    throw fail('not-web', 'NO MIC ON THIS PLATFORM', 'The microphone is recorded through expo-audio on iOS and Android.');
  }
  const blocked = micUnavailableReason();
  if (blocked) throw blocked;
  // One stream at a time: a second REC must not leave the first one open, and
  // on a phone two open inputs can make the second request fail outright.
  if (session) await stopMicTake().catch(() => {});

  const opts = options || {};
  const float32 = opts.float32 !== false;

  // No echo cancellation, noise suppression or auto gain: those are speech-call
  // features that wreck a recording. This is a field recorder.
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2,
      },
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

  const ctx = makeContext();
  if (!ctx) {
    try { stream.getTracks().forEach((track) => track.stop()); } catch (e) { /* already gone */ }
    throw describe(null, 'The browser could not open an audio context for the microphone.');
  }

  const next = {
    stream,
    ctx,
    channels: Math.min(2, Math.max(1, stream.getAudioTracks().length ? 1 : 1)),
    blocks: [], // [{ ch0: Float32Array[], ch1: Float32Array[] }]
    perChannel: [[], []],
    // Captured audio, already in its file format, one Blob per block. Keeping the
    // whole take as float arrays and encoding it on stop held the pass in memory twice
    // and then blocked the page; a Blob per block lets the browser own the bytes.
    parts: [],
    frames: 0,
    peak: 0,
    recentPeak: 0,
    sampleRate: ctx.sampleRate,
    float32,
    startedAt: Date.now(),
    worklet: null,
    fallback: null,
  };

  session = next;

  try {
    await ensureWorklet(ctx);
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'tapeflow-recorder', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    node.port.onmessage = (event) => {
      const payload = event.data || {};
      const blocks = payload.blocks || (Array.isArray(payload) ? payload : []);
      if (!session || session !== next) return;
      if (blocks[0] && blocks[0].length) {
        const room = Math.max(0, next.sampleRate * MAX_SECONDS - next.frames);
        const take = room > 0 ? blocks.map((b) => b.subarray(0, Math.min(b.length, room))) : [];
        if (take.length && take[0].length) {
          next.parts.push(new Blob([pcmBytes(take, next.float32)]));
          next.frames += take[0].length;
          next.channels = Math.max(next.channels, take.length);
        }
      }
      if (typeof payload.peak === 'number') {
        next.recentPeak = payload.peak;
        if (payload.peak > next.peak) next.peak = payload.peak;
      }
    };
    source.connect(node);
    // Silence to the outputs keeps the worklet alive without echoing the mic.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute);
    mute.connect(ctx.destination);
    next.worklet = { source, node, mute };
  } catch (e) {
    // No AudioWorklet (or the module did not load): capture on the main thread.
    const fallback = scriptProcessorSource(ctx, stream);
    next.fallback = fallback;
    next.channels = 1;
  }

  if (ctx.state === 'suspended') {
    try { ctx.resume(); } catch (e) { /* the record key is the gesture */ }
  }

  return { mimeType: 'audio/wav', sampleRate: next.sampleRate, bitDepth: float32 ? 32 : 24 };
}

function concatChannel(blocks) {
  let total = 0;
  blocks.forEach((b) => { total += b.length; });
  const out = new Float32Array(total);
  let at = 0;
  blocks.forEach((b) => { out.set(b, at); at += b.length; });
  return out;
}

// A WAV the browser (and everything else) reads back exactly as it was written:
// no encoder, no bitrate, no resampling.
function encodeWav(channels, sampleRate, float32) {
  const numCh = Math.max(1, channels.length);
  const frames = channels[0] ? channels[0].length : 0;
  const bytesPerSample = float32 ? 4 : 3;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, float32 ? 3 : 1, true); // 3 = IEEE float, 1 = PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);

  let at = 44;
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < numCh; c += 1) {
      const sample = channels[c] ? channels[c][i] : 0;
      const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample;
      if (float32) {
        view.setFloat32(at, clamped, true);
        at += 4;
      } else {
        const v = Math.round(clamped * 8388607);
        view.setUint8(at, v & 0xff);
        view.setUint8(at + 1, (v >> 8) & 0xff);
        view.setUint8(at + 2, (v >> 16) & 0xff);
        at += 3;
      }
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Stops the microphone and resolves `{ uri, duration, size, mimeType }` with the
 * exact length of what was captured, or null when nothing was.
 */
export async function stopMicTake() {
  const s = session;
  session = null;
  if (!s) return null;

  let perChannel = s.perChannel;
  if (s.fallback) {
    perChannel = [[], []];
    s.fallback.collected.forEach((block) => {
      block.forEach((data, c) => {
        if (!perChannel[c]) perChannel[c] = [];
        perChannel[c].push(data);
      });
    });
    try { s.fallback.stop(); } catch (e) { /* already gone */ }
  } else if (s.worklet) {
    try { s.worklet.source.disconnect(); } catch (e) { /* already gone */ }
    try { s.worklet.node.port.onmessage = null; } catch (e) { /* already gone */ }
    try { s.worklet.node.disconnect(); } catch (e) { /* already gone */ }
    try { s.worklet.mute.disconnect(); } catch (e) { /* already gone */ }
  }

  // Releases the browser's recording indicator.
  try { s.stream.getTracks().forEach((track) => track.stop()); } catch (e) { /* already stopped */ }
  try { await s.ctx.close(); } catch (e) { /* already closed */ }

  // The worklet path handed every block to a Blob as it arrived, so a take is joined
  // here rather than encoded: stopping is quick however long the pass was.
  const limit = s.sampleRate * MAX_SECONDS;
  const frames = Math.min(s.frames || 0, limit);
  let blob = null;
  if (s.parts && s.parts.length && frames > 0) {
    blob = new Blob([wavHeaderBytes(s.sampleRate, s.channels, frames, s.float32), ...s.parts], {
      type: 'audio/wav',
    });
  } else {
    // The ScriptProcessor fallback still keeps float blocks; encode those as before.
    const channels = perChannel
      .map((blocks) => (blocks && blocks.length ? concatChannel(blocks) : null))
      .filter((c) => c && c.length > 0);
    if (channels.length === 0) return null;
    blob = encodeWav(
      channels.map((c) => c.slice(0, Math.min(c.length, limit))),
      s.sampleRate,
      s.float32,
    );
  }
  const size = blob ? blob.size : 0;
  const uri = size ? URL.createObjectURL(blob) : null;
  if (!uri) return null;
  const duration = frames > 0 ? frames / s.sampleRate : 0;
  return {
    uri,
    size,
    mimeType: 'audio/wav',
    sampleRate: s.sampleRate,
    bitDepth: s.float32 ? 32 : 24,
    // What the microphone actually delivered: 0 means it heard nothing at all.
    peak: s.peak || 0,
    // Exact, from the frame count: a 3.54s take stops where the audio stops.
    duration: Math.round(duration * 1000) / 1000,
  };
}

export function canRecordFromMic() {
  return isWeb() && micUnavailableReason() === null;
}

export function micTakeActive() {
  return !!session;
}

/** What the microphone is delivering right now, for the deck's meter. */
export function micTakeLevel() {
  if (!session) return null;
  return {
    recent: session.recentPeak || 0,
    peak: session.peak || 0,
    seconds: session.frames / (session.sampleRate || 48000),
  };
}

export default { canRecordFromMic, micUnavailableReason, startMicTake, stopMicTake, micTakeActive, micTakeLevel };
