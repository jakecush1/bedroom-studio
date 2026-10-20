// Look-ahead brickwall limiter with true-peak detection.
//
// Gain computer: the gain each sample needs (ceiling / 4× interpolated peak),
// a running minimum over the look-ahead window W, then a W-long moving
// average. Delaying the audio by W − 1 (+ the interpolator's lag) guarantees
// the averaged gain has reached the needed value when the peak arrives, with a
// smooth (no-click) attack. Release is exponential and program-dependent:
// short for isolated transients, slower when limiting is sustained so dense
// passages don't pump or distort.

import { TruePeakChannel, TP_DELAY, TP_L1 } from "./loudness.js";

export class Limiter {
  constructor(sr, { lookaheadMs = 2, ceilingDb = -1, releaseMs = 50, slowReleaseMs = 350, truePeak = true } = {}) {
    this.sr = sr;
    this.truePeak = truePeak;
    this.W = Math.max(8, Math.round((sr * lookaheadMs) / 1000));
    this.lag = truePeak ? TP_DELAY : 0;
    this.latency = this.W - 1 + this.lag;
    const D = this.latency + 1;
    this.dl = new Float64Array(D);
    this.dr = new Float64Array(D);
    this.dpos = 0;
    this.tl = new TruePeakChannel();
    this.tr = new TruePeakChannel();
    // monotonic deque (ring) for the running minimum
    this.qv = new Float64Array(this.W + 1);
    this.qi = new Float64Array(this.W + 1);
    this.box = new Float64Array(this.W);
    this.set({ ceilingDb, releaseMs, slowReleaseMs });
    this.reset();
  }

  set({ ceilingDb = this.ceilingDb, releaseMs = this.releaseMs, slowReleaseMs = this.slowReleaseMs } = {}) {
    this.ceilingDb = ceilingDb;
    this.releaseMs = releaseMs;
    this.slowReleaseMs = slowReleaseMs;
    this.ceil = Math.pow(10, ceilingDb / 20);
    // samples this far under the ceiling can't produce an over: skip interpolation
    this.tl.thr = this.tr.thr = this.ceil / TP_L1;
    this.cFast = Math.exp(-1 / ((this.sr * releaseMs) / 1000));
    this.cSlow = Math.exp(-1 / ((this.sr * slowReleaseMs) / 1000));
    this.cAvg = Math.exp(-1 / (this.sr * 0.4));
    return this;
  }

  reset() {
    this.dl.fill(0);
    this.dr.fill(0);
    this.dpos = 0;
    this.tl.reset();
    this.tr.reset();
    this.qh = 0;
    this.qn = 0;
    this.n = 0;
    this.box.fill(1);
    this.boxSum = this.W;
    this.bpos = 0;
    this.g = 1;
    this.grAvg = 0;
    this.grMax = 0; // deepest reduction since the meter last read it (linear gain)
    this.minGain = 1;
  }

  /** Gain needed for one stereo sample (peak estimate → ceiling / peak). */
  _need(l, r) {
    let p;
    if (this.truePeak) {
      const a = this.tl.push(l), b = this.tr.push(r);
      p = a > b ? a : b;
    } else {
      const a = l < 0 ? -l : l, b = r < 0 ? -r : r;
      p = a > b ? a : b;
    }
    return p > this.ceil ? this.ceil / p : 1;
  }

  /** In-place on n samples starting at offset. R may equal L for mono. */
  process(L, R, n = L.length, offset = 0) {
    const W = this.W, qv = this.qv, qi = this.qi, Q = W + 1, box = this.box;
    const D = this.dl.length;
    let { qh, qn, g, boxSum, bpos, grAvg, dpos } = this;
    let k = this.n;
    let minGain = this.minGain;
    const ceil = this.ceil;
    for (let i = offset; i < offset + n; i++, k++) {
      const l = L[i], r = R[i];
      const need = this._need(l, r);
      // running minimum over the last W needs
      while (qn > 0 && qv[(qh + qn - 1) % Q] >= need) qn--;
      qv[(qh + qn) % Q] = need;
      qi[(qh + qn) % Q] = k;
      qn++;
      while (qi[qh] <= k - W) { qh = (qh + 1) % Q; qn--; }
      const h = qv[qh];
      // W-long moving average of the held minimum
      boxSum += h - box[bpos];
      box[bpos] = h;
      bpos = bpos + 1 === W ? 0 : bpos + 1;
      const s = boxSum / W;
      // program-dependent release
      if (s < g) g = s;
      else {
        const t = grAvg > 0.25 ? 1 : grAvg * 4;
        const c = this.cFast + (this.cSlow - this.cFast) * t;
        g = s - (s - g) * c;
      }
      grAvg = this.cAvg * grAvg + (1 - this.cAvg) * (1 - g);
      if (g < minGain) minGain = g;
      // delayed audio out
      const ol = this.dl[dpos], or = this.dr[dpos];
      this.dl[dpos] = l;
      this.dr[dpos] = r;
      dpos = dpos + 1 === D ? 0 : dpos + 1;
      let yl = ol * g, yr = or * g;
      // last-resort sample clamp (inter-sample overs are handled by the detector)
      if (yl > ceil) yl = ceil; else if (yl < -ceil) yl = -ceil;
      if (yr > ceil) yr = ceil; else if (yr < -ceil) yr = -ceil;
      L[i] = yl;
      R[i] = yr;
    }
    // guard against accumulated rounding in the running sum
    if ((k & 0xffff) < n) {
      let s = 0;
      for (let j = 0; j < W; j++) s += box[j];
      boxSum = s;
    }
    Object.assign(this, { qh, qn, g, boxSum, bpos, grAvg, dpos, n: k, minGain });
  }

  /** Deepest gain reduction (dB, ≥ 0) since the last call; resets the hold. */
  takeReduction() {
    const db = -20 * Math.log10(Math.max(this.minGain, 1e-6));
    this.minGain = this.g;
    return db;
  }
}

/**
 * Smooth clipper curve normalised to `limit`: linear below knee·limit,
 * tanh-shaped above, never exceeding limit. Used at 2× oversampling.
 */
export function softClip(x, limit, knee = 0.75) {
  const a = x < 0 ? -x : x;
  const k = knee * limit;
  if (a <= k) return x;
  const span = limit - k;
  const y = k + span * Math.tanh((a - k) / span);
  return x < 0 ? -y : y;
}
