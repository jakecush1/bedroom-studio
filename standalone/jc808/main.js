// Standalone JC-808: the same machine that lives in the Room 808 studio,
// mounted on its own page. This file stands in for the studio — one audio
// context with a safety limiter, toasts, and no tape library — so the
// jc-808 repo can be published straight from the studio's source.
//
// Built with:  npx vite build --config vite.standalone.config.js
import { create } from "../../src/tools/jc808/index.js";

class Audio {
  constructor() { this.ctx = null; this.buses = new Map(); }
  start() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: "interactive" });
      this.limiter = this.ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -6;
      this.limiter.knee.value = 6;
      this.limiter.ratio.value = 8;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.2;
      this.limiter.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return Promise.resolve(this);
  }
  bus(name) {
    if (!this.buses.has(name)) {
      const g = this.ctx.createGain();
      g.connect(this.limiter);
      this.buses.set(name, g);
    }
    return this.buses.get(name);
  }
}

const host = document.getElementById("host");
let toastEl = null, toastTimer = null;
const studio = {
  audio: new Audio(),
  state: {},
  activeTool: "jc808",            // the keys only respond while "this panel is open"
  library: { addMidi() {}, addAudio() {} },
  toast(msg) {
    if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "toast"; host.firstChild.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3200);
  }
};

const instance = create(studio, host);
const root = host.firstChild;

// studio-only bits: the tape library button and the "back to the room" key
root.querySelector("#jc-tapeBtn")?.remove();
for (const dt of root.querySelectorAll("#jc-help dt")) {
  if (dt.textContent.trim() === "Esc") { dt.nextElementSibling?.remove(); dt.remove(); }
}
root.querySelector(".masthead .sub").textContent = "Twelve analogue-modelled voices, a 16-step sequencer with per-step echo and reverb, two synth lanes with a looping recorder — built from scratch with the Web Audio API.";

// the audio context is created now (suspended until the first click or key)
// so the scope and the rolls are sized for the page
instance.open();
window.__jc808 = { studio, instance };
