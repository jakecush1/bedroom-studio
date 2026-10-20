// Compressor (feed-forward, soft knee, smooth decoupled attack/release in the
// dB domain, after Giannoulis, Massberg & Reiss 2012) and 2× oversampling for
// the saturation and clipping stages.

const LOG10 = Math.LN10;
const toDb = (x) => (x > 1e-9 ? (20 * Math.log(x)) / LOG10 : -180);

export class Compressor {
  constructor(sr) {
    this.sr = sr;
    this.p = 0; // detector power
    this.gr = 0; // smoothed gain reduction, dB (≥ 0)
    // the gain law runs every 4 samples; the linear gain ramps in between
    this.k = 0;
    this.g = 1;
    this.dg = 0;
    this.set({});
  }

  /**
   * @param {{threshold?:number, ratio?:number, knee?:number, attack?:number, release?:number, rmsMs?:number, makeup?:number}} o
   *   threshold dB, ratio ≥ 1, knee dB, attack/release ms, detector RMS window ms
   */
  set({ threshold = 0, ratio = 1, knee = 6, attack = 10, release = 120, rmsMs = 5, makeup = 0 } = {}) {
    const sr = this.sr;
    this.threshold = threshold;
    this.ratio = Math.max(1, ratio);
    this.knee = Math.max(0, knee);
    this.aA = Math.exp(-4 / (sr * Math.max(attack, 0.05) * 0.001));
    this.aR = Math.exp(-4 / (sr * Math.max(release, 1) * 0.001));
    this.aP = Math.exp(-1 / (sr * Math.max(rmsMs, 0.05) * 0.001));
    this.makeup = makeup;
    this.active = this.ratio > 1.0001;
    return this;
  }

  reset() {
    this.p = 0;
    this.gr = 0;
    this.k = 0;
    this.g = 1;
    this.dg = 0;
  }

  /** Static curve: gain reduction (dB, ≥ 0) for an input level in dB. */
  curve(xDb) {
    const T = this.threshold, R = this.ratio, W = this.knee;
    const d = xDb - T;
    if (2 * d < -W) return 0;
    if (W > 0 && 2 * Math.abs(d) <= W) {
      const k = d + W / 2;
      return ((1 - 1 / R) * k * k) / (2 * W);
    }
    return d * (1 - 1 / R);
  }

  /** Feed the detector with a (linked) sample level; returns the linear gain. */
  gain(level) {
    if (!this.active) {
      this.gr = 0;
      return this.makeup ? Math.pow(10, this.makeup / 20) : 1;
    }
    this.p = this.aP * this.p + (1 - this.aP) * level * level;
    if (--this.k <= 0) {
      this.k = 4;
      const target = this.curve(toDb(Math.sqrt(this.p)));
      const a = target > this.gr ? this.aA : this.aR;
      this.gr = a * this.gr + (1 - a) * target;
      this.dg = (Math.exp(((this.makeup - this.gr) * LOG10) / 20) - this.g) / 4;
    }
    this.g += this.dg;
    return this.g;
  }
}

/* ---------------- 2× oversampling (polyphase half-band FIR) ---------------- */

// 47-tap Kaiser half-band: centre tap 0.5, every other tap zero.
const HB = (() => {
  const N = 47, C = (N - 1) / 2, beta = 8;
  const I0 = (x) => { let s = 1, t = 1; for (let k = 1; k < 40; k++) { t *= (x / (2 * k)) ** 2; s += t; } return s; };
  const h = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    const t = (n - C) / 2;
    const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
    const r = (2 * n) / (N - 1) - 1;
    h[n] = 0.5 * sinc * (I0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / I0(beta));
  }
  // exact unity gain: the interpolating taps (even n) sum to 0.5, the centre is 0.5
  let even = 0;
  for (let n = 0; n < N; n += 2) even += h[n];
  for (let n = 0; n < N; n += 2) h[n] *= 0.5 / even;
  return h;
})();
const HB_N = HB.length; // 47
const HB_C = (HB_N - 1) / 2; // 23, odd: the odd output phase is the input itself
const HB_E = Float64Array.from({ length: (HB_N + 1) / 2 }, (_, j) => 2 * HB[2 * j]); // 24 interpolation taps
const HB_D = (HB_C - 1) / 2; // 11: odd phase = x[M - 11]

/**
 * Runs a per-sample function at twice the sample rate. process(x, fn) returns
 * the function's output, band-limited and decimated, delayed by exactly
 * `latency` (23) input samples.
 */
export class Oversampler2x {
  constructor() {
    this.T = HB_E.length;
    this.xr = new Float64Array(this.T * 2);
    this.xp = 0;
    this.wr = new Float64Array(HB_N * 2);
    this.wp = 0;
    this.latency = HB_C;
  }

  reset() {
    this.xr.fill(0);
    this.wr.fill(0);
    this.xp = this.wp = 0;
  }

  _w(v) {
    this.wp = (this.wp + 1) % HB_N;
    this.wr[this.wp] = v;
    this.wr[this.wp + HB_N] = v;
  }

  process(x, fn) {
    const T = this.T, xr = this.xr;
    this.xp = (this.xp + 1) % T;
    xr[this.xp] = x;
    xr[this.xp + T] = x;
    const xb = this.xp + T;
    // even 2× sample: interpolated, input time M - 11.5
    let e = 0;
    for (let j = 0; j < T; j++) e += HB_E[j] * xr[xb - j];
    this._w(fn(e));
    // decimate on the even phase → input time M - 23 (integer latency)
    const wr = this.wr, wb = this.wp + HB_N;
    // half-band: odd taps are zero except the centre (0.5)
    let y = 0.5 * wr[wb - HB_C];
    for (let n = 0; n < HB_N; n += 2) y += HB[n] * wr[wb - n];
    // odd 2× sample: the original input, time M - 11
    this._w(fn(xr[xb - HB_D]));
    return y;
  }
}
