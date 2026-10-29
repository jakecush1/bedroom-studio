// Left side of the room, on the sideboard: a bartop ASTEROIDS cabinet, the
// SCRIBE computer (audio → sheet music) and the turntable that tunes into
// the radio.
import * as THREE from "three";
import { box, cyl, sphere, group, std, glow } from "../kit3d.js";
import { canvasTexture, LiveScreen } from "../textures.js";
import { machine, ledMat } from "./common.js";
import { SIDEBOARD } from "../room.js";
import { Asteroids } from "../../tools/arcade/asteroids.js";

const TOP = SIDEBOARD.top;

/* ------------------------------------------------------------------ */
/* SCRIBE (vintage computer)                                           */
/* ------------------------------------------------------------------ */

function buildScribe(parent, studio) {
  const root = group({ parent, x: -1.37, y: TOP, z: -0.74, ry: Math.PI / 2 });
  const beige = std(0xcdbf9e, { rough: 0.6 });
  const beigeDark = std(0xb3a483, { rough: 0.65 });
  box(0.4, 0.1, 0.34, beige, { parent: root, y: 0.05, r: 0.01, cast: true });
  box(0.16, 0.012, 0.004, std(0x1a1a1a), { parent: root, x: 0.08, y: 0.055, z: 0.171 });
  box(0.03, 0.006, 0.004, ledMat(0x30ff60, 0.8), { parent: root, x: -0.14, y: 0.07, z: 0.171 });
  // CRT
  const crt = group({ parent: root, y: 0.1, z: -0.01 });
  box(0.32, 0.28, 0.26, beige, { parent: crt, y: 0.14, r: 0.02, cast: true });
  box(0.24, 0.2, 0.12, beigeDark, { parent: crt, y: 0.14, z: -0.18, r: 0.02, cast: true });
  box(0.27, 0.215, 0.02, beigeDark, { parent: crt, y: 0.15, z: 0.13, r: 0.01 });
  const term = new LiveScreen(512, 384, drawScribeScreen);
  term.update(null, 0);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.235, 0.176), new THREE.MeshBasicMaterial({ map: term.texture, toneMapped: false }));
  // slight CRT bulge
  const pos = screen.geometry.attributes.position;
  screen.geometry = new THREE.PlaneGeometry(0.235, 0.176, 12, 10);
  const p2 = screen.geometry.attributes.position;
  for (let i = 0; i < p2.count; i++) {
    const x = p2.getX(i) / 0.118, y = p2.getY(i) / 0.088;
    p2.setZ(i, 0.012 * (1 - 0.5 * (x * x + y * y)));
  }
  void pos;
  screen.position.set(0, 0.152, 0.137);
  crt.add(screen);
  const glowLight = new THREE.PointLight(0x5cff8a, 0.6, 1.4, 2);
  glowLight.position.set(0, 0.16, 0.35);
  crt.add(glowLight);
  // keyboard on the front edge
  box(0.36, 0.022, 0.1, beige, { parent: root, y: 0.011, z: 0.24, rx: 0.06, cast: true });
  const keyTex = canvasTexture(256, 64, (g, w, h) => {
    g.fillStyle = "#b8aa8a";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#6a5a44";
    for (let r = 0; r < 4; r++) for (let c = 0; c < 14; c++) g.fillRect(4 + c * 18 + r * 3, 4 + r * 15, 14, 11);
  });
  const keys = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.085), std(0xffffff, { map: keyTex, rough: 0.6 }));
  keys.rotation.x = -Math.PI / 2 + 0.06;
  keys.position.set(0, 0.0225, 0.24);
  root.add(keys);
  // floppies
  for (let k = 0; k < 3; k++) box(0.09, 0.003, 0.09, std([0x202020, 0x2a3a6a, 0x6a2a2a][k], { rough: 0.5 }), { parent: root, x: 0.24, y: 0.0015 + k * 0.0032, z: 0.05, ry: k * 0.2 });

  const m = machine({
    id: "scribe",
    label: "SCRIBE",
    hint: "Audio → sheet music · hum, play or drop a song",
    zone: "studio",
    root,
    hit: [0.42, 0.42, 0.46],
    hitOffset: [0, 0.2, 0.04],
    focus: { pos: [0, 0.48, 1.05], target: [0, 0.22, 0], hfov: 54 }
  });
  let timer = 0;
  m.update = (dt, t) => {
    timer -= dt;
    if (timer > 0) return;
    timer = 1 / 12;
    term.update(studio.state.scribe, t);
    glowLight.intensity = 0.5 + Math.random() * 0.08;
  };
  return m;
}

function drawScribeScreen(g, w, h, s, t) {
  g.fillStyle = "#e9e1c8";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#2a2418";
  g.font = "bold 20px 'VT323', 'Courier New', monospace";
  g.fillText(((s && s.title) || "SCRIBE 1.0  —  hum me a tune").slice(0, 40), 16, 28);
  if (s && s.line) { g.font = "16px 'VT323', 'Courier New', monospace"; g.fillText(s.line, 16, 48); g.font = "bold 20px 'VT323', 'Courier New', monospace"; }
  // two staves
  const notes = (s && s.preview) || [67, 69, 71, 72, 74, 72, 71, 69, 67, 64, 65, 67, 69, 67, 65, 64];
  for (let staff = 0; staff < 2; staff++) {
    const top = 70 + staff * 150;
    g.strokeStyle = "#3a3224";
    g.lineWidth = 1.5;
    for (let l = 0; l < 5; l++) { g.beginPath(); g.moveTo(16, top + l * 14); g.lineTo(w - 16, top + l * 14); g.stroke(); }
    g.font = "48px serif";
    g.fillText("𝄞", 18, top + 50);
    const per = 8;
    for (let k = 0; k < per; k++) {
      const m = notes[(staff * per + k) % notes.length];
      const step = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6][m % 12] + 7 * (Math.floor(m / 12) - 5);
      const y = top + 56 - step * 7;
      const x = 80 + k * ((w - 110) / per);
      const lit = s && s.playing && s.at === staff * per + k;
      g.fillStyle = lit ? "#c0302a" : "#1e1a12";
      g.beginPath();
      g.ellipse(x, y, 7, 5, -0.4, 0, Math.PI * 2);
      g.fill();
      g.fillRect(x + 6, y - 34, 1.6, 34);
      if (k % 4 === 3) { g.fillRect(x + 24, top, 1.5, 56); }
    }
  }
  if (s && s.busy) {
    g.fillStyle = "#2a2418";
    g.fillText(`listening… ${Math.round((s.progress || 0) * 100)}%`, 16, h - 18);
  } else if (Math.floor(t * 2) % 2 === 0) g.fillRect(16, h - 30, 10, 16);
  g.fillStyle = "rgba(0,0,0,0.07)";
  for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
}

/* ------------------------------------------------------------------ */
/* ASTEROIDS bartop cabinet                                            */
/* ------------------------------------------------------------------ */

function buildArcade(parent, studio) {
  const root = group({ parent, x: -1.37, y: TOP, z: -1.36, ry: Math.PI / 2 });
  const shell = std(0x15151c, { rough: 0.45 });
  const trimMat = std(0x2a2a36, { rough: 0.4, metal: 0.3 });
  // body: a lower box, a hood leaning back, the sloped control panel
  box(0.36, 0.24, 0.34, shell, { parent: root, y: 0.12, r: 0.008, cast: true });
  const hood = group({ parent: root, y: 0.24, z: -0.03, rx: -0.14 });
  box(0.36, 0.24, 0.26, shell, { parent: hood, y: 0.12, r: 0.008, cast: true });
  box(0.36, 0.04, 0.12, shell, { parent: root, y: 0.255, z: 0.12, rx: -0.3, cast: true });
  // side art
  const art = canvasTexture(256, 384, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#1a0b2e"); grad.addColorStop(1, "#061a2a");
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.6})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    g.strokeStyle = "#8fd8ff"; g.lineWidth = 3;
    for (const [cx, cy, r] of [[70, 110, 46], [180, 250, 34], [120, 320, 20]]) {
      g.beginPath();
      for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2, rr = r * (0.7 + 0.35 * Math.sin(k * 2.7)); k ? g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
      g.closePath(); g.stroke();
    }
    g.fillStyle = "#ff3a7a"; g.font = "bold 44px 'VT323', monospace"; g.textAlign = "center";
    g.fillText("ASTEROIDS", w / 2, h - 30);
    g.fillStyle = "#ffd36f"; g.fillRect(16, h - 18, w - 32, 4);
  });
  for (const sx of [-0.181, 0.181]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.235), std(0xffffff, { map: art, rough: 0.6 }));
    side.position.set(sx, 0.12, 0);
    side.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
    root.add(side);
  }
  // marquee
  const marqueeTex = canvasTexture(512, 96, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, "#1b0a33"); grad.addColorStop(0.5, "#06283a"); grad.addColorStop(1, "#1b0a33");
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    g.fillStyle = "#9df3ff"; g.font = "bold 64px 'VT323', monospace"; g.textAlign = "center";
    g.shadowColor = "#6ff0ff"; g.shadowBlur = 14;
    g.fillText("ASTEROIDS", w / 2, 68);
  });
  const marquee = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.062), glow(0xffffff, 1.5, { map: marqueeTex }));
  marquee.position.set(0, 0.19, 0.137);   // just proud of the trim
  marquee.userData.keep = true;
  hood.add(marquee);
  box(0.36, 0.075, 0.03, trimMat, { parent: hood, y: 0.19, z: 0.12 });
  // bezel + screen (the attract mode runs on it)
  box(0.3, 0.17, 0.012, std(0x08080b, { rough: 0.3 }), { parent: hood, y: 0.06, z: 0.126 });
  const live = () => studio.state.arcade;
  const demo = new Asteroids();
  let acc = 0;
  const scr = new LiveScreen(320, 240, (g, w, h, t) => {
    demo.hi = Math.max(demo.hi, (live() && live().hi) || 0);
    demo.last = live() ? live().last : null;
    demo.render(g, w, h, { hi: demo.hi, glow: false, small: true });
    void t;
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.236, 0.154), new THREE.MeshBasicMaterial({ map: scr.texture, toneMapped: false }));
  screen.position.set(0, 0.062, 0.133);
  screen.userData.keep = true;
  hood.add(screen);
  const glowLight = new THREE.PointLight(0x8fd8ff, 0.45, 1.3, 2);
  glowLight.position.set(0, 0.1, 0.4);
  hood.add(glowLight);
  // speaker grille under the marquee
  for (let k = 0; k < 6; k++) box(0.12, 0.003, 0.004, std(0x05050a), { parent: hood, y: 0.146 + k * 0.006, z: 0.128 });
  // control panel: joystick, two buttons, a start button
  const panel = group({ parent: root, y: 0.275, z: 0.12, rx: -0.3 });
  cyl(0.005, 0.007, 0.036, std(0x1a1a1a, { rough: 0.4 }), { parent: panel, x: -0.09, y: 0.018 });
  sphere(0.012, std(0xd8382c, { rough: 0.25 }), { parent: panel, x: -0.09, y: 0.04 });
  cyl(0.018, 0.02, 0.006, trimMat, { parent: panel, x: -0.09, y: 0.003 });
  const fireLed = ledMat(0xff5a4b, 0.5), hyperLed = ledMat(0x6ff0ff, 0.3), startLed = ledMat(0xffd36f, 0.4);
  cyl(0.016, 0.017, 0.012, fireLed, { parent: panel, x: 0.03, y: 0.006 });
  cyl(0.016, 0.017, 0.012, hyperLed, { parent: panel, x: 0.08, y: 0.006, z: -0.025 });
  box(0.028, 0.008, 0.014, startLed, { parent: panel, x: 0.0, y: 0.004, z: 0.04 });
  // coin door
  box(0.08, 0.06, 0.004, trimMat, { parent: root, y: 0.07, z: 0.172 });
  box(0.03, 0.004, 0.003, std(0x000000), { parent: root, y: 0.085, z: 0.175 });
  box(0.012, 0.012, 0.003, std(0xd8d4c8), { parent: root, x: -0.02, y: 0.06, z: 0.175 });
  // feet
  for (const [fx, fz] of [[-0.15, -0.14], [0.15, -0.14], [-0.15, 0.14], [0.15, 0.14]]) cyl(0.012, 0.012, 0.01, std(0x0a0a0c), { parent: root, x: fx, y: -0.004, z: fz });

  const m = machine({
    id: "arcade",
    label: "ASTEROIDS",
    hint: "Bartop arcade · rotate, thrust, fire, hyperspace",
    zone: "chip",
    root,
    hit: [0.4, 0.56, 0.4],
    hitOffset: [0, 0.27, 0],
    focus: { pos: [0, 0.5, 0.98], target: [0, 0.3, 0.02], hfov: 50 }
  });
  let timer = 0;
  m.update = (dt, t) => {
    acc += dt;
    timer -= dt;
    const l = live();
    const playing = l && l.mode === "play";
    fireLed.emissiveIntensity = playing ? 1.8 : 0.5 + 0.3 * Math.max(0, Math.sin(t * 2.1));
    startLed.emissiveIntensity = playing ? 0.3 : (Math.sin(t * 3) > 0 ? 1.6 : 0.3);
    if (timer > 0) return;
    timer = 1 / 15;
    demo.step(acc);
    acc = 0;
    scr.update(t);
    glowLight.intensity = 0.4 + Math.random() * 0.08;
  };
  return m;
}

/* ------------------------------------------------------------------ */
/* Turntable (Room 808 FM)                                             */
/* ------------------------------------------------------------------ */

function buildTurntable(parent, studio) {
  const root = group({ parent, x: -1.36, y: TOP, z: 0.12, ry: Math.PI / 2 });
  const walnut = std(0x5a3720, { rough: 0.45 });
  box(0.45, 0.09, 0.36, walnut, { parent: root, y: 0.045, r: 0.01, cast: true });
  box(0.44, 0.006, 0.35, std(0x1a1a1c, { rough: 0.4, metal: 0.5 }), { parent: root, y: 0.093 });
  const platter = group({ parent: root, x: -0.05, y: 0.1, z: 0.0 });
  platter.userData.dynamic = true;   // spins while the radio plays
  cyl(0.15, 0.15, 0.014, std(0x9a9aa0, { metal: 0.9, rough: 0.25 }), { parent: platter, y: 0.007, seg: 48 });
  const grooves = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = "#0b0b0c";
    g.fillRect(0, 0, w, h);
    for (let r = 250; r > 70; r -= 2) {
      g.strokeStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.04})`;
      g.beginPath();
      g.arc(w / 2, h / 2, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = "#c8302a";
    g.beginPath();
    g.arc(w / 2, h / 2, 68, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#f2e6c8";
    g.font = "bold 22px Arial";
    g.textAlign = "center";
    g.fillText("ROOM 808 FM", w / 2, h / 2 - 18);
    g.font = "16px Arial";
    g.fillText("side A · 33⅓", w / 2, h / 2 + 30);
    g.fillStyle = "#111";
    g.beginPath();
    g.arc(w / 2, h / 2, 6, 0, Math.PI * 2);
    g.fill();
  });
  const record = new THREE.Mesh(new THREE.CylinderGeometry(0.146, 0.146, 0.003, 64), [std(0x0b0b0c, { rough: 0.3 }), std(0xffffff, { map: grooves, rough: 0.28, metal: 0.2 }), std(0x0b0b0c)]);
  record.position.y = 0.016;
  platter.add(record);
  cyl(0.004, 0.004, 0.03, std(0xc0c0c0, { metal: 1, rough: 0.2 }), { parent: platter, y: 0.025 });
  // tonearm
  const armBase = group({ parent: root, x: 0.16, y: 0.096, z: -0.12 });
  cyl(0.025, 0.028, 0.02, std(0x2a2a2e, { metal: 0.8, rough: 0.3 }), { parent: armBase, y: 0.01 });
  const arm = group({ parent: armBase, y: 0.035 });
  arm.userData.dynamic = true;       // swings onto the record
  box(0.007, 0.007, 0.23, std(0xc8c8cc, { metal: 1, rough: 0.2 }), { parent: arm, z: 0.1, rx: 0.03 });
  box(0.02, 0.012, 0.035, std(0x1a1a1a), { parent: arm, y: -0.006, z: 0.225 });
  cyl(0.014, 0.014, 0.03, std(0x2a2a2e, { metal: 0.8 }), { parent: arm, z: -0.03, rx: Math.PI / 2 });
  // speed buttons + strobe dot
  for (let k = 0; k < 2; k++) box(0.025, 0.008, 0.014, std(0x2a2a2e, { metal: 0.6 }), { parent: root, x: 0.15 + k * 0.03, y: 0.098, z: 0.14 });
  const strobe = ledMat(0xff3a2a, 0.3);
  sphere(0.005, strobe, { parent: root, x: 0.19, y: 0.096, z: 0.08 });
  // dust cover, open
  const cover = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.07, 0.35), new THREE.MeshStandardMaterial({ color: 0x9aa0b0, transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0.1, depthWrite: false }));
  const hinge = group({ parent: root, y: 0.095, z: -0.18, rx: -1.25 });
  cover.position.set(0, 0.035, 0.175);
  hinge.add(cover);

  const m = machine({
    id: "radio",
    label: "ROOM 808 FM",
    hint: "Local & national radio, streamed into the room",
    zone: "studio",
    root,
    hit: [0.48, 0.2, 0.4],
    hitOffset: [0, 0.08, 0],
    focus: { pos: [0, 0.75, 0.75], target: [0, 0.08, 0], hfov: 54 }
  });
  let armAngle = 0;
  m.update = (dt) => {
    const s = studio.state.radio;
    const playing = !!(s && s.playing);
    if (playing) platter.rotation.y -= dt * (33.333 / 60) * Math.PI * 2;
    const target = playing ? -0.42 : 0;
    armAngle += (target - armAngle) * Math.min(1, dt * 2.5);
    arm.rotation.y = armAngle;
    strobe.emissiveIntensity = playing ? 2.2 : 0.3;
  };
  return m;
}

export function buildSideboard(parent, studio) {
  const machines = [buildArcade(parent, studio), buildScribe(parent, studio), buildTurntable(parent, studio)];
  return { machines, animated: [], lights: {} };
}

