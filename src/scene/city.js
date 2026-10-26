// The city through the window: hazy night sky, towers with lit windows at
// photo-like scale, a closer mid-rise carrying the red ホテル sign, rooftop
// water tanks, blinking antennas, a passing train and the rain.
import * as THREE from "three";
import { rng, canvasTexture } from "./textures.js";

const GROUND = -14; // the room is a few floors up

const buildingVert = `
  attribute vec3 aSize;
  attribute vec2 aSeed;
  varying vec3 vLocal;
  varying vec3 vN;
  varying vec2 vSeed;
  varying float vDist;
  void main() {
    vLocal = (position + 0.5) * aSize;
    vN = normal;
    vSeed = aSeed;
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vDist = length(wp.xyz - cameraPosition);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

// aSeed.x: random seed, aSeed.y: style (0 grid, 1 ribbon, 2 fins, 3 near/concrete)
const buildingFrag = `
  uniform float uTime;
  uniform vec3 uHaze;
  uniform float uHazeK;
  varying vec3 vLocal;
  varying vec3 vN;
  varying vec2 vSeed;
  varying float vDist;
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
  void main() {
    float seed = vSeed.x;
    float style = vSeed.y;
    vec3 base = mix(vec3(0.05, 0.055, 0.075), vec3(0.11, 0.105, 0.12), h(vec2(seed, 3.0)));
    if (style > 2.5) base = vec3(0.13, 0.12, 0.115);
    float stain = n2(vLocal.xy * vec2(0.15, 0.06) + seed) * 0.6 + n2(vLocal.zy * vec2(0.4, 0.1) + seed * 2.0) * 0.4;
    vec3 col = base * (0.7 + 0.5 * stain);
    if (abs(vN.y) < 0.5) {
      float u = abs(vN.x) > 0.5 ? vLocal.z : vLocal.x;
      float v = vLocal.y;
      vec2 cellSize = style < 0.5 ? vec2(1.9, 3.2) : style < 1.5 ? vec2(5.5, 3.4) : style < 2.5 ? vec2(1.4, 3.2) : vec2(2.6, 3.0);
      vec2 cell = vec2(u / cellSize.x, v / cellSize.y);
      vec2 id = floor(cell);
      vec2 f = fract(cell);
      float win;
      if (style < 0.5) win = step(0.2, f.x) * step(f.x, 0.8) * step(0.3, f.y) * step(f.y, 0.8);
      else if (style < 1.5) win = step(0.04, f.x) * step(f.x, 0.96) * step(0.35, f.y) * step(f.y, 0.78);
      else if (style < 2.5) win = step(0.32, f.x) * step(f.x, 0.68) * step(0.15, f.y) * step(f.y, 0.88);
      else win = step(0.25, f.x) * step(f.x, 0.75) * step(0.32, f.y) * step(f.y, 0.75);
      float r = h(id + seed * 17.0);
      float litFrac = 0.25 + 0.4 * h(vec2(seed, 7.0));
      float lit = step(1.0 - litFrac, r);
      float tv = step(0.988, h(id + seed * 3.0)) * (0.6 + 0.4 * sin(uTime * 7.0 + r * 40.0) * sin(uTime * 3.1 + r * 9.0));
      vec3 warm = mix(vec3(1.0, 0.6, 0.28), vec3(1.0, 0.8, 0.5), h(id + 9.0));
      vec3 cool = vec3(0.6, 0.72, 1.0);
      vec3 wc = h(id + seed) < 0.85 ? warm : cool;
      float bright = 0.45 + 0.75 * h(id * 1.7 + seed);
      float blind = 0.7 + 0.3 * step(0.5, fract(f.y * 5.0 + h(id) * 3.0));
      vec3 glass = vec3(0.025, 0.03, 0.045) + vec3(0.03, 0.035, 0.05) * h(id + 2.0);
      col = mix(col, glass, win);
      col += win * (lit * wc * bright * blind * 1.1 + tv * vec3(0.3, 0.42, 0.85));
      col *= 0.78 + 0.22 * step(0.1, fract(cell.y));
      if (style < 0.5) col *= 0.85 + 0.15 * step(0.2, fract(u / (cellSize.x * 4.0)));
      if (style > 1.5 && style < 2.5) col += vec3(0.02) * step(0.9, fract(u / cellSize.x));
    } else {
      col = vec3(0.03, 0.03, 0.04);
    }
    float haze = 1.0 - exp(-vDist * uHazeK);
    col = mix(col, uHaze, haze * 0.86);
    gl_FragColor = vec4(col, 1.0);
  }`;

export function buildCity(scene) {
  const city = new THREE.Group();
  city.name = "city";
  scene.add(city);
  const animated = [];
  const rand = rng(1234);
  const haze = new THREE.Color(0x35405a);

  /* sky */
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vP; uniform float uTime;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        void main(){
          vec3 d = normalize(vP);
          float y = d.y;
          vec3 top = vec3(0.025, 0.032, 0.06);
          vec3 mid = vec3(0.09, 0.11, 0.17);
          vec3 hor = vec3(0.24, 0.24, 0.3);
          vec3 col = mix(hor, mid, smoothstep(-0.02, 0.2, y));
          col = mix(col, top, smoothstep(0.2, 0.65, y));
          float c = n(d.xz / max(0.15, d.y + 0.3) * 2.0 + vec2(uTime * 0.004, 0.0)) * 0.6 + n(d.xz * 9.0 / max(0.2, d.y + 0.3)) * 0.4;
          c = smoothstep(0.45, 0.95, c) * smoothstep(0.0, 0.3, y);
          col += vec3(0.08, 0.08, 0.1) * c;
          gl_FragColor = vec4(col, 1.0);
        }`
    })
  );
  city.add(sky);
  animated.push((t) => { sky.material.uniforms.uTime.value = t; });

  /* towers */
  const rows = [
    // a closer mid-rise band (the sign building lives here)
    { n: 7, z: [-30, -36], x: [-26, 26], w: [10, 16], d: [10, 14], top: [6, 16], styles: [3, 0] },
    { n: 16, z: [-80, -105], x: [-80, 80], w: [14, 26], d: [14, 24], top: [30, 80], styles: [0, 1, 2] },
    { n: 24, z: [-150, -210], x: [-150, 150], w: [16, 30], d: [16, 28], top: [55, 130], styles: [0, 1, 2] },
    { n: 30, z: [-280, -380], x: [-260, 260], w: [20, 40], d: [20, 36], top: [80, 190], styles: [0, 1, 2] }
  ];
  const total = rows.reduce((s, r) => s + r.n, 0);
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const sizes = new Float32Array(total * 3);
  const seeds = new Float32Array(total * 2);
  const mat = new THREE.ShaderMaterial({
    fog: false,
    uniforms: { uTime: { value: 0 }, uHaze: { value: haze }, uHazeK: { value: 0.0045 } },
    vertexShader: buildingVert,
    fragmentShader: buildingFrag
  });
  const mesh = new THREE.InstancedMesh(geo, mat, total);
  const m4 = new THREE.Matrix4();
  const tops = [];
  let i = 0;
  rows.forEach((row, ri) => {
    const span = row.x[1] - row.x[0];
    for (let k = 0; k < row.n; k++) {
      const w = row.w[0] + rand() * (row.w[1] - row.w[0]);
      const d = row.d[0] + rand() * (row.d[1] - row.d[0]);
      const top = row.top[0] + rand() * (row.top[1] - row.top[0]);
      const hgt = top - GROUND;
      let x = row.x[0] + (span * (k + 0.2 + rand() * 0.6)) / row.n;
      // keep a gap in the near band so the towers read through the window
      if (ri === 0 && Math.abs(x) < 8) x = x < 0 ? -10 - rand() * 4 : 12 + rand() * 6;
      const z = row.z[0] + rand() * (row.z[1] - row.z[0]) - d / 2;
      m4.compose(new THREE.Vector3(x, GROUND + hgt / 2, z), new THREE.Quaternion(), new THREE.Vector3(w, hgt, d));
      mesh.setMatrixAt(i, m4);
      sizes.set([w, hgt, d], i * 3);
      seeds.set([rand() * 100, row.styles[(rand() * row.styles.length) | 0]], i * 2);
      tops.push({ x, z, w, d, top, row: ri });
      i++;
    }
  });
  geo.setAttribute("aSize", new THREE.InstancedBufferAttribute(sizes, 3));
  geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 2));
  mesh.frustumCulled = false;
  city.add(mesh);
  animated.push((t) => { mat.uniforms.uTime.value = t; });

  /* rooftop water tanks, antennas, red aviation lights */
  const dark = new THREE.MeshBasicMaterial({ color: 0x0b0c12, fog: false });
  const tank = (x, y, z, s) => {
    const tw = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.1 * s, 1.1 * s, 2.1 * s, 12), dark);
    body.position.y = 2.7 * s;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.2 * s, 0.9 * s, 12), dark);
    roof.position.y = 4.1 * s;
    tw.add(body, roof);
    for (let k = 0; k < 4; k++) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12 * s, 1.7 * s, 0.12 * s), dark);
      leg.position.set(Math.cos(k * 1.57) * 0.8 * s, 0.85 * s, Math.sin(k * 1.57) * 0.8 * s);
      tw.add(leg);
    }
    tw.position.set(x, y, z);
    city.add(tw);
  };
  for (const b of tops) {
    if (b.row <= 1 && rand() < 0.5) tank(b.x + (rand() - 0.5) * b.w * 0.4, b.top, b.z + (rand() - 0.5) * b.d * 0.3, b.row === 0 ? 1 : 1.6);
    if (b.row >= 1 && rand() < 0.4) {
      const ah = 6 + rand() * 16;
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.25, ah, 5), dark);
      ant.position.set(b.x, b.top + ah / 2, b.z);
      city.add(ant);
      const red = new THREE.MeshBasicMaterial({ color: 0xff2020, fog: false });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), red);
      lamp.position.set(b.x, b.top + ah, b.z);
      city.add(lamp);
      const phase = rand() * 6;
      animated.push((t) => {
        const on = Math.sin(t * 1.6 + phase) > 0.6;
        red.color.setRGB(on ? 3 : 0.12, on ? 0.2 : 0.02, on ? 0.2 : 0.02);
      });
    }
  }
  // the water tank seen over the fence on the right in the photo
  tank(14, 4, -46, 1.6);

  /* the red ホテル sign on a mid-rise to the left */
  const signTex = canvasTexture(256, 1024, (g, w, h) => {
    g.fillStyle = "#14070a";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#3a0f16";
    g.lineWidth = 10;
    g.strokeRect(8, 8, w - 16, h - 16);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "bold 190px 'Hiragino Sans', 'Yu Gothic', sans-serif";
    for (const [blur, col] of [[40, "#ff2a46"], [16, "#ff4a62"], [0, "#ffd6de"]]) {
      g.shadowColor = "#ff1f40";
      g.shadowBlur = blur;
      g.fillStyle = col;
      ["ホ", "テ", "ル"].forEach((ch, k) => g.fillText(ch, w / 2, 190 + k * 300));
    }
  });
  const signMat = new THREE.MeshBasicMaterial({ map: signTex, fog: false, color: new THREE.Color(1.4, 1.4, 1.4) });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(1.3, 5.0, 0.3), [dark, dark, dark, dark, signMat, dark]);
  sign.position.set(-4.2, 3.6, -27.6);
  sign.rotation.y = 0.12;
  city.add(sign);
  animated.push((t) => {
    const k = Math.sin(t * 13.0) > 0.985 ? 0.35 : 1;
    signMat.color.setScalar(1.4 * k);
  });
  // a street-light glare between buildings (photo: bright point right of centre)
  const glare = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4.4, 5), fog: false }));
  glare.position.set(9, 2.6, -40);
  city.add(glare);

  /* rain */
  const COUNT = 2600;
  const rp = new Float32Array(COUNT * 6);
  const rr = rng(77);
  for (let k = 0; k < COUNT; k++) {
    const x = (rr() - 0.5) * 22, y = GROUND + rr() * 40, z = -3.4 - rr() * 14;
    const len = 0.25 + rr() * 0.35;
    rp.set([x, y, z, x + 0.04, y - len, z], k * 6);
  }
  const rgeo = new THREE.BufferGeometry();
  rgeo.setAttribute("position", new THREE.BufferAttribute(rp, 3));
  const rmat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      uniform float uTime; varying float vA;
      void main(){
        vec3 p = position;
        float span = 40.0;
        p.y = mod(p.y - uTime * 9.0 - ${GROUND.toFixed(1)}, span) + ${GROUND.toFixed(1)};
        p.x += (p.y - ${GROUND.toFixed(1)}) * 0.02;
        vA = 0.35 + 0.65 * fract(position.x * 13.7);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(0.62, 0.68, 0.85, 0.26 * vA); }`
  });
  const rain = new THREE.LineSegments(rgeo, rmat);
  rain.frustumCulled = false;
  city.add(rain);
  animated.push((t) => { rmat.uniforms.uTime.value = t; });

  /* a train crossing on an elevated line every so often */
  const train = new THREE.Group();
  train.userData.dynamic = true;   // crosses the skyline
  const carMat = new THREE.MeshBasicMaterial({ color: 0x0a0a10, fog: false });
  const winMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.4, 1.15), fog: false });
  for (let c = 0; c < 6; c++) {
    const car = new THREE.Mesh(new THREE.BoxGeometry(18, 3, 3), carMat);
    car.position.x = c * 18.6;
    train.add(car);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(16, 0.9), winMat);
    strip.position.set(c * 18.6, 0.3, 1.52);
    train.add(strip);
  }
  train.position.set(-300, GROUND + 26, -70);
  city.add(train);
  let trainT = 30;
  animated.push((t, dt) => {
    trainT -= dt;
    if (trainT < 0) {
      train.position.x += dt * 30;
      if (train.position.x > 220) { train.position.x = -300; trainT = 40 + Math.random() * 40; }
    }
  });

  return { city, animated };
}
