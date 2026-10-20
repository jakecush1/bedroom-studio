// Tempo and beat tracking — ports of MP1_G2_Audio_analyzer/beats:
//   V1.1  beatsV1.1-cross-correlation-pulse-sequences(-tempoV2.1).py
//   V2.1  beatsV2.1-dynamic-programming.py
//   V3    an Ellis-style dynamic-programming tracker (what librosa's
//         beat_track, used in beatsV3, does), with a 120-bpm log prior
// plus F-measure from eval.py-style evaluation (±70 ms, as in mir_eval).

/** OSS from beatsV2.1: log1p magnitude, half-wave rectified flux, normalised, 5-pt smoothing. */
export function onsetStrength(spec) {
  const { data, frames, bins } = spec;
  const flux = new Float32Array(Math.max(1, frames));
  let prev = new Float32Array(bins);
  for (let k = 0; k < bins; k++) prev[k] = Math.log1p(data[k]);
  // flux[t] belongs to frame t (the original shifted it by one frame)
  for (let t = 1; t < frames; t++) {
    let s = 0;
    const o = t * bins;
    for (let k = 0; k < bins; k++) {
      const v = Math.log1p(data[o + k]);
      const d = v - prev[k];
      if (d > 0) s += d;
      prev[k] = v;
    }
    flux[t] = s;
  }
  let max = 0;
  for (let i = 0; i < flux.length; i++) max = Math.max(max, flux[i]);
  if (max > 0) for (let i = 0; i < flux.length; i++) flux[i] /= max;
  return movingAverage(flux, 5);
}

export function movingAverage(x, w) {
  // numpy.convolve(x, ones(w)/w, mode='same')
  const n = x.length, out = new Float32Array(n);
  const left = Math.floor((w - 1) / 2);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < w; j++) {
      const k = i - left + j;
      if (k >= 0 && k < n) s += x[k];
    }
    out[i] = s / w;
  }
  return out;
}

function autocorr(x, maxLag) {
  const n = x.length, r = new Float32Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += x[i] * x[i + lag];
    r[lag] = s;
  }
  return r;
}

/**
 * Tempo from the onset envelope.
 * method: "v1" (plain argmax), "v21" (Gaussian lag weighting, beatsV2.1),
 *         "v3" (log-normal prior at 120 bpm + octave check + sub-frame peak).
 */
export function estimateTempo(oss, fps, { method = "v3", minBpm = 60, maxBpm = 200 } = {}) {
  const minLag = Math.floor((fps * 60) / maxBpm);
  const maxLag = Math.floor((fps * 60) / minBpm);
  let corr = autocorr(oss, maxLag + 12);
  if (method !== "v1") corr = movingAverage(corr, 10);
  const curve = [];
  let bestLag = minLag, best = -Infinity;
  for (let lag = minLag; lag < maxLag; lag++) {
    let score = corr[lag];
    if (method === "v21") score *= Math.exp(-0.5 * Math.pow((lag - (minLag + maxLag) / 2) / 50, 2));
    if (method === "v3") {
      const bpm = (60 * fps) / lag;
      score *= Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 1.0, 2));
    }
    curve.push({ lag, bpm: (60 * fps) / lag, score });
    if (score > best) { best = score; bestLag = lag; }
  }
  let lag = bestLag;
  // tempoV2.1 octave decision: prefer double tempo if its lag is nearly as strong
  const half = Math.round(lag / 2);
  if (method !== "v1" && half >= minLag && corr[half] >= corr[lag] * 0.98) lag = half;
  // sub-frame refinement (parabolic) — the integer-lag originals quantise tempo
  let frac = lag;
  if (method === "v3" && lag > 1 && lag < corr.length - 1) {
    const a = corr[lag - 1], b = corr[lag], c = corr[lag + 1];
    const den = a - 2 * b + c;
    if (den < 0) frac = lag + (0.5 * (a - c)) / den;
  }
  return { bpm: (60 * fps) / frac, lag: frac, curve };
}

/** beatsV1.1: cross-correlate with a Gaussian pulse train, then snap to local peaks. */
export function trackPulse(oss, period) {
  const n = oss.length;
  const width = 3;
  let bestOff = 0, best = -Infinity;
  const search = Math.min(n, Math.ceil(2 * period));
  for (let off = 0; off < search; off++) {
    let s = 0;
    for (let c = off; c < n; c += period) {
      const ci = Math.round(c);
      for (let j = -width; j <= width; j++) {
        const idx = ci + j;
        if (idx >= 0 && idx < n) s += oss[idx] * Math.exp(-0.5 * (j / width) ** 2);
      }
    }
    if (s > best) { best = s; bestOff = off; }
  }
  const beats = [];
  for (let c = bestOff; c < n; c += period) {
    const b = Math.round(c);
    let m = b;
    for (let j = Math.max(0, b - 5); j < Math.min(n, b + 5); j++) if (oss[j] > oss[m]) m = j;
    beats.push(m);
  }
  return beats;
}

function getPeaks(oss, period, threshold = 0.3, minThreshold = 0.02) {
  const peaks = [];
  const distance = Math.floor(0.6 * period);
  for (let i = 1; i < oss.length - 1; i++) {
    if (oss[i] > threshold && oss[i] > oss[i - 1] && oss[i] > oss[i + 1]) {
      if (!peaks.length || i - peaks[peaks.length - 1] > distance) peaks.push(i);
    }
  }
  if (peaks.length < 10) {
    if (threshold / 2 < minThreshold) {
      const idx = [...oss.keys()].sort((a, b) => oss[b] - oss[a]).slice(0, Math.max(10, Math.floor(oss.length / period)));
      return idx.sort((a, b) => a - b);
    }
    return getPeaks(oss, period, threshold / 2, minThreshold);
  }
  return peaks;
}

/** beatsV2.1: dynamic programming over onset peaks with a log-period penalty. */
export function trackPeaksDP(oss, period) {
  let mean = 0;
  for (let i = 0; i < oss.length; i++) mean += oss[i];
  mean /= Math.max(1, oss.length);
  const peaks = getPeaks(oss, period, 0.3, Math.max(0.02, mean * 0.5));
  const score = new Map(), back = new Map();
  const penalty = (d) => Math.max(-1, 1 - Math.log(d / period) ** 2);
  for (const i of peaks) {
    let best = oss[i] * 0.5, bj = -1;
    for (const j of peaks) {
      if (j >= i) break;
      if (j < i - 3 * period) continue;
      const s = score.get(j) + oss[i] + penalty(i - j);
      if (s > best) { best = s; bj = j; }
    }
    score.set(i, best);
    back.set(i, bj);
  }
  let i = -1, bs = -Infinity;
  for (const [k, v] of score) if (v > bs) { bs = v; i = k; }
  const beats = [];
  while (i >= 0) {
    beats.push(i);
    i = back.get(i);
  }
  beats.reverse();
  // snap_to_peaks
  const win = Math.floor(0.4 * period);
  return [...new Set(beats.map((b) => {
    let best = b, bv = -1;
    for (const p of peaks) if (Math.abs(p - b) < win && oss[p] > bv) { bv = oss[p]; best = p; }
    return best;
  }))].sort((a, b) => a - b);
}

/** Ellis (2007) dynamic programming beat tracker (the algorithm behind librosa.beat.beat_track). */
export function trackEllis(oss, period, tightness = 100) {
  const n = oss.length;
  // normalise the onset envelope by its standard deviation
  let mean = 0;
  for (let i = 0; i < n; i++) mean += oss[i];
  mean /= n;
  let sd = 0;
  for (let i = 0; i < n; i++) sd += (oss[i] - mean) ** 2;
  sd = Math.sqrt(sd / n) || 1;
  // local score: onset envelope smoothed with a Gaussian of ~period/32
  const local = new Float32Array(n);
  const gw = Math.max(1, Math.round(period / 16));
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = -gw * 2; j <= gw * 2; j++) {
      const k = i + j;
      if (k >= 0 && k < n) s += (oss[k] / sd) * Math.exp(-0.5 * (j / gw) ** 2);
    }
    local[i] = s;
  }
  const cum = new Float32Array(n);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2), hi = Math.round(period * 2);
  for (let i = 0; i < n; i++) {
    let best = -Infinity, bj = -1;
    for (let d = lo; d <= hi; d++) {
      const j = i - d;
      if (j < 0) break;
      const s = cum[j] - tightness * Math.log(d / period) ** 2;
      if (s > best) { best = s; bj = j; }
    }
    cum[i] = local[i] + (bj >= 0 ? best : 0);
    back[i] = bj;
  }
  // start from the strongest cumulative score near the end
  let end = n - 1, bv = -Infinity;
  for (let i = Math.max(0, n - Math.ceil(period * 2)); i < n; i++) if (cum[i] > bv) { bv = cum[i]; end = i; }
  const beats = [];
  for (let i = end; i >= 0; i = back[i]) beats.push(i);
  beats.reverse();
  // trim weak beats at the edges (like librosa's trim)
  const strong = beats.map((b) => local[b]);
  const thr = 0.5 * Math.sqrt(strong.reduce((s, v) => s + v * v, 0) / Math.max(1, strong.length));
  while (beats.length && local[beats[0]] < thr) beats.shift();
  while (beats.length && local[beats[beats.length - 1]] < thr) beats.pop();
  return beats;
}

/**
 * Full analysis: tempo + beats.
 * spec from stftMag (hop/sr give the frame rate). Returns beats.json-style data.
 */
export function analyzeBeats(spec, { method = "v3", minBpm = 60, maxBpm = 200 } = {}) {
  const fps = spec.sr / spec.hop;
  const oss = onsetStrength(spec);
  const tempo = estimateTempo(oss, fps, { method: method === "v3" ? "v3" : "v21", minBpm, maxBpm });
  let bpm = tempo.bpm;
  let frames = runTracker(method, oss, (60 * fps) / bpm);

  if (method === "v3" && frames.length > 4) {
    // tempo octave: strong onsets halfway between beats mean the true pulse is twice as fast
    const at = (f) => { let m = 0; for (let j = Math.max(0, f - 2); j <= Math.min(oss.length - 1, f + 2); j++) m = Math.max(m, oss[j]); return m; };
    let onBeat = 0, offBeat = 0;
    for (let i = 0; i + 1 < frames.length; i++) {
      onBeat += at(frames[i]);
      offBeat += at(Math.round((frames[i] + frames[i + 1]) / 2));
    }
    if (offBeat > 0.62 * onBeat && bpm * 2 <= Math.max(maxBpm, 180)) {
      bpm *= 2;
      frames = runTracker(method, oss, (60 * fps) / bpm);
    }
  }
  const times = frames.map((f) => (f * spec.hop) / spec.sr);
  // least-squares fit of the beat grid: far more precise than the integer lag
  if (method === "v3" && times.length > 6) {
    const n = times.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sx += i; sy += times[i]; sxx += i * i; sxy += i * times[i]; }
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    if (slope > 0) {
      const fit = 60 / slope;
      if (Math.abs(fit - bpm) / bpm < 0.08) bpm = fit;
    }
  }
  return { tempo: bpm, beat_times: times, beat_frames: frames, oss, fps, curve: tempo.curve };
}

function runTracker(method, oss, period) {
  return method === "v11" ? trackPulse(oss, period) : method === "v21" ? trackPeaksDP(oss, period) : trackEllis(oss, period);
}

/** F-measure with a ±window tolerance (mir_eval.beat.f_measure semantics). */
export function beatFMeasure(reference, estimated, window = 0.07) {
  const ref = reference.filter((t) => t >= 5), est = estimated.filter((t) => t >= 5);
  if (!ref.length || !est.length) return 0;
  const used = new Set();
  let hits = 0;
  for (const r of ref) {
    let best = -1, bd = Infinity;
    est.forEach((e, i) => {
      const d = Math.abs(e - r);
      if (d <= window && d < bd && !used.has(i)) { bd = d; best = i; }
    });
    if (best >= 0) { used.add(best); hits++; }
  }
  const p = hits / est.length, rc = hits / ref.length;
  return p + rc > 0 ? (2 * p * rc) / (p + rc) : 0;
}
