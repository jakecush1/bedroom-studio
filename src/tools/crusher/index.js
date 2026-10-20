// 8-BIT CRUSHER — bitcrusher.py as a pedal.
//  Room mode: the AudioWorklet insert on the studio master (everything you hear).
//  Tape mode: crush a tape offline, A/B it, export 8-bit (save_8bit_wav) or 16-bit.
import "./crusher.css";
import { el, button, seg, knob, screen, tapeDeck, module, field } from "../../ui/kit.js";
import { crushInPlace } from "../../dsp/chipsynth.js";
import { SyncPlayer } from "../../core/audio.js";
import { encodeWav, downloadBlob } from "../../core/wav.js";

const linkedFactor = (bits) => Math.max(1, Math.floor(Math.pow(2, Math.max(0, (16 - bits) / 4))));

export function create(studio, host) {
  const st = { bits: 8, factor: 4, mix: 1, link: true, room: false, item: null, crushed: null, ab: "crushed" };
  const live = { room: false, active: false };
  studio.state.crusher = live;
  const player = new SyncPlayer(studio.audio, "crusher");
  player.loop = true;

  const root = el("div", "kit crusher");
  host.appendChild(root);

  /* ---------- pedal face ---------- */
  const face = el("div", "pedal");
  const knobs = el("div", "pedal-knobs");
  const kBits = knob({ label: "Bits", min: 1, max: 16, value: st.bits, step: 0.1, format: (v) => `${v.toFixed(1)}`, onChange: (v) => { st.bits = v; apply(); } });
  const kRate = knob({ label: "Rate ÷", min: 1, max: 64, value: st.factor, step: 1, format: (v) => `÷${Math.round(v)}`, onChange: (v) => { st.factor = Math.round(v); apply(); } });
  const kMix = knob({ label: "Mix", min: 0, max: 1, value: st.mix, step: 0.01, format: (v) => `${Math.round(v * 100)}%`, onChange: (v) => { st.mix = v; apply(); } });
  knobs.append(kBits, kRate, kMix);
  const linkBtn = button("Link rate to bits", (on) => { st.link = on; apply(); }, { toggle: true, on: true, title: "Original coupling: reduction_factor = 2 ** ((16 − bits) / 4)" });
  const readout = el("div", "pedal-read");
  const brand = el("div", "pedal-brand");
  brand.innerHTML = "<b>8-BIT</b><span>CRUSHER</span>";
  const led = el("span", "k-led");
  const stomp = el("button", "stomp");
  stomp.type = "button";
  stomp.setAttribute("aria-pressed", "false");
  stomp.innerHTML = "<span>CRUSH THE ROOM</span>";
  stomp.addEventListener("click", async () => {
    await studio.audio.start();
    st.room = !st.room;
    stomp.setAttribute("aria-pressed", String(st.room));
    apply();
    studio.toast(st.room ? "Everything in the room now runs through the crusher" : "Room crusher off");
  });
  const ledRow = el("div", "pedal-led");
  ledRow.append(led, linkBtn);
  face.append(brand, knobs, readout, ledRow, stomp);

  const scope = screen(170, drawScope, { cls: "crusher-scope" });
  const top = el("div", "crusher-top");
  top.append(face, scope.canvas);
  root.appendChild(top);

  /* ---------- tape mode ---------- */
  const tapeMod = module("Crush a tape", "bitcrusher_effect() offline");
  const deck = tapeDeck(studio, { kinds: ["audio"], label: "Tape", onPick: (it) => { st.item = it; st.crushed = null; renderTape(); }, preferBuiltin: (i) => i.source === "demo" });
  tapeMod.appendChild(deck);
  const tapeRow = el("div", "k-row");
  const playBtn = button("▶ Play", async () => { await ensureTape(); player.toggle(); }, { cls: "primary" });
  const abSeg = seg([["original", "Original"], ["crushed", "Crushed"]], st.ab, (v) => { st.ab = v; setAB(); }, { label: "A/B" });
  tapeRow.append(playBtn, field("Listen", abSeg), el("div", "grow"),
    button("Export 8-bit WAV", () => exportWav(8), { title: "save_8bit_wav(): unsigned 8-bit PCM" }),
    button("Export 16-bit", () => exportWav(16)),
    button("To tape", () => toTape()));
  tapeMod.appendChild(tapeRow);
  tapeMod.appendChild(el("p", "k-note", "The Python version downsampled by slicing (y[::factor]) and repeating — the same sample-and-hold runs here, so the 8-bit export matches crushed_song.wav from the original script."));
  root.appendChild(tapeMod);
  deck.dropTarget(root);
  st.item = deck.get();

  player.on("state", (on) => {
    playBtn.textContent = on ? "❚❚ Pause" : "▶ Play";
    live.active = on || st.room;
    if (on) tick();
  });

  function effFactor() {
    return st.link ? linkedFactor(st.bits) : st.factor;
  }

  function apply() {
    const f = effFactor();
    kRate.setValue(f);
    kRate.classList.toggle("dim", st.link);
    const sr = studio.audio.ctx ? studio.audio.ctx.sampleRate : 44100;
    readout.innerHTML = `<b>${st.bits.toFixed(1)}</b> bits · ${Math.round(Math.pow(2, st.bits))} levels · ÷${f} → ${(sr / f / 1000).toFixed(1)} kHz`;
    live.room = st.room;
    live.active = st.room || player.playing;
    led.classList.toggle("on", st.room);
    studio.audio.setCrusher({ enabled: st.room, bits: st.bits, factor: f, mix: st.mix, link: false });
    clearTimeout(apply.t);
    apply.t = setTimeout(() => { if (st.item && st.item.buffer) renderTape(); }, 260);
    scope.draw();
  }

  async function ensureTape() {
    await studio.audio.start();
    if (!st.crushed) await renderTape();
  }

  async function renderTape() {
    if (!st.item) return;
    try {
      await studio.library.load(st.item);
      const src = st.item.buffer;
      const chans = [];
      for (let c = 0; c < src.numberOfChannels; c++) {
        const y = src.getChannelData(c).slice();
        crushInPlace(y, st.bits, effFactor());
        if (st.mix < 1) {
          const dry = src.getChannelData(c);
          for (let i = 0; i < y.length; i++) y[i] = dry[i] * (1 - st.mix) + y[i] * st.mix;
        }
        chans.push(y);
      }
      st.crushed = studio.audio.bufferFrom(chans, src.sampleRate);
      const pos = player.position, was = player.playing;
      player.setTracks([{ buffer: src, level: st.ab === "original" ? 1 : 0 }, { buffer: st.crushed, level: st.ab === "crushed" ? 1 : 0 }]);
      if (was) player.play(pos);
      scope.draw();
    } catch (err) {
      studio.toast(err.message, { error: true });
    }
  }

  function setAB() {
    player.setLevel(0, st.ab === "original" ? 1 : 0);
    player.setLevel(1, st.ab === "crushed" ? 1 : 0);
  }

  let raf = 0;
  function tick() {
    cancelAnimationFrame(raf);
    const loop = () => {
      if (studio.activeTool === "crusher") scope.draw();
      if (player.playing || st.room) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }

  const liveBuf = new Float32Array(2048);
  function drawScope(g, w, h) {
    g.fillStyle = "#0b0906";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(255,170,90,0.08)";
    for (let x = 0; x < w; x += 24) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y < h; y += 24) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    let orig = null, crushed = null, label = "";
    if (player.playing && st.crushed && st.item && st.item.buffer) {
      // a 12 ms window under the playhead: the staircase is visible
      const sr = st.item.buffer.sampleRate;
      const at = Math.floor(player.position * sr);
      const n = Math.floor(0.012 * sr);
      orig = st.item.buffer.getChannelData(0).subarray(at, at + n);
      crushed = st.crushed.getChannelData(0).subarray(at, at + n);
      label = "tape · 12 ms window";
    } else if (st.room && studio.audio.analyser) {
      studio.audio.analyser.getFloatTimeDomainData(liveBuf);
      crushed = liveBuf.subarray(0, 600);
      label = "room output";
    } else {
      // preview: a sine through the current settings
      const n = 400;
      orig = new Float32Array(n);
      for (let i = 0; i < n; i++) orig[i] = 0.9 * Math.sin((i / n) * Math.PI * 4);
      crushed = crushInPlace(orig.slice(), st.bits, Math.max(1, Math.round(effFactor() * 4)));
      label = "preview";
    }
    const plot = (data, color, width) => {
      if (!data || !data.length) return;
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = (i / (data.length - 1)) * w, y = h / 2 - data[i] * h * 0.42;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    };
    plot(orig, "rgba(160,190,255,0.55)", 1.5);
    g.shadowColor = "#ff8a3a";
    g.shadowBlur = 8;
    plot(crushed, "#ff8a3a", 2);
    g.shadowBlur = 0;
    g.fillStyle = "rgba(255,200,150,0.6)";
    g.font = "11px 'IBM Plex Mono', monospace";
    g.fillText(label, 10, 16);
    if (orig) { g.fillStyle = "rgba(160,190,255,0.8)"; g.fillText("— original", w - 170, 16); }
    g.fillStyle = "#ff8a3a";
    g.fillText("— crushed", w - 84, 16);
  }

  function exportWav(bits) {
    if (!st.crushed) return studio.toast("Pick a tape first");
    const chans = [];
    for (let c = 0; c < st.crushed.numberOfChannels; c++) chans.push(st.crushed.getChannelData(c));
    const name = (st.item ? st.item.name : "tape").replace(/[^\w.-]+/g, "_");
    downloadBlob(encodeWav(chans, st.crushed.sampleRate, bits), `${name}_crushed_${bits}bit.wav`);
  }

  function toTape() {
    if (!st.crushed) return studio.toast("Pick a tape first");
    const it = studio.library.addAudio({ name: `Crushed · ${st.item.name} · ${st.bits.toFixed(0)}-bit`, buffer: st.crushed, source: "8-BIT CRUSHER" });
    studio.toast(`Saved “${it.name}” to the tape library`);
  }

  apply();
  return {
    open() { scope.resize(); scope.draw(); tick(); },
    close() {}
  };
}
