// The mastering chain, shared by the real-time preview (AudioWorklet) and
// the offline render (Web Worker) so what you hear is what you download.
//
//   PRE   trim → subsonic HPF → EQ (assistant + tone) → 4-band M/S dynamics
//         (compression + width per band, de-ess on the top band) → glue
//         compressor → saturation (2× oversampled) → DC block
//   POST  loudness drive → soft clipper (2×, optional) → true-peak limiter
//
// The split lets the renderer compute PRE once and search the loudness
// drive with POST only.

import { design, magDb, Biquad, Cascade } from "./biquad.js";
import { Crossover4 } from "./crossover.js";
import { Compressor, Oversampler2x } from "./dynamics.js";
import { Limiter, softClip } from "./limiter.js";

export const BAND_NAMES = ["Low", "Low-mid", "Presence", "Air"];

export const TONE_FILTERS = {
  low: { type: "lowshelf", f: 110, q: 0.7 },
  mid: { type: "peaking", f: 850, q: 0.7 },
  presence: { type: "peaking", f: 3500, q: 0.9 },
  high: { type: "highshelf", f: 9000, q: 0.7 }
};

/** A neutral parameter set (no processing beyond the limiter). */
export function neutralParams() {
  return {
    inputGainDb: 0,
    hpfHz: 22,
    eq: [],
    tone: { low: 0, mid: 0, presence: 0, high: 0 },
    xover: [120, 900, 5500],
    bands: [0, 1, 2, 3].map(() => ({ threshold: 0, ratio: 1, attack: 20, release: 150, knee: 6, width: 1, gainDb: 0 })),
    glue: { threshold: 0, ratio: 1, attack: 30, release: 250, knee: 6 },
    sat: { amount: 0, drive: 1.6, bias: 0.1 },
    clip: { on: false, headroomDb: 1.5 },
    ceilingDb: -1,
    driveDb: 0,
    release: { fast: 45, slow: 350 }
  };
}

/**
 * All EQ sections (assistant curve + tone controls) as coefficient sets.
 * prune drops flat sections (offline renders); the real-time chain keeps a
 * fixed section count so filter state survives knob moves.
 */
export function eqCoeffs(p, sr, { prune = false } = {}) {
  const all = p.eq.map((f) => ({ ...f }));
  for (const [k, d] of Object.entries(TONE_FILTERS)) all.push({ ...d, gainDb: (p.tone && p.tone[k]) || 0 });
  return all.filter((f) => !prune || Math.abs(f.gainDb) >= 0.02).map((f) => design(f.type, f.f, sr, { q: f.q, gainDb: f.gainDb }));
}

/** Combined EQ response (dB) at f — for drawing the curve. */
export function eqResponse(p, sr, f) {
  let db = 0;
  for (const c of eqCoeffs(p, sr)) db += magDb(c, f, sr);
  return db;
}

export class PreChain {
  constructor(sr, params = neutralParams(), { offline = false } = {}) {
    this.sr = sr;
    this.offline = offline;
    this.hpL = [new Biquad(), new Biquad()];
    this.hpR = [new Biquad(), new Biquad()];
    this.eqL = new Cascade();
    this.eqR = new Cascade();
    this.xoM = new Crossover4(sr);
    this.xoS = new Crossover4(sr);
    this.comp = [0, 1, 2, 3].map(() => new Compressor(sr));
    this.glue = new Compressor(sr);
    this.osL = new Oversampler2x();
    this.osR = new Oversampler2x();
    this.bm = new Float64Array(4);
    this.bandGain = new Float64Array(4).fill(1);
    this.width = new Float64Array(4).fill(1);
    this.dcL = { x: 0, y: 0 };
    this.dcR = { x: 0, y: 0 };
    this.dcR1 = Math.exp((-2 * Math.PI * 6) / sr);
    this.latency = this.osL.latency;
    this.setParams(params);
  }

  setParams(p) {
    const sr = this.sr;
    this.p = p;
    this.inGain = Math.pow(10, (p.inputGainDb || 0) / 20);
    const hp = design("highpass", p.hpfHz || 20, sr, { q: Math.SQRT1_2 });
    for (const b of [...this.hpL, ...this.hpR]) b.set(hp);
    const eq = eqCoeffs(p, sr, { prune: this.offline });
    this.eqL.set(eq);
    this.eqR.set(eq);
    this.xoM.setFreqs(p.xover);
    this.xoS.setFreqs(p.xover);
    p.bands.forEach((b, i) => {
      this.comp[i].set(b);
      this.bandGain[i] = Math.pow(10, (b.gainDb || 0) / 20);
      this.width[i] = b.width == null ? 1 : b.width;
    });
    this.glue.set(p.glue);
    const s = p.sat || { amount: 0 };
    const amt = Math.max(0, Math.min(1, s.amount || 0));
    const d = s.drive || 1.6, bias = s.bias || 0;
    const t0 = Math.tanh(d * bias);
    const norm = 1 / (d * (1 - t0 * t0));
    this.satFn = amt > 0 ? (x) => x + amt * ((Math.tanh(d * (x + bias)) - t0) * norm - x) : (x) => x;
  }

  reset() {
    for (const b of [...this.hpL, ...this.hpR]) b.reset();
    this.eqL.reset(); this.eqR.reset(); this.xoM.reset(); this.xoS.reset();
    this.comp.forEach((c) => c.reset()); this.glue.reset();
    this.osL.reset(); this.osR.reset();
    this.dcL.x = this.dcL.y = this.dcR.x = this.dcR.y = 0;
  }

  /** Band and glue gain reduction (dB) right now, for meters. */
  reductions() {
    return { bands: this.comp.map((c) => c.gr), glue: this.glue.gr };
  }

  /** In place on n samples from offset. */
  process(L, R, n = L.length, offset = 0) {
    const [h1, h2] = this.hpL, [h3, h4] = this.hpR;
    const eqL = this.eqL, eqR = this.eqR, xoM = this.xoM, xoS = this.xoS, comp = this.comp;
    const bg = this.bandGain, wd = this.width, bm = this.bm;
    const glue = this.glue, osL = this.osL, osR = this.osR, fn = this.satFn;
    const g0 = this.inGain, k = this.dcR1, dcL = this.dcL, dcR = this.dcR;
    for (let i = offset; i < offset + n; i++) {
      // 1e-20 keeps recursive filters out of denormals in silence
      let l = h2.tick(h1.tick(L[i] * g0 + 1e-20));
      let r = h4.tick(h3.tick(R[i] * g0 + 1e-20));
      l = eqL.tick(l);
      r = eqR.tick(r);
      const m = 0.5 * (l + r), s = 0.5 * (l - r);
      const om = xoM.split(m);
      bm[0] = om[0]; bm[1] = om[1]; bm[2] = om[2]; bm[3] = om[3];
      const os = xoS.split(s);
      let mo = 0, so = 0;
      for (let b = 0; b < 4; b++) {
        const lb = bm[b] + os[b], rb = bm[b] - os[b];
        const al = lb < 0 ? -lb : lb, ar = rb < 0 ? -rb : rb;
        const g = comp[b].gain(al > ar ? al : ar) * bg[b];
        mo += bm[b] * g;
        so += os[b] * g * wd[b];
      }
      l = mo + so;
      r = mo - so;
      const al = l < 0 ? -l : l, ar = r < 0 ? -r : r;
      const gg = glue.gain(al > ar ? al : ar);
      l = osL.process(l * gg, fn);
      r = osR.process(r * gg, fn);
      // DC block (saturation bias)
      const yl = l - dcL.x + k * dcL.y; dcL.x = l; dcL.y = yl;
      const yr = r - dcR.x + k * dcR.y; dcR.x = r; dcR.y = yr;
      L[i] = yl;
      R[i] = yr;
    }
  }
}

export class PostChain {
  constructor(sr, params = neutralParams()) {
    this.sr = sr;
    this.osL = new Oversampler2x();
    this.osR = new Oversampler2x();
    // matching delay when the clipper is off, so latency never changes
    this.dlen = this.osL.latency;
    this.dL = new Float64Array(this.dlen);
    this.dR = new Float64Array(this.dlen);
    this.dpos = 0;
    this.limiter = new Limiter(sr, { ceilingDb: params.ceilingDb });
    this.latency = this.dlen + this.limiter.latency;
    this.setParams(params);
  }

  setParams(p) {
    this.p = p;
    this.drive = Math.pow(10, (p.driveDb || 0) / 20);
    const ceil = Math.pow(10, (p.ceilingDb ?? -1) / 20);
    this.clipOn = !!(p.clip && p.clip.on);
    const limit = ceil * Math.pow(10, ((p.clip && p.clip.headroomDb) ?? 1.5) / 20);
    this.clipFn = (x) => softClip(x, limit, 0.7);
    this.limiter.set({ ceilingDb: p.ceilingDb ?? -1, releaseMs: (p.release && p.release.fast) || 45, slowReleaseMs: (p.release && p.release.slow) || 350 });
  }

  setDrive(db) {
    this.p.driveDb = db;
    this.drive = Math.pow(10, db / 20);
  }

  reset() {
    this.osL.reset(); this.osR.reset();
    this.dL.fill(0); this.dR.fill(0); this.dpos = 0;
    this.limiter.reset();
  }

  process(L, R, n = L.length, offset = 0) {
    const d = this.drive;
    if (this.clipOn) {
      const fn = this.clipFn;
      for (let i = offset; i < offset + n; i++) {
        L[i] = this.osL.process(L[i] * d, fn);
        R[i] = this.osR.process(R[i] * d, fn);
      }
    } else {
      const dl = this.dL, dr = this.dR, N = this.dlen;
      let p = this.dpos;
      for (let i = offset; i < offset + n; i++) {
        const l = dl[p], r = dr[p];
        dl[p] = L[i] * d;
        dr[p] = R[i] * d;
        L[i] = l;
        R[i] = r;
        p = p + 1 === N ? 0 : p + 1;
      }
      this.dpos = p;
    }
    this.limiter.process(L, R, n, offset);
  }
}
