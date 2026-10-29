import test from "node:test";
import assert from "node:assert/strict";
import { synthesize, normalise, VOICES } from "../src/dsp/orchestra.js";
import { SCORES, parseScore } from "../src/core/scores.js";

test("every voice renders a finite, decaying note", () => {
  for (const voice of Object.keys(VOICES)) {
    const r = synthesize([{ pitch: 60, start: 0.1, dur: 0.5, voice }], { sampleRate: 22050, tail: 1.5 });
    assert.ok(r.left.every(Number.isFinite), voice);
    const peak = (a, b) => { let p = 0; for (let i = a; i < b; i++) p = Math.max(p, Math.abs(r.left[i]), Math.abs(r.right[i])); return p; };
    assert.ok(peak(2205, 6615) > 0.05, `${voice} is silent`);
    assert.ok(peak(r.left.length - 2000, r.left.length) < 0.002, `${voice} never stops`);
    assert.ok(peak(0, 2000) === 0, `${voice} sounds before its start`);
  }
});

test("the whole Prelude renders quickly", () => {
  const sc = parseScore(SCORES.find((s) => s.id === "bach-prelude-c"));
  const beat = 60 / sc.bpm;
  const notes = [];
  for (const part of sc.parts) for (const n of part.notes) notes.push({ pitch: n.pitch, start: n.start * beat, dur: n.dur * beat, voice: part.voice, level: part.level });
  const t0 = performance.now();
  const r = synthesize(notes, { sampleRate: 44100 });
  const ms = performance.now() - t0;
  const peak = normalise(r.left, r.right, -1);
  console.log(`  ${notes.length} notes, ${(r.left.length / 44100).toFixed(1)} s of audio in ${ms.toFixed(0)} ms (dry peak ${peak.toFixed(2)})`);
  assert.ok(ms < 4000, `took ${ms} ms`);
  assert.ok(peak > 0.1 && Number.isFinite(peak));
});
