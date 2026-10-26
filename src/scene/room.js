// The bedroom: shell, window + balcony fence, furniture, decor and the
// practical lights. Layout follows the reference images in /reference:
// desk under the big window, shelving and a sideboard with the turntable on
// the left, the synth stand (JC-808) and the bed on the right, Persian runner.
import * as THREE from "three";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { box, cyl, sphere, plane, lathe, tube, torus, group, std, glow } from "./kit3d.js";
import {
  darkWoodTexture, rugTexture, fabricTexture, grimeTexture,
  wavePosterTexture, tokyoPosterTexture, moonPosterTexture, jcPosterTexture, chipPosterTexture,
  photoTexture, canvasTexture, rng
} from "./textures.js";
import { pbr, withGrime } from "./materials.js";

export const ROOM = { x0: -1.6, x1: 1.6, z0: -2.6, z1: 2.6, h: 2.7 };
export const WIN = { x0: -0.72, x1: 1.32, y0: 1.0, y1: 2.42 };
export const DESK = { x0: -1.06, x1: 0.8, z0: -2.58, z1: -1.86, top: 0.76 };
export const SIDEBOARD = { x0: -1.6, x1: -1.12, z0: -1.72, z1: 0.55, top: 0.78 };
export const BED = { x0: 0.32, x1: 1.6, z0: -0.95, z1: 1.45 };

const WALL_T = 0.16;

/**
 * Plane with world-scaled UVs (so tiled scans line up across pieces) and a
 * second "uvGrime" set spanning the whole wall (wallW × wallH) for the grime map.
 */
function wallPlane(w, h, mat, tile, u0, v0, p, wallW = w, wallH = h) {
  const geo = new THREE.PlaneGeometry(w, h);
  const uv = geo.attributes.uv;
  const g = new Float32Array(uv.count * 2);
  for (let i = 0; i < uv.count; i++) {
    const lu = uv.getX(i), lv = uv.getY(i);
    g[i * 2] = (u0 + lu * w) / wallW;
    g[i * 2 + 1] = (v0 + lv * h) / wallH;
    uv.setXY(i, (u0 + lu * w) / tile, (v0 + lv * h) / tile);
  }
  geo.setAttribute("uvGrime", new THREE.BufferAttribute(g, 2));
  const m = new THREE.Mesh(geo, mat);
  m.position.set(p.x, p.y, p.z);
  m.rotation.set(p.rx || 0, p.ry || 0, 0);
  m.receiveShadow = true;
  return m;
}

/** Thin shadow-only slab behind a wall plane (keeps the window light inside the frame). */
const blockerMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
function blocker(w, h, d, p, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), blockerMat);
  m.position.set(p.x, p.y, p.z);
  m.castShadow = true;
  m.receiveShadow = false;
  parent.add(m);
  return m;
}

function leafShape() {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.02, 0.015, 0.03, 0.045, 0, 0.07);
  s.bezierCurveTo(-0.03, 0.045, -0.02, 0.015, 0, 0);
  return new THREE.ShapeGeometry(s, 4);
}
const LEAF_GEO = leafShape();

/** Trailing pothos: vines hanging from a point with leaves along them. */
export function pothos(parent, x, y, z, { vines = 6, len = 0.9, seed = 1, spread = 0.25, dir = [1, 0] } = {}) {
  const rand = rng(seed);
  const g = group({ x, y, z, parent });
  const leafMat = std(0x2f5a2a, { rough: 0.6, side: THREE.DoubleSide });
  const leafMat2 = std(0x406f32, { rough: 0.6, side: THREE.DoubleSide });
  const stemMat = std(0x3a4a22, { rough: 0.8 });
  for (let v = 0; v < vines; v++) {
    const pts = [];
    const L = len * (0.4 + rand() * 0.8);
    const dx = (rand() - 0.5) * spread + dir[0] * 0.08, dz = (rand() - 0.5) * spread + dir[1] * 0.08;
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      pts.push([dx * Math.sin(t * 1.6) + (rand() - 0.5) * 0.03, -t * L, dz * Math.sin(t * 1.6) + (rand() - 0.5) * 0.03]);
    }
    tube(pts, 0.004, stemMat, { parent: g, segments: 24, radial: 4 });
    const n = Math.floor(L * 22);
    const curve = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(...q)));
    for (let k = 0; k < n; k++) {
      const p = curve.getPoint(k / n);
      const leaf = new THREE.Mesh(LEAF_GEO, rand() < 0.5 ? leafMat : leafMat2);
      leaf.position.copy(p);
      leaf.rotation.set(rand() * 2 - 1 + 0.8, rand() * Math.PI * 2, rand() * 2 - 1);
      leaf.scale.setScalar(0.7 + rand() * 0.9);
      g.add(leaf);
    }
  }
  for (let k = 0; k < 18; k++) {
    const leaf = new THREE.Mesh(LEAF_GEO, k % 2 ? leafMat : leafMat2);
    leaf.position.set((rand() - 0.5) * 0.16, rand() * 0.06, (rand() - 0.5) * 0.16);
    leaf.rotation.set(-0.6 - rand(), rand() * Math.PI * 2, 0);
    leaf.scale.setScalar(1 + rand() * 0.6);
    g.add(leaf);
  }
  return g;
}

/** Upright potted plant. */
export function pottedPlant(parent, x, y, z, { h = 0.45, seed = 2, pot = 0x6b4a36, leaves = 22, potR = 0.09 } = {}) {
  const rand = rng(seed);
  const g = group({ x, y, z, parent });
  lathe([[0, 0], [potR * 0.8, 0], [potR, potR * 1.4], [potR * 1.08, potR * 1.5], [potR * 0.95, potR * 1.5], [0, potR * 1.35]], std(pot, { rough: 0.85 }), { parent: g, cast: true });
  const stem = std(0x3b4a25);
  const leafMat = std(0x34602d, { rough: 0.55, side: THREE.DoubleSide });
  for (let i = 0; i < 5; i++) {
    const a = rand() * Math.PI * 2, r = rand() * 0.06;
    tube([[0, potR * 1.3, 0], [Math.cos(a) * r * 0.5, h * 0.5, Math.sin(a) * r * 0.5], [Math.cos(a) * r, h * (0.7 + rand() * 0.3), Math.sin(a) * r]], 0.005, stem, { parent: g, segments: 12, radial: 4 });
  }
  for (let i = 0; i < leaves; i++) {
    const leaf = new THREE.Mesh(LEAF_GEO, leafMat);
    const a = rand() * Math.PI * 2, r = 0.02 + rand() * 0.12;
    leaf.position.set(Math.cos(a) * r, potR * 1.4 + h * (0.25 + rand() * 0.75), Math.sin(a) * r);
    leaf.rotation.set(-0.3 - rand() * 1.0, a + Math.PI / 2, (rand() - 0.5) * 0.6);
    leaf.scale.setScalar(1.6 + rand() * 1.6);
    leaf.castShadow = true;
    g.add(leaf);
  }
  return g;
}

export function mug(parent, x, y, z, color = 0xd8d0c0, ry = 0) {
  const g = group({ x, y, z, ry, parent });
  const m = std(color, { rough: 0.35 });
  lathe([[0, 0], [0.038, 0], [0.04, 0.005], [0.041, 0.095], [0.037, 0.095], [0.035, 0.012], [0, 0.012]], m, { parent: g, cast: true });
  torus(0.024, 0.006, m, { parent: g, x: 0.045, y: 0.05, rz: Math.PI / 2, rx: Math.PI / 2 });
  cyl(0.035, 0.035, 0.002, std(0x2a1608, { rough: 0.2 }), { parent: g, y: 0.075 });
  return g;
}

export function bottle(parent, x, y, z, color = 0x1f5a2a, h = 0.25) {
  const glass = new THREE.MeshStandardMaterial({ color, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.8 });
  const s = h / 0.25;
  const b = lathe([[0, 0], [0.033, 0], [0.034, 0.005], [0.034, 0.15 * s], [0.026, 0.18 * s], [0.012, 0.205 * s], [0.012, 0.245 * s], [0.014, 0.25 * s], [0, 0.25 * s]], glass, { parent, x, y, z, seg: 20 });
  b.castShadow = true;
  cyl(0.0345, 0.0345, 0.06 * s, std(0xd9c79a, { rough: 0.6 }), { parent, x, y: y + 0.08 * s, z, seg: 20 });
  return b;
}

export function can(parent, x, y, z, color = 0xc8102e, { tipped = false, ry = 0 } = {}) {
  const tex = canvasTexture(128, 64, (g, w, h) => {
    g.fillStyle = `#${new THREE.Color(color).getHexString()}`;
    g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(255,255,255,0.85)";
    g.fillRect(0, h * 0.42, w, 6);
  });
  const m = std(0xffffff, { rough: 0.35, metal: 0.6, map: tex });
  return cyl(0.033, 0.033, 0.122, m, { parent, x, y: y + (tipped ? 0.033 : 0.061), z, rz: tipped ? Math.PI / 2 : 0, ry, seg: 18, cast: true });
}

export function bookStack(parent, x, y, z, n, seed, { ry = 0, upright = false, width = 0.6 } = {}) {
  const rand = rng(seed);
  const cols = [0x5a2a22, 0x23384f, 0x3f4a2a, 0x6a5a3a, 0x2a2a32, 0x7a3a1a, 0x4a3a5a, 0xa08a5a];
  const g = group({ x, y, z, ry, parent });
  let off = 0;
  for (let i = 0; i < n; i++) {
    const mat = std(cols[(rand() * cols.length) | 0], { rough: 0.8 });
    if (upright) {
      const t = 0.025 + rand() * 0.035, h = 0.17 + rand() * 0.1, d = 0.13 + rand() * 0.06;
      if (off + t > width) break;
      box(t, h, d, mat, { parent: g, x: off + t / 2, y: h / 2, rz: rand() < 0.1 ? 0.15 : 0, cast: true });
      off += t + 0.002;
    } else {
      const t = 0.025 + rand() * 0.03, w = 0.16 + rand() * 0.08, d = 0.22 + rand() * 0.06;
      box(w, t, d, mat, { parent: g, y: off + t / 2, ry: (rand() - 0.5) * 0.4, cast: true });
      off += t;
    }
  }
  return g;
}

function jar(parent, x, y, z, color = 0xb8c8b0, h = 0.14) {
  const glass = new THREE.MeshStandardMaterial({ color, roughness: 0.15, transparent: true, opacity: 0.55 });
  lathe([[0, 0], [0.045, 0], [0.047, 0.01], [0.047, h * 0.85], [0.035, h * 0.92], [0.035, h], [0, h]], glass, { parent, x, y, z, seg: 18 });
  cyl(0.037, 0.037, 0.02, std(0x6a5a3a, { metal: 0.5, rough: 0.4 }), { parent, x, y: y + h, z });
}

function poster(parent, tex, w, h, p) {
  const m = plane(w, h, std(0xffffff, { rough: 0.85, map: tex }), { ...p, parent });
  m.receiveShadow = true;
  const pos = m.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / w + 0.5, v = pos.getY(i) / h + 0.5;
    pos.setZ(i, Math.max(0, (u - 0.75) * (0.25 - v)) * 0.06);
  }
  m.geometry.computeVertexNormals();
  return m;
}

/** Cloth draped over a support function (duvet, shirts, jacket). */
function drapedCloth(w, d, support, mat, seed, { segs = 48, noise = 0.025, creases = 0 } = {}) {
  const rand = rng(seed);
  const geo = new THREE.PlaneGeometry(w, d, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const phases = Array.from({ length: 6 }, () => [rand() * 6, rand() * 6, 3 + rand() * 9, 3 + rand() * 9]);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    let y = support(x, z);
    let wob = 0;
    for (const [px, pz, fx, fz] of phases) wob += Math.sin(x * fx + px) * Math.sin(z * fz + pz);
    // sharp ridged creases, like slept-in sheets
    let cr = 0;
    if (creases) for (const [px, pz, fx, fz] of phases) cr += 1 - Math.abs(Math.sin(x * fx * 1.7 + z * fz * 0.6 + px * 3 + pz));
    pos.setY(i, y + wob * noise + cr * creases * 0.25);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/* ------------------------------------------------------------------ */

export function buildRoom(scene) {
  RectAreaLightUniformsLib.init();
  const room = group({ name: "room", parent: scene });
  const lights = {};
  const animated = [];
  const anchors = {};

  /* ---------------- shell ---------------- */
  const W = ROOM.x1 - ROOM.x0, D = ROOM.z1 - ROOM.z0, H = ROOM.h;
  const plaster = (seed, opts = {}) => withGrime(
    pbr("plaster", { color: opts.color ?? 0xfff2da, normalScale: 1.4 }),
    grimeTexture({ seed, dark: 0.72, nicotine: 0.8, ...opts.grime })
  );
  const backMat = plaster(11, { grime: { w: 1024, h: 864, window: { x0: (WIN.x0 - ROOM.x0) / W, x1: (WIN.x1 - ROOM.x0) / W, y0: WIN.y0 / H, y1: WIN.y1 / H } } });
  const leftMat = plaster(12, { grime: { w: 1536, h: 800 } });
  const rightMat = plaster(13, { grime: { w: 1536, h: 800, dark: 0.85 } });
  const frontMat = plaster(14, { grime: { w: 1024, h: 864 } });
  const ceilMat = plaster(15, { color: 0x6e604e, grime: { w: 1024, h: 1536, nicotine: 1.2, rub: false, dark: 1.0 } });

  const floorMat = pbr("floor", { color: 0xa48876, repeat: [2.2, 3.6], roughness: 0.62, normalScale: 1.2 });
  for (const t of [floorMat.map, floorMat.normalMap, floorMat.roughnessMap]) { t.center.set(0.5, 0.5); t.rotation = Math.PI / 2; }
  plane(W + 0.4, D + 0.4, floorMat, { parent: room, rx: -Math.PI / 2 }).receiveShadow = true;
  const ceil = plane(W, D, ceilMat, { parent: room, rx: Math.PI / 2, y: H });
  ceil.geometry.setAttribute("uvGrime", ceil.geometry.attributes.uv.clone());

  const TILE = 2.0;
  const backZ = ROOM.z0;
  const bw = (x0, x1, y0, y1) => {
    room.add(wallPlane(x1 - x0, y1 - y0, backMat, TILE, x0 - ROOM.x0, y0, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: backZ }, W, H));
    blocker(x1 - x0, y1 - y0, WALL_T, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: backZ - WALL_T / 2 - 0.004 }, room);
  };
  bw(ROOM.x0, WIN.x0, 0, H);
  bw(WIN.x1, ROOM.x1, 0, H);
  bw(WIN.x0, WIN.x1, 0, WIN.y0);
  bw(WIN.x0, WIN.x1, WIN.y1, H);
  room.add(wallPlane(D, H, leftMat, TILE, 0, 0, { x: ROOM.x0, y: H / 2, z: 0, ry: Math.PI / 2 }));
  room.add(wallPlane(D, H, rightMat, TILE, 0.7, 0, { x: ROOM.x1, y: H / 2, z: 0, ry: -Math.PI / 2 }));
  blocker(WALL_T, H, D, { x: ROOM.x0 - WALL_T / 2, y: H / 2, z: 0 }, room);
  blocker(WALL_T, H, D, { x: ROOM.x1 + WALL_T / 2, y: H / 2, z: 0 }, room);
  blocker(W + 0.4, WALL_T, D + 0.4, { x: 0, y: H + WALL_T / 2, z: 0 }, room);

  // front wall with the doorway the camera walks in through
  const DOOR = { x0: -0.48, x1: 0.44, h: 2.08 };
  const fw = (x0, x1, y0, y1) => room.add(wallPlane(x1 - x0, y1 - y0, frontMat, TILE, x0 - ROOM.x0, y0, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: ROOM.z1, ry: Math.PI }, W, H));
  fw(ROOM.x0, DOOR.x0, 0, H);
  fw(DOOR.x1, ROOM.x1, 0, H);
  fw(DOOR.x0, DOOR.x1, DOOR.h, H);
  const frameMat = std(0x241811, { rough: 0.6 });
  box(0.06, DOOR.h, 0.18, frameMat, { parent: room, x: DOOR.x0 - 0.03, y: DOOR.h / 2, z: ROOM.z1 });
  box(0.06, DOOR.h, 0.18, frameMat, { parent: room, x: DOOR.x1 + 0.03, y: DOOR.h / 2, z: ROOM.z1 });
  box(DOOR.x1 - DOOR.x0 + 0.12, 0.06, 0.18, frameMat, { parent: room, x: (DOOR.x0 + DOOR.x1) / 2, y: DOOR.h + 0.03, z: ROOM.z1 });
  const doorWood = std(0xffffff, { rough: 0.6, map: darkWoodTexture(17, [62, 44, 30]) });
  const doorPivot = group({ parent: room, x: DOOR.x1, z: ROOM.z1 - 0.02 });
  doorPivot.userData.dynamic = true;   // swings open on the way in
  const doorW = DOOR.x1 - DOOR.x0;
  box(doorW, DOOR.h - 0.01, 0.04, doorWood, { parent: doorPivot, x: -doorW / 2, y: DOOR.h / 2, cast: true });
  for (const py of [0.55, 1.45]) box(doorW * 0.7, 0.55, 0.01, std(0x33251a, { rough: 0.7 }), { parent: doorPivot, x: -doorW / 2, y: py, z: -0.025 });
  sphere(0.028, std(0xb08a3c, { rough: 0.25, metal: 0.9 }), { parent: doorPivot, x: -doorW + 0.07, y: 1.0, z: -0.05 });
  sphere(0.028, std(0xb08a3c, { rough: 0.25, metal: 0.9 }), { parent: doorPivot, x: -doorW + 0.07, y: 1.0, z: 0.05 });
  const hall = plane(1.6, 2.4, glow(0x2a1e16, 0.5), { parent: room, x: 0, y: 1.2, z: ROOM.z1 + 2.2, ry: Math.PI });
  hall.receiveShadow = false;

  // trim + pipes
  const trim = std(0x2a1d14, { rough: 0.6 });
  box(W, 0.1, 0.02, trim, { parent: room, y: 0.05, z: ROOM.z0 + 0.01 });
  box(0.02, 0.1, D, trim, { parent: room, x: ROOM.x0 + 0.01, y: 0.05 });
  box(0.02, 0.1, D, trim, { parent: room, x: ROOM.x1 - 0.01, y: 0.05 });
  const pipeMat = std(0x2b2a28, { rough: 0.5, metal: 0.6 });
  cyl(0.03, 0.03, D, pipeMat, { parent: room, x: ROOM.x1 - 0.16, y: H - 0.1, rx: Math.PI / 2, seg: 14 });
  cyl(0.02, 0.02, H, pipeMat, { parent: room, x: ROOM.x1 - 0.1, y: H / 2, z: ROOM.z0 + 0.1, seg: 12 });
  for (let z = -2.0; z < 2.6; z += 1.1) cyl(0.04, 0.04, 0.03, pipeMat, { parent: room, x: ROOM.x1 - 0.16, y: H - 0.1, z, rx: Math.PI / 2 });

  // outlets
  box(0.07, 0.11, 0.012, std(0xd8cdb5, { rough: 0.5 }), { parent: room, x: DOOR.x1 + 0.22, y: 1.2, z: ROOM.z1 - 0.006 });
  box(0.012, 0.09, 0.06, std(0xd8cdb5, { rough: 0.5 }), { parent: room, x: ROOM.x1 - 0.006, y: 0.32, z: -1.25 });

  /* ---------------- window ---------------- */
  const wf = std(0xffffff, { rough: 0.55, map: darkWoodTexture(19, [38, 25, 16]) });
  const wW = WIN.x1 - WIN.x0, wH = WIN.y1 - WIN.y0, wcx = (WIN.x0 + WIN.x1) / 2, wcy = (WIN.y0 + WIN.y1) / 2;
  box(0.1, wH + 0.14, 0.26, wf, { parent: room, x: WIN.x0 - 0.03, y: wcy, z: backZ - 0.05, cast: true });
  box(0.1, wH + 0.14, 0.26, wf, { parent: room, x: WIN.x1 + 0.03, y: wcy, z: backZ - 0.05, cast: true });
  box(wW + 0.26, 0.11, 0.26, wf, { parent: room, x: wcx, y: WIN.y1 + 0.04, z: backZ - 0.05, cast: true });
  box(wW + 0.3, 0.045, 0.2, wf, { parent: room, x: wcx, y: WIN.y0 - 0.02, z: backZ - 0.0, cast: true });
  // sliding sashes: thick centre post, thin bottom rails
  box(0.075, wH, 0.07, wf, { parent: room, x: wcx - 0.12, y: wcy, z: backZ - 0.08, cast: true });
  box(0.045, wH, 0.05, wf, { parent: room, x: wcx - 0.04, y: wcy, z: backZ - 0.13, cast: true });
  box(wW, 0.04, 0.06, wf, { parent: room, x: wcx, y: WIN.y0 + 0.02, z: backZ - 0.1, cast: true });
  // rolled bamboo blind at the top, lowered a little
  const blindTex = canvasTexture(64, 512, (g, w, h) => {
    for (let y = 0; y < h; y += 6) {
      g.fillStyle = `rgb(${90 + Math.random() * 30},${62 + Math.random() * 20},${34 + Math.random() * 12})`;
      g.fillRect(0, y, w, 5);
      g.fillStyle = "rgba(20,12,6,0.9)";
      g.fillRect(0, y + 5, w, 1);
    }
  }, { repeat: [1, 1] });
  const blindMat = std(0xffffff, { rough: 0.9, map: blindTex, side: THREE.DoubleSide });
  cyl(0.055, 0.055, wW - 0.02, blindMat, { parent: room, x: wcx, y: WIN.y1 - 0.06, z: backZ - 0.03, rz: Math.PI / 2, cast: true });
  plane(wW - 0.02, 0.16, blindMat, { parent: room, x: wcx, y: WIN.y1 - 0.15, z: backZ - 0.02, cast: true });
  for (const sx of [wcx - 0.6, wcx + 0.6]) tube([[sx, WIN.y1 - 0.06, backZ - 0.02], [sx, WIN.y1 - 0.4, backZ - 0.01], [sx + 0.01, WIN.y1 - 0.5, backZ - 0.01]], 0.002, std(0xd8cdb5), { parent: room });

  // rainy glass
  const rainGlass = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec2 vUv; uniform float uTime;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float drops(vec2 uv, float scale, float speed, float t){
        uv *= scale;
        vec2 id = floor(uv); vec2 f = fract(uv) - 0.5;
        float r = h(id);
        float fall = fract(t * speed * (0.3 + r) + r);
        vec2 c = vec2((r - 0.5) * 0.6, 0.5 - fall * 1.2);
        float d = length((f - c) * vec2(1.0, 0.8));
        float drop = smoothstep(0.09, 0.02, d) * step(0.35, r);
        float trail = smoothstep(0.035, 0.0, abs(f.x - c.x)) * smoothstep(c.y, 0.5, f.y) * step(0.35, r) * 0.35;
        return drop + trail;
      }
      float statics(vec2 uv, float scale){
        uv *= scale; vec2 id = floor(uv); vec2 f = fract(uv) - 0.5;
        float r = h(id + 7.0);
        vec2 c = vec2(h(id+1.0), h(id+2.0)) - 0.5;
        return smoothstep(0.08, 0.02, length(f - c * 0.7)) * step(0.55, r);
      }
      void main(){
        vec2 uv = vUv * vec2(2.0, 1.4);
        float d = drops(uv, 9.0, 0.12, uTime) + drops(uv + 3.1, 15.0, 0.18, uTime) * 0.8 + statics(uv, 34.0) * 0.6;
        vec3 col = vec3(0.07, 0.08, 0.15) + vec3(0.55, 0.6, 0.85) * d;
        gl_FragColor = vec4(col, 0.1 + d * 0.32);
      }`
  });
  const glass = plane(wW, wH, rainGlass, { parent: room, x: wcx, y: wcy, z: backZ - 0.11 });
  glass.renderOrder = 5;
  animated.push((t) => { rainGlass.uniforms.uTime.value = t; });

  /* ---------------- balcony fence outside ---------------- */
  const linkTex = canvasTexture(256, 256, (g, w, h) => {
    // chain-link: thin galvanised wire on a transparent background
    g.clearRect(0, 0, w, h);
    g.strokeStyle = "rgba(150,155,170,1)";
    g.lineWidth = 3;
    const s = 32;
    for (let k = -h; k < w + h; k += s) {
      g.beginPath(); g.moveTo(k, 0); g.lineTo(k + h, h); g.stroke();
      g.beginPath(); g.moveTo(k, h); g.lineTo(k + h, 0); g.stroke();
    }
  }, { repeat: [6, 5], srgb: true });
  const linkMat = new THREE.MeshStandardMaterial({ map: linkTex, alphaTest: 0.4, transparent: false, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.7, color: 0x6a6e7c });
  const fence = plane(3.0, 2.6, linkMat, { parent: room, x: 2.05, y: 1.4, z: backZ - 2.2 });
  fence.castShadow = false;
  const iron = std(0x16161a, { rough: 0.6, metal: 0.5 });
  for (const fx of [0.55, 1.55, 2.55, 3.55]) cyl(0.025, 0.025, 2.8, iron, { parent: room, x: fx, y: 1.3, z: backZ - 2.18, seg: 8 });
  box(3.2, 0.04, 0.04, iron, { parent: room, x: 2.05, y: 2.7, z: backZ - 2.18 });
  box(5.5, 0.06, 0.6, std(0x0d0d10, { rough: 0.9 }), { parent: room, x: 0.4, y: 0.1, z: backZ - 0.6 });
  box(0.04, 1.0, 0.04, iron, { parent: room, x: -0.4, y: 0.6, z: backZ - 0.85 });
  pottedPlant(room, 0.2, 0.13, backZ - 0.7, { h: 0.45, seed: 41, pot: 0x5a4030 });

  /* ---------------- rug ---------------- */
  const rugMat = new THREE.MeshStandardMaterial({ map: rugTexture(5), roughness: 1, normalMap: pbr("cotton", { repeat: [5, 13] }).normalMap, normalScale: new THREE.Vector2(1.6, 1.6) });
  plane(1.25, 3.3, rugMat, { parent: room, rx: -Math.PI / 2, x: -0.12, y: 0.006, z: 0.0, rz: 0.015 }).receiveShadow = true;

  /* ---------------- desk under the window ---------------- */
  const deskWood = pbr("wood", { color: 0xb08a68, roughness: 0.85 });
  const deskDark = pbr("wood", { color: 0x6a5040, roughness: 0.95 });
  const steel = std(0x1a1a1c, { metal: 0.6, rough: 0.4 });
  const dW = DESK.x1 - DESK.x0, dD = DESK.z1 - DESK.z0, dcx = (DESK.x0 + DESK.x1) / 2, dcz = (DESK.z0 + DESK.z1) / 2;
  box(dW, 0.045, dD, deskWood, { parent: room, x: dcx, y: DESK.top - 0.0225, z: dcz, cast: true });
  for (const [lx, lz] of [[DESK.x0 + 0.04, DESK.z0 + 0.04], [DESK.x1 - 0.04, DESK.z0 + 0.04], [DESK.x0 + 0.04, DESK.z1 - 0.04], [DESK.x1 - 0.04, DESK.z1 - 0.04]]) {
    box(0.04, DESK.top - 0.045, 0.04, steel, { parent: room, x: lx, y: (DESK.top - 0.045) / 2, z: lz, cast: true });
  }
  box(dW - 0.1, 0.02, dD - 0.12, deskDark, { parent: room, x: dcx, y: 0.16, z: dcz });
  box(dW - 0.08, 0.06, 0.02, steel, { parent: room, x: dcx, y: 0.5, z: DESK.z0 + 0.04 });
  // under the desk: tower, a fan, boxes
  box(0.2, 0.42, 0.42, std(0x121214, { rough: 0.45 }), { parent: room, x: 0.55, y: 0.21, z: -2.3, cast: true });
  box(0.012, 0.3, 0.008, glow(0x6ab0ff, 1.2), { parent: room, x: 0.44, y: 0.25, z: -2.09 });
  const fan = group({ parent: room, x: 0.18, y: 0.17, z: -2.05, ry: -0.3 });
  torus(0.13, 0.008, std(0xd8d4c8, { rough: 0.5 }), { parent: fan, y: 0.13 });
  cyl(0.06, 0.07, 0.02, std(0xd8d4c8, { rough: 0.5 }), { parent: fan, y: -0.17 + 0.01 });
  cyl(0.012, 0.012, 0.16, std(0xd8d4c8), { parent: fan, y: -0.08 });
  bookStack(room, -0.6, 0.17, -2.3, 4, 77);
  box(0.36, 0.14, 0.28, std(0x2a2620, { rough: 0.8 }), { parent: room, x: -0.2, y: 0.24, z: -2.35, cast: true });

  // desk clutter (the machines on the desk live in machines/desk.js)
  mug(room, -0.52, DESK.top, -2.0, 0xe6ddca, 0.6);
  anchors.mugSteam = new THREE.Vector3(-0.52, DESK.top + 0.1, -2.0);
  bottle(room, 0.5, DESK.top, -1.97, 0x1d5228, 0.27);
  // incense dish (the smoke wisp comes from fx)
  cyl(0.05, 0.04, 0.015, std(0x3a3632, { rough: 0.4, metal: 0.3 }), { parent: room, x: -0.36, y: DESK.top + 0.008, z: -1.97 });
  cyl(0.0015, 0.0015, 0.14, std(0x5a3a22), { parent: room, x: -0.36, y: DESK.top + 0.07, z: -1.97, rz: 0.5 });
  anchors.incense = new THREE.Vector3(-0.33, DESK.top + 0.13, -1.97);
  box(0.21, 0.004, 0.29, std(0xe8e2d4, { rough: 0.9 }), { parent: room, x: 0.12, y: DESK.top + 0.002, z: -1.98, ry: 0.3 });

  /* ---------------- tall shelf (left, by the window) ---------------- */
  const shelfMat = pbr("wood", { color: 0xa88a66, roughness: 0.9 });
  const shelf = group({ parent: room, x: -1.44, z: -2.18 });
  const sw = 0.32, sd = 0.76;
  for (const sz of [-sd / 2, sd / 2]) box(sw, 2.15, 0.025, shelfMat, { parent: shelf, y: 1.075, z: sz, cast: true });
  for (const sy of [0.04, 0.42, 0.82, 1.22, 1.62, 2.02]) box(sw, 0.025, sd, shelfMat, { parent: shelf, y: sy, cast: true });
  box(0.01, 2.15, sd, shelfMat, { parent: shelf, x: -sw / 2 + 0.005, y: 1.075 });
  bookStack(shelf, 0.0, 0.055, -0.36, 14, 51, { upright: true, ry: -Math.PI / 2, width: 0.7 });
  bookStack(shelf, 0.0, 0.435, -0.36, 5, 52, { upright: true, ry: -Math.PI / 2, width: 0.3 });
  jar(shelf, 0.0, 0.435, 0.12, 0xc8b890, 0.18);
  jar(shelf, 0.02, 0.435, 0.26, 0x9ab0a0, 0.13);
  bookStack(shelf, 0.0, 1.635, -0.36, 6, 53, { upright: true, ry: -Math.PI / 2, width: 0.35 });
  jar(shelf, 0.0, 1.635, 0.22, 0xe0d0b0, 0.2);
  pottedPlant(shelf, 0.0, 2.035, 0.05, { h: 0.2, seed: 62, potR: 0.06, leaves: 16 });
  pothos(shelf, 0.02, 2.06, -0.2, { vines: 8, len: 1.1, seed: 61, dir: [1, 0.3] });
  bookStack(shelf, 0.0, 0.835, -0.36, 4, 54, { upright: true, ry: -Math.PI / 2, width: 0.25 });
  // consoles (classifier) occupy the 1.22 shelf; set in machines/consoles.js
  anchors.consoleShelf = { x: -1.44, y: 1.2325, z: -2.18 };

  /* ---------------- sideboard (left) ---------------- */
  const sbMat = pbr("wood", { color: 0x9a7a5a, roughness: 0.9 });
  const sbW = SIDEBOARD.x1 - SIDEBOARD.x0, sbD = SIDEBOARD.z1 - SIDEBOARD.z0;
  const sb = group({ parent: room, x: (SIDEBOARD.x0 + SIDEBOARD.x1) / 2, z: (SIDEBOARD.z0 + SIDEBOARD.z1) / 2 });
  box(sbW, 0.03, sbD, sbMat, { parent: sb, y: SIDEBOARD.top - 0.015, cast: true });
  box(sbW, 0.03, sbD, sbMat, { parent: sb, y: 0.06 });
  for (const sz of [-sbD / 2, -sbD / 6, sbD / 6, sbD / 2]) box(sbW, SIDEBOARD.top - 0.03, 0.025, sbMat, { parent: sb, y: (SIDEBOARD.top - 0.03) / 2, z: sz, cast: true });
  box(sbW, 0.025, sbD, sbMat, { parent: sb, y: 0.42 });
  box(0.012, SIDEBOARD.top, sbD, sbMat, { parent: sb, x: -sbW / 2, y: SIDEBOARD.top / 2 });
  // contents: records, boxes, cassettes
  const sleeveCols = [0x8a2a1a, 0x1a3a5a, 0xd8c8a0, 0x2a2a2a, 0x5a7a3a, 0xa86a2a, 0x3a1a4a, 0xc0b090, 0x101010, 0x6a1a2a];
  const rr = rng(88);
  for (let k = 0; k < 40; k++) {
    box(0.31, 0.31, 0.006, std(sleeveCols[(rr() * sleeveCols.length) | 0], { rough: 0.8 }), { parent: sb, x: -0.02, y: 0.075 + 0.155, z: sbD / 6 + 0.03 + k * 0.016, ry: Math.PI / 2, rx: (rr() - 0.5) * 0.05 });
  }
  for (let k = 0; k < 3; k++) box(0.3, 0.1, 0.22, std([0x3a2a20, 0x2a2a30, 0x4a3a2a][k], { rough: 0.8 }), { parent: sb, x: 0.0, y: 0.48 + k * 0.105, z: -sbD / 3, cast: true });
  for (let k = 0; k < 9; k++) box(0.012, 0.07, 0.11, std(sleeveCols[(rr() * sleeveCols.length) | 0], { rough: 0.5 }), { parent: sb, x: 0.05, y: 0.11, z: -sbD / 3 - 0.2 + k * 0.015, ry: Math.PI / 2 });
  // records leaning against the sideboard and a crate on the floor
  for (let k = 0; k < 9; k++) box(0.31, 0.31, 0.006, std(sleeveCols[(rr() * sleeveCols.length) | 0], { rough: 0.8 }), { parent: room, x: -1.02 + k * 0.008, y: 0.155, z: 0.95, ry: Math.PI / 2, rz: 0.22 - k * 0.01 });
  const crate = group({ parent: room, x: -1.32, z: 1.05, ry: 0.1 });
  const crateMat = std(0x2a3a4a, { rough: 0.6 });
  for (const [w2, d2, x2, z2] of [[0.34, 0.02, 0, 0.16], [0.34, 0.02, 0, -0.16], [0.02, 0.34, 0.16, 0], [0.02, 0.34, -0.16, 0]]) {
    for (let y = 0.02; y < 0.3; y += 0.055) box(w2, 0.03, d2, crateMat, { parent: crate, x: x2, y, z: z2 });
  }
  box(0.34, 0.015, 0.34, crateMat, { parent: crate, y: 0.008 });
  for (let k = 0; k < 14; k++) box(0.31, 0.31, 0.006, std(sleeveCols[(rr() * sleeveCols.length) | 0], { rough: 0.8 }), { parent: crate, y: 0.17, z: -0.13 + k * 0.019, rx: -0.25 });

  /* ---------------- chair ---------------- */
  const chair = group({ parent: room, x: -0.28, z: -1.28, ry: 0.55 });
  const leather = pbr("leather", { color: 0x55504c, roughness: 0.85, normalScale: 0.8 });
  const chrome = std(0x2a2a2e, { metal: 0.8, rough: 0.35 });
  box(0.5, 0.08, 0.5, leather, { parent: chair, y: 0.5, r: 0.03, cast: true });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    box(0.3, 0.03, 0.04, chrome, { parent: chair, x: Math.cos(a) * 0.15, y: 0.08, z: Math.sin(a) * 0.15, ry: -a, cast: true });
    sphere(0.025, std(0x0a0a0a), { parent: chair, x: Math.cos(a) * 0.29, y: 0.03, z: Math.sin(a) * 0.29 });
  }
  cyl(0.025, 0.03, 0.4, chrome, { parent: chair, y: 0.28, cast: true });
  box(0.46, 0.46, 0.07, leather, { parent: chair, y: 0.82, z: 0.25, rx: 0.12, r: 0.03, cast: true });
  for (const sx of [-0.27, 0.27]) {
    box(0.05, 0.03, 0.3, leather, { parent: chair, x: sx, y: 0.72, z: 0.02, cast: true });
    box(0.02, 0.2, 0.02, chrome, { parent: chair, x: sx, y: 0.62, z: 0.1 });
  }

  /* ---------------- bed (right foreground) ---------------- */
  const bed = group({ parent: room, x: (BED.x0 + BED.x1) / 2, z: (BED.z0 + BED.z1) / 2 });
  const bW = BED.x1 - BED.x0, bL = BED.z1 - BED.z0;
  const bedFrame = pbr("wood", { color: 0x5a4434, roughness: 0.9 });
  box(bW, 0.24, bL, bedFrame, { parent: bed, y: 0.12, cast: true });
  box(bW - 0.04, 0.2, bL - 0.06, std(0xc8c2b6, { rough: 0.9 }), { parent: bed, y: 0.34, r: 0.05, cast: true });
  box(bW + 0.04, 0.5, 0.05, bedFrame, { parent: bed, y: 0.3, z: -bL / 2 - 0.02, cast: true });
  const sheetMat = pbr("cotton", { color: 0x8a8278, repeat: [4, 4], normalScale: 1.5, side: THREE.DoubleSide });
  const half = (bW - 0.04) / 2;
  const duvet = drapedCloth(bW + 0.5, bL - 0.25, (x, z) => {
    const top = 0.48 + 0.07 * Math.exp(-((x + 0.15) ** 2) * 6 - ((z - 0.2) ** 2) * 1.5) + 0.05 * Math.exp(-((x - 0.25) ** 2) * 9 - ((z + 0.4) ** 2) * 4);
    if (x > half) return Math.max(0.03, top - (x - half) * 2.0);
    if (x < -half) return Math.max(0.03, top - (-half - x) * 2.2);
    return top;
  }, sheetMat, 16, { noise: 0.028, segs: 72, creases: 0.035 });
  duvet.position.set(-0.05, 0, 0.12);
  duvet.rotation.y = 0.03;
  bed.add(duvet);
  const pillowMat = pbr("cotton", { color: 0xd6d2ca, repeat: [1.5, 1.5], normalScale: 1.2 });
  box(0.55, 0.11, 0.36, pillowMat, { parent: bed, x: -0.28, y: 0.5, z: -bL / 2 + 0.3, r: 0.05, seg: 4, ry: 0.12, rx: -0.12, cast: true });
  box(0.55, 0.12, 0.36, pillowMat, { parent: bed, x: 0.3, y: 0.51, z: -bL / 2 + 0.27, r: 0.05, seg: 4, ry: -0.1, rx: -0.16, cast: true });

  /* ---------------- right wall: plant stand, AC, posters ---------------- */
  const stand = group({ parent: room, x: 1.4, z: -2.38 });
  cyl(0.12, 0.14, 0.62, std(0xffffff, { rough: 0.7, map: darkWoodTexture(71, [60, 40, 26]) }), { parent: stand, y: 0.31, cast: true });
  pottedPlant(stand, 0, 0.62, 0, { h: 0.62, seed: 72, pot: 0x7a5236, potR: 0.1, leaves: 34 });

  const ac = group({ parent: room, x: ROOM.x1 - 0.13, y: 2.42, z: -1.55, ry: -Math.PI / 2 });
  box(0.82, 0.27, 0.22, std(0xd9d6cc, { rough: 0.5 }), { parent: ac, r: 0.03, cast: true });
  box(0.74, 0.04, 0.02, std(0x9a988f, { rough: 0.6 }), { parent: ac, y: -0.08, z: 0.11, rx: 0.5 });
  box(0.05, 0.01, 0.005, glow(0x7cffb0, 1.5), { parent: ac, x: 0.3, y: 0.06, z: 0.112 });
  tube([[0.4, 0, -0.05], [0.5, -0.1, -0.08], [0.52, -0.8, -0.09], [0.52, -1.6, -0.09]], 0.012, std(0xbab6aa), { parent: ac });

  poster(room, tokyoPosterTexture(), 0.42, 0.84, { x: ROOM.x0 + 0.004, y: 1.86, z: -1.18, ry: Math.PI / 2 });
  poster(room, chipPosterTexture(), 0.32, 0.45, { x: ROOM.x0 + 0.004, y: 1.98, z: -0.52, ry: Math.PI / 2 });
  poster(room, wavePosterTexture(), 0.55, 0.73, { x: ROOM.x0 + 0.004, y: 1.84, z: 0.35, ry: Math.PI / 2 });
  poster(room, moonPosterTexture(), 0.56, 0.75, { x: ROOM.x1 - 0.004, y: 1.86, z: -1.02, ry: -Math.PI / 2 });
  poster(room, jcPosterTexture(), 0.38, 0.53, { x: ROOM.x1 - 0.004, y: 1.72, z: 1.25, ry: -Math.PI / 2 });
  const photos = [
    [ROOM.x0 + 0.005, 1.38, -0.82, Math.PI / 2, 1], [ROOM.x0 + 0.005, 1.46, -0.66, Math.PI / 2, 2],
    [ROOM.x0 + 0.005, 2.25, -0.2, Math.PI / 2, 3], [ROOM.x0 + 0.005, 1.4, 0.9, Math.PI / 2, 7],
    [ROOM.x1 - 0.005, 1.95, -2.05, -Math.PI / 2, 4], [ROOM.x1 - 0.005, 1.7, -1.92, -Math.PI / 2, 5],
    [ROOM.x1 - 0.005, 1.78, -2.2, -Math.PI / 2, 6], [ROOM.x1 - 0.005, 2.1, 0.55, -Math.PI / 2, 8]
  ];
  for (const [x, y, z, ry, s] of photos) plane(0.12, 0.14, std(0xffffff, { rough: 0.6, map: photoTexture(s) }), { parent: room, x, y, z, ry, rz: (rng(s)() - 0.5) * 0.2 });

  /* ---------------- floor clutter ---------------- */
  const shirtMat = std(0xffffff, { rough: 0.95, map: fabricTexture(18, "#b8b4ae", [2, 2]), side: THREE.DoubleSide });
  const shirt = drapedCloth(0.45, 0.4, (x, z) => 0.015 + 0.05 * Math.exp(-(x * x + z * z) * 30) + 0.03 * Math.exp(-((x - 0.1) ** 2 + (z + 0.08) ** 2) * 60), shirtMat, 31, { segs: 20, noise: 0.012 });
  shirt.position.set(-0.85, 0, 0.35);
  shirt.rotation.y = 0.6;
  room.add(shirt);
  can(room, -0.62, 0, 0.75, 0xd8d8d8);
  can(room, 0.55, 0, 1.95, 0xb51a1a, { tipped: true, ry: 0.7 });
  can(room, -0.75, 0, -0.95, 0x2c9a4a);
  bottle(room, 0.22, 0, -0.62, 0x1a3a20, 0.24);
  cyl(0.07, 0.06, 0.02, std(0x4a4640, { rough: 0.3, metal: 0.4 }), { parent: room, x: -0.48, y: 0.01, z: 1.55 });
  plane(0.21, 0.29, std(0xe8e2d4, { rough: 0.9 }), { parent: room, rx: -Math.PI / 2, x: -0.25, y: 0.008, z: 0.55, rz: 0.9 });
  plane(0.21, 0.29, std(0xe8e2d4, { rough: 0.9 }), { parent: room, rx: -Math.PI / 2, x: 0.2, y: 0.009, z: -0.9, rz: -0.5 });
  // headphones on the rug
  const hp = group({ parent: room, x: 0.18, y: 0, z: 1.25, ry: 0.6 });
  torus(0.085, 0.009, std(0x141416, { rough: 0.4 }), { parent: hp, y: 0.02, rx: -Math.PI / 2 + 0.25, arc: Math.PI * 1.15, rz: -0.3 });
  for (const sx of [-0.085, 0.085]) cyl(0.045, 0.045, 0.035, std(0x141416, { rough: 0.5 }), { parent: hp, x: sx, y: 0.03, rz: Math.PI / 2 + 0.3 * Math.sign(sx), cast: true });
  // cables from the desk to the floor and over to the synth stand
  const cable = std(0x0b0b0c, { rough: 0.5 });
  tube([[0.3, DESK.top, -2.1], [0.4, 0.45, -1.95], [0.5, 0.01, -1.8], [0.8, 0.01, -1.6], [1.05, 0.01, -1.5], [1.1, 0.5, -1.55]], 0.006, cable, { parent: room });
  tube([[-0.8, DESK.top, -2.0], [-0.95, 0.4, -1.9], [-1.0, 0.01, -1.6], [-1.08, 0.01, -1.2], [-1.1, 0.3, -0.9]], 0.005, cable, { parent: room });
  tube([[0.0, DESK.top, -2.4], [-0.05, 0.3, -2.45], [-0.1, 0.01, -2.2], [-0.4, 0.01, -1.9]], 0.005, cable, { parent: room });

  /* ---------------- windowsill decor ---------------- */
  can(room, 1.1, WIN.y0, -2.68, 0x9a9a9a);
  mug(room, -0.55, WIN.y0, -2.66, 0x2a3a5a, 1.2);
  bookStack(room, 0.75, WIN.y0, -2.66, 2, 91, { ry: 0.3 });

  /* ---------------- lights ---------------- */
  const winLight = new THREE.RectAreaLight(0x6a7cc8, 2.2, wW, wH);
  winLight.position.set(wcx, wcy, backZ - 0.05);
  winLight.lookAt(wcx, wcy - 0.3, 0);
  room.add(winLight);
  lights.window = winLight;

  const moon = new THREE.DirectionalLight(0x8088d8, 0.9);
  moon.position.set(wcx - 1.4, 4.4, -10.5);
  moon.target.position.set(wcx + 0.35, 0.3, 0.2);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -3.2;
  moon.shadow.camera.right = 3.2;
  moon.shadow.camera.top = 4;
  moon.shadow.camera.bottom = -4;
  moon.shadow.camera.near = 1;
  moon.shadow.camera.far = 20;
  moon.shadow.bias = -0.0005;
  moon.shadow.normalBias = 0.03;
  room.add(moon, moon.target);
  lights.moon = moon;

  const neonSpill = new THREE.PointLight(0xff3a52, 1.1, 3.5, 2);
  neonSpill.position.set(-0.45, 1.8, backZ - 0.7);
  room.add(neonSpill);
  lights.neon = neonSpill;
  animated.push((t) => {
    neonSpill.intensity = Math.sin(t * 13.0) > 0.985 ? 0.4 : 1.1;
  });

  const amb = new THREE.AmbientLight(0x2a2620, 0.42);
  room.add(amb);
  // warm fill on the left so the turntable corner isn't lost in the dark
  const fill = new THREE.PointLight(0xffa456, 0.7, 3.0, 2);
  fill.position.set(-1.0, 1.9, -0.2);
  room.add(fill);
  // cool bounce from the window onto the bed
  const bounce = new THREE.PointLight(0x6a7488, 0.4, 3.5, 2);
  bounce.position.set(0.9, 1.6, -0.6);
  room.add(bounce);
  // warm spill reaching the right wall and the synth stand (lamp bounce)
  const warmRight = new THREE.PointLight(0xffa860, 0.75, 3.2, 2);
  warmRight.position.set(0.85, 1.9, -1.5);
  room.add(warmRight);
  room.add(new THREE.HemisphereLight(0x2c3044, 0x2a1c12, 0.28));
  lights.ambient = amb;

  return { room, lights, animated, doorPivot, anchors };
}
