// Chipify analysis + render, run inside a worker.
//
//  song (22.05 kHz mono) ─► beat tracker (BT-1 port) ─► 16th grid
//                        ─► HPSS ─► harmonic ─► Basic Pitch ─► melody (salience Viterbi)
//                        │                                  ├► bass line
//                        │                                  └► chords per beat (CD-1 scoring) + key
//                        └► percussive ─► drum hits
//  HQ mode feeds Demucs stems instead: vocals/other → melody, bass → bass,
//  other → chords, drums → drum hits (the demucs_extract.py pipeline).

import { stftMag } from "../spectral.js";
import { analyzeBeatsFine } from "../beats.js";
import { hpss } from "./hpss.js";
import { runBasicPitch, notesFrom, frameTime } from "./transcribe.js";
import { melodyLine, bassLine, segmentNotes } from "./lines.js";
import { beatChroma, detectKey, detectChords } from "./harmony.js";
import { detectDrums, drumPattern } from "./drums.js";
import { arrange, chipPlan, CHANNEL_NAMES } from "./arrange.js";
import { renderSequence } from "../chipsynth.js";
import { measure } from "../master/loudness.js";
import { Limiter } from "../master/limiter.js";

const SR = 22050;
const rms = (x) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, x.length)); };

/**
 * @param {Float32Array} mono22 the song at 22.05 kHz
 * @param {object} o { modelUrl, stems?: {vocals, bass, other, drums} at 22.05 kHz, onProgress(stage, p) }
 */
export async function analyzeSong(mono22, { modelUrl, stems = null, onProgress = () => {} } = {}) {
  const t0 = performance.now();
  const timings = {};
  const lap = (k) => { timings[k] = Math.round(performance.now() - (lap.t || t0)); lap.t = performance.now(); };
  const duration = mono22.length / SR;

  onProgress("Finding the beat", 0.02);
  const beatSrc = stems ? stems.drums.map((v, i) => v + 0.5 * stems.bass[i]) : mono22;
  const bt = analyzeBeatsFine(stftMag(beatSrc, SR, { nfft: 1024, hop: 256 }));
  lap("beats");

  let harmonicSrc, bassSrc = null, percSpec;
  if (stems) {
    // vocals carry the tune in a vocal song; otherwise the "other" stem does
    const vocal = rms(stems.vocals) > 0.25 * rms(stems.other) && rms(stems.vocals) > 0.005;
    harmonicSrc = vocal ? stems.vocals.map((v, i) => v + 0.35 * stems.other[i]) : stems.other;
    bassSrc = stems.bass;
    percSpec = hpss(stems.drums, SR, { nfft: 1024, hop: 256, reconstruct: false }).perc;
    lap("stems");
  } else {
    onProgress("Separating drums from tones", 0.06);
    harmonicSrc = hpss(mono22, SR, { nfft: 2048, hop: 512 }).harmonic;
    percSpec = hpss(mono22, SR, { nfft: 1024, hop: 256, reconstruct: false }).perc;
    lap("hpss");
  }

  onProgress("Transcribing notes (Basic Pitch)", 0.12);
  const bp = await runBasicPitch(harmonicSrc, { url: modelUrl, onProgress: (p) => onProgress("Transcribing notes (Basic Pitch)", 0.12 + 0.6 * p) });
  lap("basicPitch");
  let bpBass = bp;
  if (bassSrc) {
    onProgress("Transcribing the bass stem", 0.74);
    bpBass = await runBasicPitch(bassSrc, { url: modelUrl });
    lap("basicPitchBass");
  }

  onProgress("Following the melody, bass and chords", 0.86);
  const mel = melodyLine(bp.contours);
  const melody = segmentNotes(mel, frameTime, {
    onsets: bp.onsets, minFrames: 5,
    strength: (t, p) => bp.contours[t][Math.max(0, Math.min(263, (p - 21) * 3))]
  });
  const bassTrack = bassLine(bpBass.frames, stems ? { voicing: 0.18 } : {});
  const bass = segmentNotes(bassTrack, frameTime, { onsets: bpBass.onsets, minFrames: 6 });
  const beats = bt.beat_times;
  const chromaFrames = stems ? bp.frames.map((row, t) => (bpBass.frames[t] ? row.map((v, k) => Math.max(v, 0.6 * bpBass.frames[t][k])) : row)) : bp.frames;
  const chromas = beatChroma(chromaFrames, frameTime, beats, { melody: mel });
  const key = detectKey(chromas);
  const chords = detectChords(chromas, beats, key);
  lap("lines");

  onProgress("Hearing the drums", 0.94);
  // Transcribe hits; keep them only if they look like a drum part (sane kick
  // and snare counts per bar), otherwise estimate the pattern bar by bar.
  // With HQ stems the evidence comes from the clean drum stem either way.
  let drums = detectDrums(percSpec), drumMode = "hits";
  {
    const bars = Math.max(1, beats.length / 4);
    const per = (...k) => drums.filter((h) => k.includes(h.kind)).length / bars;
    const plausible = per("kick") >= 0.5 && per("kick") <= (stems ? 4.5 : 3.6) && per("snare") >= 0.8 && per("snare") <= 4.5 && per("hat", "open") <= 17;
    if (!plausible) { drums = drumPattern(percSpec, beats); drumMode = "pattern"; }
  }
  lap("drums");
  const poly = notesFrom(bp);
  onProgress("Arranging", 1);
  return {
    duration, tempo: bt.tempo, beats, key, chords, melody, bass, drums, drumMode,
    polyCount: poly.length, backend: bp.backend, timings, hq: !!stems,
    melodyCurve: Array.from(mel, (v) => (Number.isFinite(v) ? Math.round(v * 3) / 3 : 0))
  };
}

/**
 * Arrange + render. Returns the chip audio (mono, loudness-normalised to
 * −14 LUFS under a −1 dBTP limiter) and the notes for display / MIDI.
 */
export function renderChip(an, { chip = "nes", lead = null, sampleRate = 48000, ...opts } = {}) {
  const { notes } = arrange(an, opts);
  const plan = chipPlan(chip, { lead });
  const seq = { notes, bpm: an.tempo };
  const r = renderSequence(seq, { chip, plan, method: "raw", sampleRate, normalize: false, maxSeconds: an.duration + 2 });
  const L = r.mix;
  // level: −14 LUFS (measured as mono on both speakers), true peak under −1 dBTP
  const m = measure(L, null, sampleRate);
  if (Number.isFinite(m.integrated)) {
    const g = Math.pow(10, (-14 - m.integrated) / 20);
    for (let i = 0; i < L.length; i++) L[i] *= g;
  }
  const lim = new Limiter(sampleRate, { ceilingDb: -1 });
  const R = Float64Array.from(L);
  const LL = Float64Array.from(L);
  const pad = lim.latency;
  const outL = new Float64Array(L.length + pad), outR = new Float64Array(L.length + pad);
  outL.set(LL); outR.set(R);
  lim.process(outL, outR, outL.length);
  const out = Float32Array.from(outL.subarray(pad));
  const lanes = {};
  for (const n of notes) (lanes[n.ch] = lanes[n.ch] || []).push(n);
  return { audio: out, sampleRate, notes, channels: Object.keys(lanes).map(Number), names: CHANNEL_NAMES };
}
