// Chipify engine: tempo (fine tracker), drums, chords, melody/bass lines and
// the chip arrangement, on synthetic material with known answers. (Basic Pitch
// itself needs a browser; its outputs are synthesised here.)
import test from "node:test";
import assert from "node:assert/strict";
import { stftMag } from "../src/dsp/spectral.js";
import { analyzeBeatsFine } from "../src/dsp/beats.js";
import { hpss } from "../src/dsp/chipify/hpss.js";
import { detectDrums, drumPattern } from "../src/dsp/chipify/drums.js";
import { detectChords, detectKey, beatChroma } from "../src/dsp/chipify/harmony.js";
import { melodyLine, bassLine, segmentNotes } from "../src/dsp/chipify/lines.js";
import { arrange, grid16 } from "../src/dsp/chipify/arrange.js";
import { renderChip } from "../src/dsp/chipify/pipeline.js";
import { measure } from "../src/dsp/master/loudness.js";
import { rng } from "./helpers/synth.mjs";

const SR = 22050;

/** Kick on 1 and 3, snare on 2 and 4, eighth hats, a sustained bass under it. */
function drumSong(bpm, bars, { bass = true, seed = 2 } = {}) {
  const r = rng(seed);
  const beat = 60 / bpm, n = Math.round((bars * 4 * beat + 1) * SR);
  const x = new Float32Array(n);
  const kicks = [], snares = [], hats = [];
  const add = (t, fn, len) => { const s = Math.round(t * SR); for (let i = 0; i < len * SR && s + i < n; i++) x[s + i] += fn(i / SR); };
  for (let b = 0; b < bars * 4; b++) {
    const t = 0.1 + b * beat;
    if (b % 2 === 0) { kicks.push(t); add(t, (u) => 0.9 * Math.sin(2 * Math.PI * (48 + 90 * Math.exp(-u * 35)) * u) * Math.exp(-u * 9), 0.35); }
    else { snares.push(t); add(t, (u) => 0.55 * (r() * 2 - 1) * Math.exp(-u * 18) + 0.25 * Math.sin(2 * Math.PI * 190 * u) * Math.exp(-u * 25), 0.22); }
    for (const e of [0, 0.5]) { hats.push(t + e * beat); add(t + e * beat, (u) => 0.18 * (r() * 2 - 1) * Math.exp(-u * 70), 0.05); }
  }
  if (bass) for (let i = 0; i < n; i++) x[i] += 0.12 * Math.sin((2 * Math.PI * 55 * i) / SR);
  return { x, kicks, snares, hats, beat };
}

const fmeasure = (ref, est, tol = 0.05) => {
  let tp = 0;
  const used = new Set();
  for (const t of ref) {
    const i = est.findIndex((e, k) => !used.has(k) && Math.abs(e - t) < tol);
    if (i >= 0) { tp++; used.add(i); }
  }
  const p = tp / Math.max(1, est.length), rc = tp / ref.length;
  return p + rc ? (2 * p * rc) / (p + rc) : 0;
};

test("fine tempo tracker lands on the beat level (92 and 128 bpm)", () => {
  for (const bpm of [92, 128]) {
    const { x } = drumSong(bpm, 12, { bass: false });
    const r = analyzeBeatsFine(stftMag(x, SR, { nfft: 1024, hop: 256 }));
    assert.ok(Math.abs(r.tempo - bpm) / bpm < 0.015, `${bpm}: got ${r.tempo}`);
  }
});

test("drum transcription finds kicks, snares and hats on a clean loop", () => {
  const { x, kicks, snares, hats } = drumSong(100, 8);
  const hits = detectDrums(hpss(x, SR, { nfft: 1024, hop: 256, reconstruct: false }).perc);
  const of = (...k) => hits.filter((h) => k.includes(h.kind)).map((h) => h.t);
  assert.ok(fmeasure(kicks, of("kick")) > 0.9, `kick F ${fmeasure(kicks, of("kick"))}`);
  assert.ok(fmeasure(snares, of("snare")) > 0.9, `snare F ${fmeasure(snares, of("snare"))}`);
  assert.ok(fmeasure(hats, of("hat", "open")) > 0.8, `hat F ${fmeasure(hats, of("hat", "open"))}`);
});

test("drum pattern estimation puts the backbeat on 2 and 4", () => {
  const { x, snares } = drumSong(110, 8);
  const spec = hpss(x, SR, { nfft: 1024, hop: 256, reconstruct: false }).perc;
  const beats = analyzeBeatsFine(stftMag(x, SR, { nfft: 1024, hop: 256 })).beat_times;
  const hits = drumPattern(spec, beats);
  const sn = hits.filter((h) => h.kind === "snare").map((h) => h.t);
  assert.ok(fmeasure(snares.filter((t) => t > beats[0] + 0.01), sn, 0.06) > 0.85, `snare F ${fmeasure(snares, sn, 0.06)}`);
  const perBar = hits.filter((h) => h.kind === "kick").length / (beats.length / 4);
  assert.ok(perBar <= 4.5, `kicks per bar ${perBar}`);
});

/** Basic Pitch-like note activations (T × 88) for a chord progression, 4 beats each. */
function chordFrames(prog, bpm, fps = 86) {
  const beat = 60 / bpm, T = Math.round(prog.length * 4 * beat * fps);
  const frames = Array.from({ length: T }, () => new Array(88).fill(0));
  prog.forEach((tones, c) => {
    for (let t = Math.round(c * 4 * beat * fps); t < Math.round((c + 1) * 4 * beat * fps) && t < T; t++) {
      for (const p of tones) frames[t][p - 21] = 0.8;
    }
  });
  const beats = Array.from({ length: prog.length * 4 + 1 }, (_, i) => i * beat);
  return { frames, beats, fps };
}

test("chords: C Am F G come back as such, in C major", () => {
  const prog = [[48, 52, 55, 60, 64], [45, 52, 57, 60, 64], [41, 53, 57, 60, 65], [43, 55, 59, 62, 67]];
  const { frames, beats, fps } = chordFrames([...prog, ...prog], 100);
  const chroma = beatChroma(frames, (f) => f / fps, beats);
  const key = detectKey(chroma);
  assert.equal(key.name, "C major");
  const chords = detectChords(chroma, beats, key);
  const at = (t) => chords.find((c) => c.start <= t && t < c.end);
  const bar = 4 * 0.6;
  ["C", "Am", "F", "G", "C", "Am", "F", "G"].forEach((name, i) => {
    const c = at(i * bar + 0.3);
    assert.ok(c && c.name === name, `bar ${i + 1}: ${c && c.name} ≠ ${name}`);
  });
});

test("melody and bass lines follow their voices and split into notes", () => {
  const fps = 86, T = fps * 4;
  const mel = [72, 74, 76, 77, 76, 74, 72, 67];
  const contours = Array.from({ length: T }, (_, t) => {
    const row = new Array(264).fill(0.02);
    const p = mel[Math.floor((t / T) * mel.length)];
    const b = (p - 21) * 3;
    row[b] = 0.8; row[b - 1] = 0.4; row[b + 1] = 0.4;
    const acc = (60 - 21) * 3; // a quieter accompaniment line below
    row[acc] = 0.45;
    return row;
  });
  const line = melodyLine(contours);
  const notes = segmentNotes(line, (f) => f / fps, { minFrames: 4 });
  assert.deepEqual(notes.map((n) => n.pitch), mel);
  const frames = Array.from({ length: T }, (_, t) => {
    const row = new Array(88).fill(0);
    row[(t < T / 2 ? 40 : 43) - 21] = 0.7;
    row[64 - 21] = 0.6; // harmony above the bass
    return row;
  });
  const bassNotes = segmentNotes(bassLine(frames), (f) => f / fps, { minFrames: 4 });
  assert.deepEqual(bassNotes.map((n) => n.pitch), [40, 43]);
});

test("arrangement: on the grid, monophonic lead, chord-tone arps, NES noise drums", () => {
  const bpm = 120, beat = 0.5;
  const beats = Array.from({ length: 33 }, (_, i) => 0.2 + i * beat);
  const an = {
    duration: 17, tempo: bpm, beats,
    melody: [{ pitch: 72, start: 0.21, end: 0.68, vel: 0.9 }, { pitch: 74, start: 0.6, end: 1.25, vel: 0.8 }, { pitch: 76, start: 1.2, end: 2.2, vel: 0.8 }],
    bass: [{ pitch: 36, start: 0.2, end: 1.2 }, { pitch: 41, start: 2.2, end: 3.2 }],
    chords: [{ start: 0.2, end: 2.2, root: 0, type: "", name: "C", tones: [0, 4, 7] }, { start: 2.2, end: 4.2, root: 5, type: "", name: "F", tones: [5, 9, 0] }],
    drums: [{ t: 0.21, kind: "kick", vel: 1 }, { t: 0.7, kind: "snare", vel: 0.8 }, { t: 0.45, kind: "hat", vel: 0.5 }]
  };
  const G = grid16(beats, an.duration);
  const onGrid = (t) => G.some((g) => Math.abs(g - t) < 1e-9);
  const { notes } = arrange(an, { arp: "32" });
  const lead = notes.filter((n) => n.ch === 0);
  assert.equal(lead.length, 3);
  for (const n of lead) assert.ok(onGrid(n.start), `lead note at ${n.start} off the grid`);
  for (let i = 1; i < lead.length; i++) assert.ok(lead[i].start >= lead[i - 1].start + lead[i - 1].dur - 1e-9, "lead overlaps");
  const arps = notes.filter((n) => n.ch === 1 && n.start < 2.2);
  assert.ok(arps.length >= 30, `arps ${arps.length}`);
  for (const n of arps) assert.ok([0, 4, 7].includes(n.pitch % 12), `arp ${n.pitch} not in C`);
  const drums = notes.filter((n) => n.ch === 9);
  assert.deepEqual(drums.map((n) => n.pitch).sort((a, b) => a - b), [3, 8, 15]); // kick, snare, hat periods
  // render: −14 LUFS-ish (mono on two speakers), under the −1 dBTP ceiling
  const r = renderChip(an, { chip: "nes", sampleRate: 44100 });
  const m = measure(r.audio, r.audio, 44100);
  assert.ok(m.truePeakDb <= -0.8, `TP ${m.truePeakDb}`);
  assert.ok(Math.abs(m.integrated + 14) < 1.5, `LUFS ${m.integrated}`);
});
