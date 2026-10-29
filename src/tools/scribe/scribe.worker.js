// SCRIBE worker: the listening. Melody mode runs the pYIN tracker and cuts
// the pitch track into notes; polyphonic mode runs Basic Pitch. Both also
// look for a tempo (beat tracker on the audio, inter-onset intervals on the
// notes) so the panel can snap to a grid straight away.
import { trackPitch } from "../../dsp/autotune.js";
import { segmentNotes } from "../../dsp/chipify/lines.js";
import { stftMag } from "../../dsp/spectral.js";
import { analyzeBeatsFine } from "../../dsp/beats.js";
import { tempoFromOnsets } from "../../dsp/scribe.js";

const hzToMidi = (f) => 69 + 12 * Math.log2(f / 440);

self.onmessage = async (e) => {
  const m = e.data;
  const progress = (stage, p) => self.postMessage({ type: "progress", id: m.id, stage, p });
  try {
    if (m.type !== "listen") return;
    const t0 = performance.now();
    let notes;
    if (m.mode === "poly") {
      progress("Loading Basic Pitch", 0.05);
      const { runBasicPitch, notesFrom } = await import("../../dsp/chipify/transcribe.js");
      const bp = await runBasicPitch(m.mono22, { url: m.modelUrl, onProgress: (p) => progress("Transcribing (Basic Pitch)", 0.1 + 0.7 * p) });
      notes = notesFrom(bp, { onsetThresh: 0.5, frameThresh: 0.3, minNoteFrames: 8 }).filter((n) => n.end - n.start >= 0.06);
    } else {
      progress("Following the pitch (pYIN)", 0.05);
      const track = trackPitch(m.mono22, 22050, { onProgress: (p) => progress("Following the pitch (pYIN)", 0.05 + 0.7 * p) });
      const midi = new Float32Array(track.frames);
      for (let i = 0; i < track.frames; i++) midi[i] = track.voiced[i] && track.f0[i] > 0 ? hzToMidi(track.f0[i]) : NaN;
      notes = segmentNotes(midi, (f) => f * track.hopSec, { minFrames: 5 });
    }
    progress("Finding the beat", 0.85);
    let beat = null;
    try {
      const bt = analyzeBeatsFine(stftMag(m.mono22, 22050, { nfft: 1024, hop: 256 }), { minBpm: 60, maxBpm: 180 });
      beat = { bpm: bt.tempo, beats: bt.beat_times };
    } catch (err) { beat = null; }
    const ioi = tempoFromOnsets(notes);
    // a hummed line has no drums: trust the onsets unless the audio pulses clearly
    const strong = beat && beat.beats.length >= 8 && m.mode === "poly";
    const bpm = strong ? beat.bpm : ioi.confidence > 0.25 ? ioi.bpm : beat ? beat.bpm : 100;
    const firstBeat = strong && beat.beats.length ? beat.beats[0] : notes.length ? Math.min(...notes.map((n) => n.start)) : 0;
    self.postMessage({ type: "notes", id: m.id, notes, bpm, offset: firstBeat, beats: beat ? beat.beats : [], ms: performance.now() - t0 });
  } catch (err) {
    self.postMessage({ type: "error", id: m.id, message: String((err && err.message) || err) });
  }
};
