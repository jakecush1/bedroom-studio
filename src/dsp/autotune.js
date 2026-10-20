// Vocal pitch correction ("autotune").
//
//  1. pYIN pitch track of the vocal (16 kHz, 10 ms hop).
//  2. Key from a pitch-class histogram (Krumhansl–Kessler profiles), or the
//     key/scale you choose.
//  3. Note decisions on a smoothed pitch (with hysteresis, so vibrato never
//     flips notes) and a correction curve shaped by retune speed, amount and
//     how much natural vibrato to keep. Retune 0 ms + no vibrato is the hard,
//     stepped "robot" effect.
//  4. TD-PSOLA resynthesis: pitch-synchronous grains re-spaced at the target
//     period, which moves the pitch but keeps the formants (no chipmunk).

import { pyin } from "./pyin.js";

export const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

export const SCALES = {
  major: { label: "Major", steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { label: "Minor", steps: [0, 2, 3, 5, 7, 8, 10] },
  harmonicMinor: { label: "Harmonic minor", steps: [0, 2, 3, 5, 7, 8, 11] },
  majorPent: { label: "Major pentatonic", steps: [0, 2, 4, 7, 9] },
  minorPent: { label: "Minor pentatonic", steps: [0, 3, 5, 7, 10] },
  blues: { label: "Blues", steps: [0, 3, 5, 6, 7, 10] },
  chromatic: { label: "Chromatic", steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }
};

/** The levels: how fast and how completely the voice is pulled onto the notes. */
export const LEVELS = {
  subtle: { label: "Subtle", blurb: "Gentle polish. Keeps the natural slides and vibrato.", retuneMs: 120, amount: 0.65, vibrato: 1 },
  natural: { label: "Natural", blurb: "Clearly in tune, still sounds like a person.", retuneMs: 55, amount: 0.92, vibrato: 0.85 },
  pop: { label: "Pop", blurb: "Tight modern vocal. Fast retune, tamed vibrato.", retuneMs: 22, amount: 1, vibrato: 0.45 },
  hard: { label: "Hard", blurb: "The robotic stepped effect: instant retune, flat notes.", retuneMs: 0, amount: 1, vibrato: 0 }
};

const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const hzToMidi = (f) => 69 + 12 * Math.log2(f / 440);

/** Integer-factor decimation with a windowed-sinc low-pass (to ~16 kHz). */
function decimate(x, factor) {
  if (factor <= 1) return Float32Array.from(x);
  const taps = 8 * factor + 1, C = (taps - 1) / 2, fc = 0.45 / factor;
  const h = new Float64Array(taps);
  let s = 0;
  for (let i = 0; i < taps; i++) {
    const t = i - C;
    const sinc = t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t);
    h[i] = sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (taps - 1)));
    s += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= s;
  const n = Math.floor(x.length / factor);
  const y = new Float32Array(n);
  for (let o = 0; o < n; o++) {
    const c = o * factor;
    let acc = 0;
    for (let i = 0; i < taps; i++) {
      const j = c + i - C;
      if (j >= 0 && j < x.length) acc += h[i] * x[j];
    }
    y[o] = acc;
  }
  return y;
}

/**
 * Pitch track of a vocal.
 * @returns {{ f0: Float32Array, voiced: Uint8Array, hopSec: number, frames: number }}
 */
export function trackPitch(mono, sr, { onProgress = null } = {}) {
  const factor = Math.max(1, Math.round(sr / 16000));
  const y = decimate(mono, factor);
  const srd = sr / factor;
  const hop = Math.round(srd * 0.01);
  const r = pyin(y, srd, { fmin: 70, fmax: 1100, frameLength: 1024, hop, onProgress });
  return { f0: r.f0, voiced: r.voiced, hopSec: hop / srd, frames: r.f0.length };
}

/** Most likely key from the sung pitch classes. */
export function detectKey(f0, voiced) {
  const hist = new Float64Array(12);
  let total = 0;
  for (let i = 0; i < f0.length; i++) {
    if (!voiced[i] || !(f0[i] > 0)) continue;
    const m = hzToMidi(f0[i]);
    const near = Math.round(m);
    const w = Math.max(0.15, 1 - 2 * Math.abs(m - near)); // in-tune, steady frames count most
    hist[((near % 12) + 12) % 12] += w;
    total += w;
  }
  if (!total) return { root: 0, scale: "major", confidence: 0, hist: Array.from(hist) };
  const corr = (prof, root) => {
    let mx = 0, my = 0;
    for (let i = 0; i < 12; i++) { mx += hist[i]; my += prof[i]; }
    mx /= 12; my /= 12;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < 12; i++) {
      const a = hist[(i + root) % 12] - mx, b = prof[i] - my;
      sxy += a * b; sxx += a * a; syy += b * b;
    }
    return sxy / Math.sqrt(sxx * syy || 1);
  };
  let best = { root: 0, scale: "major", confidence: -2 };
  for (let root = 0; root < 12; root++) {
    for (const [scale, prof] of [["major", KK_MAJOR], ["minor", KK_MINOR]]) {
      const c = corr(prof, root);
      if (c > best.confidence) best = { root, scale, confidence: c };
    }
  }
  return { ...best, hist: Array.from(hist) };
}

/** Nearest allowed MIDI note to m. */
function nearestNote(m, allowed) {
  const base = Math.floor(m);
  let best = base, bd = Infinity;
  for (let k = base - 6; k <= base + 7; k++) {
    if (!allowed[((k % 12) + 12) % 12]) continue;
    const d = Math.abs(m - k);
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

/** Zero-phase one-pole smoothing (forward + backward) of a segment. */
function smoothSeg(src, a, b, alpha) {
  const out = new Float64Array(b - a);
  let y = src[a];
  for (let i = a; i < b; i++) { y += (src[i] - y) * alpha; out[i - a] = y; }
  y = out[b - a - 1];
  for (let i = b - 1; i >= a; i--) { y += (out[i - a] - y) * alpha; out[i - a] = y; }
  return out;
}

/**
 * Corrected pitch per frame.
 * @returns {{ inMidi: Float32Array, outMidi: Float32Array, note: Int16Array }} NaN where unvoiced
 */
export function correctionCurve(track, { root = 0, scale = "major", retuneMs = 55, amount = 1, vibrato = 1 } = {}) {
  const { f0, voiced, hopSec } = track;
  const n = f0.length;
  const allowed = new Uint8Array(12);
  for (const s of (SCALES[scale] || SCALES.chromatic).steps) allowed[(s + root) % 12] = 1;
  const inMidi = new Float32Array(n).fill(NaN), outMidi = new Float32Array(n).fill(NaN);
  const note = new Int16Array(n).fill(-1);
  const m = new Float64Array(n);
  for (let i = 0; i < n; i++) m[i] = voiced[i] && f0[i] > 0 ? hzToMidi(f0[i]) : NaN;
  // slow zero-phase centre: separates vibrato from the note (keeps it intact)
  const slowAlpha = 1 - Math.exp(-hopSec / 0.05);
  // fast causal centre: note decisions (a zero-phase one would "see" an
  // upcoming glide and jump to the next note early)
  const fastAlpha = 1 - Math.exp(-hopSec / 0.012);
  const retAlpha = retuneMs <= 0 ? 1 : 1 - Math.exp(-hopSec / (retuneMs / 1000));
  let i = 0;
  while (i < n) {
    if (!Number.isFinite(m[i])) { i++; continue; }
    let j = i;
    while (j < n && Number.isFinite(m[j])) j++;
    // fragments under 50 ms are breaths or decays the tracker misread: leave them alone
    if ((j - i) * hopSec < 0.05) { i = j; continue; }
    const slow = smoothSeg(m, i, j, slowAlpha);
    // first note from the median of the opening 60 ms (onsets often scoop)
    const head = Array.from(m.subarray(i, Math.min(j, i + Math.max(1, Math.round(0.06 / hopSec))))).sort((p, q) => p - q);
    const start = head[head.length >> 1];
    let fast = start;
    let cur = nearestNote(start, allowed);
    let s = retuneMs <= 0 ? null : 0;
    for (let k = i; k < j; k++) {
      fast += (m[k] - fast) * fastAlpha;
      // glides move far faster than vibrato (> 15 st/s vs < 9): follow the raw pitch then
      const vel = k > i ? Math.abs(m[k] - m[k - 1]) / hopSec : 0;
      const p = vel > 15 ? m[k] : fast;
      const cand = nearestNote(p, allowed);
      // hysteresis: only change note once clearly past the midpoint
      if (cand !== cur && Math.abs(p - cand) + 0.2 < Math.abs(p - cur)) cur = cand;
      const c = slow[k - i];
      const pc = c + (1 - vibrato) * (m[k] - c); // the part of the pitch we correct
      const shift = cur - pc;
      s = s === null ? shift : s + (shift - s) * retAlpha;
      inMidi[k] = m[k];
      outMidi[k] = m[k] + amount * s;
      note[k] = cur;
    }
    i = j;
  }
  return { inMidi, outMidi, note };
}

/**
 * TD-PSOLA pitch shift of every channel along one set of pitch marks.
 * @param {Float32Array[]} chans   audio channels at sr
 * @param {Float32Array} mono      analysis signal (same length)
 * @param {{inMidi:Float32Array,outMidi:Float32Array}} curve  per frame
 * @param {number} hopSec          frame hop
 */
export function psola(chans, mono, sr, curve, hopSec) {
  const N = mono.length;
  const nF = curve.inMidi.length;
  const frameAt = (t) => Math.min(nF - 1, Math.max(0, Math.round(t / sr / hopSec)));
  // low-passed copy for stable peak picking
  const lp = new Float32Array(N);
  {
    const a = Math.exp((-2 * Math.PI * 900) / sr);
    let y1 = 0, y2 = 0;
    for (let i = 0; i < N; i++) { y1 = a * y1 + (1 - a) * mono[i]; y2 = a * y2 + (1 - a) * y1; lp[i] = y2; }
    // two cascaded one-poles delay the waveform a little; compensate
    const d = Math.round((2 * a) / (1 - a));
    for (let i = 0; i < N - d; i++) lp[i] = lp[i + d];
  }
  const uvP = Math.round(0.005 * sr);
  // analysis marks
  const pos = [], per = [], voi = [];
  let t = 0, prevVoiced = false;
  while (t < N) {
    const f = frameAt(t);
    const mi = curve.inMidi[f];
    if (Number.isFinite(mi)) {
      const P = Math.max(16, Math.round(sr / (440 * Math.pow(2, (mi - 69) / 12))));
      let c = t;
      // align to the waveform peak near the expected position
      const lo = Math.max(0, t - Math.round(P * (prevVoiced ? 0.2 : 0.5))), hi = Math.min(N - 1, t + Math.round(P * (prevVoiced ? 0.2 : 0.5)));
      let best = -Infinity;
      for (let k = lo; k <= hi; k++) if (lp[k] > best) { best = lp[k]; c = k; }
      if (pos.length && c <= pos[pos.length - 1]) c = pos[pos.length - 1] + Math.max(1, Math.round(P * 0.5));
      pos.push(c); per.push(P); voi.push(1);
      t = c + P;
      prevVoiced = true;
    } else {
      pos.push(t); per.push(uvP); voi.push(0);
      t += uvP;
      prevVoiced = false;
    }
  }
  const M = pos.length;
  const outs = chans.map(() => new Float32Array(N));
  const wsum = new Float32Array(N);
  let k = 0;
  let ts = pos[0] || 0;
  while (ts < N && M) {
    while (k + 1 < M && Math.abs(pos[k + 1] - ts) <= Math.abs(pos[k] - ts)) k++;
    const P = per[k];
    let r = 1;
    if (voi[k]) {
      const f = frameAt(ts);
      const a = curve.inMidi[f], b = curve.outMidi[f];
      if (Number.isFinite(a) && Number.isFinite(b)) r = Math.pow(2, (b - a) / 12);
    }
    const center = Math.round(ts), src = pos[k];
    for (let j = -P + 1; j < P; j++) {
      const d = center + j, s = src + j;
      if (d < 0 || d >= N || s < 0 || s >= N) continue;
      const w = 0.5 + 0.5 * Math.cos((Math.PI * j) / P);
      for (let c = 0; c < chans.length; c++) outs[c][d] += chans[c][s] * w;
      wsum[d] += w;
    }
    ts += Math.max(4, P / r);
  }
  for (let i = 0; i < N; i++) {
    const w = wsum[i];
    if (w > 1e-3) {
      const g = 1 / Math.max(w, 0.35);
      for (const o of outs) o[i] *= g;
    }
  }
  return { channels: outs, marks: M };
}

/** Whole pipeline on an already tracked vocal. */
export function autotune(chans, sr, track, settings) {
  const n = chans[0].length;
  const mono = new Float32Array(n);
  for (const c of chans) for (let i = 0; i < n; i++) mono[i] += c[i] / chans.length;
  const curve = correctionCurve(track, settings);
  const { channels } = psola(chans, mono, sr, curve, track.hopSec);
  // how much did we move things?
  let moved = 0, cents = 0, voicedFrames = 0;
  for (let i = 0; i < curve.inMidi.length; i++) {
    if (!Number.isFinite(curve.inMidi[i])) continue;
    voicedFrames++;
    const d = Math.abs(curve.outMidi[i] - curve.inMidi[i]) * 100;
    cents += d;
    if (d > 5) moved++;
  }
  return { channels, curve, stats: { voicedFrames, avgCents: voicedFrames ? cents / voicedFrames : 0, movedPct: voicedFrames ? (100 * moved) / voicedFrames : 0 } };
}
