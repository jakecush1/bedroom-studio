// Renderer, camera rig, picking and the frame loop for the bedroom.
import * as THREE from "three";
import { Emitter } from "../core/events.js";
import { buildRoom, ROOM } from "./room.js";
import { buildCity } from "./city.js";
import { buildFx } from "./fx.js";
import { createPost } from "./post.js";
import { buildJC808 } from "./machines/jc808.js";
import { buildDesk } from "./machines/desk.js";
import { buildSideboard } from "./machines/sideboard.js";
import { buildConsoles } from "./machines/consoles.js";
import { buildGuitar } from "./machines/guitar.js";
import { buildMaster } from "./machines/master.js";
import { buildVox } from "./machines/vox.js";
import { mergeStatic } from "./kit3d.js";

// ?merge=0 ?gtao=0 ?bloom=0 ?post=0 ?dpr=1 ?msaa=0|2|4 — for checking what a
// feature costs on a given machine; nothing here changes the normal path
function parseDebug() {
  const q = new URLSearchParams(location.search);
  const d = {};
  for (const k of ["merge", "gtao", "bloom", "post", "dpr", "msaa"]) if (q.has(k)) d[k] = q.get(k);
  return d;
}
const MAX_DPR = 1.5;   // Retina at 1.5 is still crisp under the film grain, for 44% fewer pixels than 2

const HOME = {
  pos: new THREE.Vector3(0.02, 1.56, 2.28),
  target: new THREE.Vector3(0.12, 1.08, -2.6),
  hfov: 74
};
const ENTRY = {
  pos: new THREE.Vector3(0.0, 1.62, 3.55),
  target: new THREE.Vector3(0.05, 1.3, 0.0),
  hfov: 64
};

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class World extends Emitter {
  constructor(container, studio) {
    super();
    this.container = container;
    this.studio = studio;
    this.timer = new THREE.Timer();
    this.machines = [];
    this.animated = [];
    this.hovered = null;
    this.focused = null;
    this.pointer = new THREE.Vector2(0, 0);
    this.parallax = new THREE.Vector2(0, 0);
    this.inputEnabled = false;
    this.quality = 1;
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this.debug = parseDebug();

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.baseExposure = 1.4;
    renderer.toneMappingExposure = this.baseExposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // nothing that casts a shadow moves once the door is open, so the two
    // shadow maps are rendered once instead of twice per frame
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    this._shadowsUntil = Infinity;   // keep refreshing until enter() ends
    this._shadowAt = 0;              // ...but no more often than every 80 ms (two full scene passes each time)
    this._backdrop = false;          // cheap rendering while a panel covers the room
    this._backdropAt = 0;
    this._frameNo = 0;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.debug.dpr ? +this.debug.dpr : MAX_DPR);
    renderer.setPixelRatio(this.pixelRatio);
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x040408);
    scene.fog = new THREE.FogExp2(0x0d0b16, 0.045);
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.02, 1500);
    this.cam = { pos: ENTRY.pos.clone(), target: ENTRY.target.clone(), hfov: ENTRY.hfov };
    this.viewShift = 0;
    this.tween = null;

    const room = buildRoom(scene);
    this.room = room;
    this.animated.push(...room.animated);
    const city = buildCity(scene);
    this.animated.push(...city.animated);

    const groups = [
      buildJC808(room.room, studio),
      buildDesk(room.room, studio, renderer),
      buildSideboard(room.room, studio),
      buildConsoles(room.room, studio, room.anchors.consoleShelf),
      buildGuitar(room.room, studio),
      buildMaster(room.room, studio),
      buildVox(room.room, studio)
    ];
    for (const g of groups) {
      this.machines.push(...g.machines);
      this.animated.push(...(g.animated || []));
      Object.assign(room.lights, g.lights || {});
      Object.assign(room.anchors, g.anchors || {});
    }
    this.fx = buildFx(scene, room.anchors, ROOM);
    this.hitboxes = this.machines.map((m) => m.hitbox);
    this.byId = new Map(this.machines.map((m) => [m.id, m]));

    // A frame costs one draw call per mesh and the room is built from
    // thousands of primitives, so fold the static ones into a few meshes:
    // per machine (its hover outline must still cover all of it), then the
    // rest of the room, then the city.
    if (this.debug.merge !== "0") {
      const roots = new Set(this.machines.map((m) => m.root));
      const skip = (o) => roots.has(o);
      const total = { before: 0, after: 0, kept: 0 };
      const add = (s) => { total.before += s.before; total.after += s.after; total.kept += s.kept; };
      for (const m of this.machines) add(mergeStatic(m.root, { skip }));
      add(mergeStatic(room.room, { skip }));
      add(mergeStatic(city.city));
      this.mergeStats = total;
    }

    // a soft key light that fades in on whichever machine you walk up to
    this.focusLight = new THREE.SpotLight(0xfff1de, 0, 5, 0.5, 0.95, 2);
    this.focusLight.castShadow = false;
    scene.add(this.focusLight, this.focusLight.target);
    this.focusLightLevel = 0;

    this.post = createPost(renderer, scene, this.camera, { samples: this.debug.msaa != null ? +this.debug.msaa : 4 });
    if (this.debug.gtao === "0") this.post.gtao.enabled = false;
    if (this.debug.bloom === "0") this.post.bloom.enabled = false;
    if (this.debug.post === "0") this.debugNoPost = true;
    this.raycaster = new THREE.Raycaster();

    this._bindInput();
    this.resize();
    window.addEventListener("resize", () => this.resize());
    renderer.setAnimationLoop(() => this._frame());
  }

  /* ---------------- sizing ---------------- */

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h);
    this.post.setSize(w, h, this.renderer.getPixelRatio());
    this.camera.aspect = w / h;
    this._applyFov();
    this._applyShift();
  }

  _applyFov() {
    const aspect = this.camera.aspect || 1;
    const h = THREE.MathUtils.degToRad(this.cam.hfov);
    let v = 2 * Math.atan(Math.tan(h / 2) / aspect);
    v = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(v), 30, 80);
    this.camera.fov = v;
    this.camera.updateProjectionMatrix();
  }

  setQuality(q) {
    this.quality = q;
    const full = Math.min(window.devicePixelRatio || 1, this.debug.dpr ? +this.debug.dpr : MAX_DPR);
    this.pixelRatio = q >= 1 ? full : q >= 0.75 ? Math.min(full, 1) : Math.min(full, 0.75);
    this._applyPixelRatio();
  }

  /**
   * Everything the first seconds in the room would otherwise stall on, done
   * behind the gate: every shader compiled, every texture uploaded, a frame
   * drawn from both camera poses (shadow maps, the post passes and the hover
   * outline included), and a quick timing of this machine to pick the
   * starting quality. onProgress gets 0..1.
   */
  async warmUp(onProgress = () => {}) {
    const r = this.renderer;
    const nextFrame = () => new Promise((res) => requestAnimationFrame(res));
    await r.compileAsync(this.scene, this.camera);
    onProgress(0.35);

    const seen = new Set();
    const init = (t) => { if (t && t.isTexture && !seen.has(t)) { seen.add(t); r.initTexture(t); } };
    this.scene.traverse((o) => {
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        for (const v of Object.values(m)) init(v);
        if (m.uniforms) for (const u of Object.values(m.uniforms)) init(u && u.value);
      }
    });
    await nextFrame();
    onProgress(0.55);

    const saved = { pos: this.cam.pos.clone(), target: this.cam.target.clone(), hfov: this.cam.hfov };
    for (const pose of [HOME, ENTRY]) {
      this.cam.pos.copy(pose.pos);
      this.cam.target.copy(pose.target);
      this.cam.hfov = pose.hfov;
      this._applyFov();
      r.shadowMap.needsUpdate = true;
      this._renderOnce();
      await nextFrame();
    }
    if (this.machines.length) {
      this.post.outline.selectedObjects = [this.machines[0].highlight];
      this._renderOnce();
      this.post.outline.selectedObjects = [];
    }
    onProgress(0.8);

    // how long does a frame take here? (finish() waits for the GPU)
    const gl = r.getContext();
    this._renderOnce();
    gl.finish();
    const N = 6, t0 = performance.now();
    for (let i = 0; i < N; i++) { this._renderOnce(); gl.finish(); }
    this.warmFrameMs = (performance.now() - t0) / N;
    if (this.warmFrameMs > 30) this.setQuality(0.5);
    else if (this.warmFrameMs > 18) this.setQuality(0.75);

    this.cam.pos.copy(saved.pos);
    this.cam.target.copy(saved.target);
    this.cam.hfov = saved.hfov;
    this._applyFov();
    onProgress(1);
  }

  _renderOnce() {
    this.camera.position.copy(this.cam.pos);
    this.camera.lookAt(this.cam.target);
    if (this.debugNoPost) this.renderer.render(this.scene, this.camera);
    else this.post.render(this.timer.getElapsed());
  }

  _applyPixelRatio() {
    const pr = this._backdrop ? Math.min(this.pixelRatio, 1) * 0.8 : this.pixelRatio;
    if (Math.abs(this.renderer.getPixelRatio() - pr) < 1e-3) return;
    this.renderer.setPixelRatio(pr);
    this.resize();
  }

  /**
   * While a machine panel is open the room is a dimmed backdrop, so it is
   * drawn cheaply: no ambient occlusion, fewer pixels, every other frame.
   * That keeps the main thread free for the panel and the sequencer.
   */
  _setBackdrop(on) {
    if (this._backdrop === on) return;
    this._backdrop = on;
    this.post.gtao.enabled = !on && this.debug.gtao !== "0";
    this._applyPixelRatio();
  }

  /* ---------------- input ---------------- */

  _bindInput() {
    const el = this.renderer.domElement;
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this._pointerClient = { x: e.clientX, y: e.clientY };
      this._needsPick = true;
    });
    el.addEventListener("pointerleave", () => {
      this._setHover(null);
    });
    el.addEventListener("click", (e) => {
      if (!this.inputEnabled || this.focused) return;
      const r = el.getBoundingClientRect();
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      const m = this._pick();
      if (m) this.emit("select", m);
    });
  }

  _pick() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.hitboxes, false);
    if (!hits.length) return null;
    return this.byId.get(hits[0].object.userData.machineId) || null;
  }

  _setHover(m) {
    if (this.hovered === m) return;
    this.hovered = m;
    this.post.outline.selectedObjects = m ? [m.highlight] : [];
    this.renderer.domElement.style.cursor = m ? "pointer" : "";
    this.emit("hover", m ? { machine: m, x: this._pointerClient?.x, y: this._pointerClient?.y } : null);
  }

  highlight(id) {
    const m = id ? this.byId.get(id) : null;
    this.post.outline.selectedObjects = m ? [m.highlight] : [];
  }

  /* ---------------- camera ---------------- */

  _tweenTo(pose, duration = 1.25, shift = 0) {
    return new Promise((resolve) => {
      this.tween = {
        from: { pos: this.cam.pos.clone(), target: this.cam.target.clone(), hfov: this.cam.hfov, shift: this.viewShift },
        to: { pos: pose.pos.clone(), target: pose.target.clone(), hfov: pose.hfov, shift },
        start: performance.now(),
        duration,
        resolve
      };
    });
  }

  /** Shift the rendered view left by a fraction of the width (room for a side panel). */
  _applyShift() {
    const s = this.viewShift;
    if (Math.abs(s) < 1e-4) this.camera.clearViewOffset();
    else this.camera.setViewOffset(this.width, this.height, (s * this.width) / 2, 0, this.width, this.height);
  }

  async enter(fast = false) {
    const door = this.room.doorPivot;
    if (fast) {
      door.rotation.y = -1.62;
      this.cam.pos.copy(HOME.pos);
      this.cam.target.copy(HOME.target);
      this.cam.hfov = HOME.hfov;
      this._applyFov();
      this.inputEnabled = true;
      this._shadowsUntil = performance.now() + 300;
      return;
    }
    const t0 = performance.now();
    await new Promise((res) => {
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / 900);
        door.rotation.y = -1.62 * ease(k);
        k < 1 ? requestAnimationFrame(step) : res();
      };
      step();
    });
    this._shadowsUntil = performance.now() + 300;   // the door has settled
    await this._tweenTo(HOME, 1.8);
    this.inputEnabled = true;
  }

  async focus(id, { shift = 0 } = {}) {
    const m = this.byId.get(id);
    if (!m) return null;
    this.focused = m;
    this._setHover(null);
    this.highlight(null);
    await this._tweenTo(m.focusPose(), 0.85, shift);
    return m;
  }

  async unfocus() {
    this.focused = null;
    await this._tweenTo(HOME, 0.8, 0);
  }

  /* ---------------- loop ---------------- */

  _frame() {
    this.timer.update();
    const dt = Math.min(0.05, this.timer.getDelta());
    const t = this.timer.getElapsed();
    this._frameNo++;

    // backdrop mode follows the panel: on a beat after the panel has unfolded
    // (so the render targets are not reallocated mid-animation), off at once
    const now = performance.now();
    if (this.studio.panelOpen) {
      if (!this._backdrop) {
        if (!this._backdropAt) this._backdropAt = now + 500;
        else if (now >= this._backdropAt) this._setBackdrop(true);
      }
    } else {
      this._backdropAt = 0;
      if (this._backdrop) this._setBackdrop(false);
    }
    const skip = this._backdrop && !this.tween && (this._frameNo & 1) === 1;

    if (this.tween) {
      const tw = this.tween;
      const p = Math.min(1, (performance.now() - tw.start) / (tw.duration * 1000));
      const k = ease(p);
      this.cam.pos.lerpVectors(tw.from.pos, tw.to.pos, k);
      this.cam.target.lerpVectors(tw.from.target, tw.to.target, k);
      this.cam.hfov = tw.from.hfov + (tw.to.hfov - tw.from.hfov) * k;
      this.viewShift = tw.from.shift + (tw.to.shift - tw.from.shift) * k;
      this._applyFov();
      this._applyShift();
      if (p >= 1) {
        this.tween = null;
        tw.resolve();
      }
    }

    // gentle parallax + breathing in the room view
    const free = !this.focused && !this.tween && this.inputEnabled;
    const px = free ? this.pointer.x : 0, py = free ? this.pointer.y : 0;
    this.parallax.x += (px - this.parallax.x) * Math.min(1, dt * 2.2);
    this.parallax.y += (py - this.parallax.y) * Math.min(1, dt * 2.2);
    const breathe = this.focused ? 0.15 : 1;
    this.camera.position.set(
      this.cam.pos.x + this.parallax.x * 0.12 + Math.sin(t * 0.21) * 0.006 * breathe,
      this.cam.pos.y + this.parallax.y * 0.05 + Math.sin(t * 0.33) * 0.004 * breathe,
      this.cam.pos.z
    );
    const look = this.cam.target.clone();
    look.x += this.parallax.x * 0.55;
    look.y += this.parallax.y * 0.3;
    this.camera.lookAt(look);

    if (this._needsPick && free) {
      this._needsPick = false;
      this._setHover(this._pick());
    } else if (!free && this.hovered) {
      this._setHover(null);
    }

    // focus light follows the camera, aimed at the focused machine
    const wantLight = this.focused ? this.focused.focusLocal.light ?? 2.6 : 0;
    this.focusLightLevel += (wantLight - this.focusLightLevel) * Math.min(1, dt * 3);
    this.focusLight.intensity = this.focusLightLevel;
    // close-ups can ask for their own exposure (the pedal sits in the lamp's hotspot)
    const wantExp = this.focused ? this.focused.focusLocal.exposure ?? this.baseExposure : this.baseExposure;
    this.renderer.toneMappingExposure += (wantExp - this.renderer.toneMappingExposure) * Math.min(1, dt * 3);
    if (this.focusLightLevel > 0.01) {
      this.focusLight.position.copy(this.camera.position).add(new THREE.Vector3(0, 0.35, 0));
      this.focusLight.target.position.copy(this.cam.target);
      this.focusLight.target.updateMatrixWorld();
    }

    if (skip) return;   // the previous frame stays on screen behind the panel

    const ctx = { bands: this.studio.audio.ctx ? this.studio.audio.bands() : [0, 0, 0] };
    for (const fn of this.animated) fn(t, dt, ctx);
    for (const m of this.machines) if (m.update) m.update(dt, t);
    this.fx.update(dt, t);

    if (now < this._shadowsUntil && now - this._shadowAt >= 80) { this.renderer.shadowMap.needsUpdate = true; this._shadowAt = now; }
    this.post.lofi.uniforms.uFocus.value += ((this.studio.panelOpen ? 1 : 0) - this.post.lofi.uniforms.uFocus.value) * Math.min(1, dt * 4);
    if (this.debugNoPost) this.renderer.render(this.scene, this.camera);
    else this.post.render(t);

    // adaptive quality: drop resolution if the frame rate stays low
    this._fpsAcc += dt;
    this._fpsFrames++;
    if (this._fpsAcc > 4) {
      const fps = this._fpsFrames / this._fpsAcc;
      if (fps < 32 && this.quality > 0.5) this.setQuality(this.quality - 0.25);
      this._fpsAcc = 0;
      this._fpsFrames = 0;
    }
  }
}
