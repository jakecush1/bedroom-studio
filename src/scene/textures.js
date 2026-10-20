// Procedural canvas textures — the room is built without any image files.
import * as THREE from "three";

// deterministic PRNG so the room looks the same on every visit
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

export function canvasTexture(w, h, draw, { srgb = true, repeat = null, aniso = 4 } = {}) {
  const c = makeCanvas(w, h);
  const g = c.getContext("2d");
  draw(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  return tex;
}

function speckle(g, w, h, rand, count, alpha, size = 2, colors = ["#000"]) {
  for (let i = 0; i < count; i++) {
    g.globalAlpha = alpha * rand();
    g.fillStyle = colors[(rand() * colors.length) | 0];
    const s = size * (0.3 + rand());
    g.fillRect(rand() * w, rand() * h, s, s);
  }
  g.globalAlpha = 1;
}

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

export function plasterTexture(seed = 3, base = "#8d7a63") {
  const rand = rng(seed);
  return canvasTexture(1024, 1024, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    // big soft blotches of grime and damp
    for (let i = 0; i < 70; i++) {
      const x = rand() * w, y = rand() * h, r = 40 + rand() * 220;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      const dark = rand() < 0.65;
      grad.addColorStop(0, dark ? `rgba(40,28,18,${0.05 + rand() * 0.12})` : `rgba(190,170,140,${0.04 + rand() * 0.08})`);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // vertical water streaks
    for (let i = 0; i < 26; i++) {
      const x = rand() * w;
      const len = 80 + rand() * 500;
      const y = rand() * h * 0.6;
      const grad = g.createLinearGradient(0, y, 0, y + len);
      grad.addColorStop(0, "rgba(35,25,15,0)");
      grad.addColorStop(0.3, `rgba(35,25,15,${0.05 + rand() * 0.1})`);
      grad.addColorStop(1, "rgba(35,25,15,0)");
      g.fillStyle = grad;
      g.fillRect(x, y, 2 + rand() * 7, len);
    }
    speckle(g, w, h, rand, 9000, 0.25, 2, ["#3b2c1e", "#b8a587", "#5a4632"]);
    // hairline cracks
    g.strokeStyle = "rgba(30,20,12,0.35)";
    g.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      let x = rand() * w, y = rand() * h;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 14; k++) {
        x += (rand() - 0.5) * 28;
        y += rand() * 22;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  }, { repeat: [1, 1] });
}

export function woodFloorTexture(seed = 7) {
  const rand = rng(seed);
  return canvasTexture(1024, 1024, (g, w, h) => {
    const planks = 8;
    const pw = w / planks;
    for (let p = 0; p < planks; p++) {
      let y = -rand() * 400;
      while (y < h) {
        const len = 260 + rand() * 520;
        const tone = 0.75 + rand() * 0.4;
        const r = Math.floor(92 * tone), gg = Math.floor(58 * tone), b = Math.floor(34 * tone);
        g.fillStyle = `rgb(${r},${gg},${b})`;
        g.fillRect(p * pw, y, pw, len);
        // grain lines
        for (let k = 0; k < 18; k++) {
          g.strokeStyle = `rgba(${rand() < 0.5 ? "40,24,12" : "140,96,60"},${0.08 + rand() * 0.14})`;
          g.lineWidth = 1 + rand() * 1.5;
          g.beginPath();
          const gx = p * pw + rand() * pw;
          g.moveTo(gx, y);
          g.bezierCurveTo(gx + (rand() - 0.5) * 18, y + len * 0.3, gx + (rand() - 0.5) * 18, y + len * 0.7, gx + (rand() - 0.5) * 10, y + len);
          g.stroke();
        }
        // knots
        if (rand() < 0.35) {
          const kx = p * pw + pw * (0.2 + rand() * 0.6), ky = y + rand() * len;
          const grad = g.createRadialGradient(kx, ky, 0, kx, ky, 10 + rand() * 10);
          grad.addColorStop(0, "rgba(30,16,8,0.7)");
          grad.addColorStop(1, "rgba(30,16,8,0)");
          g.fillStyle = grad;
          g.fillRect(kx - 25, ky - 25, 50, 50);
        }
        g.fillStyle = "rgba(15,8,4,0.85)";
        g.fillRect(p * pw, y + len - 2, pw, 3);
        y += len;
      }
      g.fillStyle = "rgba(10,6,3,0.9)";
      g.fillRect(p * pw, 0, 3, h);
    }
    speckle(g, w, h, rand, 5000, 0.2, 2, ["#1a0f08", "#a07450"]);
    // scuffs
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = `rgba(200,170,130,${0.03 + rand() * 0.05})`;
      g.lineWidth = 1 + rand() * 3;
      g.beginPath();
      const x = rand() * w, y = rand() * h;
      g.moveTo(x, y);
      g.lineTo(x + (rand() - 0.5) * 120, y + (rand() - 0.5) * 30);
      g.stroke();
    }
  }, { repeat: [1.6, 2.4] });
}

export function darkWoodTexture(seed = 11, base = [70, 44, 26]) {
  const rand = rng(seed);
  return canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
    g.fillRect(0, 0, w, h);
    for (let k = 0; k < 160; k++) {
      g.strokeStyle = `rgba(${rand() < 0.6 ? "25,14,6" : "130,90,55"},${0.05 + rand() * 0.12})`;
      g.lineWidth = 0.5 + rand() * 2;
      const y = rand() * h;
      g.beginPath();
      g.moveTo(0, y);
      g.bezierCurveTo(w * 0.3, y + (rand() - 0.5) * 20, w * 0.6, y + (rand() - 0.5) * 20, w, y + (rand() - 0.5) * 8);
      g.stroke();
    }
    speckle(g, w, h, rand, 2500, 0.18, 2, ["#120a04", "#8a6040"]);
  }, { repeat: [1, 1] });
}

/** Persian rug: burgundy field, navy medallion, ornate borders. */
export function rugTexture(seed = 5) {
  const rand = rng(seed);
  return canvasTexture(1024, 2048, (g, w, h) => {
    const red = "#5e1412", deep = "#3c0b0a", navy = "#1a2038", cream = "#a8966f", gold = "#8a6028", teal = "#243e3e";
    g.fillStyle = deep;
    g.fillRect(0, 0, w, h);
    const frame = (inset, color, lw) => {
      g.strokeStyle = color;
      g.lineWidth = lw;
      g.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
    };
    // borders
    g.fillStyle = navy;
    g.fillRect(30, 30, w - 60, h - 60);
    g.fillStyle = red;
    g.fillRect(120, 120, w - 240, h - 240);
    frame(30, cream, 6);
    frame(60, gold, 3);
    frame(118, cream, 5);
    // border motif: repeating rosettes
    const rosette = (x, y, r, c1, c2) => {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        g.fillStyle = k % 2 ? c1 : c2;
        g.beginPath();
        g.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.45, r * 0.18, a, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = c2;
      g.beginPath();
      g.arc(x, y, r * 0.22, 0, Math.PI * 2);
      g.fill();
    };
    for (let x = 75; x < w - 40; x += 70) { rosette(x, 88, 26, cream, gold); rosette(x, h - 88, 26, cream, gold); }
    for (let y = 150; y < h - 120; y += 70) { rosette(88, y, 26, cream, gold); rosette(w - 88, y, 26, cream, gold); }
    // field pattern: small diamonds
    for (let y = 170; y < h - 160; y += 46) {
      for (let x = 170 + ((y / 46) % 2) * 23; x < w - 160; x += 46) {
        g.fillStyle = rand() < 0.5 ? "rgba(26,32,60,0.55)" : "rgba(168,116,47,0.35)";
        g.beginPath();
        g.moveTo(x, y - 9);
        g.lineTo(x + 7, y);
        g.lineTo(x, y + 9);
        g.lineTo(x - 7, y);
        g.closePath();
        g.fill();
      }
    }
    // central medallion
    const cx = w / 2, cy = h / 2;
    const layers = [[300, navy], [250, cream], [235, teal], [190, red], [150, navy], [110, gold], [80, red], [40, cream]];
    for (const [r, c] of layers) {
      g.fillStyle = c;
      g.beginPath();
      for (let k = 0; k <= 32; k++) {
        const a = (k / 32) * Math.PI * 2;
        const rr = r * (1 + 0.12 * Math.cos(a * 8)) * (1 + 0.35 * Math.abs(Math.sin(a)));
        const px = cx + Math.cos(a) * rr * 0.75, py = cy + Math.sin(a) * rr * 1.25;
        k ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.closePath();
      g.fill();
    }
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      rosette(cx + Math.cos(a) * 160, cy + Math.sin(a) * 270, 30, gold, cream);
    }
    // corner spandrels
    for (const [sx, sy] of [[170, 170], [w - 170, 170], [170, h - 170], [w - 170, h - 170]]) {
      g.fillStyle = navy;
      g.beginPath();
      g.arc(sx, sy, 120, 0, Math.PI * 2);
      g.fill();
      rosette(sx, sy, 60, cream, gold);
    }
    // wear: faded patches and fibers
    for (let i = 0; i < 60; i++) {
      const x = rand() * w, y = rand() * h, r = 30 + rand() * 160;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(${rand() < 0.5 ? "0,0,0" : "150,110,80"},${0.06 + rand() * 0.1})`);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    speckle(g, w, h, rand, 30000, 0.25, 2, ["#000", "#c9b48a", "#2a0805"]);
  }, { aniso: 8 });
}

export function fabricTexture(seed = 9, base = "#2b2f4a", repeat = [2, 2]) {
  const rand = rng(seed);
  return canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) {
      g.fillStyle = `rgba(255,255,255,${rand() * 0.035})`;
      g.fillRect(0, y, w, 1);
    }
    for (let x = 0; x < w; x += 2) {
      g.fillStyle = `rgba(0,0,0,${rand() * 0.05})`;
      g.fillRect(x, 0, 1, h);
    }
    speckle(g, w, h, rand, 4000, 0.15, 2, ["#000", "#8a8fb5"]);
  }, { repeat });
}

/* ------------------------------------------------------------------ */
/* Posters                                                             */
/* ------------------------------------------------------------------ */

function agePaper(g, w, h, rand, strength = 1) {
  // yellowed edges, creases and tape
  const grad = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, `rgba(60,40,15,${0.45 * strength})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = `rgba(255,255,255,${0.08 * strength})`;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, h * (0.3 + rand() * 0.4));
  g.lineTo(w, h * (0.3 + rand() * 0.4));
  g.stroke();
  speckle(g, w, h, rand, 1500, 0.15 * strength, 2, ["#2a1a08", "#fff"]);
  g.fillStyle = "rgba(220,210,170,0.55)";
  g.fillRect(w * 0.42, -6, w * 0.16, 26);
}

/** A stylised great-wave woodblock print (after Hokusai, public domain). */
export function wavePosterTexture() {
  const rand = rng(21);
  return canvasTexture(768, 1024, (g, w, h) => {
    g.fillStyle = "#d9c9a3";
    g.fillRect(0, 0, w, h);
    // sky
    const sky = g.createLinearGradient(0, 0, 0, h * 0.6);
    sky.addColorStop(0, "#c8b48e");
    sky.addColorStop(1, "#e2d4b0");
    g.fillStyle = sky;
    g.fillRect(30, 30, w - 60, h - 60);
    // mountain
    g.fillStyle = "#3c4a6b";
    g.beginPath();
    g.moveTo(w * 0.52, h * 0.62);
    g.lineTo(w * 0.6, h * 0.52);
    g.lineTo(w * 0.68, h * 0.62);
    g.fill();
    g.fillStyle = "#f2ecd8";
    g.beginPath();
    g.moveTo(w * 0.575, h * 0.555);
    g.lineTo(w * 0.6, h * 0.52);
    g.lineTo(w * 0.625, h * 0.555);
    g.fill();
    // the great curl
    const indigo = "#1f3561", mid = "#3f6a9a", foam = "#f4efe0";
    const curl = (cx, cy, r, s) => {
      g.fillStyle = indigo;
      g.beginPath();
      g.moveTo(cx - r * 1.6, cy + r * 1.8);
      g.bezierCurveTo(cx - r * 1.4, cy - r * 0.2, cx - r * 0.2, cy - r * 1.3, cx + r * 0.9, cy - r * 0.9);
      g.bezierCurveTo(cx + r * 1.3, cy - r * 0.7, cx + r * 1.2, cy - r * 0.1, cx + r * 0.7, cy + r * 0.1);
      g.bezierCurveTo(cx + r * 0.2, cy - r * 0.3, cx - r * 0.2, cy + r * 0.2, cx - r * 0.1, cy + r * 1.8);
      g.closePath();
      g.fill();
      g.strokeStyle = mid;
      g.lineWidth = 6 * s;
      for (let k = 0; k < 6; k++) {
        g.beginPath();
        g.moveTo(cx - r * (1.4 - k * 0.15), cy + r * 1.7);
        g.bezierCurveTo(cx - r * (1.2 - k * 0.1), cy - r * (0.1 - k * 0.05), cx, cy - r * (1.0 - k * 0.12), cx + r * (0.8 - k * 0.06), cy - r * (0.8 - k * 0.1));
        g.stroke();
      }
      // foam claws
      g.fillStyle = foam;
      for (let k = 0; k < 26; k++) {
        const t = k / 25;
        const a = -2.6 + t * 2.4;
        const fx = cx + Math.cos(a) * r * 0.95 + r * 0.2, fy = cy + Math.sin(a) * r * 0.85;
        g.beginPath();
        g.arc(fx, fy, (5 + rand() * 9) * s, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
        g.moveTo(fx, fy);
        g.lineTo(fx + (8 + rand() * 10) * s, fy + (12 + rand() * 10) * s);
        g.lineTo(fx - 4 * s, fy + 6 * s);
        g.fill();
      }
    };
    curl(w * 0.3, h * 0.48, 210, 1);
    curl(w * 0.75, h * 0.72, 70, 0.4);
    // sea base
    g.fillStyle = indigo;
    g.fillRect(30, h * 0.8, w - 60, h * 0.2 - 30);
    g.strokeStyle = mid;
    g.lineWidth = 4;
    for (let y = h * 0.82; y < h - 40; y += 18) {
      g.beginPath();
      for (let x = 30; x < w - 30; x += 30) g.quadraticCurveTo(x + 15, y - 8, x + 30, y);
      g.stroke();
    }
    // boats
    g.fillStyle = "#b8a079";
    for (const [bx, by, ang] of [[w * 0.38, h * 0.72, -0.4], [w * 0.62, h * 0.82, 0.2]]) {
      g.save();
      g.translate(bx, by);
      g.rotate(ang);
      g.fillRect(-90, -10, 180, 18);
      g.restore();
    }
    // cartouche
    g.fillStyle = "#e9dfc6";
    g.fillRect(48, 48, 70, 180);
    g.strokeStyle = "#5a3a20";
    g.strokeRect(48, 48, 70, 180);
    g.fillStyle = "#3a2410";
    g.font = "bold 34px serif";
    ["神", "奈", "川", "沖"].forEach((ch, i) => g.fillText(ch, 66, 92 + i * 38));
    agePaper(g, w, h, rand, 1);
  });
}

/** Vertical neon-street poster with 東京. */
export function tokyoPosterTexture() {
  const rand = rng(33);
  return canvasTexture(512, 1024, (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#0d0b1d");
    bg.addColorStop(0.55, "#2a1338");
    bg.addColorStop(1, "#0a0812");
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    // street perspective with light trails
    const vx = w * 0.5, vy = h * 0.55;
    for (let i = 0; i < 60; i++) {
      const side = rand() < 0.5 ? -1 : 1;
      const x0 = vx + side * (20 + rand() * 280);
      g.strokeStyle = rand() < 0.5 ? `rgba(255,${80 + rand() * 80},${120 + rand() * 80},${0.4 + rand() * 0.5})` : `rgba(${120 + rand() * 80},${200 + rand() * 55},255,${0.35 + rand() * 0.5})`;
      g.lineWidth = 1 + rand() * 3;
      g.beginPath();
      g.moveTo(vx + side * rand() * 10, vy + rand() * 6);
      g.lineTo(x0 + side * 300, h);
      g.stroke();
    }
    // buildings with signs
    for (let i = 0; i < 18; i++) {
      const side = i % 2 ? 1 : -1;
      const bw = 30 + rand() * 60;
      const bx = side < 0 ? rand() * (w * 0.35) : w - bw - rand() * (w * 0.35);
      const bh = 120 + rand() * 360;
      g.fillStyle = `rgba(${10 + rand() * 20},${8 + rand() * 15},${25 + rand() * 30},0.95)`;
      g.fillRect(bx, vy - bh, bw, bh + 40);
      for (let k = 0; k < 6; k++) {
        g.fillStyle = ["#ff3d6e", "#3df0ff", "#ffb13d", "#c45bff"][(rand() * 4) | 0];
        g.globalAlpha = 0.6 + rand() * 0.4;
        g.fillRect(bx + rand() * bw * 0.6, vy - bh + rand() * bh, 6 + rand() * 14, 10 + rand() * 40);
      }
      g.globalAlpha = 1;
    }
    // kanji
    g.save();
    g.shadowColor = "#ff4f8b";
    g.shadowBlur = 28;
    g.fillStyle = "#ffe9f1";
    g.font = "bold 150px 'Hiragino Mincho ProN', 'Yu Mincho', serif";
    g.textAlign = "center";
    g.fillText("東", w / 2, 230);
    g.fillText("京", w / 2, 400);
    g.restore();
    g.fillStyle = "rgba(255,255,255,0.7)";
    g.font = "18px monospace";
    g.textAlign = "center";
    g.fillText("TOKYO  ·  NIGHT DRIVE  ·  1987", w / 2, h - 40);
    agePaper(g, w, h, rand, 0.6);
  });
}

/** Moon poster with 月. */
export function moonPosterTexture() {
  const rand = rng(44);
  return canvasTexture(768, 1024, (g, w, h) => {
    g.fillStyle = "#0c0c14";
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, rand, 600, 0.9, 2, ["#fff", "#cfd8ff"]);
    const cx = w / 2, cy = h * 0.42, r = 260;
    const moon = g.createRadialGradient(cx - 60, cy - 60, 20, cx, cy, r);
    moon.addColorStop(0, "#e9e6dc");
    moon.addColorStop(0.7, "#a9a69c");
    moon.addColorStop(1, "#5e5c57");
    g.fillStyle = moon;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.save();
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.clip();
    for (let i = 0; i < 70; i++) {
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * r;
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d, cr = 6 + rand() * 40;
      g.fillStyle = `rgba(60,58,55,${0.15 + rand() * 0.3})`;
      g.beginPath();
      g.arc(x, y, cr, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "rgba(255,255,255,0.12)";
      g.beginPath();
      g.arc(x - 2, y - 2, cr, Math.PI, Math.PI * 1.6);
      g.stroke();
    }
    // terminator shadow
    const shade = g.createLinearGradient(cx - r, 0, cx + r, 0);
    shade.addColorStop(0, "rgba(0,0,0,0)");
    shade.addColorStop(0.75, "rgba(0,0,0,0.1)");
    shade.addColorStop(1, "rgba(0,0,0,0.65)");
    g.fillStyle = shade;
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
    g.restore();
    g.fillStyle = "#e8e2d0";
    g.font = "bold 120px 'Hiragino Mincho ProN', 'Yu Mincho', serif";
    g.textAlign = "center";
    g.fillText("月", w * 0.82, h * 0.88);
    g.font = "20px monospace";
    g.fillStyle = "rgba(232,226,208,0.7)";
    g.fillText("TSUKI  ·  PHASE 23", w * 0.3, h * 0.88);
    agePaper(g, w, h, rand, 0.5);
  });
}

/** A gig-style poster for the JC-808. */
export function jcPosterTexture() {
  const rand = rng(55);
  return canvasTexture(640, 900, (g, w, h) => {
    g.fillStyle = "#1a1714";
    g.fillRect(0, 0, w, h);
    const cols = ["#d8382c", "#e8792a", "#e8bf2c", "#d9d2c2"];
    for (let i = 0; i < 16; i++) {
      g.fillStyle = cols[Math.floor(i / 4)];
      g.fillRect(40 + i * 35, 520, 26, 46);
    }
    g.fillStyle = "#ece5d5";
    g.font = "bold 120px 'Helvetica Neue', Arial, sans-serif";
    g.fillText("JC-808", 40, 200);
    g.font = "28px 'Helvetica Neue', Arial";
    g.fillStyle = "#ff5b1f";
    g.fillText("RHYTHM COMPOSER", 44, 250);
    g.fillStyle = "#9d968a";
    g.font = "22px monospace";
    g.fillText("LIVE  ·  BASEMENT  ·  2AM", 44, 640);
    g.fillText("NO SAMPLES  ·  NO LIBRARIES", 44, 680);
    agePaper(g, w, h, rand, 0.8);
  });
}

/** Pixel-art ChipWorld poster for the chip corner. */
export function chipPosterTexture() {
  const rand = rng(66);
  return canvasTexture(512, 720, (g, w, h) => {
    g.fillStyle = "#1b1036";
    g.fillRect(0, 0, w, h);
    const px = 16;
    for (let y = 0; y < h; y += px) {
      for (let x = 0; x < w; x += px) {
        if (rand() < 0.04) {
          g.fillStyle = ["#ff6fb5", "#6ff0ff", "#ffd36f", "#8aff9c"][(rand() * 4) | 0];
          g.fillRect(x, y, px - 2, px - 2);
        }
      }
    }
    // pixel invader
    const sprite = ["..x.....x..", "...x...x...", "..xxxxxxx..", ".xx.xxx.xx.", "xxxxxxxxxxx", "x.xxxxxxx.x", "x.x.....x.x", "...xx.xx..."];
    g.fillStyle = "#8aff9c";
    sprite.forEach((row, ry) => [...row].forEach((c, rx) => c === "x" && g.fillRect(90 + rx * 30, 140 + ry * 30, 28, 28)));
    g.fillStyle = "#ffe36e";
    g.font = "bold 66px monospace";
    g.fillText("CHIP", 60, 470);
    g.fillText("WORLD", 60, 540);
    g.fillStyle = "#ff6fb5";
    g.font = "20px monospace";
    g.fillText("8-BIT · 4 CHANNELS · NO MERCY", 60, 600);
    agePaper(g, w, h, rand, 0.5);
  });
}

export function photoTexture(seed) {
  const rand = rng(seed);
  return canvasTexture(256, 300, (g, w, h) => {
    g.fillStyle = "#e8e0cf";
    g.fillRect(0, 0, w, h);
    const sky = g.createLinearGradient(0, 14, 0, 220);
    const hue = rand() * 360;
    sky.addColorStop(0, `hsl(${hue},35%,${20 + rand() * 25}%)`);
    sky.addColorStop(1, `hsl(${(hue + 40) % 360},40%,${35 + rand() * 25}%)`);
    g.fillStyle = sky;
    g.fillRect(14, 14, w - 28, 210);
    for (let i = 0; i < 7; i++) {
      g.fillStyle = `rgba(10,10,20,${0.5 + rand() * 0.4})`;
      const bw = 18 + rand() * 40;
      g.fillRect(14 + rand() * (w - 50), 224 - (40 + rand() * 150), bw, 240);
    }
    g.fillStyle = "rgba(255,230,150,0.6)";
    for (let i = 0; i < 30; i++) g.fillRect(14 + rand() * (w - 28), 60 + rand() * 160, 3, 3);
    g.fillStyle = "#55504a";
    g.font = "16px 'Marker Felt', cursive";
    g.fillText(["tokyo '19", "nyc", "rooftop", "home", "osaka", "the lab"][(rand() * 6) | 0], 20, 262);
  });
}

/* ------------------------------------------------------------------ */
/* Labels & screens                                                    */
/* ------------------------------------------------------------------ */

/** Text label texture (silkscreen, nameplates). */
export function labelTexture(text, { w = 512, h = 128, bg = "rgba(0,0,0,0)", color = "#ece5d5", font = "bold 64px 'Helvetica Neue', Arial, sans-serif", align = "center", sub = null, subColor = "#ff5b1f", subFont = "28px monospace" } = {}) {
  return canvasTexture(w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = color;
    g.font = font;
    g.textAlign = align;
    g.textBaseline = "middle";
    const x = align === "center" ? w / 2 : align === "left" ? 16 : w - 16;
    g.fillText(text, x, sub ? h * 0.38 : h / 2);
    if (sub) {
      g.fillStyle = subColor;
      g.font = subFont;
      g.fillText(sub, x, h * 0.76);
    }
  });
}

/** A canvas-backed texture that machines redraw while the room is running. */
export class LiveScreen {
  constructor(w, h, draw) {
    this.canvas = makeCanvas(w, h);
    this.g = this.canvas.getContext("2d");
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.draw = draw;
    this.w = w;
    this.h = h;
  }

  update(...args) {
    this.draw(this.g, this.w, this.h, ...args);
    this.texture.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */
/* Wall grime (multiplied over the scanned plaster, non-repeating)      */
/* ------------------------------------------------------------------ */

/**
 * @param {object} o
 *  o.w/o.h       canvas size (match the wall's aspect)
 *  o.window      optional opening in 0..1 UV (x0,x1,y0,y1; y measured from the floor)
 *  o.nicotine    0..1 yellowing toward the ceiling
 */
export function grimeTexture({ w = 1536, h = 800, seed = 1, window = null, nicotine = 1, rub = true, dark = 1 } = {}) {
  const rand = rng(seed);
  return canvasTexture(w, h, (g) => {
    const Y = (v) => h - v * h; // uv y (up) → canvas y (down)
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = "multiply";

    // nicotine yellowing, strongest near the ceiling
    const yel = g.createLinearGradient(0, 0, 0, h);
    yel.addColorStop(0, `rgba(205,170,105,${0.75 * nicotine})`);
    yel.addColorStop(0.45, `rgba(230,205,150,${0.45 * nicotine})`);
    yel.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = yel;
    g.fillRect(0, 0, w, h);

    // big mottled discolouration
    for (let i = 0; i < 40; i++) {
      const x = rand() * w, y = rand() * h, r = (0.05 + rand() * 0.22) * w;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      const c = rand() < 0.7 ? `rgba(150,128,96,${(0.18 + rand() * 0.25) * dark})` : `rgba(120,118,90,${0.2 * dark})`;
      grad.addColorStop(0, c);
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // water stains with a darker tide line
    for (let i = 0; i < 9; i++) {
      const cx = rand() * w, cy = rand() * h * 0.7, r = (0.03 + rand() * 0.08) * w;
      g.beginPath();
      for (let k = 0; k <= 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const rr = r * (0.75 + rand() * 0.45);
        const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr * (1.2 + rand() * 0.6);
        k ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.closePath();
      g.fillStyle = `rgba(200,175,130,${0.35 * dark})`;
      g.fill();
      g.strokeStyle = `rgba(110,85,55,${0.45 * dark})`;
      g.lineWidth = 2 + rand() * 3;
      g.stroke();
    }

    // drips from the ceiling line
    const drip = (x, y0, len, width, alpha) => {
      const grad = g.createLinearGradient(0, y0, 0, y0 + len);
      grad.addColorStop(0, `rgba(120,95,65,${alpha})`);
      grad.addColorStop(0.7, `rgba(140,115,80,${alpha * 0.6})`);
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(x - width / 2, y0);
      g.bezierCurveTo(x - width * 0.6, y0 + len * 0.4, x - width * 0.2, y0 + len * 0.8, x, y0 + len);
      g.bezierCurveTo(x + width * 0.2, y0 + len * 0.8, x + width * 0.6, y0 + len * 0.4, x + width / 2, y0);
      g.fill();
    };
    for (let i = 0; i < 26; i++) drip(rand() * w, 0, (0.15 + rand() * 0.55) * h, 4 + rand() * 18, (0.2 + rand() * 0.35) * dark);

    // around the window: soot on the lintel, streaks from the sill corners
    if (window) {
      const x0 = window.x0 * w, x1 = window.x1 * w, ytop = Y(window.y1), ybot = Y(window.y0);
      const soot = g.createLinearGradient(0, ytop - 0.12 * h, 0, ytop);
      soot.addColorStop(0, "rgba(255,255,255,0)");
      soot.addColorStop(1, `rgba(110,90,70,${0.55 * dark})`);
      g.fillStyle = soot;
      g.fillRect(x0 - 0.04 * w, ytop - 0.12 * h, x1 - x0 + 0.08 * w, 0.12 * h);
      for (let i = 0; i < 14; i++) {
        const sx = rand() < 0.5 ? x0 + rand() * 0.06 * w : x1 - rand() * 0.06 * w;
        drip(sx, ybot, (0.15 + rand() * 0.35) * h, 3 + rand() * 12, (0.3 + rand() * 0.3) * dark);
      }
      for (const ex of [x0, x1]) {
        const side = g.createLinearGradient(ex - 0.05 * w, 0, ex + 0.05 * w, 0);
        side.addColorStop(0, "rgba(255,255,255,0)");
        side.addColorStop(0.5, `rgba(130,110,85,${0.35 * dark})`);
        side.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = side;
        g.fillRect(ex - 0.05 * w, ytop, 0.1 * w, ybot - ytop);
      }
    }

    // scuffs and hand marks at furniture height
    if (rub) {
      for (let i = 0; i < 70; i++) {
        const x = rand() * w, y = Y(0.28 + rand() * 0.18), r = 6 + rand() * 30;
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, `rgba(120,100,80,${(0.08 + rand() * 0.18) * dark})`);
        grad.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = grad;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }

    // mould specks in the lower corners
    for (const cx of [0, w]) {
      for (let i = 0; i < 500; i++) {
        const x = cx + (cx ? -1 : 1) * Math.pow(rand(), 2) * 0.12 * w;
        const y = h - Math.pow(rand(), 1.8) * 0.4 * h;
        g.fillStyle = `rgba(70,75,55,${(0.15 + rand() * 0.4) * dark})`;
        g.fillRect(x, y, 1 + rand() * 3, 1 + rand() * 3);
      }
    }

    // ambient occlusion in the corners and along floor / ceiling
    const edge = (x0, y0, x1, y1, c) => {
      const grad = g.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, c);
      grad.addColorStop(1, "rgba(255,255,255,0)");
      return grad;
    };
    g.fillStyle = edge(0, 0, 0.07 * w, 0, `rgba(95,80,65,${0.8 * dark})`);
    g.fillRect(0, 0, 0.07 * w, h);
    g.fillStyle = edge(w, 0, w - 0.07 * w, 0, `rgba(95,80,65,${0.8 * dark})`);
    g.fillRect(w - 0.07 * w, 0, 0.07 * w, h);
    g.fillStyle = edge(0, h, 0, h - 0.12 * h, `rgba(85,70,55,${0.85 * dark})`);
    g.fillRect(0, h - 0.12 * h, w, 0.12 * h);
    g.fillStyle = edge(0, 0, 0, 0.08 * h, `rgba(110,90,65,${0.7 * dark})`);
    g.fillRect(0, 0, w, 0.08 * h);

    // fine grit so the multiply never reads as flat paint
    for (let i = 0; i < w * h * 0.02; i++) {
      g.fillStyle = `rgba(${90 + rand() * 60},${80 + rand() * 50},${60 + rand() * 40},${rand() * 0.25 * dark})`;
      g.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
    }
    g.globalCompositeOperation = "source-over";
  }, { aniso: 4 });
}
