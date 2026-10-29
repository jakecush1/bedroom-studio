// SCRIBE — from transcribed notes (seconds) to an engraved score.
//
//  1. quantise: snap onsets and offsets to a grid of 8ths or 16ths at a
//     tempo, cull the specks, keep a melody monophonic.
//  2. key: a duration-weighted pitch-class histogram against the
//     Krumhansl–Kessler profiles → root, mode, key signature.
//  3. engrave: the quantised notes become a single-staff ABC tune (chords in
//     brackets, ties across beats and bars, correct accidentals) that abcjs
//     renders, and the same events become MusicXML for Dorico / MuseScore /
//     Sibelius. midi.py's quantiser and sheet_music.py's note spelling, in
//     the browser.

export const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"];
const FLAT_ORDER = ["B", "E", "A", "D", "G", "C", "F"];

/* ------------------------------------------------------------------ */
/* tempo                                                                */
/* ------------------------------------------------------------------ */

/**
 * Tempo from the inter-onset intervals of the notes themselves (a hummed
 * melody has no drums for the beat tracker). Picks the inter-onset unit
 * whose multiples explain the most onsets, folded into 60–180 bpm.
 */
export function tempoFromOnsets(notes, { minBpm = 72, maxBpm = 160 } = {}) {
  const on = notes.map((n) => n.start).sort((a, b) => a - b);
  if (on.length < 4) return { bpm: 100, confidence: 0 };
  const iois = [];
  for (let i = 1; i < on.length; i++) { const d = on[i] - on[i - 1]; if (d > 0.08 && d < 2.5) iois.push(d); }
  if (iois.length < 3) return { bpm: 100, confidence: 0 };
  // the modal interval on a log scale (a 6%-wide kernel) is taken as a beat...
  let best = { ioi: 0.5, score: -1 };
  for (const c of iois) {
    let score = 0;
    for (const d of iois) score += Math.exp(-0.5 * Math.pow(Math.log(d / c) / 0.06, 2));
    if (score > best.score) best = { ioi: c, score };
  }
  // ...folded into a sensible range by doubling or halving
  let bpm = 60 / best.ioi;
  while (bpm < minBpm) bpm *= 2;
  while (bpm > maxBpm) bpm /= 2;
  // and the grid that explains the most onsets picks between the octaves left
  const fit = (b) => {
    const eighth = 30 / b;
    let ok = 0;
    for (const d of iois) { const u = d / eighth; ok += Math.abs(u - Math.round(u)) < 0.15 ? 1 : 0; }
    return ok;
  };
  const cands = [bpm, bpm * 2, bpm / 2].filter((b) => b >= minBpm && b <= maxBpm);
  cands.sort((a, b) => fit(b) - fit(a) || Math.abs(Math.log(a / 100)) - Math.abs(Math.log(b / 100)));
  bpm = Math.round(cands[0] || bpm);
  return { bpm, confidence: Math.min(1, best.score / iois.length) };
}

/* ------------------------------------------------------------------ */
/* quantise                                                             */
/* ------------------------------------------------------------------ */

/**
 * Snap notes to the grid.
 * @param notes   [{pitch, start, end, vel}] seconds
 * @param o       bpm, division (grid units per beat: 2 = 8ths, 4 = 16ths),
 *                offset (seconds of the first beat), mono (keep one voice)
 * @returns       [{pitch, start, dur, vel}] in grid units, sorted
 */
export function quantize(notes, { bpm = 100, division = 4, offset = 0, mono = false, minUnits = 1 } = {}) {
  const unit = 60 / bpm / division;
  let out = [];
  for (const n of notes) {
    const len = n.end - n.start;
    if (len < unit * 0.35) continue;                 // a speck
    const s = Math.round((n.start - offset) / unit) || 0;   // (|| 0 turns a −0 into 0)
    let e = Math.round((n.end - offset) / unit) || 0;
    if (e <= s) e = s + 1;
    if (s < 0) continue;
    out.push({ pitch: Math.round(n.pitch), start: s, dur: Math.max(minUnits, e - s), vel: n.vel ?? 0.8 });
  }
  out.sort((a, b) => a.start - b.start || b.pitch - a.pitch);
  // merge duplicates: same pitch starting on the same tick
  const merged = [];
  for (const n of out) {
    const prev = merged[merged.length - 1];
    if (prev && prev.start === n.start && prev.pitch === n.pitch) { prev.dur = Math.max(prev.dur, n.dur); continue; }
    merged.push(n);
  }
  out = merged;
  if (mono) {
    // one note at a time: a new onset cuts the previous note off
    const res = [];
    for (const n of out) {
      const prev = res[res.length - 1];
      if (prev && prev.start === n.start) { if (n.dur > prev.dur) res[res.length - 1] = n; continue; }
      if (prev && prev.start + prev.dur > n.start) prev.dur = n.start - prev.start;
      if (prev && prev.dur <= 0) res.pop();
      res.push(n);
    }
    out = res;
  } else {
    // a note must stop when the same pitch starts again
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length && out[j].start < out[i].start + out[i].dur; j++) {
      if (out[j].pitch === out[i].pitch) out[i].dur = out[j].start - out[i].start;
    }
    out = out.filter((n) => n.dur > 0);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* key                                                                  */
/* ------------------------------------------------------------------ */

/** Key of a set of notes (durations weight the histogram). */
export function detectKey(notes) {
  const hist = new Float64Array(12);
  for (const n of notes) hist[((Math.round(n.pitch) % 12) + 12) % 12] += (n.dur ?? 1) + 0.5;
  let total = 0;
  for (let i = 0; i < 12; i++) total += hist[i];
  if (!total) return keyInfo(0, "major", 0);
  const corr = (prof, root) => {
    let mx = 0, my = 0;
    for (let i = 0; i < 12; i++) { mx += hist[i]; my += prof[i]; }
    mx /= 12; my /= 12;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < 12; i++) {
      const a = hist[(i + root) % 12] - mx, b = prof[i] - my;
      sxy += a * b; sxx += a * a; syy += b * b;
    }
    return sxy / Math.sqrt(sxx * syy || 1);
  };
  let best = { root: 0, mode: "major", c: -2 };
  for (let root = 0; root < 12; root++) for (const [mode, prof] of [["major", KK_MAJOR], ["minor", KK_MINOR]]) {
    const c = corr(prof, root);
    if (c > best.c) best = { root, mode, c };
  }
  return keyInfo(best.root, best.mode, best.c);
}

/** root (pitch class), mode → fifths, names for ABC / MusicXML. */
export function keyInfo(root, mode = "major", confidence = 1) {
  const majorRoot = mode === "minor" ? (root + 3) % 12 : root;
  const fifths = ((majorRoot * 7 + 6) % 12) - 6;    // −6 (G♭) … +5 (B)
  const name = spellPc(root, fifths < 0);
  const abc = `${name.replace("♯", "#").replace("♭", "b")}${mode === "minor" ? "m" : ""}`;
  return { root, mode, fifths, confidence, name: `${name} ${mode}`, abc };
}

function spellPc(pc, flats) {
  const sharps = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const flat = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
  return (flats ? flat : sharps)[((pc % 12) + 12) % 12];
}

/** Accidental the key signature puts on a letter: −1, 0 or 1. */
export function keyAccidental(fifths, letter) {
  if (fifths > 0) return SHARP_ORDER.slice(0, fifths).includes(letter) ? 1 : 0;
  if (fifths < 0) return FLAT_ORDER.slice(0, -fifths).includes(letter) ? -1 : 0;
  return 0;
}

/**
 * Spell a MIDI pitch in a key: letter, accidental (−1/0/1) and octave
 * (scientific, C4 = 60). Diatonic notes take the key's spelling; the rest
 * lean towards sharps in sharp keys and flats in flat keys.
 */
export function spell(pitch, fifths) {
  const pc = ((pitch % 12) + 12) % 12;
  let octave = Math.floor(pitch / 12) - 1;
  // the key's own letters first
  for (const L of LETTERS) {
    const acc = keyAccidental(fifths, L);
    if (((LETTER_PC[L] + acc) % 12 + 12) % 12 === pc) return fix({ letter: L, acc, octave }, pitch);
  }
  // natural letter?
  for (const L of LETTERS) if (LETTER_PC[L] === pc) return fix({ letter: L, acc: 0, octave }, pitch);
  // chromatic: sharp of the letter below, or flat of the letter above
  const preferFlats = fifths < 0;
  for (const L of LETTERS) {
    if (!preferFlats && (LETTER_PC[L] + 1) % 12 === pc) return fix({ letter: L, acc: 1, octave }, pitch);
    if (preferFlats && (LETTER_PC[L] + 11) % 12 === pc) return fix({ letter: L, acc: -1, octave }, pitch);
  }
  return fix({ letter: "C", acc: 0, octave }, pitch);
}
// B♯ belongs to the octave below its sounding pitch, C♭ to the one above
function fix(sp, pitch) {
  const nominal = 12 * (sp.octave + 1) + LETTER_PC[sp.letter] + sp.acc;
  if (nominal === pitch + 12) sp.octave -= 1;
  else if (nominal === pitch - 12) sp.octave += 1;
  return sp;
}

/* ------------------------------------------------------------------ */
/* events: the quantised notes as a single timeline of chords and rests  */
/* ------------------------------------------------------------------ */

/**
 * Cut the timeline at every onset and offset. Each segment is a chord (the
 * pitches sounding), with `ties` marking pitches that continue into the next
 * segment, or a rest. Then split segments at bar lines and into printable
 * note values. Units are grid units; `unitsPerBar` = division × beats.
 * @returns [{start, dur, pitches: number[], tie: Set<number>}] (pitches empty = rest)
 */
export function toEvents(notes, { division = 4, beatsPerBar = 4 } = {}) {
  if (!notes.length) return [];
  const unitsPerBar = division * beatsPerBar;
  const cuts = new Set([0]);
  for (const n of notes) { cuts.add(n.start); cuts.add(n.start + n.dur); }
  const end = Math.max(...notes.map((n) => n.start + n.dur));
  const lastBar = Math.ceil(end / unitsPerBar) * unitsPerBar;
  for (let b = 0; b <= lastBar; b += unitsPerBar) cuts.add(b);
  const ticks = [...cuts].filter((t) => t <= lastBar).sort((a, b) => a - b);
  const segs = [];
  for (let i = 0; i + 1 < ticks.length; i++) {
    const a = ticks[i], b = ticks[i + 1];
    const sounding = notes.filter((n) => n.start <= a && n.start + n.dur >= b);
    const pitches = [...new Set(sounding.map((n) => n.pitch))].sort((x, y) => x - y);
    const tie = new Set(sounding.filter((n) => n.start + n.dur > b).map((n) => n.pitch));
    segs.push({ start: a, dur: b - a, pitches, tie });
  }
  // merge consecutive rests
  const merged = [];
  for (const s of segs) {
    const p = merged[merged.length - 1];
    if (p && !p.pitches.length && !s.pitches.length && Math.floor(p.start / unitsPerBar) === Math.floor(s.start / unitsPerBar)) { p.dur += s.dur; continue; }
    merged.push(s);
  }
  // split into printable values
  const out = [];
  for (const s of merged) {
    let pos = s.start, left = s.dur;
    while (left > 0) {
      const v = noteValue(pos % unitsPerBar, left, division);
      const last = left - v <= 0;
      out.push({ start: pos, dur: v, pitches: s.pitches, tie: last ? s.tie : new Set(s.pitches) });
      pos += v;
      left -= v;
    }
  }
  // what each event inherits from the one before (MusicXML tie stops)
  for (let i = 1; i < out.length; i++) out[i].tiedFrom = out[i - 1].tie;
  return out;
}

/**
 * Largest printable note value (in grid units) that fits `left` units from
 * position `pos` in the bar: plain values on their own grid, dotted values
 * on the grid of their undotted half.
 */
export function noteValue(pos, left, division) {
  const whole = division * 4;
  const plain = [whole, whole / 2, whole / 4, whole / 8, whole / 16].filter((v) => v >= 1 && Number.isInteger(v));
  const options = [];
  for (const v of plain) { options.push([v, v]); if (v < whole) options.push([v * 1.5, v]); }
  options.sort((a, b) => b[0] - a[0]);
  for (const [v, grid] of options) {
    if (!Number.isInteger(v) || v > left) continue;
    if (pos % grid !== 0) continue;
    // a dotted value may not straddle the next-stronger beat
    if (v !== grid && (pos / grid) % 2 === 1) continue;
    return v;
  }
  return 1;
}

/* ------------------------------------------------------------------ */
/* ABC                                                                  */
/* ------------------------------------------------------------------ */

function abcPitch(sp, accidentalText) {
  let s = accidentalText + sp.letter;
  if (sp.octave >= 5) { s = accidentalText + sp.letter.toLowerCase() + "'".repeat(sp.octave - 5); }
  else if (sp.octave < 4) { s += ",".repeat(4 - sp.octave); }
  return s;
}

/**
 * The quantised notes as an ABC tune abcjs can render and play.
 * @param o  title, bpm, division, beatsPerBar, beatUnit (4 or 8), key (keyInfo), clef ("treble"|"bass"|"auto")
 */
export function toABC(notes, o = {}) {
  const division = o.division || 4, beatsPerBar = o.beatsPerBar || 4, beatUnit = o.beatUnit || 4;
  const key = o.key || detectKey(notes);
  const unitsPerBar = division * beatsPerBar * (4 / beatUnit);
  const events = toEvents(notes, { division, beatsPerBar: beatsPerBar * (4 / beatUnit) });
  const clef = o.clef && o.clef !== "auto" ? o.clef : pickClef(notes);
  const L = division === 2 ? "1/8" : division === 4 ? "1/16" : division === 8 ? "1/32" : "1/4";
  const head = [
    "X:1",
    `T:${(o.title || "Untitled").replace(/\n/g, " ")}`,
    o.composer ? `C:${o.composer}` : null,
    `M:${beatsPerBar}/${beatUnit}`,
    `L:${L}`,
    `Q:1/4=${Math.round(o.bpm || 100)}`,
    `K:${key.abc} clef=${clef}`
  ].filter(Boolean);
  const body = [];
  let bar = -1, line = "", barsOnLine = 0;
  let state = {};
  const resetState = () => { state = {}; };
  for (const ev of events) {
    const b = Math.floor(ev.start / unitsPerBar);
    if (b !== bar) {
      if (bar >= 0) { line += " |"; barsOnLine++; }
      if (barsOnLine >= 4) { body.push(line.trim()); line = ""; barsOnLine = 0; }
      bar = b;
      resetState();
    }
    const dur = ev.dur === 1 ? "" : String(ev.dur);
    if (!ev.pitches.length) { line += ` z${dur}`; continue; }
    const parts = ev.pitches.map((p) => {
      const sp = spell(p, key.fifths);
      const k = `${sp.letter}${sp.octave}`;
      const current = state[k] ?? keyAccidental(key.fifths, sp.letter);
      let acc = "";
      if (sp.acc !== current) { acc = sp.acc === 1 ? "^" : sp.acc === -1 ? "_" : "="; state[k] = sp.acc; }
      return abcPitch(sp, acc) + (ev.pitches.length > 1 ? "" : dur) + (ev.tie.has(p) ? "-" : "");
    });
    line += " " + (ev.pitches.length > 1 ? `[${parts.join("")}]${dur}` : parts[0]);
  }
  if (line.trim()) body.push((line + " |]").trim());
  else if (body.length) body[body.length - 1] = body[body.length - 1].replace(/\|$/, "|]");
  return [...head, ...body].join("\n") + "\n";
}

export function pickClef(notes) {
  if (!notes.length) return "treble";
  let sum = 0, w = 0;
  for (const n of notes) { sum += n.pitch * n.dur; w += n.dur; }
  return sum / w < 57 ? "bass" : "treble";
}

/* ------------------------------------------------------------------ */
/* MusicXML                                                             */
/* ------------------------------------------------------------------ */

const TYPE_OF = { 16: "whole", 8: "half", 4: "quarter", 2: "eighth", 1: "16th", 0.5: "32nd" };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The same events as a one-part MusicXML score (partwise). */
export function toMusicXML(notes, o = {}) {
  const division = o.division || 4, beatsPerBar = o.beatsPerBar || 4, beatUnit = o.beatUnit || 4;
  const key = o.key || detectKey(notes);
  const unitsPerBar = division * beatsPerBar * (4 / beatUnit);
  const events = toEvents(notes, { division, beatsPerBar: beatsPerBar * (4 / beatUnit) });
  const clef = o.clef && o.clef !== "auto" ? o.clef : pickClef(notes);
  const quarter = division;   // divisions per quarter note
  const typeOf = (units) => {
    const q = units / quarter * 4;  // in 16ths-of-whole units → map: whole=16
    const base = [16, 8, 4, 2, 1, 0.5].find((v) => q === v || q === v * 1.5);
    return { type: TYPE_OF[base] || "quarter", dot: base != null && q === base * 1.5 };
  };
  const measures = [];
  let cur = null, bar = -1;
  for (const ev of events) {
    const b = Math.floor(ev.start / unitsPerBar);
    if (b !== bar) { bar = b; cur = []; measures.push(cur); }
    cur.push(ev);
  }
  const accName = { "-1": "flat", 0: "natural", 1: "sharp" };
  const xmlMeasures = measures.map((evs, mi) => {
    let state = {};
    const attrs = mi === 0 ? `
      <attributes>
        <divisions>${quarter}</divisions>
        <key><fifths>${key.fifths}</fifths><mode>${key.mode}</mode></key>
        <time><beats>${beatsPerBar}</beats><beat-type>${beatUnit}</beat-type></time>
        <clef><sign>${clef === "bass" ? "F" : "G"}</sign><line>${clef === "bass" ? 4 : 2}</line></clef>
      </attributes>
      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(o.bpm || 100)}</per-minute></metronome></direction-type><sound tempo="${Math.round(o.bpm || 100)}"/></direction>` : "";
    const body = evs.map((ev) => {
      const { type, dot } = typeOf(ev.dur);
      const dotXml = dot ? "<dot/>" : "";
      if (!ev.pitches.length) return `      <note><rest/><duration>${ev.dur}</duration><type>${type}</type>${dotXml}</note>`;
      return ev.pitches.map((p, i) => {
        const sp = spell(p, key.fifths);
        const k = `${sp.letter}${sp.octave}`;
        const current = state[k] ?? keyAccidental(key.fifths, sp.letter);
        let accXml = "";
        if (sp.acc !== current) { accXml = `<accidental>${accName[sp.acc]}</accidental>`; state[k] = sp.acc; }
        const tieStart = ev.tie.has(p);
        const tieStop = ev.tiedFrom && ev.tiedFrom.has(p);
        const ties = `${tieStop ? '<tie type="stop"/>' : ""}${tieStart ? '<tie type="start"/>' : ""}`;
        const notations = tieStart || tieStop ? `<notations>${tieStop ? '<tied type="stop"/>' : ""}${tieStart ? '<tied type="start"/>' : ""}</notations>` : "";
        return `      <note>${i > 0 ? "<chord/>" : ""}<pitch><step>${sp.letter}</step>${sp.acc ? `<alter>${sp.acc}</alter>` : ""}<octave>${sp.octave}</octave></pitch><duration>${ev.dur}</duration>${ties}<type>${type}</type>${dotXml}${accXml}${notations}</note>`;
      }).join("\n");
    }).join("\n");
    return `    <measure number="${mi + 1}">${attrs}\n${body}\n    </measure>`;
  });
  // mark tie stops: an event's pitch is tied-from when the previous event tied it
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work><work-title>${esc(o.title || "Untitled")}</work-title></work>
  <identification>${o.composer ? `<creator type="composer">${esc(o.composer)}</creator>` : ""}<encoding><software>Room 808 SCRIBE</software></encoding></identification>
  <part-list><score-part id="P1"><part-name>${esc(o.partName || "Music")}</part-name></score-part></part-list>
  <part id="P1">
${xmlMeasures.join("\n")}
  </part>
</score-partwise>
`;
}

/* ------------------------------------------------------------------ */
/* back to seconds (playback and MIDI)                                  */
/* ------------------------------------------------------------------ */

/** Quantised notes → seconds at the tempo. */
export function toSeconds(notes, { bpm = 100, division = 4 } = {}) {
  const unit = 60 / bpm / division;
  return notes.map((n) => ({ pitch: n.pitch, start: n.start * unit, dur: n.dur * unit, vel: n.vel ?? 0.8 }));
}

/** Where the bar lines fall (seconds), for the playhead. */
export function barTimes(notes, { bpm = 100, division = 4, beatsPerBar = 4, beatUnit = 4 } = {}) {
  const unitsPerBar = division * beatsPerBar * (4 / beatUnit);
  const unit = 60 / bpm / division;
  const end = notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
  const out = [];
  for (let b = 0; b <= end; b += unitsPerBar) out.push(b * unit);
  return out;
}
