// Atmosphere: floating dust, steam off the mug, incense smoke and soft light
// beams — the "muggy" part of the room.
import * as THREE from "three";
import { rng } from "./textures.js";

function softSprite() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.35)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A rising wisp made of sprites whose positions follow a curling path. */
function wisp(scene, origin, { count = 40, color = 0xd8d0c8, size = 0.06, height = 0.6, opacity = 0.18, curl = 0.05, speed = 0.08 } = {}) {
  const sprite = softSprite();
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const life = new Float32Array(count);
  const rand = rng(Math.floor(origin.x * 1000 + origin.z * 100));
  for (let i = 0; i < count; i++) life[i] = rand();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aLife", new THREE.BufferAttribute(life, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uMap: { value: sprite }, uColor: { value: new THREE.Color(color) }, uSize: { value: size }, uOpacity: { value: opacity }, uScale: { value: 800 } },
    vertexShader: `
      attribute float aLife; varying float vLife; uniform float uSize; uniform float uScale;
      void main(){ vLife = aLife; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize * (0.4 + aLife * 1.6) * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `
      uniform sampler2D uMap; uniform vec3 uColor; uniform float uOpacity; varying float vLife;
      void main(){ float a = texture2D(uMap, gl_PointCoord).a * uOpacity * smoothstep(0.0, 0.15, vLife) * (1.0 - vLife);
        gl_FragColor = vec4(uColor * a, a); }`
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  const seeds = Array.from({ length: count }, () => rand() * 10);
  return {
    mat,
    update(dt, t) {
      for (let i = 0; i < count; i++) {
        life[i] += dt * speed * (0.7 + (seeds[i] % 1) * 0.6);
        if (life[i] > 1) life[i] -= 1;
        const L = life[i];
        const y = L * height;
        const sway = Math.sin(t * 0.9 + y * 9 + seeds[i]) * curl * L + Math.sin(t * 0.37 + seeds[i]) * curl * 0.6 * L;
        pos[i * 3] = origin.x + sway;
        pos[i * 3 + 1] = origin.y + y;
        pos[i * 3 + 2] = origin.z + Math.cos(t * 0.7 + y * 7 + seeds[i]) * curl * 0.7 * L;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aLife.needsUpdate = true;
    }
  };
}

export function buildFx(scene, anchors, room) {
  const updates = [];

  // dust motes in the lamp + window light
  const N = 700;
  const rand = rng(99);
  const pos = new Float32Array(N * 3);
  const base = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    base[i * 3] = room.x0 + 0.2 + rand() * (room.x1 - room.x0 - 0.4);
    base[i * 3 + 1] = 0.2 + rand() * 2.3;
    base[i * 3 + 2] = room.z0 + 0.2 + rand() * 4.4;
  }
  pos.set(base);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const dustMat = new THREE.PointsMaterial({ size: 0.006, map: softSprite(), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffd9b0, sizeAttenuation: true });
  const dust = new THREE.Points(geo, dustMat);
  dust.frustumCulled = false;
  scene.add(dust);
  updates.push((dt, t) => {
    for (let i = 0; i < N; i++) {
      const s = i * 0.37;
      pos[i * 3] = base[i * 3] + Math.sin(t * 0.07 + s) * 0.12;
      pos[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * 0.05 + s * 1.7) * 0.15;
      pos[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * 0.06 + s * 0.8) * 0.12;
    }
    geo.attributes.position.needsUpdate = true;
  });

  if (anchors.mugSteam) {
    const steam = wisp(scene, anchors.mugSteam, { count: 30, color: 0xfff0e0, size: 0.05, height: 0.32, opacity: 0.16, curl: 0.035, speed: 0.22 });
    updates.push(steam.update);
  }
  if (anchors.incense) {
    const smoke = wisp(scene, anchors.incense, { count: 60, color: 0xc8c4d8, size: 0.045, height: 0.75, opacity: 0.13, curl: 0.07, speed: 0.1 });
    updates.push(smoke.update);
  }

  // soft light beams: lamp cone and window shaft
  const beamMat = (color, strength) => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uStrength; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ float edge = pow(abs(dot(vN, vV)), 1.6); float fall = pow(vUv.y, 1.4);
        float a = uStrength * edge * fall; gl_FragColor = vec4(uColor * a, a); }`
  });
  if (anchors.lampHead && anchors.lampTarget) {
    const h = anchors.lampHead.distanceTo(anchors.lampTarget);
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.36, h, 32, 1, true), beamMat(0xffb070, 0.09));
    cone.position.copy(anchors.lampHead).add(anchors.lampTarget).multiplyScalar(0.5);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), anchors.lampTarget.clone().sub(anchors.lampHead).normalize());
    scene.add(cone);
  }
  return { update: (dt, t) => updates.forEach((u) => u(dt, t)) };
}
