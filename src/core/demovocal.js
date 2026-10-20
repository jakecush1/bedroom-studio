// "Off-key vocal": a synthetic singer for the autotune demo. A glottal pulse
// source with jitter, breath and vibrato through vowel formants, singing an
// A-minor phrase where every note is 20–45 cents off and slides between notes.

const VOWELS = {
  ah: [[730, 90], [1090, 110], [2440, 160]],
  oh: [[570, 80], [840, 100], [2410, 160]],
  ee: [[290, 60], [2290, 140], [3010, 200]],
  oo: [[320, 70], [870, 100], [2240, 160]],
  eh: [[530, 80], [1840, 130], [2480, 170]]
};

// [midi, cents off, beats, vowel]
const PHRASE = [
  [57, 32, 1, "ah"], [60, -38, 1, "oh"], [64, 27, 1.5, "ee"], [62, -30, 0.5, "eh"],
  [60, 41, 1, "ah"], [59, -24, 1, "oh"], [57, 30, 2, "ah"],
  [64, -35, 1, "oo"], [67, 26, 1, "ah"], [69, -42, 1.5, "ee"], [67, 33, 0.5, "eh"],
  [64, -28, 1, "oh"], [62, 36, 1, "ah"], [60, -31, 1, "ee"], [57, 25, 2.5, "ah"]
];

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function synthVocal(sr, { bpm = 84, seed = 21 } = {}) {
  const beat = 60 / bpm;
  const lead = 0.25;
  const total = lead + PHRASE.reduce((s, n) => s + n[2], 0) * beat + 0.6;
  const n = Math.round(total * sr);
  const out = new Float32Array(n);
  const r = rng(seed);
  // note timeline
  const notes = [];
  let t = lead;
  for (const [m, c, b, v] of PHRASE) { notes.push({ t, d: b * beat * 0.94, m: m + c / 100, v }); t += b * beat; }
  const res = [0, 1, 2].map(() => ({ y1: 0, y2: 0 }));
  let phase = 0, jitter = 0, prevGate = 0, aspLp = 0;
  let vib = r() * 6;
  for (let i = 0; i < n; i++) {
    const time = i / sr;
    let k = notes.length - 1;
    while (k > 0 && notes[k].t > time) k--;
    const nt = notes[k];
    const into = time - nt.t;
    const gate = into >= 0 && into < nt.d ? 1 : 0;
    // pitch: slide in from the last note, vibrato that grows on long notes
    let m = nt.m;
    if (k > 0 && into < 0.07) {
      const p = notes[k - 1].m;
      m = p + (m - p) * Math.min(1, Math.max(0, into / 0.07));
    }
    vib += (2 * Math.PI * (5.3 + 0.4 * Math.sin(time * 0.7))) / sr;
    m += Math.sin(vib) * 0.32 * Math.min(1, Math.max(0, (into - 0.15) / 0.35));
    if ((i & 255) === 0) jitter = (r() - 0.5) * 0.012;
    const f0 = 440 * Math.pow(2, (m - 69) / 12) * (1 + jitter);
    phase += f0 / sr;
    if (phase >= 1) phase -= 1;
    // Rosenberg-style glottal pulse
    const op = 0.42, cl = 0.16;
    let g = 0;
    if (phase < op) g = 0.5 * (1 - Math.cos((Math.PI * phase) / op));
    else if (phase < op + cl) g = Math.cos((Math.PI * (phase - op)) / (2 * cl));
    const dg = g - prevGate;
    prevGate = g;
    // amplitude envelope with soft consonant-ish onsets
    const att = Math.min(1, into / 0.04), rel = Math.min(1, Math.max(0, (nt.d - into) / 0.06));
    const amp = gate * att * rel * (0.85 + 0.15 * Math.sin(time * 3.1));
    aspLp = 0.7 * aspLp + 0.3 * (r() * 2 - 1);
    let src = dg * 40 * amp + aspLp * 0.05 * amp * (0.4 + g) + (into < 0.025 && gate ? (r() * 2 - 1) * 0.08 * (1 - into / 0.025) : 0);
    // vowel formants, gliding toward this note's vowel
    const vNow = VOWELS[nt.v], vPrev = VOWELS[k > 0 ? notes[k - 1].v : nt.v];
    const blend = Math.min(1, Math.max(0, into / 0.08));
    let y = 0;
    for (let f = 0; f < 3; f++) {
      const fc = vPrev[f][0] + (vNow[f][0] - vPrev[f][0]) * blend;
      const bw = vPrev[f][1] + (vNow[f][1] - vPrev[f][1]) * blend;
      const R = Math.exp((-Math.PI * bw) / sr), th = (2 * Math.PI * fc) / sr;
      const a1 = -2 * R * Math.cos(th), a2 = R * R;
      const s = res[f];
      const o = (1 - R) * src - a1 * s.y1 - a2 * s.y2;
      s.y2 = s.y1;
      s.y1 = o;
      y += o * [1, 0.6, 0.3][f];
    }
    out[i] = y;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < n; i++) out[i] *= 0.6 / (peak || 1);
  return out;
}

export async function renderDemoVocal(audio) {
  await audio.start();
  const sr = audio.ctx.sampleRate;
  const x = synthVocal(sr);
  return audio.bufferFrom([x, x], sr);
}
