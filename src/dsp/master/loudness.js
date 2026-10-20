// Loudness to ITU-R BS.1770-4 / EBU R128:
//   K-weighting (pre-filter shelf + RLB high-pass) for any sample rate,
//   momentary (400 ms) and short-term (3 s) loudness at a 100 ms hop,
//   gated integrated loudness, EBU Tech 3342 loudness range (LRA),
//   and true peak from a 4× polyphase interpolator.

import { Biquad } from "./biquad.js";

/**
 * K-weighting coefficients. The two analogue prototypes are re-derived per
 * sample rate (bilinear transform with pre-warping, as libebur128 does); at
 * 48 kHz they reproduce the coefficient tables in BS.1770.
 */
export function kCoeffs(sr) {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sr);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const pre = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0
  };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sr);
  a0 = 1 + K / Q + K * K;
  const rlb = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  return { pre, rlb };
}

export const energyToLufs = (z) => (z > 0 ? -0.691 + 10 * Math.log10(z) : -Infinity);
export const lufsToEnergy = (l) => Math.pow(10, (l + 0.691) / 10);

/* ---------------- true peak: 4× polyphase windowed-sinc ---------------- */

function besselI0(x) {
  let sum = 1, term = 1;
  for (let k = 1; k < 40; k++) {
    term *= (x / (2 * k)) * (x / (2 * k));
    sum += term;
    if (term < 1e-12 * sum) break;
  }
  return sum;
}

/**
 * 32 taps per phase (longer than BS.1770's example filter: material with
 * energy near Nyquist, e.g. square waves or clipped drums, otherwise
 * under-reads by up to 1 dB). Phase 0 is the original sample, TP_DELAY late.
 */
export const TP_TAPS = 32;
export const TP_DELAY = 16;
export const TP_PHASES = (() => {
  const N = 4 * TP_TAPS + 1, C = (N - 1) / 2, beta = 8.5;
  const h = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    const t = (n - C) / 4;
    const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
    const r = (2 * n) / (N - 1) - 1;
    h[n] = sinc * (besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / besselI0(beta));
  }
  const phases = [];
  for (let p = 1; p < 4; p++) {
    const c = new Float64Array(TP_TAPS);
    let s = 0;
    for (let j = 0; j < TP_TAPS; j++) { c[j] = h[4 * j + p]; s += c[j]; }
    for (let j = 0; j < TP_TAPS; j++) c[j] /= s; // exact unity gain at DC
    phases.push(c);
  }
  return phases;
})();

/** Worst-case gain of an interpolation phase: |y| ≤ TP_L1 · max|x| over its taps. */
export const TP_L1 = Math.max(...TP_PHASES.map((c) => c.reduce((s, v) => s + Math.abs(v), 0)));

/**
 * Streaming 4× oversampled peak of one channel. push(x) returns the largest
 * magnitude among the original sample (delayed by TP_DELAY) and the three
 * interpolated points that follow it.
 */
export class TruePeakChannel {
  constructor() {
    this.buf = new Float64Array(TP_TAPS * 2); // doubled ring: contiguous reads
    this.pos = 0;
    // interpolation is skipped while every sample in the filter's reach is
    // below thr (then no interpolated point can exceed thr · TP_L1)
    this.thr = 0;
    this.hot = 0;
  }

  reset() {
    this.buf.fill(0);
    this.pos = 0;
    this.hot = 0;
  }

  push(x) {
    const T = TP_TAPS, b = this.buf;
    this.pos = (this.pos + 1) % T;
    b[this.pos] = x;
    b[this.pos + T] = x;
    // newest sample at b[pos + T], x[n - j] at b[pos + T - j]
    const base = this.pos + T;
    let peak = Math.abs(b[base - TP_DELAY]);
    if ((x < 0 ? -x : x) >= this.thr) this.hot = T;
    if (this.hot <= 0) return peak;
    this.hot--;
    for (let p = 0; p < 3; p++) {
      const c = TP_PHASES[p];
      let s = 0;
      for (let j = 0; j < T; j++) s += c[j] * b[base - j];
      const a = s < 0 ? -s : s;
      if (a > peak) peak = a;
    }
    return peak;
  }
}

/* ---------------- loudness meter ---------------- */

export class LoudnessMeter {
  /**
   * @param {number} sr
   * @param {{ history?: boolean }} opts history=false keeps only the live
   *   momentary/short-term values (for the real-time meters).
   */
  constructor(sr, { history = true } = {}) {
    this.sr = sr;
    this.history = history;
    const { pre, rlb } = kCoeffs(sr);
    this.kL = [new Biquad(pre), new Biquad(rlb)];
    this.kR = [new Biquad(pre), new Biquad(rlb)];
    this.hop = Math.round(sr * 0.1);
    this.reset();
  }

  reset() {
    for (const f of [...this.kL, ...this.kR]) f.reset();
    this.acc = 0;
    this.count = 0;
    this.ring = new Float64Array(30);
    this.subs = 0;
    this.blocks = []; // 400 ms block energies, 100 ms hop (integrated gating)
    this.st = []; // short-term loudness values at 100 ms hop (LRA)
    this.momentary = -Infinity;
    this.shortTerm = -Infinity;
    this.maxMomentary = -Infinity;
    this.maxShortTerm = -Infinity;
  }

  /** Push n frames (R may be null for mono = dual-mono). */
  push(L, R, n = L.length, offset = 0) {
    const [a1, a2] = this.kL, [b1, b2] = this.kR;
    let acc = this.acc, count = this.count;
    const hop = this.hop;
    for (let i = offset; i < offset + n; i++) {
      const l = a2.tick(a1.tick(L[i]));
      const r = R ? b2.tick(b1.tick(R[i])) : l;
      acc += l * l + r * r;
      if (++count === hop) {
        this._sub(acc / hop);
        acc = 0;
        count = 0;
      }
    }
    this.acc = acc;
    this.count = count;
  }

  _sub(e) {
    this.ring[this.subs % 30] = e;
    this.subs++;
    if (this.subs >= 4) {
      let z = 0;
      for (let k = 1; k <= 4; k++) z += this.ring[(this.subs - k) % 30];
      z /= 4;
      this.momentary = energyToLufs(z);
      if (this.momentary > this.maxMomentary) this.maxMomentary = this.momentary;
      if (this.history) this.blocks.push(z);
    }
    if (this.subs >= 30) {
      let z = 0;
      for (let k = 0; k < 30; k++) z += this.ring[k];
      z /= 30;
      this.shortTerm = energyToLufs(z);
      if (this.shortTerm > this.maxShortTerm) this.maxShortTerm = this.shortTerm;
      if (this.history) this.st.push(this.shortTerm);
    }
  }

  /** Gated integrated loudness (LUFS). */
  integrated() {
    return gatedLoudness(this.blocks);
  }

  /** Loudness range (LU), EBU Tech 3342. */
  lra() {
    const abs = this.st.filter((l) => l > -70);
    if (abs.length < 2) return 0;
    const mean = abs.reduce((s, l) => s + lufsToEnergy(l), 0) / abs.length;
    const rel = energyToLufs(mean) - 20;
    const v = abs.filter((l) => l > rel).sort((x, y) => x - y);
    if (v.length < 2) return 0;
    const pct = (p) => {
      const idx = (v.length - 1) * p;
      const lo = Math.floor(idx), hi = Math.ceil(idx);
      return v[lo] + (v[hi] - v[lo]) * (idx - lo);
    };
    return pct(0.95) - pct(0.1);
  }
}

/** BS.1770 two-stage gating over 400 ms block energies. */
export function gatedLoudness(blocks) {
  let s = 0, n = 0;
  const absE = lufsToEnergy(-70);
  for (const z of blocks) if (z > absE) { s += z; n++; }
  if (!n) return -Infinity;
  const relE = (s / n) * Math.pow(10, -1); // −10 LU
  s = 0; n = 0;
  for (const z of blocks) if (z > absE && z > relE) { s += z; n++; }
  return n ? energyToLufs(s / n) : -Infinity;
}

/**
 * High-accuracy true peak (64 taps per phase) for the final check on an
 * export. Only stretches within reach of floorDb are interpolated.
 * @returns {number} dBTP
 */
let ACC = null;
export function verifyTruePeak(L, R, { floorDb = -6 } = {}) {
  if (!ACC) {
    const T = 64, N = 4 * T + 1, C = (N - 1) / 2, beta = 9.5;
    const h = new Float64Array(N);
    for (let n = 0; n < N; n++) {
      const t = (n - C) / 4;
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      const r = (2 * n) / (N - 1) - 1;
      h[n] = sinc * (besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / besselI0(beta));
    }
    const ph = [1, 2, 3].map((p) => {
      const c = new Float64Array(T);
      let s = 0;
      for (let j = 0; j < T; j++) { c[j] = h[4 * j + p]; s += c[j]; }
      return c.map((v) => v / s);
    });
    const l1 = Math.max(...ph.map((c) => c.reduce((s, v) => s + Math.abs(v), 0)));
    ACC = { T, ph, l1 };
  }
  const { T, ph, l1 } = ACC;
  const thr = Math.pow(10, floorDb / 20) / l1;
  let peak = 0;
  for (const x of R && R !== L ? [L, R] : [L]) {
    const n = x.length;
    let hot = 0;
    for (let i = 0; i < n + T; i++) {
      const v = i < n ? x[i] : 0;
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
      if (a >= thr) hot = T;
      if (hot <= 0) continue;
      hot--;
      // interpolate between x[i - T/2] and x[i - T/2 + 1]
      for (let p = 0; p < 3; p++) {
        const c = ph[p];
        let s = 0;
        for (let j = 0; j < T; j++) { const k = i - j; if (k >= 0 && k < n) s += c[j] * x[k]; }
        const m = s < 0 ? -s : s;
        if (m > peak) peak = m;
      }
    }
  }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

/**
 * One-shot measurement of a stereo (or mono) signal.
 * @returns {{ integrated:number, lra:number, truePeakDb:number, samplePeakDb:number, maxMomentary:number, maxShortTerm:number, duration:number }}
 */
export function measure(L, R, sr, { truePeak = true } = {}) {
  const m = new LoudnessMeter(sr);
  m.push(L, R, L.length);
  let sp = 0, tp = 0;
  const tl = new TruePeakChannel(), tr = new TruePeakChannel();
  for (let i = 0; i < L.length; i++) {
    const l = L[i], r = R ? R[i] : l;
    const al = l < 0 ? -l : l, ar = r < 0 ? -r : r;
    if (al > sp) sp = al;
    if (ar > sp) sp = ar;
    if (truePeak) {
      const a = tl.push(l), b = R ? tr.push(r) : a;
      if (a > tp || b > tp) {
        tp = a > b ? a : b;
        tl.thr = tr.thr = tp / TP_L1; // quieter stretches can't beat the max so far
      }
    }
  }
  if (truePeak) {
    // flush the interpolator's delay line
    for (let i = 0; i < TP_TAPS; i++) {
      const a = tl.push(0), b = R ? tr.push(0) : a;
      if (a > tp) tp = a;
      if (b > tp) tp = b;
    }
  }
  const db = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
  return {
    integrated: m.integrated(),
    lra: m.lra(),
    truePeakDb: truePeak ? db(Math.max(tp, sp)) : db(sp),
    samplePeakDb: db(sp),
    maxMomentary: m.maxMomentary,
    maxShortTerm: m.maxShortTerm,
    duration: L.length / sr
  };
}
