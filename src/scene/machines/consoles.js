// Three retro consoles on the shelf. The NES's power light comes on while
// Chipify is playing a chiptune.
import * as THREE from "three";
import { box, cyl, group, std } from "../kit3d.js";
import { canvasTexture } from "../textures.js";
import { ledMat } from "./common.js";

export function buildConsoles(parent, studio, anchor) {
  const root = group({ parent, x: anchor.x, y: anchor.y, z: anchor.z, ry: Math.PI / 2 });
  const leds = {};

  // NES-style: two-tone grey box with a flip lid
  const nes = group({ parent: root, x: 0.255 });
  box(0.18, 0.06, 0.2, std(0xb9b6b0, { rough: 0.6 }), { parent: nes, y: 0.03, cast: true });
  box(0.18, 0.012, 0.09, std(0x6f6c68, { rough: 0.6 }), { parent: nes, y: 0.054, z: 0.04 });
  box(0.12, 0.004, 0.07, std(0x9a9792, { rough: 0.6 }), { parent: nes, y: 0.062, z: -0.03 });
  box(0.18, 0.02, 0.006, std(0x1c1c1c), { parent: nes, y: 0.02, z: 0.101 });
  for (const sx of [-0.06, -0.035]) box(0.018, 0.008, 0.004, std(0xd8d4cc), { parent: nes, x: sx, y: 0.02, z: 0.105 });
  leds.nintendo = ledMat(0xff2010, 0.08);
  box(0.006, 0.006, 0.004, leds.nintendo, { parent: nes, x: -0.075, y: 0.035, z: 0.102 });

  // Genesis-style: black wedge with a round cart well
  const gen = group({ parent: root, x: 0.03 });
  box(0.2, 0.05, 0.2, std(0x141416, { rough: 0.35 }), { parent: gen, y: 0.025, r: 0.01, cast: true });
  cyl(0.07, 0.075, 0.012, std(0x0a0a0b, { rough: 0.3 }), { parent: gen, y: 0.054, seg: 32 });
  box(0.06, 0.01, 0.025, std(0x050505), { parent: gen, y: 0.06 });
  const genLabel = canvasTexture(128, 32, (g, w, h) => {
    g.fillStyle = "#141416";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#e02020";
    g.font = "bold 20px Arial";
    g.fillText("16-BIT", 8, 23);
  });
  const gl = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.015), std(0xffffff, { map: genLabel }));
  gl.rotation.x = -Math.PI / 2;
  gl.position.set(0.05, 0.051, 0.07);
  gen.add(gl);
  leds.sega = ledMat(0xff2010, 0.08);
  box(0.006, 0.006, 0.004, leds.sega, { parent: gen, x: -0.07, y: 0.03, z: 0.101 });

  // C64-style breadbin with a keyboard
  const c64 = group({ parent: root, x: -0.215 });
  box(0.24, 0.05, 0.13, std(0xb4a888, { rough: 0.6 }), { parent: c64, y: 0.025, rx: 0.05, r: 0.012, cast: true });
  const keys = canvasTexture(256, 96, (g, w, h) => {
    g.fillStyle = "#3a2a20";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#6a5040";
    for (let r = 0; r < 5; r++) for (let c = 0; c < 16; c++) g.fillRect(4 + c * 15 + r * 2, 4 + r * 18, 12, 14);
    g.fillStyle = "#c8a070";
    for (let c = 0; c < 4; c++) g.fillRect(4 + 15 * 16 - 6, 4 + c * 18, 12, 14);
  });
  const kp = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.075), std(0xffffff, { map: keys, rough: 0.6 }));
  kp.rotation.x = -Math.PI / 2 + 0.12;
  kp.position.set(0, 0.052, 0.01);
  c64.add(kp);
  leds.commodore = ledMat(0xff2010, 0.08);
  box(0.006, 0.004, 0.006, leds.commodore, { parent: c64, x: 0.1, y: 0.05, z: -0.03 });

  const animate = (t, dt) => {
    const playing = studio.state.chipify && studio.state.chipify.playing;
    for (const [k, mat] of Object.entries(leds)) {
      const target = k === "nintendo" ? (playing ? 2.2 : 0.6) : 0.08;
      mat.emissiveIntensity += (target - mat.emissiveIntensity) * Math.min(1, dt * 6);
    }
  };
  return { machines: [], animated: [animate], lights: {} };
}
