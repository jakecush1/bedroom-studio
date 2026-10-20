import test from "node:test";
import assert from "node:assert/strict";
import { yin, freqToMidi } from "../src/dsp/pitch.js";

// the tuner module imports CSS; load just the synth function from source
const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../src/tools/tuner/index.js", import.meta.url), "utf8"));
const ks = new Function(`${src.slice(src.indexOf("export function karplusStrong")).replace("export ", "")}; return karplusStrong;`)();

const cents = (f, ref) => 1200 * Math.log2(f / ref);

test("YIN finds pure tones across the guitar range within 1 cent", () => {
  const sr = 48000;
  for (const f of [41.2, 77.78, 82.41, 110, 146.83, 196, 246.94, 329.63, 659.25]) {
    const buf = new Float32Array(4096);
    for (let i = 0; i < buf.length; i++) buf[i] = 0.5 * Math.sin((2 * Math.PI * f * i) / sr) + 0.2 * Math.sin((2 * Math.PI * 2 * f * i) / sr);
    const r = yin(buf, sr, { fmin: 35, fmax: 1400 });
    assert.ok(r, `no pitch for ${f}`);
    assert.ok(Math.abs(cents(r.freq, f)) < 1, `${f} Hz → ${r.freq.toFixed(3)} Hz`);
  }
});

test("Karplus-Strong reference tones are in tune (E♭ standard + standard)", () => {
  const sr = 48000;
  for (const midi of [39, 44, 49, 54, 58, 63, 40, 45, 50, 55, 59, 64]) {
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const tone = ks(f, sr, 1.0);
    const frame = tone.subarray(4800, 4800 + 4096);
    const r = yin(frame, sr, { fmin: 35, fmax: 1400 });
    assert.ok(r, `no pitch for midi ${midi}`);
    const c = cents(r.freq, f);
    assert.ok(Math.abs(c) < 1.5, `midi ${midi} (${f.toFixed(2)} Hz) measured ${r.freq.toFixed(3)} Hz = ${c.toFixed(2)} cents`);
    assert.equal(Math.round(freqToMidi(r.freq)), midi);
  }
});
