// Pre-bundle the heavy ML dependencies up front, so the dev server doesn't
// discover them mid-session (which forces a full page reload).
export default {
  optimizeDeps: {
    include: ["@tensorflow/tfjs", "@spotify/basic-pitch", "onnxruntime-web/webgpu", "demucs-web", "abcjs"]
  },
  worker: { format: "es" }
};
