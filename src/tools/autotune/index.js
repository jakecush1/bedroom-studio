// VOX-1 — vocal autotune. Record or load a vocal, pick a level (Subtle →
// Hard) and a key (detected, or your own), hear it against the original and
// take the tuned vocal out as a WAV, to the tape library, or straight into
// MASTER-1.
import "./autotune.css";
import { el, button, seg, field, select, knob, screen, tapeDeck, module, progress, clamp } from "../../ui/kit.js";
import { SyncPlayer } from "../../core/audio.js";
import { downloadBlob } from "../../core/wav.js";
import { LEVELS, SCALES, NOTE_NAMES } from "../../dsp/autotune.js";
import { encodeMaster } from "../master/export.js";

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function create(studio, host) {
  const audio = studio.audio, lib = studio.library;
  const st = {
    item: null, id: 0, seq: 0, sr: 48000,
    level: "natural", root: "auto", scale: "auto",
    custom: { retuneMs: null, amount: null, vibrato: null },
    key: null, result: null, tuned: null, ab: "tuned", zoom: "all", busy: null
  };
  const live = { playing: false, busy: false, note: null, level: "Natural" };
  studio.state.autotune = live;
  const worker = new Worker(new URL("./autotune.worker.js", import.meta.url), { type: "module" });
  const player = new SyncPlayer(audio, "autotune");
  player.loop = true;

  const root = el("div", "kit autotune");
  host.appendChild(root);

  /* ---------- input ---------- */
  const inMod = module("Vocal", "record a take, load a file, or pick a tape");
  const deck = tapeDeck(studio, { kinds: ["audio"], label: "Take", onPick: (it) => loadTake(it), preferBuiltin: (i) => i.source === "demo-vocal" });
  const info = el("p", "k-note at-info", "Hit Record and sing (headphones on), or drop a vocal file here. Dry, solo vocals work best.");
  inMod.append(deck, info);
  deck.dropTarget(inMod);
  root.appendChild(inMod);

  /* ---------- levels ---------- */
  const levels = el("div", "at-levels");
  const cards = {};
  for (const [k, L] of Object.entries(LEVELS)) {
    const c = el("button", `at-card at-${k}`);
    c.type = "button";
    c.innerHTML = "<b></b><span></span><i></i>";
    c.querySelector("b").textContent = L.label;
    c.querySelector("span").textContent = L.blurb;
    c.querySelector("i").textContent = L.retuneMs ? `${L.retuneMs} ms retune` : "instant retune";
    c.addEventListener("click", () => {
      st.level = k;
      st.custom = { retuneMs: null, amount: null, vibrato: null };
      paintLevels();
      rerender();
    });
    cards[k] = c;
    levels.appendChild(c);
  }
  root.appendChild(levels);

  /* ---------- key + fine controls ---------- */
  const keyRow = el("div", "k-row end at-keyrow");
  const rootSel = select([["auto", "Auto-detect"], ...NOTE_NAMES.map((n, i) => [String(i), n])], "auto", (v) => { st.root = v; rerender(); });
  const scaleSel = select([["auto", "Auto-detect"], ...Object.entries(SCALES).map(([k, s]) => [k, s.label])], "auto", (v) => { st.scale = v; rerender(); });
  const keyOut = el("div", "at-key", "Key: —");
  const kRetune = knob({ label: "Retune", min: 0, max: 200, value: 55, step: 1, format: (v) => (v < 1 ? "instant" : `${Math.round(v)} ms`), onChange: (v) => { st.custom.retuneMs = v; rerender(); } });
  const kAmount = knob({ label: "Amount", min: 0, max: 1, value: 0.92, step: 0.01, format: (v) => `${Math.round(v * 100)}%`, onChange: (v) => { st.custom.amount = v; rerender(); } });
  const kVib = knob({ label: "Vibrato", min: 0, max: 1, value: 0.85, step: 0.01, format: (v) => `${Math.round(v * 100)}% kept`, onChange: (v) => { st.custom.vibrato = v; rerender(); } });
  keyRow.append(field("Key", rootSel), field("Scale", scaleSel), keyOut, el("div", "grow"), kRetune, kAmount, kVib);
  root.appendChild(keyRow);

  /* ---------- transport ---------- */
  const tr = el("div", "k-row at-transport");
  const playBtn = button("▶ Play", () => togglePlay(), { cls: "primary big" });
  const timeOut = el("span", "at-time", "0:00 / 0:00");
  const abSeg = seg([["original", "Original"], ["tuned", "Tuned"]], st.ab, (v) => setAB(v), { label: "A/B" });
  const zoomSeg = seg([["all", "Whole take"], ["near", "Zoom"]], st.zoom, (v) => { st.zoom = v; graph.draw(); }, { label: "View" });
  const loopBtn = button("Loop", (on) => { player.loop = on; if (player.playing) player.play(player.position); }, { toggle: true, on: true });
  const status = el("div", "at-status");
  const statusText = el("span", null, "Waiting for a vocal");
  const bar = progress();
  status.append(statusText, bar);
  tr.append(playBtn, timeOut, field("Listen", abSeg), field("View", zoomSeg), loopBtn, el("div", "grow"), status);
  root.appendChild(tr);

  /* ---------- pitch graph ---------- */
  const graph = screen(300, drawGraph, { cls: "at-graph" });
  graph.canvas.title = "Click to jump";
  graph.canvas.addEventListener("click", (e) => {
    if (!player.duration) return;
    const r = graph.canvas.getBoundingClientRect();
    const [t0, t1] = viewRange();
    player.seek(t0 + ((e.clientX - r.left) / r.width) * (t1 - t0));
    if (!player.playing) togglePlay();
  });
  root.appendChild(graph.canvas);
  const stats = el("p", "k-note at-stats", "");
  root.appendChild(stats);

  /* ---------- output ---------- */
  const out = el("div", "k-row at-out");
  const dl = button("Download WAV · 24-bit", () => download(), { cls: "primary" });
  const tape = button("Save to tape library", () => saveTape());
  const toMaster = button("Master it → MASTER-1", () => sendToMaster(), { title: "Save the tuned vocal and open the mastering desk with it" });
  out.append(dl, tape, toMaster);
  root.appendChild(out);

  /* ---------- logic ---------- */
  function settings() {
    const L = LEVELS[st.level];
    const key = st.key || { root: 0, scale: "chromatic" };
    return {
      root: st.root === "auto" ? key.root : +st.root,
      scale: st.scale === "auto" ? (st.key ? key.scale : "chromatic") : st.scale,
      retuneMs: st.custom.retuneMs ?? L.retuneMs,
      amount: st.custom.amount ?? L.amount,
      vibrato: st.custom.vibrato ?? L.vibrato
    };
  }

  function paintLevels() {
    for (const [k, c] of Object.entries(cards)) c.classList.toggle("on", st.level === k);
    const s = settings();
    if (st.custom.retuneMs == null) kRetune.setValue(s.retuneMs);
    if (st.custom.amount == null) kAmount.setValue(s.amount);
    if (st.custom.vibrato == null) kVib.setValue(s.vibrato);
    live.level = LEVELS[st.level].label;
  }

  function setBusy(text, p = 0) {
    st.busy = text;
    live.busy = !!text;
    status.classList.toggle("busy", !!text);
    if (text) statusText.textContent = text;
    bar.set(text ? p : 1);
    dl.disabled = tape.disabled = toMaster.disabled = !!text || !st.tuned;
  }

  async function loadTake(item) {
    if (!item) return;
    st.item = item;
    st.key = null;
    st.result = null;
    st.tuned = null;
    st.id++;
    setBusy("Listening for the melody…", 0.02);
    try {
      await audio.start();
      await lib.load(item);
      const buf = item.buffer;
      st.sr = buf.sampleRate;
      const chans = [];
      for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) chans.push(buf.getChannelData(c).slice());
      player.setTracks([{ buffer: buf, level: st.ab === "original" ? 1 : 0 }]);
      worker.postMessage({ type: "take", id: st.id, chans, sr: buf.sampleRate }, chans.map((c) => c.buffer));
      info.textContent = `${item.name} · ${fmtTime(buf.duration)} · tracking pitch…`;
      timeOut.textContent = `0:00 / ${fmtTime(buf.duration)}`;
      graph.draw();
    } catch (err) {
      setBusy(null);
      studio.toast(err.message, { error: true });
    }
  }

  let timer = 0;
  function rerender() {
    paintLevels();
    if (!st.key || !st.item) return;
    const s = settings();
    keyOut.textContent = `Key: ${NOTE_NAMES[s.root]} ${SCALES[s.scale].label.toLowerCase()}${st.root === "auto" && st.scale === "auto" ? " (detected)" : ""}`;
    clearTimeout(timer);
    const seq = ++st.seq;
    setBusy("Tuning…", 0.6);
    timer = setTimeout(() => worker.postMessage({ type: "render", id: st.id, seq, settings: s }), st.tuned ? 180 : 0);
  }

  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === "progress") setBusy("Listening for the melody…", m.p * 0.6);
    else if (m.type === "analysis") {
      if (m.id !== st.id) return;
      st.key = m.key;
      info.textContent = `${st.item.name} · ${fmtTime(st.item.buffer.duration)} · singing ${Math.round(m.voicedPct)}% of the time · sounds like ${NOTE_NAMES[m.key.root]} ${m.key.scale}`;
      if (m.voicedPct < 3) {
        setBusy(null);
        statusText.textContent = "No singing found in this take";
        return;
      }
      rerender();
    } else if (m.type === "rendered") {
      if (m.seq !== st.seq || m.id !== st.id) return;
      st.result = m;
      const chans = m.channels.length > 1 ? m.channels : [m.channels[0], m.channels[0]];
      st.tuned = audio.bufferFrom(chans, st.sr);
      player.setTracks([
        { buffer: st.item.buffer, level: st.ab === "original" ? 1 : 0 },
        { buffer: st.tuned, level: st.ab === "tuned" ? 1 : 0 }
      ]);
      setBusy(null);
      const s = m.stats;
      statusText.textContent = `Tuned in ${(m.ms / 1000).toFixed(1)} s`;
      stats.textContent = `Moved ${Math.round(s.movedPct)}% of the sung frames, by ${Math.round(s.avgCents)} cents on average.`;
      graph.draw();
    } else if (m.type === "error") {
      setBusy(null);
      statusText.textContent = `Couldn't tune: ${m.message}`;
    }
  };

  function setAB(v) {
    st.ab = v;
    abSeg.set(v);
    if (player.tracks.length > 1) {
      player.setLevel(0, v === "original" ? 1 : 0);
      player.setLevel(1, v === "tuned" ? 1 : 0);
    } else if (player.tracks.length) player.setLevel(0, 1);
    graph.draw();
  }

  async function togglePlay() {
    if (!st.item || !st.item.buffer) return studio.toast("Record or load a vocal first");
    await audio.start();
    player.toggle();
  }

  player.on("state", (on) => {
    live.playing = on;
    playBtn.textContent = on ? "❚❚ Pause" : "▶ Play";
    if (on) tick();
  });

  let raf = 0;
  function tick() {
    cancelAnimationFrame(raf);
    const loop = () => {
      if (studio.activeTool === "autotune") {
        timeOut.textContent = `${fmtTime(player.position)} / ${fmtTime(player.duration)}`;
        graph.draw();
      }
      // the note under the playhead, for the mic's little display
      const r = st.result;
      if (r) {
        const f = Math.floor(player.position / r.hopSec);
        live.note = r.note[f] >= 0 ? `${NOTE_NAMES[((r.note[f] % 12) + 12) % 12]}${Math.floor(r.note[f] / 12) - 1}` : null;
      }
      if (player.playing) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }

  function viewRange() {
    const d = st.item && st.item.buffer ? st.item.buffer.duration : 0;
    if (st.zoom === "all" || d <= 10) return [0, Math.max(d, 0.001)];
    const c = player.position;
    const t0 = clamp(c - 4, 0, Math.max(0, d - 8));
    return [t0, t0 + 8];
  }

  function drawGraph(g, w, h) {
    g.fillStyle = "#08080c";
    g.fillRect(0, 0, w, h);
    const r = st.result;
    g.font = "10px 'IBM Plex Mono', monospace";
    if (!r) {
      g.fillStyle = "rgba(236,228,212,0.45)";
      g.fillText(st.item ? "tracking the pitch…" : "the pitch graph appears here", 12, 20);
      return;
    }
    const [t0, t1] = viewRange();
    // pitch range from the take
    // range from the 2nd–98th percentile of the corrected pitch (ignores stray frames)
    const vals = Array.from(r.outMidi).filter(Number.isFinite).sort((a, b) => a - b);
    let lo = vals.length ? vals[Math.floor(vals.length * 0.02)] : 55;
    let hi = vals.length ? vals[Math.floor(vals.length * 0.98)] : 72;
    lo = Math.floor(lo) - 2; hi = Math.ceil(hi) + 2;
    if (hi - lo < 12) { const c = (hi + lo) / 2; lo = Math.floor(c - 6); hi = Math.ceil(c + 6); }
    const left = 34;
    const X = (t) => left + ((t - t0) / (t1 - t0)) * (w - left - 6);
    const Y = (m) => h - 14 - ((m - lo) / (hi - lo)) * (h - 24);
    const s = settings();
    const inScale = new Set(SCALES[s.scale].steps.map((x) => (x + s.root) % 12));
    for (let m = lo; m <= hi; m++) {
      const pc = ((m % 12) + 12) % 12;
      const y = Y(m);
      g.fillStyle = inScale.has(pc) ? "rgba(255,179,92,0.07)" : "rgba(255,255,255,0.015)";
      g.fillRect(left, y - (h - 24) / (hi - lo) / 2, w - left, (h - 24) / (hi - lo));
      g.fillStyle = inScale.has(pc) ? "rgba(255,200,140,0.75)" : "rgba(160,150,170,0.35)";
      if ((hi - lo) <= 30 || pc === 0) g.fillText(`${NOTE_NAMES[pc]}${Math.floor(m / 12) - 1}`, 4, y + 3);
    }
    const curve = (arr, color, width) => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      let pen = false;
      const f0 = Math.max(0, Math.floor(t0 / r.hopSec)), f1 = Math.min(arr.length - 1, Math.ceil(t1 / r.hopSec));
      for (let f = f0; f <= f1; f++) {
        const v = arr[f];
        if (!Number.isFinite(v)) { pen = false; continue; }
        const x = X(f * r.hopSec), y = Y(v);
        if (pen) g.lineTo(x, y); else { g.moveTo(x, y); pen = true; }
      }
      g.stroke();
    };
    curve(r.inMidi, st.ab === "original" ? "rgba(140,190,255,0.95)" : "rgba(140,190,255,0.55)", 1.6);
    curve(r.outMidi, st.ab === "tuned" ? "#ffb35c" : "rgba(255,179,92,0.45)", 2.2);
    if (player.duration) {
      const x = X(player.position);
      g.fillStyle = "#ece4d4";
      g.fillRect(x, 0, 1.5, h);
    }
    g.fillStyle = "rgba(140,190,255,0.9)";
    g.fillText("— sung", w - 130, 14);
    g.fillStyle = "#ffb35c";
    g.fillText("— tuned", w - 70, 14);
  }

  function baseName() {
    return (st.item ? st.item.name : "vocal").replace(/\.[a-z0-9]+$/i, "").replace(/[^\w.-]+/g, "_");
  }

  function download() {
    if (!st.tuned) return;
    const chans = [];
    for (let c = 0; c < st.tuned.numberOfChannels; c++) chans.push(st.tuned.getChannelData(c));
    downloadBlob(encodeMaster(chans, st.sr, 24), `${baseName()}_autotune_${st.level}.wav`);
  }

  function saveTape() {
    if (!st.tuned) return null;
    const it = lib.addAudio({ name: `Autotune · ${st.item.name} · ${LEVELS[st.level].label}`, buffer: st.tuned, source: "VOX-1" });
    studio.toast(`Saved “${it.name}” to the tape library`);
    return it;
  }

  function sendToMaster() {
    const it = saveTape();
    if (!it) return;
    player.pause();
    studio.pendingMaster = it.id;
    studio.openTool("master");
  }

  paintLevels();
  setBusy(null);
  statusText.textContent = "Waiting for a vocal";
  // start on the demo singer so there's something to hear straight away
  const first = deck.get();
  if (first) setTimeout(() => loadTake(first), 0);
  return {
    open() { graph.resize(); graph.draw(); },
    close() {}
  };
}
