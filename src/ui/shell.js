// HUD, dock, tooltips, the entry gate, machine panels, tape library, toasts.
import { TOOLS } from "../tools/registry.js";

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

export class Shell {
  constructor(studio, world) {
    this.studio = studio;
    this.world = world;
    this.panels = new Map(); // toolId -> { panel, body, instance }
    this.current = null;
    this.busy = false;
    studio.toast = (msg, opts) => this.toast(msg, opts);
    studio.openTool = (id) => this.open(id);
    studio.closeTool = () => this.close();

    this._clock();
    this._dock();
    this._tooltip();
    this._hud();
    this._drawer();
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.current && !e.defaultPrevented) {
        const t = e.target;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
        this.close();
      }
    });
  }

  /* ---------------- clock ---------------- */
  _clock() {
    const c = $("#clock");
    const tick = () => {
      c.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    };
    tick();
    setInterval(tick, 15000);
  }

  /* ---------------- dock ---------------- */
  _dock() {
    const dock = $("#dock");
    const groups = [
      { zone: "studio", label: "Studio", cls: "" },
      { zone: "chip", label: "ChipWorld", cls: "chip" }
    ];
    this.chips = new Map();
    for (const g of groups) {
      const wrap = el("div", `dock-group ${g.cls}`);
      wrap.appendChild(el("div", "dock-label", g.label));
      const row = el("div", "dock-row");
      const order = ["jc808", "tuner", "master", "autotune", "scribe", "analyzer", "radio", "chipify", "engine"];
      const list = this.world.machines.filter((x) => x.zone === g.zone).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      for (const m of list) {
        const b = el("button", "dock-chip");
        b.type = "button";
        b.innerHTML = `<span class="dot"></span>${shortName(m)}`;
        b.title = `${m.label} — ${m.hint}`;
        b.addEventListener("click", () => this.open(m.id));
        b.addEventListener("mouseenter", () => this.world.highlight(m.id));
        b.addEventListener("mouseleave", () => this.world.highlight(null));
        row.appendChild(b);
        this.chips.set(m.id, b);
      }
      wrap.appendChild(row);
      dock.appendChild(wrap);
    }
  }

  /* ---------------- tooltip ---------------- */
  _tooltip() {
    const tip = $("#tooltip");
    this.world.on("hover", (h) => {
      for (const [id, chip] of this.chips) chip.classList.toggle("hot", !!h && h.machine.id === id);
      if (!h) { tip.classList.remove("show"); return; }
      tip.innerHTML = `<b></b><span></span><em>click to use</em>`;
      tip.querySelector("b").textContent = h.machine.label;
      tip.querySelector("span").textContent = h.machine.hint;
      const x = Math.min(window.innerWidth - 300, h.x || 0), y = Math.min(window.innerHeight - 90, h.y || 0);
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
      tip.classList.add("show");
    });
    this.world.renderer.domElement.addEventListener("pointermove", (e) => {
      if (!tip.classList.contains("show")) return;
      tip.style.left = `${Math.min(window.innerWidth - 300, e.clientX)}px`;
      tip.style.top = `${Math.min(window.innerHeight - 90, e.clientY)}px`;
    });
    this.world.on("select", (m) => this.open(m.id));
  }

  /* ---------------- HUD buttons ---------------- */
  _hud() {
    const rain = $("#btn-rain");
    rain.addEventListener("click", () => {
      const on = rain.getAttribute("aria-pressed") !== "true";
      rain.setAttribute("aria-pressed", String(on));
      this.studio.ambience?.setEnabled(on);
    });
    const lofi = $("#btn-lofi");
    lofi.addEventListener("click", () => {
      const on = lofi.getAttribute("aria-pressed") !== "true";
      lofi.setAttribute("aria-pressed", String(on));
      this.world.post.lofi.uniforms.uAmount.value = on ? 1 : 0;
      this.world.post.bloom.strength = on ? 0.75 : 0.45;
    });
    $("#btn-help").addEventListener("click", () => {
      this.toast("Click any machine to walk up to it · Esc walks you back · drag files onto a machine to load them · everything runs locally in your browser", { ms: 6500 });
    });
  }

  /* ---------------- gate ---------------- */
  gateReady() {
    $("#gate-bar").style.width = "100%";
    const enter = $("#gate-enter"), quiet = $("#gate-quiet");
    enter.disabled = false;
    quiet.disabled = false;
    enter.textContent = "Open the door";
    return new Promise((resolve) => {
      const go = (sound) => {
        enter.disabled = quiet.disabled = true;
        resolve(sound);
      };
      enter.addEventListener("click", () => go(true), { once: true });
      quiet.addEventListener("click", () => go(false), { once: true });
    });
  }

  gateProgress(p) {
    $("#gate-bar").style.width = `${Math.round(p * 100)}%`;
  }

  hideGate() {
    $("#gate").classList.add("gone");
  }

  /* ---------------- panels ---------------- */
  async _panelFor(id) {
    if (this.panels.has(id)) return this.panels.get(id);
    const info = TOOLS[id];
    const panel = el("section", `sp-panel ${info.width || ""} ${info.layout === "side" ? "side" : ""} skin-${id}`);
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", info.title);
    const head = el("header", "sp-head");
    const back = el("button", "sp-back");
    back.type = "button";
    back.innerHTML = "← Room<kbd>Esc</kbd>";
    back.addEventListener("click", () => this.close());
    const title = el("div", "sp-title");
    title.appendChild(el("b", null, info.title));
    title.appendChild(el("span", null, info.subtitle || ""));
    head.append(back, title, el("div", "sp-spacer"));
    if (info.origin) head.appendChild(el("div", "sp-origin", info.origin));
    const body = el("div", "sp-body");
    body.appendChild(el("div", "sp-loading", "warming up…"));
    panel.append(head, body);
    $("#panel-host").appendChild(panel);
    const entry = { panel, body, instance: null, info };
    this.panels.set(id, entry);
    try {
      if (!info.load) throw new Error("not built yet");
      const mod = await info.load();
      body.innerHTML = "";
      entry.instance = await mod.create(this.studio, body, { id, panel });
    } catch (err) {
      if (err.message !== "not built yet") console.error(err);
      body.innerHTML = "";
      const wip = el("div", "wip");
      wip.appendChild(el("h2", null, info.title));
      wip.appendChild(el("p", null, info.wip || "This machine is still being wired up."));
      if (err.message !== "not built yet") wip.appendChild(el("p", null, `Error: ${err.message}`));
      body.appendChild(wip);
    }
    return entry;
  }

  async open(id) {
    if (this.busy) return;
    const m = this.world.byId.get(id);
    if (!m) return;
    if (this.current && this.current.id === id) return;
    this.busy = true;
    try {
      if (this.current) await this.close(true);
      document.body.classList.add("panel-open");
      $("#tooltip").classList.remove("show");
      this.studio.audio.start();
      const loading = this._panelFor(m.tool);
      const side = this._isSide(m.tool);
      const shift = side ? Math.min(0.5, (Math.min(560, window.innerWidth * 0.44) + 32) / window.innerWidth) : 0;
      await this.world.focus(id, { shift });
      const entry = await loading;
      this.current = { id, toolId: m.tool, entry, machine: m };
      this.studio.panelOpen = true;
      this.studio.activeTool = m.tool;
      await this._unfold(entry.panel, m);
      entry.instance?.open?.(id);
      history.replaceState(null, "", `#${id}`);
    } finally {
      this.busy = false;
    }
  }

  async close(switching = false) {
    if (!this.current) return;
    const { entry, machine } = this.current;
    this.current = null;
    this.studio.activeTool = null;
    entry.instance?.close?.();
    await this._fold(entry.panel, machine);
    this.studio.panelOpen = false;
    if (!switching) {
      document.body.classList.remove("panel-open");
      history.replaceState(null, "", location.pathname + location.search);
      await this.world.unfocus();
    }
  }

  _isSide(toolId) {
    return TOOLS[toolId] && TOOLS[toolId].layout === "side" && window.innerWidth > 900;
  }

  _layout(panel) {
    const side = panel.classList.contains("side") && window.innerWidth > 900;
    panel.classList.toggle("docked", side);
    if (side) {
      panel.style.transform = "none";
      panel.classList.add("open");
      const r = panel.getBoundingClientRect();
      panel.style.left = `${Math.round(window.innerWidth - r.width - 16)}px`;
      panel.style.top = "16px";
      return { left: window.innerWidth - r.width - 16, top: 16, w: r.width, h: r.height };
    }
    panel.style.transform = "none";
    panel.style.left = "0px";
    panel.style.top = "0px";
    panel.classList.add("open");
    const r = panel.getBoundingClientRect();
    const left = Math.round((window.innerWidth - r.width) / 2);
    const top = Math.round((window.innerHeight - r.height) / 2);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    return { left, top, w: r.width, h: r.height };
  }

  _unfold(panel, m) {
    const box = this._layout(panel);
    const rect = m.screenRect(this.world.camera, this.world.width, this.world.height);
    const sx = Math.max(0.05, rect.w / box.w), sy = Math.max(0.05, rect.h / box.h);
    const from = `translate(${rect.x - box.left}px, ${rect.y - box.top}px) scale(${sx}, ${sy})`;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
    const anim = panel.animate(
      [
        { transform: from, opacity: 0, filter: "blur(6px)" },
        { transform: "none", opacity: 1, filter: "blur(0px)" }
      ],
      { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)" }
    );
    return anim.finished.catch(() => {});
  }

  async _fold(panel, m) {
    const r = panel.getBoundingClientRect();
    const rect = m.screenRect(this.world.camera, this.world.width, this.world.height);
    const sx = Math.max(0.05, rect.w / r.width), sy = Math.max(0.05, rect.h / r.height);
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const anim = panel.animate(
        [
          { transform: "none", opacity: 1 },
          { transform: `translate(${rect.x - r.left}px, ${rect.y - r.top}px) scale(${sx}, ${sy})`, opacity: 0 }
        ],
        { duration: 340, easing: "cubic-bezier(.6,0,.8,.4)" }
      );
      await anim.finished.catch(() => {});
    }
    panel.classList.remove("open");
  }

  /* ---------------- tape library ---------------- */
  _drawer() {
    const drawer = $("#drawer");
    const lib = this.studio.library;
    drawer.innerHTML = `<header><b>TAPE LIBRARY</b><button class="k-btn ghost icon" type="button" aria-label="Close">✕</button></header><div class="list"></div><div class="actions"></div>`;
    drawer.querySelector("header button").addEventListener("click", () => (drawer.hidden = true));
    $("#btn-tapes").addEventListener("click", () => (drawer.hidden = !drawer.hidden));
    const list = drawer.querySelector(".list");
    const actions = drawer.querySelector(".actions");
    const picker = el("input");
    picker.type = "file";
    picker.multiple = true;
    picker.accept = "audio/*,.mid,.midi";
    picker.hidden = true;
    picker.addEventListener("change", async () => {
      for (const f of picker.files) await this.importFile(f);
      picker.value = "";
    });
    const load = el("button", "k-btn", "Load files");
    load.type = "button";
    load.addEventListener("click", () => picker.click());
    const rec = el("button", "k-btn", "Record mic");
    rec.type = "button";
    let take = null;
    rec.addEventListener("click", async () => {
      try {
        if (!take) {
          take = await lib.recordMic();
          rec.textContent = "Stop recording";
          rec.classList.add("on");
        } else {
          const item = await take.stop();
          take = null;
          rec.textContent = "Record mic";
          rec.classList.remove("on");
          this.toast(`Saved “${item.name}” to the tape library`);
        }
      } catch (err) {
        take = null;
        rec.textContent = "Record mic";
        rec.classList.remove("on");
        this.toast(`Microphone unavailable: ${err.message}`, { error: true });
      }
    });
    actions.append(load, rec, picker);

    const render = () => {
      const items = lib.list();
      $("#tape-count").textContent = String(items.filter((i) => !i.builtin).length);
      list.innerHTML = "";
      for (const it of items) {
        const row = el("div", "tape-item");
        row.appendChild(el("div", `ico ${it.kind === "midi" ? "midi" : ""}`));
        const meta = el("div", "meta");
        meta.appendChild(el("b", null, it.name));
        const dur = it.kind === "audio" && it.buffer ? `${it.buffer.duration.toFixed(1)}s` : it.kind === "midi" && it.seq ? `${it.seq.notes.length} notes` : "";
        meta.appendChild(el("span", null, `${it.kind === "midi" ? "MIDI cart" : "tape"} · ${it.source}${dur ? ` · ${dur}` : ""}`));
        row.appendChild(meta);
        if (!it.builtin) {
          const x = el("button", "k-btn ghost icon", "✕");
          x.type = "button";
          x.title = "Remove";
          x.addEventListener("click", () => lib.remove(it.id));
          row.appendChild(x);
        } else {
          row.appendChild(el("span"));
        }
        list.appendChild(row);
      }
    };
    lib.on("change", render);
    render();

    // drop files anywhere in the room
    window.addEventListener("dragover", (e) => { e.preventDefault(); });
    window.addEventListener("drop", async (e) => {
      if (e.defaultPrevented) return;
      e.preventDefault();
      for (const f of e.dataTransfer.files) await this.importFile(f);
    });
  }

  async importFile(file) {
    try {
      await this.studio.audio.start();
      const item = await this.studio.library.importFile(file);
      this.toast(`Loaded “${item.name}” into the tape library`);
      return item;
    } catch (err) {
      this.toast(`Couldn't read ${file.name}: ${err.message}`, { error: true });
      return null;
    }
  }

  /* ---------------- toasts ---------------- */
  toast(msg, { error = false, ms = 3200 } = {}) {
    const t = el("div", `toast${error ? " err" : ""}`, msg);
    $("#toasts").appendChild(t);
    setTimeout(() => {
      t.classList.add("out");
      setTimeout(() => t.remove(), 320);
    }, ms);
  }
}

function shortName(m) {
  const map = { jc808: "JC-808", tuner: "Tuner", master: "Master", scribe: "Scribe", analyzer: "Analyzer", radio: "Radio", chipify: "Chipify", engine: "CHIP-4", autotune: "Autotune" };
  return map[m.id] || m.label;
}
