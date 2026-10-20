// Guitar tuner: microphone → YIN pitch → nearest string of the chosen tuning.
// "½ step down" shifts any tuning a semitone (E♭ A♭ D♭ G♭ B♭ E♭ for guitar).
import "./tuner.css";
import { el, button, seg, select, field, screen, clamp } from "../../ui/kit.js";
import { yin, rms, freqToMidi, midiToFreq, noteLabel } from "../../dsp/pitch.js";

const TUNINGS = {
  standard: { name: "Guitar · Standard", strings: [40, 45, 50, 55, 59, 64] },
  dropD: { name: "Guitar · Drop D", strings: [38, 45, 50, 55, 59, 64] },
  dadgad: { name: "Guitar · DADGAD", strings: [38, 45, 50, 55, 57, 62] },
  openG: { name: "Guitar · Open G", strings: [38, 43, 50, 55, 59, 62] },
  openD: { name: "Guitar · Open D", strings: [38, 45, 50, 54, 57, 62] },
  bass4: { name: "Bass · 4-string", strings: [28, 33, 38, 43], fmin: 30 },
  bass5: { name: "Bass · 5-string", strings: [23, 28, 33, 38, 43], fmin: 26 },
  ukulele: { name: "Ukulele · GCEA", strings: [67, 60, 64, 69] },
  chromatic: { name: "Chromatic · any note", strings: [] }
};

const SHIFTS = [
  [0, "Standard pitch"],
  [-1, "½ step down (E♭)"],
  [-2, "1 step down (D)"]
];

const STORE = "room808.tuner";

export function create(studio, host) {
  const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } })();
  const st = {
    tuning: TUNINGS[saved.tuning] ? saved.tuning : "standard",
    shift: [0, -1, -2].includes(saved.shift) ? saved.shift : 0,
    a4: clamp(saved.a4 || 440, 425, 455),
    mode: "auto",
    manual: -1,
    refTone: saved.refTone !== false,
    listening: false
  };
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify({ tuning: st.tuning, shift: st.shift, a4: st.a4, refTone: st.refTone })); } catch (e) { /* private mode */ } };

  // live readout shared with the clip-on tuner in the room
  const live = { listening: false, note: "E", cents: null, hz: 0 };
  studio.state.tuner = live;

  const root = el("div", "kit tuner");
  host.appendChild(root);

  /* ---------- controls ---------- */
  const top = el("div", "k-row end tuner-top");
  const tuningSel = select(Object.entries(TUNINGS).map(([k, v]) => [k, v.name]), st.tuning, (v) => {
    st.tuning = v;
    st.manual = -1;
    tuned.clear();
    save();
    buildStrings();
  });
  top.appendChild(field("Tuning", tuningSel));
  const shiftSeg = seg(SHIFTS, st.shift, (v) => {
    st.shift = v;
    tuned.clear();
    save();
    buildStrings();
  }, { label: "Pitch shift" });
  top.appendChild(field("Pitch", shiftSeg));
  const a4Wrap = el("div", "a4");
  const a4Out = el("output", "k-readout");
  const renderA4 = () => { a4Out.innerHTML = `<b>${st.a4}</b><span>A4 Hz</span>`; };
  a4Wrap.append(button("−", () => { st.a4 = clamp(st.a4 - 1, 425, 455); renderA4(); save(); buildStrings(); }, { cls: "icon", title: "Lower reference" }), a4Out, button("+", () => { st.a4 = clamp(st.a4 + 1, 425, 455); renderA4(); save(); buildStrings(); }, { cls: "icon", title: "Raise reference" }));
  renderA4();
  top.appendChild(field("Reference", a4Wrap));
  root.appendChild(top);

  /* ---------- display ---------- */
  let needle = 0, strobePhase = 0, lastDraw = performance.now();
  const view = { note: "—", octave: "", hz: 0, target: 0, cents: null, string: -1, inTune: false, flats: false, level: 0 };
  const disp = screen(250, drawDisplay, { cls: "tuner-screen" });
  root.appendChild(disp.canvas);

  /* ---------- strings ---------- */
  const strings = el("div", "tuner-strings");
  const tuned = new Set();
  const stringBtns = [];
  function targets() {
    return TUNINGS[st.tuning].strings.map((m) => m + st.shift);
  }
  function buildStrings() {
    strings.innerHTML = "";
    stringBtns.length = 0;
    const t = targets();
    if (!t.length) {
      strings.appendChild(el("p", "k-note", "Chromatic mode: shows the nearest note to whatever you play."));
      return;
    }
    t.forEach((m, i) => {
      const lab = noteLabel(m, st.shift < 0);
      const b = el("button", "string");
      b.type = "button";
      b.innerHTML = `<span class="num">${t.length - i}</span><b>${lab.name}</b><small>${lab.octave}</small><i class="ok">✓</i>`;
      b.title = `${lab.name}${lab.octave} · ${midiToFreq(m, st.a4).toFixed(2)} Hz — click to lock this string${st.refTone ? " and hear it" : ""}`;
      b.addEventListener("click", () => {
        if (st.mode === "manual" && st.manual === i) {
          st.mode = "auto";
          st.manual = -1;
        } else {
          st.mode = "manual";
          st.manual = i;
          if (st.refTone) pluck(midiToFreq(m, st.a4));
        }
        modeSeg.set(st.mode);
        paintStrings();
      });
      strings.appendChild(b);
      stringBtns.push(b);
    });
    paintStrings();
  }
  function paintStrings() {
    stringBtns.forEach((b, i) => {
      b.classList.toggle("active", view.string === i);
      b.classList.toggle("locked", st.mode === "manual" && st.manual === i);
      b.classList.toggle("tuned", tuned.has(i));
    });
  }
  const stringRow = el("div", "k-row tuner-string-row");
  const modeSeg = seg([["auto", "Auto"], ["manual", "Manual"]], st.mode, (v) => {
    st.mode = v;
    if (v === "auto") st.manual = -1;
    else if (st.manual < 0) st.manual = 0;
    paintStrings();
  }, { label: "String detection" });
  const refBtn = button("Ref tone", (on) => { st.refTone = on; save(); }, { toggle: true, on: st.refTone, title: "Play the target note when you click a string" });
  stringRow.append(strings, el("div", "grow"), field("String", modeSeg), refBtn);
  root.appendChild(stringRow);

  /* ---------- mic ---------- */
  const micRow = el("div", "k-row");
  const micBtn = button("● Start listening", () => (st.listening ? stopMic() : startMic()), { cls: "primary big" });
  const meter = el("div", "tuner-meter");
  const meterFill = el("span");
  meter.appendChild(meterFill);
  const status = el("p", "k-note", "Uses your microphone — nothing is recorded or sent anywhere.");
  micRow.append(micBtn, meter, status);
  root.appendChild(micRow);
  root.appendChild(el("p", "k-note tuner-tip", "Tuning down for heavier songs? Choose ½ step down — strings become E♭ A♭ D♭ G♭ B♭ E♭ (low to high). Play one string at a time and let it ring."));

  /* ---------- audio ---------- */
  let stream = null, src = null, analyser = null, buf = null, scratch = null, raf = 0;
  const history = [];
  let inTuneSince = 0;

  async function startMic() {
    try {
      await studio.audio.start();
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const ctx = studio.audio.ctx;
      src = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      src.connect(analyser); // analysis only — never routed to the speakers
      buf = new Float32Array(analyser.fftSize);
      scratch = new Float32Array(analyser.fftSize);
      st.listening = live.listening = true;
      micBtn.textContent = "■ Stop listening";
      micBtn.classList.remove("primary");
      status.textContent = "Listening… pluck a string.";
      loop();
    } catch (err) {
      status.textContent = `Microphone unavailable: ${err.message}. Allow mic access for this page and try again.`;
      studio.toast("The tuner needs microphone access", { error: true });
    }
  }

  function stopMic() {
    cancelAnimationFrame(raf);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (src) src.disconnect();
    stream = src = analyser = null;
    st.listening = live.listening = false;
    live.cents = null;
    micBtn.textContent = "● Start listening";
    micBtn.classList.add("primary");
    status.textContent = "Uses your microphone — nothing is recorded or sent anywhere.";
    view.cents = null;
    view.note = "—";
    view.level = 0;
    meterFill.style.width = "0%";
    disp.draw();
  }

  let frame = 0;
  function loop() {
    raf = requestAnimationFrame(loop);
    if (!analyser) return;
    if (frame++ % 2 === 0) analyse();
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastDraw) / 1000);
    lastDraw = now;
    const targetNeedle = view.cents == null ? 0 : clamp(view.cents, -50, 50);
    needle += (targetNeedle - needle) * Math.min(1, dt * (view.cents == null ? 3 : 12));
    strobePhase += (view.cents == null ? 0 : clamp(view.cents, -50, 50)) * dt * 0.08;
    disp.draw();
  }

  function analyse() {
    analyser.getFloatTimeDomainData(buf);
    const level = rms(buf);
    view.level = level;
    meterFill.style.width = `${Math.min(100, level * 400)}%`;
    if (level < 0.006) {
      history.length = 0;
      view.cents = null;
      live.cents = null;
      inTuneSince = 0;
      return;
    }
    const tun = TUNINGS[st.tuning];
    const sr = studio.audio.ctx.sampleRate;
    const r = yin(buf, sr, { fmin: (tun.fmin || 60) * Math.pow(2, st.shift / 12) * 0.9, fmax: 1400, threshold: 0.15, scratch });
    if (!r || r.clarity < 0.75) return;
    history.push(r.freq);
    if (history.length > 5) history.shift();
    const f = [...history].sort((a, b) => a - b)[Math.floor(history.length / 2)];
    const midi = freqToMidi(f, st.a4);
    const t = targets();
    let target, idx = -1;
    if (!t.length) target = Math.round(midi);
    else if (st.mode === "manual" && st.manual >= 0) { idx = st.manual; target = t[idx]; }
    else {
      idx = 0;
      for (let i = 1; i < t.length; i++) if (Math.abs(midi - t[i]) < Math.abs(midi - t[idx])) idx = i;
      target = t[idx];
    }
    const cents = (midi - target) * 100;
    const lab = noteLabel(target, st.shift < 0);
    view.note = lab.name;
    view.octave = lab.octave;
    view.hz = f;
    view.target = midiToFreq(target, st.a4);
    view.cents = cents;
    view.string = idx;
    view.flats = st.shift < 0;
    view.inTune = Math.abs(cents) < 3;
    live.note = lab.name;
    live.cents = cents;
    live.hz = f;
    if (view.inTune && idx >= 0) {
      if (!inTuneSince) inTuneSince = performance.now();
      if (performance.now() - inTuneSince > 450 && !tuned.has(idx)) {
        tuned.add(idx);
      }
    } else inTuneSince = 0;
    paintStrings();
  }

  /* ---------- reference tone: Karplus-Strong pluck ---------- */
  function pluck(freq) {
    studio.audio.start();
    const ctx = studio.audio.ctx;
    const out = karplusStrong(freq, ctx.sampleRate, 2.6);
    const b = ctx.createBuffer(1, out.length, ctx.sampleRate);
    b.copyToChannel(out, 0);
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.connect(studio.audio.bus("tuner"));
    s.start();
  }

  /* ---------- drawing ---------- */
  function drawDisplay(g, w, h) {
    g.clearRect(0, 0, w, h);
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#071014");
    grad.addColorStop(1, "#03080a");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const has = view.cents != null && st.listening;
    const good = has && view.inTune;
    const col = !has ? "#2a5560" : good ? "#4dffa0" : Math.abs(view.cents) < 15 ? "#ffd166" : "#ff6b5b";

    // gauge
    const cx = w / 2, cy = h * 0.95, R = Math.min(w * 0.42, h * 0.78);
    g.lineCap = "round";
    for (let c = -50; c <= 50; c += 5) {
      const a = -Math.PI / 2 + (c / 50) * 1.05;
      const major = c % 25 === 0;
      const r0 = R * (major ? 0.82 : 0.88), r1 = R * 0.95;
      g.strokeStyle = c === 0 ? "#4dffa0" : Math.abs(c) <= 5 ? "rgba(77,255,160,0.5)" : "rgba(170,210,220,0.3)";
      g.lineWidth = major ? 3 : 1.5;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      g.stroke();
    }
    g.fillStyle = "rgba(170,210,220,0.45)";
    g.font = "11px 'IBM Plex Mono', monospace";
    g.textAlign = "center";
    for (const c of [-50, -25, 25, 50]) {
      const a = -Math.PI / 2 + (c / 50) * 1.05;
      g.fillText(`${c > 0 ? "+" : ""}${c}`, cx + Math.cos(a) * R * 0.74, cy + Math.sin(a) * R * 0.74 + 4);
    }
    // needle
    const na = -Math.PI / 2 + (needle / 50) * 1.05;
    g.strokeStyle = col;
    g.shadowColor = col;
    g.shadowBlur = has ? 14 : 0;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(na) * R * 0.97, cy + Math.sin(na) * R * 0.97);
    g.stroke();
    g.shadowBlur = 0;
    g.fillStyle = "#0d1a1f";
    g.beginPath();
    g.arc(cx, cy, 10, 0, Math.PI * 2);
    g.fill();

    // note name
    g.fillStyle = col;
    g.shadowColor = col;
    g.shadowBlur = has ? 22 : 0;
    g.font = `700 ${Math.round(h * 0.3)}px 'Space Grotesk', 'Helvetica Neue', Arial`;
    g.fillText(st.listening ? view.note : "—", cx, cy - R * 0.36);
    g.shadowBlur = 0;
    if (st.listening && view.octave !== "") {
      g.font = `500 ${Math.round(h * 0.09)}px 'IBM Plex Mono', monospace`;
      g.fillText(String(view.octave), cx + h * 0.2, cy - R * 0.36);
    }

    // flat / sharp hints
    const flat = has && view.cents < -3, sharp = has && view.cents > 3;
    g.font = "600 13px 'Space Grotesk', Arial";
    g.textAlign = "left";
    g.fillStyle = flat ? "#ffd166" : "rgba(170,210,220,0.25)";
    g.fillText("♭  tune up ↑", 16, 26);
    g.textAlign = "right";
    g.fillStyle = sharp ? "#ffd166" : "rgba(170,210,220,0.25)";
    g.fillText("tune down ↓  ♯", w - 16, 26);
    g.textAlign = "center";
    g.fillStyle = good ? "#4dffa0" : "rgba(170,210,220,0.6)";
    g.font = "500 12px 'IBM Plex Mono', monospace";
    const line = !st.listening ? "press Start listening, then pluck a string" : !has ? "pluck a string…" : `${view.hz.toFixed(2)} Hz → ${view.target.toFixed(2)} Hz · ${view.cents > 0 ? "+" : ""}${view.cents.toFixed(1)} ¢${good ? " · in tune" : ""}`;
    g.fillText(line, cx, h - 30);

    // strobe band
    const sy = h - 18, sh = 10;
    g.save();
    g.beginPath();
    g.rect(16, sy, w - 32, sh);
    g.clip();
    g.fillStyle = "#0a1418";
    g.fillRect(16, sy, w - 32, sh);
    g.fillStyle = has ? col : "#1c3a42";
    const step = 18;
    const off = ((strobePhase * 100) % step + step) % step;
    for (let x = 16 - step + off; x < w; x += step) g.fillRect(x, sy, step / 2, sh);
    g.restore();
  }

  buildStrings();
  disp.draw();

  return {
    open() { disp.resize(); disp.draw(); },
    close() { if (st.listening) stopMic(); }
  };
}

/**
 * Plucked string with exact pitch: delay line N + two-point average (½ sample)
 * + first-order allpass for the remaining fractional delay (Jaffe & Smith).
 */
export function karplusStrong(freq, sr, seconds = 2.5, damp = 0.997) {
  const len = Math.floor(sr * seconds);
  const out = new Float32Array(len);
  const P = sr / freq;
  const N = Math.max(2, Math.floor(P - 0.5 - 0.1));
  const d = P - 0.5 - N;
  const C = (1 - d) / (1 + d);
  const line = new Float32Array(N);
  let lp = 0;
  for (let i = 0; i < N; i++) {
    lp = lp * 0.5 + (Math.random() * 2 - 1) * 0.5; // softened pick noise
    line[i] = lp;
  }
  let idx = 0, prev = 0, apX = 0, apY = 0;
  for (let i = 0; i < len; i++) {
    const y = line[idx];
    out[i] = y;
    const avg = damp * 0.5 * (y + prev);
    prev = y;
    const ap = C * avg + apX - C * apY;
    apX = avg;
    apY = ap;
    line[idx] = ap;
    idx = (idx + 1) % N;
  }
  for (let i = 0; i < Math.min(len, 120); i++) out[i] *= i / 120;
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = peak > 0 ? 0.4 / peak : 0;
  for (let i = 0; i < len; i++) out[i] *= g;
  return out;
}
