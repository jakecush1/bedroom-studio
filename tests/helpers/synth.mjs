// Test-signal generators (deterministic).
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** A drum loop with kick on 1 and 3, snare on 2 and 4, eighth hats, plus a pad. */
export function drumLoop(bpm, seconds, sr = 22050, { swing = 0, offset = 0.21, seed = 3 } = {}) {
  const r = rng(seed);
  const x = new Float32Array(Math.floor(seconds * sr));
  const beat = 60 / bpm;
  const hit = (t, fn, len) => {
    const s = Math.floor(t * sr);
    for (let i = 0; i < len * sr && s + i < x.length; i++) if (s + i >= 0) x[s + i] += fn(i / sr);
  };
  const beats = [];
  for (let b = 0; offset + b * beat < seconds; b++) {
    const t = offset + b * beat;
    beats.push(t);
    if (b % 2 === 0) hit(t, (u) => 0.9 * Math.sin(2 * Math.PI * (55 + 120 * Math.exp(-u * 30)) * u) * Math.exp(-u * 9), 0.4);
    else hit(t, (u) => 0.5 * (r() * 2 - 1) * Math.exp(-u * 18), 0.25);
    for (const e of [0, 0.5]) hit(t + e * beat + (e ? swing * beat * 0.5 : 0), (u) => 0.15 * (r() * 2 - 1) * Math.exp(-u * 60), 0.05);
  }
  for (let i = 0; i < x.length; i++) x[i] += 0.05 * Math.sin((2 * Math.PI * 220 * i) / sr) + 0.01 * (r() * 2 - 1);
  return { x, beats, sr };
}
/** A melody of [midi, beats] pairs rendered with a harmonic-rich tone. */
export function melody(notes, bpm, sr = 22050, { gap = 0.02, vibrato = 0, offset = 0.3, harmonics = 5, seed = 9, noise = 0.003 } = {}) {
  const r = rng(seed);
  const beat = 60 / bpm;
  const total = offset + notes.reduce((s, n) => s + n[1], 0) * beat + 0.5;
  const x = new Float32Array(Math.floor(total * sr));
  let t = offset;
  const truth = [];
  for (const [m, len] of notes) {
    const dur = len * beat;
    if (m > 0) {
      const f0 = 440 * Math.pow(2, (m - 69) / 12);
      const s = Math.floor(t * sr), e = Math.floor((t + dur - gap) * sr);
      let ph = 0;
      for (let i = s; i < e && i < x.length; i++) {
        const u = (i - s) / sr;
        const f = f0 * (1 + vibrato * Math.sin(2 * Math.PI * 5.5 * u));
        ph += (2 * Math.PI * f) / sr;
        const env = Math.min(1, u / 0.01) * Math.min(1, (e - i) / sr / 0.02) * (0.8 + 0.2 * Math.exp(-u * 4));
        let y = 0;
        for (let h = 1; h <= harmonics; h++) y += Math.sin(ph * h) / h;
        x[i] += 0.35 * env * y;
      }
      truth.push({ pitch: m, start: t, dur: dur - gap });
    }
    t += dur;
  }
  for (let i = 0; i < x.length; i++) x[i] += noise * (r() * 2 - 1);
  return { x, truth, sr };
}
export function writeWav16(path, x, sr, fs) {
  const buf = Buffer.alloc(44 + x.length * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + x.length * 2, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(path, buf);
}
