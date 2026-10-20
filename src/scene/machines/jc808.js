// The JC-808 on an X-stand by the window — the "synth on the right" from the
// reference images. Step LEDs, play button and scope follow the live sequencer.
import * as THREE from "three";
import { box, cyl, group, std, glow } from "../kit3d.js";
import { canvasTexture, LiveScreen } from "../textures.js";
import { machine, ledMat } from "./common.js";

const STEP_COLORS = [0xd8382c, 0xe8792a, 0xe8bf2c, 0xd9d2c2];
const VOICES = ["BD", "SD", "LT", "MT", "HT", "RS", "CP", "CB", "CH", "OH", "CY", "MA"];

export function buildJC808(parent, studio) {
  const root = group({ parent, x: 1.08, z: -1.6, ry: -0.62, name: "jc808" });

  /* ---------- X-stand ---------- */
  const steel = std(0x111114, { metal: 0.7, rough: 0.35 });
  const rubber = std(0x050505, { rough: 0.9 });
  const len = Math.hypot(0.56, 0.78), ang = Math.atan2(0.78, 0.56);
  box(len, 0.03, 0.03, steel, { parent: root, y: 0.41, rz: ang, cast: true });
  box(len, 0.03, 0.03, steel, { parent: root, y: 0.41, z: 0.035, rz: -ang, cast: true });
  cyl(0.022, 0.022, 0.09, std(0x3a3a3e, { metal: 0.6, rough: 0.3 }), { parent: root, y: 0.41, z: 0.02, rx: Math.PI / 2 });
  for (const sx of [-0.28, 0.28]) {
    box(0.03, 0.03, 0.42, steel, { parent: root, x: sx, y: 0.8, cast: true });
    box(0.032, 0.032, 0.5, steel, { parent: root, x: sx, y: 0.016, z: 0.02, cast: true });
    for (const sz of [-0.25, 0.27]) box(0.04, 0.04, 0.04, rubber, { parent: root, x: sx, y: 0.02, z: sz });
    for (const sz of [-0.21, 0.21]) box(0.04, 0.04, 0.03, rubber, { parent: root, x: sx, y: 0.8, z: sz });
  }

  /* ---------- instrument body ---------- */
  const inst = group({ parent: root, y: 0.815 });
  const chassis = std(0x232327, { rough: 0.55, metal: 0.2 });
  const panel = std(0x1b1b1f, { rough: 0.5, metal: 0.25 });
  const walnut = std(0x4a2c18, { rough: 0.5 });
  box(0.86, 0.06, 0.4, chassis, { parent: inst, y: 0.03, cast: true });
  box(0.86, 0.035, 0.24, panel, { parent: inst, y: 0.075, z: -0.08, rx: -0.09, cast: true });
  for (const sx of [-0.445, 0.445]) box(0.032, 0.115, 0.42, walnut, { parent: inst, x: sx, y: 0.055, r: 0.008, cast: true });
  box(0.86, 0.008, 0.02, std(0x3a3a40, { metal: 0.6, rough: 0.3 }), { parent: inst, y: 0.062, z: 0.198 });

  // silkscreen: logo + voice names
  const logo = canvasTexture(1024, 160, (g, w, h) => {
    g.fillStyle = "#1b1b1f";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#ece5d5";
    g.font = "bold 92px 'Helvetica Neue', Arial, sans-serif";
    g.fillText("JC-808", 24, 100);
    g.fillStyle = "#ff5b1f";
    g.font = "34px 'Helvetica Neue', Arial";
    g.fillText("RHYTHM COMPOSER", 380, 72);
    g.fillStyle = "#9d968a";
    g.font = "24px monospace";
    g.fillText("ANALOGUE-MODELLED · 12 VOICES · SEQUENCER · SYNTH", 380, 116);
  });
  const logoPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.078), std(0xffffff, { map: logo, rough: 0.6 }));
  logoPlane.position.set(-0.17, 0.094, -0.165);
  logoPlane.rotation.x = -Math.PI / 2 - 0.09;
  inst.add(logoPlane);

  const names = canvasTexture(1024, 48, (g, w, h) => {
    g.fillStyle = "#1b1b1f";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#ece5d5";
    g.font = "bold 22px monospace";
    g.textAlign = "center";
    VOICES.forEach((v, i) => g.fillText(v, ((i + 0.5) * w) / 12, 32));
  });
  const namePlane = new THREE.Mesh(new THREE.PlaneGeometry(0.76, 0.036), std(0xffffff, { map: names, rough: 0.6 }));
  namePlane.position.set(0, 0.0905, -0.022);
  namePlane.rotation.x = -Math.PI / 2 - 0.09;
  inst.add(namePlane);

  // voice knobs (level / tune), instanced
  const knobGeo = new THREE.CylinderGeometry(0.0105, 0.012, 0.016, 18);
  const knobMat = std(0x2c2c31, { rough: 0.4, metal: 0.3 });
  const knobs = new THREE.InstancedMesh(knobGeo, knobMat, 24);
  const tickGeo = new THREE.BoxGeometry(0.002, 0.0175, 0.009);
  const ticks = new THREE.InstancedMesh(tickGeo, std(0xece5d5, { rough: 0.5 }), 24);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.09, 0, 0));
  for (let i = 0; i < 12; i++) {
    for (let r = 0; r < 2; r++) {
      const x = -0.38 + (i + 0.5) * (0.76 / 12);
      const z = -0.075 - r * 0.05;
      const y = 0.1 + r * 0.0045;
      const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.09, (i * 0.7 + r) % 2.5 - 1.2, 0));
      m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
      knobs.setMatrixAt(i * 2 + r, m4);
      const tickPos = new THREE.Vector3(0, 0, 0.005).applyQuaternion(rot).add(new THREE.Vector3(x, y + 0.0005, z));
      m4.compose(tickPos, rot, new THREE.Vector3(1, 1, 1));
      ticks.setMatrixAt(i * 2 + r, m4);
    }
  }
  knobs.castShadow = true;
  inst.add(knobs, ticks);

  // 16 step buttons with LEDs
  const steps = [];
  for (let k = 0; k < 16; k++) {
    const col = STEP_COLORS[Math.floor(k / 4)];
    const mat = ledMat(col, 0.04);
    const b = box(0.034, 0.014, 0.03, mat, { parent: inst, x: -0.345 + k * 0.046, y: 0.088, z: 0.02, r: 0.004 });
    const led = new THREE.MeshBasicMaterial({ color: 0x220806 });
    const ledMesh = box(0.006, 0.003, 0.006, led, { parent: inst, x: -0.345 + k * 0.046, y: 0.096, z: -0.001 });
    steps.push({ mat, led, mesh: b, ledMesh });
  }

  // keyboard: 22 white keys + blacks, left of the transport section
  const whiteMat = std(0xeee7d8, { rough: 0.35 });
  const blackMat = std(0x101012, { rough: 0.35 });
  const keys = [];
  const WK = 0.0222;
  const kx0 = -0.405;
  const whiteSemis = [0, 2, 4, 5, 7, 9, 11];
  for (let k = 0; k < 22; k++) {
    const key = box(WK - 0.0016, 0.016, 0.12, whiteMat, { parent: inst, x: kx0 + k * WK + WK / 2, y: 0.067, z: 0.13, cast: true });
    const midi = 48 + Math.floor(k / 7) * 12 + whiteSemis[k % 7];
    keys.push({ mesh: key, midi, rest: 0.067 });
  }
  const blackAfter = [0, 1, 3, 4, 5];
  for (let o = 0; o < 4; o++) {
    for (const a of blackAfter) {
      const wi = o * 7 + a;
      if (wi >= 21) continue;
      const key = box(0.012, 0.016, 0.075, blackMat, { parent: inst, x: kx0 + (wi + 1) * WK, y: 0.078, z: 0.105, cast: true });
      const midi = 48 + o * 12 + whiteSemis[a] + 1;
      keys.push({ mesh: key, midi, rest: 0.078 });
    }
  }

  // transport: play button, bank buttons, tempo display, master knobs
  const playMat = ledMat(0x2f8f57, 0.15);
  const play = cyl(0.022, 0.024, 0.016, playMat, { parent: inst, x: 0.17, y: 0.068, z: 0.12 });
  cyl(0.026, 0.026, 0.006, std(0x3a3a40, { metal: 0.6 }), { parent: inst, x: 0.17, y: 0.061, z: 0.12 });
  // REC button: glows and pulses while a synth take is being recorded
  const recMat = ledMat(0xff2020, 0.03);
  box(0.022, 0.012, 0.022, recMat, { parent: inst, x: 0.2, y: 0.066, z: 0.15, r: 0.003 });
  const banks = [];
  for (let b = 0; b < 4; b++) {
    const mat = ledMat(0xff6b2c, 0.03);
    box(0.022, 0.012, 0.022, mat, { parent: inst, x: 0.235 + b * 0.03, y: 0.066, z: 0.15, r: 0.003 });
    banks.push(mat);
  }
  for (let k = 0; k < 4; k++) {
    cyl(0.013, 0.015, 0.02, knobMat, { parent: inst, x: 0.24 + k * 0.045, y: 0.07, z: 0.085 });
  }
  const tempoScreen = new LiveScreen(256, 96, (g, w, h, bpm, playing) => {
    g.fillStyle = "#130504";
    g.fillRect(0, 0, w, h);
    g.font = "bold 70px 'DSEG7 Classic', 'Courier New', monospace";
    g.textAlign = "right";
    g.fillStyle = "rgba(255,80,30,0.13)";
    g.fillText("888", w - 16, 74);
    g.fillStyle = playing ? "#ff5b1f" : "#c2410f";
    g.shadowColor = "#ff5b1f";
    g.shadowBlur = 14;
    g.fillText(String(bpm).padStart(3, " "), w - 16, 74);
    g.shadowBlur = 0;
  });
  tempoScreen.update(120, false);
  const tempo = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.026), new THREE.MeshBasicMaterial({ map: tempoScreen.texture, toneMapped: false }));
  tempo.position.set(0.35, 0.0605, 0.165);
  tempo.rotation.x = -Math.PI / 2;
  inst.add(tempo);

  // scope on the back panel
  const scope = new LiveScreen(320, 120, (g, w, h, data, playing) => {
    g.fillStyle = "#0b0a09";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(255,120,60,0.12)";
    g.lineWidth = 1;
    for (let x = 0; x < w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y < h; y += 30) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.strokeStyle = playing ? "#ff6a2a" : "#5d5850";
    g.lineWidth = 2.5;
    g.shadowColor = "#ff5b1f";
    g.shadowBlur = playing ? 8 : 0;
    g.beginPath();
    const n = data ? data.length : 0;
    for (let i = 0; i < w; i++) {
      const v = n ? data[Math.floor((i / w) * n)] : 0;
      const y = h / 2 + v * h * 0.42;
      i ? g.lineTo(i, y) : g.moveTo(i, y);
    }
    g.stroke();
    g.shadowBlur = 0;
  });
  scope.update(null, false);
  const scopeMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.056), new THREE.MeshBasicMaterial({ map: scope.texture, toneMapped: false }));
  scopeMesh.position.set(0.29, 0.0955, -0.165);
  scopeMesh.rotation.x = -Math.PI / 2 - 0.09;
  inst.add(scopeMesh);
  box(0.16, 0.004, 0.066, std(0x0a0a0a, { rough: 0.3 }), { parent: inst, x: 0.29, y: 0.0935, z: -0.165, rx: -0.09 });

  // power LED + cable at the back
  const power = box(0.006, 0.006, 0.006, glow(0xff3020, 2.5), { parent: inst, x: 0.41, y: 0.098, z: -0.17 });
  power.castShadow = false;

  const m = machine({
    id: "jc808",
    label: "JC-808 Rhythm Composer",
    hint: "Drum machine · sequencer · synth",
    zone: "studio",
    root,
    hit: [0.92, 0.32, 0.5],
    hitOffset: [0, 0.88, 0.02],
    focus: { pos: [0, 1.48, 0.98], target: [0, 0.86, 0.0], hfov: 56 }
  });

  let scopeTimer = 0;
  let lastBpm = -1, lastPlaying = null;
  const scopeBuf = new Float32Array(256);
  m.update = (dt, t) => {
    const s = studio.state.jc808;
    const playing = !!(s && s.playing);
    const cur = s ? s.step : -1;
    const pattern = s ? s.pattern : null;
    for (let k = 0; k < 16; k++) {
      const on = pattern ? pattern[k] : false;
      const head = playing && k === cur;
      const target = head ? 2.4 : on ? 0.55 : 0.04;
      const st = steps[k];
      st.mat.emissiveIntensity += (target - st.mat.emissiveIntensity) * Math.min(1, dt * 24);
      st.led.color.setRGB(head ? 3 : on ? 0.9 : 0.12, head ? 0.6 : on ? 0.12 : 0.02, head ? 0.3 : 0.02);
    }
    playMat.emissiveIntensity = playing ? 1.4 + Math.sin(t * 8) * 0.2 : 0.15;
    recMat.emissiveIntensity = s && s.recording ? 1.7 + Math.sin(t * 7) * 0.7 : 0.03;
    const bank = s ? s.bank : 0;
    banks.forEach((mat, i) => { mat.emissiveIntensity = i === bank ? 1.6 : 0.03; });
    // keys pressed by the synth
    const held = s && s.keys;
    for (const k of keys) {
      const down = held ? held.has(k.midi) : false;
      const ty = k.rest - (down ? 0.006 : 0);
      k.mesh.position.y += (ty - k.mesh.position.y) * Math.min(1, dt * 30);
    }
    const bpm = s ? s.bpm : 120;
    if (bpm !== lastBpm || playing !== lastPlaying) {
      tempoScreen.update(bpm, playing);
      lastBpm = bpm;
      lastPlaying = playing;
    }
    scopeTimer -= dt;
    if (scopeTimer <= 0) {
      scopeTimer = 1 / 20;
      const src = s && s.scope ? s.scope() : null;
      if (src) {
        const step = src.length / scopeBuf.length;
        for (let i = 0; i < scopeBuf.length; i++) scopeBuf[i] = src[Math.floor(i * step)] / 128 - 1;
        scope.update(scopeBuf, playing);
      } else if (lastPlaying === false) {
        scope.update(null, false);
      }
    }
  };
  return { machines: [m] };
}
