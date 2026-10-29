// A toy orchestra in plain JavaScript: wavetable voices (plucked harpsichord,
// piano, strings, organ, bass) rendered straight into sample arrays. Every
// note is one or two phase accumulators reading a "bright" and a "dark"
// table whose mix fades with time, so a two-minute piece with hundreds of
// notes renders in well under a second — where a Web Audio graph with a
// filter per note takes half a minute.

const TABLE = 2048;
const TAU = Math.PI * 2;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** A bandlimited table from [harmonic, amplitude] pairs. */
function table(partials) {
  const t = new Float32Array(TABLE);
  for (const [h, a] of partials) for (let i = 0; i < TABLE; i++) t[i] += a * Math.sin((TAU * h * i) / TABLE);
  let peak = 0;
  for (let i = 0; i < TABLE; i++) peak = Math.max(peak, Math.abs(t[i]));
  for (let i = 0; i < TABLE; i++) t[i] /= peak || 1;
  return t;
}
const series = (n, pow = 1, roll = Infinity) => Array.from({ length: n }, (_, i) => [i + 1, Math.pow(i + 1, -pow) / (1 + Math.pow((i + 1) / roll, 2))]);

/**
 * Voice recipes. attack/release in seconds; `decay` is the amplitude time
 * constant (per octave above/below C4 it shortens/lengthens by `decayPitch`);
 * `sustain` the level the decay floors at while the key is held; `bright`
 * the time constant of the bright→dark fade (Infinity: fixed); `detune` a
 * second copy in cents; `vibrato` [Hz, cents].
 */
export const VOICES = {
  pluck: { bright: table(series(18, 1)), dark: table(series(3, 1.4)), attack: 0.003, decay: 0.55, decayPitch: 0.75, sustain: 0.0, release: 0.05, brightTau: 0.22, level: 0.9 },
  piano: { bright: table(series(12, 1.15)), dark: table(series(3, 1.6)), attack: 0.004, decay: 1.4, decayPitch: 0.8, sustain: 0.12, release: 0.11, brightTau: 0.6, level: 1.0 },
  strings: { bright: table(series(14, 1, 9)), dark: table(series(4, 1.2)), attack: 0.09, decay: 4, decayPitch: 1, sustain: 0.85, release: 0.16, brightTau: Infinity, brightMix: 0.65, detune: 7, vibrato: [5.2, 7], level: 0.7 },
  organ: { bright: table([[0.5, 0.35], [1, 1], [2, 0.6], [3, 0.25], [4, 0.2], [6, 0.08]]), dark: null, attack: 0.02, decay: Infinity, decayPitch: 1, sustain: 1, release: 0.07, brightTau: Infinity, brightMix: 1, level: 0.75 },
  bass: { bright: table(series(7, 1)), dark: table(series(2, 1.2)), attack: 0.006, decay: 0.9, decayPitch: 0.9, sustain: 0.35, release: 0.08, brightTau: 0.3, level: 1.0 }
};

/**
 * Render notes into stereo sample arrays.
 * @param notes  [{ pitch, start, dur, vel?, voice?, level? }] seconds
 * @param o      sampleRate, voice (default for notes without one), tail seconds
 * @returns      { left: Float32Array, right: Float32Array, sampleRate }
 */
export function synthesize(notes, { sampleRate = 44100, voice = "piano", tail = 2 } = {}) {
  const end = notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0) + tail;
  const N = Math.max(sampleRate, Math.ceil(end * sampleRate));
  const L = new Float32Array(N), R = new Float32Array(N);
  const dt = 1 / sampleRate;
  for (const n of notes) {
    const V = VOICES[n.voice || voice] || VOICES.piano;
    const f = mtof(n.pitch);
    const vel = (n.vel == null ? 0.8 : n.vel) * (n.level == null ? 1 : n.level) * V.level * 0.5;
    const pan = Math.max(-0.7, Math.min(0.7, (n.pitch - 60) / 42));
    const gl = Math.cos(((pan + 1) / 2) * (Math.PI / 2)), gr = Math.sin(((pan + 1) / 2) * (Math.PI / 2));
    const decay = V.decay * Math.pow(V.decayPitch, (n.pitch - 60) / 12);
    const decayK = Number.isFinite(decay) ? Math.exp(-dt / decay) : 1;
    const relK = Math.exp(-dt / V.release);
    const brightK = Number.isFinite(V.brightTau) ? Math.exp(-dt / V.brightTau) : 1;
    const s0 = Math.max(0, Math.round(n.start * sampleRate));
    const held = Math.max(1, Math.round(n.dur * sampleRate));
    const total = Math.min(N - s0, held + Math.round(V.release * 6 * sampleRate));
    if (total <= 0) continue;
    const inc = (f / sampleRate) * TABLE;
    const inc2 = V.detune ? (f * Math.pow(2, V.detune / 1200) / sampleRate) * TABLE : 0;
    const vibHz = V.vibrato ? V.vibrato[0] : 0, vibAmt = V.vibrato ? (Math.pow(2, V.vibrato[1] / 1200) - 1) : 0;
    const attackN = Math.max(1, Math.round(V.attack * sampleRate));
    let ph = Math.random() * TABLE, ph2 = Math.random() * TABLE;
    let env = 1, bright = V.brightMix != null ? V.brightMix : 1, rel = 1;
    const B = V.bright, D = V.dark;
    for (let i = 0; i < total; i++) {
      // envelope: attack ramp × decay (floored at sustain while held) × release after the key lifts
      if (i >= held) rel *= relK;
      else if (i >= attackN) { env *= decayK; if (env < V.sustain) env = V.sustain; }
      const a = (i < attackN ? i / attackN : 1) * env * rel * vel;
      if (a < 1e-5 && i >= held) break;
      bright *= brightK;
      const vib = vibHz ? 1 + vibAmt * Math.sin(TAU * vibHz * i * dt) * Math.min(1, i * dt / 0.4) : 1;
      let idx = ph | 0;
      let s = D ? bright * B[idx] + (1 - bright) * D[idx] : B[idx];
      if (inc2) { const j = ph2 | 0; s = 0.5 * (s + (D ? bright * B[j] + (1 - bright) * D[j] : B[j])); ph2 += inc2 * vib; if (ph2 >= TABLE) ph2 -= TABLE; }
      ph += inc * vib;
      if (ph >= TABLE) ph -= TABLE;
      const k = s0 + i;
      L[k] += s * a * gl;
      R[k] += s * a * gr;
    }
  }
  return { left: L, right: R, sampleRate };
}

/** Scale both channels so the peak sits at `dbfs`. */
export function normalise(left, right, dbfs = -1) {
  let peak = 0;
  for (let i = 0; i < left.length; i++) { const a = Math.abs(left[i]), b = Math.abs(right[i]); if (a > peak) peak = a; if (b > peak) peak = b; }
  const g = peak > 0 ? Math.pow(10, dbfs / 20) / peak : 1;
  if (Math.abs(g - 1) > 1e-3) for (let i = 0; i < left.length; i++) { left[i] *= g; right[i] *= g; }
  return peak;
}
