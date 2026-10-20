// "Late Night Loop" — an original 8-bar lofi groove rendered offline, so every
// analyser in the room has something to chew on without shipping audio files.
// Ground truth: 84 bpm, one chord per bar (Fmaj7 Em7 Dm7 Cmaj7 ×2), melody on top.

const BPM = 84;
const BEAT = 60 / BPM;
const BARS = 8;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

const CHORDS = [
  [53, 57, 60, 64], // Fmaj7
  [52, 55, 59, 62], // Em7
  [50, 53, 57, 60], // Dm7
  [48, 52, 55, 59]  // Cmaj7
];
const ROOTS = [41, 40, 38, 36];
// melody: [bar, beat offset, midi, beats]
const MELODY = [
  [0, 0, 76, 1.5], [0, 1.5, 74, 0.5], [0, 2, 72, 1], [0, 3, 69, 1],
  [1, 0, 71, 1.5], [1, 1.5, 72, 0.5], [1, 2, 74, 2],
  [2, 0, 72, 1], [2, 1, 69, 1], [2, 2, 67, 1.5], [2, 3.5, 69, 0.5],
  [3, 0, 67, 3], [3, 3, 64, 1],
  [4, 0, 76, 1], [4, 1, 79, 1], [4, 2, 77, 1], [4, 3, 76, 1],
  [5, 0, 74, 1.5], [5, 1.5, 76, 0.5], [5, 2, 71, 2],
  [6, 0, 72, 1], [6, 1, 74, 1], [6, 2, 77, 1], [6, 3, 74, 1],
  [7, 0, 72, 3], [7, 3, 67, 1]
];

export async function renderDemoLoop(audio) {
  await audio.start();
  const sr = 44100;
  const dur = BARS * 4 * BEAT + 1.5;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OAC(2, Math.ceil(dur * sr), sr);

  const master = ctx.createGain();
  master.gain.value = 0.8;
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 5200;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 3;
  master.connect(tone).connect(comp).connect(ctx.destination);

  const noise = ctx.createBuffer(1, sr, sr);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  const env = (g, t, peak, a, d) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  };

  const kick = (t) => {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.08);
    const g = ctx.createGain();
    env(g, t, 0.9, 0.003, 0.42);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.5);
  };
  const snare = (t) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2400;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    env(g, t, 0.42, 0.002, 0.2);
    s.connect(bp).connect(g).connect(master);
    s.start(t, Math.random() * 0.5, 0.3);
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.05);
    const og = ctx.createGain();
    env(og, t, 0.25, 0.002, 0.1);
    o.connect(og).connect(master);
    o.start(t);
    o.stop(t + 0.2);
  };
  const hat = (t, open) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    env(g, t, open ? 0.12 : 0.08, 0.001, open ? 0.22 : 0.045);
    s.connect(hp).connect(g).connect(master);
    s.start(t, Math.random() * 0.5, 0.3);
  };
  // electric piano: two-operator FM with a fast-decaying index
  const keys = (t, midi, len, vel) => {
    const f = mtof(midi);
    const car = ctx.createOscillator();
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f;
    const idx = ctx.createGain();
    idx.gain.setValueAtTime(f * 1.6, t);
    idx.gain.exponentialRampToValueAtTime(f * 0.08, t + 0.5);
    mod.connect(idx).connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vel, t + 0.01);
    g.gain.exponentialRampToValueAtTime(vel * 0.4, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.4);
    const pan = ctx.createStereoPanner();
    pan.pan.value = (midi % 7) / 7 - 0.4;
    car.connect(g).connect(pan).connect(master);
    car.start(t);
    mod.start(t);
    car.stop(t + len + 0.5);
    mod.stop(t + len + 0.5);
  };
  const bass = (t, midi, len) => {
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = mtof(midi);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55, t + 0.01);
    g.gain.setTargetAtTime(0.0001, t + len * 0.8, 0.05);
    o.connect(lp).connect(g).connect(master);
    o.start(t);
    o.stop(t + len + 0.3);
  };
  const lead = (t, midi, len) => {
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.value = mtof(midi);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.2;
    const vg = ctx.createGain();
    vg.gain.value = mtof(midi) * 0.004;
    vib.connect(vg).connect(o.frequency);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
    g.gain.setTargetAtTime(0.11, t + 0.05, 0.1);
    g.gain.setTargetAtTime(0.0001, t + len * 0.92, 0.03);
    o.connect(lp).connect(g).connect(master);
    o.start(t);
    vib.start(t);
    o.stop(t + len + 0.2);
    vib.stop(t + len + 0.2);
  };

  const swing = (eighth) => (eighth % 2 ? BEAT * 0.5 * 0.16 : 0);
  const t0 = 0.05;
  for (let bar = 0; bar < BARS; bar++) {
    const bt = t0 + bar * 4 * BEAT;
    const ci = bar % 4;
    // boom-bap: kick on 1, the "and" of 2, 3; snare on 2 and 4
    kick(bt);
    kick(bt + 1.5 * BEAT + swing(3));
    kick(bt + 2 * BEAT);
    if (bar % 2 === 1) kick(bt + 3.5 * BEAT + swing(7));
    snare(bt + BEAT);
    snare(bt + 3 * BEAT);
    for (let e = 0; e < 8; e++) hat(bt + e * 0.5 * BEAT + swing(e), e === 7 && bar % 2 === 1);
    // chords, comped on 1 and the "and" of 2
    CHORDS[ci].forEach((m) => keys(bt, m, 1.4 * BEAT, 0.11));
    CHORDS[ci].forEach((m) => keys(bt + 1.5 * BEAT + swing(3), m + 12 * (m < 55 ? 1 : 0), 2.2 * BEAT, 0.07));
    bass(bt, ROOTS[ci], 1.4 * BEAT);
    bass(bt + 2 * BEAT, ROOTS[ci], 0.9 * BEAT);
    bass(bt + 3 * BEAT, ROOTS[ci] + 7, 0.9 * BEAT);
  }
  for (const [bar, off, midi, len] of MELODY) lead(t0 + (bar * 4 + off) * BEAT, midi, len * BEAT);

  // vinyl crackle
  for (let k = 0; k < dur * 14; k++) {
    const t = Math.random() * dur;
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const g = ctx.createGain();
    env(g, t, 0.02 + Math.random() * 0.05, 0.0005, 0.004);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2500;
    s.connect(hp).connect(g).connect(master);
    s.start(t, Math.random() * 0.9, 0.02);
  }
  return await ctx.startRendering();
}

export const DEMO_TRUTH = { bpm: BPM, beat: BEAT, bars: BARS, chords: ["Fmaj7", "Em7", "Dm7", "Cmaj7"] };
