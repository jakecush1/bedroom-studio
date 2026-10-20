// YIN pitch estimation (de Cheveigné & Kawahara 2002): difference function,
// cumulative-mean-normalised difference, absolute threshold, parabolic
// interpolation. Shared by the guitar tuner and the ME-1 melody extractor.

/**
 * @param {Float32Array} buf  mono frame (length >= 2 * sr / fmin)
 * @param {number} sr
 * @returns {{freq:number, clarity:number}|null}
 */
export function yin(buf, sr, { fmin = 60, fmax = 1400, threshold = 0.12, scratch = null } = {}) {
  const W = Math.floor(buf.length / 2);
  const tauMin = Math.max(2, Math.floor(sr / fmax));
  const tauMax = Math.min(W - 1, Math.ceil(sr / fmin));
  if (tauMax <= tauMin + 2) return null;
  const d = scratch && scratch.length > tauMax ? scratch : new Float32Array(tauMax + 1);

  // difference function d(tau) = sum (x[i] - x[i+tau])^2
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) {
      const x = buf[i] - buf[i + tau];
      s += x * x;
    }
    d[tau] = s;
  }
  // cumulative mean normalised difference, in place
  d[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    d[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }
  // first dip below the threshold, then walk to its local minimum
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (d[t] < threshold) {
      while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) {
    // no confident dip: accept the global minimum only if it's reasonably deep
    let best = tauMin;
    for (let t = tauMin + 1; t <= tauMax; t++) if (d[t] < d[best]) best = t;
    if (d[best] > 0.3) return null;
    tau = best;
  }
  // parabolic interpolation around the minimum
  let better = tau;
  if (tau > 1 && tau < tauMax) {
    const a = d[tau - 1], b = d[tau], c = d[tau + 1];
    const den = a + c - 2 * b;
    if (den !== 0) better = tau + (a - c) / (2 * den);
  }
  return { freq: sr / better, clarity: 1 - d[tau] };
}

export function rms(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

export const freqToMidi = (f, a4 = 440) => 69 + 12 * Math.log2(f / a4);
export const midiToFreq = (m, a4 = 440) => a4 * Math.pow(2, (m - 69) / 12);

const SHARPS = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const FLATS = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
export function noteLabel(midi, flats = false) {
  const m = Math.round(midi);
  const names = flats ? FLATS : SHARPS;
  return { name: names[((m % 12) + 12) % 12], octave: Math.floor(m / 12) - 1 };
}
