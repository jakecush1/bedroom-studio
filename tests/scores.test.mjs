import test from "node:test";
import assert from "node:assert/strict";
import { SCORES, parseScore, parseVoice, pitchOf } from "../src/core/scores.js";

test("pitch names", () => {
  assert.equal(pitchOf("C4"), 60);
  assert.equal(pitchOf("A4"), 69);
  assert.equal(pitchOf("F#4"), 66);
  assert.equal(pitchOf("Bb3"), 58);
  assert.equal(pitchOf("C2"), 36);
});

test("voices parse with chords, rests and bar lines", () => {
  const v = parseVoice("C4:1 r:0.5 [E4 G4]:0.5 | D4:2");
  assert.equal(v.length, 4);
  assert.deepEqual(v.notes.map((n) => [n.pitch, n.start, n.dur]), [[60, 0, 1], [64, 1.5, 0.5], [67, 1.5, 0.5], [62, 2, 2]]);
});

test("every classical score is consistent", () => {
  assert.ok(SCORES.length >= 6);
  const ids = new Set();
  for (const score of SCORES) {
    assert.ok(!ids.has(score.id), `duplicate id ${score.id}`);
    ids.add(score.id);
    const p = parseScore(score);
    assert.ok(p.parts.length >= 2, `${score.id} has one voice`);
    // every voice runs the same length
    for (const part of p.parts) assert.ok(Math.abs(part.length - p.beats) < 1e-9, `${score.id}: a voice is ${part.length} beats, the score ${p.beats}`);
    // whole bars
    const [num, den] = score.meter;
    const bar = num * (4 / den);
    const pickup = p.beats % bar;
    assert.ok(pickup < 1e-9 || score.id === "beethoven-elise", `${score.id}: ${p.beats} beats is not whole bars of ${bar}`);
    for (const part of p.parts) for (const n of part.notes) assert.ok(n.pitch >= 36 && n.pitch <= 96, `${score.id}: pitch ${n.pitch} out of range`);
    assert.ok(p.seconds >= 20, `${score.id}: only ${p.seconds.toFixed(1)} s`);
  }
});
