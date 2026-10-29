import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMidi } from "../src/core/midi.js";
import { renderSequence, planChannels, CHIPS, drumSound, crushInPlace } from "../src/dsp/chipsynth.js";

const load = (f) => parseMidi(readFileSync(new URL(`../public/assets/midi/${f}`, import.meta.url)), f);

test("NES-MDB carts map p1/p2/tr/no to pulse, pulse, triangle and LFSR noise", () => {
  // a cart in the NES-MDB layout: four named tracks, noise "pitches" as period indices
  const note = (pitch, start, ch, track) => ({ pitch, start, dur: 0.25, vel: 0.8, ch, track });
  const seq = {
    bpm: 120,
    tracks: [{ index: 0, name: "p1" }, { index: 1, name: "p2" }, { index: 2, name: "tr" }, { index: 3, name: "no" }],
    notes: [note(72, 0, 0, 0), note(76, 0, 1, 1), note(48, 0, 2, 2), note(7, 0, 9, 3), note(74, 0.5, 0, 0), note(4, 0.5, 9, 3)],
    duration: 1
  };
  const plan = planChannels(seq, "nes");
  const roles = Object.values(plan).map((v) => `${v.ch}:${v.role}:${v.wave}`);
  assert.ok(roles.includes("0:lead:pulse50"), roles.join(" "));
  assert.ok(roles.some((r) => r.startsWith("2:bass:tri4")), roles.join(" "));
});

test("every chip renders the Bach chorales cleanly", () => {
  for (const file of ["bach_bwv347.mid", "bach_bwv66_6.mid"]) {
    const seq = load(file);
    for (const chip of Object.keys(CHIPS)) {
      const t0 = performance.now();
      const r = renderSequence(seq, { chip });
      const ms = performance.now() - t0;
      let peak = 0, nan = false;
      for (const v of r.mix) { if (Number.isNaN(v)) nan = true; peak = Math.max(peak, Math.abs(v)); }
      assert.equal(nan, false, `${file} ${chip} has NaN`);
      assert.ok(peak <= 1.0001 && peak > 0.01, `${file} ${chip} peak ${peak}`);
      assert.ok(Math.abs(r.duration - (seq.duration + 1)) < 0.05, `${file} duration ${r.duration} vs ${seq.duration}`);
      if (chip === "original") console.log(`  ${file}: ${seq.notes.length} notes, ${r.duration.toFixed(1)}s audio in ${ms.toFixed(0)} ms`);
    }
  }
});

test("drum kit from sound_engine.py is finite and decays", () => {
  for (const k of ["kick", "snare", "hihat", "cymbal"]) {
    const s = drumSound(k);
    assert.ok(s.every((v) => Number.isFinite(v)), k);
    const head = Math.max(...s.slice(0, 2000).map(Math.abs));
    const tail = Math.max(...s.slice(-200).map(Math.abs));
    assert.ok(head > 0.3 && tail < head * 0.2, `${k} head ${head} tail ${tail}`);
  }
});

test("bitcrusher matches bitcrusher_effect() at 8 bits", () => {
  const y = Float32Array.from({ length: 64 }, (_, i) => Math.sin(i / 5));
  const c = crushInPlace(y.slice(), 8);
  // factor = int(2 ** ((16 - 8) / 4)) = 4: samples hold in groups of four
  for (let i = 0; i < 64; i++) assert.equal(c[i], c[i - (i % 4)]);
  const q = Math.round((Math.sin(0) + 1) * 0.5 * 255) / 255 * 2 - 1;
  assert.ok(Math.abs(c[0] - q) < 1e-6);
});
