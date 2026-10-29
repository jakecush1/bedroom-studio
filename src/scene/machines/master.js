// MASTER-1: a vintage-style mastering processor on the sideboard, between the
// SCRIBE computer and the turntable. Twin backlit VU meters follow the
// master while it plays (and the room the rest of the time); the LCD shows
// the loudness and what the engineer is doing.
import * as THREE from "three";
import { box, cyl, sphere, group, std } from "../kit3d.js";
import { canvasTexture, LiveScreen } from "../textures.js";
import { machine, ledMat } from "./common.js";
import { SIDEBOARD } from "../room.js";

const TOP = SIDEBOARD.top;
const W = 0.43, H = 0.14, D = 0.27;

function faceplateTexture() {
  return canvasTexture(1024, 334, (g, w, h) => {
    // brushed aluminium
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#d6d3cb");
    grad.addColorStop(0.5, "#c3c0b8");
    grad.addColorStop(1, "#aeaba3");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? "255,255,255" : "0,0,0"},${0.02 + Math.random() * 0.035})`;
      g.fillRect(0, y, w, 1);
    }
    // rack ears + screws
    g.fillStyle = "rgba(0,0,0,0.12)";
    g.fillRect(0, 0, 34, h);
    g.fillRect(w - 34, 0, 34, h);
    for (const x of [17, w - 17]) for (const y of [40, h - 40]) {
      g.fillStyle = "#77746d"; g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill();
      g.strokeStyle = "#3e3c38"; g.lineWidth = 2; g.beginPath(); g.moveTo(x - 6, y); g.lineTo(x + 6, y); g.stroke();
    }
    // meter bezels (the faces sit in front of these)
    g.fillStyle = "#151414";
    for (const x of [62, 330]) { g.fillRect(x - 6, 26, 268 + 12, 170 + 12); }
    // logo + labels
    g.fillStyle = "#1c1b19";
    g.font = "bold 46px 'Helvetica Neue', Arial";
    g.fillText("MASTER-1", 650, 76);
    g.font = "17px 'Helvetica Neue', Arial";
    g.fillText("MASTERING PROCESSOR", 652, 104);
    g.fillStyle = "#b8281c";
    g.fillRect(652, 116, 300, 3);
    g.fillStyle = "#2a2926";
    g.font = "bold 14px 'Helvetica Neue', Arial";
    g.textAlign = "center";
    for (const [x, t] of [[92, "STYLE"], [212, "INTENSITY"], [332, "WIDTH"], [452, "WARMTH"]]) g.fillText(t, x, h - 18);
    g.fillText("ROOM 808 · AUTOMATIC", 800, h - 18);
    g.textAlign = "left";
  });
}

function vuFaceTexture(label) {
  return canvasTexture(512, 320, (g, w, h) => {
    const bg = g.createRadialGradient(w / 2, h * 1.1, 40, w / 2, h * 0.7, w * 0.75);
    bg.addColorStop(0, "#fff3cf");
    bg.addColorStop(1, "#ecd29a");
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h * 1.18, r = h * 0.95;
    const ang = (pos) => -Math.PI / 2 + (pos - 0.5) * 1.6; // matches the needle sweep
    const pos = (vu) => Math.min(1, Math.max(0, (Math.pow(10, vu / 20) - 0.1) / (1.413 - 0.1)));
    // red zone
    g.strokeStyle = "#c8261a";
    g.lineWidth = 14;
    g.beginPath();
    g.arc(cx, cy, r - 7, ang(pos(0)), ang(1));
    g.stroke();
    // scale
    g.strokeStyle = "#2a241a";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy, r, ang(0), ang(1));
    g.stroke();
    g.fillStyle = "#2a241a";
    g.font = "bold 26px 'Helvetica Neue', Arial";
    g.textAlign = "center";
    for (const vu of [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3]) {
      const a = ang(pos(vu));
      const major = [-20, -10, -5, -3, 0, 3].includes(vu);
      const r0 = r, r1 = r + (major ? 22 : 13);
      g.strokeStyle = vu > 0 ? "#c8261a" : "#2a241a";
      g.lineWidth = major ? 4 : 2.5;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      g.stroke();
      if (major) {
        g.fillStyle = vu > 0 ? "#c8261a" : "#2a241a";
        g.fillText(vu > 0 ? `+${vu}` : String(vu), cx + Math.cos(a) * (r + 44), cy + Math.sin(a) * (r + 44) + 9);
      }
    }
    g.fillStyle = "#2a241a";
    g.font = "bold 44px 'Helvetica Neue', Arial";
    g.fillText("VU", cx, h - 52);
    g.font = "20px 'Helvetica Neue', Arial";
    g.fillText(label, cx, h - 24);
    g.textAlign = "left";
  });
}

function drawLcd(g, w, h, s, t) {
  g.fillStyle = "#120c04";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "rgba(255,170,70,0.06)";
  for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
  g.fillStyle = "#ffb04a";
  g.shadowColor = "#ff9a30";
  g.shadowBlur = 8;
  g.font = "bold 34px 'IBM Plex Mono', monospace";
  if (s && s.busy) {
    g.fillText("MASTERING", 12, 40);
    const p = (t * 0.6) % 1;
    g.fillRect(12, 58, (w - 24) * p, 10);
  } else if (s && Number.isFinite(s.lufs)) {
    g.fillText(`${s.lufs.toFixed(1)} LUFS`, 12, 40);
    g.font = "22px 'IBM Plex Mono', monospace";
    g.fillText(`${(s.style || "").toUpperCase()} · ${s.ab === "original" ? "BYPASS" : "MASTER"}`, 12, 78);
  } else {
    g.fillText("READY", 12, 40);
    g.font = "22px 'IBM Plex Mono', monospace";
    g.fillText("DROP A MIX", 12, 78);
  }
  g.shadowBlur = 0;
}

export function buildMaster(parent, studio) {
  const root = group({ parent, x: -1.37, y: TOP, z: -0.36, ry: Math.PI / 2, name: "master1" });
  const chassis = std(0x1c1b1f, { rough: 0.45, metal: 0.5 });
  box(W - 0.01, H - 0.004, D, chassis, { parent: root, y: H / 2, z: -0.006, r: 0.006, cast: true });
  // little feet
  for (const sx of [-0.17, 0.17]) for (const sz of [-0.1, 0.1]) cyl(0.012, 0.012, 0.008, std(0x0d0d0f, { rough: 0.8 }), { parent: root, x: sx, y: 0.004, z: sz });
  // faceplate
  const face = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.01), [
    chassis, chassis, chassis, chassis,
    new THREE.MeshStandardMaterial({ map: faceplateTexture(), roughness: 0.38, metalness: 0.7 }),
    chassis
  ]);
  face.position.set(0, H / 2, D / 2 - 0.001);
  face.castShadow = true;
  face.receiveShadow = true;
  root.add(face);
  const fz = D / 2 + 0.0045; // front surface

  // VU meters: backlit faces, needles on pivots below the window
  const meters = [];
  const meterW = 0.112, meterH = 0.07, meterY = 0.0905;
  [[-0.1327, "LEFT"], [-0.0201, "RIGHT"]].forEach(([x, label]) => {
    const vuMat = new THREE.MeshBasicMaterial({ map: vuFaceTexture(label), color: new THREE.Color(1.25, 1.12, 0.95), toneMapped: true });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(meterW, meterH), vuMat);
    plate.position.set(x, meterY, fz + 0.001);
    root.add(plate);
    const pivot = group({ parent: root, x, y: meterY - meterH * 0.62, z: fz + 0.004 });
    pivot.userData.dynamic = true;   // the needle swings on this pivot
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.0011, meterH * 1.02, 0.0008), std(0x161210, { rough: 0.5 }));
    needle.position.y = meterH * 0.55;
    pivot.add(needle);
    pivot.rotation.z = 0.8;
    // glass
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(meterW + 0.006, meterH + 0.006), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.1 }));
    glass.position.set(x, meterY, fz + 0.007);
    root.add(glass);
    meters.push({ pivot, angle: 0.8, vel: 0, mat: vuMat });
  });

  // knobs: style, intensity, width, warmth
  const knobMat = std(0x111113, { rough: 0.35, metal: 0.3 });
  const knobs = [-0.176, -0.126, -0.076, -0.026].map((x) => {
    const k = group({ parent: root, x, y: 0.03, z: fz, rx: Math.PI / 2 });
    k.userData.dynamic = true;   // turned by the panel's settings
    cyl(0.016, 0.018, 0.016, knobMat, { parent: k, y: 0.008, cast: true });
    cyl(0.012, 0.014, 0.006, std(0x2a2a2e, { rough: 0.3, metal: 0.6 }), { parent: k, y: 0.018 });
    box(0.003, 0.002, 0.012, std(0xf2eee4, { rough: 0.4 }), { parent: k, y: 0.0215, z: 0.005 });
    return k;
  });

  // LCD + power
  const lcd = new LiveScreen(256, 96, drawLcd);
  lcd.update(null, 0);
  const lcdMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.0375), new THREE.MeshBasicMaterial({ map: lcd.texture, toneMapped: false }));
  lcdMesh.position.set(0.128, 0.041, fz + 0.001);
  root.add(lcdMesh);
  box(0.106, 0.044, 0.004, std(0x0b0b0c, { rough: 0.3 }), { parent: root, x: 0.128, y: 0.041, z: fz - 0.0012 });
  const led = ledMat(0xff6a1a, 0.6);
  sphere(0.004, led, { parent: root, x: 0.195, y: 0.11, z: fz + 0.001 });
  box(0.01, 0.018, 0.008, std(0x202022, { rough: 0.4, metal: 0.6 }), { parent: root, x: 0.195, y: 0.085, z: fz + 0.003 });

  const m = machine({
    id: "master",
    label: "MASTER-1",
    hint: "Mastering — Warm / Balanced / Open, loudness targets, reference matching",
    zone: "studio",
    root,
    hit: [0.47, 0.18, 0.31],
    hitOffset: [0, 0.075, 0],
    focus: { pos: [0.02, 0.3, 0.74], target: [0.02, 0.07, 0.04], hfov: 46, light: 1.3 }
  });

  const STYLE_ANGLE = { Warm: -0.9, Balanced: 0, Open: 0.9, Reference: 1.8 };
  const INT_ANGLE = { "-14": -0.9, "-11": 0, "-8.5": 0.9 };
  const toPos = (vu) => Math.min(1.08, Math.max(0, (Math.pow(10, vu / 20) - 0.1) / (1.413 - 0.1)));
  let lcdTimer = 0;
  m.update = (dt, t) => {
    const s = studio.state.master;
    dt = Math.min(dt, 0.05);
    // what the needles follow: the master while it plays, the room otherwise
    let vu = [-40, -40];
    if (s && s.playing) vu = [s.vuL + 12, s.vuR + 12]; // 0 VU ≈ −12 dBFS RMS
    else if (studio.audio.ctx) {
      const lvl = 20 * Math.log10(studio.audio.level() + 1e-6) + 12;
      vu = [lvl, lvl];
    }
    meters.forEach((mt, i) => {
      const target = 0.8 - 1.6 * toPos(vu[i]);
      // a little mass and spring: VU needles overshoot slightly and settle
      const k = 120, c = 18;
      mt.vel += (k * (target - mt.angle) - c * mt.vel) * dt;
      mt.angle += mt.vel * dt;
      mt.angle = Math.max(-0.9, Math.min(0.85, mt.angle));
      mt.pivot.rotation.z = mt.angle;
      const glowAmt = s && s.playing ? 1.32 : 1.18;
      mt.mat.color.setRGB(glowAmt, glowAmt * 0.9, glowAmt * 0.74);
    });
    if (s) {
      const sa = STYLE_ANGLE[s.style] ?? 0, ia = INT_ANGLE[String(s.target)] ?? 0;
      knobs[0].rotation.y += (sa - knobs[0].rotation.y) * Math.min(1, dt * 6);
      knobs[1].rotation.y += (ia - knobs[1].rotation.y) * Math.min(1, dt * 6);
    }
    led.emissiveIntensity = s && s.busy ? 1.5 + Math.sin(t * 9) : s && s.playing ? 2.4 : 0.6;
    lcdTimer -= dt;
    if (lcdTimer <= 0) {
      lcdTimer = 1 / 10;
      lcd.update(s, t);
    }
  };
  return { machines: [m], animated: [], lights: {} };
}
