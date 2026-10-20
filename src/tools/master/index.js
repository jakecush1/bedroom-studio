// MASTER-1 — automatic mastering in the browser, in the spirit of LANDR.
//
//  1. A worker analyses the mix: loudness, tonal balance, per-band dynamics,
//     stereo image, sibilance, resonances.
//  2. The assistant turns that into a mastering chain for the chosen style
//     (Warm / Balanced / Open, or a reference track) and intensity.
//  3. You hear it immediately: the same chain runs in an AudioWorklet, with a
//     loudness-matched A/B against the original.
//  4. The worker renders the full master in the background (exact loudness,
//     verified true peak) for the meters and the download.
import "./master.css";
import { el, button, seg, field, knob, screen, tapeDeck, module, progress, clamp } from "../../ui/kit.js";
import { SyncPlayer } from "../../core/audio.js";
import { downloadBlob } from "../../core/wav.js";
import { STYLES, INTENSITIES, suggest } from "../../dsp/master/assistant.js";
import { eqResponse, BAND_NAMES } from "../../dsp/master/chain.js";
import { normalizeCurve } from "../../dsp/master/spectrum.js";
import { encodeMaster } from "./export.js";
import workletUrl from "./master.worklet.js?worker&url";

const FINE = { low: 0, mid: 0, presence: 0, high: 0, width: 1, warmth: null, comp: 1, deess: null, lufs: null, ceiling: -1 };
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const signed = (v, d = 1) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(d)}`;

/** Load the worklet module once per AudioContext. */
function workletReady(audio) {
  if (!audio._masterWorklet) audio._masterWorklet = audio.ctx.audioWorklet.addModule(workletUrl);
  return audio._masterWorklet;
}

export function create(studio, host) {
  const audio = studio.audio, lib = studio.library;
  const st = {
    item: null, ref: null, analysis: null, refAnalysis: null,
    style: "balanced", intensity: "medium",
    fine: { ...FINE },
    suggestion: null, render: null, renderTarget: null,
    seq: 0, trackSeq: 0, busy: null, progress: 0,
    ab: "master", match: true, envIn: null, meter: null, lastMeter: 0
  };
  const live = { playing: false, vuL: -60, vuR: -60, lufs: null, busy: false, style: "Balanced", ab: "master", target: -11 };
  studio.state.master = live;

  const worker = new Worker(new URL("./master.worker.js", import.meta.url), { type: "module" });
  let node = null, monitor = null;
  const player = new SyncPlayer(audio, "master");
  player.loop = true;

  const root = el("div", "kit master");
  host.appendChild(root);

  /* ================= inputs ================= */
  const inputs = el("div", "m-inputs");
  const trackMod = module("Your mix", "drop a file, record, or pick a tape");
  const deck = tapeDeck(studio, { kinds: ["audio"], label: "Track", onPick: (it) => loadTrack(it), preferBuiltin: (i) => i.source === "demo" });
  const trackInfo = el("p", "k-note m-info", "Mastering starts as soon as a track loads.");
  trackMod.append(deck, trackInfo);
  deck.dropTarget(trackMod);

  const refMod = module("Reference", "optional · match a song you love");
  const refSel = el("select", "k-select");
  const refPick = el("input");
  refPick.type = "file";
  refPick.accept = "audio/*";
  refPick.hidden = true;
  const refRow = el("div", "k-tape");
  refRow.append(field("Reference track", refSel), button("Load file…", () => refPick.click()), refPick);
  const refInfo = el("p", "k-note m-info", "Its tone, width and loudness become the target (like Matchering / LANDR reference mastering).");
  refMod.append(refRow, refInfo);
  inputs.append(trackMod, refMod);
  root.appendChild(inputs);

  function fillRefs() {
    const prev = refSel.value;
    refSel.innerHTML = "";
    const none = el("option", null, "None — use the style");
    none.value = "";
    refSel.appendChild(none);
    for (const it of lib.list("audio")) {
      if (st.item && it.id === st.item.id) continue;
      const o = el("option", null, `◉ ${it.name}`);
      o.value = it.id;
      refSel.appendChild(o);
    }
    refSel.value = prev && lib.get(prev) ? prev : "";
  }
  lib.on("change", (e) => { if (e.type === "add" || e.type === "remove") fillRefs(); });
  refSel.addEventListener("change", () => loadReference(refSel.value ? lib.get(refSel.value) : null));
  refPick.addEventListener("change", async () => {
    const file = refPick.files[0];
    refPick.value = "";
    if (!file) return;
    try {
      await audio.start();
      const it = await lib.importFile(file);
      fillRefs();
      refSel.value = it.id;
      loadReference(it);
    } catch (err) {
      studio.toast(`Couldn't read ${file.name}: ${err.message}`, { error: true });
    }
  });
  refMod.addEventListener("dragover", (e) => { e.preventDefault(); refMod.classList.add("over"); });
  refMod.addEventListener("dragleave", () => refMod.classList.remove("over"));
  refMod.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    refMod.classList.remove("over");
    const file = e.dataTransfer.files[0];
    if (!file) return;
    try {
      await audio.start();
      const it = await lib.importFile(file);
      fillRefs();
      refSel.value = it.id;
      loadReference(it);
    } catch (err) {
      studio.toast(`Couldn't read ${file.name}: ${err.message}`, { error: true });
    }
  });

  /* ================= style + intensity ================= */
  const styles = el("div", "m-styles");
  const cards = {};
  const styleDefs = [
    ["warm", STYLES.warm.label, STYLES.warm.blurb],
    ["balanced", STYLES.balanced.label, STYLES.balanced.blurb],
    ["open", STYLES.open.label, STYLES.open.blurb],
    ["reference", "Reference", "Match the reference track's tone, width and loudness."]
  ];
  for (const [k, title, blurb] of styleDefs) {
    const c = el("button", `m-card m-card-${k}`);
    c.type = "button";
    c.innerHTML = `<b></b><span></span>`;
    c.querySelector("b").textContent = title;
    c.querySelector("span").textContent = blurb;
    c.addEventListener("click", () => {
      if (k === "reference" && !st.refAnalysis) return studio.toast("Load a reference track first");
      st.style = k;
      paintCards();
      remaster();
    });
    cards[k] = c;
    styles.appendChild(c);
  }
  root.appendChild(styles);

  const controls = el("div", "k-row end m-controls");
  const intensitySeg = seg([["low", "Low · −14"], ["medium", "Medium · −11"], ["high", "High · −8.5"]], st.intensity, (v) => {
    st.intensity = v;
    st.fine.lufs = null;
    remaster();
  }, { label: "Intensity" });
  controls.appendChild(field("Intensity (loudness)", intensitySeg));
  const status = el("div", "m-status");
  const statusText = el("span", null, "Waiting for a track");
  const bar = progress();
  status.append(statusText, bar);
  controls.append(el("div", "grow"), status);
  root.appendChild(controls);

  /* ================= transport + waveform ================= */
  const transport = el("div", "k-row m-transport");
  const playBtn = button("▶ Play", () => togglePlay(), { cls: "primary big" });
  const timeOut = el("span", "m-time", "0:00 / 0:00");
  const abSeg = seg([["original", "Original"], ["master", "Master"]], st.ab, (v) => setAB(v), { label: "A/B" });
  const matchBtn = button("Match loudness", (on) => { st.match = on; applyDryGain(); }, { toggle: true, on: true, title: "Play the original at the master's loudness, so you compare tone and dynamics, not volume" });
  const loopBtn = button("Loop", (on) => { player.loop = on; if (player.playing) player.play(player.position); }, { toggle: true, on: true });
  transport.append(playBtn, timeOut, field("Listen", abSeg), matchBtn, loopBtn);
  root.appendChild(transport);

  const wave = screen(118, drawWave, { cls: "m-wave" });
  wave.canvas.title = "Click to jump";
  wave.canvas.addEventListener("click", (e) => {
    const r = wave.canvas.getBoundingClientRect();
    if (!player.duration) return;
    player.seek(((e.clientX - r.left) / r.width) * player.duration);
    if (!player.playing) togglePlay();
  });
  root.appendChild(wave.canvas);

  /* ================= tone + loudness ================= */
  const grid = el("div", "m-grid");
  const toneMod = module("Tone", "long-term spectrum · target · EQ");
  const spec = screen(230, drawSpectrum, { cls: "m-spec" });
  toneMod.appendChild(spec.canvas);
  const loudMod = module("Loudness", "BS.1770 / EBU R128");
  const big = el("div", "m-big");
  big.innerHTML = `<div><b class="m-st">—</b><span>LUFS short-term</span></div><div><b class="m-gr">0.0</b><span>dB limiting</span></div>`;
  const table = el("table", "k-table m-table");
  table.innerHTML = `<thead><tr><th></th><th>Original</th><th>Master</th></tr></thead><tbody>
    <tr><td>Integrated</td><td data-k="iIn">—</td><td data-k="iOut">—</td></tr>
    <tr><td>True peak</td><td data-k="tpIn">—</td><td data-k="tpOut">—</td></tr>
    <tr><td>Loudness range</td><td data-k="lraIn">—</td><td data-k="lraOut">—</td></tr>
    <tr><td>Peak-to-loudness</td><td data-k="plrIn">—</td><td data-k="plrOut">—</td></tr></tbody>`;
  const meters = screen(96, drawMeters, { cls: "m-meters" });
  const loudNote = el("p", "k-note m-loudnote", "");
  loudMod.append(big, table, meters.canvas, loudNote);
  grid.append(toneMod, loudMod);
  root.appendChild(grid);

  /* ================= fine tune ================= */
  const fineMod = module("Fine tune", "the assistant's choices, adjustable");
  const knobs = el("div", "m-knobs");
  const mk = (key, label, min, max, step, format, value) => {
    const k = knob({ label, min, max, value, step, format, onChange: (v) => { st.fine[key] = v; remaster(); } });
    k.dataset.key = key;
    knobs.appendChild(k);
    return k;
  };
  const kLow = mk("low", "Low", -6, 6, 0.1, (v) => `${signed(v)} dB`, 0);
  const kMid = mk("mid", "Mid", -6, 6, 0.1, (v) => `${signed(v)} dB`, 0);
  const kPres = mk("presence", "Presence", -6, 6, 0.1, (v) => `${signed(v)} dB`, 0);
  const kHigh = mk("high", "High", -6, 6, 0.1, (v) => `${signed(v)} dB`, 0);
  const kWidth = mk("width", "Stereo", 0.5, 1.5, 0.01, (v) => (v < 0.97 ? `focus ${Math.round(v * 100)}%` : v > 1.03 ? `wide ${Math.round(v * 100)}%` : "100%"), 1);
  const kWarm = mk("warmth", "Warmth", 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`, 0.22);
  const kComp = mk("comp", "Compress", 0, 2, 0.01, (v) => `${Math.round(v * 100)}%`, 1);
  const kDeess = mk("deess", "De-ess", 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`, 0);
  const kLufs = mk("lufs", "Loudness", -18, -6, 0.1, (v) => `${v.toFixed(1)} LUFS`, -11);
  const kCeil = mk("ceiling", "Ceiling", -2, -0.1, 0.1, (v) => `${v.toFixed(1)} dBTP`, -1);
  const resetBtn = button("Reset to assistant", () => {
    st.fine = { ...FINE };
    for (const [k, v] of [[kLow, 0], [kMid, 0], [kPres, 0], [kHigh, 0], [kWidth, 1], [kComp, 1], [kCeil, -1]]) k.setValue(v);
    remaster();
  });
  fineMod.append(knobs, el("div", "k-row", null));
  fineMod.lastChild.append(resetBtn, el("p", "k-note", "Warmth, de-ess and loudness follow the assistant until you move them."));
  root.appendChild(fineMod);

  /* ================= notes + export ================= */
  const bottom = el("div", "m-bottom");
  const notesMod = module("Engineer's notes", "what was done to your mix");
  const notes = el("ul", "m-notes");
  notesMod.appendChild(notes);
  const outMod = module("Download", "rendered at full resolution");
  const exportRow = el("div", "m-export");
  const dl24 = button("WAV · 24-bit", () => exportWav(24), { cls: "primary", title: "Best for distribution and further work" });
  const dl16 = button("WAV · 16-bit", () => exportWav(16), { title: "CD format, TPDF dithered" });
  const toTape = button("Save to tape library", () => saveToTape(), { title: "Use the master in the other machines" });
  exportRow.append(dl24, dl16, toTape);
  const outInfo = el("p", "k-note", "The download is the offline render: exact loudness, true peak verified with a 64-tap interpolator.");
  outMod.append(exportRow, outInfo);
  bottom.append(notesMod, outMod);
  root.appendChild(bottom);

  /* ================= audio graph ================= */
  async function ensureNode() {
    await audio.start();
    if (node) return node;
    await workletReady(audio);
    node = new AudioWorkletNode(audio.ctx, "room808-master", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers" });
    // straight to the speakers: the room's own bus limiter must not touch the master
    monitor = audio.ctx.createGain();
    node.connect(monitor);
    monitor.connect(audio.ctx.destination);
    if (audio.analyser) monitor.connect(audio.analyser);
    node.port.onmessage = (e) => onMeter(e.data);
    if (st.suggestion) sendParams();
    return node;
  }

  function sendParams() {
    if (!node || !st.suggestion) return;
    node.port.postMessage({ type: "params", params: st.suggestion.params });
    node.port.postMessage({ type: "drive", driveDb: currentDrive(), ceilingDb: st.suggestion.params.ceilingDb });
    node.port.postMessage({ type: "ab", value: st.ab === "master" });
    applyDryGain();
  }

  /**
   * Drive for the live preview until the render reports the exact one: the
   * last render's drive shifted by any change of target, or a first guess
   * (the chain works at −18 LUFS; compression costs about 1.5 dB).
   */
  function currentDrive() {
    const s = st.suggestion;
    if (!s) return 0;
    if (st.render && st.renderTarget != null) return st.render.driveDb + (s.targetLufs - st.renderTarget);
    return s.targetLufs + 18 + 1.5;
  }

  function applyDryGain() {
    if (!node) return;
    let g = 1;
    if (st.match && st.analysis && Number.isFinite(st.analysis.loud.integrated)) {
      const out = st.render ? st.render.metrics.integrated : st.suggestion ? st.suggestion.targetLufs : st.analysis.loud.integrated;
      g = Math.pow(10, (out - st.analysis.loud.integrated) / 20);
    }
    node.port.postMessage({ type: "dryGain", value: clamp(g, 0.01, 40) });
  }

  function setAB(v) {
    st.ab = v;
    live.ab = v;
    abSeg.set(v);
    if (node) node.port.postMessage({ type: "ab", value: v === "master" });
    wave.draw();
  }

  async function togglePlay() {
    if (!st.item || !st.item.buffer) return studio.toast("Pick a track first");
    await ensureNode();
    player.toggle();
  }

  player.on("state", (on) => {
    live.playing = on;
    playBtn.textContent = on ? "❚❚ Pause" : "▶ Play";
    // let the rain fall quietly while you listen critically
    if (studio.ambience && studio.ambience.enabled) audio.setAmbience(on ? 0.1 : 0.55);
    if (on) tick();
  });

  /* ================= track + reference ================= */
  function channels(buf) {
    const L = buf.getChannelData(0).slice();
    const R = buf.numberOfChannels > 1 ? buf.getChannelData(1).slice() : L.slice();
    return [L, R];
  }

  async function loadTrack(item) {
    if (!item) return;
    st.item = item;
    st.analysis = null;
    st.render = null;
    st.suggestion = null;
    st.envIn = null;
    st.trackSeq++;
    fillRefs();
    setBusy("Listening to the mix…", 0.02);
    try {
      await ensureNode();
      await lib.load(item);
      const buf = item.buffer;
      player.setTracks([{ buffer: buf, output: node, name: item.name }]);
      node.port.postMessage({ type: "reset" });
      const [L, R] = channels(buf);
      st.envIn = envelope(L, R, 1200);
      st.sr = buf.sampleRate;
      worker.postMessage({ type: "track", id: st.trackSeq, L, R, sr: buf.sampleRate }, [L.buffer, R.buffer]);
      trackInfo.textContent = `${item.name} · ${fmtTime(buf.duration)} · analysing…`;
      timeOut.textContent = `0:00 / ${fmtTime(buf.duration)}`;
      wave.draw();
    } catch (err) {
      setBusy(null);
      studio.toast(err.message, { error: true });
    }
  }

  async function loadReference(item) {
    st.ref = item;
    st.refAnalysis = null;
    if (!item) {
      refInfo.textContent = "Its tone, width and loudness become the target (like Matchering / LANDR reference mastering).";
      if (st.style === "reference") st.style = "balanced";
      paintCards();
      remaster();
      return;
    }
    refInfo.textContent = `Analysing ${item.name}…`;
    try {
      await audio.start();
      await lib.load(item);
      const [L, R] = channels(item.buffer);
      worker.postMessage({ type: "reference", id: item.id, L, R, sr: item.buffer.sampleRate }, [L.buffer, R.buffer]);
    } catch (err) {
      refInfo.textContent = `Couldn't load the reference: ${err.message}`;
    }
  }

  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === "progress") {
      if (m.phase === "analyze") setBusy("Listening to the mix…", m.p * 0.3);
      else if (m.seq === st.seq) setBusy("Mastering — full-resolution render…", 0.3 + m.p * 0.7);
    } else if (m.type === "analysis") {
      if (m.id !== st.trackSeq) return;
      st.analysis = m.analysis;
      const a = m.analysis;
      trackInfo.textContent = `${st.item.name} · ${fmtTime(a.duration)} · ${fmt(a.loud.integrated)} LUFS · ${fmt(a.loud.truePeakDb)} dBTP · LRA ${fmt(a.loud.lra)} LU`;
      paintReadouts();
      if (!Number.isFinite(a.loud.integrated) || a.loud.integrated < -60) {
        setBusy(null);
        statusText.textContent = "This tape is (almost) silent";
        return;
      }
      remaster();
    } else if (m.type === "refAnalysis") {
      if (!st.ref || m.id !== st.ref.id) return;
      st.refAnalysis = m.analysis;
      const a = m.analysis;
      refInfo.textContent = `${st.ref.name} · ${fmt(a.loud.integrated)} LUFS · PLR ${fmt(a.plr)} dB · width ${Math.round(100 * (1 - a.corr) / 2)}% side`;
      st.style = "reference";
      paintCards();
      remaster();
    } else if (m.type === "rendered") {
      if (m.seq !== st.seq) return;
      st.render = m;
      st.renderTarget = st.suggestion.targetLufs;
      if (node) node.port.postMessage({ type: "drive", driveDb: m.driveDb, ceilingDb: m.ceilingUsed });
      applyDryGain();
      live.lufs = m.metrics.integrated;
      setBusy(null);
      statusText.textContent = `Ready · ${fmt(m.metrics.integrated)} LUFS · ${fmt(m.metrics.truePeakDb)} dBTP · rendered in ${(m.ms / 1000).toFixed(1)} s`;
      paintReadouts();
      renderNotes();
      spec.draw();
      wave.draw();
    } else if (m.type === "error") {
      setBusy(null);
      statusText.textContent = `Render failed: ${m.message}`;
      studio.toast(`Mastering failed: ${m.message}`, { error: true });
    }
  };

  /* ================= mastering ================= */
  let renderTimer = 0;
  function remaster() {
    paintCards();
    if (!st.analysis) return;
    const useRef = st.style === "reference" && st.refAnalysis;
    st.suggestion = suggest(st.analysis, {
      style: useRef ? "balanced" : st.style === "reference" ? "balanced" : st.style,
      intensity: st.intensity,
      reference: useRef ? st.refAnalysis : null,
      fine: st.fine
    });
    const s = st.suggestion;
    live.style = useRef ? "Reference" : STYLES[st.style] ? STYLES[st.style].label : "Balanced";
    live.target = s.targetLufs;
    // auto values show on their knobs until the user takes them over
    if (st.fine.warmth == null) kWarm.setValue(s.params.sat.amount);
    if (st.fine.deess == null) kDeess.setValue(s.auto.deess);
    if (st.fine.lufs == null) kLufs.setValue(s.targetLufs);
    sendParams();
    renderNotes();
    spec.draw();
    clearTimeout(renderTimer);
    st.seq++;
    const seq = st.seq;
    setBusy("Mastering…", 0.3);
    renderTimer = setTimeout(() => {
      if (seq !== st.seq) return;
      worker.postMessage({ type: "render", seq, params: s.params, targetLufs: s.targetLufs, budget: s.budget });
    }, st.render ? 450 : 30);
  }

  function setBusy(text, p = 0) {
    st.busy = text;
    live.busy = !!text;
    status.classList.toggle("busy", !!text);
    if (text) statusText.textContent = text;
    bar.set(text ? p : 1);
    dl24.disabled = dl16.disabled = toTape.disabled = !!text || !st.render;
  }

  function paintCards() {
    for (const [k, c] of Object.entries(cards)) {
      c.classList.toggle("on", st.style === k);
      if (k === "reference") c.disabled = !st.refAnalysis;
    }
  }

  /* ================= readouts ================= */
  function paintReadouts() {
    const a = st.analysis, r = st.render;
    const set = (k, v) => { const td = table.querySelector(`[data-k="${k}"]`); if (td) td.textContent = v; };
    if (a) {
      set("iIn", `${fmt(a.loud.integrated)} LUFS`);
      set("tpIn", `${fmt(a.loud.truePeakDb)} dBTP`);
      set("lraIn", `${fmt(a.loud.lra)} LU`);
      set("plrIn", `${fmt(a.plr)} dB`);
    }
    if (r) {
      const m = r.metrics;
      set("iOut", `${fmt(m.integrated)} LUFS`);
      set("tpOut", `${fmt(m.truePeakDb)} dBTP`);
      set("lraOut", `${fmt(m.lra)} LU`);
      set("plrOut", `${fmt(m.truePeakDb - m.integrated)} dB`);
      loudNote.textContent = r.capped
        ? `Held back at ${fmt(m.integrated)} LUFS: going louder would flatten the transients (typical limiting ${fmt(r.depthGr)} dB).`
        : `Typical limiting ${fmt(r.depthGr)} dB, deepest ${fmt(r.maxGr)} dB.`;
    }
  }

  function renderNotes() {
    notes.innerHTML = "";
    const s = st.suggestion;
    if (!s) return;
    const lines = [...s.notes];
    const r = st.render;
    if (r && r.seq === st.seq) {
      lines.push(`Loudness: limiter drive ${signed(r.driveDb)} dB to ${fmt(r.metrics.integrated)} LUFS integrated, ${fmt(r.metrics.truePeakDb)} dBTP${r.capped ? " (held back to protect the dynamics)" : ""}`);
      if (r.ceilingUsed < (s.params.ceilingDb ?? -1) - 0.01) lines.push(`True-peak check pulled the limiter in to ${fmt(r.ceilingUsed, 2)} dBTP to keep inter-sample peaks under the ceiling`);
    } else {
      lines.push(`Loudness target ${fmt(s.targetLufs)} LUFS, ceiling ${fmt(s.params.ceilingDb)} dBTP — rendering…`);
    }
    for (const t of lines) notes.appendChild(el("li", null, t));
  }

  /* ================= meters ================= */
  function onMeter(m) {
    if (m.type !== "meter") return;
    st.meter = m;
    st.lastMeter = performance.now();
    live.vuL = m.vuL;
    live.vuR = m.vuR;
  }

  let raf = 0;
  function tick() {
    cancelAnimationFrame(raf);
    const loop = () => {
      const visible = studio.activeTool === "master";
      if (visible) {
        timeOut.textContent = `${fmtTime(player.position)} / ${fmtTime(player.duration)}`;
        wave.draw();
        meters.draw();
        const m = st.meter;
        if (m) {
          const shown = st.ab === "master" ? m.wetS : m.dryS;
          big.querySelector(".m-st").textContent = Number.isFinite(shown) && shown > -70 ? shown.toFixed(1) : "—";
          big.querySelector(".m-gr").textContent = (m.gr || 0).toFixed(1);
        }
      }
      if (player.playing) raf = requestAnimationFrame(loop);
      else { live.vuL = live.vuR = -60; meters.draw(); }
    };
    raf = requestAnimationFrame(loop);
  }

  function drawMeters(g, w, h) {
    g.clearRect(0, 0, w, h);
    const m = st.meter;
    const playing = player.playing;
    const rows = [...BAND_NAMES.map((n, i) => [n, m && playing ? m.bands[i] : 0]), ["Glue", m && playing ? m.glue : 0], ["Limiter", m && playing ? m.gr : 0]];
    const colW = w / rows.length;
    g.font = "10px 'IBM Plex Mono', monospace";
    g.textAlign = "center";
    rows.forEach(([name, v], i) => {
      const x = i * colW + colW / 2;
      const top = 6, bot = h - 18;
      g.fillStyle = "rgba(255,255,255,0.06)";
      g.fillRect(x - 7, top, 14, bot - top);
      const frac = clamp((v || 0) / 12, 0, 1);
      g.fillStyle = i === rows.length - 1 ? "#ff6f5b" : i === rows.length - 2 ? "#a98aff" : "#ffb35c";
      g.fillRect(x - 7, top, 14, (bot - top) * frac);
      g.fillStyle = "#8a8494";
      g.fillText(name, x, h - 5);
    });
    // correlation
    const c = m && playing ? m.corr : 1;
    g.textAlign = "left";
    g.fillStyle = "#8a8494";
    g.fillText(`corr ${c >= 0 ? "+" : ""}${c.toFixed(2)}`, 4, 14);
  }

  /* ================= drawing ================= */
  function envelope(L, R, buckets) {
    const n = L.length, pk = new Float32Array(buckets), step = n / buckets;
    for (let b = 0; b < buckets; b++) {
      let p = 0;
      for (let i = Math.floor(b * step), e = Math.min(n, Math.floor((b + 1) * step)); i < e; i++) {
        const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
        if (a > p) p = a;
      }
      pk[b] = p;
    }
    return pk;
  }

  function drawWave(g, w, h) {
    g.fillStyle = "#08080c";
    g.fillRect(0, 0, w, h);
    const mid = h / 2;
    const plot = (pk, color, scale = 1) => {
      if (!pk) return;
      g.fillStyle = color;
      const n = pk.length;
      for (let x = 0; x < w; x++) {
        const v = pk[Math.min(n - 1, Math.floor((x / w) * n))] * scale;
        const a = Math.min(1, v) * (mid - 4);
        g.fillRect(x, mid - a, 1, 2 * a);
      }
    };
    const showMaster = st.render && st.render.envelope;
    plot(st.envIn, st.ab === "original" ? "rgba(160,190,255,0.75)" : "rgba(160,170,190,0.28)");
    if (showMaster) plot(st.render.envelope.peak, st.ab === "master" ? "rgba(255,179,92,0.85)" : "rgba(255,179,92,0.25)");
    // ceiling line
    if (st.suggestion) {
      const c = Math.pow(10, st.suggestion.params.ceilingDb / 20) * (mid - 4);
      g.strokeStyle = "rgba(255,111,91,0.35)";
      g.setLineDash([4, 4]);
      g.beginPath(); g.moveTo(0, mid - c); g.lineTo(w, mid - c); g.moveTo(0, mid + c); g.lineTo(w, mid + c); g.stroke();
      g.setLineDash([]);
    }
    if (player.duration) {
      const x = (player.position / player.duration) * w;
      g.fillStyle = "#ece4d4";
      g.fillRect(x, 0, 1.5, h);
    }
    g.font = "10px 'IBM Plex Mono', monospace";
    g.fillStyle = "rgba(236,228,212,0.55)";
    g.fillText(st.render ? "— master" : st.item ? "rendering master…" : "no track", 8, 14);
  }

  const fx = (f, w) => (Math.log10(f / 20) / Math.log10(20000 / 20)) * w;
  function drawSpectrum(g, w, h) {
    g.fillStyle = "#08080c";
    g.fillRect(0, 0, w, h);
    const top = 10, bot = h - 18;
    const yDb = (d) => top + ((18 - d) / 50) * (bot - top); // +18 … −32 dB
    // grid
    g.strokeStyle = "rgba(255,255,255,0.06)";
    g.fillStyle = "rgba(236,228,212,0.4)";
    g.font = "10px 'IBM Plex Mono', monospace";
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
      const x = fx(f, w);
      g.beginPath(); g.moveTo(x, top); g.lineTo(x, bot); g.stroke();
      g.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x + 2, h - 5);
    }
    for (const d of [10, 0, -10, -20]) { const y = yDb(d); g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    const a = st.analysis, s = st.suggestion;
    if (!a) {
      g.fillText("spectrum appears after analysis", 10, 20);
      return;
    }
    const line = (centers, vals, color, width = 1.5, dash = null, yf = yDb) => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.setLineDash(dash || []);
      g.beginPath();
      centers.forEach((f, i) => {
        if (f < 20 || f > 20000) return;
        const x = fx(f, w), y = yf(vals[i]);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      });
      g.stroke();
      g.setLineDash([]);
    };
    if (s) line(a.centers, s.target, "rgba(236,228,212,0.55)", 1.2, [5, 4]);
    line(a.centers, a.midN, "rgba(160,190,255,0.7)", 1.4);
    if (st.render && st.render.spectrum) {
      const sp = st.render.spectrum;
      line(sp.centers, normalizeCurve(sp.centers, sp.mid), "#ffb35c", 2);
    }
    if (s && st.sr) {
      // EQ curve on its own ±12 dB scale around the middle
      const mid = (top + bot) / 2;
      const eqY = (d) => mid - (d / 12) * ((bot - top) / 2);
      g.strokeStyle = "rgba(138,255,193,0.18)";
      g.beginPath(); g.moveTo(0, mid); g.lineTo(w, mid); g.stroke();
      const pts = [];
      for (let x = 0; x <= w; x += 3) {
        const f = 20 * Math.pow(1000, x / w);
        pts.push([x, eqY(eqResponse(s.params, st.sr, f))]);
      }
      g.strokeStyle = "#8affc1";
      g.lineWidth = 1.6;
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }
    g.lineWidth = 1;
    const legend = [["target", "rgba(236,228,212,0.7)"], ["your mix", "rgba(160,190,255,0.9)"], ["master", "#ffb35c"], ["EQ", "#8affc1"]];
    let lx = w - 8;
    g.textAlign = "right";
    for (const [t, c] of legend.reverse()) {
      g.fillStyle = c;
      g.fillText(t, lx, 20);
      lx -= g.measureText(t).width + 14;
    }
    g.textAlign = "left";
  }

  /* ================= export ================= */
  function baseName() {
    return (st.item ? st.item.name : "track").replace(/\.[a-z0-9]+$/i, "").replace(/[^\w.-]+/g, "_");
  }

  function exportWav(bits) {
    const r = st.render;
    if (!r || st.busy) return studio.toast("Still mastering — one moment");
    const style = (live.style || "master").toLowerCase();
    const blob = encodeMaster([r.L, r.R], st.sr, bits);
    downloadBlob(blob, `${baseName()}_master_${style}_${Math.round(r.metrics.integrated)}LUFS_${bits}bit.wav`);
    studio.toast(`Downloading the ${bits}-bit master`);
  }

  function saveToTape() {
    const r = st.render;
    if (!r || st.busy) return studio.toast("Still mastering — one moment");
    const buffer = audio.bufferFrom([r.L, r.R], st.sr);
    const it = lib.addAudio({ name: `Master · ${st.item.name} · ${live.style} · ${fmt(r.metrics.integrated)} LUFS`, buffer, source: "MASTER-1" });
    studio.toast(`Saved “${it.name}” to the tape library`);
  }

  /* ================= boot ================= */
  paintCards();
  setBusy(null);
  statusText.textContent = "Waiting for a track";
  fillRefs();
  // a tape handed over by another machine (e.g. VOX-1's "Master it")
  function takePending() {
    const id = studio.pendingMaster;
    if (!id || !lib.get(id)) return false;
    studio.pendingMaster = null;
    deck.set(id);
    return true;
  }
  const first = deck.get();
  // start straight away on whatever tape is selected (the demo loop at first)
  setTimeout(() => { if (!takePending() && first) loadTrack(first); }, 0);

  return {
    open() {
      takePending();
      wave.resize(); wave.draw();
      spec.resize(); spec.draw();
      meters.resize(); meters.draw();
      tick();
    },
    close() {}
  };
}
