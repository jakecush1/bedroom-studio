// Mastering worker: analysis of the track (and a reference), and the full
// offline render. A newer render request cancels the one in flight.
import { analyzeTrack } from "../../dsp/master/analyze.js";
import { renderMaster } from "../../dsp/master/render.js";

let track = null;
let cache = {};
let latest = 0;

// yield to the message queue now and then so a newer request can cancel
let lastYield = 0;
function checkpointFor(seq) {
  return async () => {
    const now = performance.now();
    if (now - lastYield > 60) {
      lastYield = now;
      await new Promise((r) => setTimeout(r, 0));
    }
    if (seq !== latest) throw new Error("stale");
  };
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === "track") {
      latest = -1; // a new track cancels any render in flight
      track = { L: m.L, R: m.R, sr: m.sr, id: m.id };
      cache = {};
      const analysis = analyzeTrack(m.L, m.R, m.sr, { onProgress: (p) => self.postMessage({ type: "progress", phase: "analyze", p }) });
      self.postMessage({ type: "analysis", id: m.id, analysis });
    } else if (m.type === "reference") {
      const analysis = analyzeTrack(m.L, m.R, m.sr);
      self.postMessage({ type: "refAnalysis", id: m.id, analysis });
    } else if (m.type === "render") {
      latest = m.seq;
      if (!track) return;
      const t0 = performance.now();
      const res = await renderMaster(track.L, track.R, track.sr, m.params, {
        targetLufs: m.targetLufs,
        budget: m.budget,
        cache,
        onProgress: (p) => self.postMessage({ type: "progress", phase: "render", seq: m.seq, p }),
        checkpoint: checkpointFor(m.seq)
      });
      res.ms = performance.now() - t0;
      res.seq = m.seq;
      res.type = "rendered";
      self.postMessage(res, [res.L.buffer, res.R.buffer]);
    }
  } catch (err) {
    if (err.message !== "stale") self.postMessage({ type: "error", seq: m.seq, message: err.message });
  }
};
