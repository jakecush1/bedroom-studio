// The desk under the window — the chip workstation: Chipify on the monitor,
// the CHIP-4 sound engine (pad box). Plus the desk lamp, monitors and MIDI
// keyboard that set the light in the room.
import * as THREE from "three";
import { box, cyl, sphere, lathe, torus, group, std, glow, tube } from "../kit3d.js";
import { canvasTexture, LiveScreen } from "../textures.js";
import { machine, ledMat } from "./common.js";
import { DESK } from "../room.js";

const TOP = DESK.top;

/** Cylinder spanning two points. */
function rod(a, b, r, mat, parent) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  m.castShadow = true;
  parent.add(m);
  return m;
}

function speaker(parent, x, z, ry) {
  const g = group({ parent, x, y: TOP, z, ry });
  const body = std(0x141416, { rough: 0.55 });
  box(0.19, 0.3, 0.23, body, { parent: g, y: 0.15, r: 0.01, cast: true });
  torus(0.058, 0.008, std(0x2a2a2e, { rough: 0.4, metal: 0.4 }), { parent: g, y: 0.1, z: 0.116 });
  const cone = lathe([[0.0, 0.0], [0.02, -0.004], [0.052, -0.016], [0.056, -0.012]], std(0x1d1d20, { rough: 0.7 }), { parent: g, y: 0.1, z: 0.118, rx: -Math.PI / 2, seg: 24 });
  sphere(0.015, std(0x2a2a2e, { rough: 0.3, metal: 0.5 }), { parent: g, y: 0.1, z: 0.11 });
  torus(0.022, 0.005, std(0x2a2a2e, { metal: 0.5, rough: 0.3 }), { parent: g, y: 0.235, z: 0.116 });
  sphere(0.013, std(0x8a8a90, { metal: 0.8, rough: 0.2 }), { parent: g, y: 0.235, z: 0.11, thetaLength: Math.PI / 2, rx: Math.PI / 2 });
  box(0.008, 0.008, 0.004, glow(0x55ff88, 1.6), { parent: g, x: 0.07, y: 0.025, z: 0.116 });
  return { group: g, cone };
}

export function buildDesk(parent, studio, renderer) {
  const machines = [];
  const animated = [];
  const lights = {};

  /* ---------------- desk lamp (warm key light) ---------------- */
  const lampMetal = std(0x18181a, { rough: 0.35, metal: 0.7 });
  const B = [-0.97, TOP, -2.44], E = [-0.93, TOP + 0.6, -2.38], Hd = [-0.64, TOP + 0.6, -2.14];
  cyl(0.075, 0.085, 0.025, lampMetal, { parent, x: B[0], y: TOP + 0.012, z: B[2], cast: true });
  rod([B[0], TOP + 0.02, B[2]], E, 0.008, lampMetal, parent);
  rod(E, Hd, 0.007, lampMetal, parent);
  sphere(0.014, lampMetal, { parent, x: E[0], y: E[1], z: E[2] });
  const target = new THREE.Vector3(-0.52, TOP, -1.98);
  const head = new THREE.Group();
  head.position.set(...Hd);
  parent.add(head);
  head.lookAt(target);
  // shade opens along the head's +z axis (toward the target)
  const shade = lathe([[0.015, 0], [0.04, 0.025], [0.11, 0.15], [0.115, 0.156], [0.044, 0.025], [0.015, 0.005]], std(0x0f0f11, { rough: 0.4, metal: 0.6, side: THREE.DoubleSide }), { parent: head, rx: Math.PI / 2, cast: true });
  const bulb = sphere(0.038, glow(0xffdcb0, 3.0), { parent: head, z: 0.095 });
  bulb.castShadow = false;
  const spot = new THREE.SpotLight(0xffa85a, 12, 0, 1.15, 0.85, 2);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.bias = -0.0008;
  spot.shadow.normalBias = 0.02;
  spot.shadow.camera.near = 0.05;
  spot.shadow.camera.far = 6;
  // sit the light at the mouth of the shade so no geometry is within a few cm of it
  const lampDir = target.clone().sub(new THREE.Vector3(...Hd)).normalize();
  spot.position.set(...Hd).addScaledVector(lampDir, 0.17);
  const spotTarget = new THREE.Object3D();
  spotTarget.position.copy(target);
  parent.add(spot, spotTarget);
  spot.target = spotTarget;
  const bulbLight = new THREE.PointLight(0xffa456, 2.6, 4.2, 2);
  bulbLight.position.set(Hd[0] - 0.04, Hd[1] + 0.05, Hd[2] - 0.05);
  parent.add(bulbLight);
  lights.lamp = spot;
  lights.lampBulb = bulbLight;
  void shade;

  /* ---------------- bottle + can where the photo has them ---------------- */
  {
    const glass = new THREE.MeshStandardMaterial({ color: 0x1c4a24, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.85 });
    const b = lathe([[0, 0], [0.036, 0], [0.037, 0.005], [0.037, 0.17], [0.03, 0.2], [0.014, 0.23], [0.014, 0.27], [0.016, 0.275], [0, 0.275]], glass, { parent, x: 0.7, y: TOP, z: -2.16, seg: 20 });
    b.castShadow = true;
    cyl(0.0375, 0.0375, 0.07, std(0xd8c48a, { rough: 0.6 }), { parent, x: 0.7, y: TOP + 0.09, z: -2.16, seg: 20 });
    cyl(0.016, 0.016, 0.02, std(0x1a1a1a, { rough: 0.4, metal: 0.4 }), { parent, x: 0.7, y: TOP + 0.285, z: -2.16, seg: 12 });
    const canTex = canvasTexture(128, 64, (g, w, h) => {
      g.fillStyle = "#c9c6bd"; g.fillRect(0, 0, w, h);
      g.fillStyle = "#b8231c"; g.fillRect(0, 18, w, 26);
      g.fillStyle = "#f2e8d0"; g.font = "bold 16px Arial"; g.fillText("LAGER", 30, 37);
    });
    cyl(0.033, 0.033, 0.122, std(0xffffff, { rough: 0.3, metal: 0.7, map: canTex }), { parent, x: 0.52, y: TOP + 0.061, z: -2.0, seg: 18, cast: true });
  }

  /* ---------------- speakers ---------------- */
  const spL = speaker(parent, -0.72, -2.43, 0.18);
  const spR = speaker(parent, 0.57, -2.42, -0.18);
  animated.push((t, dt, ctx) => {
    const low = ctx.bands ? ctx.bands[0] : 0;
    const push = 1 + low * 0.18;
    spL.cone.scale.set(1, 1, push);
    spR.cone.scale.set(1, 1, push);
  });

  /* ---------------- MIDI keyboard (decor) ---------------- */
  const kb = group({ parent, x: -0.17, y: TOP, z: -2.06 });
  box(0.52, 0.045, 0.2, std(0x1c1c20, { rough: 0.5 }), { parent: kb, y: 0.022, r: 0.006, cast: true });
  const keyTex = canvasTexture(512, 64, (g, w, h) => {
    g.fillStyle = "#e9e4d8";
    g.fillRect(0, 0, w, h);
    const n = 15;
    for (let i = 1; i < n; i++) { g.fillStyle = "#555"; g.fillRect((i * w) / n, 0, 1.5, h); }
    const blacks = [0, 1, 3, 4, 5, 7, 8, 10, 11, 12];
    for (const b of blacks) { g.fillStyle = "#111"; g.fillRect(((b + 1) * w) / n - 9, 0, 18, h * 0.6); }
  });
  const kbKeys = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.11), std(0xffffff, { map: keyTex, rough: 0.4 }));
  kbKeys.rotation.x = -Math.PI / 2;
  kbKeys.position.set(0, 0.046, 0.035);
  kb.add(kbKeys);
  for (let k = 0; k < 8; k++) cyl(0.008, 0.009, 0.012, std(0x2a2a2e, { rough: 0.4 }), { parent: kb, x: -0.2 + k * 0.03, y: 0.05, z: -0.06 });
  box(0.06, 0.002, 0.025, glow(0x9ad8ff, 0.8), { parent: kb, x: 0.17, y: 0.046, z: -0.06 });
  box(0.025, 0.04, 0.008, std(0x2a2a2e), { parent: kb, x: -0.235, y: 0.06, z: -0.02, rx: -0.2 });

  /* ---------------- CHIPIFY: the monitor ---------------- */
  const mon = group({ parent, x: -0.05, y: TOP, z: -2.44 });
  cyl(0.09, 0.1, 0.012, std(0x1a1a1c, { metal: 0.5, rough: 0.4 }), { parent: mon, y: 0.006, cast: true });
  box(0.035, 0.2, 0.025, std(0x1a1a1c, { metal: 0.5, rough: 0.4 }), { parent: mon, y: 0.11, z: -0.02, cast: true });
  box(0.6, 0.37, 0.03, std(0x0b0b0d, { rough: 0.4 }), { parent: mon, y: 0.33, z: 0.0, r: 0.008, cast: true });
  const dawScreen = new LiveScreen(1024, 600, drawDaw);
  dawScreen.update(null, 0);
  const screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.565, 0.33), new THREE.MeshBasicMaterial({ map: dawScreen.texture, toneMapped: false, color: new THREE.Color(1.15, 1.15, 1.15) }));
  screenMesh.position.set(0, 0.335, 0.0155);
  mon.add(screenMesh);
  const screenLight = new THREE.RectAreaLight(0x8fa8ff, 2.2, 0.56, 0.33);
  screenLight.position.set(-0.05, TOP + 0.335, -2.42);
  screenLight.lookAt(-0.05, TOP + 0.2, 0);
  parent.add(screenLight);
  const chipify = machine({
    id: "chipify",
    label: "CHIPIFY",
    hint: "Turn any song into a 4-channel chiptune",
    zone: "chip",
    root: mon,
    hit: [0.62, 0.42, 0.12],
    hitOffset: [0, 0.32, 0.02],
    focus: { pos: [0, 0.45, 1.25], target: [0, 0.28, 0], hfov: 56 }
  });
  let dawTimer = 0;
  chipify.update = (dt, t) => {
    dawTimer -= dt;
    if (dawTimer > 0) return;
    dawTimer = 1 / 15;
    dawScreen.update(studio.state.chipify, t);
  };
  machines.push(chipify);

  /* ---------------- CHIP-4 sound engine (pad box) ---------------- */
  const mpc = group({ parent, x: 0.29, y: TOP, z: -2.05, ry: -0.12 });
  box(0.29, 0.045, 0.29, std(0x23252b, { rough: 0.5 }), { parent: mpc, y: 0.0225, r: 0.008, cast: true });
  box(0.27, 0.004, 0.27, std(0x2c2f36, { rough: 0.45 }), { parent: mpc, y: 0.046 });
  const pads = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const mat = ledMat(r === 0 ? 0xff5a2a : r === 1 ? 0xff7a2a : r === 2 ? 0xffa03a : 0xff3a4a, 0.25);
      box(0.045, 0.01, 0.045, mat, { parent: mpc, x: -0.075 + c * 0.052, y: 0.052, z: 0.11 - r * 0.052 - 0.05, r: 0.004 });
      pads.push(mat);
    }
  }
  const lcd = new LiveScreen(256, 128, (g, w, h, s, t) => {
    g.fillStyle = "#0d1a12";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#7dffb0";
    g.font = "bold 26px monospace";
    g.fillText("CHIP-4", 12, 32);
    g.font = "18px monospace";
    g.fillStyle = "#4fd08a";
    const name = (s && s.cart) || "insert cart";
    g.fillText(name.slice(0, 20), 12, 62);
    const chip = (s && s.chip) || "NES 2A03";
    g.fillText(chip, 12, 88);
    const lv = (s && s.levels) || [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) {
      g.fillStyle = "#1f3a2a";
      g.fillRect(150 + k * 24, 100, 16, -70);
      g.fillStyle = "#7dffb0";
      g.fillRect(150 + k * 24, 100, 16, -70 * Math.min(1, lv[k] || 0));
    }
    if (s && s.playing) {
      g.fillStyle = "#7dffb0";
      g.fillText("▶", 12, 116);
    }
    void t;
  });
  lcd.update(null, 0);
  const lcdMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.055), new THREE.MeshBasicMaterial({ map: lcd.texture, toneMapped: false }));
  lcdMesh.rotation.x = -Math.PI / 2;
  lcdMesh.position.set(0.075, 0.049, -0.09);
  mpc.add(lcdMesh);
  for (let k = 0; k < 3; k++) cyl(0.011, 0.012, 0.014, std(0x15161a, { rough: 0.4 }), { parent: mpc, x: -0.09 + k * 0.035, y: 0.053, z: -0.1 });
  // a grey cartridge in the slot at the back
  const cart = group({ parent: mpc, y: 0.045, z: -0.14 });
  box(0.12, 0.09, 0.016, std(0x8e8d8a, { rough: 0.6 }), { parent: cart, y: 0.03, cast: true });
  const cartLabel = canvasTexture(256, 160, (g, w, h) => {
    g.fillStyle = "#1a1a1a";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#ffcf3d";
    g.font = "bold 40px monospace";
    g.fillText("CHIP", 20, 60);
    g.fillStyle = "#ff5a7a";
    g.fillText("TUNES", 20, 110);
    g.fillStyle = "#6ff0ff";
    g.fillRect(20, 128, 200, 8);
  });
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.055), std(0xffffff, { map: cartLabel, rough: 0.5 }));
  lab.position.set(0, 0.04, 0.0085);
  cart.add(lab);
  const engine = machine({
    id: "engine",
    label: "CHIP-4 Sound Engine",
    hint: "MIDI → NES / Game Boy / SEGA / SID voices",
    zone: "chip",
    root: mpc,
    hit: [0.32, 0.16, 0.34],
    hitOffset: [0, 0.06, -0.02],
    focus: { pos: [0, 0.6, 0.55], target: [0, 0.03, -0.02], hfov: 52, light: 1.2 }
  });
  let lcdTimer = 0;
  engine.update = (dt, t) => {
    const s = studio.state.engine;
    const lv = s && s.pads;
    for (let i = 0; i < 16; i++) {
      const target = lv ? 0.25 + lv[i] * 3.2 : 0.25 + 0.12 * Math.max(0, Math.sin(t * 1.3 + i * 0.7));
      pads[i].emissiveIntensity += (target - pads[i].emissiveIntensity) * Math.min(1, dt * 18);
    }
    lcdTimer -= dt;
    if (lcdTimer <= 0) { lcdTimer = 1 / 12; lcd.update(s, t); }
  };
  machines.push(engine);


  return { machines, animated, lights, anchors: { lampHead: new THREE.Vector3(...Hd), lampTarget: target.clone() } };
}

/* ------------------------------------------------------------------ */
/* The DAW screen                                                      */
/* ------------------------------------------------------------------ */

const TRACK_COLORS = ["#ff6fb5", "#6ff0ff", "#ffd36f", "#a98aff", "#8aff9c"];

function drawDaw(g, w, h, s, t) {
  g.fillStyle = "#14151c";
  g.fillRect(0, 0, w, h);
  // title bar
  g.fillStyle = "#1e2029";
  g.fillRect(0, 0, w, 44);
  g.fillStyle = "#ff6fb5";
  g.font = "bold 24px 'Helvetica Neue', Arial";
  g.fillText("CHIPIFY", 18, 30);
  g.fillStyle = "#8a8ea8";
  g.font = "18px monospace";
  const title = (s && s.title) || "drop a song in · press record";
  g.fillText(title.slice(0, 48), 140, 29);
  g.fillStyle = s && s.playing ? "#7dffb0" : "#5a5e72";
  g.fillText(s && s.playing ? "● PLAY" : "■ STOP", w - 120, 29);
  // ruler
  g.fillStyle = "#191a22";
  g.fillRect(170, 44, w - 170, 26);
  g.fillStyle = "#4a4e62";
  for (let b = 0; b < 33; b++) {
    const x = 170 + (b * (w - 170)) / 32;
    g.fillRect(x, 58, 1, 12);
    if (b % 4 === 0) { g.font = "14px monospace"; g.fillText(String(b / 4 + 1), x + 3, 56); }
  }
  // tracks
  const names = (s && s.tracks) || ["PULSE 1 · melody", "PULSE 2 · harmony", "TRIANGLE · bass", "NOISE · drums", "ORIGINAL"];
  const lanes = names.length;
  const top = 74, laneH = (h - top - 20) / lanes;
  for (let i = 0; i < lanes; i++) {
    const y = top + i * laneH;
    g.fillStyle = i % 2 ? "#181920" : "#1b1c24";
    g.fillRect(0, y, w, laneH - 2);
    g.fillStyle = "#23252f";
    g.fillRect(0, y, 168, laneH - 2);
    g.fillStyle = TRACK_COLORS[i % TRACK_COLORS.length];
    g.fillRect(0, y, 6, laneH - 2);
    g.fillStyle = "#d8dae8";
    g.font = "17px 'Helvetica Neue', Arial";
    g.fillText(names[i], 16, y + 28);
    // meter
    const lv = s && s.levels ? s.levels[i] || 0 : 0.25 + 0.2 * Math.sin(t * 2 + i);
    g.fillStyle = "#2c2f3a";
    g.fillRect(16, y + laneH - 20, 140, 6);
    g.fillStyle = TRACK_COLORS[i % TRACK_COLORS.length];
    g.fillRect(16, y + laneH - 20, 140 * Math.min(1, lv), 6);
    // regions: real notes if we have them, otherwise a demo arrangement
    const regions = s && s.lanes ? s.lanes[i] : null;
    g.fillStyle = TRACK_COLORS[i % TRACK_COLORS.length];
    if (regions && regions.length) {
      g.globalAlpha = 0.85;
      for (const r of regions) {
        const x = 170 + r[0] * (w - 170), ww = Math.max(2, (r[1] - r[0]) * (w - 170));
        const yy = y + 8 + (1 - (r[2] ?? 0.5)) * (laneH - 26);
        g.fillRect(x, yy, ww, 6);
      }
      g.globalAlpha = 1;
    } else {
      g.globalAlpha = 0.28;
      for (let k = 0; k < 4; k++) {
        const x = 170 + ((k * 8 + (i % 2) * 2) * (w - 170)) / 32;
        g.fillRect(x, y + 6, ((6 - (i % 3)) * (w - 170)) / 32, laneH - 14);
      }
      g.globalAlpha = 0.9;
      for (let k = 0; k < 36; k++) {
        const x = 170 + ((k + 0.2) * (w - 170)) / 36;
        const v = Math.sin(k * (1.7 + i) + i) * 0.5 + 0.5;
        g.fillRect(x, y + 10 + v * (laneH - 32), (w - 170) / 52, 5);
      }
      g.globalAlpha = 1;
    }
  }
  // playhead
  const ph = s && s.progress != null ? s.progress : (t * 0.03) % 1;
  const px = 170 + ph * (w - 170);
  g.fillStyle = "#ffffff";
  g.fillRect(px, 44, 2, h - 44);
  g.fillStyle = "rgba(255,255,255,0.06)";
  g.fillRect(0, h - 20, w, 20);
}
