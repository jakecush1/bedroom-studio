// Melody and bass lines from Basic Pitch output.
//
// A Viterbi pass over pitch states + a silence state, with a jump cost that
// grows linearly with interval (computed in O(states) per frame with a
// two-pass distance transform). The melody runs on the 3-bins-per-semitone
// contour salience (a Melodia-like predominant line, as the Melody extractor
// did with Essentia), biased gently toward the higher, more salient line; the
// bass runs on note activations, biased toward the lowest line.

const BASE_MIDI = 21; // Basic Pitch bin 0 = A0

/**
 * @param {number} T frames
 * @param {number} S pitch states
 * @param {(t:number, j:number)=>number} emit log-likelihood of state j at t
 * @param {(t:number)=>number} emitSil log-likelihood of silence at t
 * @param {number} jump cost per state of distance
 * @param {number} sw cost of switching between silence and pitch
 * @returns {Int32Array} state per frame (S = silence)
 */
export function trackLine(T, S, emit, emitSil, jump, sw) {
  const back = new Int32Array(T * (S + 1));
  let prev = new Float64Array(S + 1), cur = new Float64Array(S + 1);
  const f = new Float64Array(S), fi = new Int32Array(S);
  for (let j = 0; j < S; j++) prev[j] = emit(0, j) - sw;
  prev[S] = emitSil(0);
  for (let t = 1; t < T; t++) {
    // best predecessor among pitch states for every j: max_i prev[i] − jump·|i−j|
    for (let j = 0; j < S; j++) { f[j] = prev[j]; fi[j] = j; }
    for (let j = 1; j < S; j++) if (f[j - 1] - jump > f[j]) { f[j] = f[j - 1] - jump; fi[j] = fi[j - 1]; }
    for (let j = S - 2; j >= 0; j--) if (f[j + 1] - jump > f[j]) { f[j] = f[j + 1] - jump; fi[j] = fi[j + 1]; }
    let bestV = -Infinity, bestVi = 0;
    for (let j = 0; j < S; j++) if (prev[j] > bestV) { bestV = prev[j]; bestVi = j; }
    const o = t * (S + 1);
    for (let j = 0; j < S; j++) {
      const fromSil = prev[S] - sw;
      if (fromSil > f[j]) { cur[j] = fromSil + emit(t, j); back[o + j] = S; }
      else { cur[j] = f[j] + emit(t, j); back[o + j] = fi[j]; }
    }
    const toSil = bestV - sw;
    if (toSil > prev[S]) { cur[S] = toSil + emitSil(t); back[o + S] = bestVi; }
    else { cur[S] = prev[S] + emitSil(t); back[o + S] = S; }
    const tmp = prev; prev = cur; cur = tmp;
  }
  let s = 0;
  for (let j = 1; j <= S; j++) if (prev[j] > prev[s]) s = j;
  const path = new Int32Array(T);
  for (let t = T - 1; t >= 0; t--) {
    path[t] = s;
    if (t > 0) s = back[t * (S + 1) + s];
  }
  return path;
}

/**
 * Predominant melody (fractional MIDI per frame, NaN where silent) from the
 * contour salience (T × 264, 3 bins per semitone from A0).
 */
export function melodyLine(contours, { lo = 48, hi = 88, highBias = 0.6, jump = 0.1, sw = 2.2, voicing = 0.3 } = {}) {
  const T = contours.length;
  const b0 = (lo - BASE_MIDI) * 3, b1 = (hi - BASE_MIDI) * 3, S = b1 - b0 + 1;
  const lv = Math.log(voicing);
  const path = trackLine(
    T, S,
    (t, j) => Math.log(Math.max(contours[t][b0 + j], 1e-4)) + (highBias * j) / S,
    () => lv,
    jump, sw
  );
  const out = new Float32Array(T);
  for (let t = 0; t < T; t++) out[t] = path[t] < S ? lo + path[t] / 3 : NaN;
  return out;
}

/** Bass line (integer MIDI per frame, NaN where silent) from note activations (T × 88). */
export function bassLine(frames, { lo = 28, hi = 57, lowBias = 0.5, jump = 0.35, sw = 1.6, voicing = 0.22 } = {}) {
  const T = frames.length, S = hi - lo + 1;
  const lv = Math.log(voicing);
  const path = trackLine(
    T, S,
    (t, j) => Math.log(Math.max(frames[t][lo - BASE_MIDI + j], 1e-4)) + (lowBias * (S - 1 - j)) / S,
    () => lv,
    jump, sw
  );
  const out = new Float32Array(T);
  for (let t = 0; t < T; t++) out[t] = path[t] < S ? lo + path[t] : NaN;
  return out;
}

/**
 * Cut a pitch track into notes: a new note when the (median-smoothed) semitone
 * changes, or on a strong re-attack at the same pitch.
 * @returns {{pitch:number, start:number, end:number, vel:number}[]} times in seconds
 */
export function segmentNotes(midi, timeOf, { onsets = null, minFrames = 4, onsetSplit = 0.55, strength = null } = {}) {
  const T = midi.length;
  const round = new Float32Array(T).fill(NaN);
  const win = [];
  for (let t = 0; t < T; t++) {
    if (!Number.isFinite(midi[t])) continue;
    win.length = 0;
    for (let j = Math.max(0, t - 2); j <= Math.min(T - 1, t + 2); j++) if (Number.isFinite(midi[j])) win.push(midi[j]);
    win.sort((a, b) => a - b);
    round[t] = Math.round(win[win.length >> 1]);
  }
  const notes = [];
  let cur = null, sum = 0, cnt = 0;
  const close = (end) => {
    if (cur && end - cur.f0 >= minFrames) notes.push({ pitch: cur.pitch, start: timeOf(cur.f0), end: timeOf(end), vel: cnt ? Math.min(1, Math.max(0.35, sum / cnt)) : 0.8 });
    cur = null; sum = 0; cnt = 0;
  };
  for (let t = 0; t < T; t++) {
    const p = round[t];
    if (!Number.isFinite(p)) { close(t); continue; }
    if (!cur) { cur = { pitch: p, f0: t }; }
    else if (p !== cur.pitch) {
      // require the new pitch to hold for 2 frames (vibrato and slides don't split notes)
      if (t + 1 < T && round[t + 1] === p) { close(t); cur = { pitch: p, f0: t }; }
    } else if (onsets && t - cur.f0 >= minFrames) {
      const k = p - BASE_MIDI;
      const o = k >= 0 && k < 88 ? onsets[t][k] : 0;
      const prevO = t > 0 && k >= 0 && k < 88 ? onsets[t - 1][k] : 0;
      if (o > onsetSplit && o >= prevO) { close(t); cur = { pitch: p, f0: t }; }
    }
    if (strength) { sum += strength(t, p); cnt++; }
  }
  close(T);
  return notes;
}
