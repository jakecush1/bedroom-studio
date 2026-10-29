// Left side of the room: a full-size ASTEROIDS cabinet standing on the floor
// between the shelf and the sideboard, and on the sideboard the SCRIBE
// computer (audio → sheet music) and the turntable that tunes into the radio.
import * as THREE from "three";
import { box, cyl, sphere, group, std, glow } from "../kit3d.js";
import { canvasTexture, LiveScreen } from "../textures.js";
import { machine, ledMat } from "./common.js";
import { SIDEBOARD, ARCADE } from "../room.js";
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
/* ASTEROIDS upright cabinet (full size, standing on the floor)         */
/* ------------------------------------------------------------------ */

// Side profile of the cabinet in (depth, height); +depth is the front.
// Back is flat, the control panel juts out, the sides hood the monitor
// and the marquee is set back under the top.
const PROFILE = [[-0.38, 0], [0.38, 0], [0.38, 0.92], [0.42, 0.98], [0.3, 1.1], [0.16, 1.6], [0.22, 1.83], [-0.38, 1.83]];

function profileShape(mirror) {
  const sh = new THREE.Shape();
  PROFILE.forEach(([z, y], i) => (i ? sh.lineTo(mirror ? -z : z, y) : sh.moveTo(mirror ? -z : z, y)));
  sh.closePath();
  return sh;
}

/** Remap ShapeGeometry UVs (which are raw shape coordinates) onto 0..1 of the profile box. */
function profileUVs(geo) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + 0.38) / 0.76, uv.getY(i) / 1.83);
  return geo;
}

function drawSideArt(mirror) {
  return (g, w, h) => {
    const fx = (x) => (mirror ? w - x : x);           // keep the composition's front at the cabinet's front
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#07061a"); grad.addColorStop(0.55, "#0b1a3a"); grad.addColorStop(1, "#040410");
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(255,255,255,${0.25 + rnd() * 0.7})`; const r = rnd() < 0.1 ? 2.5 : 1.5; g.fillRect(rnd() * w, rnd() * h, r, r); }
    // vector rocks, cabinet-art style
    const rock = (cx, cy, r, col, lw) => {
      g.strokeStyle = col; g.lineWidth = lw; g.beginPath();
      for (let k = 0; k < 11; k++) { const a = (k / 11) * Math.PI * 2, rr = r * (0.72 + 0.32 * Math.sin(k * 2.9 + cx)); k ? g.lineTo(fx(cx) + Math.cos(a) * rr, cy + Math.sin(a) * rr) : g.moveTo(fx(cx) + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
      g.closePath(); g.stroke();
      g.strokeStyle = "rgba(143,216,255,0.35)"; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(fx(cx) - r * 0.5, cy - r * 0.2); g.lineTo(fx(cx) + r * 0.2, cy + r * 0.4); g.lineTo(fx(cx) + r * 0.5, cy - r * 0.3); g.stroke();
    };
    rock(110, 250, 78, "#cfeeff", 5);
    rock(290, 420, 52, "#8fd8ff", 4);
    rock(90, 560, 40, "#8fd8ff", 4);
    rock(300, 700, 70, "#cfeeff", 5);
    rock(150, 820, 30, "#8fd8ff", 3);
    // the ship, with a thrust flame
    g.save(); g.translate(fx(230), 560); g.rotate(mirror ? 2.4 : -0.7);
    g.strokeStyle = "#ffffff"; g.lineWidth = 4; g.beginPath(); g.moveTo(34, 0); g.lineTo(-24, 20); g.lineTo(-14, 0); g.lineTo(-24, -20); g.closePath(); g.stroke();
    g.strokeStyle = "#ff9a3c"; g.lineWidth = 3; g.beginPath(); g.moveTo(-18, 8); g.lineTo(-44, 0); g.lineTo(-18, -8); g.stroke();
    g.restore();
    // shots
    g.fillStyle = "#ffffff";
    for (const [x, y] of [[262, 530], [285, 505], [306, 482]]) g.fillRect(fx(x) - 2, y - 2, 4, 4);
    // title down the back edge
    g.save();
    g.translate(fx(60), h / 2); g.rotate(mirror ? Math.PI / 2 : -Math.PI / 2);
    g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "bold 92px 'VT323', 'Courier New', monospace";
    g.lineWidth = 10; g.strokeStyle = "#3a0f5a"; g.strokeText("ASTEROIDS", 0, 0);
    const tg = g.createLinearGradient(-280, 0, 280, 0);
    tg.addColorStop(0, "#ff3a7a"); tg.addColorStop(0.5, "#ffd36f"); tg.addColorStop(1, "#ff3a7a");
    g.fillStyle = tg; g.fillText("ASTEROIDS", 0, 0);
    g.restore();
    // stripes along the bottom
    g.fillStyle = "#ff3a7a"; g.fillRect(0, h - 70, w, 10);
    g.fillStyle = "#ffd36f"; g.fillRect(0, h - 54, w, 6);
    g.fillStyle = "#8fd8ff"; g.fillRect(0, h - 44, w, 3);
  };
}

function drawMarquee(g, w, h) {
  const grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, "#1b0a33"); grad.addColorStop(0.5, "#06283a"); grad.addColorStop(1, "#1b0a33");
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(255,255,255,${0.3 + rnd() * 0.6})`; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
  g.strokeStyle = "#8fd8ff"; g.lineWidth = 4;
  for (const [cx, cy, r] of [[90, 90, 56], [w - 110, 230, 48], [w - 60, 70, 26], [170, 260, 22]]) {
    g.beginPath();
    for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2, rr = r * (0.7 + 0.35 * Math.sin(k * 2.7)); k ? g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
    g.closePath(); g.stroke();
  }
  g.textAlign = "center";
  g.font = "bold 190px 'VT323', 'Courier New', monospace";
  g.lineWidth = 14; g.strokeStyle = "#3a0f5a"; g.strokeText("ASTEROIDS", w / 2, 210);
  g.shadowColor = "#6ff0ff"; g.shadowBlur = 28;
  const tg = g.createLinearGradient(0, 60, 0, 220);
  tg.addColorStop(0, "#ffffff"); tg.addColorStop(0.55, "#9df3ff"); tg.addColorStop(1, "#3fb6ff");
  g.fillStyle = tg; g.fillText("ASTEROIDS", w / 2, 210);
  g.shadowBlur = 0;
  g.font = "bold 34px 'VT323', 'Courier New', monospace"; g.fillStyle = "#ffd36f";
  g.fillText("ROOM 808 AMUSEMENTS", w / 2, 285);
}

function drawBezel(g, w, h) {
  g.fillStyle = "#06060c"; g.fillRect(0, 0, w, h);
  // blue rays from behind the screen
  g.save(); g.translate(w / 2, h * 0.46);
  for (let k = 0; k < 28; k++) {
    g.rotate((Math.PI * 2) / 28);
    g.fillStyle = k % 2 ? "rgba(63,182,255,0.16)" : "rgba(143,216,255,0.07)";
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w, -w * 0.06); g.lineTo(w, w * 0.06); g.closePath(); g.fill();
  }
  g.restore();
  g.fillStyle = "#000"; g.fillRect(w * 0.19, h * 0.11, w * 0.62, h * 0.7);   // behind the tube
  g.strokeStyle = "#3fb6ff"; g.lineWidth = 3; g.strokeRect(w * 0.17, h * 0.09, w * 0.66, h * 0.74);
  g.textAlign = "center"; g.fillStyle = "#cfeeff";
  g.font = "bold 26px 'VT323', 'Courier New', monospace";
  g.fillText("ROTATE  ·  THRUST  ·  FIRE  ·  HYPERSPACE", w / 2, h - 34);
  g.fillStyle = "#ffd36f"; g.font = "bold 20px 'VT323', 'Courier New', monospace";
  g.fillText("1 COIN  1 PLAY", w / 2, h - 12);
}

function drawPanelOverlay(g, w, h) {
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#0b1a3a"); grad.addColorStop(1, "#07061a");
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  g.strokeStyle = "#3fb6ff"; g.lineWidth = 4; g.strokeRect(8, 8, w - 16, h - 16);
  g.fillStyle = "#ffffff"; g.textAlign = "center";
  // label positions follow the buttons placed in buildArcade (x in metres across 0.62, z across 0.30; +z is the front edge)
  const X = (x) => (x / 0.62 + 0.5) * w, Y = (z) => (0.5 + z / 0.3) * h;
  g.font = "bold 16px 'VT323', 'Courier New', monospace";
  for (const [x, t] of [[-0.21, "ROTATE"], [-0.13, "ROTATE"], [0.07, "HYPERSPACE"], [0.15, "THRUST"], [0.23, "FIRE"]]) g.fillText(t, X(x), Y(0.08));
  g.font = "18px 'VT323', 'Courier New', monospace";
  g.fillText("◄", X(-0.21), Y(0.115)); g.fillText("►", X(-0.13), Y(0.115));
  g.fillStyle = "#ffd36f"; g.font = "bold 17px 'VT323', 'Courier New', monospace";
  g.fillText("1 PLAYER", X(-0.055), Y(-0.045)); g.fillText("2 PLAYERS", X(0.055), Y(-0.045));
  g.fillStyle = "#8fd8ff"; g.font = "bold 24px 'VT323', 'Courier New', monospace";
  g.fillText("ASTEROIDS", X(-0.03), Y(0.135));   // on the front strip, under the labels
}

function buildArcade(parent, studio) {
  const { w, d, h } = ARCADE;
  const iw = w - 0.04;                                  // inner width between the side slabs
  const root = group({ parent, x: ARCADE.x, z: ARCADE.z, ry: Math.PI / 2 });   // local +z faces into the room
  const shell = std(0x101016, { rough: 0.5 });
  const trimMat = std(0x2a2a36, { rough: 0.4, metal: 0.3 });
  const black = std(0x050508, { rough: 0.6 });

  // side slabs cut to the cabinet profile, with the art on their outer faces
  const slabGeo = new THREE.ExtrudeGeometry(profileShape(false), { depth: 0.02, bevelEnabled: false });
  for (const sx of [-1, 1]) {
    const slab = new THREE.Mesh(slabGeo, shell);
    slab.rotation.y = -Math.PI / 2;                      // shape depth → local z, extrusion → local -x
    slab.position.x = sx > 0 ? w / 2 : -w / 2 + 0.02;
    slab.castShadow = true;
    root.add(slab);
    const art = new THREE.Mesh(profileUVs(new THREE.ShapeGeometry(profileShape(sx > 0))), std(0xffffff, { map: canvasTexture(384, 928, drawSideArt(sx > 0)), rough: 0.55 }));
    art.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
    art.position.x = sx * (w / 2 + 0.001);
    root.add(art);
  }
  // back, top, kick plate and the lower front
  box(iw, h, 0.02, shell, { parent: root, y: h / 2, z: -d / 2 + 0.01 });
  box(w, 0.03, 0.6, shell, { parent: root, y: h - 0.015, z: -0.08 });
  box(iw, 0.98, 0.02, shell, { parent: root, y: 0.49, z: d / 2 - 0.01, cast: true });
  box(iw, 0.1, 0.01, black, { parent: root, y: 0.05, z: d / 2 - 0.003 });
  // coin door
  box(0.22, 0.3, 0.012, trimMat, { parent: root, y: 0.42, z: d / 2 + 0.004 });
  for (const cx of [-0.05, 0.05]) {
    box(0.03, 0.05, 0.004, black, { parent: root, x: cx, y: 0.5, z: d / 2 + 0.011 });
    box(0.012, 0.035, 0.003, std(0x000000), { parent: root, x: cx, y: 0.5, z: d / 2 + 0.014 });
  }
  box(0.08, 0.05, 0.006, black, { parent: root, y: 0.32, z: d / 2 + 0.011 });
  cyl(0.009, 0.009, 0.006, std(0xd8d4c8, { metal: 0.8, rough: 0.3 }), { parent: root, x: 0.08, y: 0.42, z: d / 2 + 0.012, rx: Math.PI / 2 });
  // control panel: tilted shelf jutting forward, five buttons like the original, two start buttons
  const panel = group({ parent: root, y: 1.0, z: 0.26, rx: 0.22 });
  box(iw + 0.04, 0.05, 0.3, shell, { parent: panel, cast: true });
  const overlay = new THREE.Mesh(new THREE.PlaneGeometry(iw, 0.3), std(0xffffff, { map: canvasTexture(640, 320, drawPanelOverlay), rough: 0.5 }));
  overlay.rotation.x = -Math.PI / 2;
  overlay.position.y = 0.0255;
  panel.add(overlay);
  const cream = std(0xe8e2d0, { rough: 0.35 });
  const fireLed = ledMat(0xff5a4b, 0.5), hyperLed = ledMat(0x6ff0ff, 0.3), startLed = ledMat(0xffd36f, 0.4);
  const button = (x, z, mat, r = 0.016) => {
    cyl(r + 0.004, r + 0.005, 0.008, trimMat, { parent: panel, x, y: 0.028, z });
    cyl(r, r, 0.014, mat, { parent: panel, x, y: 0.036, z });
  };
  button(-0.21, 0.03, cream); button(-0.13, 0.03, cream);
  button(0.07, 0.03, hyperLed); button(0.15, 0.03, cream); button(0.23, 0.03, fireLed);
  button(-0.05, -0.09, startLed, 0.009); button(0.05, -0.09, startLed, 0.009);
  // monitor: a bezel leaning back with a 19" CRT in it
  const hood = group({ parent: root, y: 1.05, z: 0.1, rx: -0.3 });
  box(iw, 0.5, 0.03, black, { parent: hood, y: 0.25, z: -0.015 });
  const bezel = new THREE.Mesh(new THREE.PlaneGeometry(iw - 0.002, 0.5), std(0xffffff, { map: canvasTexture(640, 512, drawBezel), rough: 0.4 }));
  bezel.position.set(0, 0.25, 0.001);
  hood.add(bezel);
  const live = () => studio.state.arcade;
  const demo = new Asteroids();
  let acc = 0;
  const scr = new LiveScreen(512, 384, (g, w2, h2, t) => {
    demo.hi = Math.max(demo.hi, (live() && live().hi) || 0);
    demo.last = live() ? live().last : null;
    demo.render(g, w2, h2, { hi: demo.hi, glow: false, small: true });
    void t;
  });
  const tube = new THREE.PlaneGeometry(0.38, 0.285, 12, 10);   // slight CRT bulge
  const tp = tube.attributes.position;
  for (let i = 0; i < tp.count; i++) { const x = tp.getX(i) / 0.19, y = tp.getY(i) / 0.1425; tp.setZ(i, 0.014 * (1 - 0.5 * (x * x + y * y))); }
  const screen = new THREE.Mesh(tube, new THREE.MeshBasicMaterial({ map: scr.texture, toneMapped: false }));
  screen.position.set(0, 0.27, 0.003);
  screen.userData.keep = true;
  hood.add(screen);
  const glowLight = new THREE.PointLight(0x8fd8ff, 0.7, 1.8, 2);
  glowLight.position.set(0, 0.35, 0.5);
  hood.add(glowLight);
  // marquee: leans forward over the monitor, lit from behind
  const top = group({ parent: root, y: 1.53, z: -0.05, rx: 0.25 });
  box(iw, 0.3, 0.03, shell, { parent: top, y: 0.15, z: -0.015 });
  const marquee = new THREE.Mesh(new THREE.PlaneGeometry(iw - 0.06, 0.2), glow(0xffffff, 1.4, { map: canvasTexture(1024, 330, drawMarquee) }));
  marquee.position.set(0, 0.15, 0.002);
  marquee.userData.keep = true;
  top.add(marquee);
  box(iw, 0.02, 0.04, trimMat, { parent: top, y: 0.04, z: 0.005 });
  box(iw, 0.02, 0.04, trimMat, { parent: top, y: 0.26, z: 0.005 });
  // speaker grille between the marquee and the monitor
  for (let k = 0; k < 7; k++) box(0.16, 0.004, 0.006, black, { parent: top, y: 0.012 + k * 0.004, z: 0.004 });

  const m = machine({
    id: "arcade",
    label: "ASTEROIDS",
    hint: "Full-size upright · rotate, thrust, fire, hyperspace",
    zone: "chip",
    root,
    hit: [w + 0.06, h, d + 0.1],
    hitOffset: [0, h / 2, 0.02],
    // from a little toward the back wall, so the VOX boom stays out of the shot
    focus: { pos: [0.5, 1.42, 1.75], target: [0.05, 1.3, 0.0], hfov: 60 }
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
    glowLight.intensity = 0.65 + Math.random() * 0.1;
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

