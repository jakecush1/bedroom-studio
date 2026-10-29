// CHIPIFY — any song → a four-channel chiptune.
// The analysis (beat, notes, melody, bass, chords, drums) runs in a worker;
// the arrangement re-renders instantly when you change the chip or the
// arrangement settings. Builds on the ChipWorld chipify goal, the Melody
// extractor (HPSS → pitch → quantise) and demucs_extract.py.
import "./chipify.css";
import { el, button, seg, field, screen, tapeDeck, module, progress, clamp } from "../../ui/kit.js";
import { SyncPlayer } from "../../core/audio.js";
import { downloadBlob } from "../../core/wav.js";
import { writeMidi } from "../../core/midi.js";
import { CHIPS } from "../../dsp/chipsynth.js";
import { ARPS } from "../../dsp/chipify/arrange.js";
import { encodeMaster } from "../master/export.js";

const MODEL_URL = `${import.meta.env.BASE_URL}assets/models/basic-pitch/model.json`;
const CHIP_BLURBS = {
  nes: "2A03: two pulse waves, a 4-bit triangle bass, LFSR noise drums.",
  gameboy: "DMG: pulse leads, a soft 4-bit wave-RAM bass, metallic noise.",
  sega: "SN76489 PSG: square waves all round, 16-step volume.",
  sid: "C64 SID: sawtooth lead, PWM harmony, filtered and fat."
};
const LANES = [
  { ch: 0, name: "PULSE 1", sub: "melody", color: "#ff6fb5" },
  { ch: 1, name: "PULSE 2", sub: "harmony", color: "#6ff0ff" },
  { ch: 2, name: "TRIANGLE", sub: "bass", color: "#ffd36f" },
  { ch: 3, name: "PULSE 3", sub: "echo", color: "#a98aff" },
  { ch: 9, name: "NOISE", sub: "drums", color: "#8aff9c" }
];
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function create(studio, host) {
  const audio = studio.audio, lib = studio.library;
  const st = {
    item: null, id: 0, seq: 0, analysis: null, notes: null, chipBuf: null,
    chip: "nes", arp: "32", lead: "pulse50", echo: false, drums: true, harmony: true, leadOct: 0, bassOct: 0,
    listen: "chip", zoom: "near", busy: null,
    quality: (() => { try { return localStorage.getItem("room808.chipify.quality") || "fast"; } catch (e) { return "fast"; } })()
  };
  const hasGpu = typeof navigator !== "undefined" && !!navigator.gpu;
  if (!hasGpu) st.quality = "fast";
  const live = { title: "", playing: false, tracks: ["PULSE 1 · melody", "PULSE 2 · harmony", "TRIANGLE · bass", "NOISE · drums", "ORIGINAL"], levels: [0, 0, 0, 0, 0], lanes: null, progress: 0 };
  studio.state.chipify = live;
  const worker = new Worker(new URL("./chipify.worker.js", import.meta.url), { type: "module" });
  const player = new SyncPlayer(audio, "chipify");
  player.loop = true;

  const root = el("div", "kit chipify");
  host.appendChild(root);

  /* ---------- song ---------- */
  const songMod = module("Song", "any recording: drop a file, record, or pick a tape");
  const deck = tapeDeck(studio, { kinds: ["audio"], label: "Song", onPick: (it) => loadSong(it), preferBuiltin: (i) => i.source === "demo" });
  const info = el("p", "k-note cf-info", "Pick a song and it gets chipified: beat, melody, bass, chords and drums, re-played on a sound chip.");
  const qualitySeg = seg([["fast", "Fast"], ["hq", "HQ stems (Demucs)"]], st.quality, (v) => {
    st.quality = v;
    try { localStorage.setItem("room808.chipify.quality", v); } catch (e) { /* private mode */ }
    if (st.item) loadSong(st.item);
  }, { label: "Separation quality" });
  const qualityNote = el("p", "k-note cf-qnote", hasGpu
    ? "HQ splits vocals, bass, drums and other with Meta's HTDemucs (the model in demucs_extract.py) on your GPU. The model is 172 MB and downloads once."
    : "HQ stems need WebGPU (Chrome, Edge or Safari 18+). Fast mode works everywhere.");
  const qRow = el("div", "k-row end cf-qrow");
  qRow.append(field("Separation", qualitySeg), qualityNote);
  if (!hasGpu) qualitySeg.classList.add("dim");
  songMod.append(deck, qRow, info);
  deck.dropTarget(songMod);
  root.appendChild(songMod);

  const statusRow = el("div", "cf-status");
  const statusText = el("span", null, "Waiting for a song");
  const bar = progress();
  statusRow.append(statusText, bar);
  root.appendChild(statusRow);

  /* ---------- chips ---------- */
  const chips = el("div", "cf-chips");
  const chipCards = {};
  for (const id of ["nes", "gameboy", "sega", "sid"]) {
    const c = el("button", `cf-chip cf-${id}`);
    c.type = "button";
    c.innerHTML = "<b></b><span></span>";
    c.querySelector("b").textContent = CHIPS[id].label;
    c.querySelector("span").textContent = CHIP_BLURBS[id];
    c.addEventListener("click", () => { st.chip = id; paintChips(); rerender(); });
    chipCards[id] = c;
    chips.appendChild(c);
  }
  root.appendChild(chips);

  /* ---------- arrangement ---------- */
  const arr = el("div", "k-row end cf-arr");
  const arpSeg = seg(Object.entries(ARPS).map(([k, v]) => [k, v.replace(" arpeggio", "").replace(" (60 Hz)", "")]), st.arp, (v) => { st.arp = v; rerender(); }, { label: "Harmony style" });
  const leadSeg = seg([["pulse50", "50%"], ["pulse25", "25%"], ["pulse12", "12.5%"]], st.lead, (v) => { st.lead = v; rerender(); }, { label: "Lead duty" });
  const leadOct = seg([[-1, "−1"], [0, "0"], [1, "+1"]], 0, (v) => { st.leadOct = v; rerender(); }, { label: "Melody octave" });
  const bassOct = seg([[-1, "−1"], [0, "0"], [1, "+1"]], 0, (v) => { st.bassOct = v; rerender(); }, { label: "Bass octave" });
  const harmBtn = button("Harmony", (on) => { st.harmony = on; rerender(); }, { toggle: true, on: true });
  const drumBtn = button("Drums", (on) => { st.drums = on; rerender(); }, { toggle: true, on: true });
  const echoBtn = button("Echo", (on) => { st.echo = on; rerender(); }, { toggle: true, on: false, title: "A quieter copy of the melody an eighth later, the classic NES delay trick" });
  arr.append(field("Harmony", arpSeg), field("Lead duty", leadSeg), field("Melody oct", leadOct), field("Bass oct", bassOct), harmBtn, drumBtn, echoBtn);
  root.appendChild(arr);

  /* ---------- transport ---------- */
  const tr = el("div", "k-row cf-transport");
  const playBtn = button("▶ Play", () => togglePlay(), { cls: "primary big" });
  const timeOut = el("span", "cf-time", "0:00 / 0:00");
  const listenSeg = seg([["original", "Original"], ["chip", "Chip"], ["both", "Both"]], st.listen, (v) => { st.listen = v; applyListen(); }, { label: "Listen" });
  const zoomSeg = seg([["near", "8 bars"], ["all", "Whole song"]], st.zoom, (v) => { st.zoom = v; lanes.draw(); }, { label: "View" });
  const loopBtn = button("Loop", (on) => { player.loop = on; if (player.playing) player.play(player.position); }, { toggle: true, on: true });
  tr.append(playBtn, timeOut, field("Listen", listenSeg), field("View", zoomSeg), loopBtn);
  root.appendChild(tr);

  const lanes = screen(330, drawLanes, { cls: "cf-lanes" });
  lanes.canvas.title = "Click to jump";
  lanes.canvas.addEventListener("click", (e) => {
    if (!player.duration) return;
    const r = lanes.canvas.getBoundingClientRect();
    const [t0, t1] = viewRange();
    const x = e.clientX - r.left - 92;
    if (x < 0) return;
    player.seek(t0 + (x / (r.width - 92)) * (t1 - t0));
    if (!player.playing) togglePlay();
  });
  root.appendChild(lanes.canvas);
  const summary = el("p", "k-note cf-summary", "");
  root.appendChild(summary);

  /* ---------- export ---------- */
  const out = el("div", "k-row cf-out");
  const dlWav = button("Download WAV", () => downloadWav(), { cls: "primary" });
  const dlMidi = button("Download MIDI (NES 4-track)", () => downloadMidi(), { title: "p1 / p2 / tr / no tracks, the NES-MDB layout" });
  const toTape = button("Save to tape library", () => saveTape());
  out.append(dlWav, dlMidi, toTape);
  root.appendChild(out);

  /* ---------- logic ---------- */
  function options() {
    return { chip: st.chip, arp: st.arp, lead: st.lead, echo: st.echo, drums: st.drums, harmony: st.harmony, leadOct: st.leadOct, bassOct: st.bassOct, sampleRate: audio.ctx ? audio.ctx.sampleRate : 48000 };
  }

  function setBusy(text, p = 0) {
    st.busy = text;
    statusRow.classList.toggle("busy", !!text);
    if (text) statusText.textContent = text;
    bar.set(text ? p : 1);
    for (const b of [dlWav, dlMidi, toTape]) b.disabled = !!text || !st.notes;
  }

  function paintChips() {
    for (const [id, c] of Object.entries(chipCards)) c.classList.toggle("on", st.chip === id);
    leadSeg.classList.toggle("dim", !(st.chip === "nes" || st.chip === "gameboy"));
  }

  async function loadSong(item) {
    if (!item) return;
    st.item = item;
    st.analysis = null;
    st.notes = null;
    st.chipBuf = null;
    st.id++;
    const id = st.id;
    live.title = item.name;
    setBusy("Loading the song…", 0.01);
    try {
      await audio.start();
      await lib.load(item);
      if (id !== st.id) return;
      const buf = item.buffer;
      player.setTracks([{ buffer: buf, level: st.listen === "chip" ? 0 : 1 }]);
      info.textContent = `${item.name} · ${fmtTime(buf.duration)} · listening…`;
      timeOut.textContent = `0:00 / ${fmtTime(buf.duration)}`;
      const mono22 = await audio.toMono(buf, 22050);
      const copy = mono22.slice();
      if (st.quality === "hq") {
        const [L, R] = await stereo44(buf);
        if (id !== st.id) return;
        worker.postMessage({ type: "analyze", id, hq: true, mono22: copy, stereo44: [L, R], modelUrl: MODEL_URL }, [copy.buffer, L.buffer, R.buffer]);
      } else {
        worker.postMessage({ type: "analyze", id, mono22: copy, modelUrl: MODEL_URL }, [copy.buffer]);
      }
      lanes.draw();
    } catch (err) {
      setBusy(null);
      statusText.textContent = `Couldn't load: ${err.message}`;
    }
  }

  /** The song as 44.1 kHz stereo (HTDemucs's rate). */
  async function stereo44(buf) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const off = new OAC(2, Math.max(1, Math.ceil(buf.duration * 44100)), 44100);
    const src = off.createBufferSource();
    src.buffer = buf;
    src.connect(off.destination);
    src.start();
    const r = await off.startRendering();
    return [r.getChannelData(0).slice(), r.getChannelData(1).slice()];
  }

  let timer = 0;
  function rerender() {
    paintChips();
    if (!st.analysis) return;
    clearTimeout(timer);
    const seq = ++st.seq;
    setBusy("Arranging for the chip…", 0.9);
    timer = setTimeout(() => worker.postMessage({ type: "render", id: st.id, seq, options: options() }), st.notes ? 120 : 0);
  }

  worker.onmessage = (e) => {
    const m = e.data;
    if (m.id !== st.id) return;
    if (m.type === "progress") setBusy(`${m.stage}…`, Math.min(0.88, m.p * 0.88));
    else if (m.type === "stems") statusText.textContent = `Stems separated in ${(m.ms / 1000).toFixed(1)} s · transcribing…`;
    else if (m.type === "analysis") {
      st.analysis = m.analysis;
      const a = m.analysis;
      const kinds = {};
      for (const h of a.drums) kinds[h.kind] = (kinds[h.kind] || 0) + 1;
      info.textContent = `${st.item.name} · ${fmtTime(a.duration)} · ${Math.round(a.tempo)} bpm · ${a.key.name}`;
      summary.textContent = `${a.hq ? "HQ stems (Demucs). " : ""}Heard ${a.melody.length} melody notes, ${a.bass.length} bass notes, ${a.chords.length} chord changes and ${a.drums.length} drum hits (${a.drumMode === "pattern" ? "drum pattern estimated per bar" : "drums transcribed hit by hit"}). Transcription ran on ${a.backend === "webgl" ? "the GPU" : "the CPU"} in ${((a.timings.basicPitch || 0) / 1000).toFixed(1)} s.`;
      rerender();
    } else if (m.type === "rendered") {
      if (m.seq !== st.seq) return;
      st.notes = m.notes;
      st.chipBuf = audio.bufferFrom([m.audio, m.audio], m.sampleRate);
      player.setTracks([
        { buffer: st.item.buffer, level: listenLevels()[0] },
        { buffer: st.chipBuf, level: listenLevels()[1] }
      ]);
      setBusy(null);
      statusText.textContent = `Chipified · ${CHIPS[st.chip].label} · ${m.notes.length} notes · arranged in ${Math.round(m.ms)} ms`;
      lanes.draw();
      updateLive();
    } else if (m.type === "error") {
      setBusy(null);
      statusText.textContent = `Chipify failed: ${m.message}`;
      console.error(m.stack);
    }
  };

  function listenLevels() {
    return st.listen === "original" ? [1, 0] : st.listen === "chip" ? [0, 1] : [0.55, 0.8];
  }

  function applyListen() {
    const [a, b] = listenLevels();
    if (player.tracks.length > 1) { player.setLevel(0, a); player.setLevel(1, b); }
    else if (player.tracks.length) player.setLevel(0, 1);
  }

  async function togglePlay() {
    if (!st.item || !st.item.buffer) return studio.toast("Pick a song first");
    await audio.start();
    player.toggle();
  }

  player.on("state", (on) => {
    live.playing = on;
    playBtn.textContent = on ? "❚❚ Pause" : "▶ Play";
    if (on) tick();
  });

  let raf = 0, liveT = 0;
  function tick() {
    cancelAnimationFrame(raf);
    const loop = () => {
      if (studio.activeTool === "chipify") {
        timeOut.textContent = `${fmtTime(player.position)} / ${fmtTime(player.duration)}`;
        lanes.draw();
      }
      const now = performance.now();
      if (now - liveT > 120) { liveT = now; updateLive(); }
      if (player.playing) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }

  /** The desk monitor's DAW view: an 8-bar window of the arrangement. */
  function updateLive() {
    const a = st.analysis;
    if (!a || !st.notes) { live.lanes = null; return; }
    const pos = player.position;
    const beat = 60 / (a.tempo || 120);
    const span = 32 * beat;
    const t0 = Math.max(0, pos - span * 0.25);
    const laneOf = { 0: 0, 1: 1, 2: 2, 9: 3 };
    const lanesOut = [[], [], [], [], []];
    const levels = [0, 0, 0, 0, 0];
    for (const n of st.notes) {
      const li = laneOf[n.ch];
      if (li == null || n.start + n.dur < t0 || n.start > t0 + span) continue;
      const y = n.ch === 9 ? n.pitch / 16 : clamp((n.pitch - 30) / 66, 0, 1);
      lanesOut[li].push([(n.start - t0) / span, (n.start + n.dur - t0) / span, y]);
      if (n.start <= pos && pos < n.start + n.dur) levels[li] = 0.9;
    }
    for (const b of a.beats) if (b >= t0 && b <= t0 + span) lanesOut[4].push([(b - t0) / span, (b - t0) / span + 0.01, 0.5]);
    live.lanes = lanesOut;
    live.levels = levels.map((v, i) => Math.max(v, (live.levels[i] || 0) * 0.7));
    live.progress = (pos - t0) / span;
  }

  function viewRange() {
    const d = st.item && st.item.buffer ? st.item.buffer.duration : 1;
    if (st.zoom === "all" || !st.analysis) return [0, d];
    const span = 32 * (60 / (st.analysis.tempo || 120));
    const t0 = clamp(player.position - span * 0.25, 0, Math.max(0, d - span));
    return [t0, Math.min(d, t0 + span)];
  }

  function drawLanes(g, w, h) {
    g.fillStyle = "#0b0b10";
    g.fillRect(0, 0, w, h);
    const a = st.analysis;
    const left = 92, top = 22;
    const shown = LANES.filter((l) => l.ch !== 3 || st.echo);
    const laneH = (h - top - 4) / shown.length;
    g.font = "10px 'IBM Plex Mono', monospace";
    shown.forEach((l, i) => {
      const y = top + i * laneH;
      g.fillStyle = i % 2 ? "#101017" : "#13131b";
      g.fillRect(0, y, w, laneH - 1);
      g.fillStyle = l.color;
      g.fillRect(0, y, 3, laneH - 1);
      g.fillStyle = "#d8dae8";
      g.fillText(l.name, 10, y + 16);
      g.fillStyle = "#6f7186";
      g.fillText(l.sub, 10, y + 30);
    });
    if (!a || !st.notes) {
      g.fillStyle = "rgba(236,228,212,0.45)";
      g.fillText(st.item ? "listening to the song…" : "the arrangement appears here", left + 10, top + 30);
      return;
    }
    const [t0, t1] = viewRange();
    const X = (t) => left + ((t - t0) / (t1 - t0)) * (w - left - 4);
    // beats and bars
    a.beats.forEach((b, i) => {
      if (b < t0 || b > t1) return;
      g.fillStyle = i % 4 === 0 ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.035)";
      g.fillRect(X(b), top, 1, h - top);
    });
    // chord labels
    g.fillStyle = "rgba(255,200,140,0.85)";
    let lastX = -1e9;
    for (const c of a.chords) {
      if (c.end < t0 || c.start > t1) continue;
      const x = Math.max(left, X(c.start));
      if (x - lastX < 34) continue;
      g.fillText(c.name, x + 3, 14);
      lastX = x;
    }
    // notes per lane, pitch mapped inside the lane
    shown.forEach((l, i) => {
      const y = top + i * laneH;
      const ns = st.notes.filter((n) => n.ch === l.ch && n.start + n.dur >= t0 && n.start <= t1);
      if (!ns.length) return;
      let lo = Infinity, hi = -Infinity;
      for (const n of ns) { lo = Math.min(lo, n.pitch); hi = Math.max(hi, n.pitch); }
      if (hi - lo < 6) { lo -= 3; hi += 3; }
      g.fillStyle = l.color;
      for (const n of ns) {
        const x0 = X(n.start), x1 = Math.max(x0 + 1.5, X(n.start + n.dur));
        const yy = y + 6 + (1 - (n.pitch - lo) / (hi - lo || 1)) * (laneH - 16);
        g.globalAlpha = 0.45 + 0.55 * (n.vel ?? 0.8);
        g.fillRect(x0, yy, x1 - x0, l.ch === 9 ? 5 : 4);
      }
      g.globalAlpha = 1;
    });
    if (player.duration) {
      const x = X(player.position);
      if (x >= left) { g.fillStyle = "#ece4d4"; g.fillRect(x, 0, 1.5, h); }
    }
  }

  /* ---------- exports ---------- */
  const baseName = () => (st.item ? st.item.name : "song").replace(/\.[a-z0-9]+$/i, "").replace(/[^\w.-]+/g, "_");

  function downloadWav() {
    if (!st.chipBuf) return;
    downloadBlob(encodeMaster([st.chipBuf.getChannelData(0)], st.chipBuf.sampleRate, 24), `${baseName()}_chipified_${st.chip}.wav`);
  }

  /** NES-MDB style tracks: p1 / p2 / tr / no (+ p3 echo). */
  function nesSong() {
    const names = { 0: "p1", 1: "p2", 2: "tr", 3: "p3", 9: "no" };
    const programs = { 0: 80, 1: 81, 2: 38, 3: 80, 9: 0 };
    const chans = [...new Set(st.notes.map((n) => n.ch))].sort((a, b) => a - b);
    return {
      bpm: st.analysis.tempo,
      tracks: chans.map((ch) => ({ name: names[ch] || `ch${ch}`, channel: ch, program: programs[ch], notes: st.notes.filter((n) => n.ch === ch) }))
    };
  }

  function downloadMidi() {
    if (!st.notes) return;
    const bytes = writeMidi(nesSong());
    downloadBlob(new Blob([bytes], { type: "audio/midi" }), `${baseName()}_chipified.mid`);
  }

  function saveTape() {
    if (!st.chipBuf) return;
    const it = lib.addAudio({ name: `Chipify · ${st.item.name} · ${CHIPS[st.chip].label}`, buffer: st.chipBuf, source: "CHIPIFY" });
    studio.toast(`Saved “${it.name}” to the tape library`);
  }

  paintChips();
  setBusy(null);
  statusText.textContent = "Waiting for a song";
  const first = deck.get();
  if (first) setTimeout(() => loadSong(first), 0);

  return {
    open() { lanes.resize(); lanes.draw(); },
    close() { player.pause(); }   // walking back into the room stops the song
  };
}
