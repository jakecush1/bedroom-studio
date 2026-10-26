// Shared controls for the machine panels.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export function button(text, onClick, { cls = "", title = "", toggle = false, on = false } = {}) {
  const b = el("button", `k-btn ${cls}`.trim(), text);
  b.type = "button";
  if (title) b.title = title;
  if (toggle) {
    b.setAttribute("aria-pressed", String(on));
    b.classList.toggle("on", on);
  }
  b.addEventListener("click", (e) => {
    if (toggle) {
      const next = b.getAttribute("aria-pressed") !== "true";
      b.setAttribute("aria-pressed", String(next));
      b.classList.toggle("on", next);
      onClick && onClick(next, e);
    } else onClick && onClick(e);
  });
  b.set = (v) => {
    b.setAttribute("aria-pressed", String(!!v));
    b.classList.toggle("on", !!v);
  };
  return b;
}

/** Segmented control. options: [[value, label], ...] */
export function seg(options, value, onChange, { label = null } = {}) {
  const wrap = el("div", "k-seg");
  wrap.setAttribute("role", "radiogroup");
  if (label) wrap.setAttribute("aria-label", label);
  const btns = options.map(([v, text]) => {
    const b = el("button", v === value ? "on" : "", text);
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(v === value));
    b.addEventListener("click", () => {
      set(v);
      onChange && onChange(v);
    });
    wrap.appendChild(b);
    return [v, b];
  });
  function set(v) {
    for (const [bv, b] of btns) {
      b.classList.toggle("on", bv === v);
      b.setAttribute("aria-checked", String(bv === v));
    }
    wrap.value = v;
  }
  wrap.value = value;
  wrap.set = set;
  return wrap;
}

export function field(label, control) {
  const f = el("label", "k-field");
  f.appendChild(el("span", null, label));
  f.appendChild(control);
  return f;
}

export function select(options, value, onChange) {
  const s = el("select", "k-select");
  for (const o of options) {
    if (o.group) {
      const g = document.createElement("optgroup");
      g.label = o.group;
      for (const [v, t] of o.items) {
        const op = el("option", null, t);
        op.value = v;
        g.appendChild(op);
      }
      s.appendChild(g);
    } else {
      const [v, t] = o;
      const op = el("option", null, t);
      op.value = v;
      s.appendChild(op);
    }
  }
  if (value != null) s.value = value;
  s.addEventListener("change", () => onChange && onChange(s.value));
  return s;
}

/* ---------------- fader (same feel as the JC-808's) ----------------
   A vertical fader, low at the bottom and high at the top like a channel
   fader on a mixing desk. Click anywhere on the track to jump the cap there
   and drag; it only moves while the button is held. Shift-drag is fine,
   the wheel nudges, arrow keys step, double-click resets. */
const CAP_H = 14; // CSS px, must match .k-knob .fader-cap in base.css

export function knob({ label, min = 0, max = 1, value = 0, step, format, onChange }) {
  step = step || (max - min) / 100;
  let v = clamp(value, min, max);
  const wrap = el("div", "k-knob k-fader");
  const out = el("output");
  const btn = el("button", "fader");
  btn.type = "button";
  btn.setAttribute("role", "slider");
  btn.setAttribute("aria-label", label);
  btn.setAttribute("aria-orientation", "vertical");
  const track = el("span", "fader-track");
  const fill = el("span", "fader-fill");
  const cap = el("span", "fader-cap");
  track.append(fill, cap);
  btn.appendChild(track);
  const lab = el("label", null, label);
  wrap.append(out, btn, lab);
  const render = () => {
    const norm = (v - min) / (max - min);
    fill.style.height = `${(norm * 100).toFixed(2)}%`;
    cap.style.bottom = `calc(${(norm * 100).toFixed(2)}% - ${(norm * CAP_H).toFixed(2)}px)`;
    out.textContent = format ? format(v) : String(Math.round(v * 100) / 100);
    btn.setAttribute("aria-valuenow", String(v));
    btn.setAttribute("aria-valuemin", String(min));
    btn.setAttribute("aria-valuemax", String(max));
    btn.setAttribute("aria-valuetext", out.textContent);
  };
  const set = (nv, fire = true) => {
    nv = clamp(Math.round(nv / step) * step, min, max);
    if (nv === v) return render();
    v = nv;
    render();
    if (fire && onChange) onChange(v);
  };
  const valueAt = (clientY) => {
    const r = track.getBoundingClientRect();
    const norm = 1 - (clientY - r.top - CAP_H / 2) / Math.max(1, r.height - CAP_H);
    return min + clamp(norm, 0, 1) * (max - min);
  };
  // The drag lives on the window, not the button: the fader only moves while
  // the button is held, and it lets go the moment the pointer is released
  // anywhere (even outside the panel or the browser window).
  let drag = null, lastY = 0, fineAcc = 0;
  const move = (e) => {
    if (drag === null || e.pointerId !== drag) return;
    if (e.pointerType === "mouse" && e.buttons === 0) return end(e);
    if (e.shiftKey) {
      const r = track.getBoundingClientRect();
      fineAcc = clamp(fineAcc + ((lastY - e.clientY) / Math.max(1, r.height - CAP_H)) * 0.25 * (max - min), min, max);
      set(fineAcc);
    } else {
      set(valueAt(e.clientY));
      fineAcc = v;
    }
    lastY = e.clientY;
  };
  const end = (e) => {
    if (drag === null) return;
    if (e && e.pointerId != null && e.pointerId !== drag) return;
    try { btn.releasePointerCapture(drag); } catch (err) { /* not captured */ }
    drag = null;
    btn.classList.remove("dragging");
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", end, true);
    window.removeEventListener("pointercancel", end, true);
    window.removeEventListener("blur", end);
  };
  btn.addEventListener("pointerdown", (e) => {
    if (e.button != null && e.button !== 0) return;
    end();
    drag = e.pointerId;
    lastY = e.clientY;
    btn.classList.add("dragging");
    try { btn.setPointerCapture(e.pointerId); } catch (err) { /* capture is a bonus, not a requirement */ }
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
    window.addEventListener("blur", end);
    btn.focus({ preventScroll: true });
    e.preventDefault();
    if (!e.shiftKey) set(valueAt(e.clientY));
    fineAcc = v;
  });
  btn.addEventListener("dblclick", () => set(value));
  btn.addEventListener("wheel", (e) => { e.preventDefault(); set(v + (e.deltaY < 0 ? 1 : -1) * step * (e.shiftKey ? 1 : 4)); }, { passive: false });
  btn.addEventListener("keydown", (e) => {
    const big = (max - min) / 50;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") { set(v + (e.shiftKey ? step : big)); e.preventDefault(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") { set(v - (e.shiftKey ? step : big)); e.preventDefault(); }
    else if (e.key === "Home") { set(min); e.preventDefault(); }
    else if (e.key === "End") { set(max); e.preventDefault(); }
  });
  render();
  wrap.setValue = (nv) => { v = clamp(nv, min, max); render(); };
  wrap.getValue = () => v;
  return wrap;
}

/* ---------------- canvas screen ---------------- */
/**
 * A DPR-aware canvas that redraws on resize. draw(g, w, h) works in CSS pixels.
 */
export function screen(height, draw, { cls = "" } = {}) {
  const c = el("canvas", `k-screen ${cls}`.trim());
  c.style.height = typeof height === "number" ? `${height}px` : height;
  const g = c.getContext("2d");
  let w = 0, h = 0;
  const api = {
    canvas: c,
    get width() { return w; },
    get height() { return h; },
    resize() {
      const r = c.getBoundingClientRect();
      if (!r.width) return false;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = r.width;
      h = r.height;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      return true;
    },
    draw(...args) {
      if (!w && !api.resize()) return;
      draw(g, w, h, ...args);
    }
  };
  if (window.ResizeObserver) new ResizeObserver(() => { if (api.resize()) api.draw(); }).observe(c);
  return api;
}

/* ---------------- tape deck: pick an input from the library ---------------- */
/**
 * kinds: ["audio"] | ["midi"] | ["audio","midi"]
 * onPick(item) fires with the selected library item (not yet loaded).
 */
export function tapeDeck(studio, { kinds = ["audio"], label = "Input tape", onPick, preferBuiltin = null } = {}) {
  const lib = studio.library;
  const wrap = el("div", "k-tape");
  const sel = el("select", "k-select");
  const f = field(label, sel);
  const picker = el("input");
  picker.type = "file";
  picker.hidden = true;
  picker.accept = kinds.includes("midi") && !kinds.includes("audio") ? ".mid,.midi" : kinds.includes("midi") ? "audio/*,.mid,.midi" : "audio/*";
  const load = button("Load file…", () => picker.click());
  wrap.append(f, load, picker);
  let rec = null, recBtn = null, current = null;
  if (kinds.includes("audio")) {
    recBtn = button("Record", async () => {
      try {
        if (!rec) {
          rec = await lib.recordMic();
          recBtn.textContent = "Stop";
          recBtn.classList.add("on");
        } else {
          const item = await rec.stop();
          rec = null;
          recBtn.textContent = "Record";
          recBtn.classList.remove("on");
          choose(item.id);
        }
      } catch (err) {
        rec = null;
        recBtn.textContent = "Record";
        recBtn.classList.remove("on");
        studio.toast(`Microphone unavailable: ${err.message}`, { error: true });
      }
    }, { title: "Record a take from your microphone" });
    wrap.appendChild(recBtn);
  }
  picker.addEventListener("change", async () => {
    const file = picker.files[0];
    picker.value = "";
    if (!file) return;
    try {
      await studio.audio.start();
      const item = await lib.importFile(file);
      choose(item.id);
    } catch (err) {
      studio.toast(`Couldn't read ${file.name}: ${err.message}`, { error: true });
    }
  });

  const fill = () => {
    const items = lib.list().filter((i) => kinds.includes(i.kind));
    const prev = sel.value;
    sel.innerHTML = "";
    const groups = [["Your tapes", items.filter((i) => !i.builtin)], ["Built-in", items.filter((i) => i.builtin)]];
    for (const [name, list] of groups) {
      if (!list.length) continue;
      const g = document.createElement("optgroup");
      g.label = name;
      for (const it of list) {
        const o = el("option", null, `${it.kind === "midi" ? "▤ " : "◉ "}${it.name}`);
        o.value = it.id;
        g.appendChild(o);
      }
      sel.appendChild(g);
    }
    if (prev && lib.get(prev)) sel.value = prev;
  };
  const choose = (id) => {
    fill();
    sel.value = id;
    current = lib.get(id);
    onPick && onPick(current);
  };
  sel.addEventListener("change", () => {
    current = lib.get(sel.value);
    onPick && onPick(current);
  });
  lib.on("change", (e) => {
    if (e.type === "add" || e.type === "remove") fill();
  });
  fill();
  const initial = preferBuiltin ? lib.list().find((i) => kinds.includes(i.kind) && preferBuiltin(i)) : null;
  if (initial) sel.value = initial.id;
  current = lib.get(sel.value);

  // drag & drop straight onto the panel
  wrap.dropTarget = (target) => {
    target.addEventListener("dragover", (e) => { e.preventDefault(); target.classList.add("over"); });
    target.addEventListener("dragleave", () => target.classList.remove("over"));
    target.addEventListener("drop", async (e) => {
      e.preventDefault();
      target.classList.remove("over");
      const file = e.dataTransfer.files[0];
      if (!file) return;
      try {
        await studio.audio.start();
        const item = await lib.importFile(file);
        if (kinds.includes(item.kind)) choose(item.id);
        studio.toast(`Loaded “${item.name}”`);
      } catch (err) {
        studio.toast(`Couldn't read ${file.name}: ${err.message}`, { error: true });
      }
    });
  };
  wrap.get = () => current;
  wrap.set = (id) => choose(id);
  return wrap;
}

export function progress() {
  const p = el("div", "k-progress");
  const bar = el("span");
  p.appendChild(bar);
  p.set = (v) => { bar.style.width = `${Math.round(clamp(v, 0, 1) * 100)}%`; };
  return p;
}

export function module(title, sub = null) {
  const m = el("div", "k-module");
  const h = el("h3", null, title);
  if (sub) h.appendChild(el("small", null, sub));
  m.appendChild(h);
  return m;
}

export const pct = (v) => `${Math.round(v * 100)}%`;
