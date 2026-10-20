import * as THREE from "three";

const hitMat = new THREE.MeshBasicMaterial({ visible: false });

/**
 * Describe an interactive machine.
 *  - `root`  the Object3D the machine is built in
 *  - `hit`   [w,h,d] and local offset of an invisible pick box
 *  - `focus` close-up camera pose in the root's local space
 */
export function machine({ id, tool = id, label, hint, zone, root, hit, hitOffset = [0, 0, 0], focus, highlight }) {
  const box = new THREE.Mesh(new THREE.BoxGeometry(hit[0], hit[1], hit[2]), hitMat);
  box.position.set(...hitOffset);
  box.userData.machineId = id;
  root.add(box);
  return {
    id,
    tool,
    label,
    hint,
    zone,
    root,
    hitbox: box,
    highlight: highlight || root,
    focusLocal: focus,
    update: null,
    /** world-space close-up pose */
    focusPose() {
      root.updateMatrixWorld(true);
      return {
        pos: root.localToWorld(new THREE.Vector3(...focus.pos)),
        target: root.localToWorld(new THREE.Vector3(...focus.target)),
        hfov: focus.hfov || 48
      };
    },
    /** screen-space rectangle of the pick box (for the panel "unfold") */
    screenRect(camera, width, height) {
      box.updateMatrixWorld(true);
      const g = box.geometry;
      g.computeBoundingBox();
      const bb = g.boundingBox;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const v = new THREE.Vector3();
      for (let i = 0; i < 8; i++) {
        v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z);
        v.applyMatrix4(box.matrixWorld).project(camera);
        const sx = (v.x * 0.5 + 0.5) * width, sy = (-v.y * 0.5 + 0.5) * height;
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
  };
}

/** A per-object emissive material so LEDs can be driven individually. */
export function ledMat(color, base = 0.05) {
  const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: base, roughness: 0.4 });
  m.userData.base = base;
  return m;
}
