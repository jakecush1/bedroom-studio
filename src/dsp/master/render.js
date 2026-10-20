// Offline mastering render: PRE once, then a fast loudness search with a
// decimated model of the limiter, then an exact POST render that is measured
// and corrected if it missed the target.

import { PreChain, PostChain } from "./chain.js";
import { kCoeffs, TruePeakChannel, TP_DELAY, TP_L1, gatedLoudness, measure, verifyTruePeak } from "./loudness.js";

const TP_L1_SAFE = TP_L1;
import { Biquad } from "./biquad.js";
import { softClip } from "./limiter.js";
import { ltas } from "./spectrum.js";

/** Run a chain stage over a whole track, compensating its latency. */
export async function runStage(stage, L, R, { block = 16384, onProgress = null, checkpoint = null } = {}) {
  const lat = stage.latency, n = L.length;
  const outL = new Float32Array(n), outR = new Float32Array(n);
  const bl = new Float64Array(block), br = new Float64Array(block);
  for (let pos = 0; pos < n + lat; pos += block) {
    const m = Math.min(block, n + lat - pos);
    for (let i = 0; i < m; i++) {
      const j = pos + i;
      bl[i] = j < n ? L[j] : 0;
      br[i] = j < n ? R[j] : 0;
    }
    stage.process(bl, br, m, 0);
    for (let i = 0; i < m; i++) {
      const o = pos + i - lat;
      if (o >= 0 && o < n) { outL[o] = bl[i]; outR[o] = br[i]; }
    }
    if (onProgress) onProgress(Math.min(1, (pos + m) / (n + lat)));
    if (checkpoint) await checkpoint();
  }
  return { L: outL, R: outR };
}

/** Peak envelope (true peak) and K-weighted energy of the PRE output, decimated. */
export function calibrationData(L, R, sr, decim = 4) {
  const n = L.length, m = Math.ceil(n / decim);
  const peak = new Float32Array(m), energy = new Float64Array(m);
  const tl = new TruePeakChannel(), tr = new TruePeakChannel();
  // stretches 20 dB under the loudest sample never reach the limiter
  let smax = 0;
  for (let i = 0; i < n; i++) { const a = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (a > smax) smax = a; }
  tl.thr = tr.thr = smax * 0.1 / TP_L1_SAFE;
  const { pre, rlb } = kCoeffs(sr);
  const kl1 = new Biquad(pre), kl2 = new Biquad(rlb), kr1 = new Biquad(pre), kr2 = new Biquad(rlb);
  for (let i = 0; i < n + TP_DELAY; i++) {
    const l = i < n ? L[i] : 0, r = i < n ? R[i] : 0;
    const a = tl.push(l), b = tr.push(r);
    const j = i - TP_DELAY;
    if (j >= 0) {
      const d = (j / decim) | 0;
      const pk = a > b ? a : b;
      if (pk > peak[d]) peak[d] = pk;
    }
    if (i < n) {
      const x = kl2.tick(kl1.tick(l)), y = kr2.tick(kr1.tick(r));
      energy[(i / decim) | 0] += x * x + y * y;
    }
  }
  return { peak, energy, sr, decim, n };
}

/**
 * Loudness and gain reduction the POST stage would produce at `driveDb`
 * (decimated model of drive → clipper → limiter).
 */
export function evaluateDrive(cal, driveDb, { ceilingDb = -1, clip = null, release = { fast: 45, slow: 350 } } = {}) {
  const { peak, energy, sr, decim } = cal;
  const m = peak.length;
  const srD = sr / decim;
  const D = Math.pow(10, driveDb / 20), D2 = D * D;
  const ceil = Math.pow(10, ceilingDb / 20);
  const limit = clip && clip.on ? ceil * Math.pow(10, (clip.headroomDb ?? 1.5) / 20) : 0;
  const W = Math.max(2, Math.round(srD * 0.002));
  const cFast = Math.exp(-1 / ((srD * release.fast) / 1000)), cSlow = Math.exp(-1 / ((srD * release.slow) / 1000));
  const cAvg = Math.exp(-1 / (srD * 0.4));
  // running min (deque) + box + release, as in Limiter
  const qv = new Float64Array(W + 1), qi = new Int32Array(W + 1), Q = W + 1;
  let qh = 0, qn = 0;
  const box = new Float64Array(W).fill(1);
  let boxSum = W, bpos = 0, g = 1, grAvg = 0;
  const gain = new Float32Array(m);
  const efac = new Float32Array(m);
  const cfac = new Float32Array(m).fill(1); // clipper gain on the peak
  for (let k = 0; k < m + W - 1; k++) {
    let need = 1;
    if (k < m) {
      let x = D * peak[k], f = 1;
      if (limit && x > 0.7 * limit) {
        const y = softClip(x, limit, 0.7);
        f = y / x;
        x = y;
      }
      efac[k] = f * f;
      cfac[k] = f;
      need = x > ceil ? ceil / x : 1;
    }
    while (qn > 0 && qv[(qh + qn - 1) % Q] >= need) qn--;
    qv[(qh + qn) % Q] = need;
    qi[(qh + qn) % Q] = k;
    qn++;
    while (qi[qh] <= k - W) { qh = (qh + 1) % Q; qn--; }
    boxSum += qv[qh] - box[bpos];
    box[bpos] = qv[qh];
    bpos = (bpos + 1) % W;
    const s = boxSum / W;
    if (s < g) g = s;
    else {
      const t = grAvg > 0.25 ? 1 : grAvg * 4;
      g = s - (s - g) * (cFast + (cSlow - cFast) * t);
    }
    grAvg = cAvg * grAvg + (1 - cAvg) * (1 - g);
    const j = k - (W - 1);
    if (j >= 0) gain[j] = g;
  }
  // 100 ms sub-blocks → 400 ms gating blocks
  const hop = Math.max(1, Math.round(srD * 0.1));
  const subs = [];
  const grs = [];
  for (let s = 0; s < m; s += hop) {
    let e = 0, lo = 1;
    const end = Math.min(m, s + hop);
    for (let k = s; k < end; k++) {
      const gg = gain[k];
      e += D2 * gg * gg * energy[k] * efac[k];
      const tot = gg * cfac[k]; // clipper + limiter together
      if (tot < lo) lo = tot;
    }
    subs.push(e / (hop * decim));
    grs.push(lo < 1 ? -20 * Math.log10(lo) : 0);
  }
  const blocks = [];
  for (let i = 3; i < subs.length; i++) blocks.push((subs[i] + subs[i - 1] + subs[i - 2] + subs[i - 3]) / 4);
  const lufs = gatedLoudness(blocks);
  // limiting depth: the deepest reduction in each 100 ms, averaged over the
  // loud half of the song (how hard transients are being pushed down)
  const loudSubs = subs.map((e, i) => [e, grs[i]]).sort((a, b) => b[0] - a[0]);
  const half = loudSubs.slice(0, Math.max(1, Math.floor(loudSubs.length / 2)));
  const depth = half.reduce((s, x) => s + x[1], 0) / half.length;
  let maxGr = 0;
  for (let k = 0; k < m; k++) { const t = gain[k] * cfac[k]; const r = t < 1 ? -20 * Math.log10(t) : 0; if (r > maxGr) maxGr = r; }
  return { lufs, depth, maxGr };
}

/** Find the drive that hits targetLufs, held back if limiting would exceed budget dB. */
export function findDrive(cal, targetLufs, budget, opts) {
  const ev = (d) => evaluateDrive(cal, d, opts);
  // bracket around the unlimited estimate: limiting only ever costs loudness
  const base = ev(0).lufs;
  let lo = Number.isFinite(base) ? targetLufs - base - 3 : -24, hi = Number.isFinite(base) ? targetLufs - base + 18 : 36;
  if (ev(lo).lufs > targetLufs) lo = -24;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (ev(mid).lufs < targetLufs) lo = mid; else hi = mid;
  }
  let drive = (lo + hi) / 2;
  let r = ev(drive);
  let capped = false;
  if (r.depth > budget) {
    let a = Math.min(drive - 18, lo), b = drive;
    for (let i = 0; i < 12; i++) {
      const mid = (a + b) / 2;
      if (ev(mid).depth > budget) b = mid; else a = mid;
    }
    drive = a;
    r = ev(drive);
    capped = true;
  }
  const slope = Math.max(0.2, (ev(drive + 0.5).lufs - ev(drive - 0.5).lufs) / 1);
  return { driveDb: drive, estLufs: r.lufs, depthGr: r.depth, maxGr: r.maxGr, capped, slope };
}

/** Peak/RMS envelope in `buckets` columns for the waveform view. */
export function envelope(L, R, buckets = 1200) {
  const n = L.length;
  const pk = new Float32Array(buckets), rms = new Float32Array(buckets);
  const step = n / buckets;
  for (let b = 0; b < buckets; b++) {
    const s = Math.floor(b * step), e = Math.min(n, Math.floor((b + 1) * step));
    let p = 0, q = 0;
    for (let i = s; i < e; i++) {
      const l = L[i], r = R[i];
      const a = Math.max(l < 0 ? -l : l, r < 0 ? -r : r);
      if (a > p) p = a;
      q += (l * l + r * r) * 0.5;
    }
    pk[b] = p;
    rms[b] = Math.sqrt(q / Math.max(1, e - s));
  }
  return { peak: pk, rms };
}

/** Stable key for the parameters that affect PRE. */
export function preKey(p) {
  const { inputGainDb, hpfHz, eq, tone, xover, bands, glue, sat } = p;
  return JSON.stringify({ inputGainDb, hpfHz, eq, tone, xover, bands, glue, sat });
}

/**
 * Full render. `cache` is reused across calls (PRE output + calibration data).
 * @returns {Promise<{L:Float32Array,R:Float32Array,driveDb:number,capped:boolean,estLufs:number,avgGr:number,metrics:object,spectrum:object,envelope:object}>}
 */
export async function renderMaster(L, R, sr, params, { targetLufs = -11, budget = 4, cache = {}, onProgress = null, checkpoint = null } = {}) {
  const prog = (a, b) => (x) => onProgress && onProgress(a + (b - a) * x);
  const key = preKey(params);
  if (cache.key !== key) {
    const pre = new PreChain(sr, params, { offline: true });
    const out = await runStage(pre, L, R, { onProgress: prog(0, 0.55), checkpoint });
    cache.key = key;
    cache.pre = out;
    cache.cal = calibrationData(out.L, out.R, sr);
  }
  onProgress && onProgress(0.6);
  const opts = { ceilingDb: params.ceilingDb, clip: params.clip, release: params.release };
  const found = findDrive(cache.cal, targetLufs, budget, opts);
  if (checkpoint) await checkpoint();
  let driveDb = found.driveDb;
  let result = null, metrics = null;
  const goal = found.capped ? found.estLufs : targetLufs;
  let ceilingDb = params.ceilingDb ?? -1;
  let passes = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    let prev = null; // secant: the last (drive, loudness) pair
    for (let pass = 0; pass < 4; pass++, passes++) {
      const post = new PostChain(sr, { ...params, ceilingDb, driveDb });
      result = await runStage(post, cache.pre.L, cache.pre.R, { onProgress: prog(Math.min(0.9, 0.62 + passes * 0.07), 0.93), checkpoint });
      metrics = measure(result.L, result.R, sr);
      const err = goal - metrics.integrated;
      if (!Number.isFinite(err) || Math.abs(err) < 0.1) break;
      let slope = found.slope;
      if (prev && Math.abs(driveDb - prev[0]) > 1e-3) slope = Math.max(0.05, (metrics.integrated - prev[1]) / (driveDb - prev[0]));
      prev = [driveDb, metrics.integrated];
      driveDb += Math.max(-6, Math.min(6, err / slope));
    }
    // final check with a longer interpolator; HF-heavy material can still
    // overshoot the limiter's detector, so pull the ceiling in and redo
    const tp = verifyTruePeak(result.L, result.R, { floorDb: (params.ceilingDb ?? -1) - 3 });
    metrics.truePeakDb = Math.max(metrics.truePeakDb, tp);
    const over = tp - (params.ceilingDb ?? -1);
    if (over <= 0.05) break;
    ceilingDb -= over + 0.05;
  }
  onProgress && onProgress(0.95);
  const spectrum = ltas(result.L, result.R, sr, { fraction: 6 });
  onProgress && onProgress(1);
  return {
    L: result.L,
    R: result.R,
    driveDb,
    ceilingUsed: ceilingDb,
    capped: found.capped,
    estLufs: found.estLufs,
    depthGr: found.depthGr,
    maxGr: found.maxGr,
    metrics,
    spectrum: { centers: spectrum.centers, mid: Array.from(spectrum.mid), side: Array.from(spectrum.side) },
    envelope: envelope(result.L, result.R)
  };
}
