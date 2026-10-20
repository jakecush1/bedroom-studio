// Basic Pitch (Spotify, Apache-2.0) polyphonic transcription, run in a worker.
// Same windowing, unwrapping and frame→time mapping as @spotify/basic-pitch,
// one 2 s window per GPU call (batching is ~8× slower on tfjs-webgl).

import "./winshim.js";
import * as tf from "@tensorflow/tfjs";
import { outputToNotesPoly, addPitchBendsToNoteEvents, noteFramesToTime } from "@spotify/basic-pitch";

export const BP_SR = 22050;
const HOP = 256;
const WIN = BP_SR * 2 - HOP; // 43844
const OVL_FRAMES = 30, HALF = OVL_FRAMES / 2;
const OVL = OVL_FRAMES * HOP;
const HOP_SIZE = WIN - OVL;
const ANNOT_FPS = Math.floor(BP_SR / HOP); // 86
const ANNOT_N_FRAMES = ANNOT_FPS * 2;
const WINDOW_OFFSET = (HOP / BP_SR) * (ANNOT_N_FRAMES - WIN / HOP) + 0.0018;

/** Basic Pitch's model-frame → seconds mapping (corrects the window drift). */
export const frameTime = (f) => (f * HOP) / BP_SR - WINDOW_OFFSET * Math.floor(f / ANNOT_N_FRAMES);

let modelP = null;
export function loadModel(url) {
  if (!modelP) modelP = tf.ready().then(() => tf.loadGraphModel(url));
  return modelP;
}

/**
 * @param {Float32Array} x mono audio at 22050 Hz
 * @returns {Promise<{frames:number[][], onsets:number[][], contours:number[][], backend:string}>}
 */
export async function runBasicPitch(x, { url, batch = 1, onProgress = null } = {}) {
  const model = await loadModel(url);
  const padded = new Float32Array(OVL / 2 + x.length);
  padded.set(x, OVL / 2);
  const nWin = Math.max(1, Math.ceil(padded.length / HOP_SIZE));
  const nOut = Math.floor(x.length * (ANNOT_FPS / BP_SR));
  const frames = [], onsets = [], contours = [];
  for (let w0 = 0; w0 < nWin && frames.length < nOut; w0 += batch) {
    const B = Math.min(batch, nWin - w0);
    const buf = new Float32Array(B * WIN);
    for (let b = 0; b < B; b++) {
      const s = (w0 + b) * HOP_SIZE;
      buf.set(padded.subarray(s, Math.min(padded.length, s + WIN)), b * WIN);
    }
    const input = tf.tensor3d(buf, [B, WIN, 1]);
    const outs = model.execute(input, ["Identity_1", "Identity_2", "Identity"]);
    const [fr, on, co] = await Promise.all(outs.map((o) => o.array()));
    tf.dispose([input, ...outs]);
    for (let b = 0; b < B; b++) {
      const nf = fr[b].length;
      for (let k = HALF; k < nf - HALF && frames.length < nOut; k++) {
        frames.push(fr[b][k]);
        onsets.push(on[b][k]);
        contours.push(co[b][k]);
      }
    }
    if (onProgress) onProgress(Math.min(1, (w0 + B) / nWin));
  }
  return { frames, onsets, contours, backend: tf.getBackend() };
}

/** Polyphonic note events (seconds) from Basic Pitch posteriors. */
export function notesFrom(out, { onsetThresh = 0.5, frameThresh = 0.3, minNoteFrames = 11 } = {}) {
  const raw = outputToNotesPoly(out.frames, out.onsets, onsetThresh, frameThresh, minNoteFrames, true, null, null, true, 11);
  return noteFramesToTime(addPitchBendsToNoteEvents(out.contours, raw)).map((n) => ({
    pitch: n.pitchMidi, start: n.startTimeSeconds, end: n.startTimeSeconds + n.durationSeconds, vel: n.amplitude
  }));
}
