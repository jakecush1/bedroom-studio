// Renders the classical scores (core/scores.js), the Bach chorale MIDI files
// and the SCRIBE's transcriptions to audio, offline, the first time a tape is
// picked. The notes are synthesised in plain JS (dsp/orchestra.js); Web
// Audio adds a touch of room and a compressor, and the result is normalised
// to −1 dBFS.
import { parseScore } from "./scores.js";
import { parseMidi } from "./midi.js";
import { synthesize, normalise } from "../dsp/orchestra.js";

const SR = 44100;

/**
 * A small room: four feedback combs into two allpasses (Schroeder), built
 * from DelayNodes.
 */
function reverb(ctx) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const damp = ctx.createBiquadFilter();
  damp.type = "lowpass";
  damp.frequency.value = 3200;
  input.connect(damp);
  for (const t of [0.0297, 0.0371, 0.0411, 0.0437]) {
    const d = ctx.createDelay(0.1);
    d.delayTime.value = t;
    const fb = ctx.createGain();
    fb.gain.value = 0.78;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2600;
    damp.connect(d);
    d.connect(lp).connect(fb).connect(d);
    d.connect(output);
  }
  let node = output;
  for (const t of [0.005, 0.0017]) {
    const d = ctx.createDelay(0.05);
    d.delayTime.value = t;
    const fwd = ctx.createGain(), back = ctx.createGain(), sum = ctx.createGain();
    fwd.gain.value = -0.5; back.gain.value = 0.5;
    node.connect(fwd).connect(sum);
    node.connect(d);
    d.connect(back).connect(d);
    d.connect(sum);
    node = sum;
  }
  return { input, output: node };
}

/** Dry synth → room + compressor → AudioBuffer at −1 dBFS. */
async function polish(audio, dry, { wet = 0.22 } = {}) {
  await audio.start();
  normalise(dry.left, dry.right, -3);
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OAC(2, dry.left.length, dry.sampleRate);
  const src = ctx.createBufferSource();
  const buf = ctx.createBuffer(2, dry.left.length, dry.sampleRate);
  buf.copyToChannel(dry.left, 0);
  buf.copyToChannel(dry.right, 1);
  src.buffer = buf;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 10;
  comp.ratio.value = 3;
  comp.attack.value = 0.006;
  comp.release.value = 0.22;
  const dryG = ctx.createGain();
  dryG.gain.value = 1 - wet * 0.5;
  const verb = reverb(ctx);
  const wetG = ctx.createGain();
  wetG.gain.value = wet * 0.35;
  src.connect(dryG).connect(comp);
  src.connect(verb.input);
  verb.output.connect(wetG).connect(comp);
  comp.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  normalise(out.getChannelData(0), out.getChannelData(1), -1);
  return out;
}

/** Render a score from core/scores.js into an AudioBuffer. */
export async function renderScore(audio, score) {
  const sc = parseScore(score);
  const beat = 60 / sc.bpm;
  const notes = [];
  for (let rep = 0; rep < sc.repeats; rep++) {
    const off = 0.05 + rep * sc.beats * beat;
    for (const part of sc.parts) for (const n of part.notes) {
      // a hair of separation between repeated notes, and a little life in the velocities
      notes.push({ pitch: n.pitch, start: off + n.start * beat, dur: Math.max(0.04, n.dur * beat - 0.02), vel: 0.78 + 0.1 * Math.sin(n.start * 1.7 + n.pitch), level: part.level, voice: part.voice });
    }
  }
  return polish(audio, synthesize(notes, { sampleRate: SR, tail: 2.5 }), { wet: score.wet ?? 0.22 });
}

/**
 * Render plain notes (seconds: {pitch, start, dur, vel}) with one instrument.
 * `lead` seconds of silence go in front (to line up with a recording).
 */
export async function renderNotes(audio, notes, { voice = "piano", level = 0.85, lead = 0, tail = 2, wet = 0.25 } = {}) {
  const shifted = notes.map((n) => ({ pitch: n.pitch, start: lead + n.start, dur: Math.max(0.05, n.dur - 0.03), vel: n.vel ?? 0.8, level, voice }));
  return polish(audio, synthesize(shifted, { sampleRate: SR, voice, tail }), { wet });
}

/**
 * Render a MIDI file (its own tempo map) with one instrument. Used for the
 * Bach chorales, which come as four voices on four tracks.
 */
export async function renderMidiFile(audio, url, { voice = "organ", level = 0.8 } = {}) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  const seq = parseMidi(new Uint8Array(await res.arrayBuffer()), url);
  return renderNotes(audio, seq.notes, { voice, level, lead: 0.05, tail: 3, wet: 0.3 });
}
