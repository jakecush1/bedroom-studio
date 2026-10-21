// Room tone: a distant city rumble, off by default. (The rain used to play
// here too; it's gone — the rain outside the window is visual only now.)
// Generated from noise so there are no audio files to download.

function noiseBuffer(ctx, seconds, color) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (color === "pink") {
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
      } else if (color === "brown") {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    // crossfade the loop point
    const fade = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[i] = d[i] * k + d[len - fade + i] * (1 - k);
    }
  }
  return buf;
}

export class Ambience {
  constructor(audio) {
    this.audio = audio;
    this.enabled = false;   // silent unless the HUD toggle is switched on
    this.started = false;
  }

  start() {
    if (this.started || !this.audio.ctx) return;
    this.started = true;
    const ctx = this.audio.ctx;
    const out = this.audio.ambience;

    // city rumble
    const rum = ctx.createBufferSource();
    rum.buffer = noiseBuffer(ctx, 8, "brown");
    rum.loop = true;
    const rlp = ctx.createBiquadFilter();
    rlp.type = "lowpass";
    rlp.frequency.value = 160;
    const rumG = ctx.createGain();
    rumG.gain.value = 0.18;
    rum.connect(rlp).connect(rumG).connect(out);
    rum.start();

    this.nodes = { rum };
    this.setEnabled(this.enabled);
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.audio.ctx) this.audio.setAmbience(on ? 0.55 : 0);
  }
}
