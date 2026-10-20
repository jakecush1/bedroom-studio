// Room 808 FM: a radio tuned to real stations (see stations.js). A stream
// plays through the room's mixer when it allows it (CORS), otherwise straight
// to the speakers; either way the turntable spins. Keeps playing when the
// panel is closed, like the JC-808's beat.
import "./radio.css";
import { el, button, knob, field, screen, select, clamp, pct } from "../../ui/kit.js";
import { STATIONS, validStation } from "./stations.js";

const STORE = "room808.radio";
const GROUP_ORDER = ["Local", "National", "Starter", "Your stations"];

export function create(studio, host) {
  const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } })();
  const st = {
    volume: clamp(saved.volume == null ? 0.8 : +saved.volume || 0, 0, 1),
    last: typeof saved.last === "string" ? saved.last : null,
    custom: Array.isArray(saved.custom) ? saved.custom.filter(validStation) : []
  };
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify({ volume: st.volume, last: st.last, custom: st.custom })); } catch (e) { /* private mode */ } };

  // what the turntable in the room reads
  const live = { playing: false, station: null, status: "idle", message: "", direct: false };
  studio.state.radio = live;

  const root = el("div", "kit radio");
  host.appendChild(root);

  /* ---------- stations ---------- */
  const all = () => STATIONS.concat(st.custom.map((c) => Object.assign({}, c, { custom: true })));
  live.station = all().find((s) => s.id === st.last) || null;

  /* ---------- audio ---------- */
  let ctx = null, gain = null, analyser = null, spec = null;
  let current = null;   // { el, node, mode: "bus" | "direct", station, failed }

  function ensureGraph() {
    studio.audio.start();
    if (gain) return;
    ctx = studio.audio.ctx;
    gain = ctx.createGain();
    gain.gain.value = st.volume;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.78;
    spec = new Uint8Array(analyser.frequencyBinCount);
    analyser.connect(gain);
    gain.connect(studio.audio.bus("radio"));
  }

  function setStatus(status, message) {
    live.status = status;
    live.message = message || "";
    paintTransport();
    paintStations();
  }

  function teardown() {
    if (!current) return;
    const c = current;
    current = null;
    try { c.el.pause(); } catch (e) { /* never started */ }
    c.el.removeAttribute("src");
    try { c.el.load(); } catch (e) { /* nothing to abort */ }
    if (c.node) { try { c.node.disconnect(); } catch (e) { /* already gone */ } }
    live.playing = false;
    live.direct = false;
  }

  // mode "bus": through the room (needs CORS on the stream). If that fails
  // the station is retried in mode "direct": a plain <audio> to the speakers.
  function tune(station, mode = "bus") {
    teardown();
    ensureGraph();
    live.station = station;
    st.last = station.id;
    save();
    const insecure = location.protocol === "https:" && /^http:/i.test(station.url);
    setStatus("connecting", mode === "direct" ? "the stream doesn't allow mixer access — going straight to the speakers" : "");

    const a = new Audio();
    a.preload = "none";
    if (mode === "bus") a.crossOrigin = "anonymous";
    const c = { el: a, node: null, mode, station, failed: false };
    current = c;

    const fail = (why) => {
      if (current !== c || c.failed) return;
      c.failed = true;
      if (mode === "bus") { tune(station, "direct"); return; }
      teardown();
      live.station = station;   // stays selected so Play retries it
      setStatus("error", insecure
        ? "blocked — an http:// stream can't play on an https:// page; ask the station for an https stream"
        : "stream unavailable" + (why ? " · " + why : ""));
      studio.toast(`${station.name}: stream unavailable`, { error: true });
    };
    a.addEventListener("playing", () => {
      if (current !== c) return;
      live.playing = true;
      live.direct = mode === "direct";
      setStatus("live", mode === "direct" ? "playing straight to the speakers (this stream doesn't allow mixer access)" : "");
    });
    a.addEventListener("waiting", () => { if (current === c && live.playing) setStatus("buffering", live.message); });
    a.addEventListener("stalled", () => { if (current === c && live.playing) setStatus("buffering", live.message); });
    a.addEventListener("error", () => fail(a.error && a.error.message));

    if (mode === "bus") {
      c.node = ctx.createMediaElementSource(a);
      c.node.connect(analyser);
    } else {
      a.volume = st.volume;
    }
    a.src = station.url;
    const p = a.play();
    if (p && p.catch) p.catch((err) => fail(err && err.message));
  }

  function stop() {
    teardown();
    setStatus("idle");
  }

  function toggle() {
    if (current && !current.failed) stop();
    else if (live.station) tune(live.station);
    else if (all().length) tune(all()[0]);
    else studio.toast("No stations on the dial yet — add one below");
  }

  /* ---------- screen ---------- */
  let needle = 0, idlePhase = 0, lastDraw = performance.now(), raf = 0;
  const disp = screen(200, drawScreen, { cls: "radio-screen" });
  root.appendChild(disp.canvas);

  function slotOf(station) {
    const list = all();
    const i = station ? list.findIndex((s) => s.id === station.id) : -1;
    return i < 0 ? 0.5 : (i + 0.5) / Math.max(1, list.length);
  }

  function drawScreen(g, w, h) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastDraw) / 1000);
    lastDraw = now;
    idlePhase += dt;
    needle += (slotOf(live.station) - needle) * Math.min(1, dt * 4);

    const on = live.playing;
    const busy = !!current && !on;
    const col = on ? "#ff6a4a" : busy ? "#ffd166" : "#5a4640";
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#17100e");
    grad.addColorStop(1, "#0b0807");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);

    // ON AIR pill
    g.font = "700 10px 'IBM Plex Mono', monospace";
    g.textAlign = "left";
    g.textBaseline = "middle";
    const pillW = 64;
    g.fillStyle = on ? "rgba(255,106,74,0.18)" : "rgba(255,255,255,0.04)";
    g.strokeStyle = on ? "#ff6a4a" : "rgba(255,255,255,0.12)";
    g.lineWidth = 1;
    roundRect(g, 16, 14, pillW, 20, 10);
    g.fill();
    g.stroke();
    g.fillStyle = on ? "#ff8a6a" : "rgba(236,228,212,0.3)";
    g.shadowColor = "#ff6a4a";
    g.shadowBlur = on ? 10 : 0;
    g.fillText("● ON AIR", 25, 24);
    g.shadowBlur = 0;

    // status
    g.textAlign = "right";
    g.fillStyle = live.status === "error" ? "#ff6b5b" : busy ? "#ffd166" : "rgba(236,228,212,0.45)";
    g.fillText(statusWord(), w - 16, 24);

    // station
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.fillStyle = live.station ? "#ece4d4" : "rgba(236,228,212,0.35)";
    g.font = "700 24px 'Space Grotesk', 'Helvetica Neue', Arial";
    g.fillText(fit(g, live.station ? live.station.name : "Room 808 FM", w - 32), 16, 66);
    g.font = "500 11px 'IBM Plex Mono', monospace";
    g.fillStyle = "rgba(236,228,212,0.55)";
    const sub = live.station ? [live.station.location, live.station.tagline].filter(Boolean).join(" · ") : "pick a station below, or press Play for the last one";
    g.fillText(fit(g, sub, w - 32), 16, 86);
    if (live.message) {
      g.fillStyle = live.status === "error" ? "#ff8a7a" : "rgba(255,209,102,0.8)";
      g.fillText(fit(g, live.message, w - 32), 16, 104);
    }

    // dial: 88 → 108 with a needle at the station's slot
    const dy = h - 62, x0 = 16, x1 = w - 16;
    g.strokeStyle = "rgba(255,255,255,0.14)";
    g.beginPath();
    g.moveTo(x0, dy);
    g.lineTo(x1, dy);
    g.stroke();
    g.font = "9px 'IBM Plex Mono', monospace";
    g.textAlign = "center";
    g.textBaseline = "top";
    for (let f = 88; f <= 108; f += 1) {
      const x = x0 + ((f - 88) / 20) * (x1 - x0);
      const major = f % 4 === 0;
      g.strokeStyle = major ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.16)";
      g.beginPath();
      g.moveTo(x, dy - (major ? 9 : 5));
      g.lineTo(x, dy);
      g.stroke();
      if (major) {
        g.fillStyle = "rgba(236,228,212,0.45)";
        g.fillText(String(f), x, dy + 4);
      }
    }
    const nx = x0 + needle * (x1 - x0);
    g.strokeStyle = col;
    g.shadowColor = col;
    g.shadowBlur = on ? 12 : 0;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(nx, dy - 18);
    g.lineTo(nx, dy + 14);
    g.stroke();
    g.shadowBlur = 0;

    // spectrum (through the mixer) or a gentle idle wave (direct / idle)
    const by = h - 10, bh = 22, bars = 40, bw = (w - 32) / bars;
    if (on && !live.direct && analyser) analyser.getByteFrequencyData(spec);
    for (let i = 0; i < bars; i++) {
      let v;
      if (on && !live.direct && analyser) {
        const lo = Math.floor(Math.pow(i / bars, 1.6) * spec.length * 0.6);
        const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / bars, 1.6) * spec.length * 0.6));
        let s = 0;
        for (let k = lo; k < hi; k++) s += spec[k];
        v = s / (hi - lo) / 255;
      } else if (on) {
        v = 0.25 + 0.2 * Math.sin(idlePhase * 3 + i * 0.5) * Math.sin(idlePhase * 1.3 + i * 0.21);
      } else {
        v = busy ? 0.12 + 0.08 * Math.sin(idlePhase * 8 + i) : 0.06;
      }
      g.fillStyle = on ? `rgba(255,106,74,${0.35 + v * 0.65})` : "rgba(236,228,212,0.14)";
      const hh = Math.max(1, v * bh);
      g.fillRect(16 + i * bw + 1, by - hh, bw - 2, hh);
    }
  }

  function statusWord() {
    switch (live.status) {
      case "live": return live.direct ? "LIVE · DIRECT" : "LIVE";
      case "connecting": return "TUNING…";
      case "buffering": return "BUFFERING…";
      case "error": return "NO SIGNAL";
      default: return live.station ? "STANDBY" : "OFF";
    }
  }

  function fit(g, text, maxW) {
    if (g.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && g.measureText(t + "…").width > maxW) t = t.slice(0, -1);
    return t + "…";
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    if (studio.activeTool !== "radio") { cancelAnimationFrame(raf); raf = 0; return; }
    disp.draw();
  }

  /* ---------- transport ---------- */
  const transport = el("div", "k-row radio-transport");
  const playBtn = button("▶ Play", toggle, { cls: "primary big", title: "Play / stop (Space)" });
  const vol = knob({
    label: "Volume", min: 0, max: 1, value: st.volume, step: 0.01, format: pct,
    onChange: (v) => {
      st.volume = v;
      if (gain) gain.gain.setTargetAtTime(v, ctx.currentTime, 0.03);
      if (current && current.mode === "direct") current.el.volume = v;
      save();
    }
  });
  const siteLink = el("a", "k-btn radio-site", "Station site ↗");
  siteLink.target = "_blank";
  siteLink.rel = "noopener";
  transport.append(playBtn, vol, el("div", "grow"), siteLink);
  root.appendChild(transport);

  function paintTransport() {
    const busy = !!current && !current.failed;
    playBtn.textContent = busy ? "■ Stop" : "▶ Play";
    playBtn.classList.toggle("primary", !busy);
    playBtn.classList.toggle("on", live.playing);
    const site = live.station && live.station.site;
    siteLink.hidden = !site;
    if (site) siteLink.href = site;
  }

  /* ---------- station list ---------- */
  const list = el("div", "radio-stations");
  root.appendChild(list);

  function renderStations() {
    list.innerHTML = "";
    const stations = all();
    const groups = new Map();
    for (const s of stations) {
      const gname = s.group || "Your stations";
      if (!groups.has(gname)) groups.set(gname, []);
      groups.get(gname).push(s);
    }
    const order = GROUP_ORDER.concat([...groups.keys()].filter((k) => !GROUP_ORDER.includes(k)));
    for (const gname of order) {
      const items = groups.get(gname);
      if (!items) continue;
      const sec = el("section", "radio-group");
      sec.appendChild(el("h3", null, gname));
      for (const s of items) {
        const row = el("div", "station");
        row.dataset.id = s.id;
        const b = el("button", "station-btn");
        b.type = "button";
        b.append(el("span", "dot"));
        const txt = el("span", "txt");
        txt.append(el("b", null, s.name), el("small", null, [s.location, s.tagline].filter(Boolean).join(" · ") || s.url.replace(/^https?:\/\//, "")));
        b.appendChild(txt);
        b.title = live.station && live.station.id === s.id && current ? "Stop" : `Tune to ${s.name}`;
        b.addEventListener("click", () => {
          if (live.station && live.station.id === s.id && current && !current.failed) stop();
          else tune(s);
        });
        row.appendChild(b);
        if (s.site) {
          const a = el("a", "station-site", "site ↗");
          a.href = s.site;
          a.target = "_blank";
          a.rel = "noopener";
          a.title = "Open the station's website";
          row.appendChild(a);
        }
        if (s.custom) row.appendChild(button("×", () => removeCustom(s.id), { cls: "icon", title: "Remove this station from the dial" }));
        sec.appendChild(row);
      }
      list.appendChild(sec);
    }
    if (!stations.length) list.appendChild(el("p", "k-note", "Nothing on the dial yet — add a station below, or fill in src/tools/radio/stations.js."));
    paintStations();
  }

  function paintStations() {
    list.querySelectorAll(".station").forEach((row) => {
      const on = !!live.station && row.dataset.id === live.station.id;
      row.classList.toggle("on", on);
      row.classList.toggle("live", on && live.playing);
      row.classList.toggle("busy", on && !!current && !live.playing && !current.failed);
    });
  }

  /* ---------- add your own ---------- */
  const form = el("form", "radio-add");
  const nameIn = el("input");
  nameIn.placeholder = "Station name";
  nameIn.maxLength = 48;
  nameIn.required = true;
  const urlIn = el("input");
  urlIn.type = "url";
  urlIn.placeholder = "https://… stream URL (.mp3 / .aac / icecast mount)";
  urlIn.required = true;
  const groupSel = select([["Local", "Local"], ["National", "National"], ["Your stations", "Other"]], "Local");
  const addBtn = button("Add to the dial", null, { title: "Save this station in this browser and tune to it" });
  addBtn.type = "submit";
  form.append(field("Name", nameIn), field("Stream URL", urlIn), field("Group", groupSel), addBtn);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const s = { id: "c" + Date.now().toString(36), name: nameIn.value.trim(), url: urlIn.value.trim(), group: groupSel.value };
    if (!validStation(s)) return studio.toast("A station needs a name and an http(s) stream URL", { error: true });
    st.custom.push(s);
    save();
    renderStations();
    nameIn.value = "";
    urlIn.value = "";
    tune(Object.assign({}, s, { custom: true }));
  });
  root.appendChild(form);
  root.appendChild(el("p", "k-note", "Streams that allow it play through the room's mixer and meters; the rest play straight to the speakers. The radio keeps playing when you walk back into the room."));

  function removeCustom(id) {
    const s = st.custom.find((c) => c.id === id);
    if (!s) return;
    if (live.station && live.station.id === id) { stop(); live.station = null; st.last = null; }
    st.custom = st.custom.filter((c) => c.id !== id);
    save();
    renderStations();
    paintTransport();
    studio.toast(`Removed ${s.name} from the dial`);
  }

  /* ---------- keys ---------- */
  document.addEventListener("keydown", (e) => {
    if (studio.activeTool !== "radio") return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === "Space") { e.preventDefault(); toggle(); }
  });

  renderStations();
  paintTransport();
  disp.draw();

  return {
    open() { disp.resize(); if (!raf) loop(); },
    close() { /* keeps playing in the room */ }
  };
}
