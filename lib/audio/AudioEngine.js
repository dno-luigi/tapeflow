// Simulated tape transport engine. No UI. Singleton: `engine`.
// State: { mode: 'stopped'|'playing'|'recording'|'reversing'|'rewinding'|'auditioning',
//          position (seconds), direction (1|-1), pitch (-1..1 => speed multiplier),
//          armed: number[], auditionId, tapeSound: boolean[] , loop: {on,start,end}|null, length }

const TICK_MS = 40;
const MIN_PITCH = 0.5;
const MAX_PITCH = 1.5;

class AudioEngineImpl {
  constructor() {
    this.listeners = new Set();
    this.timer = null;
    this.lastTs = 0;
    this.state = {
      mode: 'stopped',
      position: 0,
      direction: 1,
      pitch: 1,
      armed: [],
      auditionId: null,
      tapeSound: [false, false, false, false],
      masterTape: false,
      loop: null,
      length: 600,
      recordStart: 0,
    };
  }

  // ---- subscription ----
  subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    this.listeners.add(fn);
    try { fn(this.snapshot()); } catch (e) { /* listener failure must not break engine */ }
    return () => { this.listeners.delete(fn); };
  }

  snapshot() {
    return { ...this.state, armed: [...this.state.armed], tapeSound: [...this.state.tapeSound], loop: this.state.loop ? { ...this.state.loop } : null };
  }

  emit() {
    const s = this.snapshot();
    this.listeners.forEach((fn) => { try { fn(s); } catch (e) { /* ignore */ } });
  }

  getPosition() { return this.state.position; }
  getState() { return this.snapshot(); }

  // ---- configuration ----
  setLength(seconds) {
    const n = Number(seconds);
    if (Number.isFinite(n) && n > 0) this.state.length = n;
  }

  setTapeSound(trackIndex, on) {
    if (trackIndex === 'master') { this.state.masterTape = !!on; }
    else if (trackIndex >= 0 && trackIndex < 4) { this.state.tapeSound[trackIndex] = !!on; }
    this.emit();
  }

  // Effective tape-sound flag: adds saturation, hiss and flutter when true.
  tapeSoundFor(trackIndex) {
    return !!(this.state.masterTape || this.state.tapeSound[trackIndex]);
  }

  // Characteristics of the tape colouring; clean (zeros) when the flag is off.
  tapeCharacter(trackIndex) {
    if (!this.tapeSoundFor(trackIndex)) return { saturation: 0, hiss: 0, flutter: 0 };
    const t = Date.now() / 1000;
    return { saturation: 0.35, hiss: 0.12, flutter: 0.004 * Math.sin(t * 2 * Math.PI * 6) };
  }

  setLoop(start, end) {
    if (start == null || end == null || !(end > start)) { this.state.loop = null; }
    else { this.state.loop = { start: Math.max(0, start), end: Math.min(this.state.length, end) }; }
    this.emit();
  }

  clearLoop() { this.setLoop(null, null); }

  // ---- ticking ----
  startTimer() {
    if (this.timer) return;
    this.lastTs = Date.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stopTimer() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  tick() {
    const now = Date.now();
    const dt = Math.min(0.25, (now - this.lastTs) / 1000);
    this.lastTs = now;
    const s = this.state;
    let rate = 0;
    switch (s.mode) {
      case 'playing':
      case 'recording':
      case 'auditioning': rate = s.pitch; break;
      case 'reversing': rate = -s.pitch; break;
      case 'rewinding': rate = -12; break;
      default: rate = 0;
    }
    if (rate === 0) { this.stopTimer(); return; }
    let p = s.position + rate * dt;
    if (s.loop && (s.mode === 'playing' || s.mode === 'reversing')) {
      if (rate > 0 && p >= s.loop.end) p = s.loop.start;
      if (rate < 0 && p <= s.loop.start) p = s.loop.end;
    }
    if (p <= 0) {
      p = 0;
      if (s.mode === 'rewinding' || s.mode === 'reversing') { s.position = 0; s.mode = 'stopped'; s.direction = 1; this.stopTimer(); this.emit(); return; }
    }
    if (p >= s.length) {
      if (s.mode === 'recording') { s.length = p + 60; }
      else { s.position = s.length; s.mode = 'stopped'; this.stopTimer(); this.emit(); return; }
    }
    s.position = p;
    this.emit();
  }

  setMode(mode, direction) {
    this.state.mode = mode;
    this.state.direction = direction;
    if (mode === 'stopped') this.stopTimer(); else this.startTimer();
    this.emit();
  }

  // ---- transport ----
  play() {
    this.state.auditionId = null;
    this.setMode('playing', 1);
  }

  stop() {
    const wasRecording = this.state.mode === 'recording';
    const result = wasRecording ? this.finishRecording() : null;
    this.state.auditionId = null;
    this.setMode('stopped', 1);
    return result;
  }

  rewind() {
    if (this.state.mode === 'recording') this.finishRecording();
    this.setMode('rewinding', -1);
  }

  // Toggles live reverse playback.
  reverse() {
    if (this.state.mode === 'reversing') { this.setMode('playing', 1); return; }
    if (this.state.mode === 'recording') this.finishRecording();
    this.state.auditionId = null;
    this.setMode('reversing', -1);
  }

  // Tape counter reset to zero.
  resetCounter() {
    this.state.position = 0;
    this.emit();
  }

  seek(seconds) {
    const n = Number(seconds);
    if (!Number.isFinite(n)) return;
    this.state.position = Math.max(0, Math.min(this.state.length, n));
    this.emit();
  }

  // Scratch / nudge: move the tape by delta seconds directly.
  scrub(delta) {
    const n = Number(delta);
    if (!Number.isFinite(n)) return;
    this.state.position = Math.max(0, Math.min(this.state.length, this.state.position + n));
    this.emit();
  }

  // Pitch-bend: accepts speed multiplier (0.5..1.5), clamped.
  setPitch(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    this.state.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, n));
    this.emit();
  }

  // Start recording on armed track indexes (0-3). Returns false if nothing armed.
  record(armedTracks) {
    const list = Array.isArray(armedTracks)
      ? armedTracks.map((a, i) => (typeof a === 'boolean' ? (a ? i : -1) : Number(a))).filter((i) => Number.isInteger(i) && i >= 0 && i < 4)
      : [];
    if (list.length === 0) return false;
    this.state.armed = Array.from(new Set(list));
    this.state.recordStart = this.state.position;
    this.state.auditionId = null;
    this.setMode('recording', 1);
    return true;
  }

  // Ends a recording; returns { tracks:[indexes], start, duration } for the store to turn into takes.
  finishRecording() {
    const s = this.state;
    const duration = Math.max(0, Math.round(s.position - s.recordStart));
    const out = { tracks: [...s.armed], start: s.recordStart, duration: Math.max(1, duration) };
    s.armed = [];
    return out;
  }

  // Audition a stored take by id: plays from the start of the tape.
  audition(takeId) {
    if (takeId == null) return;
    this.state.auditionId = takeId;
    this.state.position = this.state.position;
    this.setMode('auditioning', 1);
  }
}

export const engine = new AudioEngineImpl();
export default engine;
