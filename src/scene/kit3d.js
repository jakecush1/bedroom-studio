// Small modelling kit for building the room out of primitives.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const matCache = new Map();

/** Cached MeshStandardMaterial. */
export function std(color, opts = {}) {
  const key = JSON.stringify([color, opts.rough, opts.metal, opts.emissive, opts.ei, opts.side, opts.transparent, opts.opacity, opts.map && opts.map.uuid, opts.flat]);
  if (!opts.unique && matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.rough ?? 0.7,
    metalness: opts.metal ?? 0,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.ei ?? 1,
    map: opts.map ?? null,
    side: opts.side ?? THREE.FrontSide,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    flatShading: opts.flat ?? false
  });
  if (opts.emissiveMap) m.emissiveMap = opts.emissiveMap;
  if (opts.roughnessMap) m.roughnessMap = opts.roughnessMap;
  if (!opts.unique) matCache.set(key, m);
  return m;
}

/** Unlit glowing material for LEDs, bulbs and screens (blooms). */
export function glow(color, intensity = 1, opts = {}) {
  const c = new THREE.Color(color).multiplyScalar(intensity);
  const key = `glow:${c.getHexString()}:${intensity}:${opts.map ? opts.map.uuid : ""}:${opts.transparent}`;
  if (!opts.unique && matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshBasicMaterial({ color: c, map: opts.map ?? null, transparent: opts.transparent ?? false, opacity: opts.opacity ?? 1, toneMapped: opts.toneMapped ?? true, side: opts.side ?? THREE.FrontSide, fog: opts.fog ?? true });
  if (!opts.unique) matCache.set(key, m);
  return m;
}

function place(mesh, p = {}) {
  mesh.position.set(p.x || 0, p.y || 0, p.z || 0);
  mesh.rotation.set(p.rx || 0, p.ry || 0, p.rz || 0);
  if (p.s) mesh.scale.setScalar(p.s);
  if (p.sx || p.sy || p.sz) mesh.scale.set(p.sx || 1, p.sy || 1, p.sz || 1);
  if (p.cast !== false) mesh.castShadow = !!p.cast;
  mesh.receiveShadow = p.receive !== false;
  if (p.name) mesh.name = p.name;
  if (p.parent) p.parent.add(mesh);
  return mesh;
}

export function box(w, h, d, mat, p = {}) {
  const geo = p.r ? new RoundedBoxGeometry(w, h, d, p.seg || 2, p.r) : new THREE.BoxGeometry(w, h, d);
  return place(new THREE.Mesh(geo, mat), p);
}

export function cyl(rt, rb, h, mat, p = {}) {
  const geo = new THREE.CylinderGeometry(rt, rb, h, p.seg || 24, 1, !!p.open, p.thetaStart || 0, p.thetaLength || Math.PI * 2);
  return place(new THREE.Mesh(geo, mat), p);
}

export function sphere(r, mat, p = {}) {
  const geo = new THREE.SphereGeometry(r, p.ws || 20, p.hs || 14, 0, Math.PI * 2, 0, p.thetaLength || Math.PI);
  return place(new THREE.Mesh(geo, mat), p);
}

export function plane(w, h, mat, p = {}) {
  return place(new THREE.Mesh(new THREE.PlaneGeometry(w, h, p.wseg || 1, p.hseg || 1), mat), p);
}

/** Lathe from [radius, y] pairs. */
export function lathe(points, mat, p = {}) {
  const pts = points.map(([r, y]) => new THREE.Vector2(r, y));
  return place(new THREE.Mesh(new THREE.LatheGeometry(pts, p.seg || 32), mat), p);
}

export function tube(points, radius, mat, p = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((q) => new THREE.Vector3(q[0], q[1], q[2])));
  return place(new THREE.Mesh(new THREE.TubeGeometry(curve, p.segments || Math.max(16, points.length * 10), radius, p.radial || 8, false), mat), p);
}

export function torus(r, t, mat, p = {}) {
  return place(new THREE.Mesh(new THREE.TorusGeometry(r, t, p.rs || 10, p.ts || 32, p.arc || Math.PI * 2), mat), p);
}

export function group(p = {}) {
  const g = new THREE.Group();
  g.position.set(p.x || 0, p.y || 0, p.z || 0);
  g.rotation.set(p.rx || 0, p.ry || 0, p.rz || 0);
  if (p.s) g.scale.setScalar(p.s);
  if (p.name) g.name = p.name;
  if (p.parent) p.parent.add(g);
  return g;
}

/**
 * Merge every static mesh under `root` that shares a material into one mesh,
 * keeping shadow flags. Cuts draw calls for clutter-heavy groups.
 */
export function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map();
  const remove = [];
  root.traverse((o) => {
    if (!o.isMesh || o.userData.keep || o.material.transparent || Array.isArray(o.material)) return;
    const key = `${o.material.uuid}|${o.castShadow}|${o.receiveShadow}`;
    if (!buckets.has(key)) buckets.set(key, { mat: o.material, cast: o.castShadow, receive: o.receiveShadow, geos: [] });
    const g = o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    // normalise attribute sets so geometries can merge
    for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    buckets.get(key).geos.push(g);
    remove.push(o);
  });
  for (const o of remove) o.parent.remove(o);
  for (const b of buckets.values()) {
    const merged = mergeGeometries(b.geos, false);
    if (!merged) continue;
    const m = new THREE.Mesh(merged, b.mat);
    m.castShadow = b.cast;
    m.receiveShadow = b.receive;
    root.add(m);
  }
  return root;
}

export const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
