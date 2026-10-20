// The tape library: every clip in the room — uploads, mic takes, renders from
// the machines, built-in carts — lives here so any machine can pick it up.
// Audio items are "tapes", MIDI items are "carts". Analysis results are cached
// per item so the rack units can share beats/melody/chords with each other.

import { Emitter } from "./events.js";
import { parseMidi } from "./midi.js";

let nextId = 1;

export class Library extends Emitter {
  constructor(audio) {
    super();
    this.audio = audio;
    this.items = new Map();
  }

  _add(item) {
    item.id = item.id || `t${nextId++}`;
    item.createdAt = item.createdAt ?? Date.now();
    item.cache = item.cache || {};
    this.items.set(item.id, item);
    this.emit("change", { type: "add", item });
    return item;
  }

  addAudio({ name, buffer = null, source = "upload", meta = {}, loader = null, builtin = false, createdAt }) {
    return this._add({ kind: "audio", name, buffer, source, meta, loader, builtin, createdAt });
  }

  addMidi({ name, seq = null, bytes = null, source = "upload", meta = {}, url = null, builtin = false, createdAt }) {
    return this._add({ kind: "midi", name, seq, bytes, source, meta, url, builtin, createdAt });
  }

  get(id) {
    return this.items.get(id) || null;
  }

  remove(id) {
    const item = this.items.get(id);
    if (!item || item.builtin) return;
    this.items.delete(id);
    this.emit("change", { type: "remove", item });
  }

  list(kind) {
    const all = [...this.items.values()].filter((i) => !kind || i.kind === kind);
    // newest user material first, built-ins after
    return all.sort((a, b) => (a.builtin === b.builtin ? b.createdAt - a.createdAt : a.builtin ? 1 : -1));
  }

  /** Resolve a lazily-loaded item (built-in carts and demo tapes). */
  async load(item) {
    if (!item) throw new Error("no item selected");
    if (item.kind === "audio" && !item.buffer) {
      if (!item.loader) throw new Error(`${item.name} has no audio`);
      item.buffer = await item.loader(this.audio);
      this.emit("change", { type: "load", item });
    }
    if (item.kind === "midi" && !item.seq) {
      if (!item.bytes && item.url) {
        const res = await fetch(item.url);
        if (!res.ok) throw new Error(`Could not load ${item.name} (${res.status})`);
        item.bytes = new Uint8Array(await res.arrayBuffer());
      }
      item.seq = parseMidi(item.bytes, item.name);
      this.emit("change", { type: "load", item });
    }
    return item;
  }

  /** Mono 22.05 kHz samples for analysis, cached per item. */
  async analysisSignal(item, sampleRate = 22050) {
    await this.load(item);
    const key = `mono${sampleRate}`;
    if (!item.cache[key]) item.cache[key] = await this.audio.toMono(item.buffer, sampleRate);
    return item.cache[key];
  }

  setCache(item, key, value) {
    item.cache[key] = value;
    this.emit("change", { type: "analysis", item, key });
  }

  /** Import a File from a picker or drag-and-drop. */
  async importFile(file) {
    const lower = file.name.toLowerCase();
    const bytes = await file.arrayBuffer();
    if (lower.endsWith(".mid") || lower.endsWith(".midi")) {
      const seq = parseMidi(new Uint8Array(bytes), file.name);
      return this.addMidi({ name: file.name, seq, bytes: new Uint8Array(bytes), source: "upload" });
    }
    const buffer = await this.audio.decode(bytes);
    return this.addAudio({ name: file.name, buffer, source: "upload" });
  }

  /** Start a microphone take. Resolves to a controller with stop() → item. */
  async recordMic(name = "Mic take") {
    await this.audio.start();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const rec = new MediaRecorder(stream);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const src = this.audio.ctx.createMediaStreamSource(stream);
    const an = this.audio.ctx.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    const data = new Float32Array(an.fftSize);
    rec.start();
    const started = performance.now();
    return {
      level() {
        an.getFloatTimeDomainData(data);
        let s = 0;
        for (let i = 0; i < data.length; i++) s += data[i] * data[i];
        return Math.sqrt(s / data.length);
      },
      elapsed: () => (performance.now() - started) / 1000,
      stop: () =>
        new Promise((resolve, reject) => {
          rec.onstop = async () => {
            stream.getTracks().forEach((t) => t.stop());
            src.disconnect();
            try {
              const blob = new Blob(chunks, { type: rec.mimeType });
              const buffer = await this.audio.decode(await blob.arrayBuffer());
              const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
              resolve(this.addAudio({ name: `${name} ${stamp}`, buffer, source: "mic" }));
            } catch (err) {
              reject(err);
            }
          };
          rec.stop();
        }),
      cancel() {
        rec.onstop = () => stream.getTracks().forEach((t) => t.stop());
        rec.stop();
        src.disconnect();
      }
    };
  }
}
