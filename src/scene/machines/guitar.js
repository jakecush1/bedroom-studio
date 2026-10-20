// A sunburst electric guitar hanging on the wall above the bed, with a
// clip-on tuner glowing on the headstock.
import * as THREE from "three";
import { box, cyl, group, std } from "../kit3d.js";
import { canvasTexture, LiveScreen } from "../textures.js";
import { machine } from "./common.js";

function bodyShape() {
  const s = new THREE.Shape();
  // a strat-ish offset double cutaway, ~0.33 x 0.45 m
  s.moveTo(0.0, -0.235);
  s.bezierCurveTo(0.12, -0.24, 0.175, -0.17, 0.17, -0.07);
  s.bezierCurveTo(0.165, 0.0, 0.12, 0.02, 0.12, 0.06);
  s.bezierCurveTo(0.12, 0.1, 0.16, 0.13, 0.145, 0.19);
  s.bezierCurveTo(0.13, 0.235, 0.085, 0.215, 0.06, 0.17);
  s.bezierCurveTo(0.045, 0.14, 0.03, 0.135, 0.022, 0.15);
  s.lineTo(-0.022, 0.15);
  s.bezierCurveTo(-0.035, 0.13, -0.055, 0.14, -0.07, 0.2);
  s.bezierCurveTo(-0.085, 0.25, -0.135, 0.25, -0.145, 0.2);
  s.bezierCurveTo(-0.155, 0.15, -0.115, 0.1, -0.12, 0.06);
  s.bezierCurveTo(-0.125, 0.02, -0.17, 0.0, -0.17, -0.07);
  s.bezierCurveTo(-0.175, -0.17, -0.12, -0.24, 0.0, -0.235);
  return s;
}

function headShape() {
  const s = new THREE.Shape();
  s.moveTo(-0.021, 0.0);
  s.lineTo(0.021, 0.0);
  s.bezierCurveTo(0.04, 0.03, 0.05, 0.09, 0.045, 0.16);
  s.bezierCurveTo(0.042, 0.19, 0.02, 0.2, 0.0, 0.19);
  s.bezierCurveTo(-0.02, 0.18, -0.03, 0.15, -0.03, 0.1);
  s.bezierCurveTo(-0.03, 0.06, -0.026, 0.03, -0.021, 0.0);
  return s;
}

function remapUV(geo) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const uv = geo.attributes.uv, pos = geo.attributes.position;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (pos.getX(i) - bb.min.x) / (bb.max.x - bb.min.x), (pos.getY(i) - bb.min.y) / (bb.max.y - bb.min.y));
  }
}

export function buildGuitar(parent, studio) {
  const root = group({ parent, x: 1.5, y: 1.13, z: -0.18, ry: -Math.PI / 2 + 0.35, name: "guitar" });

  const burst = canvasTexture(512, 512, (g, w, h) => {
    const grad = g.createRadialGradient(w * 0.5, h * 0.42, 20, w * 0.5, h * 0.45, w * 0.62);
    grad.addColorStop(0, "#f2b23a");
    grad.addColorStop(0.45, "#d8701a");
    grad.addColorStop(0.72, "#7a1e0e");
    grad.addColorStop(0.9, "#1e0805");
    grad.addColorStop(1, "#0a0302");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    for (let k = 0; k < 90; k++) {
      g.strokeStyle = `rgba(80,30,10,${Math.random() * 0.08})`;
      g.beginPath();
      const y = Math.random() * h;
      g.moveTo(0, y);
      g.bezierCurveTo(w * 0.3, y + 10, w * 0.6, y - 10, w, y);
      g.stroke();
    }
  });
  const bodyGeo = new THREE.ExtrudeGeometry(bodyShape(), { depth: 0.042, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 3, curveSegments: 24 });
  remapUV(bodyGeo);
  const body = new THREE.Mesh(bodyGeo, std(0xffffff, { map: burst, rough: 0.22, metal: 0.05 }));
  body.position.z = -0.024;
  body.castShadow = true;
  root.add(body);

  // pickguard
  const pg = new THREE.Shape();
  pg.moveTo(-0.03, 0.15);
  pg.lineTo(0.03, 0.15);
  pg.bezierCurveTo(0.09, 0.12, 0.1, 0.02, 0.07, -0.06);
  pg.bezierCurveTo(0.05, -0.12, -0.02, -0.13, -0.06, -0.1);
  pg.bezierCurveTo(-0.11, -0.06, -0.11, 0.05, -0.08, 0.1);
  pg.bezierCurveTo(-0.06, 0.13, -0.04, 0.15, -0.03, 0.15);
  const pgGeo = new THREE.ExtrudeGeometry(pg, { depth: 0.002, bevelEnabled: false, curveSegments: 16 });
  const pick = new THREE.Mesh(pgGeo, std(0xe9e4d4, { rough: 0.35 }));
  pick.position.z = 0.0245;
  root.add(pick);
  const white = std(0xf2eee2, { rough: 0.4 });
  for (const [py, rz] of [[0.09, 0], [0.025, 0], [-0.045, 0.15]]) box(0.072, 0.017, 0.006, white, { parent: root, y: py, z: 0.029, rz, r: 0.004 });
  const chrome = std(0xd0d0d4, { metal: 1, rough: 0.18 });
  box(0.07, 0.022, 0.008, chrome, { parent: root, y: -0.11, z: 0.028 });
  for (let k = 0; k < 3; k++) cyl(0.009, 0.01, 0.01, white, { parent: root, x: 0.045 + k * 0.012, y: -0.07 - k * 0.028, z: 0.031, rx: Math.PI / 2 });

  // neck + fretboard + frets
  const maple = std(0xb8925e, { rough: 0.45 });
  const rosewood = std(0x2e1a10, { rough: 0.5 });
  box(0.05, 0.47, 0.02, maple, { parent: root, y: 0.385, z: 0.01, cast: true });
  box(0.048, 0.45, 0.006, rosewood, { parent: root, y: 0.385, z: 0.023 });
  const fretMat = std(0xbfbfc4, { metal: 1, rough: 0.25 });
  for (let f = 1; f <= 21; f++) {
    const d = 0.62 * (1 - Math.pow(2, -f / 12));
    const y = 0.61 - d * 0.73;
    if (y < 0.16) break;
    box(0.048, 0.0015, 0.002, fretMat, { parent: root, y, z: 0.0265 });
  }
  const fretY = (f) => 0.61 - 0.62 * (1 - Math.pow(2, -f / 12)) * 0.73;
  const dotMat = std(0xe8e0cc, { rough: 0.4 });
  for (const f of [3, 5, 7, 9, 12, 15]) {
    const y = (fretY(f - 1) + fretY(f)) / 2;
    for (const dx of f === 12 ? [-0.012, 0.012] : [0]) cyl(0.0028, 0.0028, 0.001, dotMat, { parent: root, x: dx, y, z: 0.0262, rx: Math.PI / 2, seg: 10 });
  }
  // headstock
  const hsGeo = new THREE.ExtrudeGeometry(headShape(), { depth: 0.014, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2 });
  const hs = new THREE.Mesh(hsGeo, maple);
  hs.position.set(0, 0.61, 0.006);
  hs.castShadow = true;
  root.add(hs);
  const decal = canvasTexture(128, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.save();
    g.translate(w / 2 + 6, h / 2);
    g.rotate(-Math.PI / 2);
    g.fillStyle = "#1a1a1a";
    g.font = "italic bold 34px Georgia, serif";
    g.textAlign = "center";
    g.fillText("Midnight", 0, 10);
    g.restore();
  });
  const dm = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.09), new THREE.MeshStandardMaterial({ map: decal, transparent: true, roughness: 0.4 }));
  dm.position.set(0.006, 0.72, 0.0225);
  root.add(dm);
  for (let k = 0; k < 6; k++) {
    const y = 0.64 + k * 0.024;
    cyl(0.005, 0.005, 0.016, chrome, { parent: root, x: 0.03 + (k > 3 ? -0.004 * (k - 3) : 0), y, z: 0.024, rx: Math.PI / 2 });
    cyl(0.007, 0.007, 0.012, chrome, { parent: root, x: 0.052, y, z: 0.012, rz: Math.PI / 2 });
  }
  // strings
  const strMat = std(0xe8e8ec, { metal: 1, rough: 0.2 });
  for (let k = 0; k < 6; k++) {
    const x0 = -0.022 + k * 0.0088, x1 = -0.016 + k * 0.0064;
    const a = new THREE.Vector3(x0, -0.11, 0.032), b = new THREE.Vector3(x1, 0.61, 0.028);
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.0004 + (5 - k) * 0.00008, 0.0004 + (5 - k) * 0.00008, a.distanceTo(b), 4), strMat);
    s.position.copy(a).add(b).multiplyScalar(0.5);
    s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    root.add(s);
  }

  // wall hanger
  box(0.06, 0.08, 0.02, std(0x3a2a1a, { rough: 0.6 }), { parent: root, y: 0.62, z: -0.05 });
  cyl(0.004, 0.004, 0.07, std(0x111111, { metal: 0.6 }), { parent: root, x: -0.03, y: 0.6, z: -0.015, rx: Math.PI / 2 });
  cyl(0.004, 0.004, 0.07, std(0x111111, { metal: 0.6 }), { parent: root, x: 0.03, y: 0.6, z: -0.015, rx: Math.PI / 2 });

  // clip-on tuner
  const clip = group({ parent: root, x: -0.01, y: 0.795, z: 0.03 });
  box(0.012, 0.03, 0.03, std(0x111114, { rough: 0.4 }), { parent: clip, y: -0.02, z: -0.02 });
  box(0.046, 0.034, 0.012, std(0x141418, { rough: 0.35 }), { parent: clip, y: 0.012, z: 0.002, r: 0.005 });
  const screen = new LiveScreen(192, 140, (g, w, h, s) => {
    g.fillStyle = "#020608";
    g.fillRect(0, 0, w, h);
    const on = s && s.listening;
    const inTune = s && s.cents != null && Math.abs(s.cents) < 5;
    const col = !on ? "#1c4c5a" : inTune ? "#4dffa0" : "#ff5a5a";
    g.fillStyle = col;
    g.shadowColor = col;
    g.shadowBlur = on ? 12 : 0;
    g.font = "bold 64px 'Helvetica Neue', Arial";
    g.textAlign = "center";
    g.fillText((s && s.note) || "E", w / 2, 82);
    g.shadowBlur = 0;
    for (let k = -5; k <= 5; k++) {
      g.fillStyle = k === 0 ? "#4dffa0" : "#24414a";
      g.fillRect(w / 2 + k * 15 - 4, 108, 8, k === 0 ? 20 : 12);
    }
    if (on && s.cents != null) {
      g.fillStyle = col;
      g.fillRect(w / 2 + Math.max(-5, Math.min(5, s.cents / 10)) * 15 - 3, 100, 6, 32);
    }
  });
  screen.update(null);
  const sm = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.029), new THREE.MeshBasicMaterial({ map: screen.texture, toneMapped: false }));
  sm.position.set(0, 0.012, 0.0085);
  clip.add(sm);

  const m = machine({
    id: "tuner",
    label: "Guitar Tuner",
    hint: "Standard · half-step down (E♭) · drop D …",
    zone: "studio",
    root,
    hit: [0.36, 1.05, 0.12],
    hitOffset: [0, 0.29, 0],
    focus: { pos: [0.0, 0.42, 1.95], target: [0.0, 0.3, 0.0], hfov: 52, light: 2.4 }
  });
  let timer = 0;
  m.update = (dt) => {
    timer -= dt;
    if (timer > 0) return;
    timer = 1 / 20;
    screen.update(studio.state.tuner);
  };
  return { machines: [m], animated: [], lights: {} };
}
