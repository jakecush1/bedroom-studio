// JC-808 synth lanes: the pure clip logic the scheduler, the offline render
// and the piano roll share — loop folding, quantize, step windows, hit
// testing, persistence and MIDI conversion.
import test from "node:test";
import assert from "node:assert/strict";
import {
  STEPS_PER_BAR, GRIDS, MIN_DUR, emptyTrack, trackSteps, wrapPos, quantizeStart, addNote,
  notesStartingInStep, noteAt, pitchRange, normaliseTrack, serialiseTrack, trackToMidiNotes, barBeat
} from "../src/tools/jc808/track.js";

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test("a bar is 16 steps and the loop folds negative (count-in) positions", () => {
  const t = emptyTrack();
  assert.equal(trackSteps(t), 4 * STEPS_PER_BAR);
  t.bars = 2;
  assert.equal(trackSteps(t), 32);
  assert.equal(wrapPos(0, 32), 0);
  assert.equal(wrapPos(32, 32), 0);
  near(wrapPos(33.25, 32), 1.25);
  assert.equal(wrapPos(-16, 32), 16);   // last bar plays during the count-in
  near(wrapPos(-0.5, 32), 31.5);
});

test("quantize snaps to the grid and wraps a snap past the end back to step 0", () => {
  near(quantizeStart(3.4, GRIDS["1/16"], 16), 3);
  near(quantizeStart(3.6, GRIDS["1/16"], 16), 4);
  near(quantizeStart(5.2, GRIDS["1/8"], 16), 6);
  near(quantizeStart(5.9, GRIDS["1/4"], 16), 4);
  near(quantizeStart(15.7, GRIDS["1/16"], 16), 0);   // played just before the loop point
  near(quantizeStart(7.3, GRIDS["1/32"], 16), 7.5);
  near(quantizeStart(7.3, GRIDS.off, 16), 7.3);      // off keeps the feel
});

test("addNote cleans the numbers: folds, clamps pitch, enforces a minimum length", () => {
  const t = emptyTrack();
  t.bars = 1;
  const n = addNote(t, { m: 60.4, s: 17.12345, d: 0.001, v: 2 });
  assert.equal(n.m, 60);
  near(n.s, 1.123, 1e-6);
  assert.equal(n.d, MIN_DUR);
  assert.equal(n.v, 1);
  assert.equal(t.notes.length, 1);
  const abs = addNote(t, { m: 200, s: -1, d: 2, _abs: 47 });
  assert.equal(abs.m, 127);
  assert.equal(abs.s, 15);
  assert.equal(abs._abs, 47);   // transient: kept in memory for the same-pass guard
});

test("notesStartingInStep finds the notes due in a step window, with their offsets", () => {
  const t = emptyTrack();
  t.bars = 1;
  t.quantize = "off";
  addNote(t, { m: 60, s: 4.0, d: 1 });
  addNote(t, { m: 64, s: 4.6, d: 1 });
  addNote(t, { m: 67, s: 5.0, d: 1 });
  addNote(t, { m: 72, s: 15.9, d: 1 });
  const s4 = notesStartingInStep(t, 4);
  assert.deepEqual(s4.map((h) => h.note.m), [60, 64]);
  near(s4[0].offset, 0);
  near(s4[1].offset, 0.6);
  assert.deepEqual(notesStartingInStep(t, 5).map((h) => h.note.m), [67]);
  assert.deepEqual(notesStartingInStep(t, 15).map((h) => h.note.m), [72]);
  assert.deepEqual(notesStartingInStep(t, 0), []);

  // with quantize on, the late note at 4.6 moves to step 5 and 15.9 wraps to step 0
  t.quantize = "1/16";
  assert.deepEqual(notesStartingInStep(t, 4).map((h) => h.note.m), [60]);
  assert.deepEqual(notesStartingInStep(t, 5).map((h) => h.note.m).sort(), [64, 67]);
  assert.deepEqual(notesStartingInStep(t, 0).map((h) => h.note.m), [72]);
  assert.equal(notesStartingInStep(t, 0)[0].offset, 0);
});

test("shortening a lane hides notes past the end without deleting them", () => {
  const t = emptyTrack();
  t.bars = 4;
  addNote(t, { m: 60, s: 2, d: 1 });
  addNote(t, { m: 62, s: 40, d: 1 });   // bar 3
  t.bars = 2;
  assert.deepEqual(notesStartingInStep(t, 8).map((h) => h.note.m), []);   // 40 mod 32 would be 8, but it is simply not played
  assert.equal(t.notes.length, 2);
  t.bars = 4;
  assert.deepEqual(notesStartingInStep(t, 40).map((h) => h.note.m), [62]);
});

test("noteAt hit-tests the roll, including notes that wrap round the loop", () => {
  const t = emptyTrack();
  t.bars = 1;
  t.quantize = "off";
  const a = addNote(t, { m: 60, s: 2, d: 2 });
  const b = addNote(t, { m: 60, s: 15, d: 3 });   // plays 15 → 18, i.e. wraps to 2
  const tap = addNote(t, { m: 64, s: 8, d: MIN_DUR });
  const c = addNote(t, { m: 60, s: 2.5, d: 1 });
  assert.equal(noteAt(t, 3, 60), c);        // later notes draw on top
  assert.equal(noteAt(t, 2.2, 60), a);
  assert.equal(noteAt(t, 1, 60), b);        // b's tail wraps into [0, 2)
  assert.equal(noteAt(t, 1, 62), null);
  assert.equal(noteAt(t, 8.3, 64, 0.5), tap);   // slack keeps a tap clickable
  assert.equal(noteAt(t, 8.3, 64, 0), null);
});

test("pitchRange pads the notes and never shows fewer than two octaves", () => {
  assert.deepEqual(pitchRange([]), { lo: 55, hi: 84 });
  const r = pitchRange([{ m: 60 }, { m: 62 }]);
  assert.ok(r.lo <= 58 && r.hi >= 64);
  assert.ok(r.hi - r.lo + 1 >= 25);
  const wide = pitchRange([{ m: 30 }, { m: 100 }]);
  assert.deepEqual(wide, { lo: 28, hi: 102 });
  const low = pitchRange([{ m: 0 }]);
  assert.equal(low.lo, 0);
});

test("normaliseTrack rebuilds saved data and drops anything malformed", () => {
  const t = normaliseTrack({
    bars: "8", quantize: "1/8", mute: 1,
    notes: [{ m: 60, s: 1, d: 1 }, { m: "x", s: 1, d: 1 }, null, { m: 61, s: -3, d: 1 }, { m: 62, s: 5000, d: 1 }, { m: 63.7, s: 2.00001, d: 0, v: 9 }]
  });
  assert.equal(t.bars, 8);
  assert.equal(t.quantize, "1/8");
  assert.equal(t.mute, true);
  assert.deepEqual(t.notes, [{ m: 60, s: 1, d: 1, v: 1 }, { m: 64, s: 2, d: MIN_DUR, v: 1 }]);
  const d = normaliseTrack({ bars: 999, quantize: "nope" });
  assert.equal(d.bars, 4);
  assert.equal(d.quantize, "1/16");
  assert.deepEqual(normaliseTrack(null), emptyTrack());
});

test("serialiseTrack strips the transient bookkeeping", () => {
  const t = emptyTrack();
  addNote(t, { m: 60, s: 1, d: 1, _abs: 33 });
  const s = serialiseTrack(t);
  assert.deepEqual(s.notes, [{ m: 60, s: 1, d: 1, v: 1 }]);
  assert.equal("_abs" in s.notes[0], false);
  assert.equal(t.notes[0]._abs, 33);
  // round trip
  assert.deepEqual(normaliseTrack(JSON.parse(JSON.stringify(s))).notes, s.notes);
});

test("trackToMidiNotes converts quantized steps to seconds at the tempo", () => {
  const t = emptyTrack();
  t.bars = 2;
  addNote(t, { m: 67, s: 4.4, d: 2 });
  addNote(t, { m: 60, s: 0, d: 1 });
  addNote(t, { m: 72, s: 20, d: 1 });
  t.bars = 1;                               // now past the end: left out
  const notes = trackToMidiNotes(t, 120);   // a step is 0.125 s
  assert.deepEqual(notes.map((n) => n.pitch), [60, 67]);
  near(notes[1].start, 4 * 0.125);
  near(notes[1].dur, 2 * 0.125);
  near(notes[0].dur, 0.125);
});

test("barBeat reads one-based bar.beat of a position on the loop", () => {
  assert.equal(barBeat(0, 64), "1.1");
  assert.equal(barBeat(4, 64), "1.2");
  assert.equal(barBeat(16, 64), "2.1");
  assert.equal(barBeat(63.9, 64), "4.4");
  assert.equal(barBeat(64, 64), "1.1");
});
