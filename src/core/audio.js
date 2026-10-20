// The studio's single AudioContext and its routing.
//
//   tool buses ─► input ─► crusher insert (AudioWorklet) ─► master ─► limiter ─► speakers
//                                                                        └─► analyser (room meters)
//   ambience (rain, vinyl) ─► ambience gain ─► speakers
//
// Every machine in the room plays through a named bus so the bitcrusher pedal
// can crush the whole room and the room's VU meters react to everything.

import { Emitter } from "./events.js";

const crusherUrl = new URL("./worklets/bitcrusher.worklet.js", import.meta.url);

export class StudioAudio extends Emitter {
  constructor() {
    super();
    this.ctx = null;
    this.buses = new Map();
    this.crusher = null;
    this.ready = null;
    this._levelData = null;
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  start() {
    if (this.ready) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return this.ready;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC({ latencyHint: "interactive" });
    this.ctx = ctx;

    this.input = ctx.createGain();
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 8;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.2;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.7;
    this._levelData = new Float32Array(this.analyser.fftSize);
    this._freqData = new Uint8Array(this.analyser.frequencyBinCount);

    this.ambience = ctx.createGain();
    this.ambience.gain.value = 0.55;
    this.ambience.connect(ctx.destination);

    this.master.connect(this.limiter);
    this.limiter.connect(ctx.destination);
    this.limiter.connect(this.analyser);

    // until the worklet loads, route straight through
    this.input.connect(this.master);

    this.ready = (async () => {
      try {
        await ctx.audioWorklet.addModule(crusherUrl);
        const node = new AudioWorkletNode(ctx, "bitcrusher", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2]
        });
        node.parameters.get("bypass").value = 1;
        this.input.disconnect();
        this.input.connect(node);
        node.connect(this.master);
        this.crusher = node;
      } catch (err) {
        console.warn("Bitcrusher worklet unavailable; master insert disabled", err);
      }
      if (ctx.state === "suspended") await ctx.resume();
      this.emit("ready", this);
      return this;
    })();
    return this.ready;
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** A named gain node feeding the studio input. */
  bus(name, gain = 1) {
    if (!this.ctx) throw new Error("audio not started");
    if (!this.buses.has(name)) {
      const g = this.ctx.createGain();
      g.gain.value = gain;
      g.connect(this.input);
      this.buses.set(name, g);
    }
    return this.buses.get(name);
  }

  setMasterVolume(v) {
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setAmbience(v) {
    if (this.ambience) this.ambience.gain.setTargetAtTime(v, this.ctx.currentTime, 0.3);
  }

  /** Master-insert bitcrusher controls (the pedal's "room" mode). */
  setCrusher({ enabled, bits, factor, mix, link }) {
    const n = this.crusher;
    if (!n) return false;
    const t = this.ctx.currentTime;
    if (enabled != null) n.parameters.get("bypass").setValueAtTime(enabled ? 0 : 1, t);
    if (bits != null) n.parameters.get("bits").setValueAtTime(bits, t);
    if (factor != null) n.parameters.get("factor").setValueAtTime(factor, t);
    if (mix != null) n.parameters.get("mix").setValueAtTime(mix, t);
    if (link != null) n.parameters.get("link").setValueAtTime(link ? 1 : 0, t);
    return true;
  }

  /** RMS level (0..1) of everything coming out of the speakers. */
  level() {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this._levelData);
    let s = 0;
    for (let i = 0; i < this._levelData.length; i++) s += this._levelData[i] * this._levelData[i];
    return Math.sqrt(s / this._levelData.length);
  }

  /** Low/mid/high energy (0..1) for room visuals. */
  bands() {
    if (!this.analyser) return [0, 0, 0];
    this.analyser.getByteFrequencyData(this._freqData);
    const n = this._freqData.length;
    const avg = (a, b) => {
      let s = 0;
      for (let i = a; i < b; i++) s += this._freqData[i];
      return s / Math.max(1, b - a) / 255;
    };
    return [avg(1, Math.floor(n * 0.02)), avg(Math.floor(n * 0.02), Math.floor(n * 0.12)), avg(Math.floor(n * 0.12), Math.floor(n * 0.5))];
  }

  async decode(arrayBuffer) {
    await this.start();
    // decodeAudioData detaches the buffer, so hand it a copy
    return await this.ctx.decodeAudioData(arrayBuffer.slice(0));
  }

  /** Mono, resampled copy of a buffer (used to feed the analysis workers). */
  async toMono(buffer, sampleRate = 22050) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const len = Math.max(1, Math.ceil(buffer.duration * sampleRate));
    const off = new OAC(1, len, sampleRate);
    const src = off.createBufferSource();
    src.buffer = buffer;
    src.connect(off.destination);
    src.start();
    const out = await off.startRendering();
    return out.getChannelData(0);
  }

  bufferFrom(channels, sampleRate) {
    const buf = this.ctx.createBuffer(channels.length, channels[0].length, sampleRate);
    channels.forEach((c, i) => buf.copyToChannel(c, i));
    return buf;
  }
}

/**
 * Plays one or more AudioBuffers in lock-step (e.g. an original song and its
 * chiptune rendering) with independent gains, seek and a readable position.
 */
export class SyncPlayer extends Emitter {
  constructor(audio, busName) {
    super();
    this.audio = audio;
    this.busName = busName;
    this.tracks = []; // { buffer, gain(GainNode), level }
    this.sources = [];
    this.playing = false;
    this.startAt = 0;
    this.offset = 0;
    this.loop = false;
    this._timer = null;
  }

  get ctx() {
    return this.audio.ctx;
  }

  setTracks(list) {
    const wasPlaying = this.playing;
    const pos = this.position;
    this.stop(true);
    this.tracks.forEach((t) => t.gain.disconnect());
    const bus = this.audio.bus(this.busName);
    this.tracks = list.filter((t) => t && t.buffer).map((t) => {
      const g = this.ctx.createGain();
      g.gain.value = t.level == null ? 1 : t.level;
      g.connect(t.output || bus);
      return { buffer: t.buffer, gain: g, name: t.name || "" };
    });
    this.offset = Math.min(pos, this.duration);
    if (wasPlaying) this.play();
  }

  setLevel(i, v) {
    const t = this.tracks[i];
    if (t) t.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  get duration() {
    return this.tracks.reduce((m, t) => Math.max(m, t.buffer.duration), 0);
  }

  get position() {
    if (!this.playing) return this.offset;
    const p = this.ctx.currentTime - this.startAt;
    const d = this.duration;
    return this.loop && d > 0 ? p % d : Math.min(p, d);
  }

  play(from) {
    if (!this.tracks.length) return;
    this.audio.start();
    if (from != null) this.offset = from;
    if (this.offset >= this.duration - 0.01) this.offset = 0;
    this.stop(true);
    const t0 = this.ctx.currentTime + 0.04;
    this.sources = this.tracks.map((t) => {
      const s = this.ctx.createBufferSource();
      s.buffer = t.buffer;
      s.loop = this.loop;
      s.connect(t.gain);
      s.start(t0, Math.min(this.offset, t.buffer.duration));
      return s;
    });
    this.startAt = t0 - this.offset;
    this.playing = true;
    clearInterval(this._timer);
    this._timer = setInterval(() => {
      if (!this.loop && this.position >= this.duration - 0.005) this.stop();
    }, 100);
    this.emit("state", true);
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.position;
    this.stop(true);
    this.emit("state", false);
  }

  stop(keepOffset = false) {
    this.sources.forEach((s) => { try { s.stop(); } catch (e) { /* already stopped */ } s.disconnect(); });
    this.sources = [];
    const was = this.playing;
    this.playing = false;
    clearInterval(this._timer);
    if (!keepOffset) this.offset = 0;
    if (was && !keepOffset) this.emit("state", false);
  }

  toggle() {
    this.playing ? this.pause() : this.play();
  }

  seek(t) {
    const was = this.playing;
    this.offset = Math.max(0, Math.min(t, this.duration));
    if (was) this.play();
  }
}
