// Harmonic/percussive separation (Fitzgerald 2010) with soft Wiener masks and
// time-domain reconstruction. Same idea as the HPSS step in the Melody
// extractor's extract_melody(): the harmonic signal goes to transcription
// (drums out of the way), the percussive spectrogram to drum detection.

import { getFFT, hann } from "../fft.js";
import { medianFilter } from "../spectral.js";

/**
 * @param {Float32Array} x  mono signal
 * @returns {{ harmonic: Float32Array|null, perc: {data:Float32Array, harm:Float32Array, frames:number, bins:number, hop:number, nfft:number, sr:number} }}
 */
export function hpss(x, sr, { nfft = 2048, hop = 512, kernelT = 17, kernelF = 17, reconstruct = true, onProgress = null } = {}) {
  const fft = getFFT(nfft);
  const win = hann(nfft);
  const bins = nfft / 2 + 1, pad = nfft / 2;
  const frames = 1 + Math.floor((x.length + 2 * pad - nfft) / hop);
  const RE = new Float32Array(frames * bins), IM = new Float32Array(frames * bins), MAG = new Float32Array(frames * bins);
  const buf = new Float32Array(nfft), re = new Float64Array(bins), im = new Float64Array(bins);
  for (let t = 0; t < frames; t++) {
    const s = t * hop - pad;
    for (let i = 0; i < nfft; i++) {
      const j = s + i;
      buf[i] = j >= 0 && j < x.length ? x[j] * win[i] : 0;
    }
    fft.forward(buf, re, im);
    const o = t * bins;
    for (let k = 0; k < bins; k++) {
      RE[o + k] = re[k];
      IM[o + k] = im[k];
      MAG[o + k] = Math.hypot(re[k], im[k]);
    }
  }
  onProgress && onProgress(0.25);
  // median along time (harmonic ridges) and along frequency (percussive columns)
  const H = new Float32Array(frames * bins), P = new Float32Array(frames * bins);
  const col = new Float32Array(frames);
  for (let k = 0; k < bins; k++) {
    for (let t = 0; t < frames; t++) col[t] = MAG[t * bins + k];
    const m = medianFilter(col, kernelT);
    for (let t = 0; t < frames; t++) H[t * bins + k] = m[t];
  }
  onProgress && onProgress(0.55);
  for (let t = 0; t < frames; t++) P.set(medianFilter(MAG.subarray(t * bins, (t + 1) * bins), kernelF), t * bins);
  onProgress && onProgress(0.75);
  // soft masks (power 2)
  const percData = new Float32Array(frames * bins), harmData = new Float32Array(frames * bins);
  for (let i = 0; i < MAG.length; i++) {
    const h2 = H[i] * H[i], p2 = P[i] * P[i], s = h2 + p2;
    const mh = s > 0 ? h2 / s : 0.5;
    percData[i] = MAG[i] * (1 - mh);
    harmData[i] = MAG[i] * mh;
    RE[i] *= mh;
    IM[i] *= mh;
  }
  let harmonic = null;
  if (reconstruct) {
    // weighted overlap-add with the same Hann window
    const out = new Float64Array(x.length + 2 * pad + nfft), wsum = new Float64Array(out.length);
    const time = new Float32Array(nfft);
    for (let t = 0; t < frames; t++) {
      const o = t * bins;
      for (let k = 0; k < bins; k++) { re[k] = RE[o + k]; im[k] = IM[o + k]; }
      fft.inverse(re, im, time);
      const s = t * hop;
      for (let i = 0; i < nfft; i++) {
        out[s + i] += time[i] * win[i];
        wsum[s + i] += win[i] * win[i];
      }
    }
    harmonic = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) {
      const w = wsum[i + pad];
      harmonic[i] = w > 1e-6 ? out[i + pad] / w : 0;
    }
  }
  onProgress && onProgress(1);
  return { harmonic, perc: { data: percData, harm: harmData, frames, bins, hop, nfft, sr } };
}
