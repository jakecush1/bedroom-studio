// Asteroids — the simulation and its vector-line renderer, independent of
// the DOM so the upright cabinet on the floor can run the attract mode on
// its little screen while the panel runs the real game.
//
//   const game = new Asteroids({ sound });   // sound(name, arg) is optional
//   game.start();                            // or leave it in attract mode
//   game.step(dt, { left, right, thrust, fire, hyper });
//   game.render(ctx, width, height, { hi });

export const W = 800, H = 600;              // world units (the renderer scales)
const SHIP_R = 13;
const ROCK_R = { 3: 48, 2: 26, 1: 13 };
const ROCK_PTS = { 3: 20, 2: 50, 1: 100 };
const TAU = Math.PI * 2;

const rand = (a, b) => a + Math.random() * (b - a);
const wrap = (o) => {
  if (o.x < -o.r) o.x += W + 2 * o.r; else if (o.x > W + o.r) o.x -= W + 2 * o.r;
  if (o.y < -o.r) o.y += H + 2 * o.r; else if (o.y > H + o.r) o.y -= H + 2 * o.r;
};
const hits = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y, r = a.r + b.r; return dx * dx + dy * dy < r * r; };

function rockShape(size) {
  const n = size === 3 ? 12 : size === 2 ? 10 : 8;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const k = rand(0.68, 1.08);
    pts.push([Math.cos(a) * k, Math.sin(a) * k]);
  }
  return pts;
}

export class Asteroids {
  constructor({ sound = null } = {}) {
    this.sound = sound || (() => {});
    this.hi = 0;
    this.attract = true;
    this.reset();
    this.mode = "attract";
    this.spawnWave(4);
  }

  reset() {
    this.rocks = [];
    this.bullets = [];
    this.debris = [];
    this.saucer = null;
    this.saucerAt = rand(14, 22);
    this.score = 0;
    this.lives = 3;
    this.wave = 0;
    this.nextLife = 10000;
    this.ship = null;
    this.respawnIn = 0;
    this.fireCd = 0;
    this.hyperCd = 0;
    this.beatIn = 0.8;
    this.beatHi = false;
    this.time = 0;
    this.message = null;
    this.overIn = 0;
    this.paused = false;
  }

  /** New game. */
  start() {
    this.reset();
    this.mode = "play";
    this.spawnWave(4);
    this.spawnShip();
  }

  spawnShip() {
    this.ship = { x: W / 2, y: H / 2, vx: 0, vy: 0, a: -Math.PI / 2, r: SHIP_R, thrusting: false, inv: 2 };
    this.sound("thrust", false);
  }

  spawnWave(n) {
    this.wave++;
    const count = Math.min(11, n + (this.wave - 1));
    for (let i = 0; i < count; i++) {
      let x, y;
      do { x = rand(0, W); y = rand(0, H); } while (Math.hypot(x - W / 2, y - H / 2) < 180);
      this.addRock(x, y, 3);
    }
    this.saucerAt = this.time + rand(12, 22);
  }

  addRock(x, y, size, speedBoost = 0) {
    const sp = rand(28, 60) * (4 - size) * 0.75 + speedBoost + this.wave * 4;
    const a = rand(0, TAU);
    this.rocks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: ROCK_R[size], size, shape: rockShape(size), rot: rand(0, TAU), spin: rand(-1.2, 1.2) });
  }

  explode(x, y, n, speed, life = 0.9) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(speed * 0.3, speed);
      this.debris.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, a: rand(0, TAU), len: rand(2, 9), life, max: life });
    }
  }

  breakRock(i, byPlayer) {
    const r = this.rocks[i];
    this.rocks.splice(i, 1);
    if (byPlayer) this.addScore(ROCK_PTS[r.size]);
    this.sound("bang", r.size);
    this.explode(r.x, r.y, 6 + r.size * 2, 90, 0.7);
    if (r.size > 1) { this.addRock(r.x, r.y, r.size - 1); this.addRock(r.x, r.y, r.size - 1); }
  }

  addScore(p) {
    this.score += p;
    if (this.score > this.hi) this.hi = this.score;
    if (this.score >= this.nextLife) { this.lives++; this.nextLife += 10000; this.sound("life"); }
  }

  killShip() {
    const s = this.ship;
    this.explode(s.x, s.y, 14, 120, 1.4);
    this.sound("bang", 3);
    this.sound("thrust", false);
    this.ship = null;
    this.lives--;
    if (this.lives <= 0) {
      this.mode = "over";
      this.overIn = 5;
      this.sound("saucer", false);
    } else this.respawnIn = 2.2;
  }

  spawnSaucer() {
    const small = this.score > 10000 ? Math.random() < 0.7 : Math.random() < 0.25;
    const fromLeft = Math.random() < 0.5;
    this.saucer = { x: fromLeft ? -30 : W + 30, y: rand(60, H - 60), vx: (fromLeft ? 1 : -1) * (small ? 150 : 95), vy: 0, r: small ? 11 : 20, small, fireIn: 1.1, turnIn: rand(0.8, 2) };
    this.sound("saucer", small ? "small" : "large");
  }

  /** Advance the world. input: { left, right, thrust, fire, hyper } */
  step(dt, input = {}) {
    if (this.paused) return;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    const playing = this.mode === "play";
    const s = this.ship;

    if (s && playing) {
      if (input.left) s.a -= 4.4 * dt;
      if (input.right) s.a += 4.4 * dt;
      s.thrusting = !!input.thrust;
      if (s.thrusting) { s.vx += Math.cos(s.a) * 300 * dt; s.vy += Math.sin(s.a) * 300 * dt; }
      const drag = Math.exp(-0.55 * dt);
      s.vx *= drag; s.vy *= drag;
      const sp = Math.hypot(s.vx, s.vy);
      if (sp > 440) { s.vx *= 440 / sp; s.vy *= 440 / sp; }
      s.x += s.vx * dt; s.y += s.vy * dt;
      wrap(s);
      s.inv = Math.max(0, s.inv - dt);
      this.sound("thrust", s.thrusting);
      this.fireCd -= dt;
      if (input.fire && this.fireCd <= 0 && this.bullets.filter((b) => !b.enemy).length < 4) {
        this.fireCd = 0.17;
        this.bullets.push({ x: s.x + Math.cos(s.a) * SHIP_R, y: s.y + Math.sin(s.a) * SHIP_R, vx: s.vx + Math.cos(s.a) * 540, vy: s.vy + Math.sin(s.a) * 540, r: 2, life: 1.05, enemy: false });
        this.sound("fire");
      }
      this.hyperCd -= dt;
      if (input.hyper && this.hyperCd <= 0) {
        this.hyperCd = 1.6;
        this.sound("hyper");
        this.explode(s.x, s.y, 8, 60, 0.4);
        s.x = rand(40, W - 40); s.y = rand(40, H - 40); s.vx = s.vy = 0;
        s.inv = 0.8;
        if (Math.random() < 0.08) { this.killShip(); return; }
      }
    } else if (!s && playing) {
      this.respawnIn -= dt;
      const clear = !this.rocks.some((r) => Math.hypot(r.x - W / 2, r.y - H / 2) < 140);
      if (this.respawnIn <= 0 && clear) this.spawnShip();
    }

    for (const r of this.rocks) { r.x += r.vx * dt; r.y += r.vy * dt; r.rot += r.spin * dt; wrap(r); }
    for (const b of this.bullets) { b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt; wrap(b); }
    this.bullets = this.bullets.filter((b) => b.life > 0);
    for (const d of this.debris) { d.x += d.vx * dt; d.y += d.vy * dt; d.life -= dt; }
    this.debris = this.debris.filter((d) => d.life > 0);

    // the saucer
    if (playing && !this.saucer && this.time > this.saucerAt && this.rocks.length) this.spawnSaucer();
    const u = this.saucer;
    if (u) {
      u.turnIn -= dt;
      if (u.turnIn <= 0) { u.turnIn = rand(0.8, 2.2); u.vy = [0, 0, 70, -70][Math.floor(rand(0, 4))]; }
      u.x += u.vx * dt; u.y += u.vy * dt;
      if (u.y < 20 || u.y > H - 20) u.vy = -u.vy;
      if (u.x < -40 || u.x > W + 40) { this.saucer = null; this.sound("saucer", false); this.saucerAt = this.time + rand(10, 20); }
      else if (s) {
        u.fireIn -= dt;
        if (u.fireIn <= 0) {
          u.fireIn = u.small ? 1.0 : 1.4;
          let a = rand(0, TAU);
          if (u.small) a = Math.atan2(s.y - u.y, s.x - u.x) + rand(-0.12, 0.12);
          this.bullets.push({ x: u.x, y: u.y, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300, r: 2, life: 1.3, enemy: true });
          this.sound("fire", "enemy");
        }
      }
    }

    // collisions
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      let hit = false;
      for (let j = this.rocks.length - 1; j >= 0; j--) if (hits(b, this.rocks[j])) { this.breakRock(j, !b.enemy); hit = true; break; }
      if (!hit && this.saucer && !b.enemy && hits(b, this.saucer)) {
        this.addScore(this.saucer.small ? 1000 : 200);
        this.explode(this.saucer.x, this.saucer.y, 12, 110, 0.9);
        this.sound("bang", 2);
        this.sound("saucer", false);
        this.saucer = null;
        hit = true;
      }
      if (!hit && b.enemy && s && s.inv <= 0 && hits(b, s)) { this.killShip(); hit = true; }
      if (hit) this.bullets.splice(i, 1);
    }
    if (this.ship && this.ship.inv <= 0 && playing) {
      for (let j = this.rocks.length - 1; j >= 0; j--) if (hits(this.ship, this.rocks[j])) { this.breakRock(j, false); this.killShip(); break; }
      if (this.ship && this.saucer && hits(this.ship, this.saucer)) { this.saucer = null; this.sound("saucer", false); this.killShip(); }
    }
    if (playing && !this.rocks.length && !this.saucer) this.spawnWave(4);

    // the heartbeat quickens as the field empties
    if (playing) {
      this.beatIn -= dt;
      if (this.beatIn <= 0) {
        this.beatHi = !this.beatHi;
        this.sound("beat", this.beatHi);
        this.beatIn = Math.max(0.28, 0.95 - (11 - Math.min(11, this.rocks.length)) * 0.055);
      }
    }
    if (this.mode === "over") {
      this.overIn -= dt;
      if (this.overIn <= 0) { this.mode = "attract"; this.last = this.score; }
    }
    if (this.mode === "attract" && this.rocks.length < 5) this.addRock(rand(0, W), -40, 3);
  }

  /* ---------------- drawing ---------------- */

  /**
   * Draw the world scaled into w×h. opts: hi (high score to show), glow
   * (shadow blur; costly on a texture), small (shorter attract text).
   */
  render(g, w, h, { hi = this.hi, glow = true, small = false, paused = false } = {}) {
    const k = Math.min(w / W, h / H);
    const ox = (w - W * k) / 2, oy = (h - H * k) / 2;
    g.save();
    g.fillStyle = "#04060a";
    g.fillRect(0, 0, w, h);
    g.translate(ox, oy);
    g.scale(k, k);
    g.lineWidth = 1.7 / k * Math.max(1, k * 0.9);
    g.lineJoin = "round";
    g.strokeStyle = "#dff6ff";
    g.fillStyle = "#dff6ff";
    if (glow) { g.shadowColor = "rgba(150,220,255,0.75)"; g.shadowBlur = 7; }

    for (const r of this.rocks) {
      g.save();
      g.translate(r.x, r.y);
      g.rotate(r.rot);
      g.beginPath();
      r.shape.forEach(([px, py], i) => (i ? g.lineTo(px * r.r, py * r.r) : g.moveTo(px * r.r, py * r.r)));
      g.closePath();
      g.stroke();
      g.restore();
    }
    const s = this.ship;
    if (s && (s.inv <= 0 || Math.floor(this.time * 12) % 2 === 0)) {
      g.save();
      g.translate(s.x, s.y);
      g.rotate(s.a);
      g.beginPath();
      g.moveTo(16, 0); g.lineTo(-12, 10); g.lineTo(-8, 4); g.lineTo(-8, -4); g.lineTo(-12, -10); g.closePath();
      g.stroke();
      if (s.thrusting && Math.floor(this.time * 30) % 2 === 0) { g.beginPath(); g.moveTo(-8, 5); g.lineTo(-20, 0); g.lineTo(-8, -5); g.stroke(); }
      g.restore();
    }
    const u = this.saucer;
    if (u) {
      g.save();
      g.translate(u.x, u.y);
      const r = u.r;
      g.beginPath();
      g.moveTo(-r, 0); g.lineTo(-r * 0.45, r * 0.45); g.lineTo(r * 0.45, r * 0.45); g.lineTo(r, 0); g.lineTo(r * 0.45, -r * 0.4); g.lineTo(r * 0.2, -r * 0.8); g.lineTo(-r * 0.2, -r * 0.8); g.lineTo(-r * 0.45, -r * 0.4); g.closePath();
      g.moveTo(-r, 0); g.lineTo(r, 0);
      g.stroke();
      g.restore();
    }
    for (const b of this.bullets) { g.beginPath(); g.arc(b.x, b.y, b.enemy ? 2.6 : 2, 0, TAU); g.fill(); }
    for (const d of this.debris) {
      g.globalAlpha = Math.max(0, d.life / d.max);
      g.beginPath();
      g.moveTo(d.x, d.y);
      g.lineTo(d.x + Math.cos(d.a) * d.len, d.y + Math.sin(d.a) * d.len);
      g.stroke();
    }
    g.globalAlpha = 1;

    // HUD
    g.shadowBlur = 0;
    g.font = "32px 'VT323', 'Courier New', monospace";
    g.textAlign = "left";
    g.fillText(String(this.score).padStart(5, "0"), 24, 38);
    g.textAlign = "center";
    g.font = "22px 'VT323', 'Courier New', monospace";
    g.fillText(String(Math.max(hi, this.hi)).padStart(5, "0"), W / 2, 30);
    if (this.mode === "play") for (let i = 0; i < this.lives; i++) {
      g.save();
      g.translate(34 + i * 20, 62);
      g.rotate(-Math.PI / 2);
      g.beginPath(); g.moveTo(10, 0); g.lineTo(-8, 6); g.lineTo(-5, 0); g.lineTo(-8, -6); g.closePath(); g.stroke();
      g.restore();
    }
    g.textAlign = "center";
    if (this.mode === "attract") {
      g.font = "88px 'VT323', 'Courier New', monospace";
      g.fillText("ASTEROIDS", W / 2, H / 2 - 40);
      g.font = "26px 'VT323', 'Courier New', monospace";
      if (Math.floor(this.time * 1.4) % 2 === 0) g.fillText(small ? "INSERT COIN" : "PRESS START  ·  OR SPACE", W / 2, H / 2 + 30);
      if (this.last != null) g.fillText(`LAST  ${String(this.last).padStart(5, "0")}`, W / 2, H / 2 + 70);
      if (!small) { g.font = "18px 'VT323', 'Courier New', monospace"; g.fillText("← →  rotate     ↑  thrust     SPACE  fire     SHIFT  hyperspace", W / 2, H - 40); }
      else { g.font = "20px 'VT323', 'Courier New', monospace"; g.fillText("1 COIN  1 PLAY", W / 2, H - 36); }
    } else if (this.mode === "over") {
      g.font = "64px 'VT323', 'Courier New', monospace";
      g.fillText("GAME OVER", W / 2, H / 2);
    } else if (paused) {
      g.font = "48px 'VT323', 'Courier New', monospace";
      g.fillText("PAUSED", W / 2, H / 2);
      g.font = "20px 'VT323', 'Courier New', monospace";
      g.fillText("press any key", W / 2, H / 2 + 36);
    } else if (this.ship && this.ship.inv > 1.4 && this.time < 3) {
      g.font = "26px 'VT323', 'Courier New', monospace";
      g.fillText("PLAYER 1", W / 2, H / 2 + 60);
    }
    g.restore();
  }
}
