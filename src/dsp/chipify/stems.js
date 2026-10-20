// HQ stems: Meta's HTDemucs (the model demucs_extract.py runs in Python),
// in the browser through ONNX Runtime Web on WebGPU, via demucs-web (MIT).
// The 172 MB model downloads once into the Cache API. Production builds serve
// ONNX Runtime's wasm from the bundle; the dev server's pre-bundled copy can't,
// so dev pulls the same pinned version from a CDN.

import * as ort from "onnxruntime-web/webgpu";
import { DemucsProcessor, CONSTANTS } from "demucs-web";

export const DEMUCS_URL = CONSTANTS.DEFAULT_MODEL_URL;
export const DEMUCS_SR = CONSTANTS.SAMPLE_RATE; // 44100
const ORT_DIST = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";
const CACHE = "room808-models-v1";

let procP = null;

export function webgpuAvailable() {
  return typeof navigator !== "undefined" && !!navigator.gpu;
}

/** Fetch once, then serve from the Cache API (with download progress). */
async function cachedBuffer(url, onProgress) {
  const cache = typeof caches !== "undefined" ? await caches.open(CACHE) : null;
  if (cache) {
    const hit = await cache.match(url);
    if (hit) return await hit.arrayBuffer();
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`model download failed (${res.status})`);
  const total = +res.headers.get("Content-Length") || 172e6;
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress && onProgress(Math.min(1, got / total));
  }
  const buf = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.length; }
  if (cache) {
    try { await cache.put(url, new Response(buf.slice().buffer, { headers: { "Content-Type": "application/octet-stream" } })); } catch (e) { /* quota: fine, just no cache */ }
  }
  return buf.buffer;
}

export function loadDemucs({ onDownload = null } = {}) {
  if (!procP) {
    procP = (async () => {
      if (!webgpuAvailable()) throw new Error("HQ stems need WebGPU (Chrome, Edge or Safari 18+)");
      if (!import.meta.env.PROD) ort.env.wasm.wasmPaths = ORT_DIST;
      ort.env.wasm.numThreads = 1; // no SharedArrayBuffer needed
      const model = await cachedBuffer(DEMUCS_URL, onDownload);
      const proc = new DemucsProcessor({ ort, sessionOptions: { executionProviders: ["webgpu"], graphOptimizationLevel: "all" } });
      await proc.loadModel(model);
      return proc;
    })();
    procP.catch(() => { procP = null; });
  }
  return procP;
}

/** Separate a 44.1 kHz stereo song into drums / bass / other / vocals. */
export async function separate(L, R, { onProgress = null, onDownload = null } = {}) {
  const proc = await loadDemucs({ onDownload });
  proc.onProgress = (p) => onProgress && onProgress(p.progress);
  return await proc.separate(L, R);
}

/** 44.1 kHz stereo stem → 22.05 kHz mono (half-band low-pass, keep every other sample). */
const HB = (() => {
  const N = 63, C = (N - 1) / 2, h = new Float64Array(N);
  let s = 0;
  for (let n = 0; n < N; n++) {
    const t = n - C;
    const sinc = t === 0 ? 0.5 : Math.sin((Math.PI * t) / 2) / (Math.PI * t);
    h[n] = sinc * (0.42 - 0.5 * Math.cos((2 * Math.PI * n) / (N - 1)) + 0.08 * Math.cos((4 * Math.PI * n) / (N - 1)));
    s += h[n];
  }
  for (let n = 0; n < N; n++) h[n] /= s;
  return h;
})();

export function toMono22(stem) {
  const { left, right } = stem;
  const n = left.length, m = n >> 1, N = HB.length, C = (N - 1) / 2;
  const out = new Float32Array(m);
  for (let o = 0; o < m; o++) {
    const c = 2 * o;
    let acc = 0;
    for (let k = 0; k < N; k++) {
      const j = c + k - C;
      if (j >= 0 && j < n) acc += HB[k] * 0.5 * (left[j] + right[j]);
    }
    out[o] = acc;
  }
  return out;
}
