// Autotune worker: pitch tracking + key detection once per take, then the
// correction and PSOLA resynthesis whenever the settings change.
import { trackPitch, detectKey, autotune } from "../../dsp/autotune.js";

let take = null;

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === "take") {
      const n = m.chans[0].length;
      const mono = new Float32Array(n);
      for (const c of m.chans) for (let i = 0; i < n; i++) mono[i] += c[i] / m.chans.length;
      const track = trackPitch(mono, m.sr, { onProgress: (p) => self.postMessage({ type: "progress", p }) });
      const key = detectKey(track.f0, track.voiced);
      take = { chans: m.chans, sr: m.sr, track, id: m.id };
      let voiced = 0;
      for (let i = 0; i < track.frames; i++) voiced += track.voiced[i];
      self.postMessage({ type: "analysis", id: m.id, key, hopSec: track.hopSec, voicedPct: (100 * voiced) / Math.max(1, track.frames) });
    } else if (m.type === "render") {
      if (!take || take.id !== m.id) return;
      const t0 = performance.now();
      const res = autotune(take.chans, take.sr, take.track, m.settings);
      const out = {
        type: "rendered", seq: m.seq, id: m.id, ms: performance.now() - t0,
        channels: res.channels, inMidi: res.curve.inMidi, outMidi: res.curve.outMidi, note: res.curve.note,
        hopSec: take.track.hopSec, stats: res.stats
      };
      self.postMessage(out, [...res.channels.map((c) => c.buffer), res.curve.inMidi.buffer, res.curve.outMidi.buffer, res.curve.note.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: "error", seq: m.seq, message: err.message });
  }
};
