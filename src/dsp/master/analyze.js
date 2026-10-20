// Everything the mastering assistant needs to know about a mix:
// loudness/peaks/dynamics, tonal balance (mid + side LTAS), per-band level
// statistics through the same crossover the compressors use, stereo image,
// sibilance spikiness and low-mid resonances.

import { measure } from "./loudness.js";
import { ltas, normalizeCurve, smoothCurve, bandMean } from "./spectrum.js";
import { Crossover4 } from "./crossover.js";

const dB = (p) => (p > 1e-20 ? 10 * Math.log10(p) : -200);

function percentiles(arr, ps) {
  const v = Float64Array.from(arr).sort();
  return ps.map((p) => (v.length ? v[Math.min(v.length - 1, Math.max(0, Math.round((v.length - 1) * p)))] : -120));
}

/**
 * @param {Float32Array} L
 * @param {Float32Array|null} R
 * @param {number} sr
 * @param {{ xover?: number[], onProgress?: (p:number)=>void }} opts
 */
export function analyzeTrack(L, R, sr, { xover = [120, 900, 5500], onProgress = null } = {}) {
  R = R || L;
  const n = L.length;
  const loud = measure(L, R, sr);
  onProgress && onProgress(0.2);
  const spec = ltas(L, R, sr, { fraction: 6 });
  onProgress && onProgress(0.35);
  const midN = normalizeCurve(spec.centers, spec.mid);
  const sideRel = Float64Array.from(spec.side, (v, i) => v - spec.mid[i]); // side vs mid per band

  // per-band level statistics, 50 ms windows of the linked (max L/R) RMS level
  const xoM = new Crossover4(sr, xover), xoS = new Crossover4(sr, xover);
  const win = Math.max(1, Math.round(sr * 0.05));
  const sWin = Math.max(1, Math.round(sr * 0.01));
  const acc = new Float64Array(4), bandLevels = [[], [], [], []], broad = [];
  const em = new Float64Array(4), es = new Float64Array(4);
  let bAcc = 0, cnt = 0;
  let sAcc = 0, sCnt = 0;
  const sib = [];
  let sLL = 0, sRR = 0, sLR = 0;
  for (let i = 0; i < n; i++) {
    const l = L[i], r = R[i];
    sLL += l * l; sRR += r * r; sLR += l * r;
    const bm = xoM.split(0.5 * (l + r));
    const bs = xoS.split(0.5 * (l - r));
    for (let b = 0; b < 4; b++) {
      const lb = bm[b] + bs[b], rb = bm[b] - bs[b];
      const pk = Math.max(lb * lb, rb * rb);
      acc[b] += pk;
      em[b] += bm[b] * bm[b];
      es[b] += bs[b] * bs[b];
    }
    const top = Math.max(l * l, r * r);
    bAcc += top;
    const h = (bm[3] + bs[3]) * (bm[3] + bs[3]);
    sAcc += h;
    if (++sCnt === sWin) { sib.push(dB(sAcc / sWin)); sAcc = 0; sCnt = 0; }
    if (++cnt === win) {
      for (let b = 0; b < 4; b++) { bandLevels[b].push(dB(acc[b] / win)); acc[b] = 0; }
      broad.push(dB(bAcc / win));
      bAcc = 0;
      cnt = 0;
    }
    if (onProgress && (i & 0x3ffff) === 0) onProgress(0.35 + 0.6 * (i / n));
  }
  // ignore near-silent windows when taking statistics
  const loudest = Math.max(...broad, -200);
  const keep = broad.map((v) => v > loudest - 40);
  const pick = (arr) => arr.filter((_, i) => keep[i]);
  const bands = bandLevels.map((lv, b) => {
    const [p10, p50, p90, p98] = percentiles(pick(lv), [0.1, 0.5, 0.9, 0.98]);
    return { p10, p50, p90, p98, corr: (em[b] - es[b]) / Math.max(em[b] + es[b], 1e-20), sideDb: dB(es[b]) - dB(em[b]) };
  });
  const [b10, b50, b90, b98] = percentiles(pick(broad), [0.1, 0.5, 0.9, 0.98]);
  const sibKeep = sib.filter((v) => v > loudest - 45);
  const [s50, s99] = percentiles(sibKeep, [0.5, 0.99]);

  // resonances: narrow bumps of the 1/6-octave curve over its 1-octave
  // smoothing in the boxy/muddy region (bass notes below 150 Hz are music)
  const smooth = smoothCurve(spec.centers, midN, 1);
  const resonances = [];
  for (let i = 1; i < spec.centers.length - 1; i++) {
    const f = spec.centers[i];
    if (f < 150 || f > 1500) continue;
    const bump = midN[i] - smooth[i];
    if (bump > 3 && midN[i] >= midN[i - 1] && midN[i] >= midN[i + 1]) resonances.push({ f, bump });
  }
  resonances.sort((a, b) => b.bump - a.bump);

  const rms = dB((sLL + sRR) / (2 * Math.max(n, 1)));
  onProgress && onProgress(1);
  return {
    sr,
    duration: n / sr,
    loud,
    plr: loud.truePeakDb - loud.integrated,
    rmsDb: rms,
    crest: loud.samplePeakDb - rms,
    centers: spec.centers,
    mid: Array.from(spec.mid),
    side: Array.from(spec.side),
    midN: Array.from(midN),
    sideRel: Array.from(sideRel),
    highContent: bandMean(spec.centers, midN, 12000, 16000),
    bands,
    broad: { p10: b10, p50: b50, p90: b90, p98: b98 },
    corr: sLR / Math.max(Math.sqrt(sLL * sRR), 1e-20),
    sibilance: s99 - s50,
    resonances: resonances.slice(0, 3),
    xover
  };
}
