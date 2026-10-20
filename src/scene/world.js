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

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.baseExposure = 1.4;
    renderer.toneMappingExposure = this.baseExposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
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

    // a soft key light that fades in on whichever machine you walk up to
    this.focusLight = new THREE.SpotLight(0xfff1de, 0, 5, 0.5, 0.95, 2);
    this.focusLight.castShadow = false;
    scene.add(this.focusLight, this.focusLight.target);
    this.focusLightLevel = 0;

    this.post = createPost(renderer, scene, this.camera);
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
    this.pixelRatio = q >= 1 ? Math.min(window.devicePixelRatio || 1, 1.75) : q >= 0.75 ? 1 : 0.75;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.resize();
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
      return;
    }
    const t0 = performance.now();
    await new Promise((res) => {
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / 1300);
        door.rotation.y = -1.62 * ease(k);
        k < 1 ? requestAnimationFrame(step) : res();
      };
      step();
    });
    await this._tweenTo(HOME, 2.6);
    this.inputEnabled = true;
  }

  async focus(id, { shift = 0 } = {}) {
    const m = this.byId.get(id);
    if (!m) return null;
    this.focused = m;
    this._setHover(null);
    this.highlight(null);
    await this._tweenTo(m.focusPose(), 1.15, shift);
    return m;
  }

  async unfocus() {
    this.focused = null;
    await this._tweenTo(HOME, 1.05, 0);
  }

  /* ---------------- loop ---------------- */

  _frame() {
    this.timer.update();
    const dt = Math.min(0.05, this.timer.getDelta());
    const t = this.timer.getElapsed();

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

    const ctx = { bands: this.studio.audio.ctx ? this.studio.audio.bands() : [0, 0, 0] };
    for (const fn of this.animated) fn(t, dt, ctx);
    for (const m of this.machines) if (m.update) m.update(dt, t);
    this.fx.update(dt, t);

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
