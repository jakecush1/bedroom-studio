// Drum transcription for the noise channel: band-wise onset detection on the
// percussive spectrogram (kick / snare / hats), adaptive thresholds, open vs
// closed hats by decay, and crash accents.

const BANDS = {
  kick: [40, 130],
  body: [180, 1200],
  rattle: [2000, 5000],
  hat: [6500, 11000]
};

function bandEnergy(spec, [f0, f1], data = spec.data) {
  const { frames, bins, nfft, sr } = spec;
  const k0 = Math.max(1, Math.floor((f0 * nfft) / sr)), k1 = Math.min(bins - 1, Math.ceil((f1 * nfft) / sr));
  const e = new Float32Array(frames);
  for (let t = 0; t < frames; t++) {
    let s = 0;
    const o = t * bins;
    for (let k = k0; k <= k1; k++) s += data[o + k] * data[o + k];
    e[t] = s;
  }
  return e;
}

/** Log-energy flux, normalised by its 99th percentile. */
function flux(e) {
  const n = e.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += e[i];
  mean = mean / Math.max(1, n) + 1e-12;
  const L = Float32Array.from(e, (v) => Math.log1p(v / mean * 4));
  const f = new Float32Array(n);
  for (let t = 1; t < n; t++) {
    const prev = t > 1 ? Math.max(L[t - 1], L[t - 2]) : L[t - 1];
    f[t] = Math.max(0, L[t] - prev);
  }
  const sorted = Float32Array.from(f).sort();
  const p99 = sorted[Math.floor(n * 0.99)] || 1;
  for (let t = 0; t < n; t++) f[t] = Math.min(1.5, f[t] / (p99 || 1));
  return { f, L };
}

/** Peaks above an adaptive (local median) threshold with a refractory gap. */
function peaks(f, fps, { delta = 0.18, k = 1.5, gapMs = 45 } = {}) {
  const n = f.length, out = [];
  const W = Math.round(fps * 0.25);
  const gap = Math.round((gapMs / 1000) * fps);
  let last = -1e9;
  const win = [];
  for (let t = 0; t < n; t++) {
    const lo = Math.max(0, t - W), hi = Math.min(n - 1, t + W);
    // local median (small windows: sort a copy)
    win.length = 0;
    for (let j = lo; j <= hi; j += 2) win.push(f[j]);
    win.sort((a, b) => a - b);
    const med = win[win.length >> 1];
    if (f[t] < delta + k * med) continue;
    let isMax = true;
    for (let j = Math.max(0, t - 3); j <= Math.min(n - 1, t + 3); j++) if (f[j] > f[t]) { isMax = false; break; }
    if (!isMax || t - last < gap) continue;
    out.push(t);
    last = t;
  }
  return out;
}

/**
 * @param spec percussive magnitude spectrogram (hpss().perc)
 * @param timeOf frame → seconds
 * @returns {{t:number, kind:"kick"|"snare"|"hat"|"open"|"crash", vel:number}[]}
 */
export function detectDrums(spec, { timeOf = null } = {}) {
  const fps = spec.sr / spec.hop;
  const tof = timeOf || ((t) => (t * spec.hop) / spec.sr);
  const e = {}, h = {};
  for (const [k, b] of Object.entries(BANDS)) {
    e[k] = bandEnergy(spec, b);
    if (spec.harm) h[k] = bandEnergy(spec, b, spec.harm);
  }
  // a drum hit is mostly percussive energy in its band; a note attack (bass
  // pluck, chord stab) leaves a percussive trace on top of harmonic energy
  const percussive = (k, t) => {
    if (!h[k]) return true;
    let p = 0, q = 0;
    for (let j = Math.max(0, t - 1); j <= Math.min(e[k].length - 1, t + 2); j++) { p += e[k][j]; q += h[k][j]; }
    return p > 0.7 * q;
  };
  const F = {};
  for (const k of Object.keys(BANDS)) F[k] = flux(e[k]);
  const snareF = Float32Array.from(F.body.f, (v, i) => 0.45 * v + 0.55 * F.rattle.f[i]);
  const hits = [];
  const near = (list, t, d = 2) => list.some((x) => Math.abs(x - t) <= d);
  const kicks = peaks(F.kick.f, fps, { delta: 0.22 });
  const snares = peaks(snareF, fps, { delta: 0.2 });
  const hats = peaks(F.hat.f, fps, { delta: 0.16, gapMs: 35 });
  // real hits form the loud cluster of their band; bleed (a snare's noise in
  // the kick band, a stab's click in the snare band) sits well below it
  const peakE = (band, t) => { let m = 0; for (let j = Math.max(0, t - 1); j <= Math.min(e[band].length - 1, t + 2); j++) m = Math.max(m, e[band][j]); return m; };
  const loudGate = (list, band, frac = 0.18, exclude = null) => {
    if (list.length < 4) return list;
    // reference level from hits that aren't sitting on top of another drum
    const refList = exclude ? list.filter((t) => !exclude.some((x) => Math.abs(x - t) <= 2)) : list;
    const es = (refList.length >= 4 ? refList : list).map((t) => peakE(band, t)).sort((x, y) => x - y);
    const ref = es[Math.floor(es.length * 0.8)];
    return list.filter((t) => peakE(band, t) >= frac * ref);
  };
  const realKicks = loudGate(kicks, "kick");
  for (const t of realKicks) hits.push({ t: tof(t), frame: t, kind: "kick", vel: Math.min(1, 0.45 + 0.55 * F.kick.f[t]) });
  const keptSnares = [];
  for (const t of loudGate(snares, "rattle", 0.22)) {
    // kicks splash into the body band; a real snare also rattles 2–5 kHz
    if (near(realKicks, t) && F.rattle.f[t] < 0.5) continue;
    if (!percussive("rattle", t) && !percussive("body", t)) continue;
    hits.push({ t: tof(t), frame: t, kind: "snare", vel: Math.min(1, 0.45 + 0.55 * snareF[t]) });
    keptSnares.push(t);
  }
  // hats: open if the band keeps ringing ~120 ms later; crash if it's huge and long
  const ring = Math.round(fps * 0.12);
  const hatE = F.hat.L;
  for (const t of loudGate(hats, "hat", 0.12, [...keptSnares, ...realKicks])) {
    const later = t + ring < hatE.length ? hatE[t + ring] : 0;
    const decay = hatE[t] > 0 ? later / hatE[t] : 0;
    let kind = "hat";
    if (decay > 0.62) kind = F.hat.f[t] > 0.9 && F.rattle.f[t] > 0.6 ? "crash" : "open";
    hits.push({ t: tof(t), frame: t, kind, vel: Math.min(1, 0.35 + 0.65 * F.hat.f[t]) });
  }
  hits.sort((a, b) => a.t - b.t);
  return hits;
}

/**
 * Drum *pattern* estimation for full mixes (no stems), where per-hit
 * transcription is fragile (synth-bass attacks look like kicks, a reverb-heavy
 * snare hides in the mix). Like a chip arranger would: find the bar phase from
 * the backbeat, score every 16th slot of every bar with kick/snare/hat
 * evidence, average over a 4-bar window, then choose hits with metrical
 * weights (beat 1 > beat 3 > the "ands"), a cap per bar, and 8th vs 16th hats
 * from the hat band's own periodicity.
 */
export function drumPattern(spec, beats, { timeOf = null } = {}) {
  if (!beats || beats.length < 8) return detectDrums(spec, { timeOf });
  const fps = spec.sr / spec.hop;
  const tof = timeOf || ((t) => (t * spec.hop) / spec.sr);
  const frameOf = (sec) => Math.round((sec * spec.sr) / spec.hop);
  const e = {};
  for (const [k, b] of Object.entries(BANDS)) e[k] = bandEnergy(spec, b);
  const F = {};
  for (const k of Object.keys(BANDS)) F[k] = flux(e[k]).f;
  const snareF = Float32Array.from(F.body, (v, i) => 0.4 * v + 0.6 * F.rattle[i]);
  const ev = (arr, sec) => {
    const f = frameOf(sec);
    let m = 0;
    for (let j = Math.max(0, f - 2); j <= Math.min(arr.length - 1, f + 2); j++) m = Math.max(m, arr[j]);
    return m;
  };
  // 16th slot times from the beat grid
  const slotTime = (bi, k) => {
    const a = beats[bi], b = bi + 1 < beats.length ? beats[bi + 1] : a + (a - beats[bi - 1]);
    return a + ((b - a) * k) / 4;
  };
  // bar phase: kicks on beats 1 and 3, snares on 2 and 4
  let phase = 0, bestP = -Infinity;
  for (let p = 0; p < 4; p++) {
    let s = 0;
    for (let bi = 0; bi < beats.length; bi++) {
      const pos = (((bi - p) % 4) + 4) % 4;
      const t = beats[bi];
      s += pos === 0 || pos === 2 ? ev(F.kick, t) - 0.5 * ev(snareF, t) : ev(snareF, t) - 0.5 * ev(F.kick, t);
    }
    if (s > bestP) { bestP = s; phase = p; }
  }
  const bars = [];
  for (let bi = phase; bi + 3 < beats.length; bi += 4) {
    const K = new Float32Array(16), S = new Float32Array(16), H = new Float32Array(16);
    const times = new Float64Array(16);
    for (let s = 0; s < 16; s++) {
      const t = slotTime(bi + (s >> 2), s & 3);
      times[s] = t;
      K[s] = ev(F.kick, t);
      S[s] = ev(snareF, t);
      H[s] = ev(F.hat, t);
    }
    bars.push({ K, S, H, times });
  }
  const WK = [1, 0.3, 0.45, 0.3, 0.7, 0.3, 0.55, 0.3, 0.9, 0.3, 0.45, 0.3, 0.7, 0.3, 0.55, 0.3];
  const hits = [];
  const avg = (b, key, s) => {
    let sum = 0, n = 0;
    for (let j = Math.max(0, b - 2); j <= Math.min(bars.length - 1, b + 1); j++) { sum += bars[j][key][s]; n++; }
    return 0.65 * (sum / n) + 0.35 * bars[b][key][s];
  };
  for (let b = 0; b < bars.length; b++) {
    const bar = bars[b];
    const Kp = Array.from({ length: 16 }, (_, s) => avg(b, "K", s));
    const Sp = Array.from({ length: 16 }, (_, s) => avg(b, "S", s));
    const Hp = Array.from({ length: 16 }, (_, s) => avg(b, "H", s));
    const kMax = Math.max(...Kp), sMax = Math.max(...Sp), hMax = Math.max(...Hp);
    // kicks: best-weighted slots, at most 4 a bar
    if (kMax > 0.15) {
      const cand = Kp.map((v, s) => ({ s, v, score: v * WK[s] })).filter((c) => c.v >= 0.5 * kMax).sort((x, y) => y.score - x.score).slice(0, 4);
      if (!cand.some((c) => c.s === 0) && Kp[0] >= 0.3 * kMax) cand.push({ s: 0, v: Kp[0] });
      for (const c of cand) hits.push({ t: bar.times[c.s], kind: "kick", vel: Math.min(1, 0.55 + 0.45 * c.v) });
    }
    // snares: the backbeat, plus strong fills
    if (sMax > 0.15) {
      for (const s of [4, 12]) if (Sp[s] >= 0.35 * sMax) hits.push({ t: bar.times[s], kind: "snare", vel: Math.min(1, 0.55 + 0.45 * Sp[s]) });
      for (let s = 0; s < 16; s++) if (s !== 4 && s !== 12 && bar.S[s] >= 0.9 * sMax && bar.S[s] > 0.6) hits.push({ t: bar.times[s], kind: "snare", vel: 0.7 });
    }
    // hats: 16ths if the off-16ths ring nearly as hard as the 8ths
    if (hMax > 0.12) {
      let even = 0, odd = 0;
      for (let s = 0; s < 16; s++) (s % 2 ? (odd += Hp[s]) : (even += Hp[s]));
      const sixteenths = odd >= 0.55 * even;
      for (let s = 0; s < 16; s += sixteenths ? 1 : 2) if (Hp[s] >= 0.22 * hMax) hits.push({ t: bar.times[s], kind: "hat", vel: Math.min(1, 0.4 + 0.5 * Hp[s] / hMax) });
    }
    // crash on a big phrase start
    if (b % 4 === 0 && bar.H[0] > 0.85 && bar.S[0] > 0.5) hits.push({ t: bar.times[0], kind: "crash", vel: 0.9 });
  }
  hits.sort((a, b) => a.t - b.t);
  void tof; void fps;
  return hits;
}
