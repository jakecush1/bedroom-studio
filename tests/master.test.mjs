// Mastering engine: loudness/true-peak accuracy (EBU Tech 3341/3342 cases),
// filter-bank reconstruction, limiter ceiling, EQ fitting, assistant
// decisions and end-to-end loudness targeting.
import test from "node:test";
import assert from "node:assert/strict";
import { kCoeffs, measure, TruePeakChannel } from "../src/dsp/master/loudness.js";
import { design, magDb, Biquad } from "../src/dsp/master/biquad.js";
import { Crossover4 } from "../src/dsp/master/crossover.js";
import { Oversampler2x } from "../src/dsp/master/dynamics.js";
import { Limiter } from "../src/dsp/master/limiter.js";
import { fitEq, suggest, styleTarget } from "../src/dsp/master/assistant.js";
import { analyzeTrack } from "../src/dsp/master/analyze.js";
import { renderMaster } from "../src/dsp/master/render.js";
import { getFFT } from "../src/dsp/fft.js";
import { rng } from "./helpers/synth.mjs";

const sine = (f, db, seconds, sr, phase = 0) => {
  const a = Math.pow(10, db / 20);
  return Float32Array.from({ length: Math.round(seconds * sr) }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / sr + phase));
};
const concat = (...xs) => {
  const out = new Float32Array(xs.reduce((s, x) => s + x.length, 0));
  let o = 0;
  for (const x of xs) { out.set(x, o); o += x.length; }
  return out;
};

test("K-weighting reproduces the BS.1770 48 kHz coefficients", () => {
  const { pre, rlb } = kCoeffs(48000);
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  near(pre.b0, 1.53512485958697); near(pre.b1, -2.69169618940638); near(pre.b2, 1.19839281085285);
  near(pre.a1, -1.69065929318241); near(pre.a2, 0.73248077421585);
  near(rlb.a1, -1.99004745483398); near(rlb.a2, 0.99007225036621);
});

test("1 kHz sine at −23 dBFS measures −23.0 LUFS (48 and 44.1 kHz)", () => {
  for (const sr of [48000, 44100]) {
    const x = sine(1000, -23, 20, sr);
    const m = measure(x, x, sr);
    assert.ok(Math.abs(m.integrated + 23) < 0.1, `${sr}: ${m.integrated}`);
  }
});

test("gating: EBU 3341 cases with quiet and silent passages", () => {
  const sr = 48000;
  const a = concat(sine(1000, -36, 10, sr), sine(1000, -23, 60, sr), sine(1000, -36, 10, sr));
  assert.ok(Math.abs(measure(a, a, sr).integrated + 23) < 0.1);
  const b = concat(sine(1000, -72, 10, sr), sine(1000, -36, 10, sr), sine(1000, -23, 60, sr), sine(1000, -36, 10, sr), sine(1000, -72, 10, sr));
  assert.ok(Math.abs(measure(b, b, sr).integrated + 23) < 0.1);
});

test("loudness range: EBU 3342 cases", () => {
  const sr = 48000;
  const a = concat(sine(1000, -20, 20, sr), sine(1000, -30, 20, sr));
  const ra = measure(a, a, sr).lra;
  assert.ok(Math.abs(ra - 10) < 1, `LRA ${ra}`);
  const b = concat(sine(1000, -40, 20, sr), sine(1000, -20, 20, sr));
  const rb = measure(b, b, sr).lra;
  assert.ok(Math.abs(rb - 20) < 1, `LRA ${rb}`);
});

test("true peak finds the inter-sample peak of a fs/4 sine at 45°", () => {
  const sr = 48000;
  const x = sine(sr / 4, 0, 1, sr, Math.PI / 4); // samples at ±0.707
  const m = measure(x, x, sr);
  assert.ok(Math.abs(m.samplePeakDb + 3.01) < 0.05, `sample ${m.samplePeakDb}`);
  assert.ok(Math.abs(m.truePeakDb) < 0.25, `true ${m.truePeakDb}`);
  // a 997 Hz tone: true peak ≈ sample peak
  const y = sine(997, -6, 1, sr);
  const my = measure(y, y, sr);
  assert.ok(Math.abs(my.truePeakDb + 6) < 0.1);
});

test("biquad designs hit their nominal gains", () => {
  const sr = 48000;
  assert.ok(Math.abs(magDb(design("peaking", 1000, sr, { q: 1, gainDb: 6 }), 1000, sr) - 6) < 0.01);
  const ls = design("lowshelf", 200, sr, { gainDb: 6 });
  assert.ok(Math.abs(magDb(ls, 20, sr) - 6) < 0.2);
  assert.ok(Math.abs(magDb(ls, 200, sr) - 3) < 0.3);
  const hs = design("highshelf", 5000, sr, { gainDb: -4 });
  assert.ok(Math.abs(magDb(hs, 18000, sr) + 4) < 0.3);
});

test("4-band crossover sums back to a flat response", () => {
  const sr = 48000, N = 16384;
  const xo = new Crossover4(sr, [120, 900, 5500]);
  const y = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const b = xo.split(i === 0 ? 1 : 0);
    y[i] = b[0] + b[1] + b[2] + b[3];
  }
  const fft = getFFT(N), re = new Float64Array(N / 2 + 1), im = new Float64Array(N / 2 + 1);
  fft.forward(y, re, im);
  let worst = 0;
  for (let k = 1; k < N / 2; k++) {
    const f = (k * sr) / N;
    if (f < 20 || f > 20000) continue;
    worst = Math.max(worst, Math.abs(10 * Math.log10(re[k] * re[k] + im[k] * im[k])));
  }
  assert.ok(worst < 0.02, `max deviation ${worst} dB`);
});

test("2× oversampler is transparent with an exact integer latency", () => {
  const sr = 48000;
  const os = new Oversampler2x();
  const x = sine(1000, -6, 0.2, sr);
  const y = Float32Array.from(x, (v) => os.process(v, (u) => u));
  let err = 0;
  for (let i = 500; i < x.length; i++) err = Math.max(err, Math.abs(y[i] - x[i - os.latency]));
  assert.equal(os.latency, 23);
  assert.ok(err < 2e-3, `error ${err}`);
  // gain stays flat to 18 kHz
  const os2 = new Oversampler2x();
  const hf = sine(18000, -6, 0.2, sr);
  const yh = Float32Array.from(hf, (v) => os2.process(v, (u) => u));
  let pIn = 0, pOut = 0;
  for (let i = 2000; i < hf.length; i++) { pIn += hf[i - 23] ** 2; pOut += yh[i] ** 2; }
  assert.ok(Math.abs(10 * Math.log10(pOut / pIn)) < 0.1);
});

test("limiter holds a −1 dBTP ceiling on +12 dB of overload", () => {
  const sr = 48000, n = sr * 4;
  const r = rng(5);
  const L = new Float64Array(n), R = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const beat = (i % 12000) < 400 ? 3 : 1; // transients
    L[i] = (r() * 2 - 1) * beat * 1.4 + Math.sin(i * 0.01) * 0.8;
    R[i] = (r() * 2 - 1) * beat * 1.4 + Math.sin(i * 0.013) * 0.8;
  }
  const lim = new Limiter(sr, { ceilingDb: -1 });
  lim.process(L, R, n);
  for (let i = 0; i < n; i++) assert.ok(Number.isFinite(L[i]) && Number.isFinite(R[i]));
  const m = measure(Float32Array.from(L), Float32Array.from(R), sr);
  assert.ok(m.truePeakDb <= -1 + 0.2, `true peak ${m.truePeakDb}`);
  assert.ok(m.samplePeakDb <= -1 + 1e-6);
});

test("EQ fit tracks a smooth correction curve", () => {
  const sr = 48000;
  const centers = [];
  for (let k = -36; k <= 25; k++) centers.push(1000 * Math.pow(2, k / 6));
  const want = centers.map((f) => 2.5 * Math.tanh(Math.log2(f / 1000)) - (f < 80 ? 1.5 : 0));
  const eq = fitEq(centers, want, sr);
  let se = 0, n = 0;
  for (let i = 0; i < centers.length; i++) {
    const f = centers[i];
    if (f < 30 || f > 16000) continue;
    const got = eq.reduce((s, b) => s + magDb(design(b.type, b.f, sr, { q: b.q, gainDb: b.gainDb }), f, sr), 0);
    se += (got - want[i]) ** 2;
    n++;
  }
  assert.ok(Math.sqrt(se / n) < 0.6, `rms error ${Math.sqrt(se / n)}`);
});

/** A small synthetic mix: kick, snare, hats, bass, pad, with a chosen tilt. */
function mix(seconds, sr, { tilt = 0, seed = 7, level = -20 } = {}) {
  const r = rng(seed);
  const n = Math.round(seconds * sr);
  const L = new Float32Array(n), R = new Float32Array(n);
  const beat = Math.round(sr * 0.5);
  for (let i = 0; i < n; i++) {
    const t = (i % beat) / sr, bar = Math.floor(i / beat);
    const kick = (bar % 2 === 0 ? 1 : 0) * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-t * 30)) * t) * Math.exp(-t * 7);
    const sn = (bar % 2 === 1 ? 1 : 0) * (r() * 2 - 1) * Math.exp(-t * 16) * 0.5;
    const hat = (r() * 2 - 1) * Math.exp(-(((i % (beat / 2)) / sr) * 60)) * 0.12;
    const bass = 0.35 * Math.sin((2 * Math.PI * 55 * i) / sr) * (0.6 + 0.4 * Math.sin(i / sr));
    const pad = 0.12 * (Math.sin((2 * Math.PI * 220 * i) / sr) + 0.6 * Math.sin((2 * Math.PI * 330 * i) / sr + 1) + 0.4 * Math.sin((2 * Math.PI * 440 * i) / sr + 2));
    const c = kick + bass + sn + pad;
    L[i] = c + hat * 1.2 + 0.03 * Math.sin((2 * Math.PI * 660 * i) / sr);
    R[i] = c + hat * 0.8 - 0.03 * Math.sin((2 * Math.PI * 660 * i) / sr);
  }
  // spectral tilt: one-pole low/high emphasis
  if (tilt) {
    for (const x of [L, R]) {
      let y = 0;
      const a = Math.exp((-2 * Math.PI * 2500) / sr);
      for (let i = 0; i < n; i++) {
        y = a * y + (1 - a) * x[i];
        x[i] = tilt < 0 ? y : x[i] + (x[i] - y) * tilt;
      }
    }
  }
  const m = measure(L, R, sr);
  const g = Math.pow(10, (level - m.integrated) / 20);
  for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
  return { L, R };
}

/** Beat-modulated noise with a known tilt: pink, darkened pink, or white. */
function noiseMix(seconds, sr, kind, seed = 3) {
  const r = rng(seed);
  const n = Math.round(seconds * sr);
  const L = new Float32Array(n), R = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, lp = 0;
  const a = Math.exp((-2 * Math.PI * 600) / sr);
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
    lp = a * lp + (1 - a) * pink;
    const x = kind === "white" ? w * 0.3 : kind === "dark" ? lp * 3 : pink;
    const env = 0.35 + 0.65 * Math.exp(-((i % Math.round(sr * 0.5)) / sr) * 6);
    L[i] = x * env;
    R[i] = x * env * 0.9 + 0.05 * (r() * 2 - 1) * env * (kind === "white" ? 0.3 : 0.1);
  }
  return { L, R };
}

test("assistant brightens a dark mix and tames a bright one; styles order the top end", () => {
  const sr = 44100;
  const dark = noiseMix(10, sr, "dark"), bright = noiseMix(10, sr, "white", 4);
  const aDark = analyzeTrack(dark.L, dark.R, sr);
  const aBright = analyzeTrack(bright.L, bright.R, sr);
  const shelf = (s) => s.params.eq.find((e) => e.type === "highshelf").gainDb;
  const sDark = suggest(aDark, { style: "balanced" }), sBright = suggest(aBright, { style: "balanced" });
  assert.ok(shelf(sDark) > 0.5, `dark mix high shelf ${shelf(sDark)}`);
  assert.ok(shelf(sBright) < -0.5, `bright mix high shelf ${shelf(sBright)}`);
  const warm = shelf(suggest(aDark, { style: "warm" })), open = shelf(suggest(aDark, { style: "open" }));
  assert.ok(open > warm, `open ${open} > warm ${warm}`);
  const t = styleTarget("balanced", aDark.centers);
  assert.equal(t.length, aDark.centers.length);
});

test("render hits the loudness target under a −1 dBTP ceiling", async () => {
  const sr = 44100;
  const src = mix(16, sr, { level: -21 });
  const an = analyzeTrack(src.L, src.R, sr);
  for (const intensity of ["low", "medium"]) {
    const s = suggest(an, { style: "balanced", intensity });
    const out = await renderMaster(src.L, src.R, sr, s.params, { targetLufs: s.targetLufs, budget: 12 });
    const m = out.metrics;
    assert.ok(Math.abs(m.integrated - s.targetLufs) < 0.3, `${intensity}: ${m.integrated} vs ${s.targetLufs}`);
    assert.ok(m.truePeakDb <= -1 + 0.2, `${intensity} TP ${m.truePeakDb}`);
    assert.equal(out.L.length, src.L.length);
  }
});

test("loudness is held back when limiting would exceed the budget", async () => {
  const sr = 44100;
  const src = mix(12, sr, { level: -24 });
  const an = analyzeTrack(src.L, src.R, sr);
  const s = suggest(an, { style: "balanced", intensity: "high" });
  const out = await renderMaster(src.L, src.R, sr, s.params, { targetLufs: -4, budget: 1 });
  assert.equal(out.capped, true);
  assert.ok(out.metrics.integrated < -4.5, `held back to ${out.metrics.integrated}`);
  assert.ok(out.depthGr <= 1.3, `limiting depth ${out.depthGr} dB within the 1 dB budget`);
  assert.ok(out.metrics.truePeakDb <= -1 + 0.2);
});
