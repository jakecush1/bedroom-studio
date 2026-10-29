// VOX-1: a large-diaphragm condenser mic in a shock mount, pop filter in
// front, on a boom stand beside the chair. Click it to sing into the autotune.
import * as THREE from "three";
import { box, cyl, sphere, torus, group, std, glow } from "../kit3d.js";
import { canvasTexture } from "../textures.js";
import { machine, ledMat } from "./common.js";

/** Cylinder spanning two points. */
function rod(a, b, r, mat, parent) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, A.distanceTo(B), 10), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  m.castShadow = true;
  parent.add(m);
  return m;
}

function grilleTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = "#7d7a74";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#2a2826";
    for (let y = 0; y < h; y += 6) for (let x = (y / 6) % 2 ? 3 : 0; x < w; x += 6) g.fillRect(x, y, 3, 3);
  });
}

export function buildVox(parent, studio) {
  // between the chair and the bed, boom reaching over to the chair, so the
  // stand stays out of the arcade cabinet's close-up
  const root = group({ parent, x: 0.0, z: -0.75, ry: -0.9, name: "vox1" });
  const black = std(0x141416, { rough: 0.45, metal: 0.55 });
  const chrome = std(0xb8b8bc, { rough: 0.2, metal: 0.95 });
  // tripod + pole
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.3;
    rod([0, 0.33, 0], [Math.cos(a) * 0.3, 0.012, Math.sin(a) * 0.3], 0.008, black, root);
    sphere(0.012, black, { parent: root, x: Math.cos(a) * 0.3, y: 0.012, z: Math.sin(a) * 0.3 });
  }
  cyl(0.013, 0.013, 1.18, black, { parent: root, y: 0.92, cast: true });
  cyl(0.02, 0.02, 0.05, chrome, { parent: root, y: 0.42 });
  // boom: counterweight behind, mic end forward and up
  const pivot = [0, 1.5, 0];
  const tip = [0.0, 1.6, 0.46];
  rod([0, 1.44, -0.28], tip, 0.0085, black, root);
  cyl(0.026, 0.026, 0.06, black, { parent: root, x: 0, y: 1.44 - 0.004, z: -0.3, rx: Math.PI / 2 - 0.2 });
  sphere(0.022, chrome, { parent: root, x: pivot[0], y: pivot[1], z: pivot[2] - 0.0 });
  // mic hangs from the boom tip in a shock mount
  const mic = group({ parent: root, x: tip[0], y: tip[1] - 0.13, z: tip[2] });
  rod([0, 0.13, 0], [0, 0.085, 0], 0.006, chrome, mic);
  torus(0.042, 0.004, black, { parent: mic, y: 0.02, rx: Math.PI / 2 });
  torus(0.042, 0.004, black, { parent: mic, y: -0.04, rx: Math.PI / 2 });
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    rod([Math.cos(a) * 0.042, 0.02, Math.sin(a) * 0.042], [Math.cos(a) * 0.042, -0.04, Math.sin(a) * 0.042], 0.0025, black, mic);
  }
  const bodyMat = std(0x1d1b19, { rough: 0.35, metal: 0.7 });
  cyl(0.026, 0.024, 0.11, bodyMat, { parent: mic, y: -0.03, cast: true });
  cyl(0.0265, 0.0265, 0.008, std(0xc8a24a, { rough: 0.25, metal: 0.95 }), { parent: mic, y: 0.026 });
  const grille = std(0xffffff, { rough: 0.55, metal: 0.6, map: grilleTexture() });
  cyl(0.027, 0.027, 0.05, grille, { parent: mic, y: 0.055, cast: true });
  sphere(0.027, grille, { parent: mic, y: 0.08, thetaLength: Math.PI / 2 });
  // status LED on the body: glows while the take plays
  const led = ledMat(0xff6030, 0.15);
  sphere(0.0035, led, { parent: mic, y: -0.004, z: 0.026 });
  // pop filter on a gooseneck, between the mic and the singer
  const pf = group({ parent: root, x: 0.0, y: 1.5, z: 0.6 });
  torus(0.07, 0.0035, black, { parent: pf, cast: true });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.068, 32), new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.9, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
  pf.add(mesh);
  const neck = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 1.36, 0.015), new THREE.Vector3(0.02, 1.38, 0.25), new THREE.Vector3(0.01, 1.43, 0.5), new THREE.Vector3(0, 1.43, 0.6)]);
  const gn = new THREE.Mesh(new THREE.TubeGeometry(neck, 24, 0.0035, 6, false), chrome);
  root.add(gn);
  cyl(0.016, 0.016, 0.03, black, { parent: root, y: 1.36 });
  // cable down the stand
  const cable = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 1.43, 0.46), new THREE.Vector3(0.02, 1.3, 0.3), new THREE.Vector3(0.018, 1.0, 0.04), new THREE.Vector3(0.016, 0.4, 0.02), new THREE.Vector3(0.1, 0.01, 0.15), new THREE.Vector3(0.4, 0.005, -0.3)]);
  root.add(new THREE.Mesh(new THREE.TubeGeometry(cable, 60, 0.003, 5, false), std(0x0a0a0b, { rough: 0.6 })));
  // a little "ON AIR" glow strip on the stand base when playing
  const onAir = glow(0xff3a2a, 0.15, { unique: true });
  box(0.05, 0.012, 0.003, onAir, { parent: root, y: 0.44, z: 0.022 });

  const m = machine({
    id: "autotune",
    label: "VOX-1 Autotune",
    hint: "Sing or load a vocal — pitch correction from subtle to hard",
    zone: "studio",
    root,
    hit: [0.24, 0.42, 0.42],
    hitOffset: [0, 1.48, 0.42],
    focus: { pos: [0.55, 1.62, 0.9], target: [0.0, 1.47, 0.48], hfov: 46, light: 1.8 }
  });
  m.update = (dt, t) => {
    const s = studio.state.autotune;
    const on = s && s.playing;
    led.emissiveIntensity = s && s.busy ? 1.2 + Math.sin(t * 9) : on ? 2.6 : 0.15;
    onAir.color.setRGB(on ? 1.6 : 0.25, on ? 0.35 : 0.06, on ? 0.25 : 0.04);
  };
  return { machines: [m], animated: [], lights: {} };
}
