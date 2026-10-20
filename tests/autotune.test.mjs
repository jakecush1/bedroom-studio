// Autotune: pitch tracking, key detection, note snapping and PSOLA output
// pitch on a synthetic singer (formant-filtered glottal pulses, off-pitch
// notes, vibrato, glides).
import test from "node:test";
import assert from "node:assert/strict";
import { trackPitch, detectKey, correctionCurve, autotune, LEVELS } from "../src/dsp/autotune.js";
import { yin } from "../src/dsp/pitch.js";
import { rng } from "./helpers/synth.mjs";

const SR = 44100;
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** A sung phrase: notes from A minor, each detuned, with vibrato and glides. */
function singer({ vibratoCents = 25, seed = 4 } = {}) {
  const notes = [[57, 35], [60, -40], [64, 28], [62, -32], [60, 30], [59, -26], [57, 22]]; // [midi, cents off]
  const dur = 0.7, glide = 0.08;
  const n = Math.round(notes.length * dur * SR);
  const x = new Float32Array(n);
  const truth = new Float32Array(n); // sung pitch, midi
  const r = rng(seed);
  let phase = 0;
  // formant resonators for an "ah"
  const formants = [[700, 110, 1], [1220, 120, 0.5], [2600, 160, 0.25]].map(([f, bw, g]) => {
    const R = Math.exp((-Math.PI * bw) / SR), th = (2 * Math.PI * f) / SR;
    return { a1: -2 * R * Math.cos(th), a2: R * R, g: g * (1 - R), y1: 0, y2: 0 };
  });
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const k = Math.min(notes.length - 1, Math.floor(t / dur));
    const into = t - k * dur;
    let m = notes[k][0] + notes[k][1] / 100;
    if (k > 0 && into < glide) {
      const p = notes[k - 1][0] + notes[k - 1][1] / 100;
      m = p + (m - p) * (into / glide);
    }
    m += (vibratoCents / 100) * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, into / 0.25);
    truth[i] = m;
    phase += midiHz(m) / SR;
    if (phase >= 1) phase -= 1;
    // glottal-ish pulse: sharp closing, rounded opening
    const src = phase < 0.6 ? Math.sin((Math.PI * phase) / 0.6) ** 2 : -0.4 * Math.sin((Math.PI * (phase - 0.6)) / 0.4);
    let y = 0;
    for (const f of formants) {
      const out = f.g * src - f.a1 * f.y1 - f.a2 * f.y2;
      f.y2 = f.y1; f.y1 = out;
      y += out;
    }
    const env = Math.min(1, into / 0.02) * Math.min(1, (dur - into) / 0.03 + 0.4);
    x[i] = 2.2 * y * env + 0.002 * (r() * 2 - 1);
  }
  return { x, truth, notes, dur };
}

/** Measured pitch (midi) of y in 2048-sample frames centred at the given times. */
function pitchAt(y, times) {
  return times.map((t) => {
    const c = Math.round(t * SR), buf = y.subarray(Math.max(0, c - 1024), c + 1024);
    const r = yin(buf, SR, { fmin: 80, fmax: 900 });
    return r ? 69 + 12 * Math.log2(r.freq / 440) : NaN;
  });
}

test("pYIN tracks the sung pitch within 15 cents and finds A minor", () => {
  const { x, truth } = singer();
  const tr = trackPitch(x, SR);
  let n = 0, err = 0;
  for (let f = 0; f < tr.frames; f++) {
    const s = Math.round(f * tr.hopSec * SR);
    if (!tr.voiced[f] || s >= truth.length) continue;
    err += Math.abs(69 + 12 * Math.log2(tr.f0[f] / 440) - truth[s]) * 100;
    n++;
  }
  assert.ok(n > 0.8 * tr.frames, `voiced ${n}/${tr.frames}`);
  assert.ok(err / n < 15, `mean error ${err / n} cents`);
  const key = detectKey(tr.f0, tr.voiced);
  const name = `${key.root}-${key.scale}`;
  assert.ok(name === "9-minor" || name === "0-major", `key ${name}`);
});

test("hard mode snaps every note onto the scale", () => {
  const { x, notes, dur } = singer({ vibratoCents: 25 });
  const tr = trackPitch(x, SR);
  const res = autotune([x], SR, tr, { root: 9, scale: "minor", ...LEVELS.hard });
  const y = res.channels[0];
  assert.equal(y.length, x.length);
  const times = [];
  notes.forEach((_, k) => { for (const f of [0.3, 0.45, 0.6]) times.push(k * dur + f * dur); });
  const before = pitchAt(x, times), after = pitchAt(y, times);
  const off = (arr) => arr.filter(Number.isFinite).map((m) => Math.abs(m - Math.round(m)) * 100);
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const b = mean(off(before)), a = mean(off(after));
  assert.ok(b > 18, `input should be off-pitch (${b} cents)`);
  assert.ok(a < 8, `output within ${a} cents of the notes`);
  // and on the right notes
  after.forEach((m, i) => {
    if (!Number.isFinite(m)) return;
    assert.equal(Math.round(m), notes[Math.floor(i / 3)][0], `note at ${times[i].toFixed(2)} s`);
  });
});

test("natural mode corrects the note centre but keeps the vibrato", () => {
  const { x } = singer({ vibratoCents: 30, seed: 8 });
  const tr = trackPitch(x, SR);
  const nat = correctionCurve(tr, { root: 9, scale: "minor", ...LEVELS.natural });
  const hard = correctionCurve(tr, { root: 9, scale: "minor", ...LEVELS.hard });
  // spread of the corrected pitch inside the held part of the 3rd note
  const spread = (c) => {
    const vals = [];
    for (let f = 0; f < c.outMidi.length; f++) {
      const t = f * tr.hopSec;
      if (t > 1.4 + 0.3 && t < 2.1 - 0.05 && Number.isFinite(c.outMidi[f])) vals.push(c.outMidi[f]);
    }
    const m = vals.reduce((s, v) => s + v, 0) / vals.length;
    return { mean: m, sd: Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / vals.length) * 100 };
  };
  const n = spread(nat), h = spread(hard);
  assert.ok(Math.abs(n.mean - 64) < 0.12, `natural centre ${n.mean}`);
  assert.ok(n.sd > 10, `natural keeps vibrato (sd ${n.sd} cents)`);
  assert.ok(h.sd < 3, `hard is flat (sd ${h.sd} cents)`);
});

test("chromatic snapping never moves a note more than half a semitone", () => {
  const { x } = singer({ seed: 11 });
  const tr = trackPitch(x, SR);
  const c = correctionCurve(tr, { root: 0, scale: "chromatic", ...LEVELS.hard });
  for (let f = 0; f < c.inMidi.length; f++) {
    if (!Number.isFinite(c.inMidi[f])) continue;
    assert.ok(Math.abs(c.outMidi[f] - c.inMidi[f]) <= 0.7, `frame ${f}: ${c.inMidi[f]} → ${c.outMidi[f]}`);
  }
});
