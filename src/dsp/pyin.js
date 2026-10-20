// Probabilistic YIN — a port of librosa.pyin (Mauch & Dixon 2014), which the
// Melody-extractor's helpers.py used for its f0 track.
//
//  1. YIN cumulative-mean-normalised difference per frame
//  2. Beta(2,18) prior over thresholds + Boltzmann prior over troughs
//     → probability for each pitch candidate (parabolic-refined)
//  3. HMM over pitch bins × {voiced, unvoiced}, decoded with Viterbi
//     (band-limited, so it runs in a fraction of a second in JS)

const TINY = 1.1754944e-38;

/** I_x(2, 18) for the Beta prior, closed form for integer parameters. */
function betaCdf2_18(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return 1 - Math.pow(1 - x, 19) - 19 * x * Math.pow(1 - x, 18);
}

/** scipy.stats.boltzmann.pmf(k, lambda, N) */
function boltzmann(k, lambda, N) {
  if (k < 0 || k >= N) return 0;
  return ((1 - Math.exp(-lambda)) * Math.exp(-lambda * k)) / (1 - Math.exp(-lambda * N));
}

/**
 * @param {Float32Array} y mono signal
 * @returns {{ f0: Float32Array, voiced: Uint8Array, voicedProb: Float32Array, times: Float32Array, hop: number }}
 */
export function pyin(y, sr, {
  fmin = 65, fmax = 2093, frameLength = 2048, winLength = null, hop = null,
  nThresholds = 100, boltzmannParam = 2, resolution = 0.1,
  maxTransitionRate = 35.92, switchProb = 0.01, noTroughProb = 0.01,
  onProgress = null
} = {}) {
  winLength = winLength || frameLength >> 1;
  hop = hop || frameLength >> 2;
  const pad = frameLength >> 1;
  const nFrames = 1 + Math.floor((y.length + 2 * pad - frameLength) / hop);
  const minPeriod = Math.floor(sr / fmax);
  const maxPeriod = Math.min(Math.ceil(sr / fmin), frameLength - winLength - 1);
  const nPer = maxPeriod - minPeriod + 1;

  const thresholds = new Float64Array(nThresholds + 1);
  for (let i = 0; i <= nThresholds; i++) thresholds[i] = i / nThresholds;
  const betaProbs = new Float64Array(nThresholds);
  for (let i = 0; i < nThresholds; i++) betaProbs[i] = betaCdf2_18(thresholds[i + 1]) - betaCdf2_18(thresholds[i]);

  const binsPerSemi = Math.ceil(1 / resolution);
  const nBins = Math.floor(12 * binsPerSemi * Math.log2(fmax / fmin)) + 1;

  // observations: for each frame, a sparse list of (bin, prob) plus voiced prob
  const obsBins = [], obsProbs = [];
  const voicedProb = new Float32Array(nFrames);
  const frame = new Float64Array(frameLength);
  const d = new Float64Array(maxPeriod + 2);
  const yinF = new Float64Array(nPer);

  for (let t = 0; t < nFrames; t++) {
    const start = t * hop - pad;
    for (let i = 0; i < frameLength; i++) {
      const j = start + i;
      frame[i] = j >= 0 && j < y.length ? y[j] : 0;
    }
    // difference function d(τ) = Σ_{k=1..W} (y[k] − y[k+τ])²  (librosa's indexing)
    for (let tau = 0; tau <= maxPeriod; tau++) {
      let s = 0;
      for (let k = 1; k <= winLength; k++) {
        const v = frame[k] - frame[k + tau];
        s += v * v;
      }
      d[tau] = s;
    }
    let run = 0;
    for (let tau = 1; tau <= maxPeriod; tau++) {
      run += d[tau];
      if (tau >= minPeriod) yinF[tau - minPeriod] = d[tau] / (run / tau + TINY);
    }
    // troughs (local minima; first sample counts if it slopes up)
    const troughs = [];
    if (nPer > 1 && yinF[0] < yinF[1]) troughs.push(0);
    for (let i = 1; i < nPer - 1; i++) if (yinF[i] < yinF[i - 1] && yinF[i] <= yinF[i + 1]) troughs.push(i);
    const bins = [], probs = [];
    if (troughs.length) {
      const nT = troughs.length;
      const probsT = new Float64Array(nT);
      // for each threshold, the troughs below it share its beta mass via the Boltzmann prior
      for (let th = 0; th < nThresholds; th++) {
        const thr = thresholds[th + 1];
        let count = 0;
        for (let k = 0; k < nT; k++) if (yinF[troughs[k]] < thr) count++;
        if (!count) continue;
        let pos = 0;
        for (let k = 0; k < nT; k++) {
          if (yinF[troughs[k]] < thr) {
            probsT[k] += boltzmann(pos, boltzmannParam, count) * betaProbs[th];
            pos++;
          }
        }
      }
      let gmin = 0;
      for (let k = 1; k < nT; k++) if (yinF[troughs[k]] < yinF[troughs[gmin]]) gmin = k;
      let below = 0;
      for (let th = 0; th < nThresholds; th++) if (!(yinF[troughs[gmin]] < thresholds[th + 1])) below += betaProbs[th];
      probsT[gmin] += noTroughProb * below;
      let vp = 0;
      for (let k = 0; k < nT; k++) {
        if (probsT[k] <= 0) continue;
        const i = troughs[k];
        // parabolic shift
        let shift = 0;
        if (i > 0 && i < nPer - 1) {
          const a = yinF[i + 1] + yinF[i - 1] - 2 * yinF[i];
          const b = (yinF[i + 1] - yinF[i - 1]) / 2;
          if (Math.abs(b) < Math.abs(a)) shift = -b / a;
        }
        const period = minPeriod + i + shift;
        const f = sr / period;
        const bin = Math.max(0, Math.min(nBins - 1, Math.round(12 * binsPerSemi * Math.log2(f / fmin))));
        const at = bins.indexOf(bin);
        if (at >= 0) probs[at] += probsT[k];
        else { bins.push(bin); probs.push(probsT[k]); }
        vp += probsT[k];
      }
      voicedProb[t] = Math.min(1, Math.max(0, vp));
    }
    obsBins.push(Int32Array.from(bins));
    obsProbs.push(Float64Array.from(probs));
    if (onProgress && t % 64 === 0) onProgress(0.6 * (t / nFrames));
  }

  // --- HMM / Viterbi ---
  const maxSemi = Math.round((maxTransitionRate * 12 * hop) / sr);
  const width = maxSemi * binsPerSemi + 1;
  const halfW = width >> 1;
  // triangular window (scipy 'triang', odd width) and per-row normalisation
  const tri = new Float64Array(width);
  for (let n = 0; n < width; n++) tri[n] = 1 - Math.abs(n - (width - 1) / 2) / ((width + 1) / 2);
  const rowNorm = new Float64Array(nBins);
  for (let i = 0; i < nBins; i++) {
    let s = 0;
    for (let j = Math.max(0, i - halfW); j <= Math.min(nBins - 1, i + halfW); j++) s += tri[j - i + halfW];
    rowNorm[i] = s;
  }
  const logT = (i, j) => Math.log(tri[j - i + halfW] / rowNorm[i] + TINY);
  const lStay = Math.log(1 - switchProb), lSwitch = Math.log(switchProb);
  const S = 2 * nBins;
  let delta = new Float64Array(S), next = new Float64Array(S);
  const back = new Array(nFrames);
  const emit = (t, s) => {
    if (s >= nBins) return Math.log((1 - voicedProb[t]) / nBins + TINY);
    const bins = obsBins[t];
    for (let k = 0; k < bins.length; k++) if (bins[k] === s) return Math.log(obsProbs[t][k] + TINY);
    return Math.log(TINY);
  };
  // dense emission rows are expensive to build per state; precompute per frame
  const emitRow = new Float64Array(S);
  const fillEmit = (t) => {
    const uv = Math.log((1 - voicedProb[t]) / nBins + TINY);
    const lt = Math.log(TINY);
    for (let s = 0; s < nBins; s++) emitRow[s] = lt;
    for (let s = nBins; s < S; s++) emitRow[s] = uv;
    const bins = obsBins[t], pr = obsProbs[t];
    for (let k = 0; k < bins.length; k++) emitRow[bins[k]] = Math.log(pr[k] + TINY);
  };
  void emit;
  fillEmit(0);
  for (let s = 0; s < S; s++) delta[s] = (s < nBins ? Math.log(TINY) : Math.log(1 / nBins)) + emitRow[s];
  for (let t = 1; t < nFrames; t++) {
    fillEmit(t);
    const bp = new Int32Array(S);
    for (let j = 0; j < nBins; j++) {
      const lo = Math.max(0, j - halfW), hi = Math.min(nBins - 1, j + halfW);
      let bestV = -Infinity, bvI = 0, bestU = -Infinity, buI = 0;
      for (let i = lo; i <= hi; i++) {
        const tr = logT(i, j);
        const v = delta[i] + tr;
        if (v > bestV) { bestV = v; bvI = i; }
        const u = delta[i + nBins] + tr;
        if (u > bestU) { bestU = u; buI = i + nBins; }
      }
      // into voiced j: from voiced (stay) or unvoiced (switch)
      const a = bestV + lStay, b = bestU + lSwitch;
      if (a >= b) { next[j] = a + emitRow[j]; bp[j] = bvI; } else { next[j] = b + emitRow[j]; bp[j] = buI; }
      // into unvoiced j: from voiced (switch) or unvoiced (stay)
      const c = bestV + lSwitch, e = bestU + lStay;
      if (e >= c) { next[j + nBins] = e + emitRow[j + nBins]; bp[j + nBins] = buI; } else { next[j + nBins] = c + emitRow[j + nBins]; bp[j + nBins] = bvI; }
    }
    back[t] = bp;
    const tmp = delta; delta = next; next = tmp;
    if (onProgress && t % 64 === 0) onProgress(0.6 + 0.4 * (t / nFrames));
  }
  let state = 0;
  for (let s = 1; s < S; s++) if (delta[s] > delta[state]) state = s;
  const f0 = new Float32Array(nFrames);
  const voiced = new Uint8Array(nFrames);
  for (let t = nFrames - 1; t >= 0; t--) {
    const bin = state % nBins;
    voiced[t] = state < nBins ? 1 : 0;
    f0[t] = voiced[t] ? fmin * Math.pow(2, bin / (12 * binsPerSemi)) : 0;
    if (t > 0) state = back[t][state];
  }
  const times = new Float32Array(nFrames);
  for (let t = 0; t < nFrames; t++) times[t] = (t * hop) / sr;
  if (onProgress) onProgress(1);
  return { f0, voiced, voicedProb, times, hop, sr };
}
