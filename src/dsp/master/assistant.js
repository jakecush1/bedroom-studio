// The mastering engineer: turns an analysis into chain parameters.
//
// Styles follow LANDR's three (Warm / Balanced / Open). Their tonal targets
// come from measuring commercially mastered songs (1/6-octave LTAS, band power
// falls ~2–3 dB/oct from 150 Hz to 8 kHz, plateau 60–500 Hz). The assistant
// only moves a mix part of the way toward the target and clamps every move,
// so the mix's character survives. A reference track replaces the style
// target, Matchering-style (tone, loudness, width).

import { design, magDb } from "./biquad.js";
import { curveAt, smoothCurve, normalizeCurve, bandMean } from "./spectrum.js";
import { neutralParams } from "./chain.js";

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const r1 = (v) => Math.round(v * 10) / 10;

/** Tonal targets: [Hz, dB] in 1/6-octave band power, normalised later. */
const CURVES = {
  balanced: [[25, -9], [40, -3], [60, 2.5], [125, 3], [250, 3], [500, 2.5], [1000, 0.5], [2000, -2.6], [4000, -5.6], [8000, -8.6], [12000, -11], [16000, -15], [20000, -22]],
  warm: [[25, -8.5], [40, -2.5], [60, 3], [125, 3.8], [250, 3.8], [500, 2.8], [1000, 0.5], [2000, -3.1], [4000, -6.6], [8000, -10.1], [12000, -13], [16000, -17.5], [20000, -25]],
  open: [[25, -9.5], [40, -3.5], [60, 2.5], [125, 2.5], [250, 2.2], [500, 1.8], [1000, 0.5], [2000, -2.0], [4000, -4.4], [8000, -6.8], [12000, -8.8], [16000, -12], [20000, -19]]
};

export const STYLES = {
  warm: {
    label: "Warm",
    blurb: "Vintage weight: rounded top, fuller low-mids, softer compression.",
    sat: 0.42, bias: 0.16, width: 0, bassWidth: 0.35, attack: 0.7, ratio: 0.9, glue: 1.15,
    release: { fast: 60, slow: 450 }
  },
  balanced: {
    label: "Balanced",
    blurb: "Controlled and clear, with depth. The all-rounder.",
    sat: 0.22, bias: 0.1, width: 0.5, bassWidth: 0.25, attack: 1, ratio: 1, glue: 1,
    release: { fast: 45, slow: 350 }
  },
  open: {
    label: "Open",
    blurb: "Modern punch and presence: brighter top, wider image.",
    sat: 0.12, bias: 0.06, width: 1, bassWidth: 0.15, attack: 1.5, ratio: 1, glue: 0.85,
    release: { fast: 35, slow: 300 }
  }
};

export const INTENSITIES = {
  low: { label: "Low", lufs: -14, k: 0.42, ratio: 1.35, thr: 0, glueRatio: 1.25, glueThr: -1, sat: 0.7, budget: 2.5, clip: false },
  medium: { label: "Medium", lufs: -11, k: 0.55, ratio: 1.7, thr: -2, glueRatio: 1.5, glueThr: -2, sat: 1, budget: 4, clip: false },
  high: { label: "High", lufs: -8.5, k: 0.65, ratio: 2.2, thr: -4, glueRatio: 1.9, glueThr: -3.5, sat: 1.2, budget: 6, clip: true }
};

/** The fixed EQ the assistant fits its correction curve with. */
export const EQ_BANDS = [
  { type: "lowshelf", f: 55, q: 0.7 },
  { type: "peaking", f: 110, q: 0.9 },
  { type: "peaking", f: 220, q: 0.9 },
  { type: "peaking", f: 450, q: 0.9 },
  { type: "peaking", f: 900, q: 0.9 },
  { type: "peaking", f: 1800, q: 0.9 },
  { type: "peaking", f: 3600, q: 0.9 },
  { type: "peaking", f: 7000, q: 0.9 },
  { type: "highshelf", f: 11000, q: 0.7 }
];

/** Style target evaluated on the analysis grid, normalised (200 Hz–5 kHz = 0 dB). */
export function styleTarget(style, centers) {
  const pts = CURVES[style] || CURVES.balanced;
  const fs = pts.map((p) => p[0]), db = pts.map((p) => p[1]);
  return normalizeCurve(centers, centers.map((f) => curveAt(fs, db, f)));
}

/** Solve a small symmetric linear system (Gaussian elimination). */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / (M[r][r] || 1e-12);
  }
  return x;
}

/**
 * Fit EQ_BANDS gains so their summed response matches `want` (dB on the
 * analysis grid) — regularised Gauss–Newton on a log-spaced grid.
 */
export function fitEq(centers, want, sr, { maxGain = 6, lambda = 0.08 } = {}) {
  const grid = [];
  for (let i = 0; i < centers.length; i++) if (centers[i] >= 28 && centers[i] <= 17000) grid.push([centers[i], want[i]]);
  const n = EQ_BANDS.length;
  let g = EQ_BANDS.map((b) => clamp(curveAt(centers, want, b.f) * 0.6, -maxGain, maxGain));
  const resp = (gains) => grid.map(([f]) => EQ_BANDS.reduce((s, b, i) => s + magDb(design(b.type, b.f, sr, { q: b.q, gainDb: gains[i] }), f, sr), 0));
  for (let it = 0; it < 6; it++) {
    const base = resp(g);
    const J = EQ_BANDS.map((b, i) => {
      const gp = g.slice(); gp[i] += 0.25;
      const gm = g.slice(); gm[i] -= 0.25;
      return grid.map(([f]) => (magDb(design(b.type, b.f, sr, { q: b.q, gainDb: gp[i] }), f, sr) - magDb(design(b.type, b.f, sr, { q: b.q, gainDb: gm[i] }), f, sr)) / 0.5);
    });
    const A = Array.from({ length: n }, () => new Array(n).fill(0));
    const rhs = new Array(n).fill(0);
    for (let k = 0; k < grid.length; k++) {
      const res = grid[k][1] - base[k];
      for (let i = 0; i < n; i++) {
        rhs[i] += J[i][k] * res;
        for (let j = 0; j < n; j++) A[i][j] += J[i][k] * J[j][k];
      }
    }
    // Levenberg damping for stable steps + a mild Tikhonov pull toward small gains
    const damp = lambda * grid.length, mu = 0.25 * lambda * grid.length;
    for (let i = 0; i < n; i++) { A[i][i] += damp + mu; rhs[i] -= mu * g[i]; }
    const d = solve(A, rhs);
    g = g.map((v, i) => clamp(v + d[i], -maxGain, maxGain));
  }
  return EQ_BANDS.map((b, i) => ({ ...b, gainDb: Math.round(g[i] * 100) / 100 }));
}

/** Frequency-dependent limits for automatic moves (dB). */
function moveLimits(f) {
  if (f < 40) return [-3, 1.5];
  if (f < 120) return [-3.5, 2.5];
  if (f < 5000) return [-3, 3];
  if (f < 12000) return [-3, 3.5];
  return [-3, 3];
}

const BAND_RANGES = [[30, 120], [120, 900], [900, 5500], [5500, 16000]];

/**
 * @param {object} an        analysis of the mix (analyzeTrack)
 * @param {object} o
 *   style: warm|balanced|open, intensity: low|medium|high,
 *   reference: analysis of a reference track (optional),
 *   fine: { low, mid, presence, high, width, warmth, comp, deess, lufs, ceiling }
 * @returns {{ params, targetLufs, budget, target:number[], correction:number[], notes:string[] }}
 */
export function suggest(an, { style = "balanced", intensity = "medium", reference = null, fine = {} } = {}) {
  const S = STYLES[style] || STYLES.balanced;
  let I = INTENSITIES[intensity] || INTENSITIES.medium;
  const p = neutralParams();
  const notes = [];
  const centers = an.centers;
  const sr = an.sr;

  // reference: borrow intensity from how dense the reference is
  if (reference) {
    const plr = reference.plr;
    const base = plr < 8.5 ? INTENSITIES.high : plr < 11.5 ? INTENSITIES.medium : INTENSITIES.low;
    I = { ...base, lufs: clamp(reference.loud.integrated, -16, -7), k: 0.75 };
  }

  /* ---- working level ---- */
  const inLufs = Number.isFinite(an.loud.integrated) ? an.loud.integrated : -30;
  p.inputGainDb = r1(clamp(-18 - inLufs, -24, 30));

  /* ---- tone ---- */
  const target = reference ? normalizeCurve(centers, smoothCurve(centers, reference.midN, 1 / 3)) : styleTarget(style, centers);
  const track = smoothCurve(centers, an.midN, 1 / 3);
  const k = I.k;
  const raw = centers.map((f, i) => {
    let d = target[i] - track[i];
    // low end: lots of genres carry more sub than the average master; only trim real excess
    if (f < 100 && d < 0) d = Math.min(0, d + 3);
    // nothing to lift in an empty top octave (lossy or band-limited sources)
    if (f > 12000 && d > 0 && an.highContent < -26) d = 0;
    const [lo, hi] = moveLimits(f);
    return clamp(k * d, lo, hi);
  });
  const correction = smoothCurve(centers, raw, 1 / 2);
  p.eq = fitEq(centers, correction, sr, { maxGain: 6 });
  // narrow resonances in the low-mids
  for (const r of an.resonances || []) {
    const cut = -clamp((r.bump - 2) * 0.8, 0.6, 2.5);
    p.eq.push({ type: "peaking", f: Math.round(r.f), q: 4.5, gainDb: r1(cut) });
  }
  const eqShift = BAND_RANGES.map(([a, b]) => bandMean(centers, correction, a, b));

  /* ---- dynamics ---- */
  const comp = clamp(fine.comp ?? 1, 0, 2);
  const ratioScale = [1.1, 1, 0.85, 0.8];
  const att = [35, 22, 12, 6], rel = [240, 180, 130, 90], bandOff = [0, 0, 0.5, 1];
  p.xover = an.xover || [120, 900, 5500];
  p.bands = an.bands.map((b, i) => {
    const baseRatio = 1 + (I.ratio - 1) * ratioScale[i] * S.ratio;
    return {
      threshold: r1(b.p90 + p.inputGainDb + eqShift[i] + I.thr + bandOff[i] - (comp - 1) * 3),
      ratio: Math.round((1 + (baseRatio - 1) * comp) * 100) / 100,
      attack: att[i] * S.attack,
      release: rel[i] * (style === "warm" ? 1.25 : 1),
      knee: 8,
      rmsMs: i === 0 ? 12 : 5,
      width: 1,
      gainDb: 0
    };
  });
  // de-essing on the air band when sibilance spikes
  const autoDeess = clamp((an.sibilance - 16) / 10, 0, 1);
  const deess = clamp(fine.deess ?? autoDeess, 0, 1);
  if (deess > 0.02) {
    const b3 = p.bands[3];
    b3.threshold = r1(b3.threshold - 6 * deess);
    b3.ratio = Math.max(b3.ratio, Math.round((1.8 + 2.5 * deess) * 100) / 100);
    b3.attack = 1.5;
    b3.release = 70;
    b3.rmsMs = 2;
  }
  p.glue = {
    threshold: r1(an.broad.p90 + p.inputGainDb + bandMean(centers, correction, 60, 8000) + I.glueThr - (comp - 1) * 2),
    ratio: Math.round((1 + (I.glueRatio - 1) * S.glue * comp) * 100) / 100,
    attack: 30 * S.attack,
    release: style === "warm" ? 350 : 250,
    knee: 6,
    rmsMs: 20
  };

  /* ---- stereo ---- */
  const userWidth = clamp(fine.width ?? 1, 0.4, 1.6);
  let w = S.width;
  if (an.corr < 0.25) w = 0; // already wide or phasey: don't add more
  const widths = [S.bassWidth, 1, 1 + 0.06 * w, 1 + 0.15 * w];
  if (reference) {
    for (let i = 1; i < 4; i++) widths[i] = clamp(Math.pow(10, (reference.bands[i].sideDb - an.bands[i].sideDb) / 20), 0.6, 1.6);
    widths[0] = Math.min(S.bassWidth, widths[0]);
  }
  if (an.corr < 0.25) widths[3] = Math.min(widths[3], 0.9);
  p.bands.forEach((b, i) => { b.width = Math.round((i === 0 ? widths[0] : widths[i] * userWidth) * 100) / 100; });

  /* ---- colour ---- */
  const warmth = clamp(fine.warmth ?? S.sat * I.sat, 0, 1);
  p.sat = { amount: Math.round(warmth * 100) / 100, drive: 1.6, bias: S.bias };
  p.tone = { low: fine.low || 0, mid: fine.mid || 0, presence: fine.presence || 0, high: fine.high || 0 };

  /* ---- loudness ---- */
  p.clip = { on: I.clip, headroomDb: 1.5 };
  p.ceilingDb = fine.ceiling ?? -1;
  p.release = { ...S.release };
  const targetLufs = fine.lufs ?? I.lufs;

  /* ---- what we did, in words ---- */
  const moves = p.eq.filter((e) => Math.abs(e.gainDb) >= 0.6).sort((a, b) => Math.abs(b.gainDb) - Math.abs(a.gainDb)).slice(0, 4);
  const hz = (f) => (f >= 1000 ? `${r1(f / 1000)} kHz` : `${Math.round(f)} Hz`);
  const what = (e) => (e.type === "lowshelf" ? `below ${hz(e.f)}` : e.type === "highshelf" ? `above ${hz(e.f)}` : `at ${hz(e.f)}`);
  if (reference) notes.push(`Matched tone, width and loudness toward the reference (${r1(reference.loud.integrated)} LUFS, PLR ${r1(reference.plr)} dB)`);
  else notes.push(`${S.label} target, ${I.label.toLowerCase()} intensity: corrected ${Math.round(k * 100)}% of the way toward the tonal target`);
  if (moves.length) notes.push(`EQ: ${moves.map((e) => `${e.gainDb > 0 ? "+" : ""}${e.gainDb.toFixed(1)} dB ${what(e)}${e.q >= 4 ? " (resonance)" : ""}`).join(", ")}`);
  else notes.push("EQ: the mix already sits close to the target; tone left almost untouched");
  notes.push(`4-band compression ${p.bands.map((b) => `${b.ratio.toFixed(1)}:1`).join(" / ")} on the loudest moments; glue ${p.glue.ratio.toFixed(1)}:1`);
  if (deess > 0.02) notes.push(`De-essing the air band (${Math.round(deess * 100)}%)`);
  notes.push(`Stereo: lows ${Math.round(p.bands[0].width * 100)}% width (tighter bass), air ${Math.round(p.bands[3].width * 100)}%${an.corr < 0.25 ? " — mix is already very wide, no widening" : ""}`);
  if (warmth > 0.02) notes.push(`Harmonic saturation ${Math.round(warmth * 100)}% (2× oversampled)`);
  if (p.clip.on) notes.push("Soft clipper ahead of the limiter for extra density");
  return {
    params: p, targetLufs, budget: reference ? (reference.plr < 9 ? 6 : 4) : I.budget,
    target: Array.from(target), correction: Array.from(correction), notes, style, intensity,
    auto: { deess: autoDeess, warmth: clamp(S.sat * I.sat, 0, 1), lufs: I.lufs }
  };
}
