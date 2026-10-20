import test from "node:test";
import assert from "node:assert/strict";
import { RealFFT } from "../src/dsp/fft.js";

test("real FFT matches a naive DFT and inverts exactly", () => {
  for (const n of [8, 64, 1024]) {
    const x = Float32Array.from({ length: n }, (_, i) => Math.sin(i * 0.37) + 0.5 * Math.cos(i * 1.3) + (i % 7) * 0.1);
    const f = new RealFFT(n);
    const re = new Float64Array(n / 2 + 1), im = new Float64Array(n / 2 + 1);
    f.forward(x, re, im);
    for (let k = 0; k <= n / 2; k++) {
      let sr = 0, si = 0;
      for (let t = 0; t < n; t++) { sr += x[t] * Math.cos((2 * Math.PI * k * t) / n); si -= x[t] * Math.sin((2 * Math.PI * k * t) / n); }
      assert.ok(Math.abs(sr - re[k]) < 1e-6 * n && Math.abs(si - im[k]) < 1e-6 * n, `n=${n} k=${k}: ${re[k]},${im[k]} vs ${sr},${si}`);
    }
    const back = new Float64Array(n);
    f.inverse(re, im, back);
    for (let t = 0; t < n; t++) assert.ok(Math.abs(back[t] - x[t]) < 1e-9, `inverse n=${n} t=${t}`);
  }
});
