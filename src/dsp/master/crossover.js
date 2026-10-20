// Four-band Linkwitz-Riley (24 dB/oct) crossover with all-pass phase
// compensation, so the bands sum back to a flat (all-pass) response.
//
//   x ─ LR4@f1 ─ low ──────────────── AP@f2 ─ AP@f3 ─► band 0
//            └ high ─ LR4@f2 ─ low ─────────── AP@f3 ─► band 1
//                           └ high ─ LR4@f3 ─ low ───► band 2
//                                          └ high ───► band 3

import { design, Biquad } from "./biquad.js";

const Q = Math.SQRT1_2;

export class Crossover4 {
  constructor(sr, freqs = [120, 900, 5500]) {
    this.sr = sr;
    this.out = new Float64Array(4);
    this.lp = [0, 1, 2].map(() => [new Biquad(), new Biquad()]);
    this.hp = [0, 1, 2].map(() => [new Biquad(), new Biquad()]);
    this.ap0 = [new Biquad(), new Biquad()]; // band 0: AP@f2, AP@f3
    this.ap1 = new Biquad(); // band 1: AP@f3
    this.setFreqs(freqs);
  }

  setFreqs(freqs) {
    this.freqs = freqs.slice();
    const sr = this.sr;
    freqs.forEach((f, i) => {
      const lp = design("lowpass", f, sr, { q: Q }), hp = design("highpass", f, sr, { q: Q });
      this.lp[i][0].set(lp); this.lp[i][1].set(lp);
      this.hp[i][0].set(hp); this.hp[i][1].set(hp);
    });
    this.ap0[0].set(design("allpass", freqs[1], sr, { q: Q }));
    this.ap0[1].set(design("allpass", freqs[2], sr, { q: Q }));
    this.ap1.set(design("allpass", freqs[2], sr, { q: Q }));
  }

  reset() {
    for (const p of [...this.lp, ...this.hp]) for (const b of p) b.reset();
    this.ap0[0].reset(); this.ap0[1].reset(); this.ap1.reset();
  }

  /** Split one sample; returns the shared Float64Array(4) of band samples. */
  split(x) {
    const lp = this.lp, hp = this.hp, o = this.out;
    const low1 = lp[0][1].tick(lp[0][0].tick(x));
    const high1 = hp[0][1].tick(hp[0][0].tick(x));
    o[0] = this.ap0[1].tick(this.ap0[0].tick(low1));
    const low2 = lp[1][1].tick(lp[1][0].tick(high1));
    const high2 = hp[1][1].tick(hp[1][0].tick(high1));
    o[1] = this.ap1.tick(low2);
    o[2] = lp[2][1].tick(lp[2][0].tick(high2));
    o[3] = hp[2][1].tick(hp[2][0].tick(high2));
    return o;
  }
}
