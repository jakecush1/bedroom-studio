// CHIP-4 synthesis core.
//
// Port of MP1_G1_Sound_Engine:
//  - group1_render_cli.py: note scheduling, additive square/triangle/sawtooth,
//    waveform_for_channel(), the default ADSR (2/20/0.75/45 ms) with the release
//    after note-off, render_beat_clicks(), protect_peak(), 16-bit WAV.
//  - sound_engine.py: envelope presets a–f, modulation() (ring modulation),
//    one-pole lowpass/highpass/bandpass, kick/snare/hihat/cymbal, play_drum_track().
//
// Improvements over the Python:
//  - additive waveforms drop harmonics above Nyquist (the CLI summed up to the
//    23rd harmonic regardless of pitch, which aliases on high notes) and are
//    rendered from cached single-cycle tables, so a full song renders in ~1 s;
//  - bandpass() applies both filters (the original assigned the lowpass result
//    to a misspelled variable, so only the highpass ran);
//  - chip personalities: NES 2A03 (pulse duties, 4-bit stepped triangle, 15-bit
//    LFSR noise), Game Boy (4-bit wave channel), SEGA SN76489, C64 SID (pulse
//    width modulation + resonant filter), alongside the original mapping.

export const SR = 44100;

/** sound_engine.py envelope_preset: (attack ms, decay ms, release ms, sustain level). */
export const ENVELOPES = {
  default: { a: 2, d: 20, r: 45, s: 0.75, label: "Default (CLI)" },
  a: { a: 500, d: 300, r: 750, s: 0.5, label: "A · slow pad" },
  b: { a: 500, d: 6, r: 72, s: 1.0, label: "B · swell" },
  c: { a: 50, d: 10, r: 50, s: 0.7, label: "C · soft" },
  d: { a: 2, d: 6, r: 6, s: 1.0, label: "D · organ" },
  e: { a: 100, d: 30, r: 6, s: 0.1, label: "E · bloom" },
  f: { a: 5, d: 50, r: 100, s: 0.5, label: "F · pluck" },
  nes: { a: 1, d: 260, r: 20, s: 0.0, label: "NES decay" },
  stab: { a: 1, d: 90, r: 15, s: 0.25, label: "Stab" },
  lead: { a: 2, d: 140, r: 35, s: 0.62, label: "Lead (Chipify)" },
  arp: { a: 1, d: 45, r: 8, s: 0.55, label: "Arp (Chipify)" }
};

export const WAVES = {
  square: "Square (additive)",
  pulse50: "Pulse 50%",
  pulse25: "Pulse 25%",
  pulse12: "Pulse 12.5%",
  pwm: "Pulse PWM (SID)",
  triangle: "Triangle",
  tri4: "Triangle 4-bit (NES)",
  wave: "Wave 4-bit (Game Boy)",
  sawtooth: "Sawtooth",
  sine: "Sine",
  ring: "Ring mod (modulation())",
  noise: "Noise (gaussian)",
  lfsr: "LFSR noise (NES)",
  lfsrShort: "LFSR metallic (short)",
  drums: "Drum synth (GM kit)"
};

/** Chip personalities: default voice per role + global character. */
export const CHIPS = {
  original: { label: "Original", method: "additive", roles: null },
  nes: { label: "NES 2A03", method: "raw", roles: { lead: ["pulse50", "nes"], harm: ["pulse25", "nes"], bass: ["tri4", "d"], extra: ["pulse12", "nes"], drums: ["lfsr", "nes"] } },
  gameboy: { label: "Game Boy", method: "raw", roles: { lead: ["pulse50", "f"], harm: ["pulse25", "nes"], bass: ["wave", "d"], extra: ["pulse12", "f"], drums: ["lfsrShort", "nes"] } },
  sega: { label: "SEGA PSG", method: "raw", roles: { lead: ["pulse50", "c"], harm: ["pulse50", "c"], bass: ["pulse50", "d"], extra: ["pulse50", "c"], drums: ["lfsr", "nes"], volSteps: 16 } },
  sid: { label: "C64 SID", method: "raw", roles: { lead: ["sawtooth", "f"], harm: ["pwm", "c"], bass: ["triangle", "d"], extra: ["pwm", "a"], drums: ["noise", "nes"], filter: true } }
};

/* ------------------------------------------------------------------ */
/* Band-limited single-cycle tables (the additive synthesis of the CLI) */
/* ------------------------------------------------------------------ */

const TABLE = 2048;
const tableCache = new Map();

function additiveTable(kind, maxHarm) {
  const key = `${kind}:${maxHarm}`;
  if (tableCache.has(key)) return tableCache.get(key);
  const t = new Float32Array(TABLE + 1);
  for (let i = 0; i < TABLE; i++) {
    const ph = (2 * Math.PI * i) / TABLE;
    let y = 0;
    if (kind === "square") {
      for (let n = 1; n <= Math.min(23, maxHarm); n += 2) y += Math.sin(n * ph) / n;
      y *= 4 / Math.PI;
    } else if (kind === "triangle") {
      for (let n = 1; n <= Math.min(15, maxHarm); n += 2) y += (((n - 1) / 2) % 2 ? -1 : 1) * Math.sin(n * ph) / (n * n);
      y *= 8 / (Math.PI * Math.PI);
    } else if (kind === "sawtooth") {
      for (let n = 1; n <= Math.min(23, maxHarm); n++) y += ((n % 2 ? -1 : 1) * Math.sin(n * ph)) / n;
      y *= -2 / Math.PI;
    }
    t[i] = y;
  }
  t[TABLE] = t[0];
  tableCache.set(key, t);
  return t;
}

// Game Boy wave RAM: a 32-step, 4-bit soft triangle-ish bass shape
const GB_WAVE = [0, 2, 4, 6, 8, 10, 12, 13, 14, 15, 15, 15, 14, 14, 13, 12, 11, 9, 8, 7, 6, 5, 4, 4, 3, 3, 2, 2, 1, 1, 0, 0].map((v) => v / 7.5 - 1);
// NES noise periods (NTSC CPU cycles) indexed 0..15
const NES_NOISE = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068];
const NES_CPU = 1789773;

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

/* ------------------------------------------------------------------ */
/* Envelope (build_envelope from the CLI, any preset)                  */
/* ------------------------------------------------------------------ */

function envelopeAt(i, noteSamples, env, sr) {
  const a = Math.max(1, Math.round((Math.max(env.a, 0.5) * sr) / 1000));
  const d = Math.max(1, Math.round((Math.max(env.d, 1) * sr) / 1000));
  if (i < noteSamples) {
    if (i < a) return i / a;
    if (i < a + d) return 1 - (1 - env.s) * ((i - a) / d);
    return env.s;
  }
  // release starts from wherever the envelope was at note-off
  const r = Math.max(1, Math.round((Math.max(env.r, 1) * sr) / 1000));
  const at = noteSamples - 1;
  const lvl = at < a ? at / a : at < a + d ? 1 - (1 - env.s) * ((at - a) / d) : env.s;
  const k = (i - noteSamples) / r;
  return k >= 1 ? 0 : lvl * (1 - k);
}

/* ------------------------------------------------------------------ */
/* sound_engine.py filters + drums                                     */
/* ------------------------------------------------------------------ */

export function lowpass(x, cutoff, sr = SR) {
  const out = new Float32Array(x.length);
  const dt = 1 / sr, rc = 1 / (2 * Math.PI * cutoff), alpha = dt / (rc + dt);
  out[0] = alpha * x[0];
  for (let i = 1; i < x.length; i++) out[i] = alpha * x[i] + (1 - alpha) * out[i - 1];
  return out;
}

export function highpass(x, cutoff, sr = SR) {
  const out = new Float32Array(x.length);
  const dt = 1 / sr, rc = 1 / (2 * Math.PI * cutoff), alpha = rc / (rc + dt);
  out[0] = x[0];
  for (let i = 1; i < x.length; i++) out[i] = alpha * out[i - 1] + alpha * (x[i] - x[i - 1]);
  return out;
}

/** bandpass() with the original's intent (both filters). */
export function bandpass(x, center, bandwidth, sr = SR) {
  return lowpass(highpass(x, Math.max(1, center - bandwidth / 2), sr), center + bandwidth / 2, sr);
}

function oneShot(fn, seconds, sr) {
  const n = Math.round(seconds * sr);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = fn(i / sr, i);
  return y;
}

function sigEnvelope(x, amp, a, d, r, s, sr) {
  // generate_envelope() from sound_engine.py (release inside the clip)
  a = Math.max(a, 2); d = Math.max(d, 6); r = Math.max(r, 6); s = Math.min(1, s);
  const A = Math.round((a / 1000) * sr), Dd = Math.round((d / 1000) * sr), R = Math.round((r / 1000) * sr);
  const n = x.length, out = new Float32Array(n);
  const susLen = n - A - Dd - R + 1;
  for (let i = 0; i < n; i++) {
    let e;
    if (i < A) e = (amp * i) / A;
    else if (i < A + Dd) e = amp + (amp * s - amp) * ((i - A) / Dd);
    else if (i < A + Dd + Math.max(0, susLen)) e = amp * s;
    else {
      const k = (i - A - Dd - Math.max(0, susLen)) / Math.max(1, R - 1);
      e = amp * s * Math.max(0, 1 - k);
    }
    out[i] = x[i] * e;
  }
  return out;
}

const triAdd = (f, t) => {
  let y = 0;
  for (let n = 1; n < 12; n += 2) y += ((((n - 1) / 2) % 2 ? -1 : 1) * Math.sin(2 * Math.PI * n * f * t)) / (n * n);
  return (8 / (Math.PI * Math.PI)) * y;
};
const sqAdd = (f, t) => {
  let y = 0;
  for (let n = 1; n < 12; n += 2) y += Math.sin(2 * Math.PI * n * f * t) / n;
  return (4 / Math.PI) * y;
};
function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const drumCache = new Map();
/** The sound_engine.py drum kit, normalised to a common peak. */
export function drumSound(kind, sr = SR) {
  const key = `${kind}:${sr}`;
  if (drumCache.has(key)) return drumCache.get(key);
  let y;
  if (kind === "kick") {
    const a = oneShot((t) => triAdd(mtof(20), t) * triAdd(mtof(32), t), 0.22, sr);
    y = sigEnvelope(lowpass(a, 115, sr), 10, 2, 198, 8, 0.5, sr);
  } else if (kind === "snare") {
    const n = bandpass(oneShot(() => gauss(), 0.2, sr), 3781.5, 6517, sr);
    const l = oneShot((t, i) => triAdd(mtof(64), t) * n[i], 0.2, sr);
    y = sigEnvelope(l, 1, 2, 198, 6, 0, sr);
  } else if (kind === "hihat") {
    const s = oneShot((t) => sqAdd(mtof(75), t) * gauss(), 0.2, sr);
    y = sigEnvelope(highpass(bandpass(s, 7100, 52, sr), 40000, sr), 2, 2, 198, 6, 0, sr);
  } else {
    // cymbal: product of six squares, two bands, long decay
    const notes = [59, 63, 66, 68, 69, 75];
    const s = oneShot((t) => notes.reduce((acc, m) => acc * Math.sign(Math.sin(2 * Math.PI * mtof(m) * t) || 1), 1), 0.522, sr);
    const b1 = bandpass(s, 3440, 52 * 20, sr), b2 = highpass(bandpass(s, 7100, 52 * 20, sr), 40000, sr);
    const mix = new Float32Array(s.length);
    for (let i = 0; i < s.length; i++) mix[i] = b1[i] + b2[i];
    y = sigEnvelope(mix, 1, 2, 520, 6, 0, sr);
  }
  let peak = 0;
  for (let i = 0; i < y.length; i++) peak = Math.max(peak, Math.abs(y[i]));
  if (peak > 0) for (let i = 0; i < y.length; i++) y[i] = (y[i] / peak) * 0.9;
  drumCache.set(key, y);
  return y;
}

/** GM percussion note → drum kind. */
function gmDrum(pitch) {
  if (pitch === 35 || pitch === 36) return "kick";
  if ([37, 38, 39, 40].includes(pitch)) return "snare";
  if ([42, 44, 46, 54, 69, 70].includes(pitch)) return "hihat";
  if ([49, 51, 52, 53, 55, 57, 59].includes(pitch)) return "cymbal";
  if (pitch >= 41 && pitch <= 50) return "kick"; // toms → low thump
  return "hihat";
}

/* ------------------------------------------------------------------ */
/* Channel planning                                                    */
/* ------------------------------------------------------------------ */

/** waveform_for_channel() from the CLI. */
export function originalWave(ch) {
  if (ch === 9) return "noise";
  return ["square", "triangle", "sawtooth", "sine"][ch % 4];
}

/** Default per-channel voice settings for a sequence and chip. */
export function planChannels(seq, chipId = "nes") {
  const chip = CHIPS[chipId] || CHIPS.nes;
  const chans = [...new Set(seq.notes.map((n) => n.ch))].sort((a, b) => a - b);
  const stats = chans.map((ch) => {
    const ns = seq.notes.filter((n) => n.ch === ch);
    const avg = ns.reduce((s, n) => s + n.pitch, 0) / Math.max(1, ns.length);
    const name = seq.tracks?.find((t) => ns[0] && t.index === ns[0].track)?.name || null;
    return { ch, avg, count: ns.length, name };
  });
  const plan = {};
  // NES-MDB carts (the G6 models) name their tracks p1/p2/tr/no — honour that
  const nesNames = { p1: "lead", p2: "harm", tr: "bass", no: "drums" };
  const melodic = stats.filter((s) => s.ch !== 9 && !(s.name && nesNames[s.name.trim()] === "drums")).sort((a, b) => b.avg - a.avg);
  for (const s of stats) {
    let role;
    const named = s.name && nesNames[s.name.trim()];
    if (named) role = named;
    else if (s.ch === 9) role = "drums";
    else {
      const rank = melodic.indexOf(s);
      role = rank === 0 ? "lead" : rank === melodic.length - 1 && melodic.length > 1 ? "bass" : rank === 1 ? "harm" : "extra";
    }
    let wave, env;
    if (!chip.roles) {
      wave = originalWave(s.ch);
      env = "default";
    } else {
      [wave, env] = chip.roles[role];
    }
    // NES-MDB noise "pitches" are 1–16 period indices, not GM drum notes
    const nesNoise = role === "drums" && seq.notes.some((n) => n.ch === s.ch && n.pitch <= 16);
    if (role === "drums" && !nesNoise && chip.roles) wave = "drums";
    if (role === "drums" && !chip.roles && !nesNoise) wave = "drums";
    plan[s.ch] = { ch: s.ch, role, wave, env, level: role === "drums" ? 0.55 : role === "bass" ? 0.9 : 0.75, mute: false, solo: false, octave: 0, pan: 0, count: s.count, name: s.name, nesNoise };
  }
  return plan;
}

/* ------------------------------------------------------------------ */
/* Renderer                                                            */
/* ------------------------------------------------------------------ */

function renderVoice(out, note, v, opts, chipId) {
  const sr = opts.sampleRate;
  const env = ENVELOPES[v.env] || ENVELOPES.default;
  const start = Math.round(note.start * sr);
  const noteN = Math.max(1, Math.round(note.dur * sr));
  const relN = Math.max(1, Math.round((Math.max(env.r, 1) * sr) / 1000));
  const total = Math.min(noteN + relN, out.length - start);
  if (total <= 0 || start < 0) return;
  const amp = (note.vel == null ? 0.8 : note.vel) * v.level;
  const wave = v.wave;
  const chip = CHIPS[chipId] || CHIPS.original;
  const steps = chip.roles && chip.roles.volSteps;

  if (wave === "drums") {
    const s = drumSound(gmDrum(note.pitch), sr);
    const n = Math.min(s.length, out.length - start);
    for (let i = 0; i < n; i++) out[start + i] += s[i] * amp;
    return;
  }

  const f = mtof(note.pitch + 12 * (v.octave || 0));
  const raw = opts.method === "raw" || (opts.method === "auto" && chip.method === "raw");
  let phase = 0;
  const baseInc = f / sr;
  let inc = baseInc;
  // optional vibrato (cents), fading in after the attack like a player's hand
  const vib = note.vib || 0;
  const vibW = (2 * Math.PI * 5.6) / sr, vibK = vib * 0.000577623; // ln2/1200
  let lfsr = 1, lfsrClock = 0, lfsrOut = 1, lfsrInc = 0, mode = 0;
  if (wave === "lfsr" || wave === "lfsrShort") {
    // NES-MDB noise values 1..16 pick the period; GM notes map by pitch
    const idx = v.nesNoise ? Math.max(0, Math.min(15, 16 - note.pitch)) : Math.max(0, Math.min(15, Math.round((84 - note.pitch) / 4)));
    lfsrInc = NES_CPU / NES_NOISE[idx] / sr;
    mode = wave === "lfsrShort" ? 6 : 1;
  }
  let table = null;
  if (!raw && (wave === "square" || wave === "triangle" || wave === "sawtooth" || wave === "pulse50")) {
    const maxH = Math.max(1, Math.floor(sr / 2 / f));
    table = additiveTable(wave === "pulse50" ? "square" : wave, maxH);
  }
  const duty = wave === "pulse25" ? 0.25 : wave === "pulse12" ? 0.125 : 0.5;
  const modInc = (f * 1.5) / sr;
  let modPhase = 0;
  const pwmRate = 1.6 / sr;
  let pwm = 0;
  const gNoise = wave === "noise";

  for (let i = 0; i < total; i++) {
    if (vib) {
      const d = i > 0.18 * sr ? Math.min(1, (i - 0.18 * sr) / (0.2 * sr)) : 0;
      inc = baseInc * (1 + vibK * d * Math.sin(vibW * i));
    }
    let y;
    if (table) {
      const p = phase * TABLE;
      const k = p | 0;
      y = table[k] + (table[k + 1] - table[k]) * (p - k);
    } else {
      switch (wave) {
        case "square":
        case "pulse50":
        case "pulse25":
        case "pulse12":
          y = phase < duty ? 1 : -1;
          break;
        case "pwm":
          pwm += pwmRate;
          y = phase < 0.5 + 0.38 * Math.sin(2 * Math.PI * pwm) ? 1 : -1;
          break;
        case "triangle":
          y = 1 - 4 * Math.abs(phase - 0.5);
          break;
        case "tri4": {
          // the 2A03 triangle steps through 32 levels of a 4-bit DAC
          const step = Math.floor(phase * 32);
          const lv = step < 16 ? 15 - step : step - 16;
          y = lv / 7.5 - 1;
          break;
        }
        case "wave":
          y = GB_WAVE[Math.floor(phase * 32) & 31];
          break;
        case "sawtooth":
          y = 2 * phase - 1;
          break;
        case "sine":
          y = Math.sin(2 * Math.PI * phase);
          break;
        case "ring":
          // modulation(): carrier × modulator, both additive triangles in sound_engine.py
          y = (1 - 4 * Math.abs(phase - 0.5)) * Math.sin(2 * Math.PI * modPhase);
          modPhase += modInc;
          if (modPhase >= 1) modPhase -= 1;
          break;
        case "noise":
          y = gNoise ? gauss() * 0.4 : 0; // the CLI scaled channel-9 noise by 0.4
          break;
        case "lfsr":
        case "lfsrShort":
          lfsrClock += lfsrInc;
          while (lfsrClock >= 1) {
            lfsrClock -= 1;
            const bit = (lfsr & 1) ^ ((lfsr >> mode) & 1);
            lfsr = (lfsr >> 1) | (bit << 14);
            lfsrOut = lfsr & 1 ? -1 : 1;
          }
          y = lfsrOut * 0.7;
          break;
        default:
          y = Math.sin(2 * Math.PI * phase);
      }
    }
    phase += inc;
    if (phase >= 1) phase -= 1;
    let e = envelopeAt(i, noteN, env, sr);
    if (steps) e = Math.round(e * (steps - 1)) / (steps - 1);
    out[start + i] += y * e * amp;
  }
}

/** render_beat_clicks() from the CLI. */
function beatClicks(out, beatTimes, sr) {
  const n = Math.round(0.03 * sr);
  for (const bt of beatTimes) {
    const s = Math.round(bt * sr);
    for (let i = 0; i < n && s + i < out.length; i++) {
      const t = i / sr;
      out[s + i] += 0.2 * Math.sin(2 * Math.PI * 1800 * t) * Math.exp(-40 * t);
    }
  }
}

/** play_drum_track() from sound_engine.py: kick on 1, snare on 3, hats between. */
function drumTrack(out, beatTimes, sr) {
  beatTimes.forEach((bt, i) => {
    const kind = i % 4 === 0 ? "kick" : i % 4 === 2 ? "snare" : "hihat";
    const s = drumSound(kind, sr);
    const at = Math.round(bt * sr);
    for (let k = 0; k < s.length && at + k < out.length; k++) out[at + k] += s[k] * 0.6;
  });
}

function svfLowpass(x, cutoff, q, sr) {
  // SID-flavoured resonant state-variable lowpass
  const f = 2 * Math.sin((Math.PI * Math.min(cutoff, sr / 6)) / sr);
  let low = 0, band = 0;
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    low += f * band;
    const high = x[i] - low - q * band;
    band += f * high;
    out[i] = low;
  }
  return out;
}

/**
 * Render a note sequence.
 * @param seq     parsed MIDI ({notes:[{pitch,start,dur,vel,ch}]})
 * @param opts    { chip, plan, method: 'auto'|'additive'|'raw', sampleRate, beats, beatMode, crush:{bits,factor}, maxSeconds }
 */
export function renderSequence(seq, opts = {}) {
  const sr = opts.sampleRate || SR;
  const chipId = opts.chip || "nes";
  const plan = opts.plan || planChannels(seq, chipId);
  const method = opts.method || "auto";
  const tail = 1.0;
  const maxEnd = seq.notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
  const beatEnd = opts.beats && opts.beats.length ? opts.beats[opts.beats.length - 1] + 0.6 : 0;
  const dur = Math.min(opts.maxSeconds || 600, Math.max(maxEnd, beatEnd) + tail);
  const len = Math.max(1, Math.ceil(dur * sr));
  const anySolo = Object.values(plan).some((v) => v.solo);

  const stems = {};
  for (const v of Object.values(plan)) stems[v.ch] = new Float32Array(len);
  for (const n of seq.notes) {
    const v = plan[n.ch];
    if (!v || v.mute || (anySolo && !v.solo)) continue;
    if (n.start >= dur) continue;
    renderVoice(stems[n.ch], n, v, { sampleRate: sr, method }, chipId);
  }
  const chip = CHIPS[chipId];
  if (chip && chip.roles && chip.roles.filter) {
    for (const v of Object.values(plan)) if (v.role !== "drums") stems[v.ch] = svfLowpass(stems[v.ch], 3200, 0.6, sr);
  }
  if (opts.beats && opts.beats.length && opts.beatMode && opts.beatMode !== "none") {
    const b = new Float32Array(len);
    if (opts.beatMode === "clicks") beatClicks(b, opts.beats, sr);
    else drumTrack(b, opts.beats, sr);
    stems.beats = b;
  }

  const mix = new Float32Array(len);
  for (const [key, s] of Object.entries(stems)) {
    const pan = key === "beats" ? 0 : plan[key]?.pan || 0;
    void pan;
    for (let i = 0; i < len; i++) mix[i] += s[i];
  }
  // protect_peak(): only scale down if the mix clips
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(mix[i]));
  const peakBefore = peak;
  const norm = opts.normalize ? (peak > 0 ? 0.9 / peak : 1) : peak > 1 ? 1 / peak : 1;
  if (norm !== 1) {
    for (let i = 0; i < len; i++) mix[i] *= norm;
    for (const s of Object.values(stems)) for (let i = 0; i < len; i++) s[i] *= norm;
  }
  if (opts.crush && opts.crush.bits < 16) crushInPlace(mix, opts.crush.bits, opts.crush.factor);

  return {
    mix,
    stems,
    sampleRate: sr,
    duration: len / sr,
    peakBefore,
    summary: {
      notes: seq.notes.length,
      voices: Object.keys(stems).length,
      duration: +(len / sr).toFixed(3),
      tempoChanges: seq.tempoMap ? seq.tempoMap.length : 1,
      peakBeforeNormalize: +peakBefore.toFixed(4)
    }
  };
}

/** bitcrusher_effect() from bitcrusher.py, in place. */
export function crushInPlace(y, bits, factor = null) {
  const levels = Math.pow(2, bits) - 1;
  const f = factor || Math.max(1, Math.floor(Math.pow(2, Math.max(0, (16 - bits) / 4))));
  let held = 0;
  for (let i = 0; i < y.length; i++) {
    if (i % f === 0) {
      const x = y[i] < -1 ? -1 : y[i] > 1 ? 1 : y[i];
      held = (Math.round((x + 1) * 0.5 * levels) / levels) * 2 - 1;
    }
    y[i] = held;
  }
  return y;
}
