import test from "node:test";
import assert from "node:assert/strict";
import { quantize, detectKey, keyInfo, spell, keyAccidental, noteValue, toEvents, toABC, toMusicXML, tempoFromOnsets, toSeconds } from "../src/dsp/scribe.js";

// a C major scale, quarter notes at 120 bpm, sung a little early and late
const SCALE = [60, 62, 64, 65, 67, 69, 71, 72].map((p, i) => ({ pitch: p + (i % 2 ? 0.2 : -0.15), start: i * 0.5 + (i % 3) * 0.02 - 0.02, end: i * 0.5 + 0.47, vel: 0.8 }));

test("quantise snaps a sung scale onto the 16th grid", () => {
  const q = quantize(SCALE, { bpm: 120, division: 4, mono: true });
  assert.equal(q.length, 8);
  q.forEach((n, i) => { assert.equal(n.start, i * 4); assert.equal(n.dur, 4); assert.equal(n.pitch, [60, 62, 64, 65, 67, 69, 71, 72][i]); });
  // the melody is monophonic: an overlapping note cuts the one before
  const m = quantize([{ pitch: 60, start: 0, end: 1.2 }, { pitch: 64, start: 0.5, end: 1.0 }], { bpm: 120, division: 4, mono: true });
  assert.deepEqual(m.map((n) => [n.pitch, n.start, n.dur]), [[60, 0, 4], [64, 4, 4]]);
  // specks go
  assert.equal(quantize([{ pitch: 60, start: 0, end: 0.02 }], { bpm: 120 }).length, 0);
});

test("key detection and spelling", () => {
  const k = detectKey(quantize(SCALE, { bpm: 120 }));
  assert.equal(k.name, "C major");
  assert.equal(k.fifths, 0);
  assert.equal(keyInfo(7, "major").abc, "G");
  assert.equal(keyInfo(7, "major").fifths, 1);
  assert.equal(keyInfo(5, "major").fifths, -1);
  assert.equal(keyInfo(9, "minor").abc, "Am");
  assert.equal(keyInfo(10, "minor").name, "B♭ minor");
  assert.equal(keyAccidental(1, "F"), 1);
  assert.equal(keyAccidental(-2, "E"), -1);
  // F in G major is spelt F♯ by the key; F natural needs the letter F with a natural
  assert.deepEqual(spell(66, 1), { letter: "F", acc: 1, octave: 4 });
  assert.deepEqual(spell(65, 1), { letter: "F", acc: 0, octave: 4 });
  assert.deepEqual(spell(70, -2), { letter: "B", acc: -1, octave: 4 });
  assert.deepEqual(spell(61, 2), { letter: "C", acc: 1, octave: 4 });
  assert.deepEqual(spell(61, -3), { letter: "D", acc: -1, octave: 4 });
  // B♯ sits an octave below its sounding C
  assert.deepEqual(spell(72, 7), { letter: "B", acc: 1, octave: 4 });
});

test("note values respect the beat grid", () => {
  assert.equal(noteValue(0, 16, 4), 16);   // whole note on the downbeat
  assert.equal(noteValue(0, 12, 4), 12);   // dotted half
  assert.equal(noteValue(2, 8, 4), 2);     // off an 8th: only an 8th fits
  assert.equal(noteValue(4, 8, 4), 4);     // on a beat but not on a half-bar: a quarter
  assert.equal(noteValue(1, 5, 4), 1);
  assert.equal(noteValue(8, 6, 4), 6);     // dotted quarter on beat 3
  assert.equal(noteValue(4, 12, 4), 4);    // from beat 2 a dotted quarter would straddle the half-bar
});

test("events tie across bars and merge rests", () => {
  const notes = [{ pitch: 67, start: 12, dur: 8, vel: 0.8 }, { pitch: 60, start: 24, dur: 4, vel: 0.8 }];
  const ev = toEvents(notes, { division: 4, beatsPerBar: 4 });
  assert.deepEqual(ev[0], { start: 0, dur: 12, pitches: [], tie: new Set() });   // a dotted-half rest
  assert.equal(ev[1].start, 12);
  assert.equal(ev[1].dur, 4);
  assert.ok(ev[1].tie.has(67));                 // held into bar 2
  assert.equal(ev[2].start, 16);
  assert.ok(ev[2].tiedFrom.has(67));
  assert.ok(!ev[2].tie.has(67));
});

test("ABC is well formed", () => {
  const q = quantize(SCALE, { bpm: 120, division: 4, mono: true });
  const abc = toABC(q, { bpm: 120, title: "Scale", key: detectKey(q) });
  assert.match(abc, /^X:1\nT:Scale\nM:4\/4\nL:1\/16\nQ:1\/4=120\nK:C clef=treble\n/);
  assert.match(abc, /C4 D4 E4 F4 \| G4 A4 B4 c4 \|\]/);
  // chords, ties and accidentals
  const poly = quantize([{ pitch: 60, start: 0, end: 1 }, { pitch: 64, start: 0, end: 1 }, { pitch: 66, start: 0, end: 2 }, { pitch: 66, start: 2, end: 2.5 }], { bpm: 120, division: 4 });
  const abc2 = toABC(poly, { bpm: 120, title: "Poly", key: keyInfo(0, "major") });
  assert.match(abc2, /\[CE\^F-\]8 F8 \|/);       // the F♯ accidental holds for the bar
  assert.match(abc2, /\^F4 z4 z8 \|\]/);          // a new bar restates it; rests fill to the beat, then the half
});

test("MusicXML has one part, the right measures and paired ties", () => {
  const notes = [{ pitch: 67, start: 12, dur: 8, vel: 0.8 }, { pitch: 60, start: 20, dur: 4, vel: 0.8 }, { pitch: 64, start: 20, dur: 4, vel: 0.8 }];
  const xml = toMusicXML(notes, { bpm: 100, title: "Tie & chord", key: keyInfo(0, "major") });
  assert.equal((xml.match(/<measure /g) || []).length, 2);
  assert.equal((xml.match(/<tie type="start"\/>/g) || []).length, 1);
  assert.equal((xml.match(/<tie type="stop"\/>/g) || []).length, 1);
  assert.equal((xml.match(/<chord\/>/g) || []).length, 1);
  assert.match(xml, /<fifths>0<\/fifths><mode>major<\/mode>/);
  assert.match(xml, /<divisions>4<\/divisions>/);
  assert.match(xml, /<rest\/><duration>12<\/duration><type>half<\/type><dot\/>/);
});

test("tempo from onsets lands on the sung pulse", () => {
  const eighths = Array.from({ length: 16 }, (_, i) => ({ pitch: 60, start: i * 0.25 + (i % 4 === 3 ? 0.25 : 0), end: i * 0.25 + 0.2 }));
  const t = tempoFromOnsets(eighths);
  assert.ok([120, 60].includes(t.bpm) || Math.abs(t.bpm - 120) <= 2, `got ${t.bpm}`);
  const quarters = Array.from({ length: 12 }, (_, i) => ({ pitch: 60, start: i * 0.6, end: i * 0.6 + 0.5 }));
  assert.ok(Math.abs(tempoFromOnsets(quarters).bpm - 100) <= 2, `got ${tempoFromOnsets(quarters).bpm}`);
  const sec = toSeconds([{ pitch: 60, start: 4, dur: 4 }], { bpm: 120, division: 4 });
  assert.deepEqual(sec, [{ pitch: 60, start: 0.5, dur: 0.5, vel: 0.8 }]);
});
