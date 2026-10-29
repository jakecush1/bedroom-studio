// The upright cabinet's panel: a full-size Asteroids with keyboard, on-screen
// buttons, synthesised cabinet sounds through the room's speakers, and a high
// score kept in this browser. Walking away pauses the game.
import "./arcade.css";
import { el, button, screen } from "../../ui/kit.js";
import { Asteroids } from "./asteroids.js";

const HI_KEY = "room808.asteroids.hi";

/** The cabinet's sound board: a handful of Web Audio voices on one bus. */
class SoundBoard {
  constructor(audio) {
    this.audio = audio;
    this.thrustNode = null;
    this.saucerNodes = null;
  }
  get ctx() { return this.audio.ctx; }
  bus() { return this.audio.bus("arcade", 0.7); }
  noise() {
    if (!this._noise) {
      const sr = this.ctx.sampleRate;
      const b = this.ctx.createBuffer(1, sr, sr);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this._noise = b;
    }
    return this._noise;
  }
  play(name, arg) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (name === "fire") {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = arg === "enemy" ? "sawtooth" : "square";
      o.frequency.setValueAtTime(arg === "enemy" ? 520 : 900, t);
      o.frequency.exponentialRampToValueAtTime(arg === "enemy" ? 180 : 240, t + 0.14);
      g.gain.setValueAtTime(0.16, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.connect(g).connect(this.bus());
      o.start(t); o.stop(t + 0.18);
    } else if (name === "bang") {
      const size = arg || 2;
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = this.noise();
      f.type = "lowpass";
      f.frequency.setValueAtTime(size === 3 ? 520 : size === 2 ? 900 : 1600, t);
      f.frequency.exponentialRampToValueAtTime(80, t + (size === 3 ? 0.7 : 0.35));
      g.gain.setValueAtTime(size === 3 ? 0.9 : 0.55, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + (size === 3 ? 0.75 : 0.4));
      s.connect(f).connect(g).connect(this.bus());
      s.start(t); s.stop(t + 0.8);
    } else if (name === "thrust") {
      if (arg && !this.thrustNode) {
        const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = this.noise(); s.loop = true;
        f.type = "bandpass"; f.frequency.value = 260; f.Q.value = 0.9;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.3, t + 0.08);
        s.connect(f).connect(g).connect(this.bus());
        s.start(t);
        this.thrustNode = { s, g };
      } else if (!arg && this.thrustNode) {
        const { s, g } = this.thrustNode;
        this.thrustNode = null;
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
        s.stop(t + 0.15);
      }
    } else if (name === "beat") {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(arg ? 62 : 52, t);
      o.frequency.exponentialRampToValueAtTime(arg ? 48 : 40, t + 0.12);
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      o.connect(g).connect(this.bus());
      o.start(t); o.stop(t + 0.16);
    } else if (name === "saucer") {
      if (arg && !this.saucerNodes) {
        const o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), g = ctx.createGain();
        o.type = "square";
        o.frequency.value = arg === "small" ? 720 : 300;
        lfo.type = "square"; lfo.frequency.value = arg === "small" ? 9 : 4.5;
        lg.gain.value = arg === "small" ? 140 : 70;
        lfo.connect(lg).connect(o.frequency);
        g.gain.value = 0.07;
        o.connect(g).connect(this.bus());
        o.start(t); lfo.start(t);
        this.saucerNodes = { o, lfo, g };
      } else if (!arg && this.saucerNodes) {
        const { o, lfo, g } = this.saucerNodes;
        this.saucerNodes = null;
        g.gain.setTargetAtTime(0.0001, t, 0.03);
        o.stop(t + 0.2); lfo.stop(t + 0.2);
      }
    } else if (name === "hyper") {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(1400, t);
      o.frequency.exponentialRampToValueAtTime(120, t + 0.4);
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
      o.connect(g).connect(this.bus());
      o.start(t); o.stop(t + 0.45);
    } else if (name === "life") {
      [660, 880, 1320].forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "square"; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + i * 0.09);
        g.gain.linearRampToValueAtTime(0.12, t + i * 0.09 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.09);
        o.connect(g).connect(this.bus());
        o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.1);
      });
    }
  }
  silence() {
    this.play("thrust", false);
    this.play("saucer", false);
  }
}

export function create(studio, host) {
  const audio = studio.audio;
  const board = new SoundBoard(audio);
  const game = new Asteroids({ sound: (n, a) => board.play(n, a) });
  try { game.hi = parseInt(localStorage.getItem(HI_KEY) || "0", 10) || 0; } catch (e) { /* private mode */ }
  const live = studio.state.arcade || (studio.state.arcade = { hi: 0, last: null, mode: "attract", score: 0 });
  live.hi = game.hi;
  const keys = { left: false, right: false, thrust: false, fire: false, hyper: false };
  let active = false, raf = 0, lastT = 0, paused = false;

  const root = el("div", "kit arcade");
  host.appendChild(root);
  const cab = el("div", "ar-cab");
  const marquee = el("div", "ar-marquee", "ASTEROIDS");
  marquee.appendChild(el("small", null, "ROOM 808 AMUSEMENTS · 1 COIN 1 PLAY"));
  const bezel = el("div", "ar-bezel");
  const scr = screen(540, (g, w, h) => game.render(g, w, h, { hi: game.hi, paused }), { cls: "ar-screen" });
  scr.canvas.tabIndex = 0;
  bezel.appendChild(scr.canvas);
  cab.append(marquee, bezel);
  root.appendChild(cab);

  /* ---------- controls ---------- */
  const controls = el("div", "ar-controls");
  const startBtn = button("Start game", () => start(), { cls: "primary big" });
  const pad = el("div", "ar-pad");
  const hold = (label, key, cls = "") => {
    const b = button(label, null, { cls });
    const down = (e) => { e.preventDefault(); keys[key] = true; b.classList.add("held"); wake(); };
    const up = () => { keys[key] = false; b.classList.remove("held"); };
    b.addEventListener("pointerdown", down);
    b.addEventListener("pointerup", up);
    b.addEventListener("pointerleave", up);
    b.addEventListener("pointercancel", up);
    b.addEventListener("click", (e) => e.preventDefault());
    return b;
  };
  pad.append(hold("◄", "left"), hold("►", "right"), hold("▲ thrust", "thrust"), hold("● fire", "fire", "fire"), hold("hyper", "hyper"));
  const stats = el("div", "ar-stats");
  const hiOut = el("span"), lastOut = el("span");
  stats.append(hiOut, lastOut);
  controls.append(startBtn, pad, stats);
  root.appendChild(controls);
  root.appendChild(el("p", "k-note ar-help", "← → or A D rotate · ↑ or W thrust · space fires (four shots in the air at once) · shift is hyperspace, which sometimes doesn't bring you back · P pauses · the saucer is worth 200, the small one 1000 · an extra ship every 10,000."));

  function paintStats() {
    hiOut.innerHTML = `HIGH <b>${String(game.hi).padStart(5, "0")}</b>`;
    lastOut.innerHTML = game.last != null ? `LAST <b>${String(game.last).padStart(5, "0")}</b>` : "";
    live.hi = game.hi;
    live.last = game.last ?? null;
    live.mode = game.mode === "play" && paused ? "paused" : game.mode;
    live.score = game.score;
  }

  async function start() {
    await audio.start();
    paused = false;
    game.start();
    scr.canvas.focus({ preventScroll: true });
    startBtn.textContent = "Restart";
  }

  function wake() { if (paused) paused = false; }

  const onKey = (e, down) => {
    if (!active) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
    const k = e.key;
    let used = true;
    if (k === "ArrowLeft" || k === "a" || k === "A") keys.left = down;
    else if (k === "ArrowRight" || k === "d" || k === "D") keys.right = down;
    else if (k === "ArrowUp" || k === "w" || k === "W") keys.thrust = down;
    else if (k === " " || k === "ArrowDown") { keys.fire = down; if (down && game.mode !== "play" && !e.repeat) start(); }
    else if (k === "Shift") keys.hyper = down;
    else if ((k === "p" || k === "P") && down && !e.repeat && game.mode === "play") { paused = !paused; if (paused) board.silence(); }
    else if (k === "Enter" && down && !e.repeat && game.mode !== "play") start();
    else used = false;
    if (down && paused && used && k !== "p" && k !== "P") paused = false;
    if (used) e.preventDefault();
  };
  window.addEventListener("keydown", (e) => onKey(e, true));
  window.addEventListener("keyup", (e) => onKey(e, false));
  window.addEventListener("blur", () => { for (const k in keys) keys[k] = false; });

  function loop(now) {
    if (!active) return;
    const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0;
    lastT = now;
    game.paused = paused;
    game.step(dt, keys);
    if (game.mode !== "play") board.silence();
    scr.draw();
    if (game.hi !== live.hi) { try { localStorage.setItem(HI_KEY, String(game.hi)); } catch (e) { /* ignore */ } }
    paintStats();
    raf = requestAnimationFrame(loop);
  }

  paintStats();
  return {
    open() {
      active = true;
      lastT = 0;
      scr.resize();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
      setTimeout(() => scr.canvas.focus({ preventScroll: true }), 50);
    },
    close() {
      active = false;
      cancelAnimationFrame(raf);
      if (game.mode === "play") paused = true;   // the game waits for you
      for (const k in keys) keys[k] = false;
      board.silence();
      paintStats();
    }
  };
}
