// STFT front-end shared by the analysers (librosa conventions: centred frames,
// zero padding, periodic Hann window, magnitude = |X|).
import { getFFT, hann } from "./fft.js";

/**
 * @returns {{ data: Float32Array, frames: number, bins: number, hop: number, nfft: number, sr: number }}
 *          data[t * bins + k] = |STFT|
 */
export function stftMag(x, sr, { nfft = 2048, hop = 512, center = true, onProgress = null } = {}) {
  const fft = getFFT(nfft);
  const win = hann(nfft);
  const pad = center ? nfft >> 1 : 0;
  const frames = 1 + Math.floor((x.length + 2 * pad - nfft) / hop);
  const bins = (nfft >> 1) + 1;
  const data = new Float32Array(Math.max(0, frames) * bins);
  const buf = new Float32Array(nfft);
  const re = new Float64Array(bins), im = new Float64Array(bins);
  for (let t = 0; t < frames; t++) {
    const start = t * hop - pad;
    for (let i = 0; i < nfft; i++) {
      const j = start + i;
      buf[i] = j >= 0 && j < x.length ? x[j] * win[i] : 0;
    }
    fft.forward(buf, re, im);
    const o = t * bins;
    for (let k = 0; k < bins; k++) data[o + k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    if (onProgress && t % 256 === 0) onProgress(t / frames);
  }
  return { data, frames, bins, hop, nfft, sr };
}

/** Frame-wise RMS (librosa.feature.rms with center=True). */
export function rmsFrames(x, { frameLength = 2048, hop = 512 } = {}) {
  const pad = frameLength >> 1;
  const frames = 1 + Math.floor(x.length / hop);
  const out = new Float32Array(frames);
  for (let t = 0; t < frames; t++) {
    let s = 0;
    const start = t * hop - pad;
    for (let i = 0; i < frameLength; i++) {
      const j = start + i;
      const v = j >= 0 && j < x.length ? x[j] : 0;
      s += v * v;
    }
    out[t] = Math.sqrt(s / frameLength);
  }
  return out;
}

/** Sliding median of odd width k with reflect padding (scipy.ndimage.median_filter). */
export function medianFilter(x, k) {
  const n = x.length, h = k >> 1;
  const out = new Float32Array(n);
  const win = [];
  const at = (i) => x[i < 0 ? -i - 1 : i >= n ? 2 * n - i - 1 : i];
  const insert = (v) => {
    let lo = 0, hi = win.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (win[m] < v) lo = m + 1; else hi = m; }
    win.splice(lo, 0, v);
  };
  const remove = (v) => {
    let lo = 0, hi = win.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (win[m] < v) lo = m + 1; else hi = m; }
    win.splice(lo, 1);
  };
  for (let i = -h; i <= h; i++) insert(at(i));
  for (let i = 0; i < n; i++) {
    out[i] = win[h];
    remove(at(i - h));
    insert(at(i + h + 1));
  }
  return out;
}

/**
 * Harmonic/percussive separation on a magnitude spectrogram (Fitzgerald;
 * librosa.decompose.hpss with kernel 31, power 2, soft masks).
 * Returns harmonic magnitudes (same layout as spec.data).
 */
export function hpssHarmonic(spec, kernel = 31) {
  const { data, frames, bins } = spec;
  const H = new Float32Array(data.length);
  const P = new Float32Array(data.length);
  const col = new Float32Array(frames);
  for (let k = 0; k < bins; k++) {
    for (let t = 0; t < frames; t++) col[t] = data[t * bins + k];
    const m = medianFilter(col, kernel);
    for (let t = 0; t < frames; t++) H[t * bins + k] = m[t];
  }
  for (let t = 0; t < frames; t++) {
    const m = medianFilter(data.subarray(t * bins, (t + 1) * bins), kernel);
    P.set(m, t * bins);
  }
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const h2 = H[i] * H[i], p2 = P[i] * P[i];
    const s = h2 + p2;
    out[i] = s > 0 ? (data[i] * h2) / s : 0;
  }
  return out;
}

export const binFreq = (k, sr, nfft) => (k * sr) / nfft;
