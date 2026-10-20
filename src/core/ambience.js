// Room tone: rain on the window, distant city rumble and the odd drip.
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
    this.enabled = true;
    this.started = false;
  }

  start() {
    if (this.started || !this.audio.ctx) return;
    this.started = true;
    const ctx = this.audio.ctx;
    const out = this.audio.ambience;

    // steady rain: pink noise shaped like rain on glass
    const rain = ctx.createBufferSource();
    rain.buffer = noiseBuffer(ctx, 6, "pink");
    rain.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 400;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 5200;
    const rg = ctx.createGain();
    rg.gain.value = 0.22;
    rain.connect(hp).connect(lp).connect(rg).connect(out);
    rain.start();

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

    // slow swell so the rain breathes
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.07;
    lfo.connect(lfoG).connect(rg.gain);
    lfo.start();

    // drips and taps on the sill
    const white = noiseBuffer(ctx, 1, "white");
    const drip = () => {
      if (!this.started) return;
      const t = ctx.currentTime + 0.01;
      const s = ctx.createBufferSource();
      s.buffer = white;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1800 + Math.random() * 3800;
      bp.Q.value = 6 + Math.random() * 10;
      const g = ctx.createGain();
      const amp = 0.04 + Math.random() * 0.12;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(amp, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03 + Math.random() * 0.05);
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (pan) pan.pan.value = Math.random() * 1.6 - 0.8;
      s.connect(bp).connect(g);
      (pan ? g.connect(pan) : g).connect(out);
      s.start(t, Math.random() * 0.9, 0.1);
      setTimeout(drip, 40 + Math.random() * 260);
    };
    drip();
    this.nodes = { rain, rum, lfo };
    this.setEnabled(this.enabled);
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.audio.ctx) this.audio.setAmbience(on ? 0.55 : 0);
  }
}
