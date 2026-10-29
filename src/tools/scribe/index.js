// SCRIBE — audio → sheet music. Hum, sing, play or drop a song: the pitch
// tracker (pYIN) or Basic Pitch finds the notes, they snap to a beat grid in
// a detected (or chosen) key, abcjs engraves them, and the score leaves as
// MusicXML, MIDI, ABC or a printed PDF. After Melody-extractor's midi.py and
// sheet_music.py.
import "./scribe.css";
import abcjs from "abcjs";
import { el, button, seg, field, select, knob, tapeDeck, module, progress } from "../../ui/kit.js";
import { SyncPlayer } from "../../core/audio.js";
import { downloadBlob } from "../../core/wav.js";
import { writeMidi } from "../../core/midi.js";
import { renderNotes } from "../../core/classical.js";
import { quantize, detectKey, keyInfo, toABC, toMusicXML, toSeconds, NOTE_NAMES } from "../../dsp/scribe.js";

const MODEL_URL = `${import.meta.env.BASE_URL}assets/models/basic-pitch/model.json`;
const METERS = { "4/4": [4, 4], "3/4": [3, 4], "2/4": [2, 4], "6/8": [6, 8] };
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function create(studio, host) {
  const audio = studio.audio, lib = studio.library;
  const st = {
    item: null, id: 0, seq: 0, raw: null, beats: [],
    mode: "melody", division: 4, meter: "4/4", keyChoice: "auto", clef: "auto",
    autoBpm: 100, bpmManual: null, offset: 0, title: "",
    notes: null, key: null, abc: "", visual: null, timings: null, scoreBuf: null,
    listen: "score", busy: null
  };
  const live = { title: "SCRIBE 1.0  —  hum me a tune", preview: null, at: -1, playing: false, busy: false, progress: 0, line: "" };
  studio.state.scribe = live;
  const worker = new Worker(new URL("./scribe.worker.js", import.meta.url), { type: "module" });
  const player = new SyncPlayer(audio, "scribe");
  player.loop = false;

  const root = el("div", "kit scribe");
  host.appendChild(root);

  /* ---------- take ---------- */
  const inMod = module("Take", "hum or sing a tune, play an instrument, or drop a recording");
  const deck = tapeDeck(studio, { kinds: ["audio"], label: "Take", onPick: (it) => loadTake(it), preferBuiltin: (i) => i.source === "demo-vocal" });
  const info = el("p", "k-note sb-info", "Melody mode follows one voice or instrument (pYIN). Polyphonic mode hears chords and several parts (Basic Pitch) — try it on the classical tapes.");
  inMod.append(deck, info);
  deck.dropTarget(inMod);
  root.appendChild(inMod);

  /* ---------- settings ---------- */
  const settings = el("div", "k-row end sb-settings");
  const modeSeg = seg([["melody", "Melody"], ["poly", "Polyphonic"]], st.mode, (v) => { st.mode = v; if (st.item) loadTake(st.item); }, { label: "Mode" });
  const gridSeg = seg([["2", "8ths"], ["4", "16ths"]], String(st.division), (v) => { st.division = +v; engrave(); }, { label: "Grid" });
  const meterSeg = seg(Object.keys(METERS).map((k) => [k, k]), st.meter, (v) => { st.meter = v; engrave(); }, { label: "Meter" });
  const keySel = select([
    ["auto", "Auto-detect"],
    { group: "Major", items: NOTE_NAMES.map((n, i) => [`${i}:major`, `${n} major`]) },
    { group: "Minor", items: NOTE_NAMES.map((n, i) => [`${i}:minor`, `${n} minor`]) }
  ], "auto", (v) => { st.keyChoice = v; engrave(); });
  const clefSeg = seg([["auto", "Auto"], ["treble", "Treble"], ["bass", "Bass"]], st.clef, (v) => { st.clef = v; engrave(); }, { label: "Clef" });
  const autoTempo = button("Auto tempo", (on) => { st.bpmManual = on ? null : bpm(); paintTempo(); engrave(); }, { toggle: true, on: true, title: "Tempo from the take (beat tracker, or the spacing of the notes you sang)" });
  const tempoKnob = knob({ label: "Tempo", min: 40, max: 220, value: 100, step: 1, format: (v) => `${Math.round(v)} bpm`, onChange: (v) => { st.bpmManual = v; autoTempo.set(false); paintTempo(); engrave(); } });
  const titleIn = el("input", "k-input sb-title");
  titleIn.placeholder = "Title";
  titleIn.addEventListener("input", () => { st.title = titleIn.value; engrave({ audio: false }); });
  settings.append(field("Mode", modeSeg), field("Grid", gridSeg), field("Meter", meterSeg), field("Key", keySel), field("Clef", clefSeg), autoTempo, tempoKnob, el("div", "grow"), field("Title", titleIn));
  root.appendChild(settings);

  const statusRow = el("div", "sb-status");
  const statusText = el("span", null, "Waiting for a take");
  const bar = progress();
  statusRow.append(statusText, bar);
  root.appendChild(statusRow);

  /* ---------- the sheet ---------- */
  const paper = el("div", "sb-paper sb-print-target");
  paper.appendChild(el("div", "sb-empty", "the score appears here"));
  root.appendChild(paper);

  /* ---------- transport ---------- */
  const tr = el("div", "k-row sb-transport");
  const playBtn = button("▶ Play", () => togglePlay(), { cls: "primary big" });
  const timeOut = el("span", "sb-time", "0:00 / 0:00");
  const listenSeg = seg([["original", "Take"], ["score", "Score"], ["both", "Both"]], st.listen, (v) => { st.listen = v; applyListen(); }, { label: "Listen" });
  const loopBtn = button("Loop", (on) => { player.loop = on; if (player.playing) player.play(player.position); }, { toggle: true, on: false });
  tr.append(playBtn, timeOut, field("Listen", listenSeg), loopBtn);
  root.appendChild(tr);
  const summary = el("p", "k-note sb-summary", "");
  root.appendChild(summary);

  /* ---------- output ---------- */
  const out = el("div", "k-row sb-out");
  const dlXml = button("Download MusicXML", () => download("musicxml"), { cls: "primary", title: "Opens in MuseScore, Dorico, Sibelius, Finale…" });
  const dlMidi = button("Download MIDI", () => download("midi"));
  const dlAbc = button("Download ABC", () => download("abc"));
  const print = button("Print / save PDF", () => printScore());
  const toTape = button("Score audio → tape library", () => saveTape());
  out.append(dlXml, dlMidi, dlAbc, print, toTape);
  root.appendChild(out);

  /* ---------- logic ---------- */
  const bpm = () => st.bpmManual ?? st.autoBpm;

  function setBusy(text, p = 0) {
    st.busy = text;
    live.busy = !!text;
    live.progress = p;
    statusRow.classList.toggle("busy", !!text);
    if (text) statusText.textContent = text;
    bar.set(text ? p : 1);
    for (const b of [dlXml, dlMidi, dlAbc, print, toTape]) b.disabled = !!text || !st.notes || !st.notes.length;
  }

  function paintTempo() {
    tempoKnob.classList.toggle("dim", st.bpmManual == null);
    if (st.bpmManual == null) tempoKnob.setValue(st.autoBpm);
  }

  async function loadTake(item) {
    if (!item) return;
    st.item = item;
    st.raw = null;
    st.notes = null;
    st.scoreBuf = null;
    st.id++;
    const id = st.id;
    if (!st.title || titleIn.value === "" || titleIn.dataset.auto === "1") {
      st.title = item.name.replace(/\.[a-z0-9]+$/i, "");
      titleIn.value = st.title;
      titleIn.dataset.auto = "1";
    }
    live.title = st.title;
    setBusy("Loading the take…", 0.02);
    paper.innerHTML = "";
    paper.appendChild(el("div", "sb-empty", "listening…"));
    try {
      await audio.start();
      await lib.load(item);
      if (id !== st.id) return;
      const buf = item.buffer;
      player.setTracks([{ buffer: buf, level: st.listen === "score" ? 0 : 1 }]);
      info.textContent = `${item.name} · ${fmtTime(buf.duration)} · ${st.mode === "poly" ? "transcribing every part" : "following the melody"}…`;
      timeOut.textContent = `0:00 / ${fmtTime(buf.duration)}`;
      const mono22 = (await audio.toMono(buf, 22050)).slice();
      if (id !== st.id) return;
      worker.postMessage({ type: "listen", id, mode: st.mode, mono22, modelUrl: MODEL_URL }, [mono22.buffer]);
    } catch (err) {
      setBusy(null);
      statusText.textContent = `Couldn't load: ${err.message}`;
    }
  }

  worker.onmessage = (e) => {
    const m = e.data;
    if (m.id !== st.id) return;
    if (m.type === "progress") setBusy(`${m.stage}…`, Math.min(0.9, m.p * 0.9));
    else if (m.type === "notes") {
      st.raw = m.notes;
      st.autoBpm = Math.round(m.bpm);
      st.offset = m.offset;
      st.beats = m.beats;
      paintTempo();
      if (!m.notes.length) {
        setBusy(null);
        statusText.textContent = "No notes heard in this take — try singing a little louder, or Polyphonic mode";
        paper.innerHTML = "";
        paper.appendChild(el("div", "sb-empty", "nothing to write down yet"));
        return;
      }
      statusText.textContent = `Heard ${m.notes.length} notes in ${(m.ms / 1000).toFixed(1)} s`;
      engrave();
    } else if (m.type === "error") {
      setBusy(null);
      statusText.textContent = `Couldn't transcribe: ${m.message}`;
    }
  };

  /** Quantise, spell, engrave — and re-render the score audio. */
  let engraveTimer = 0;
  function engrave({ audio: withAudio = true } = {}) {
    if (!st.raw) return;
    clearTimeout(engraveTimer);
    engraveTimer = setTimeout(() => doEngrave(withAudio), 60);
  }
  function doEngrave(withAudio) {
    const [beatsPerBar, beatUnit] = METERS[st.meter];
    const notes = quantize(st.raw, { bpm: bpm(), division: st.division, offset: st.offset, mono: st.mode === "melody" });
    st.notes = notes;
    if (st.keyChoice === "auto") st.key = detectKey(notes);
    else { const [r, mode] = st.keyChoice.split(":"); st.key = keyInfo(+r, mode); }
    const o = { title: st.title || "Untitled", bpm: bpm(), division: st.division, beatsPerBar, beatUnit, key: st.key, clef: st.clef };
    st.abc = toABC(notes, o);
    paper.innerHTML = "";
    if (!notes.length) {
      paper.appendChild(el("div", "sb-empty", "nothing survived the grid — try a finer grid or a slower tempo"));
      setBusy(null);
      return;
    }
    try {
      const w = Math.max(320, paper.clientWidth - 44);
      const [visual] = abcjs.renderAbc(paper, st.abc, { add_classes: true, staffwidth: w, scale: w > 900 ? 1.05 : 0.95, paddingtop: 6, paddingbottom: 6, paddingleft: 0, paddingright: 0, foregroundColor: "#1c1710", selectionColor: "#c0302a" });
      st.visual = visual;
      visual.setTiming(bpm(), 0);
      st.timings = (visual.noteTimings || []).filter((t) => t.type === "event");
    } catch (err) {
      st.visual = null;
      st.timings = null;
      paper.appendChild(el("div", "sb-empty", `engraving failed: ${err.message}`));
    }
    paper.appendChild(el("div", "sb-stamp", `SCRIBE · ${st.key.name} · ${Math.round(bpm())} bpm · ${st.meter}`));
    const bars = Math.ceil(notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0) / (st.division * beatsPerBar * (4 / beatUnit)));
    summary.textContent = `${notes.length} notes over ${bars} bar${bars === 1 ? "" : "s"} · ${st.key.name}${st.keyChoice === "auto" ? " (detected)" : ""} · ${Math.round(bpm())} bpm${st.bpmManual == null ? " (from the take)" : ""} · ${st.division === 4 ? "16th" : "8th"}-note grid${st.mode === "poly" ? " · polyphonic" : ""}`;
    // the terminal on the sideboard
    live.title = st.title || "SCRIBE";
    live.line = `${st.key.name} · ${Math.round(bpm())} bpm · ${st.meter}`;
    const tops = [];
    for (const n of notes) { const last = tops[tops.length - 1]; if (last && last.start === n.start) { if (n.pitch > last.pitch) tops[tops.length - 1] = n; } else tops.push(n); }
    live.preview = tops.slice(0, 16).map((n) => n.pitch);
    live.previewTimes = tops.slice(0, 16).map((n) => st.offset + n.start * (60 / bpm() / st.division));
    if (withAudio) renderScoreAudio();
    else setBusy(null);
  }

  async function renderScoreAudio() {
    const seq = ++st.seq;
    setBusy("Playing it back on the piano…", 0.95);
    try {
      const buf = await renderNotes(audio, toSeconds(st.notes, { bpm: bpm(), division: st.division }), { voice: st.mode === "poly" ? "piano" : "pluck", lead: st.offset, tail: 1.5 });
      if (seq !== st.seq) return;
      st.scoreBuf = buf;
      const [a, b] = listenLevels();
      player.setTracks([{ buffer: st.item.buffer, level: a }, { buffer: buf, level: b }]);
      setBusy(null);
      statusText.textContent = `Engraved · ${st.notes.length} notes · ${st.key.name}`;
    } catch (err) {
      setBusy(null);
      statusText.textContent = `Couldn't render the playback: ${err.message}`;
    }
  }

  function listenLevels() {
    return st.listen === "original" ? [1, 0] : st.listen === "score" ? [0, 1] : [0.6, 0.8];
  }
  function applyListen() {
    const [a, b] = listenLevels();
    if (player.tracks.length > 1) { player.setLevel(0, a); player.setLevel(1, b); }
    else if (player.tracks.length) player.setLevel(0, 1);
  }

  async function togglePlay() {
    if (!st.item || !st.item.buffer) return studio.toast("Record or load a take first");
    await audio.start();
    player.toggle();
  }
  player.on("state", (on) => {
    live.playing = on;
    playBtn.textContent = on ? "❚❚ Pause" : "▶ Play";
    if (on) tick(); else clearHot();
  });

  let raf = 0, hot = null;
  function clearHot() {
    if (hot) for (const els of hot.elements) for (const e of els) e.classList.remove("sb-hot");
    hot = null;
  }
  function tick() {
    cancelAnimationFrame(raf);
    const loop = () => {
      const pos = player.position;
      if (studio.activeTool === "scribe") {
        timeOut.textContent = `${fmtTime(pos)} / ${fmtTime(player.duration)}`;
        if (st.timings && st.timings.length) {
          const ms = (pos - st.offset) * 1000;
          let cur = null;
          for (const t of st.timings) { if (t.milliseconds <= ms) cur = t; else break; }
          if (cur !== hot) {
            clearHot();
            if (cur && cur.milliseconds + 2000 > ms) { hot = cur; for (const els of cur.elements) for (const e of els) e.classList.add("sb-hot"); }
          }
        }
      }
      if (live.previewTimes) { let at = -1; live.previewTimes.forEach((t, i) => { if (t <= pos) at = i; }); live.at = at; }
      if (player.playing) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }

  /* ---------- exports ---------- */
  const baseName = () => (st.title || (st.item ? st.item.name : "score")).replace(/\.[a-z0-9]+$/i, "").replace(/[^\w.-]+/g, "_") || "score";

  function download(kind) {
    if (!st.notes || !st.notes.length) return;
    const [beatsPerBar, beatUnit] = METERS[st.meter];
    const o = { title: st.title || "Untitled", bpm: bpm(), division: st.division, beatsPerBar, beatUnit, key: st.key, clef: st.clef, partName: st.mode === "poly" ? "Piano" : "Melody" };
    if (kind === "musicxml") downloadBlob(new Blob([toMusicXML(st.notes, o)], { type: "application/vnd.recordare.musicxml+xml" }), `${baseName()}.musicxml`);
    else if (kind === "abc") downloadBlob(new Blob([st.abc], { type: "text/vnd.abc" }), `${baseName()}.abc`);
    else if (kind === "midi") {
      const bytes = writeMidi({ bpm: bpm(), tracks: [{ name: st.title || "SCRIBE", channel: 0, program: 0, notes: toSeconds(st.notes, { bpm: bpm(), division: st.division }) }] });
      downloadBlob(new Blob([bytes], { type: "audio/midi" }), `${baseName()}.mid`);
    }
  }

  function printScore() {
    const svg = paper.querySelector("svg");
    if (!svg) return;
    const w = window.open("", "_blank");
    if (!w) return studio.toast("The browser blocked the print window — allow pop-ups for this page", { error: true });
    const doc = w.document;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${(st.title || "Score").replace(/</g, "&lt;")}</title><style>body{margin:24px;font-family:Georgia,serif;color:#111}svg{width:100%;height:auto}@page{margin:16mm}</style></head><body>${svg.outerHTML}<p style="font:10px monospace;color:#777">Room 808 · SCRIBE · ${st.key.name} · ${Math.round(bpm())} bpm</p></body></html>`);
    doc.close();
    w.focus();
    setTimeout(() => { w.print(); }, 300);
  }

  function saveTape() {
    if (!st.scoreBuf) return;
    const it = lib.addAudio({ name: `SCRIBE · ${st.title || st.item.name}`, buffer: st.scoreBuf, source: "SCRIBE" });
    studio.toast(`Saved “${it.name}” to the tape library`);
  }

  paintTempo();
  setBusy(null);
  statusText.textContent = "Waiting for a take";
  const first = deck.get();
  if (first) setTimeout(() => loadTake(first), 0);
  new ResizeObserver(() => { if (st.raw && studio.activeTool === "scribe") engrave({ audio: false }); }).observe(paper);

  return {
    open() { if (st.raw) engrave({ audio: false }); },
    close() { player.pause(); }   // walking back into the room stops the take
  };
}
