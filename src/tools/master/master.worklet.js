// Real-time mastering preview: the exact chain the export uses, plus a
// latency-matched dry path for A/B (with optional loudness matching) and the
// meters the panel and the 3D VU unit show.
import { PreChain, PostChain, neutralParams } from "../../dsp/master/chain.js";
import { LoudnessMeter } from "../../dsp/master/loudness.js";

const db = (v) => (v > 1e-9 ? 20 * Math.log10(v) : -120);

class MasterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    const sr = sampleRate;
    const p = neutralParams();
    this.pre = new PreChain(sr, p);
    this.post = new PostChain(sr, p);
    this.latency = this.pre.latency + this.post.latency;
    const D = this.latency + 1;
    this.dryL = new Float32Array(D);
    this.dryR = new Float32Array(D);
    this.dpos = 0;
    this.wl = new Float64Array(128);
    this.wr = new Float64Array(128);
    this.dl = new Float64Array(128);
    this.dr = new Float64Array(128);
    this.ab = 1;
    this.abTarget = 1;
    this.abStep = 1 / (0.03 * sr);
    this.dryGain = 1;
    this.mWet = new LoudnessMeter(sr, { history: false });
    this.mDry = new LoudnessMeter(sr, { history: false });
    this.vuA = Math.exp(-1 / (0.3 * sr)); // VU ballistics, ~300 ms
    this.vuL = 0;
    this.vuR = 0;
    this.pkL = 0;
    this.pkR = 0;
    this.sLL = 0; this.sRR = 0; this.sLR = 0;
    this.count = 0;
    this.every = Math.round(sr / 25);
    this.active = false;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(m) {
    if (m.type === "params") {
      this.pre.setParams(m.params);
      this.post.setParams(m.params);
    } else if (m.type === "drive") {
      this.post.setDrive(m.driveDb);
      if (m.ceilingDb != null) this.post.limiter.set({ ceilingDb: m.ceilingDb });
    } else if (m.type === "ab") {
      this.abTarget = m.value ? 1 : 0;
    } else if (m.type === "dryGain") {
      this.dryGain = m.value;
    } else if (m.type === "reset") {
      this.pre.reset();
      this.post.reset();
      this.dryL.fill(0);
      this.dryR.fill(0);
      this.mWet.reset();
      this.mDry.reset();
    }
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const oL = out[0], oR = out[1] || out[0];
    const n = oL.length;
    const inp = inputs[0];
    const iL = inp && inp.length ? inp[0] : null;
    const iR = inp && inp.length > 1 ? inp[1] : iL;
    const wl = this.wl, wr = this.wr, dl = this.dl, dr = this.dr;
    const D = this.dryL.length;
    let p = this.dpos;
    let any = false;
    for (let i = 0; i < n; i++) {
      const l = iL ? iL[i] : 0, r = iR ? iR[i] : 0;
      if (l !== 0 || r !== 0) any = true;
      wl[i] = l;
      wr[i] = r;
      // dry path delayed by the chain's latency so A/B stays sample-aligned
      dl[i] = this.dryL[p];
      dr[i] = this.dryR[p];
      this.dryL[p] = l;
      this.dryR[p] = r;
      p = p + 1 === D ? 0 : p + 1;
    }
    this.dpos = p;
    this.pre.process(wl, wr, n, 0);
    this.post.process(wl, wr, n, 0);
    const g = this.dryGain;
    let ab = this.ab;
    const t = this.abTarget, step = this.abStep;
    for (let i = 0; i < n; i++) {
      if (ab < t) ab = Math.min(t, ab + step);
      else if (ab > t) ab = Math.max(t, ab - step);
      const yl = wl[i] * ab + dl[i] * g * (1 - ab);
      const yr = wr[i] * ab + dr[i] * g * (1 - ab);
      oL[i] = yl;
      if (oR !== oL) oR[i] = yr;
      const al = yl < 0 ? -yl : yl, ar = yr < 0 ? -yr : yr;
      if (al > this.pkL) this.pkL = al;
      if (ar > this.pkR) this.pkR = ar;
      this.vuL = this.vuA * this.vuL + (1 - this.vuA) * yl * yl;
      this.vuR = this.vuA * this.vuR + (1 - this.vuA) * yr * yr;
      this.sLL += yl * yl; this.sRR += yr * yr; this.sLR += yl * yr;
    }
    this.ab = ab;
    this.mWet.push(wl, wr, n);
    this.mDry.push(dl, dr, n);
    if (any) this.active = true;
    this.count += n;
    if (this.count >= this.every) {
      this.count = 0;
      const red = this.pre.reductions();
      const corr = this.sLR / Math.max(Math.sqrt(this.sLL * this.sRR), 1e-12);
      this.port.postMessage({
        type: "meter",
        wetM: this.mWet.momentary, wetS: this.mWet.shortTerm,
        dryM: this.mDry.momentary + db(g), dryS: this.mDry.shortTerm + db(g),
        peakL: db(this.pkL), peakR: db(this.pkR),
        vuL: db(Math.sqrt(this.vuL)), vuR: db(Math.sqrt(this.vuR)),
        gr: this.post.limiter.takeReduction(), bands: red.bands, glue: red.glue,
        corr: this.sLL + this.sRR > 1e-9 ? corr : 1, ab
      });
      this.pkL = this.pkR = 0;
      this.sLL = this.sRR = this.sLR = 0;
    }
    return true;
  }
}

registerProcessor("room808-master", MasterProcessor);
