// The JC-808 synth track: a looping clip of recorded synth notes that runs
// alongside the 16-step drum pattern. Everything here is pure data so the
// scheduler, the offline render, the piano roll and the tests all agree.
//
// Time is measured in sequencer steps (16ths at the master tempo), so a
// take survives tempo changes, and a "bar" is always 16 steps whatever the
// drum pattern's length is set to. A note is { m: midi, s: start, d: dur, v: vel }.

export const STEPS_PER_BAR = 16;
export const BAR_CHOICES = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
export const MAX_BARS = 64;

/** Quantize grids in steps; 0 means "as played". */
export const GRIDS = { off: 0, "1/4": 4, "1/8": 2, "1/16": 1, "1/32": 0.5 };

export const MIN_DUR = 0.1; // steps — a tap still makes a note

export function emptyTrack() {
  return { bars: 4, quantize: "1/16", mute: false, notes: [] };
}

export const trackSteps = (track) => track.bars * STEPS_PER_BAR;

/** Fold any position (including negative count-in positions) into [0, steps). */
export function wrapPos(pos, steps) {
  const p = pos % steps;
  return p < 0 ? p + steps : p;
}

/** Where a note actually plays: snapped to the grid, folded into the loop. */
export function quantizeStart(start, grid, steps) {
  if (!grid) return wrapPos(start, steps);
  return wrapPos(Math.round(start / grid) * grid, steps);
}

const round3 = (x) => Math.round(x * 1000) / 1000;

/** Append a note, cleaning its numbers. Returns the stored note. */
export function addNote(track, note) {
  const steps = trackSteps(track);
  const n = {
    m: Math.max(0, Math.min(127, Math.round(note.m))),
    s: round3(wrapPos(note.s, steps)),
    d: round3(Math.max(MIN_DUR, note.d)),
    v: note.v == null ? 1 : Math.max(0.05, Math.min(1, note.v))
  };
  if (note._abs != null) n._abs = note._abs;
  track.notes.push(n);
  return n;
}

/**
 * Notes whose (quantized) start lands in the step window [pos, pos + 1).
 * Each hit carries the offset into the step, so the scheduler can place
 * unquantized notes between steps. Notes past the current length are kept
 * in the data but never play — shortening a track is non-destructive.
 */
export function notesStartingInStep(track, pos) {
  const steps = trackSteps(track);
  const grid = GRIDS[track.quantize] || 0;
  const out = [];
  for (const n of track.notes) {
    if (n.s >= steps) continue;
    const q = quantizeStart(n.s, grid, steps);
    if (q >= pos && q < pos + 1) out.push({ note: n, offset: q - pos });
  }
  return out;
}

/**
 * The note under a point on the piano roll (pos in steps, pitch in midi),
 * for click-to-delete. Later notes are drawn on top, so search backwards.
 * `slack` widens very short notes so they stay clickable.
 */
export function noteAt(track, pos, midi, slack = 0.5) {
  const steps = trackSteps(track);
  const grid = GRIDS[track.quantize] || 0;
  for (let i = track.notes.length - 1; i >= 0; i--) {
    const n = track.notes[i];
    if (n.m !== midi || n.s >= steps) continue;
    const q = quantizeStart(n.s, grid, steps);
    const len = Math.max(n.d, slack);
    if (pos >= q && pos < q + len) return n;
    if (q + len > steps && pos < q + len - steps) return n; // wraps past the end
  }
  return null;
}

/** Pitch rows for the roll: the notes' span padded, never fewer than two octaves. */
export function pitchRange(notes, fallbackLo = 55, fallbackHi = 84, minRows = 25) {
  let lo = Infinity, hi = -Infinity;
  for (const n of notes) { if (n.m < lo) lo = n.m; if (n.m > hi) hi = n.m; }
  if (lo === Infinity) return { lo: fallbackLo, hi: fallbackHi };
  lo -= 2; hi += 2;
  while (hi - lo + 1 < minRows) { if (lo > 0) lo--; if (hi - lo + 1 < minRows && hi < 127) hi++; }
  return { lo: Math.max(0, lo), hi: Math.min(127, hi) };
}

/** Rebuild a track from saved / shared data, dropping anything malformed. */
export function normaliseTrack(data) {
  const t = emptyTrack();
  if (!data || typeof data !== "object") return t;
  const bars = Math.round(Number(data.bars));
  if (bars >= 1 && bars <= MAX_BARS) t.bars = bars;
  if (data.quantize in GRIDS) t.quantize = data.quantize;
  t.mute = !!data.mute;
  if (Array.isArray(data.notes)) {
    for (const n of data.notes) {
      if (!n || !isFinite(n.m) || !isFinite(n.s) || !isFinite(n.d)) continue;
      if (n.s < 0 || n.s >= MAX_BARS * STEPS_PER_BAR) continue;
      t.notes.push({
        m: Math.max(0, Math.min(127, Math.round(n.m))),
        s: round3(n.s),
        d: round3(Math.max(MIN_DUR, n.d)),
        v: isFinite(n.v) ? Math.max(0.05, Math.min(1, n.v)) : 1
      });
    }
  }
  return t;
}

/** The storable form: no transient bookkeeping, numbers kept short. */
export function serialiseTrack(track) {
  return {
    bars: track.bars,
    quantize: track.quantize,
    mute: !!track.mute,
    notes: track.notes.map((n) => ({ m: n.m, s: n.s, d: n.d, v: n.v }))
  };
}

/** Notes in seconds at a tempo, as written by core/midi.js writeMidi(). */
export function trackToMidiNotes(track, bpm) {
  const sd = 60 / bpm / 4;
  const steps = trackSteps(track);
  const grid = GRIDS[track.quantize] || 0;
  return track.notes
    .filter((n) => n.s < steps)
    .map((n) => ({ pitch: n.m, start: quantizeStart(n.s, grid, steps) * sd, dur: n.d * sd, vel: n.v }))
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

/** "3.2" — bar and beat of a position, one-based, for the readout. */
export function barBeat(pos, steps) {
  const p = wrapPos(pos, steps);
  return Math.floor(p / STEPS_PER_BAR) + 1 + "." + (Math.floor((p % STEPS_PER_BAR) / 4) + 1);
}
