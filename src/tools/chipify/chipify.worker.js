// Chipify worker: song analysis (beats, transcription, lines, chords, drums)
// once per song, then arrangement + chip rendering on every settings change.
// HQ mode separates stems with HTDemucs first (WebGPU).
import { analyzeSong, renderChip } from "../../dsp/chipify/pipeline.js";

let current = null; // { id, analysis }

self.onmessage = async (e) => {
  const m = e.data;
  const progress = (stage, p) => self.postMessage({ type: "progress", id: m.id, stage, p });
  try {
    if (m.type === "analyze") {
      let stems = null;
      if (m.hq) {
        const { separate, toMono22 } = await import("../../dsp/chipify/stems.js");
        const t0 = performance.now();
        const raw = await separate(m.stereo44[0], m.stereo44[1], {
          onDownload: (p) => progress("Downloading the Demucs model (172 MB, first time only)", 0.02 + 0.1 * p),
          onProgress: (p) => progress("Separating vocals, bass, drums and other (Demucs)", 0.12 + 0.4 * p)
        });
        stems = { vocals: toMono22(raw.vocals), bass: toMono22(raw.bass), other: toMono22(raw.other), drums: toMono22(raw.drums) };
        self.postMessage({ type: "stems", id: m.id, ms: performance.now() - t0 });
      }
      const analysis = await analyzeSong(m.mono22, {
        modelUrl: m.modelUrl,
        stems,
        onProgress: (stage, p) => progress(stage, m.hq ? 0.52 + 0.48 * p : p)
      });
      current = { id: m.id, analysis };
      self.postMessage({ type: "analysis", id: m.id, analysis });
    } else if (m.type === "render") {
      if (!current || current.id !== m.id) return;
      const t0 = performance.now();
      const r = renderChip(current.analysis, m.options);
      self.postMessage({ type: "rendered", id: m.id, seq: m.seq, ms: performance.now() - t0, audio: r.audio, sampleRate: r.sampleRate, notes: r.notes, names: r.names }, [r.audio.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: "error", id: m.id, seq: m.seq, message: String((err && err.message) || err), stack: String((err && err.stack) || "").slice(0, 600) });
  }
};
