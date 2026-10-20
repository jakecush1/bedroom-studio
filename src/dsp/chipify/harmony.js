// Chords and key, after MP1_G2 Chord_Detection/chord.py: score chord
// templates from the loudness of each pitch class (chord tones add, other
// tones subtract, 7ths only count when they're strong, notes outside the key
// centre cost), here on beat-synchronous chroma from Basic Pitch note
// activations, then smoothed over beats with Viterbi so chords don't flicker.

export const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

export const CHORD_TYPES = {
  "": [0, 4, 7],
  m: [0, 3, 7],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  dim: [0, 3, 6],
  sus4: [0, 5, 7]
};

const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const SCALE = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };

/**
 * Pitch-class energy per beat from note activations (T × 88, MIDI 21–108).
 * The melody line is down-weighted (it's full of passing tones).
 */
export function beatChroma(frames, frameTime, beatTimes, { melody = null } = {}) {
  const T = frames.length;
  const edges = beatTimes.slice();
  const out = [];
  let t = 0;
  for (let b = 0; b + 1 < edges.length; b++) {
    const c = new Float64Array(12);
    while (t < T && frameTime(t) < edges[b]) t++;
    let u = t;
    while (u < T && frameTime(u) < edges[b + 1]) {
      const row = frames[u];
      const mp = melody && Number.isFinite(melody[u]) ? Math.round(melody[u]) : -1;
      for (let k = 0; k < 88; k++) {
        const v = row[k];
        if (v < 0.15) continue;
        const p = k + 21;
        // mid register carries the harmony; very low and very high notes count less
        const w = p < 36 ? 0.6 : p > 84 ? 0.4 : 1;
        c[p % 12] += v * w * (p === mp ? 0.5 : 1);
      }
      u++;
    }
    out.push(c);
  }
  return out;
}

/** Krumhansl–Kessler key from total chroma. */
export function detectKey(chromas) {
  const tot = new Float64Array(12);
  for (const c of chromas) for (let i = 0; i < 12; i++) tot[i] += c[i];
  let best = { root: 0, mode: "major", score: -2 };
  const corr = (prof, root) => {
    let mx = 0, my = 0;
    for (let i = 0; i < 12; i++) { mx += tot[(i + root) % 12]; my += prof[i]; }
    mx /= 12; my /= 12;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < 12; i++) {
      const a = tot[(i + root) % 12] - mx, b = prof[i] - my;
      sxy += a * b; sxx += a * a; syy += b * b;
    }
    return sxy / Math.sqrt(sxx * syy || 1);
  };
  for (let r = 0; r < 12; r++) {
    for (const [mode, prof] of [["major", KK_MAJOR], ["minor", KK_MINOR]]) {
      const s = corr(prof, r);
      if (s > best.score) best = { root: r, mode, score: s };
    }
  }
  return { ...best, name: `${NOTE_NAMES[best.root]} ${best.mode}` };
}

/** chord.py's compute_likely_chord, normalised to the beat's total energy. */
function chordScore(c, root, tones, keyScale) {
  let total = 0, max = 0;
  for (let i = 0; i < 12; i++) { total += c[i]; if (c[i] > max) max = c[i]; }
  if (total <= 0) return -1;
  const set = new Set(tones.map((x) => (x + root) % 12));
  const seventh = tones.length > 3 ? (tones[3] + root) % 12 : -1;
  let s = 0;
  for (let i = 0; i < 12; i++) {
    const v = c[i] / total;
    if (set.has(i)) {
      // a 7th only supports the chord when it's genuinely loud
      if (i === seventh && c[i] < 0.5 * max) s -= v;
      else s += v;
    } else s -= 0.7 * v;
  }
  if (keyScale) for (const pc of set) if (!keyScale.has(pc)) s -= 0.06;
  // the root should actually sound
  s += 0.25 * (c[root] / max);
  if (tones.length > 3) s -= 0.03; // prefer the simpler chord when it's close
  return s;
}

/**
 * Chord per beat, Viterbi-smoothed.
 * @returns {{start:number,end:number,root:number,type:string,name:string,tones:number[]}[]} merged spans
 */
export function detectChords(chromas, beatTimes, key, { stay = 0.3, silence = 0.02 } = {}) {
  const types = Object.entries(CHORD_TYPES);
  const S = 12 * types.length;
  const keyScale = key ? new Set(SCALE[key.mode].map((x) => (x + key.root) % 12)) : null;
  const N = chromas.length;
  if (!N) return [];
  const score = (b, s) => chordScore(chromas[b], s % 12, types[Math.floor(s / 12)][1], keyScale);
  let prev = new Float64Array(S), cur = new Float64Array(S);
  const back = new Int32Array(N * S);
  for (let s = 0; s < S; s++) prev[s] = score(0, s);
  for (let b = 1; b < N; b++) {
    let best = -Infinity, bi = 0;
    for (let s = 0; s < S; s++) if (prev[s] > best) { best = prev[s]; bi = s; }
    for (let s = 0; s < S; s++) {
      const keep = prev[s] + stay;
      if (keep >= best) { cur[s] = keep + score(b, s); back[b * S + s] = s; }
      else { cur[s] = best + score(b, s); back[b * S + s] = bi; }
    }
    const tmp = prev; prev = cur; cur = tmp;
  }
  let s = 0;
  for (let i = 1; i < S; i++) if (prev[i] > prev[s]) s = i;
  const path = new Int32Array(N);
  for (let b = N - 1; b >= 0; b--) { path[b] = s; if (b > 0) s = back[b * S + s]; }
  const spans = [];
  for (let b = 0; b < N; b++) {
    const c = chromas[b];
    const energy = c.reduce((a, v) => a + v, 0);
    const st = path[b], root = st % 12, [type, tones] = types[Math.floor(st / 12)];
    const quiet = energy < silence;
    const last = spans[spans.length - 1];
    if (!quiet && last && last.root === root && last.type === type && Math.abs(last.end - beatTimes[b]) < 1e-6) last.end = beatTimes[b + 1];
    else if (!quiet) spans.push({ start: beatTimes[b], end: beatTimes[b + 1], root, type, name: NOTE_NAMES[root] + type, tones: tones.map((x) => (x + root) % 12) });
  }
  return spans;
}
