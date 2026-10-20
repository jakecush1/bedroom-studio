// The chip arranger: melody, bass, chords and drums become a four-channel part
// in the 2A03 tradition, quantised to the song's own beat grid.
//   ch0 Pulse 1  melody (vibrato on held notes)
//   ch1 Pulse 2  chord tones as arpeggios (32nd / 16th / 60 Hz "chord" blur / stabs)
//   ch2 Triangle bass (chord roots when no bass line was found)
//   ch3 Pulse 3  optional echo of the lead (an eighth late, quieter)
//   ch9 Noise    drums as LFSR periods: kick low, snare mid, hats high

import { CHIPS } from "../chipsynth.js";

export const ARPS = {
  "32": "32nd arpeggio",
  "16": "16th arpeggio",
  blur: "Chord blur (60 Hz)",
  stab: "Off-beat stabs"
};

/** NES noise period index → (note pitch = 16 − index), length in seconds. */
const DRUM_VOICE = {
  kick: { idx: 13, dur: 0.1 },
  snare: { idx: 8, dur: 0.16 },
  hat: { idx: 1, dur: 0.035 },
  open: { idx: 2, dur: 0.18 },
  crash: { idx: 4, dur: 0.6 }
};

const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

/** Sixteenth-note grid from the beat times, extended to cover the song. */
export function grid16(beats, duration) {
  if (!beats || beats.length < 2) {
    const g = [];
    for (let t = 0; t <= duration + 0.5; t += 0.125) g.push(t);
    return Float64Array.from(g);
  }
  const iv = median(beats.slice(1).map((b, i) => b - beats[i]));
  const pts = [];
  for (let t = beats[0] - iv / 4; t > -iv / 4; t -= iv / 4) pts.unshift(Math.max(0, t));
  for (let i = 0; i < beats.length; i++) {
    const a = beats[i], b = i + 1 < beats.length ? beats[i + 1] : a + iv;
    for (let k = 0; k < 4; k++) pts.push(a + ((b - a) * k) / 4);
  }
  let t = pts[pts.length - 1];
  while (t < duration + iv) { t += iv / 4; pts.push(t); }
  return Float64Array.from(pts);
}

function snap(G, t) {
  let lo = 0, hi = G.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (G[m] <= t) lo = m; else hi = m; }
  return t - G[lo] <= G[hi] - t ? lo : hi;
}

const fold = (p, lo, hi) => { while (p < lo) p += 12; while (p > hi) p -= 12; return p; };

/**
 * @param an analysis: { duration, beats, melody, bass, chords, drums }
 * @param o  { arp, echo, drums, harmony, leadOct, bassOct }
 * @returns {{ notes: {ch,pitch,start,dur,vel,vib?}[], grid: Float64Array }}
 */
export function arrange(an, o = {}) {
  const opt = { arp: "32", echo: false, drums: true, harmony: true, leadOct: 0, bassOct: 0, ...o };
  const G = grid16(an.beats, an.duration);
  const at = (i) => G[Math.max(0, Math.min(G.length - 1, i))];
  const step = median(Array.from(G.slice(1), (v, i) => v - G[i])) || 0.125;
  const notes = [];

  /* ---- lead ---- */
  const lead = [];
  let lastEnd = -1;
  for (const n of an.melody) {
    let i0 = snap(G, n.start), i1 = snap(G, n.end);
    if (i1 <= i0) i1 = i0 + 1;
    if (i0 < lastEnd) i0 = lastEnd;
    if (i1 <= i0) continue;
    const p = fold(n.pitch + 12 * opt.leadOct, 55, 96);
    const start = at(i0), dur = at(i1) - start;
    const note = { ch: 0, pitch: p, start, dur: Math.max(0.03, dur * 0.94), vel: 0.6 + 0.4 * (n.vel ?? 0.8), vib: dur > 0.36 ? 20 : 0 };
    notes.push(note);
    lead.push({ ...note, i0, i1 });
    lastEnd = i1;
  }
  const leadAt = (t) => {
    let lo = 0, hi = lead.length - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1, n = lead[m];
      if (t < n.start) hi = m - 1; else if (t >= n.start + n.dur) lo = m + 1; else return n.pitch;
    }
    return null;
  };

  /* ---- bass ---- */
  let covered = 0, chordTime = 0;
  lastEnd = -1;
  const bassNotes = [];
  for (const n of an.bass) {
    let i0 = snap(G, n.start), i1 = snap(G, n.end);
    if (i1 <= i0) i1 = i0 + 1;
    if (i0 < lastEnd) i0 = lastEnd;
    if (i1 <= i0) continue;
    const start = at(i0), dur = at(i1) - start;
    bassNotes.push({ ch: 2, pitch: fold(n.pitch + 12 * opt.bassOct, 33, 62), start, dur: Math.max(0.03, dur * 0.96), vel: 0.9 });
    covered += dur;
    lastEnd = i1;
  }
  for (const c of an.chords) chordTime += c.end - c.start;
  if (an.chords.length && covered < 0.3 * chordTime) {
    // no usable bass line: walk the chord roots on the beat
    bassNotes.length = 0;
    for (const c of an.chords) {
      const i0 = snap(G, c.start), i1 = snap(G, c.end);
      for (let i = i0; i < i1; i += 4) {
        const root = fold(36 + c.root + 12 * opt.bassOct, 33, 62);
        bassNotes.push({ ch: 2, pitch: (i - i0) % 8 === 4 ? root + 7 : root, start: at(i), dur: Math.max(0.03, (at(Math.min(i + 4, i1)) - at(i)) * 0.9), vel: 0.9 });
      }
    }
  }
  notes.push(...bassNotes);

  /* ---- harmony ---- */
  if (opt.harmony) {
    for (const c of an.chords) {
      const tones = c.tones.map((pc) => fold(60 + pc, 57, 69)).sort((a, b) => a - b);
      if (tones.length === 3) tones.push(tones[0] + 12);
      const i0 = snap(G, c.start), i1 = snap(G, c.end);
      const t0 = at(i0), t1 = at(i1);
      const pick = (k, t) => {
        // steer away from the melody: no unisons or seconds against the lead
        const lp = leadAt(t);
        for (let s = 0; s < tones.length; s++) {
          const p = tones[(k + s) % tones.length];
          if (lp == null || Math.abs(((p - lp) % 12 + 12) % 12) > 1 && Math.abs(((lp - p) % 12 + 12) % 12) > 1) return p;
        }
        return tones[k % tones.length] - 12;
      };
      if (opt.arp === "blur") {
        const d = 1 / 60;
        let k = 0;
        for (let t = t0; t < t1 - d / 2; t += d, k++) notes.push({ ch: 1, pitch: pick(k, t), start: t, dur: d, vel: 0.5 });
      } else if (opt.arp === "stab") {
        for (let i = i0; i < i1; i++) {
          if (i % 4 !== 2) continue; // the "and" of each beat
          for (let k = 0; k < 3; k++) {
            const t = at(i) + (k * step) / 3;
            notes.push({ ch: 1, pitch: pick(k, t), start: t, dur: step / 3, vel: 0.55 });
          }
        }
      } else {
        const sub = opt.arp === "16" ? 1 : 2;
        const order = opt.arp === "16" ? [0, 2, 1, 2] : [0, 1, 2, 3];
        let k = 0;
        for (let i = i0; i < i1; i++) {
          for (let s = 0; s < sub; s++, k++) {
            const t = at(i) + (s * (at(i + 1) - at(i))) / sub;
            const d = (at(i + 1) - at(i)) / sub;
            notes.push({ ch: 1, pitch: pick(order[k % order.length], t), start: t, dur: d * 0.9, vel: 0.5 });
          }
        }
      }
    }
  }

  /* ---- echo ---- */
  if (opt.echo) {
    for (const n of lead) notes.push({ ch: 3, pitch: n.pitch, start: n.start + 2 * step, dur: n.dur, vel: n.vel * 0.45 });
  }

  /* ---- drums ---- */
  if (opt.drums) {
    const seen = new Set();
    for (const h of an.drums) {
      const v = DRUM_VOICE[h.kind];
      if (!v) continue;
      const i = snap(G, h.t);
      const key = `${i}:${h.kind === "open" ? "hat" : h.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      notes.push({ ch: 9, pitch: 16 - v.idx, start: at(i), dur: v.dur, vel: 0.45 + 0.55 * h.vel });
    }
  }
  notes.sort((a, b) => a.start - b.start || a.ch - b.ch);
  return { notes, grid: G };
}

/** Voices for each channel on the chosen chip. */
export function chipPlan(chipId = "nes", { lead = null } = {}) {
  const chip = CHIPS[chipId] && CHIPS[chipId].roles ? CHIPS[chipId] : CHIPS.nes;
  const r = chip.roles;
  const pulsey = chipId === "nes" || chipId === "gameboy";
  return {
    0: { ch: 0, role: "lead", wave: lead && pulsey ? lead : r.lead[0], env: "lead", level: 0.6, octave: 0 },
    1: { ch: 1, role: "harm", wave: r.harm[0], env: "arp", level: 0.32, octave: 0 },
    2: { ch: 2, role: "bass", wave: r.bass[0], env: "d", level: 0.82, octave: 0 },
    3: { ch: 3, role: "extra", wave: r.extra[0], env: "lead", level: 0.3, octave: 0 },
    9: { ch: 9, role: "drums", wave: r.drums[0], env: "nes", level: 0.42, octave: 0, nesNoise: true }
  };
}

export const CHANNEL_NAMES = { 0: "PULSE 1 · melody", 1: "PULSE 2 · harmony", 2: "TRIANGLE · bass", 3: "PULSE 3 · echo", 9: "NOISE · drums" };
