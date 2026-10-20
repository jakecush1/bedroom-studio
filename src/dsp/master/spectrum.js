// Long-term average spectrum (LTAS) in fractional-octave bands, for the
// mastering assistant's tonal-balance decisions and the panel's spectrum view.
// Mid and side are measured separately; quiet frames (more than `gateDb`
// below the loudest frame) are skipped so intros and fades don't skew it.

import { getFFT, hann } from "../fft.js";

/** Band centre frequencies, `fraction` bands per octave, aligned to 1 kHz. */
export function bandCenters(fraction = 6, fmin = 25, fmax = 20000) {
  const out = [];
  const k0 = Math.ceil(fraction * Math.log2(fmin / 1000));
  const k1 = Math.floor(fraction * Math.log2(fmax / 1000));
  for (let k = k0; k <= k1; k++) out.push(1000 * Math.pow(2, k / fraction));
  return out;
}

/**
 * Sum PSD power into bands, weighting each FFT bin by how much of it falls
 * inside the band (so bands narrower than a bin still get a fair share).
 */
export function psdToBands(psd, sr, nfft, centers, fraction) {
  const df = sr / nfft;
  const half = Math.pow(2, 1 / (2 * fraction));
  const out = new Float64Array(centers.length);
  for (let b = 0; b < centers.length; b++) {
    const lo = centers[b] / half, hi = Math.min(centers[b] * half, sr / 2);
    const k0 = Math.max(0, Math.floor(lo / df - 0.5)), k1 = Math.min(psd.length - 1, Math.ceil(hi / df + 0.5));
    let p = 0;
    for (let k = k0; k <= k1; k++) {
      const a = Math.max(lo, (k - 0.5) * df), z = Math.min(hi, (k + 0.5) * df);
      if (z > a) p += (psd[k] * (z - a)) / df;
    }
    out[b] = p;
  }
  return out;
}

/**
 * @returns {{ centers:number[], mid:Float64Array, side:Float64Array, frames:number }}
 *   band powers in dB (unnormalised: absolute level relative to full scale)
 */
export function ltas(L, R, sr, { nfft = 8192, fraction = 6, gateDb = 20, maxFrames = 1400 } = {}) {
  R = R || L;
  const n = L.length;
  const fft = getFFT(nfft);
  const win = hann(nfft);
  let wpow = 0;
  for (let i = 0; i < nfft; i++) wpow += win[i] * win[i];
  // frame energies for gating
  const hop = Math.max(nfft, Math.floor(n / maxFrames));
  const starts = [];
  const energy = [];
  for (let s = 0; s + nfft <= n; s += hop) {
    let e = 0;
    for (let i = s; i < s + nfft; i += 4) {
      const m = L[i] + R[i];
      e += m * m;
    }
    starts.push(s);
    energy.push(e);
  }
  if (!starts.length && n > 0) { starts.push(0); energy.push(1); }
  const maxE = Math.max(...energy, 1e-30);
  const thr = maxE * Math.pow(10, -gateDb / 10);
  const bins = nfft / 2 + 1;
  const pm = new Float64Array(bins), ps = new Float64Array(bins);
  const bm = new Float32Array(nfft), bs = new Float32Array(nfft);
  const re = new Float64Array(bins), im = new Float64Array(bins);
  let used = 0;
  for (let f = 0; f < starts.length; f++) {
    if (energy[f] < thr) continue;
    const s = starts[f];
    for (let i = 0; i < nfft; i++) {
      const j = s + i;
      const l = j < n ? L[j] : 0, r = j < n ? R[j] : 0;
      bm[i] = 0.5 * (l + r) * win[i];
      bs[i] = 0.5 * (l - r) * win[i];
    }
    fft.forward(bm, re, im);
    for (let k = 0; k < bins; k++) pm[k] += re[k] * re[k] + im[k] * im[k];
    fft.forward(bs, re, im);
    for (let k = 0; k < bins; k++) ps[k] += re[k] * re[k] + im[k] * im[k];
    used++;
  }
  // one-sided PSD scaled so a full-scale sine reads about 0 dB in its band
  const scale = 2 / (Math.max(used, 1) * wpow);
  for (let k = 0; k < bins; k++) { pm[k] *= scale; ps[k] *= scale; }
  const centers = bandCenters(fraction);
  const toDb = (arr) => {
    const b = psdToBands(arr, sr, nfft, centers, fraction);
    const out = new Float64Array(b.length);
    for (let i = 0; i < b.length; i++) out[i] = 10 * Math.log10(b[i] + 1e-20);
    return out;
  };
  return { centers, mid: toDb(pm), side: toDb(ps), frames: used, fraction };
}

/** Mean of band dB values whose centre lies in [f0, f1]. */
export function bandMean(centers, db, f0, f1) {
  let s = 0, n = 0;
  for (let i = 0; i < centers.length; i++) if (centers[i] >= f0 && centers[i] <= f1) { s += db[i]; n++; }
  return n ? s / n : 0;
}

/** Normalise a band curve so its 200 Hz – 5 kHz mean is 0 dB. */
export function normalizeCurve(centers, db) {
  const m = bandMean(centers, db, 200, 5000);
  return Float64Array.from(db, (v) => v - m);
}

/**
 * Smooth a band curve with a triangular kernel `octaves` wide (log axis).
 */
export function smoothCurve(centers, db, octaves = 1 / 3) {
  const out = new Float64Array(db.length);
  for (let i = 0; i < db.length; i++) {
    let s = 0, w = 0;
    for (let j = 0; j < db.length; j++) {
      const d = Math.abs(Math.log2(centers[j] / centers[i]));
      if (d >= octaves) continue;
      const k = 1 - d / octaves;
      s += db[j] * k;
      w += k;
    }
    out[i] = s / w;
  }
  return out;
}

/** Linear interpolation of a band curve at frequency f (log axis). */
export function curveAt(centers, db, f) {
  if (f <= centers[0]) return db[0];
  const n = centers.length;
  if (f >= centers[n - 1]) return db[n - 1];
  const x = Math.log2(f);
  let i = 1;
  while (i < n - 1 && centers[i] < f) i++;
  const x0 = Math.log2(centers[i - 1]), x1 = Math.log2(centers[i]);
  const t = (x - x0) / (x1 - x0);
  return db[i - 1] + (db[i] - db[i - 1]) * t;
}
