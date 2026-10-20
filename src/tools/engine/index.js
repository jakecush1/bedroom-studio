// CHIP-4 — the G1 sound engine as a playable machine.
import "./engine.css";
import { el, button, seg, select, field, knob, screen, tapeDeck, module } from "../../ui/kit.js";
import { renderSequence, planChannels, CHIPS, ENVELOPES, WAVES } from "../../dsp/chipsynth.js";
import { SyncPlayer } from "../../core/audio.js";
import { encodeWav, downloadBlob } from "../../core/wav.js";
import { writeMidi, seqToSong, noteName } from "../../core/midi.js";

const COLORS = ["#ff6fb5", "#6ff0ff", "#ffd36f", "#8aff9c", "#a98aff", "#ff9a5a", "#5ad1ff", "#e8e8e8"];
const ROLE_LABEL = { lead: "Pulse 1 · lead", harm: "Pulse 2 · harmony", bass: "Triangle · bass", drums: "Noise · drums", extra: "Extra voice" };

export function create(studio, host) {
  const live = { cart: null, chip: "NES 2A03", playing: false, levels: [0, 0, 0, 0], pads: new Float32Array(16) };
  studio.state.engine = live;
  const player = new SyncPlayer(studio.audio, "engine");
  const st = { item: null, seq: null, chip: "nes", method: "auto", plan: null, beatMode: "none", beats: null, render: null, view: 10 };

  const root = el("div", "kit engine");
  host.appendChild(root);

  /* ---------- top row ---------- */
  const top = el("div", "k-row end");
  const deck = tapeDeck(studio, {
    kinds: ["midi"],
    label: "Cartridge (MIDI)",
    onPick: (item) => loadCart(item),
    preferBuiltin: (i) => i.meta && i.meta.file === "novel_big_multi_chiptune2.mid"
  });
  top.appendChild(deck);
  const chipSeg = seg(Object.entries(CHIPS).map(([k, v]) => [k, v.label]), st.chip, (v) => {
    st.chip = v;
    if (st.seq) st.plan = planChannels(st.seq, v);
    live.chip = CHIPS[v].label;
    buildStrips();
    rerender();
  }, { label: "Chip" });
  top.appendChild(field("Chip", chipSeg));
  const methodSeg = seg([["auto", "Auto"], ["additive", "Additive"], ["raw", "Raw"]], st.method, (v) => { st.method = v; rerender(); }, { label: "Synthesis" });
  methodSeg.title = "Additive = the band-limited harmonic sums from the Python engine · Raw = aliased like real chips";
  top.appendChild(field("Synthesis", methodSeg));
  root.appendChild(top);

  /* ---------- screen + transport ---------- */
  const scr = screen(260, drawRoll, { cls: "engine-roll" });
  root.appendChild(scr.canvas);
  scr.canvas.addEventListener("pointerdown", (e) => {
    if (!st.render) return;
    const r = scr.canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const winStart = viewStart();
    player.seek(Math.max(0, winStart + x * st.view));
  });

  const trans = el("div", "k-row");
  const playBtn = button("▶ Play", () => togglePlay(), { cls: "primary" });
  const stopBtn = button("■", () => { player.stop(); paint(); }, { cls: "icon", title: "Stop" });
  const loopBtn = button("Loop", (on) => { player.loop = on; if (player.playing) player.play(player.position); }, { toggle: true, on: true });
  player.loop = true;
  const time = el("div", "k-readout engine-time");
  const zoom = seg([[5, "5s"], [10, "10s"], [20, "20s"], [0, "All"]], 10, (v) => { st.view = v || (st.render ? st.render.duration : 30); paint(); }, { label: "Window" });
  trans.append(playBtn, stopBtn, loopBtn, time, field("View", zoom), el("div", "grow"));
  const beatsSel = select([["none", "No beat track"], ["clicks", "Beat clicks"], ["drums", "Drum track (sound_engine.py)"]], "none", (v) => { st.beatMode = v; rerender(); });
  const beatsFile = el("input");
  beatsFile.type = "file";
  beatsFile.accept = ".json,application/json";
  beatsFile.hidden = true;
  beatsFile.addEventListener("change", async () => {
    const f = beatsFile.files[0];
    beatsFile.value = "";
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data.beat_times)) throw new Error("no beat_times array");
      st.beats = data.beat_times.map(Number);
      if (st.beatMode === "none") { st.beatMode = "drums"; beatsSel.value = "drums"; }
      studio.toast(`Loaded ${st.beats.length} beats from ${f.name}`);
      rerender();
    } catch (err) {
      studio.toast(`Not a beats.json: ${err.message}`, { error: true });
    }
  });
  const beatsBtn = button("beats.json…", () => beatsFile.click(), { title: "Load beats.json from the BT-1 beat tracker (tempo, beat_times, beat_frames)" });
  trans.append(field("Beats", beatsSel), beatsBtn, beatsFile);
  root.appendChild(trans);

  /* ---------- channel strips ---------- */
  const stripsMod = module("Channels", "one chip voice per MIDI channel");
  const strips = el("div", "engine-strips");
  stripsMod.appendChild(strips);
  root.appendChild(stripsMod);

  /* ---------- summary + export ---------- */
  const bottom = el("div", "k-grid");
  const sumMod = module("Render summary", "build_summary() from group1_render_cli.py");
  const sum = el("table", "k-table engine-sum");
  sumMod.appendChild(sum);
  const outMod = module("Output");
  const outRow = el("div", "k-row");
  outRow.append(
    button("Export WAV", () => exportWav()),
    button("Export MIDI", () => exportMidi()),
    button("To tape", () => toTape(), { title: "Save the render to the tape library (crush it, analyse it, classify it…)" })
  );
  outMod.appendChild(outRow);
  outMod.appendChild(el("p", "k-note", "Carts: the G6 LSTM generations, Bach chorales and their chipified versions — or drop in any .mid."));
  bottom.append(sumMod, outMod);
  root.appendChild(bottom);
  deck.dropTarget(root);

  /* ---------- logic ---------- */
  async function loadCart(item) {
    if (!item) return;
    try {
      await studio.library.load(item);
      st.item = item;
      st.seq = item.seq;
      st.plan = planChannels(st.seq, st.chip);
      live.cart = item.name;
      buildStrips();
      rerender(true);
    } catch (err) {
      studio.toast(err.message, { error: true });
    }
  }

  let timer = null;
  function rerender(now = false) {
    clearTimeout(timer);
    if (!st.seq) return;
    const go = () => {
      const wasPlaying = player.playing;
      const pos = player.position;
      st.render = renderSequence(st.seq, { chip: st.chip, plan: st.plan, method: st.method, beats: st.beats, beatMode: st.beats ? st.beatMode : "none" });
      if (!studio.audio.ctx) { paintSummary(); paint(); return; }
      const buf = studio.audio.bufferFrom([st.render.mix], st.render.sampleRate);
      player.setTracks([{ buffer: buf }]);
      if (wasPlaying) player.play(Math.min(pos, buf.duration - 0.05));
      if (!zoom.value) st.view = st.render.duration;
      paintSummary();
      paint();
    };
    if (now) go();
    else timer = setTimeout(go, 220);
  }

  async function togglePlay() {
    await studio.audio.start();
    if (!st.render || !player.tracks.length) rerender(true);
    player.toggle();
  }
  player.on("state", (on) => {
    playBtn.textContent = on ? "❚❚ Pause" : "▶ Play";
    live.playing = on;
    if (on) loop();
  });

  function buildStrips() {
    strips.innerHTML = "";
    if (!st.plan) return;
    Object.values(st.plan).forEach((v, i) => {
      const s = el("div", "strip");
      s.style.setProperty("--c", COLORS[i % COLORS.length]);
      const head = el("div", "strip-head");
      head.innerHTML = `<i></i><b>${ROLE_LABEL[v.role] || v.role}</b><span>ch ${v.ch}${v.name ? ` · ${v.name.trim()}` : ""} · ${v.count} notes</span>`;
      const waveSel = select(Object.entries(WAVES).map(([k, t]) => [k, t]), v.wave, (w) => { v.wave = w; rerender(); });
      const envSel = select(Object.entries(ENVELOPES).map(([k, e]) => [k, e.label]), v.env, (e) => { v.env = e; rerender(); });
      const oct = seg([[-2, "−2"], [-1, "−1"], [0, "0"], [1, "+1"], [2, "+2"]], v.octave, (o) => { v.octave = o; rerender(); }, { label: "Octave" });
      const lvl = knob({ label: "Level", min: 0, max: 1.2, value: v.level, step: 0.01, format: (x) => `${Math.round(x * 100)}%`, onChange: (x) => { v.level = x; rerender(); } });
      const mute = button("M", (on) => { v.mute = on; rerender(); }, { toggle: true, on: v.mute, cls: "icon", title: "Mute" });
      const solo = button("S", (on) => { v.solo = on; rerender(); }, { toggle: true, on: v.solo, cls: "icon", title: "Solo" });
      const ctl = el("div", "strip-ctl");
      ctl.append(field("Voice", waveSel), field("Envelope", envSel), field("Octave", oct));
      const side = el("div", "strip-side");
      side.append(lvl, el("div", "ms"));
      side.lastChild.append(mute, solo);
      s.append(head, ctl, side);
      strips.appendChild(s);
    });
  }

  function paintSummary() {
    const r = st.render;
    if (!r) { sum.innerHTML = ""; return; }
    const rows = [
      ["input", st.item ? st.item.name : "—"],
      ["sample_rate", r.sampleRate],
      ["ticks_per_beat", st.seq.ticksPerBeat],
      ["tempo_changes", r.summary.tempoChanges],
      ["note_count", r.summary.notes],
      ["voice_count", r.summary.voices],
      ["duration_seconds", r.summary.duration],
      ["peak_before_normalize", r.summary.peakBeforeNormalize]
    ];
    sum.innerHTML = rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("");
  }

  const viewStart = () => {
    if (!st.render) return 0;
    const pos = player.position;
    const span = st.view || st.render.duration;
    if (span >= st.render.duration) return 0;
    return Math.max(0, Math.min(st.render.duration - span, pos - span * 0.25));
  };

  function drawRoll(g, w, h) {
    g.fillStyle = "#0a0b10";
    g.fillRect(0, 0, w, h);
    if (!st.seq) {
      g.fillStyle = "#4a5068";
      g.font = "14px 'IBM Plex Mono', monospace";
      g.fillText("insert a cartridge…", 20, 30);
      return;
    }
    const notes = st.seq.notes;
    const melodic = notes.filter((n) => !st.plan[n.ch] || st.plan[n.ch].role !== "drums");
    let lo = 127, hi = 0;
    for (const n of melodic) { lo = Math.min(lo, n.pitch); hi = Math.max(hi, n.pitch); }
    if (lo > hi) { lo = 48; hi = 84; }
    lo -= 2; hi += 2;
    const drumH = 26;
    const rollH = h - drumH - 18;
    const span = Math.min(st.view || 1e9, st.render ? st.render.duration : 30);
    const t0 = viewStart();
    const x = (t) => ((t - t0) / span) * w;
    // pitch grid
    for (let p = lo; p <= hi; p++) {
      const y = rollH - ((p - lo) / (hi - lo)) * rollH;
      if (p % 12 === 0) {
        g.fillStyle = "rgba(255,255,255,0.06)";
        g.fillRect(0, y, w, 1);
        g.fillStyle = "rgba(255,255,255,0.25)";
        g.font = "10px 'IBM Plex Mono', monospace";
        g.fillText(noteName(p), 4, y - 2);
      }
    }
    // beats
    if (st.beats) {
      g.fillStyle = "rgba(255,179,92,0.12)";
      for (const b of st.beats) if (b >= t0 && b <= t0 + span) g.fillRect(x(b), 0, 1, h - 18);
    }
    const chIndex = Object.keys(st.plan).map(Number);
    for (const n of notes) {
      if (n.start > t0 + span || n.start + n.dur < t0) continue;
      const v = st.plan[n.ch];
      const ci = chIndex.indexOf(n.ch);
      const muted = v && (v.mute || (Object.values(st.plan).some((q) => q.solo) && !v.solo));
      g.fillStyle = COLORS[ci % COLORS.length];
      g.globalAlpha = muted ? 0.18 : 0.9;
      if (v && v.role === "drums") {
        g.fillRect(x(n.start), rollH + 6 + (n.pitch % 3) * 6, Math.max(2, x(n.start + Math.min(n.dur, 0.08)) - x(n.start)), 4);
      } else {
        const y = rollH - ((n.pitch - lo) / (hi - lo)) * rollH;
        g.fillRect(x(n.start), y - 3, Math.max(2, x(n.start + n.dur) - x(n.start) - 1), 5);
      }
    }
    g.globalAlpha = 1;
    // overview strip
    if (st.render) {
      const total = st.render.duration;
      g.fillStyle = "#13141b";
      g.fillRect(0, h - 12, w, 12);
      g.fillStyle = "rgba(255,111,181,0.35)";
      g.fillRect((t0 / total) * w, h - 12, (span / total) * w, 12);
      const pos = player.position;
      g.fillStyle = "#fff";
      g.fillRect((pos / total) * w, h - 12, 2, 12);
      if (pos >= t0 && pos <= t0 + span) g.fillRect(x(pos), 0, 2, h - 14);
    }
    // scanlines
    g.fillStyle = "rgba(0,0,0,0.18)";
    for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
  }

  function paint() {
    scr.draw();
    const pos = player.position, dur = st.render ? st.render.duration : 0;
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
    time.innerHTML = `<b>${fmt(pos)}</b><span>of ${fmt(dur)}</span>`;
  }

  // pads + levels for the 3D machine, and the roll while playing
  let raf = 0;
  function loop() {
    cancelAnimationFrame(raf);
    const tick = () => {
      updateLive();
      if (studio.activeTool === "engine") paint();
      if (player.playing) raf = requestAnimationFrame(tick);
      else { live.pads.fill(0); live.levels = [0, 0, 0, 0]; paint(); }
    };
    raf = requestAnimationFrame(tick);
  }
  function updateLive() {
    if (!st.seq) return;
    const t = player.position;
    live.pads.fill(0);
    const chans = Object.keys(st.plan).map(Number).slice(0, 4);
    const lv = [0, 0, 0, 0];
    for (const n of st.seq.notes) {
      if (n.start > t) break;
      if (t > n.start + n.dur) continue;
      const c = chans.indexOf(n.ch);
      if (c < 0) continue;
      const row = Math.max(0, Math.min(3, Math.floor(((n.pitch % 24) / 24) * 4)));
      live.pads[row * 4 + c] = 1;
      lv[c] = Math.max(lv[c], n.vel == null ? 0.8 : n.vel);
    }
    live.levels = lv;
  }

  function exportWav() {
    if (!st.render) return studio.toast("Insert a cartridge first");
    const name = (st.item ? st.item.name : "chip4").replace(/[^\w.-]+/g, "_");
    downloadBlob(encodeWav([st.render.mix], st.render.sampleRate, 16), `${name}_${st.chip}.wav`);
  }
  function exportMidi() {
    if (!st.seq) return studio.toast("Insert a cartridge first");
    const names = {}, programs = {};
    Object.values(st.plan).forEach((v) => {
      names[v.ch] = { lead: "p1", harm: "p2", bass: "tr", drums: "no" }[v.role] || `ch${v.ch}`;
      programs[v.ch] = { lead: 80, harm: 81, bass: 38, drums: 121 }[v.role];
    });
    const bytes = writeMidi(seqToSong(st.seq, names, programs));
    const name = (st.item ? st.item.name : "chip4").replace(/[^\w.-]+/g, "_");
    downloadBlob(new Blob([bytes], { type: "audio/midi" }), `${name}.mid`);
  }
  async function toTape() {
    if (!st.render) return studio.toast("Insert a cartridge first");
    await studio.audio.start();
    const buf = studio.audio.bufferFrom([st.render.mix], st.render.sampleRate);
    const it = studio.library.addAudio({ name: `CHIP-4 · ${st.item.name} · ${CHIPS[st.chip].label}`, buffer: buf, source: "CHIP-4", meta: { chip: st.chip } });
    studio.toast(`Saved “${it.name}” to the tape library`);
  }

  // open the default cart
  loadCart(deck.get());

  return {
    open() { scr.resize(); paint(); },
    close() {},
    /** used by other machines to audition a sequence through the engine */
    async playSequence(seq, name, chip = "nes") {
      const item = studio.library.addMidi({ name, seq, source: "generated" });
      deck.set(item.id);
      st.chip = chip;
      chipSeg.set(chip);
      await loadCart(item);
      await studio.audio.start();
      player.play(0);
    }
  };
}
