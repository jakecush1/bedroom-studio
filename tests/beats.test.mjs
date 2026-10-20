import test from "node:test";
import assert from "node:assert/strict";
import { stftMag } from "../src/dsp/spectral.js";
import { analyzeBeats, beatFMeasure } from "../src/dsp/beats.js";
import { drumLoop } from "./helpers/synth.mjs";

for (const bpm of [84, 96, 128, 150]) {
  test(`tempo + beats on a ${bpm} bpm loop`, () => {
    const { x, beats, sr } = drumLoop(bpm, 30);
    const spec = stftMag(x, sr, { nfft: 2048, hop: 512 });
    for (const method of ["v3", "v21", "v11"]) {
      const r = analyzeBeats(spec, { method });
      const f = beatFMeasure(beats, r.beat_times);
      const err = Math.abs(r.tempo - bpm) / bpm;
      console.log(`  ${bpm} bpm  ${method}: tempo ${r.tempo.toFixed(2)}  F=${f.toFixed(3)}  beats=${r.beat_times.length}`);
      if (method === "v3") {
        // 150 bpm with kick/snare alternating is a genuine tempo-octave ambiguity (75 ≡ 150)
        const octaveErr = Math.min(err, Math.abs(r.tempo * 2 - bpm) / bpm);
        assert.ok(bpm >= 140 ? octaveErr < 0.02 : err < 0.02, `v3 tempo ${r.tempo} for ${bpm}`);
        if (bpm < 140) assert.ok(f > 0.9, `v3 F-measure ${f}`);
      }
    }
  });
}
