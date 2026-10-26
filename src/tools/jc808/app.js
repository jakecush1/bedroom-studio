/* ============================================================
   JC-808 Rhythm Composer
   Analogue-style drum machine + synth, pure Web Audio.
   No libraries — every voice is synthesised from oscillators
   and shaped noise, the way the original machines did it.
   ============================================================ */
// Ported from jc-808/app.js. The sound engine, sequencer, synth and
// arpeggiator are unchanged; the differences are plumbing for the studio:
// it plays through the room's audio bus, its DOM is scoped to the panel,
// keys only respond while its panel is open, and it publishes its
// playhead/pattern so the 3D JC-808 on the stand lights up in time.
import { writeMidi, parseMidi } from "../../core/midi.js";
import {
  STEPS_PER_BAR, BAR_CHOICES, GRIDS, emptyTrack, trackSteps, wrapPos, quantizeStart,
  addNote, notesStartingInStep, noteAt, pitchRange, normaliseTrack, serialiseTrack,
  trackToMidiNotes, barBeat
} from "./track.js";
import { emptyBank as emptyBankFor, packBank as packBankFor, normaliseBank, unpackLane } from "./bank.js";

export function mountJC808(root, studio) {

  /* ---------- small helpers ---------- */

  const $ = (sel, r) => (r || root).querySelector(sel);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  /* ============================================================
     1. VOICE DEFINITIONS
     ============================================================ */

  // Metallic ratios from the original 808 square-wave bank.
  const METAL_RATIOS = [2, 3, 4.16, 5.43, 6.79, 8.21];

  const VOICES = [
    { id: "BD", name: "Bass Drum",  color: "#d8382c", key: "1", def: { level: 0.95, tune: 0.35, decay: 0.45 } },
    { id: "SD", name: "Snare Drum", color: "#d8382c", key: "2", def: { level: 0.80, tune: 0.50, decay: 0.35 } },
    { id: "LT", name: "Low Tom",    color: "#e8792a", key: "3", def: { level: 0.75, tune: 0.25, decay: 0.50 } },
    { id: "MT", name: "Mid Tom",    color: "#e8792a", key: "4", def: { level: 0.75, tune: 0.50, decay: 0.45 } },
    { id: "HT", name: "Hi Tom",     color: "#e8792a", key: "5", def: { level: 0.75, tune: 0.75, decay: 0.40 } },
    { id: "RS", name: "Rim Shot",   color: "#e8bf2c", key: "6", def: { level: 0.70, tune: 0.50, decay: 0.20 } },
    { id: "CP", name: "Hand Clap",  color: "#e8bf2c", key: "7", def: { level: 0.75, tune: 0.50, decay: 0.45 } },
    { id: "CB", name: "Cowbell",    color: "#e8bf2c", key: "8", def: { level: 0.60, tune: 0.50, decay: 0.35 } },
    { id: "CH", name: "Closed Hat", color: "#d9d2c2", key: "9", def: { level: 0.62, tune: 0.50, decay: 0.20 } },
    { id: "OH", name: "Open Hat",   color: "#d9d2c2", key: "0", def: { level: 0.62, tune: 0.50, decay: 0.55 } },
    { id: "CY", name: "Cymbal",     color: "#d9d2c2", key: "-", def: { level: 0.55, tune: 0.50, decay: 0.70 } },
    { id: "MA", name: "Maracas",    color: "#d9d2c2", key: "=", def: { level: 0.55, tune: 0.50, decay: 0.25 } }
  ];
  const VOICE_IDS = VOICES.map((v) => v.id);

  // Two synth lanes — a bass and a lead — each with its own patch and its own
  // looping take (see track.js). The synth panel, the keyboard and Rec always
  // address the selected lane; both lanes play back.
  const LEAD_PATCH = {
    wave: "sawtooth", octave: 0, detune: 8, sub: 0.25, cutoff: 0.62, reso: 3, envAmt: 0.45,
    attack: 0.01, decay: 0.25, sustain: 0.55, release: 0.35, glide: 0, mono: false, level: 0.7,
    arp: false, arpMode: "up", arpRate: "1/16", arpOct: 1, arpGate: 0.6, latch: false
  };
  const BASS_PATCH = Object.assign({}, LEAD_PATCH, {
    octave: -1, detune: 4, sub: 0.6, cutoff: 0.42, reso: 4, envAmt: 0.5,
    attack: 0.005, decay: 0.22, sustain: 0.3, release: 0.16, mono: true, level: 0.75
  });
  const LANES = [
    { id: "bass", name: "Bass", color: "#e8bf2c", program: 38, def: BASS_PATCH },
    { id: "lead", name: "Lead", color: "#ff5b1f", program: 81, def: LEAD_PATCH }
  ];
  const PATCH_KEYS = Object.keys(LEAD_PATCH);

  // Synth patch presets: a starting sound for the selected lane. Each one
  // only sets the sound (oscillator, filter, envelope, octave, mono); the
  // lane's level, arp and latch are left as they are, except where a preset
  // is built around the arp.
  const SYNTH_PRESETS = [
    { name: "Fat Bass",    patch: { wave: "sawtooth", octave: -1, detune: 6, sub: 0.7, cutoff: 0.38, reso: 3, envAmt: 0.45, attack: 0.005, decay: 0.25, sustain: 0.35, release: 0.14, mono: true } },
    { name: "Acid Bass",   patch: { wave: "sawtooth", octave: -1, detune: 0, sub: 0.15, cutoff: 0.3, reso: 11, envAmt: 0.75, attack: 0.003, decay: 0.18, sustain: 0.1, release: 0.1, mono: true } },
    { name: "Sub Bass",    patch: { wave: "sine", octave: -1, detune: 0, sub: 0.9, cutoff: 0.5, reso: 0.5, envAmt: 0.1, attack: 0.008, decay: 0.3, sustain: 0.8, release: 0.2, mono: true } },
    { name: "Square Bass", patch: { wave: "square", octave: -1, detune: 3, sub: 0.4, cutoff: 0.45, reso: 2, envAmt: 0.35, attack: 0.004, decay: 0.2, sustain: 0.5, release: 0.12, mono: true } },
    { name: "Pluck",       patch: { wave: "sawtooth", octave: 0, detune: 10, sub: 0.1, cutoff: 0.4, reso: 4, envAmt: 0.7, attack: 0.002, decay: 0.16, sustain: 0.0, release: 0.18, mono: false } },
    { name: "Brass Lead",  patch: { wave: "sawtooth", octave: 0, detune: 12, sub: 0.2, cutoff: 0.55, reso: 1.5, envAmt: 0.5, attack: 0.06, decay: 0.3, sustain: 0.7, release: 0.25, mono: false } },
    { name: "Square Lead", patch: { wave: "square", octave: 0, detune: 7, sub: 0.0, cutoff: 0.7, reso: 2, envAmt: 0.3, attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.2, mono: true } },
    { name: "Soft Pad",    patch: { wave: "triangle", octave: 0, detune: 14, sub: 0.3, cutoff: 0.5, reso: 1, envAmt: 0.25, attack: 0.6, decay: 0.8, sustain: 0.8, release: 1.6, mono: false } },
    { name: "Strings",     patch: { wave: "sawtooth", octave: 0, detune: 18, sub: 0.0, cutoff: 0.48, reso: 0.8, envAmt: 0.2, attack: 0.35, decay: 0.6, sustain: 0.85, release: 1.1, mono: false } },
    { name: "Bell",        patch: { wave: "sine", octave: 1, detune: 24, sub: 0.0, cutoff: 0.9, reso: 0.5, envAmt: 0.0, attack: 0.002, decay: 0.9, sustain: 0.0, release: 1.2, mono: false } },
    { name: "Organ",       patch: { wave: "square", octave: 0, detune: 4, sub: 0.6, cutoff: 0.75, reso: 0.5, envAmt: 0.0, attack: 0.01, decay: 0.1, sustain: 1.0, release: 0.06, mono: false } },
    { name: "Chip Lead",   patch: { wave: "square", octave: 1, detune: 0, sub: 0.0, cutoff: 1.0, reso: 0.5, envAmt: 0.0, attack: 0.001, decay: 0.08, sustain: 0.7, release: 0.04, mono: true } },
    { name: "Arp Pulse",   patch: { wave: "square", octave: 0, detune: 5, sub: 0.2, cutoff: 0.5, reso: 5, envAmt: 0.6, attack: 0.002, decay: 0.12, sustain: 0.1, release: 0.1, mono: false, arp: true, arpMode: "up", arpRate: "1/16", arpOct: 2, arpGate: 0.5 } },
    { name: "Arp Dream",   patch: { wave: "triangle", octave: 0, detune: 9, sub: 0.25, cutoff: 0.6, reso: 2, envAmt: 0.3, attack: 0.01, decay: 0.35, sustain: 0.3, release: 0.6, mono: false, arp: true, arpMode: "updown", arpRate: "1/8", arpOct: 2, arpGate: 0.8 } }
  ];

  /* ============================================================
     2. AUDIO ENGINE
     Built per-AudioContext so the same code renders live and
     offline (WAV export).
     ============================================================ */

  function makeNoiseBuffer(ctx) {
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function makeImpulse(ctx, seconds, decay) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (1 - t * 0.25);
      }
    }
    return buf;
  }

  function driveCurve(amount) {
    const k = amount * 60;
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return curve;
  }

  function createEngine(ctx, out) {
    const E = { ctx: ctx, noise: makeNoiseBuffer(ctx) };

    E.master = ctx.createGain();
    E.master.gain.value = 0.85;

    E.comp = ctx.createDynamicsCompressor();
    E.comp.threshold.value = -10;
    E.comp.knee.value = 14;
    E.comp.ratio.value = 3.5;
    E.comp.attack.value = 0.004;
    E.comp.release.value = 0.16;

    E.drive = ctx.createWaveShaper();
    E.drive.curve = driveCurve(0);
    E.drive.oversample = "2x";

    E.drumBus = ctx.createGain();
    E.synthBus = ctx.createGain();
    E.lanes = LANES.map(function () {
      const g = ctx.createGain();
      g.gain.value = 0.7;
      g.connect(E.synthBus);
      return g;
    });

    // One tempo-synced delay and one plate-ish reverb, fed by four sends:
    // the synth lanes' Delay / Reverb amounts, and the drum machine's Echo /
    // Reverb amounts (which only carry the steps painted with them — the
    // drums are dry unless a step asks). The returns are fixed, so turning
    // one send down never silences another.
    E.delay = ctx.createDelay(2);
    E.delayFb = ctx.createGain();
    E.delayFb.gain.value = 0.35;
    E.delayFilter = ctx.createBiquadFilter();
    E.delayFilter.type = "lowpass";
    E.delayFilter.frequency.value = 3200;
    E.delayReturn = ctx.createGain();
    E.delayReturn.gain.value = 1;

    E.reverb = ctx.createConvolver();
    E.reverb.buffer = makeImpulse(ctx, 2.4, 2.6);
    E.reverbReturn = ctx.createGain();
    E.reverbReturn.gain.value = 1;

    E.synthDelaySend = ctx.createGain();
    E.synthVerbSend = ctx.createGain();
    E.drumEchoSend = ctx.createGain();
    E.drumVerbSend = ctx.createGain();
    [E.synthDelaySend, E.synthVerbSend, E.drumEchoSend, E.drumVerbSend].forEach(function (g) { g.gain.value = 0; });

    E.drumBus.connect(E.drive);
    E.synthBus.connect(E.drive);

    E.synthBus.connect(E.synthDelaySend).connect(E.delay);
    E.drumEchoSend.connect(E.delay);
    E.delay.connect(E.delayFilter);
    E.delayFilter.connect(E.delayFb);
    E.delayFb.connect(E.delay);
    E.delayFilter.connect(E.delayReturn);
    E.delayReturn.connect(E.drive);

    E.synthBus.connect(E.synthVerbSend).connect(E.reverb);
    E.drumVerbSend.connect(E.reverb);
    E.reverb.connect(E.reverbReturn);
    E.reverbReturn.connect(E.drive);

    E.drive.connect(E.comp);
    E.comp.connect(E.master);
    E.master.connect(out || ctx.destination);

    E.openHat = null; // for hat choke
    return E;
  }

  function noiseSource(E, t, dur) {
    const src = E.ctx.createBufferSource();
    src.buffer = E.noise;
    src.loop = true;
    // random offset so repeated hits don't phase-lock
    const off = Math.random() * (E.noise.duration - dur - 0.05);
    src.start(t, Math.max(0, off));
    src.stop(t + dur + 0.02);
    return src;
  }

  function env(param, t, peak, attack, decay, curve) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    if (curve === "linear") param.linearRampToValueAtTime(0.0001, t + attack + decay);
    else param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  /* ---------- individual voices ---------- */

  const SYNTH = {
    BD: function (E, t, vel, p, dest) {
      const ctx = E.ctx;
      const base = lerp(38, 68, p.tune);
      const dur = lerp(0.18, 1.25, p.decay);
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(base * 5.2, t);
      o.frequency.exponentialRampToValueAtTime(base, t + 0.055);
      const g = ctx.createGain();
      env(g.gain, t, vel, 0.003, dur);
      // beater click
      const cl = noiseSource(E, t, 0.02);
      const clf = ctx.createBiquadFilter();
      clf.type = "bandpass";
      clf.frequency.value = 2200;
      const clg = ctx.createGain();
      env(clg.gain, t, vel * 0.18, 0.001, 0.018);
      cl.connect(clf).connect(clg).connect(dest);
      o.connect(g).connect(dest);
      o.start(t);
      o.stop(t + dur + 0.06);
    },

    SD: function (E, t, vel, p, dest) {
      const ctx = E.ctx;
      const f = lerp(140, 260, p.tune);
      const bodyDur = 0.13;
      [f, f * 1.78].forEach(function (freq, i) {
        const o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.setValueAtTime(freq * 1.4, t);
        o.frequency.exponentialRampToValueAtTime(freq, t + 0.02);
        const g = ctx.createGain();
        env(g.gain, t, vel * (i ? 0.4 : 0.62), 0.002, bodyDur);
        o.connect(g).connect(dest);
        o.start(t);
        o.stop(t + bodyDur + 0.05);
      });
      const snapDur = lerp(0.07, 0.42, p.decay);
      const n = noiseSource(E, t, snapDur);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 1400;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 3200;
      bp.Q.value = 0.7;
      const g = ctx.createGain();
      env(g.gain, t, vel * 0.85, 0.001, snapDur);
      n.connect(hp).connect(bp).connect(g).connect(dest);
    },

    tom: function (baseLo, baseHi) {
      return function (E, t, vel, p, dest) {
        const ctx = E.ctx;
        const f = lerp(baseLo, baseHi, p.tune);
        const dur = lerp(0.2, 0.9, p.decay);
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(f * 2.1, t);
        o.frequency.exponentialRampToValueAtTime(f, t + 0.09);
        const g = ctx.createGain();
        env(g.gain, t, vel * 0.9, 0.003, dur);
        o.connect(g).connect(dest);
        o.start(t);
        o.stop(t + dur + 0.05);
        // skin transient
        const n = noiseSource(E, t, 0.03);
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = f * 4;
        const ng = ctx.createGain();
        env(ng.gain, t, vel * 0.12, 0.001, 0.03);
        n.connect(bp).connect(ng).connect(dest);
      };
    },

    RS: function (E, t, vel, p, dest) {
      const ctx = E.ctx;
      const dur = lerp(0.02, 0.09, p.decay);
      const f = lerp(1300, 2200, p.tune);
      [f, f * 1.47].forEach(function (freq) {
        const o = ctx.createOscillator();
        o.type = "square";
        o.frequency.value = freq;
        const g = ctx.createGain();
        env(g.gain, t, vel * 0.32, 0.0008, dur);
        o.connect(g).connect(dest);
        o.start(t);
        o.stop(t + dur + 0.02);
      });
      const n = noiseSource(E, t, dur);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1800;
      bp.Q.value = 2;
      const ng = ctx.createGain();
      env(ng.gain, t, vel * 0.3, 0.0008, dur);
      n.connect(bp).connect(ng).connect(dest);
    },

    CP: function (E, t, vel, p, dest) {
      const ctx = E.ctx;
      const tail = lerp(0.12, 0.5, p.decay);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = lerp(800, 1500, p.tune);
      bp.Q.value = 3.2;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 600;
      const g = ctx.createGain();
      const n = noiseSource(E, t, tail + 0.05);
      n.connect(bp).connect(hp).connect(g).connect(dest);
      // three fast slaps then the room tail
      const gp = g.gain;
      gp.setValueAtTime(0.0001, t);
      [0, 0.011, 0.023].forEach(function (o) {
        gp.setValueAtTime(0.0001, t + o);
        gp.exponentialRampToValueAtTime(vel * 0.75, t + o + 0.001);
        gp.exponentialRampToValueAtTime(0.05 * vel, t + o + 0.01);
      });
      gp.setValueAtTime(vel * 0.8, t + 0.034);
      gp.exponentialRampToValueAtTime(0.0001, t + 0.034 + tail);
    },

    CB: function (E, t, vel, p, dest) {
      const ctx = E.ctx;
      const dur = lerp(0.12, 0.55, p.decay);
      const f = lerp(440, 700, p.tune);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = f * 2.2;
      bp.Q.value = 1.6;
      const g = ctx.createGain();
      env(g.gain, t, vel * 0.5, 0.002, dur);
      bp.connect(g).connect(dest);
      [f, f * 1.48].forEach(function (freq) {
        const o = ctx.createOscillator();
        o.type = "square";
        o.frequency.value = freq;
        o.connect(bp);
        o.start(t);
        o.stop(t + dur + 0.03);
      });
    },

    metal: function (kind) {
      // kind: "CH" | "OH" | "CY"
      return function (E, t, vel, p, dest) {
        const ctx = E.ctx;
        const fund = lerp(30, 52, p.tune);
        let dur;
        if (kind === "CH") dur = lerp(0.02, 0.13, p.decay);
        else if (kind === "OH") dur = lerp(0.12, 0.9, p.decay);
        else dur = lerp(0.5, 2.6, p.decay);

        const bank = ctx.createGain();
        bank.gain.value = 0.4;
        METAL_RATIOS.forEach(function (r) {
          const o = ctx.createOscillator();
          o.type = "square";
          o.frequency.value = fund * r;
          o.connect(bank);
          o.start(t);
          o.stop(t + dur + 0.08);
        });
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = kind === "CY" ? 4200 : 7000;
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = kind === "CY" ? 6500 : 10000;
        bp.Q.value = 0.6;
        const g = ctx.createGain();
        bank.connect(hp).connect(bp).connect(g).connect(dest);

        if (kind === "CY") {
          // two-stage: bright ping into a long wash
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(vel * 0.55, t + 0.002);
          g.gain.exponentialRampToValueAtTime(vel * 0.14, t + 0.18);
          g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        } else {
          env(g.gain, t, vel * 0.55, 0.001, dur);
        }

        // closed hat chokes the open hat, as on the hardware
        if (kind === "OH") {
          E.openHat = { gain: g, until: t + dur };
        } else if (kind === "CH" && E.openHat && E.openHat.until > t) {
          const oh = E.openHat.gain.gain;
          oh.cancelScheduledValues(t);
          oh.setValueAtTime(Math.max(0.0002, oh.value), t);
          oh.exponentialRampToValueAtTime(0.0001, t + 0.02);
          E.openHat = null;
        }
      };
    },

    MA: function (E, t, vel, p, dest) {
      const ctx = E.ctx;
      const dur = lerp(0.02, 0.12, p.decay);
      const n = noiseSource(E, t, dur);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = lerp(4000, 9000, p.tune);
      const g = ctx.createGain();
      env(g.gain, t, vel * 0.5, 0.001, dur, "linear");
      n.connect(hp).connect(g).connect(dest);
    }
  };

  const VOICE_FN = {
    BD: SYNTH.BD,
    SD: SYNTH.SD,
    LT: SYNTH.tom(70, 130),
    MT: SYNTH.tom(110, 200),
    HT: SYNTH.tom(160, 300),
    RS: SYNTH.RS,
    CP: SYNTH.CP,
    CB: SYNTH.CB,
    CH: SYNTH.metal("CH"),
    OH: SYNTH.metal("OH"),
    CY: SYNTH.metal("CY"),
    MA: SYNTH.MA
  };

  // fx: { echo, verb } — a hit normally goes straight to the drum bus; a
  // step painted with Echo or Reverb gets its own tap into those sends
  function trigger(E, id, t, velocity, fx) {
    const p = state.voices[id];
    if (!p) return;
    let dest = E.drumBus;
    if (fx && (fx.echo || fx.verb)) {
      dest = E.ctx.createGain();
      dest.connect(E.drumBus);
      if (fx.echo) dest.connect(E.drumEchoSend);
      if (fx.verb) dest.connect(E.drumVerbSend);
    }
    VOICE_FN[id](E, t, clamp(velocity * p.level, 0.0005, 1.4), p, dest);
  }

  /* ============================================================
     3. STATE
     ============================================================ */

  const BANKS = ["A", "B", "C", "D"];

  // steps / echo / verb: voiceId -> 16 booleans. echo and verb mark the
  // hits that go to the drum Echo and Reverb sends; empty by default.
  const emptyBank = () => emptyBankFor(VOICE_IDS);
  const packBank = (b) => packBankFor(b, VOICE_IDS);

  const state = {
    bpm: 120,
    swing: 0,
    volume: 0.85,
    drive: 0.12,
    accentAmt: 0.55,
    playing: false,
    bank: 0,
    chain: false,
    banks: BANKS.map(emptyBank),
    voices: {},
    mutes: {},
    solos: {},
    lane: 1,
    lanes: LANES.map(function (l) { return { synth: Object.assign({}, l.def), track: emptyTrack() }; }),
    fx: { delay: 0.18, reverb: 0.2 },      // synth sends, shared by both lanes
    drumFx: { echo: 0.45, reverb: 0.5 },   // drum sends — only painted steps use them
    editMode: "hit"                        // what a click on the grid paints: hit | echo | verb
  };
  // the synth panel, the keyboard and the recorder always mean the selected lane
  Object.defineProperty(state, "synth", { get: function () { return state.lanes[state.lane].synth; } });
  Object.defineProperty(state, "track", { get: function () { return state.lanes[state.lane].track; } });

  VOICES.forEach(function (v) {
    state.voices[v.id] = Object.assign({}, v.def);
    state.mutes[v.id] = false;
    state.solos[v.id] = false;
  });

  const undoStack = [];
  function snapshot(label) {
    undoStack.push({
      label: label,
      banks: JSON.parse(JSON.stringify(state.banks)),
      tracks: state.lanes.map(function (l) { return serialiseTrack(l.track); })
    });
    if (undoStack.length > 25) undoStack.shift();
    const b = $("#jc-undoBtn");
    if (b) b.disabled = false;
  }
  function undo() {
    const s = undoStack.pop();
    if (!s) return toast("Nothing to undo");
    state.banks = s.banks;
    s.tracks.forEach(function (t, i) { state.lanes[i].track = normaliseTrack(t); });
    silenceTrack();
    refreshGrid();
    syncTrackUI();
    save();
    toast("Undo: " + s.label);
    if (!undoStack.length) $("#jc-undoBtn").disabled = true;
  }

  const curBank = () => state.banks[state.bank];

  /* ---------- live state read by the 3D machine on the stand ---------- */
  const live = {
    get playing() { return state.playing; },
    get bank() { return state.bank; },
    get bpm() { return state.bpm; },
    get recording() { return recording; },
    get lane() { return state.lane; },
    step: -1,
    pattern: new Array(16).fill(false),
    keys: new Set(),
    scope: function () {
      if (!analyser) return null;
      analyser.getByteTimeDomainData(scopeData);
      return scopeData;
    }
  };
  studio.state.jc808 = live;

  function publishPattern() {
    const pat = curBank();
    for (let i = 0; i < 16; i++) {
      live.pattern[i] = i < pat.length && VOICE_IDS.some(function (id) { return pat.steps[id][i]; });
    }
  }

  function audible(id) {
    if (state.mutes[id]) return false;
    const anySolo = VOICE_IDS.some(function (v) { return state.solos[v]; });
    return anySolo ? state.solos[id] : true;
  }

  /* ============================================================
     4. TRANSPORT / SCHEDULER
     ============================================================ */

  let ctx = null;
  let engine = null;
  const LOOKAHEAD = 25;      // ms between scheduler ticks
  const HORIZON = 0.28;      // seconds scheduled ahead — a long frame or a GC
                             // pause on the main thread must not starve the beat

  // The clock ticks in a Worker: its timer is not throttled when the tab is
  // in the background, and it keeps firing on time while the main thread is
  // busy drawing the room. Falls back to a plain interval if workers are out.
  function makeTicker(fn, ms) {
    let worker = null, timer = null;
    try {
      const src = "let id=null;onmessage=function(e){clearInterval(id);id=null;if(e.data==='start')id=setInterval(function(){postMessage(0);}," + ms + ");};";
      worker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
      worker.onmessage = function () { fn(); };
    } catch (e) { worker = null; }
    return {
      start: function () {
        if (worker) worker.postMessage("start");
        else { clearInterval(timer); timer = setInterval(fn, ms); }
      },
      stop: function () {
        if (worker) worker.postMessage("stop");
        clearInterval(timer);
        timer = null;
      }
    };
  }
  const ticker = makeTicker(function () {
    if (state.playing) scheduler();
    else if (arpFree) arpScheduler();
  }, LOOKAHEAD);

  // The arpeggiator normally rides the sequencer clock. While the transport
  // is stopped it runs on this clock of its own instead, so holding keys
  // (or picking an arp patch) is enough to hear it.
  let arpFree = false, arpStep = 0, arpNextTime = 0;
  function arpHasNotes() {
    const S = state.synth;
    return S.arp && (heldOrder.length > 0 || (S.latch && latched.length > 0));
  }
  function arpWake() {
    if (state.playing || arpFree || !arpHasNotes()) return;
    ensureAudio();
    arpFree = true;
    arpStep = 0;
    arpNextTime = ctx.currentTime + 0.02;
    arpScheduler();
    ticker.start();
  }
  function arpSleep() {
    if (!arpFree) return;
    arpFree = false;
    if (!state.playing) ticker.stop();
  }
  function arpCheck() { if (arpFree && !arpHasNotes()) arpSleep(); }
  function arpScheduler() {
    const now = ctx.currentTime;
    if (!arpHasNotes()) return arpSleep();
    while (arpNextTime < now + HORIZON) {
      scheduleArp(engine, arpStep, arpNextTime, null);
      arpStep++;
      arpNextTime += stepDur();
    }
  }

  let currentStep = 0;
  let nextStepTime = 0;
  let playBank = 0;
  const drawQueue = [];

  function stepDur() { return 60 / state.bpm / 4; }

  function swungTime(step, t) {
    if (step % 2 === 0) return t;
    return t + state.swing * 0.62 * stepDur();
  }

  function emitStep(E, bank, step, time) {
    const pat = state.banks[bank];
    if (step >= pat.length) return;
    const vel = pat.accent[step] ? 1 + state.accentAmt : 0.82;
    VOICE_IDS.forEach(function (id) {
      if (pat.steps[id][step] && audible(id)) {
        trigger(E, id, time, vel, { echo: pat.echo[id][step], verb: pat.verb[id][step] });
      }
    });
  }

  function scheduler() {
    const now = ctx.currentTime;
    pruneTrackVoices(now);
    while (nextStepTime < now + HORIZON) {
      const t = swungTime(currentStep, nextStepTime);
      emitStep(engine, playBank, currentStep, t);
      scheduleArp(engine, currentStep, nextStepTime, songStep);
      scheduleTrack(engine, songStep, nextStepTime, true);
      if (songStep < 0) scheduleCountIn(engine, songStep, nextStepTime);
      drawQueue.push({ step: currentStep, bank: playBank, time: t });
      anchorStep = songStep;
      anchorTime = nextStepTime;
      // advance
      currentStep++;
      songStep++;
      if (currentStep >= state.banks[playBank].length) {
        currentStep = 0;
        if (state.chain) {
          playBank = (playBank + 1) % BANKS.length;
          state.bank = playBank;
          syncBankButtons();
          refreshGrid();
        }
      }
      nextStepTime += stepDur();
    }
  }

  // countIn: start one bar early so a take can begin on bar 1 (Rec from stopped)
  function play(countIn) {
    ensureAudio();
    if (state.playing) return;
    state.playing = true;
    playBank = state.bank;
    currentStep = 0;
    songStep = countIn ? -COUNT_IN : 0;
    nextStepTime = ctx.currentTime + 0.08;
    anchorStep = songStep;
    anchorTime = nextStepTime;
    state.lanes.forEach(function (l) { l.track.notes.forEach(function (n) { delete n._abs; }); });
    rollDirty = true;
    arpFree = false;          // the sequencer clock drives the arp from here
    scheduler();
    ticker.start();
    const b = $("#jc-playBtn");
    b.classList.add("playing");
    b.setAttribute("aria-label", "Stop");
    $("#jc-playIcon").setAttribute("d", ICON_STOP);
  }

  function stop() {
    if (recording) setRecording(false);   // closes held notes at the stop point
    state.playing = false;
    ticker.stop();
    drawQueue.length = 0;
    clearPlayhead();
    silenceTrack();
    allNotesOff();
    rollDirty = true;
    const b = $("#jc-playBtn");
    b.classList.remove("playing");
    b.setAttribute("aria-label", "Play");
    $("#jc-playIcon").setAttribute("d", ICON_PLAY);
  }

  function togglePlay() { state.playing ? stop() : play(); }

  const ICON_PLAY = "M6 4l14 8-14 8z";
  const ICON_STOP = "M6 6h12v12H6z";

  function ensureAudio() {
    studio.audio.start();
    if (!ctx) {
      ctx = studio.audio.ctx;
      engine = createEngine(ctx, studio.audio.bus("jc808"));
      applyMaster();
      startScope();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function applyMaster() {
    if (!engine) return;
    engine.master.gain.value = state.volume;
    engine.drive.curve = driveCurve(state.drive);
    engine.lanes.forEach(function (g, i) { g.gain.value = state.lanes[i].synth.level; });
    engine.synthDelaySend.gain.value = state.fx.delay;
    engine.synthVerbSend.gain.value = state.fx.reverb;
    engine.drumEchoSend.gain.value = state.drumFx.echo;
    engine.drumVerbSend.gain.value = state.drumFx.reverb;
    engine.delay.delayTime.value = clamp((60 / state.bpm) * 0.75, 0.02, 1.9);
  }

  /* ============================================================
     5. SYNTH VOICE (playable + arpeggiator)
     ============================================================ */

  const held = new Map();      // midi -> voice node bundle
  const heldOrder = [];        // midi numbers in press order
  let latched = [];

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function startNote(midi, when, dur) {
    ensureAudio();
    return synthNote(engine, midi, when != null ? when : ctx.currentTime, dur, 1, state.lane);
  }

  // one voice of lane `li` on any engine (live or offline); dur in seconds, or null to hold
  function synthNote(E, midi, t, dur, vel, li) {
    const S = state.lanes[li].synth;
    const ctx = E.ctx;
    const freq = mtof(midi + S.octave * 12);

    const amp = ctx.createGain();
    amp.gain.value = 0.0001;

    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.Q.value = S.reso;
    const baseCut = 120 * Math.pow(2, S.cutoff * 7);
    const peakCut = clamp(baseCut * (1 + S.envAmt * 12), 60, 18000);

    filt.frequency.setValueAtTime(clamp(baseCut, 60, 18000), t);
    filt.frequency.linearRampToValueAtTime(peakCut, t + S.attack + 0.005);
    filt.frequency.exponentialRampToValueAtTime(
      clamp(lerp(baseCut, peakCut, S.sustain * 0.5), 60, 18000),
      t + S.attack + S.decay + 0.01
    );

    const oscs = [];
    [-1, 1].forEach(function (dir) {
      const o = ctx.createOscillator();
      o.type = S.wave;
      o.frequency.setValueAtTime(freq, t);
      o.detune.value = dir * S.detune;
      o.connect(filt);
      oscs.push(o);
    });
    if (S.sub > 0.01) {
      const sub = ctx.createOscillator();
      sub.type = "sine";
      sub.frequency.setValueAtTime(freq / 2, t);
      const sg = ctx.createGain();
      sg.gain.value = S.sub;
      sub.connect(sg).connect(filt);
      oscs.push(sub);
    }

    filt.connect(amp).connect(E.lanes[li]);

    const peak = 0.32 * (vel == null ? 1 : vel);
    amp.gain.cancelScheduledValues(t);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(peak, t + Math.max(0.004, S.attack));
    amp.gain.exponentialRampToValueAtTime(
      Math.max(0.0002, peak * S.sustain),
      t + Math.max(0.004, S.attack) + S.decay
    );

    oscs.forEach(function (o) { o.start(t); });
    const v = { oscs: oscs, amp: amp, filt: filt, midi: midi, started: t, E: E, S: S };

    if (dur != null) {
      endNote(v, t + dur);
    }
    return v;
  }

  function endNote(v, when) {
    const S = v.S;
    const t = Math.max(when != null ? when : v.E.ctx.currentTime, v.started + 0.005);
    const g = v.amp.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.0002, g.value), t);
    g.exponentialRampToValueAtTime(0.0001, t + Math.max(0.02, S.release));
    v.oscs.forEach(function (o) {
      try { o.stop(t + Math.max(0.02, S.release) + 0.05); } catch (e) {}
    });
  }

  // silence a live voice right now, even one scheduled but not yet started
  function killVoice(v) {
    const now = ctx.currentTime;
    const g = v.amp.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(0.0002, g.value), now);
    g.exponentialRampToValueAtTime(0.0001, now + 0.03);
    v.oscs.forEach(function (o) { try { o.stop(now + 0.05); } catch (e) {} });
    setTimeout(function () { try { v.amp.disconnect(); } catch (e) {} }, 120);
  }

  function noteOn(midi) {
    if (held.has(midi)) return;
    if (heldOrder.indexOf(midi) === -1) heldOrder.push(midi);
    if (state.synth.arp) { paintKey(midi, true); arpWake(); return; }  // arp plays it, not us
    if (state.synth.mono) {
      // stealing a voice must clear its key too, or mono still looks polyphonic
      held.forEach(function (v, m) { endNote(v); held.delete(m); paintKey(m, false); recNoteOff(m); });
    }
    if (held.size >= 10) {
      const first = held.keys().next().value;
      endNote(held.get(first));
      held.delete(first);
      paintKey(first, false);
      recNoteOff(first);
    }
    held.set(midi, startNote(midi));
    paintKey(midi, true);
    recNoteOn(midi);
  }

  function noteOff(midi) {
    const i = heldOrder.indexOf(midi);
    if (i > -1) heldOrder.splice(i, 1);
    const v = held.get(midi);
    if (v) { endNote(v); held.delete(midi); recNoteOff(midi); }
    if (!state.synth.latch || !state.synth.arp) paintKey(midi, false);
    arpCheck();
  }

  function allNotesOff(clearLatch) {
    recCloseAll();
    arpSleep();
    held.forEach(function (v) { endNote(v); });
    held.clear();
    heldOrder.length = 0;
    if (!state.synth.latch || clearLatch) latched = [];
    root.querySelectorAll(".wkey.down, .bkey.down").forEach(function (k) {
      k.classList.remove("down");
    });
    latched.forEach(function (m) { paintKey(m, true); });
  }

  /* ---------- arpeggiator ---------- */

  let arpIndex = 0;

  function arpNotes() {
    const S = state.synth;
    const src = (S.latch && latched.length ? latched : heldOrder).slice();
    if (!src.length) return [];
    src.sort(function (a, b) { return a - b; });
    let seq = src.slice();
    if (S.arpMode === "down") seq.reverse();
    else if (S.arpMode === "updown") {
      seq = src.concat(src.slice(1, -1).reverse());
    }
    const out = [];
    for (let o = 0; o < S.arpOct; o++) {
      seq.forEach(function (m) { out.push(m + o * 12); });
    }
    return out;
  }

  function scheduleArp(E, step, baseTime, song) {
    const S = state.synth;
    if (!S.arp) return;
    const notes = arpNotes();
    if (!notes.length) return;
    const sd = stepDur();
    const events = [];

    if (S.arpRate === "1/4") { if (step % 4 === 0) events.push(baseTime); }
    else if (S.arpRate === "1/8") { if (step % 2 === 0) events.push(baseTime); }
    else if (S.arpRate === "1/16") { events.push(swungTime(step, baseTime)); }
    else if (S.arpRate === "1/32") { events.push(baseTime, baseTime + sd / 2); }
    else if (S.arpRate === "1/8T") {
      if (step % 4 === 0) for (let i = 0; i < 3; i++) events.push(baseTime + (i * sd * 4) / 3);
    } else if (S.arpRate === "1/16T") {
      if (step % 4 === 0) for (let i = 0; i < 6; i++) events.push(baseTime + (i * sd * 4) / 6);
    }

    const gateLen = sd * lerp(0.25, 1.6, S.arpGate);
    events.forEach(function (t) {
      let m;
      if (S.arpMode === "random") m = notes[Math.floor(Math.random() * notes.length)];
      else { m = notes[arpIndex % notes.length]; arpIndex++; }
      startNote(m, t, gateLen);
      drawQueue.push({ step: -1, key: m, time: t });
      // the arp's notes go onto the lane as real notes, so the take plays
      // back without the arp (or the keys) held
      if (recording && song != null) {
        const pos = song + (t - baseTime) / sd;
        if (pos >= 0) commitNote(m, pos, gateLen / sd, 1);
      }
    });
  }

  /* ============================================================
     5b. SYNTH LANES — record, play back, piano rolls
     ============================================================ */

  let recording = false;          // armed: keys (and the arp) are written to the selected lane
  const recOpen = new Map();      // midi -> absolute song position of the key press
  const trackVoices = [];         // scheduled playback voices, so stop() can silence them

  // The song clock: steps since play started, negative during the one-bar
  // count-in. Each lane's position is this folded into its own loop length,
  // so a two-bar bass can run under a sixteen-bar lead over any drum pattern.
  const COUNT_IN = STEPS_PER_BAR;
  let songStep = 0;
  let anchorStep = 0, anchorTime = 0;   // last scheduled step and its straight-grid time

  function songPos(at) {
    if (!ctx || !state.playing) return 0;
    const t = at != null ? at : ctx.currentTime;
    return anchorStep + (t - anchorTime) / stepDur();
  }
  // keys are played against what the player hears, which runs one output
  // latency behind the audio clock
  function inputPos() {
    return songPos(ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0));
  }

  function scheduleTrack(E, step, baseTime, isLive) {
    const sd = stepDur();
    state.lanes.forEach(function (lane, li) {
      const T = lane.track;
      if (T.mute || !T.notes.length) return;
      const steps = trackSteps(T);
      const pos = wrapPos(step, steps);
      notesStartingInStep(T, pos).forEach(function (hit) {
        const n = hit.note;
        // a note recorded moments ago must not be re-triggered by the pass it
        // was played in (quantize can snap it onto a step still to come)
        if (isLive && n._abs != null && step + hit.offset - n._abs < 8) return;
        const t = hit.offset === 0 ? swungTime(pos, baseTime) : baseTime + hit.offset * sd;
        const dur = Math.max(0.01, n.d * sd);
        const v = synthNote(E, n.m, t, dur, n.v, li);
        if (isLive) {
          trackVoices.push({ v: v, until: t + dur + Math.max(0.02, lane.synth.release) + 0.1 });
          drawQueue.push({ step: -1, key: n.m, time: t, hold: dur });
        }
      });
    });
  }

  function pruneTrackVoices(now) {
    for (let i = trackVoices.length - 1; i >= 0; i--) {
      if (trackVoices[i].until < now) trackVoices.splice(i, 1);
    }
  }
  function silenceTrack() {
    if (!ctx) return;
    trackVoices.forEach(function (tv) { killVoice(tv.v); });
    trackVoices.length = 0;
  }

  // count-in: a click on each beat of the bar before the take starts
  function scheduleCountIn(E, step, t) {
    if (step % 4 !== 0) return;
    const first = step === -COUNT_IN;
    const o = E.ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = first ? 1760 : 1175;
    const g = E.ctx.createGain();
    env(g.gain, t, first ? 0.5 : 0.32, 0.001, 0.06);
    o.connect(g).connect(E.master);
    o.start(t);
    o.stop(t + 0.1);
  }

  /* ---------- recording ---------- */

  function recNoteOn(midi) {
    if (!recording || !state.playing) return;
    const pos = inputPos();
    if (pos < 0) return;             // still counting in
    recOpen.set(midi, pos);
    rollDirty = true;
  }
  function recNoteOff(midi) {
    const start = recOpen.get(midi);
    if (start == null) return;
    recOpen.delete(midi);
    commitNote(midi, start, inputPos() - start, 1);
  }
  function recCloseAll() {
    if (!recOpen.size) return;
    const end = inputPos();
    recOpen.forEach(function (start, midi) { commitNote(midi, start, end - start, 1); });
    recOpen.clear();
  }
  function commitNote(midi, absStart, dur, vel) {
    const T = state.track;
    const s = wrapPos(absStart, trackSteps(T));
    // a looping arp writes the same note at the same spot every pass — once is enough
    const dup = T.notes.some(function (n) { return n.m === midi && Math.abs(n.s - s) < 0.02; });
    if (!dup) addNote(T, { m: midi, s: s, d: dur, v: vel, _abs: absStart });
    rollDirty = true;
    save();
  }

  function setRecording(on) {
    if (on === recording) return;
    if (on) {
      snapshot("record " + LANES[state.lane].name.toLowerCase());
      recording = true;
      if (!state.playing) { play(true); toast("Count-in… the " + LANES[state.lane].name + " take starts at bar 1"); }
      else toast("Recording — overdubbing onto the " + LANES[state.lane].name + " lane");
    } else {
      recCloseAll();
      recording = false;
    }
    const b = $("#jc-recBtn");
    b.classList.toggle("on", recording);
    b.setAttribute("aria-pressed", recording ? "true" : "false");
    rollDirty = true;
  }
  function toggleRecording() { setRecording(!recording); }

  function selectLane(i) {
    if (i === state.lane) return;
    allNotesOff(true);          // notes and open recordings belong to the lane they were played on
    downKeys.clear();
    state.lane = i;
    arpIndex = 0;
    refreshSynthUI();
    syncTrackUI();
    toast(LANES[i].name + " lane selected — the keys, the synth panel and Rec now mean this lane");
    save();
  }

  /* ---------- piano rolls ---------- */

  const laneUI = [];             // per lane: { el, canvas, ctx, barsSel, quantSel, mute, count, rows }
  let rollDirty = true, lastPosText = "";
  const ROLL_TOP = 14;           // CSS px for the bar-number strip
  const BLACK_SEMIS = [1, 3, 6, 8, 10];

  let rollsNeedSize = true;    // set by the ResizeObserver, handled on the next frame
  function sizeRolls() {
    rollsNeedSize = false;
    const r = window.devicePixelRatio || 1;
    laneUI.forEach(function (u) {
      const rect = u.canvas.getBoundingClientRect();
      u.canvas.width = Math.max(1, Math.round(rect.width * r));
      u.canvas.height = Math.max(1, Math.round(rect.height * r));
      u.ctx = u.canvas.getContext("2d");
      u.layer.width = u.canvas.width;
      u.layer.height = u.canvas.height;
      u.layerDirty = true;
    });
    rollDirty = true;
  }

  // The grid and the notes only change when a note is added, removed or the
  // lane is edited, so they are drawn once into an offscreen layer; every
  // frame while playing is then a single blit plus the playhead.
  function drawRollStatic(li) {
    const u = laneUI[li];
    const T = state.lanes[li].track;
    const selected = li === state.lane;
    const color = LANES[li].color;
    const steps = trackSteps(T);
    const grid = GRIDS[T.quantize] || 0;
    const w = u.layer.width, h = u.layer.height;
    const r = window.devicePixelRatio || 1;
    const g = u.layer.getContext("2d");
    const range = pitchRange(T.notes.filter(function (n) { return n.s < steps; }));
    u.rows = range;
    const rows = range.hi - range.lo + 1;
    const top = ROLL_TOP * r;
    const rowH = (h - top) / rows;
    const xOf = function (pos) { return (pos / steps) * w; };
    const yOf = function (midi) { return top + (range.hi - midi) * rowH; };

    g.clearRect(0, 0, w, h);
    g.fillStyle = "#131316";
    g.fillRect(0, 0, w, h);

    // black-key rows and a line under every C
    g.fillStyle = "rgba(255,255,255,0.03)";
    for (let m = range.lo; m <= range.hi; m++) {
      if (BLACK_SEMIS.indexOf(m % 12) > -1) g.fillRect(0, yOf(m), w, rowH);
    }
    g.strokeStyle = "rgba(255,255,255,0.09)";
    g.lineWidth = 1;
    for (let m = range.lo; m <= range.hi; m++) {
      if (m % 12 === 0) {
        const y = Math.round(yOf(m) + rowH) + 0.5;
        g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      }
    }
    // beat and bar lines
    for (let s = 0; s < steps; s += 4) {
      const isBar = s % STEPS_PER_BAR === 0;
      g.strokeStyle = isBar ? "rgba(236,229,213,0.24)" : "rgba(236,229,213,0.07)";
      const x = Math.round(xOf(s)) + 0.5;
      g.beginPath(); g.moveTo(x, isBar ? 0 : top); g.lineTo(x, h); g.stroke();
    }
    // bar numbers
    g.fillStyle = "#6f6a63";
    g.font = (9 * r) + "px ui-monospace, Menlo, monospace";
    g.textBaseline = "top";
    g.textAlign = "left";
    const every = T.bars > 32 ? 4 : T.bars > 16 ? 2 : 1;
    for (let b = 0; b < T.bars; b += every) g.fillText(String(b + 1), xOf(b * STEPS_PER_BAR) + 3 * r, 2 * r);

    // notes, drawn where they will play (quantized); a long one wraps round the loop
    const noteH = Math.max(2 * r, rowH - 1.5 * r);
    const bar = function (x, y, len) {
      g.fillRect(x, y, Math.min(len, w - x), noteH);
      if (x + len > w) g.fillRect(0, y, x + len - w, noteH);
    };
    g.globalAlpha = T.mute ? 0.35 : selected ? 1 : 0.6;
    T.notes.forEach(function (n) {
      if (n.s >= steps || n.m < range.lo || n.m > range.hi) return;
      const x = xOf(quantizeStart(n.s, grid, steps));
      const y = yOf(n.m) + (rowH - noteH) / 2;
      const len = Math.max(2 * r, xOf(n.d));
      g.fillStyle = color;
      bar(x, y, len);
      g.fillStyle = "rgba(255,255,255,0.4)";
      g.fillRect(x, y, Math.min(1.5 * r, len), noteH);
    });
    g.globalAlpha = 1;
    u.layerDirty = false;
  }

  function drawRoll(li) {
    const u = laneUI[li];
    if (!u || !u.ctx) return;
    if (u.layerDirty) drawRollStatic(li);
    const T = state.lanes[li].track;
    const selected = li === state.lane;
    const steps = trackSteps(T);
    const range = u.rows;
    const w = u.canvas.width, h = u.canvas.height;
    const r = window.devicePixelRatio || 1;
    const g = u.ctx;
    const rows = range.hi - range.lo + 1;
    const top = ROLL_TOP * r;
    const rowH = (h - top) / rows;
    const xOf = function (pos) { return (pos / steps) * w; };
    const yOf = function (midi) { return top + (range.hi - midi) * rowH; };
    const noteH = Math.max(2 * r, rowH - 1.5 * r);
    const bar = function (x, y, len) {
      g.fillRect(x, y, Math.min(len, w - x), noteH);
      if (x + len > w) g.fillRect(0, y, x + len - w, noteH);
    };
    g.drawImage(u.layer, 0, 0);

    // keys held right now while recording, growing from where they were pressed
    if (selected && recOpen.size && state.playing) {
      const now = inputPos();
      g.fillStyle = "#ff3a3a";
      recOpen.forEach(function (start, midi) {
        if (midi < range.lo || midi > range.hi) return;
        bar(xOf(wrapPos(start, steps)), yOf(midi) + (rowH - noteH) / 2, Math.max(2 * r, xOf(Math.max(0, now - start))));
      });
    }

    if (state.playing) {
      const pos = songPos();
      if (pos < 0 && selected && recording) {
        g.fillStyle = "rgba(216,56,44,0.12)";
        g.fillRect(0, top, w, h - top);
        g.fillStyle = "#ff8a7a";
        g.font = "600 " + (11 * r) + "px ui-monospace, Menlo, monospace";
        g.textBaseline = "middle";
        g.textAlign = "center";
        g.fillText("COUNT-IN  " + (Math.floor((pos + COUNT_IN) / 4) + 1), w / 2, (h + top) / 2);
      }
      const x = Math.round(xOf(wrapPos(pos, steps))) + 0.5;
      g.strokeStyle = selected && recording ? "#ff3a3a" : selected ? "#ece5d5" : "rgba(236,229,213,0.5)";
      g.lineWidth = 1.5 * r;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
    } else if (!T.notes.length) {
      g.fillStyle = "#6f6a63";
      g.font = (11 * r) + "px 'Helvetica Neue', Helvetica, Arial, sans-serif";
      g.textBaseline = "middle";
      g.textAlign = "center";
      g.fillText(selected
        ? "Press Rec and play the keys — this lane loops every " + T.bars + (T.bars === 1 ? " bar" : " bars")
        : "Click " + LANES[li].name + " to select this lane, then Rec", w / 2, (h + top) / 2);
    }
  }

  // where a pointer event lands on a lane's roll, in steps and midi
  function rollHit(li, e) {
    const u = laneUI[li];
    const rect = u.canvas.getBoundingClientRect();
    const steps = trackSteps(state.lanes[li].track);
    const rows = u.rows.hi - u.rows.lo + 1;
    const rowH = (rect.height - ROLL_TOP) / rows;
    return {
      pos: ((e.clientX - rect.left) / rect.width) * steps,
      midi: u.rows.hi - Math.floor((e.clientY - rect.top - ROLL_TOP) / rowH),
      slack: (steps / rect.width) * 6   // six pixels, so tiny notes stay clickable
    };
  }

  function updateTrackReadout() {
    let text = "1.1";
    if (state.playing) {
      const p = songPos();
      text = p < 0 ? "–" : barBeat(p, trackSteps(state.track));
    }
    if (text !== lastPosText) { lastPosText = text; $("#jc-trackPos").textContent = text; }
  }

  function updateLaneCounts() {
    laneUI.forEach(function (u, i) {
      const T = state.lanes[i].track;
      const n = T.notes.filter(function (x) { return x.s < trackSteps(T); }).length;
      const text = n ? n + (n === 1 ? " note" : " notes") : "empty";
      if (u.count.textContent !== text) u.count.textContent = text;
    });
  }

  function syncTrackUI() {
    laneUI.forEach(function (u, i) {
      const T = state.lanes[i].track;
      if (!u.barsSel.querySelector('option[value="' + T.bars + '"]')) {
        const o = el("option", null, String(T.bars));
        o.value = String(T.bars);
        u.barsSel.appendChild(o);
      }
      u.barsSel.value = String(T.bars);
      u.quantSel.value = T.quantize;
      u.vol.setValue(state.lanes[i].synth.level);
      u.mute.classList.toggle("on", T.mute);
      u.mute.textContent = T.mute ? "Muted" : "Mute";
      u.mute.setAttribute("aria-pressed", T.mute ? "true" : "false");
      u.el.classList.toggle("selected", i === state.lane);
    });
    updateLaneCounts();
    rollDirty = true;
  }

  function buildLanes() {
    const host = $("#jc-lanes");
    host.innerHTML = "";
    laneUI.length = 0;
    LANES.forEach(function (l, i) {
      const lane = el("div", "lane");
      lane.style.setProperty("--lcolor", l.color);
      const head = el("div", "lane-head");

      const name = el("button", "lane-name");
      name.type = "button";
      name.title = "Select the " + l.name + " lane (Q switches lanes)";
      name.appendChild(el("span", "swatch"));
      name.appendChild(el("span", null, l.name));
      name.addEventListener("click", function () { selectLane(i); });
      head.appendChild(name);

      // the lane's level, right where its take is — the same value as the
      // Level fader in the synth's Mix module for the selected lane
      const vol = Knob({
        label: "Volume", min: 0, max: 1, value: state.lanes[i].synth.level, step: 0.01, format: pct,
        reset: function () { return l.def.level; },
        onChange: function (v) {
          state.lanes[i].synth.level = v;
          applyMaster();
          if (i === state.lane && synthKnobs.level) synthKnobs.level.setValue(v);
          save();
        }
      });
      vol.classList.add("sm");
      vol.title = "Volume of the " + l.name + " lane";
      head.appendChild(vol);

      const barsField = el("label", "field");
      barsField.appendChild(el("span", null, "Bars"));
      const barsSel = el("select", "select");
      BAR_CHOICES.forEach(function (n) {
        const o = el("option", null, String(n));
        o.value = String(n);
        barsSel.appendChild(o);
      });
      barsSel.addEventListener("change", function () {
        state.lanes[i].track.bars = parseInt(this.value, 10);
        rollDirty = true;
        save();
        toast(l.name + " lane loops every " + this.value + (this.value === "1" ? " bar" : " bars"));
      });
      barsField.appendChild(barsSel);
      head.appendChild(barsField);

      const quantField = el("label", "field");
      quantField.appendChild(el("span", null, "Quantize"));
      const quantSel = el("select", "select");
      Object.keys(GRIDS).forEach(function (q) {
        const o = el("option", null, q === "off" ? "Off" : q);
        o.value = q;
        quantSel.appendChild(o);
      });
      quantSel.addEventListener("change", function () {
        state.lanes[i].track.quantize = this.value;
        rollDirty = true;
        save();
      });
      quantField.appendChild(quantSel);
      head.appendChild(quantField);

      const mute = el("button", "btn", "Mute");
      mute.type = "button";
      mute.addEventListener("click", function () {
        const T = state.lanes[i].track;
        T.mute = !T.mute;
        if (T.mute) silenceTrack();
        syncTrackUI();
        save();
      });
      head.appendChild(mute);

      const clear = el("button", "btn danger", "Clear");
      clear.type = "button";
      clear.addEventListener("click", function () {
        const T = state.lanes[i].track;
        if (!T.notes.length) return toast("The " + l.name + " lane is already empty");
        snapshot("clear " + l.name.toLowerCase());
        T.notes = [];
        if (i === state.lane) recOpen.clear();
        silenceTrack();
        syncTrackUI();
        save();
        toast("Cleared the " + l.name + " lane");
      });
      head.appendChild(clear);

      const midi = el("button", "btn", "MIDI");
      midi.type = "button";
      midi.title = "Download this lane as a MIDI file (and keep it as a cart in the tape library)";
      midi.addEventListener("click", function () { exportLaneMidi(i); });
      head.appendChild(midi);

      const count = el("span", "lane-count", "empty");
      head.appendChild(count);

      const canvas = el("canvas", "roll");
      canvas.setAttribute("aria-label", l.name + " lane piano roll — click a note to remove it");
      canvas.addEventListener("pointerdown", function (e) {
        const hit = rollHit(i, e);
        const T = state.lanes[i].track;
        const n = noteAt(T, hit.pos, hit.midi, hit.slack);
        if (!n) { selectLane(i); return; }
        snapshot("remove note");
        T.notes.splice(T.notes.indexOf(n), 1);
        syncTrackUI();
        save();
        toast("Removed " + noteName(n.m) + " from bar " + (Math.floor(n.s / STEPS_PER_BAR) + 1) + " — Undo brings it back");
      });
      canvas.addEventListener("pointermove", function (e) {
        const hit = rollHit(i, e);
        canvas.style.cursor = noteAt(state.lanes[i].track, hit.pos, hit.midi, hit.slack) ? "pointer" : "default";
      });

      lane.appendChild(head);
      lane.appendChild(canvas);
      host.appendChild(lane);
      laneUI.push({ el: lane, canvas: canvas, ctx: null, layer: document.createElement("canvas"), layerDirty: true, barsSel: barsSel, quantSel: quantSel, mute: mute, vol: vol, count: count, rows: { lo: 55, hi: 84 } });
    });
    sizeRolls();
    // the panel animates open after the rolls are first sized, so re-size
    // when the canvases actually change — without polling layout every frame
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(function () { rollsNeedSize = true; });
      laneUI.forEach(function (u) { ro.observe(u.canvas); });
    } else window.addEventListener("resize", function () { rollsNeedSize = true; });
    syncTrackUI();
  }

  function exportLaneMidi(li) {
    const lane = state.lanes[li];
    const def = LANES[li];
    // notes are stored as the key played; the lane's octave is part of its sound
    const notes = trackToMidiNotes(lane.track, state.bpm).map(function (n) {
      return { pitch: clamp(n.pitch + lane.synth.octave * 12, 0, 127), start: n.start, dur: n.dur, vel: n.vel };
    });
    if (!notes.length) return toast("Nothing on the " + def.name + " lane yet — select it, press Rec and play");
    const bytes = writeMidi({ bpm: state.bpm, tracks: [{ name: "JC-808 " + def.name, channel: li, program: def.program, notes: notes }] });
    const name = "jc808-" + def.id + "-" + state.bpm + "bpm-" + lane.track.bars + "bars.mid";
    try {
      studio.library.addMidi({ name: name, seq: parseMidi(bytes, name), bytes: bytes, source: "JC-808", meta: { bpm: state.bpm } });
    } catch (e) {}
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([bytes], { type: "audio/midi" }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast("Exported " + name + " — it's also in the tape library as a cart");
  }

  /* ============================================================
     6. UI — faders
     Every continuous control is a vertical fader, low at the bottom and
     high at the top like a channel fader on a mixing desk. Grab the cap
     (or click anywhere on the track) and drag; the fader only moves while
     the button is held. Shift-drag is fine, wheel nudges, arrows step,
     double-click resets. Returns the same wrap/setValue API as before, so
     the voice drawers, the transport and the synth modules are unchanged.
     ============================================================ */

  const CAP_H = 14;   // CSS px, must match .fader-cap in jc808.css

  function Knob(opts) {
    const min = opts.min != null ? opts.min : 0;
    const max = opts.max != null ? opts.max : 1;
    const step = opts.step || (max - min) / 100;
    let value = clamp(opts.value, min, max);

    const wrap = el("div", "knob-wrap fader-wrap");
    const read = el("div", "knob-value");
    const btn = el("button", "fader");
    btn.type = "button";
    btn.setAttribute("role", "slider");
    btn.setAttribute("aria-label", opts.label);
    btn.setAttribute("aria-orientation", "vertical");
    const track = el("span", "fader-track");
    const fill = el("span", "fader-fill");
    const cap = el("span", "fader-cap");
    track.appendChild(fill);
    track.appendChild(cap);
    btn.appendChild(track);
    const label = el("div", "knob-label", opts.label);
    wrap.appendChild(read);
    wrap.appendChild(btn);
    wrap.appendChild(label);

    function render() {
      const norm = (value - min) / (max - min);
      fill.style.height = (norm * 100).toFixed(2) + "%";
      cap.style.bottom = "calc(" + (norm * 100).toFixed(2) + "% - " + (norm * CAP_H).toFixed(2) + "px)";
      read.textContent = opts.format ? opts.format(value) : Math.round(value * 100) / 100;
      btn.setAttribute("aria-valuenow", String(Math.round(value * 1000) / 1000));
      btn.setAttribute("aria-valuemin", String(min));
      btn.setAttribute("aria-valuemax", String(max));
      btn.setAttribute("aria-valuetext", String(read.textContent));
    }

    function set(v, fire) {
      const nv = clamp(Math.round(v / step) * step, min, max);
      if (nv === value && fire !== "force") { render(); return; }
      value = nv;
      render();
      if (opts.onChange) opts.onChange(value);
    }

    // where the cap's centre would have to be for the pointer to hold it
    function valueAt(clientY) {
      const r = track.getBoundingClientRect();
      const travel = Math.max(1, r.height - CAP_H);
      const norm = 1 - (clientY - r.top - CAP_H / 2) / travel;
      return min + clamp(norm, 0, 1) * (max - min);
    }

    // The drag is tracked on the window, so the fader only moves while the
    // button is actually held: leaving the fader (or the panel, or the
    // browser window) and letting go always ends the drag, and a mouse that
    // comes back with no button down never moves it.
    let dragging = null, lastY = 0, fineAcc = 0;
    function move(e) {
      if (dragging === null || e.pointerId !== dragging) return;
      if (e.pointerType === "mouse" && e.buttons === 0) { release(e); return; }
      if (e.shiftKey) {
        const r = track.getBoundingClientRect();
        fineAcc = clamp(fineAcc + ((lastY - e.clientY) / Math.max(1, r.height - CAP_H)) * 0.25 * (max - min), min, max);
        set(fineAcc);
      } else {
        set(valueAt(e.clientY));
        fineAcc = value;
      }
      lastY = e.clientY;
    }
    function release(e) {
      if (dragging === null) return;
      if (e && e.pointerId != null && e.pointerId !== dragging) return;
      try { btn.releasePointerCapture(dragging); } catch (err) {}
      dragging = null;
      btn.classList.remove("dragging");
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      window.removeEventListener("blur", release);
    }
    btn.addEventListener("pointerdown", function (e) {
      if (e.button != null && e.button !== 0) return;
      release();
      dragging = e.pointerId;
      lastY = e.clientY;
      btn.classList.add("dragging");
      try { btn.setPointerCapture(e.pointerId); } catch (err) {}
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", release, true);
      window.addEventListener("pointercancel", release, true);
      window.addEventListener("blur", release);
      btn.focus({ preventScroll: true });
      e.preventDefault();
      // a click on the track jumps the cap there; shift keeps it where it is
      if (!e.shiftKey) set(valueAt(e.clientY));
      fineAcc = value;
    });
    btn.addEventListener("dblclick", function () { set(opts.reset ? opts.reset() : opts.value, "force"); });
    btn.addEventListener("wheel", function (e) {
      e.preventDefault();
      set(value + (e.deltaY < 0 ? 1 : -1) * step * (e.shiftKey ? 1 : 4));
    }, { passive: false });
    btn.addEventListener("keydown", function (e) {
      const big = (max - min) / 10;
      if (e.key === "ArrowUp" || e.key === "ArrowRight") { set(value + (e.shiftKey ? step : big / 5)); e.preventDefault(); }
      else if (e.key === "ArrowDown" || e.key === "ArrowLeft") { set(value - (e.shiftKey ? step : big / 5)); e.preventDefault(); }
      else if (e.key === "Home") { set(min); e.preventDefault(); }
      else if (e.key === "End") { set(max); e.preventDefault(); }
    });

    render();
    wrap.setValue = function (v) { value = clamp(v, min, max); render(); };
    wrap.getValue = function () { return value; };
    return wrap;
  }

  const pct = (v) => Math.round(v * 100) + "%";

  /* ============================================================
     7. UI — step grid
     ============================================================ */

  const stepEls = {};   // voiceId -> [buttons]
  let accentEls = [];
  const trackEls = {};

  function buildGrid() {
    const machine = $("#jc-machine");
    machine.innerHTML = "";

    const ruler = el("div", "ruler");
    ruler.appendChild(el("span", null, "Pattern"));
    for (let i = 0; i < 16; i++) {
      const b = el("b", i % 4 === 0 ? "beat" : null, i % 4 === 0 ? String(i / 4 + 1) : "·");
      ruler.appendChild(b);
    }
    machine.appendChild(ruler);

    VOICES.forEach(function (v) {
      const row = el("div", "track");
      row.style.setProperty("--tcolor", v.color);
      trackEls[v.id] = row;

      const label = el("div", "track-label");

      const trig = el("button", "track-trigger");
      trig.type = "button";
      trig.title = "Play " + v.name + "  (key " + v.key + ")";
      const sw = el("span", "swatch");
      trig.appendChild(sw);
      trig.appendChild(el("span", "track-abbr", v.id));
      trig.appendChild(el("span", "track-name", v.name));
      trig.addEventListener("pointerdown", function () { hitVoice(v.id); });
      label.appendChild(trig);

      const mute = el("button", "mini", "M");
      mute.type = "button";
      mute.dataset.role = "mute";
      mute.title = "Mute " + v.name;
      mute.addEventListener("click", function () {
        state.mutes[v.id] = !state.mutes[v.id];
        mute.classList.toggle("on", state.mutes[v.id]);
        updateDim();
        save();
      });

      const solo = el("button", "mini", "S");
      solo.type = "button";
      solo.dataset.role = "solo";
      solo.title = "Solo " + v.name;
      solo.addEventListener("click", function () {
        state.solos[v.id] = !state.solos[v.id];
        solo.classList.toggle("on", state.solos[v.id]);
        updateDim();
        save();
      });

      const more = el("button", "mini", "▾");
      more.type = "button";
      more.title = "Voice controls";
      more.addEventListener("click", function () { row.classList.toggle("expanded"); });

      label.appendChild(mute);
      label.appendChild(solo);
      label.appendChild(more);
      row.appendChild(label);

      stepEls[v.id] = [];
      for (let i = 0; i < 16; i++) {
        const s = el("button", "step" + (i % 4 === 0 ? " beat" : ""));
        s.type = "button";
        s.dataset.group = String(Math.floor(i / 4));
        s.dataset.i = String(i);
        s.style.color = v.color;
        s.setAttribute("aria-label", v.name + " step " + (i + 1));
        s.setAttribute("aria-pressed", "false");
        s.appendChild(el("i", "fx-e"));
        s.appendChild(el("i", "fx-r"));
        s.addEventListener("click", function (e) { clickStep(v.id, i, e); });
        stepEls[v.id].push(s);
        row.appendChild(s);
      }

      // per-voice knob drawer
      const strip = el("div", "voice-strip");
      const p = state.voices[v.id];
      strip.appendChild(el("div", "knob-label", v.name));
      [
        { k: "level", label: "Level" },
        { k: "tune", label: "Tune" },
        { k: "decay", label: "Decay" }
      ].forEach(function (def) {
        strip.appendChild(
          Knob({
            label: def.label,
            min: 0, max: def.k === "level" ? 1.2 : 1,
            value: p[def.k],
            step: 0.01,
            format: pct,
            onChange: function (val) { p[def.k] = val; save(); }
          })
        );
      });
      const audition = el("button", "btn ghost", "Audition");
      audition.type = "button";
      audition.addEventListener("click", function () { hitVoice(v.id); });
      strip.appendChild(audition);
      const reset = el("button", "btn ghost", "Reset");
      reset.type = "button";
      reset.addEventListener("click", function () {
        Object.assign(state.voices[v.id], v.def);
        row.querySelectorAll(".knob-wrap").forEach(function (kw, idx) {
          kw.setValue([v.def.level, v.def.tune, v.def.decay][idx]);
        });
        save();
      });
      strip.appendChild(reset);
      row.appendChild(strip);

      machine.appendChild(row);
    });

    // accent lane
    const arow = el("div", "track accent");
    const alabel = el("div", "track-label");
    const atrig = el("span", "track-trigger");
    atrig.appendChild(el("span", "track-abbr", "AC"));
    atrig.appendChild(el("span", "track-name", "Accent"));
    alabel.appendChild(atrig);
    arow.appendChild(alabel);
    accentEls = [];
    for (let i = 0; i < 16; i++) {
      const s = el("button", "step" + (i % 4 === 0 ? " beat" : ""));
      s.type = "button";
      s.dataset.group = String(Math.floor(i / 4));
      s.style.color = "#ffc46b";
      s.setAttribute("aria-label", "Accent step " + (i + 1));
      s.addEventListener("click", function () {
        snapshotDebounced("edit");
        curBank().accent[i] = !curBank().accent[i];
        refreshGrid();
        save();
      });
      accentEls.push(s);
      arow.appendChild(s);
    }
    machine.appendChild(arow);

    refreshGrid();
    updateDim();
  }

  let editSnapTimer = null;
  function snapshotDebounced(label) {
    if (editSnapTimer) return;
    snapshot(label);
    editSnapTimer = setTimeout(function () { editSnapTimer = null; }, 1200);
  }

  // Hit mode toggles the hit. Echo / Reverb mode (or shift-click / alt-click
  // in any mode) paints that effect onto the hit, switching the hit on if
  // it was off; a second click takes the effect off again but keeps the hit.
  function clickStep(id, i, e) {
    const mode = e && e.shiftKey ? "echo" : e && e.altKey ? "verb" : state.editMode;
    if (mode === "hit") return toggleStep(id, i);
    snapshotDebounced("edit");
    const pat = curBank();
    const lane = pat[mode][id];
    if (!pat.steps[id][i]) { pat.steps[id][i] = true; lane[i] = true; }
    else lane[i] = !lane[i];
    refreshGrid();
    if (!state.playing) hitVoice(id, { echo: pat.echo[id][i], verb: pat.verb[id][i] });
    save();
  }

  function toggleStep(id, i) {
    snapshotDebounced("edit");
    const pat = curBank();
    pat.steps[id][i] = !pat.steps[id][i];
    if (!pat.steps[id][i]) { pat.echo[id][i] = false; pat.verb[id][i] = false; }
    refreshGrid();
    if (!state.playing && pat.steps[id][i]) hitVoice(id);
    save();
  }

  function setEditMode(mode) {
    state.editMode = mode;
    const machine = $("#jc-machine");
    machine.classList.toggle("mode-echo", mode === "echo");
    machine.classList.toggle("mode-verb", mode === "verb");
    const seg = $("#jc-editSeg");
    if (seg) markSeg(seg, mode);
  }

  function refreshGrid() {
    publishPattern();
    const pat = curBank();
    VOICE_IDS.forEach(function (id) {
      stepEls[id].forEach(function (s, i) {
        const on = pat.steps[id][i];
        s.classList.toggle("on", on);
        s.setAttribute("aria-pressed", on ? "true" : "false");
        s.classList.toggle("past-length", i >= pat.length);
        s.classList.toggle("has-echo", on && pat.echo[id][i]);
        s.classList.toggle("has-verb", on && pat.verb[id][i]);
      });
    });
    accentEls.forEach(function (s, i) {
      s.classList.toggle("on", pat.accent[i]);
      s.classList.toggle("past-length", i >= pat.length);
    });
    VOICES.forEach(function (v) {
      const row = trackEls[v.id];
      row.querySelector('[data-role="mute"]').classList.toggle("on", state.mutes[v.id]);
      row.querySelector('[data-role="solo"]').classList.toggle("on", state.solos[v.id]);
    });
  }

  function updateDim() {
    VOICE_IDS.forEach(function (id) {
      trackEls[id].classList.toggle("dimmed", !audible(id));
    });
  }

  function hitVoice(id, fx) {
    ensureAudio();
    trigger(engine, id, ctx.currentTime + 0.001, 1, fx);
    const row = trackEls[id];
    if (row) {
      const t = row.querySelector(".track-trigger");
      t.classList.add("lit");
      setTimeout(function () { t.classList.remove("lit"); }, 110);
    }
  }

  /* ---------- playhead animation ---------- */

  let lastPlayhead = -1;
  function clearPlayhead() {
    root.querySelectorAll(".step.playhead").forEach(function (s) { s.classList.remove("playhead"); });
    lastPlayhead = -1;
    live.step = -1;
  }
  function paintPlayhead(step) {
    if (step === lastPlayhead) { live.step = step; return; }
    clearPlayhead();
    live.step = step;        // after clearPlayhead, which resets it — the 3D LEDs read this
    lastPlayhead = step;
    VOICE_IDS.forEach(function (id) {
      const s = stepEls[id][step];
      if (s) s.classList.add("playhead");
    });
    if (accentEls[step]) accentEls[step].classList.add("playhead");
  }

  function drawLoop() {
    requestAnimationFrame(drawLoop);
    if (!ctx) return;
    const now = ctx.currentTime;
    // drum steps and arp notes interleave, so the queue isn't strictly
    // ordered by time — pull everything that is due, then replay in order
    const due = [];
    for (let i = drawQueue.length - 1; i >= 0; i--) {
      if (drawQueue[i].time <= now) due.push(drawQueue.splice(i, 1)[0]);
    }
    due.sort(function (a, b) { return a.time - b.time; });
    due.forEach(function (ev) {
      if (ev.step >= 0) paintPlayhead(ev.step);
      if (ev.key != null) flashKey(ev.key, ev.hold ? ev.hold * 1000 : 0);
    });
    if (!isActive()) return;          // nothing on screen: the 3D model has its own scope
    drawScope();
    if (rollsNeedSize) sizeRolls();
    if (state.playing || rollDirty) {
      if (rollDirty) laneUI.forEach(function (u) { u.layerDirty = true; });
      laneUI.forEach(function (_, i) { drawRoll(i); });
      if (rollDirty) updateLaneCounts();
      rollDirty = false;
    }
    updateTrackReadout();
  }

  /* ============================================================
     8. UI — keyboard
     ============================================================ */

  const WHITE = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16];      // C D E F G A B C D E
  const BLACK = [
    { semi: 1, after: 0 }, { semi: 3, after: 1 },
    { semi: 6, after: 3 }, { semi: 8, after: 4 }, { semi: 10, after: 5 },
    { semi: 13, after: 7 }, { semi: 15, after: 8 }
  ];
  const BASE_MIDI = 60; // C4

  const KEY_MAP = {
    a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7,
    y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ";": 16
  };
  const CAPS = {};
  Object.keys(KEY_MAP).forEach(function (k) { CAPS[KEY_MAP[k]] = k; });

  const keyEls = {}; // midi -> element

  function buildKeyboard() {
    const kb = $("#jc-keyboard");
    kb.innerHTML = "";
    const whiteEls = [];

    WHITE.forEach(function (semi, i) {
      const midi = BASE_MIDI + semi;
      const b = el("button", "wkey" + (semi % 12 === 0 ? " root" : ""));
      b.type = "button";
      b.dataset.midi = String(midi);
      b.appendChild(el("span", "key-cap", (CAPS[semi] || "").toUpperCase()));
      b.setAttribute("aria-label", "Note " + noteName(midi));
      kb.appendChild(b);
      whiteEls.push(b);
      keyEls[midi] = b;
    });

    BLACK.forEach(function (bk) {
      const midi = BASE_MIDI + bk.semi;
      const b = el("button", "bkey");
      b.type = "button";
      b.dataset.midi = String(midi);
      b.dataset.after = String(bk.after);
      b.appendChild(el("span", "key-cap", (CAPS[bk.semi] || "").toUpperCase()));
      b.setAttribute("aria-label", "Note " + noteName(midi));
      kb.appendChild(b);
      keyEls[midi] = b;
    });

    function layout() {
      BLACK.forEach(function (bk) {
        const w = whiteEls[bk.after];
        const b = keyEls[BASE_MIDI + bk.semi];
        if (w && b) b.style.left = w.offsetLeft + w.offsetWidth - 14 + "px";
      });
    }
    layout();
    if (window.ResizeObserver) new ResizeObserver(layout).observe(kb);
    else window.addEventListener("resize", layout);

    // pointer input — black keys are siblings, so no double-trigger
    let pointerMidi = null;
    function midiAt(x, y) {
      const target = document.elementFromPoint(x, y);
      if (!target) return null;
      const key = target.closest(".wkey, .bkey");
      return key ? Number(key.dataset.midi) : null;
    }
    kb.addEventListener("pointerdown", function (e) {
      const m = midiAt(e.clientX, e.clientY);
      if (m == null) return;
      e.preventDefault();
      pointerMidi = m;
      pressNote(m);
      kb.setPointerCapture(e.pointerId);
    });
    kb.addEventListener("pointermove", function (e) {
      if (pointerMidi == null) return;
      const m = midiAt(e.clientX, e.clientY);
      if (m != null && m !== pointerMidi) {
        releaseNote(pointerMidi);
        pointerMidi = m;
        pressNote(m);
      }
    });
    function up(e) {
      if (pointerMidi == null) return;
      releaseNote(pointerMidi);
      pointerMidi = null;
      try { kb.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    kb.addEventListener("pointerup", up);
    kb.addEventListener("pointercancel", up);
    window.addEventListener("blur", function () { allNotesOff(); });
  }

  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  function noteName(m) { return NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1); }

  function paintKey(midi, on) {
    if (on) live.keys.add(midi); else live.keys.delete(midi);
    const k = keyEls[midi];
    if (k) k.classList.toggle("down", on);
  }
  // arp notes use their own class so they never clear a held or latched key
  const flashTimers = new Map();   // midi -> timeout, so a long note outlives a short flash
  function flashKey(midi, ms) {
    const hold = Math.max(110, ms || 0);
    live.keys.add(midi);
    const k = keyEls[midi];
    if (k) k.classList.add("flash");
    clearTimeout(flashTimers.get(midi));
    flashTimers.set(midi, setTimeout(function () {
      flashTimers.delete(midi);
      if (!held.has(midi) && latched.indexOf(midi) === -1) live.keys.delete(midi);
      if (k) k.classList.remove("flash");
    }, hold));
  }

  function pressNote(midi) {
    ensureAudio();
    const S = state.synth;
    if (S.arp && S.latch) {
      // latch toggles notes in and out of the held chord, so a chord can be
      // built one key at a time with the mouse. Esc / Panic clears it.
      if (latched.indexOf(midi) === -1) latched.push(midi);
      else latched.splice(latched.indexOf(midi), 1);
      Object.keys(keyEls).forEach(function (m) { paintKey(Number(m), latched.indexOf(Number(m)) > -1); });
      heldOrder.push(midi);
      arpWake();
      arpCheck();
      return;
    }
    noteOn(midi);
  }
  function releaseNote(midi) {
    if (state.synth.arp && state.synth.latch) {
      const i = heldOrder.indexOf(midi);
      if (i > -1) heldOrder.splice(i, 1);
      return;
    }
    noteOff(midi);
  }

  /* ============================================================
     9. COMPUTER KEYBOARD
     ============================================================ */

  const downKeys = new Set();

  function isTypingTarget(t) {
    return t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  }

  const isActive = () => studio.activeTool === "jc808";

  // picking from a dropdown leaves it focused, which would swallow the
  // synth keys and the drum pads — hand focus back as soon as it is used
  root.addEventListener("change", function (e) {
    if (e.target && e.target.tagName === "SELECT") e.target.blur();
  });

  document.addEventListener("keydown", function (e) {
    if (!isActive()) return;
    if (isTypingTarget(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.repeat) return;

    const k = e.key.toLowerCase();

    if (e.code === "Space") {
      e.preventDefault();
      togglePlay();
      return;
    }
    if (k === "z") { setOctave(state.synth.octave - 1); return; }
    if (k === "x") { setOctave(state.synth.octave + 1); return; }
    if (k === "r") { e.preventDefault(); toggleRecording(); return; }
    if (k === "q") { e.preventDefault(); selectLane(1 - state.lane); return; }
    if (k === "escape") { allNotesOff(true); return; }

    // drum triggers on the number row
    const v = VOICES.find(function (vv) { return vv.key === e.key; });
    if (v) {
      e.preventDefault();
      if (downKeys.has(e.key)) return;
      downKeys.add(e.key);
      hitVoice(v.id);
      return;
    }

    // synth keys
    if (KEY_MAP[k] !== undefined) {
      e.preventDefault();
      if (downKeys.has(k)) return;   // guards auto-repeat & stuck notes
      downKeys.add(k);
      pressNote(BASE_MIDI + KEY_MAP[k]);
    }
  });

  document.addEventListener("keyup", function (e) {
    const k = e.key.toLowerCase();
    downKeys.delete(e.key);
    downKeys.delete(k);
    if (KEY_MAP[k] !== undefined) releaseNote(BASE_MIDI + KEY_MAP[k]);
  });

  // never leave a note ringing when focus leaves the page
  window.addEventListener("blur", function () { downKeys.clear(); allNotesOff(); });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { downKeys.clear(); allNotesOff(); }
  });

  function setOctave(o) {
    state.synth.octave = clamp(o, -3, 3);
    $("#jc-octReadout").textContent = (state.synth.octave >= 0 ? "+" : "") + state.synth.octave;
    save();
  }

  /* ============================================================
     10. PATTERNS / PRESETS
     ============================================================ */

  const pat = unpackLane;   // "x..." notation → boolean array of 16

  const PRESETS = {
    "Four to the Floor": {
      BD: "x...x...x...x...", CH: "..x...x...x...x.", OH: "....x.......x...",
      CP: "....x.......x...", MA: "x.x.x.x.x.x.x.x.", accent: "x...x...x...x..."
    },
    "Boom Bap": {
      BD: "x......x..x.....", SD: "....x.......x...", CH: "x.x.x.x.x.x.x.x.",
      OH: "..........x.....", RS: ".............x..", accent: "....x.......x..."
    },
    "Trap": {
      BD: "x.....x...x.....", SD: "....x.......x...", CH: "xxxxxxxxxxxxxxxx",
      OH: ".......x........", CY: "x...............", accent: "x...x...x...x..."
    },
    "Electro": {
      BD: "x..x..x...x.x...", SD: "....x.......x...", CH: "x.x.x.x.x.x.x.x.",
      CP: "....x.......x...", CB: "..x...x...x...x.", accent: "x...x...x...x..."
    },
    "Breakbeat": {
      BD: "x.....x.....x...", SD: "....x.......x.x.", CH: "x.xxx.xxx.xxx.xx",
      OH: "..........x.....", accent: "....x.......x..."
    },
    "Acid Groove": {
      BD: "x...x...x...x...", CH: "..x...x...x...x.", OH: "......x.......x.",
      RS: "..x..x..x..x..x.", CB: "............x...", accent: "x.......x......."
    },
    "Tom Roll": {
      BD: "x...............", LT: "....x.......x...", MT: "......x.......x.",
      HT: ".......x.......x", CY: "x...............", accent: "x..............."
    },
    "Cascara": {
      BD: "x.......x.......", RS: "x..x..x...x.x...", CB: "..x...x...x...x.",
      MA: "x.x.x.x.x.x.x.x.", accent: "x.......x......."
    }
  };

  function applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    snapshot("preset " + name);
    const b = emptyBank();
    Object.keys(p).forEach(function (k) {
      if (k === "accent") b.accent = pat(p[k]);
      else if (b.steps[k]) b.steps[k] = pat(p[k]);
    });
    state.banks[state.bank] = b;
    refreshGrid();
    save();
    toast("Loaded “" + name + "”");
  }

  function randomize() {
    snapshot("randomise");
    const b = emptyBank();
    const density = 0.25 + Math.random() * 0.3;
    b.steps.BD[0] = true;
    for (let i = 0; i < 16; i++) {
      if (i % 4 === 0 && Math.random() < 0.55) b.steps.BD[i] = true;
      else if (Math.random() < density * 0.35) b.steps.BD[i] = true;
      if (i % 8 === 4) b.steps.SD[i] = true;
      else if (Math.random() < density * 0.15) b.steps.SD[i] = true;
      if (Math.random() < 0.55) b.steps.CH[i] = true;
      if (i % 4 === 2 && Math.random() < 0.3) b.steps.OH[i] = true;
      if (Math.random() < density * 0.2) b.steps[Math.random() < 0.5 ? "RS" : "CB"][i] = true;
      if (Math.random() < density * 0.25) b.steps.MA[i] = true;
      if (i % 4 === 0) b.accent[i] = Math.random() < 0.7;
    }
    state.banks[state.bank] = b;
    refreshGrid();
    save();
    toast("Randomised bank " + BANKS[state.bank]);
  }

  function clearBank() {
    snapshot("clear");
    state.banks[state.bank] = emptyBank();
    refreshGrid();
    save();
    toast("Cleared bank " + BANKS[state.bank]);
  }

  /* ============================================================
     11. PERSISTENCE / SHARE / EXPORT
     ============================================================ */

  const STORE_KEY = "jc808.v2";

  function serialise() {
    return {
      bpm: state.bpm, swing: state.swing, volume: state.volume, drive: state.drive,
      accentAmt: state.accentAmt, bank: state.bank, chain: state.chain,
      banks: state.banks.map(packBank), voices: state.voices, mutes: state.mutes,
      solos: state.solos,
      lane: state.lane,
      lanes: state.lanes.map(function (l) { return { synth: l.synth, track: serialiseTrack(l.track) }; }),
      fx: state.fx,
      drumFx: state.drumFx
    };
  }


  function loadPatch(dst, src) {
    if (!src) return;
    PATCH_KEYS.forEach(function (k) { if (src[k] != null) dst[k] = src[k]; });
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(serialise())); } catch (e) {}
    }, 300);
  }

  function hydrate(data) {
    if (!data) return false;
    try {
      ["bpm", "swing", "volume", "drive", "accentAmt", "bank", "chain"].forEach(function (k) {
        if (data[k] != null) state[k] = data[k];
      });
      if (Array.isArray(data.banks) && data.banks.length === 4) {
        state.banks = data.banks.map(function (b) { return normaliseBank(b, VOICE_IDS); });
      }
      if (data.voices) VOICE_IDS.forEach(function (id) {
        if (data.voices[id]) Object.assign(state.voices[id], data.voices[id]);
      });
      if (data.mutes) Object.assign(state.mutes, data.mutes);
      if (data.solos) Object.assign(state.solos, data.solos);
      if (Array.isArray(data.lanes)) {
        data.lanes.slice(0, LANES.length).forEach(function (ld, i) {
          if (!ld) return;
          loadPatch(state.lanes[i].synth, ld.synth);
          if (ld.track) state.lanes[i].track = normaliseTrack(ld.track);
        });
      } else if (data.synth) {
        // saves from before the lanes existed: the one patch becomes the lead
        loadPatch(state.lanes[1].synth, data.synth);
        if (data.synth.delay != null) state.fx.delay = data.synth.delay;
        if (data.synth.reverb != null) state.fx.reverb = data.synth.reverb;
      }
      if (data.fx) {
        if (data.fx.delay != null) state.fx.delay = clamp(+data.fx.delay || 0, 0, 0.8);
        if (data.fx.reverb != null) state.fx.reverb = clamp(+data.fx.reverb || 0, 0, 0.8);
      }
      if (data.drumFx) {
        if (data.drumFx.echo != null) state.drumFx.echo = clamp(+data.drumFx.echo || 0, 0, 1);
        if (data.drumFx.reverb != null) state.drumFx.reverb = clamp(+data.drumFx.reverb || 0, 0, 1);
      }
      if (data.lane === 0 || data.lane === 1) state.lane = data.lane;
      return true;
    } catch (e) { return false; }
  }

  function encodeState() {
    const json = JSON.stringify(serialise());
    return btoa(unescape(encodeURIComponent(json)));
  }
  function decodeState(s) {
    return JSON.parse(decodeURIComponent(escape(atob(s))));
  }

  function shareLink() {
    const url = location.origin + location.pathname + "#jc808=" + encodeState();
    const done = function () { toast("Share link copied to clipboard"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { prompt("Copy this link:", url); });
    } else {
      prompt("Copy this link:", url);
    }
    history.replaceState(null, "", "#jc808=" + encodeState());
  }

  /* ---------- offline render → WAV ---------- */

  function encodeWav(buffer) {
    const chans = buffer.numberOfChannels;
    const len = buffer.length;
    const rate = buffer.sampleRate;
    const data = new ArrayBuffer(44 + len * chans * 2);
    const view = new DataView(data);
    const wstr = function (o, s) { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    wstr(0, "RIFF");
    view.setUint32(4, 36 + len * chans * 2, true);
    wstr(8, "WAVE");
    wstr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, chans, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * chans * 2, true);
    view.setUint16(32, chans * 2, true);
    view.setUint16(34, 16, true);
    wstr(36, "data");
    view.setUint32(40, len * chans * 2, true);
    let off = 44;
    const chData = [];
    for (let c = 0; c < chans; c++) chData.push(buffer.getChannelData(c));
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < chans; c++) {
        const s = clamp(chData[c][i], -1, 1);
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
      }
    }
    return new Blob([data], { type: "audio/wav" });
  }

  function exportWav() {
    toast("Rendering…");
    renderOffline().then(function (buf) {
      const blob = encodeWav(buf);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "jc808-" + state.bpm + "bpm-" + BANKS[state.bank] + ".wav";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      toast("Exported " + a.download);
    }).catch(function () { toast("Render failed"); });
  }

  function renderToTape() {
    toast("Recording to tape…");
    renderOffline().then(function (buf) {
      const name = "JC-808 · " + state.bpm + " bpm · bank " + BANKS[state.bank];
      studio.library.addAudio({ name: name, buffer: buf, source: "JC-808", meta: { bpm: state.bpm } });
      toast("Saved “" + name + "” to the tape library");
    }).catch(function () { toast("Render failed"); });
  }

  function renderOffline() {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) return Promise.reject(new Error("Offline rendering unsupported"));
    const sd = 60 / state.bpm / 4;
    const banksToRender = state.chain ? [0, 1, 2, 3] : [state.bank];
    let passSteps = 0;
    banksToRender.forEach(function (b) { passSteps += state.banks[b].length; });
    // two passes of the drums, or the longest synth lane if that is longer,
    // rounded up so the drum loop always completes
    let laneSteps = 0;
    state.lanes.forEach(function (l) {
      const T = l.track;
      if (!T.mute && T.notes.some(function (n) { return n.s < trackSteps(T); })) laneSteps = Math.max(laneSteps, trackSteps(T));
    });
    let totalSteps = passSteps * 2;
    if (laneSteps) totalSteps = Math.ceil(Math.max(totalSteps, laneSteps) / passSteps) * passSteps;
    const dur = totalSteps * sd + 2.2;

    const off = new OAC(2, Math.ceil(44100 * dur), 44100);
    const E = createEngine(off);
    E.master.gain.value = state.volume;
    E.drive.curve = driveCurve(state.drive);
    E.lanes.forEach(function (g, i) { g.gain.value = state.lanes[i].synth.level; });
    E.synthDelaySend.gain.value = state.fx.delay;
    E.synthVerbSend.gain.value = state.fx.reverb;
    E.drumEchoSend.gain.value = state.drumFx.echo;
    E.drumVerbSend.gain.value = state.drumFx.reverb;
    E.delayReturn.gain.value = 0.6;
    E.reverbReturn.gain.value = 0.6;
    E.delay.delayTime.value = clamp((60 / state.bpm) * 0.75, 0.02, 1.9);

    let t = 0.05, song = 0;
    while (song < totalSteps) {
      for (let bi = 0; bi < banksToRender.length && song < totalSteps; bi++) {
        const b = banksToRender[bi], p = state.banks[b];
        for (let s = 0; s < p.length && song < totalSteps; s++) {
          emitStep(E, b, s, s % 2 === 0 ? t : t + state.swing * 0.62 * sd);
          if (laneSteps) scheduleTrack(E, song, t, false);
          t += sd;
          song++;
        }
      }
    }

    return off.startRendering();
  }

  /* ============================================================
     12. SCOPE
     ============================================================ */

  let scopeCanvas = null, scopeCtx = null, scopeData = null, analyser = null;

  function startScope() {
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    engine.master.connect(analyser);
    scopeData = new Uint8Array(analyser.frequencyBinCount);
  }

  function drawScope() {
    if (!analyser || !scopeCanvas) return;
    const w = scopeCanvas.width, h = scopeCanvas.height;
    analyser.getByteTimeDomainData(scopeData);
    scopeCtx.clearRect(0, 0, w, h);
    scopeCtx.lineWidth = 1.5;
    scopeCtx.strokeStyle = state.playing ? "#ff5b1f" : "#5d5850";
    scopeCtx.beginPath();
    const slice = w / scopeData.length;
    for (let i = 0; i < scopeData.length; i++) {
      const v = scopeData[i] / 128 - 1;
      const y = h / 2 + v * (h / 2) * 0.92;
      i ? scopeCtx.lineTo(i * slice, y) : scopeCtx.moveTo(i * slice, y);
    }
    scopeCtx.stroke();
  }

  function sizeScope() {
    if (!scopeCanvas) return;
    const r = window.devicePixelRatio || 1;
    const rect = scopeCanvas.getBoundingClientRect();
    scopeCanvas.width = Math.max(1, rect.width * r);
    scopeCanvas.height = Math.max(1, rect.height * r);
    scopeCtx = scopeCanvas.getContext("2d");
    scopeCtx.scale(1, 1);
  }

  /* ============================================================
     13. TOAST
     ============================================================ */

  function toast(msg) {
    studio.toast(msg);
  }

  /* ============================================================
     14. WIRE UP CONTROLS
     ============================================================ */

  function syncBankButtons() {
    root.querySelectorAll(".bank").forEach(function (b, i) {
      b.classList.toggle("active", i === state.bank);
    });
  }

  let tapTimes = [];

  function buildControls() {
    // transport
    $("#jc-playBtn").addEventListener("click", togglePlay);

    const tempoKnob = Knob({
      label: "Tempo", min: 40, max: 220, value: state.bpm, step: 1,
      format: function () { return ""; },   // the big readout already shows BPM
      onChange: function (v) {
        state.bpm = Math.round(v);
        $("#jc-bpmReadout").textContent = state.bpm;
        applyMaster();
        save();
      }
    });
    $("#jc-tempoSlot").appendChild(tempoKnob);
    $("#jc-bpmReadout").textContent = state.bpm;

    $("#jc-tapBtn").addEventListener("click", function () {
      const now = performance.now();
      tapTimes = tapTimes.filter(function (t) { return now - t < 2400; });
      tapTimes.push(now);
      if (tapTimes.length >= 3) {
        let sum = 0;
        for (let i = 1; i < tapTimes.length; i++) sum += tapTimes[i] - tapTimes[i - 1];
        const bpm = clamp(Math.round(60000 / (sum / (tapTimes.length - 1))), 40, 220);
        state.bpm = bpm;
        $("#jc-bpmReadout").textContent = bpm;
        tempoKnob.setValue(bpm);
        applyMaster();
        save();
      }
    });

    $("#jc-swingSlot").appendChild(Knob({
      label: "Swing", min: 0, max: 0.75, value: state.swing, step: 0.01, format: pct,
      onChange: function (v) { state.swing = v; save(); }
    }));
    $("#jc-volSlot").appendChild(Knob({
      label: "Volume", min: 0, max: 1, value: state.volume, step: 0.01, format: pct,
      onChange: function (v) { state.volume = v; applyMaster(); save(); }
    }));
    $("#jc-driveSlot").appendChild(Knob({
      label: "Drive", min: 0, max: 1, value: state.drive, step: 0.01, format: pct,
      onChange: function (v) { state.drive = v; applyMaster(); save(); }
    }));
    $("#jc-accentSlot").appendChild(Knob({
      label: "Accent", min: 0, max: 1, value: state.accentAmt, step: 0.01, format: pct,
      onChange: function (v) { state.accentAmt = v; save(); }
    }));

    // what a click on the grid paints, and how much echo / reverb a painted step gets
    const editSeg = $("#jc-editSeg");
    [["hit", "Hit"], ["echo", "Echo"], ["verb", "Reverb"]].forEach(function (m) {
      const b = el("button", null, m[1]);
      b.type = "button";
      b.dataset.v = m[0];
      b.title = m[0] === "hit" ? "Click a step to add or remove a hit"
        : m[0] === "echo" ? "Click a step to send that hit to the echo (or shift-click in any mode)"
        : "Click a step to send that hit to the reverb (or alt-click in any mode)";
      b.addEventListener("click", function () { setEditMode(m[0]); });
      editSeg.appendChild(b);
    });
    setEditMode(state.editMode);
    $("#jc-echoSlot").appendChild(Knob({
      label: "Echo", min: 0, max: 1, value: state.drumFx.echo, step: 0.01, format: pct,
      onChange: function (v) { state.drumFx.echo = v; applyMaster(); save(); }
    }));
    $("#jc-verbSlot").appendChild(Knob({
      label: "Reverb", min: 0, max: 1, value: state.drumFx.reverb, step: 0.01, format: pct,
      onChange: function (v) { state.drumFx.reverb = v; applyMaster(); save(); }
    }));

    // banks
    const banks = $("#jc-banks");
    BANKS.forEach(function (name, i) {
      const b = el("button", "bank", name);
      b.type = "button";
      b.title = "Bank " + name + " — shift-click to copy the current bank here";
      b.addEventListener("click", function (e) {
        if (e.shiftKey) {
          snapshot("copy to " + name);
          state.banks[i] = JSON.parse(JSON.stringify(curBank()));
          toast("Copied bank " + BANKS[state.bank] + " → " + name);
        }
        state.bank = i;
        if (!state.playing) playBank = i;
        syncBankButtons();
        refreshGrid();
        $("#jc-lengthSel").value = String(curBank().length);
        save();
      });
      banks.appendChild(b);
    });
    syncBankButtons();

    $("#jc-chainBtn").addEventListener("click", function () {
      state.chain = !state.chain;
      this.classList.toggle("on", state.chain);
      toast(state.chain ? "Chain: A → B → C → D" : "Chain off");
      save();
    });

    // pattern tools
    const presetSel = $("#jc-presetSel");
    Object.keys(PRESETS).forEach(function (name) {
      const o = el("option", null, name);
      o.value = name;
      presetSel.appendChild(o);
    });
    presetSel.addEventListener("change", function () {
      if (this.value) applyPreset(this.value);
      this.value = "";
    });

    $("#jc-randomBtn").addEventListener("click", randomize);
    $("#jc-clearBtn").addEventListener("click", clearBank);
    $("#jc-undoBtn").addEventListener("click", undo);
    $("#jc-undoBtn").disabled = true;
    $("#jc-shareBtn").addEventListener("click", shareLink);
    $("#jc-exportBtn").addEventListener("click", exportWav);

    const lengthSel = $("#jc-lengthSel");
    for (let i = 1; i <= 16; i++) {
      const o = el("option", null, String(i));
      o.value = String(i);
      lengthSel.appendChild(o);
    }
    lengthSel.value = String(curBank().length);
    lengthSel.addEventListener("change", function () {
      curBank().length = parseInt(this.value, 10);
      refreshGrid();
      save();
    });

    // ---- synth controls: always the selected lane's patch ----
    const S = function () { return state.synth; };

    const laneSeg = $("#jc-laneSeg");
    LANES.forEach(function (l, i) {
      const b = el("button", null, l.name);
      b.type = "button";
      b.dataset.v = String(i);
      b.addEventListener("click", function () { selectLane(i); });
      laneSeg.appendChild(b);
    });

    const waveSeg = $("#jc-waveSeg");
    [["sawtooth", "Saw"], ["square", "Sqr"], ["triangle", "Tri"], ["sine", "Sin"]].forEach(function (w) {
      const b = el("button", null, w[1]);
      b.type = "button";
      b.dataset.v = w[0];
      b.addEventListener("click", function () { S().wave = w[0]; markSeg(waveSeg, w[0]); save(); });
      waveSeg.appendChild(b);
    });

    function synthKnob(slot, key, opts) {
      const k = Knob(Object.assign({
        value: S()[key],
        reset: function () { return LANES[state.lane].def[key]; },
        onChange: function (v) {
          S()[key] = opts.round ? Math.round(v) : v;
          if (opts.after) opts.after();
          save();
        }
      }, opts));
      synthKnobs[key] = k;
      $(slot).appendChild(k);
    }

    synthKnob("#jc-oscSlots", "detune", { label: "Detune", min: 0, max: 40, step: 0.5, format: function (v) { return v.toFixed(1) + "¢"; } });
    synthKnob("#jc-oscSlots", "sub", { label: "Sub", min: 0, max: 1, step: 0.01, format: pct });

    synthKnob("#jc-filterSlots", "cutoff", { label: "Cutoff", min: 0, max: 1, step: 0.01, format: pct });
    synthKnob("#jc-filterSlots", "reso", { label: "Reso", min: 0.5, max: 18, step: 0.1, format: function (v) { return v.toFixed(1); } });
    synthKnob("#jc-filterSlots", "envAmt", { label: "Env", min: 0, max: 1, step: 0.01, format: pct });

    [["attack", "Attack", 0.001, 1.5], ["decay", "Decay", 0.01, 2], ["sustain", "Sustain", 0, 1], ["release", "Release", 0.02, 3]]
      .forEach(function (d) {
        synthKnob("#jc-envSlots", d[0], {
          label: d[1], min: d[2], max: d[3], step: 0.005,
          format: function (v) { return d[0] === "sustain" ? pct(v) : v.toFixed(2) + "s"; }
        });
      });

    synthKnob("#jc-mixSlots", "level", {
      label: "Level", min: 0, max: 1, step: 0.01, format: pct,
      after: function () { applyMaster(); if (laneUI[state.lane]) laneUI[state.lane].vol.setValue(state.synth.level); }
    });
    $("#jc-mixSlots").appendChild(Knob({
      label: "Delay", min: 0, max: 0.8, value: state.fx.delay, step: 0.01, format: pct,
      onChange: function (v) { state.fx.delay = v; applyMaster(); save(); }
    }));
    $("#jc-mixSlots").appendChild(Knob({
      label: "Reverb", min: 0, max: 0.8, value: state.fx.reverb, step: 0.01, format: pct,
      onChange: function (v) { state.fx.reverb = v; applyMaster(); save(); }
    }));

    // patch presets for the selected lane; "Lane default" restores its init patch
    const patchSel = $("#jc-patchSel");
    SYNTH_PRESETS.forEach(function (p, i) {
      const o = el("option", null, p.name);
      o.value = String(i);
      patchSel.appendChild(o);
    });
    const dflt = el("option", null, "Lane default");
    dflt.value = "default";
    patchSel.appendChild(dflt);
    patchSel.addEventListener("change", function () {
      if (!this.value) return;
      const lane = LANES[state.lane];
      let patch, name;
      if (this.value === "default") { patch = lane.def; name = lane.name + " default"; }
      else { patch = SYNTH_PRESETS[+this.value].patch; name = SYNTH_PRESETS[+this.value].name; }
      this.value = "";
      allNotesOff(true);
      loadPatch(S(), patch);
      arpIndex = 0;
      refreshSynthUI();
      applyMaster();
      save();
      toast("Loaded “" + name + "” on the " + lane.name + " lane");
    });

    $("#jc-monoBtn").addEventListener("click", function () {
      S().mono = !S().mono;
      allNotesOff();
      refreshSynthUI();
      save();
    });

    // arp
    $("#jc-arpBtn").addEventListener("click", function () {
      S().arp = !S().arp;
      allNotesOff();
      arpIndex = 0;
      refreshSynthUI();
      toast(S().arp ? "Arpeggiator on — hold keys while the sequencer runs" : "Arpeggiator off");
      save();
    });

    $("#jc-latchBtn").addEventListener("click", function () {
      S().latch = !S().latch;
      if (!S().latch) allNotesOff(true);
      refreshSynthUI();
      save();
    });

    const modeSeg = $("#jc-arpModeSeg");
    ["up", "down", "updown", "random"].forEach(function (m) {
      const b = el("button", null, m);
      b.type = "button";
      b.dataset.v = m;
      b.addEventListener("click", function () { S().arpMode = m; arpIndex = 0; markSeg(modeSeg, m); save(); });
      modeSeg.appendChild(b);
    });

    const rateSel = $("#jc-arpRate");
    ["1/4", "1/8", "1/8T", "1/16", "1/16T", "1/32"].forEach(function (r) {
      const o = el("option", null, r);
      o.value = r;
      rateSel.appendChild(o);
    });
    rateSel.addEventListener("change", function () { S().arpRate = this.value; save(); });

    synthKnob("#jc-arpSlots", "arpOct", { label: "Octaves", min: 1, max: 4, step: 1, round: true, format: function (v) { return String(Math.round(v)); } });
    synthKnob("#jc-arpSlots", "arpGate", { label: "Gate", min: 0, max: 1, step: 0.01, format: pct });

    $("#jc-octDown").addEventListener("click", function () { setOctave(state.synth.octave - 1); });
    $("#jc-octUp").addEventListener("click", function () { setOctave(state.synth.octave + 1); });

    $("#jc-panicBtn").addEventListener("click", function () {
      allNotesOff(true);
      toast("All notes off");
    });

    $("#jc-recBtn").addEventListener("click", toggleRecording);
    refreshSynthUI();
  }

  const synthKnobs = {};   // patch key -> knob, so a lane switch can repaint them

  function markSeg(seg, value) {
    seg.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b.dataset.v === String(value)); });
  }

  // paint every synth control from the selected lane's patch
  function refreshSynthUI() {
    const S = state.synth;
    Object.keys(synthKnobs).forEach(function (k) { synthKnobs[k].setValue(S[k]); });
    markSeg($("#jc-waveSeg"), S.wave);
    markSeg($("#jc-arpModeSeg"), S.arpMode);
    markSeg($("#jc-laneSeg"), state.lane);
    $("#jc-arpRate").value = S.arpRate;
    const mono = $("#jc-monoBtn");
    mono.textContent = S.mono ? "Mono" : "Poly";
    mono.classList.toggle("on", S.mono);
    $("#jc-arpBtn").classList.toggle("on", S.arp);
    $("#jc-latchBtn").classList.toggle("on", S.latch);
    $("#jc-octReadout").textContent = (S.octave >= 0 ? "+" : "") + S.octave;
    $("#jc-synthLane").textContent = LANES[state.lane].name;
    $("#jc-synthLane").style.color = LANES[state.lane].color;
  }

  /* ============================================================
     15. BOOT
     ============================================================ */

  function boot() {
    // state from URL hash wins over localStorage
    let loaded = false;
    const hashState = location.hash.indexOf("#jc808=") === 0 ? location.hash.slice(7) : location.hash.indexOf("#p=") === 0 ? location.hash.slice(3) : null;
    if (hashState) {
      try { loaded = hydrate(decodeState(hashState)); } catch (e) {}
      if (loaded) setTimeout(function () { toast("Loaded shared pattern"); }, 400);
    }
    if (!loaded) {
      try { loaded = hydrate(JSON.parse(localStorage.getItem(STORE_KEY))); } catch (e) {}
    }
    if (!loaded) {
      // first visit: something to hear immediately
      const p = PRESETS["Four to the Floor"];
      const b = emptyBank();
      Object.keys(p).forEach(function (k) {
        if (k === "accent") b.accent = pat(p[k]);
        else if (b.steps[k]) b.steps[k] = pat(p[k]);
      });
      state.banks[0] = b;
    }

    buildGrid();
    buildKeyboard();
    buildLanes();
    buildControls();

    scopeCanvas = $("#jc-scope");
    sizeScope();
    window.addEventListener("resize", sizeScope);
    requestAnimationFrame(drawLoop);

    root.querySelector('[data-jump="help"]').addEventListener("click", function (e) {
      e.preventDefault();
      $("#jc-help").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("#jc-tapeBtn").addEventListener("click", renderToTape);

    return {
      open: function () { sizeScope(); rollsNeedSize = true; rollDirty = true; ensureAudio(); },
      close: function () { downKeys.clear(); if (!state.synth.latch) allNotesOff(); },
      togglePlay: togglePlay,
      get playing() { return state.playing; }
    };
  }

  return boot();
}
