// Biquad filters (RBJ "Audio EQ Cookbook"), transposed direct form II, plus
// magnitude responses so EQ curves can be fitted and drawn.
// Pure JS: shared by the real-time worklet, the render worker and the tests.

/**
 * @param {"lowpass"|"highpass"|"allpass"|"bandpass"|"peaking"|"lowshelf"|"highshelf"} type
 * @returns {{b0:number,b1:number,b2:number,a1:number,a2:number}} normalised (a0 = 1)
 */
export function design(type, f0, sr, { q = Math.SQRT1_2, gainDb = 0 } = {}) {
  const w0 = (2 * Math.PI * Math.min(Math.max(f0, 1), sr * 0.49)) / sr;
  const cw = Math.cos(w0), sw = Math.sin(w0);
  const A = Math.pow(10, gainDb / 40);
  const alpha = sw / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case "lowpass":
      b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case "highpass":
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case "allpass":
      b0 = 1 - alpha; b1 = -2 * cw; b2 = 1 + alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case "bandpass": // constant 0 dB peak gain
      b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case "peaking":
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
      break;
    case "lowshelf":
    case "highshelf": {
      // Q form of the cookbook shelf: q = 1/√2 is the S = 1 (steepest monotonic) shelf
      const sA = 2 * Math.sqrt(A) * alpha;
      if (type === "lowshelf") {
        b0 = A * ((A + 1) - (A - 1) * cw + sA);
        b1 = 2 * A * ((A - 1) - (A + 1) * cw);
        b2 = A * ((A + 1) - (A - 1) * cw - sA);
        a0 = (A + 1) + (A - 1) * cw + sA;
        a1 = -2 * ((A - 1) + (A + 1) * cw);
        a2 = (A + 1) + (A - 1) * cw - sA;
      } else {
        b0 = A * ((A + 1) + (A - 1) * cw + sA);
        b1 = -2 * A * ((A - 1) + (A + 1) * cw);
        b2 = A * ((A + 1) + (A - 1) * cw - sA);
        a0 = (A + 1) - (A - 1) * cw + sA;
        a1 = 2 * ((A - 1) - (A + 1) * cw);
        a2 = (A + 1) - (A - 1) * cw - sA;
      }
      break;
    }
    default:
      throw new Error(`unknown filter type ${type}`);
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Magnitude in dB of a normalised biquad at frequency f. */
export function magDb(c, f, sr) {
  const w = (2 * Math.PI * f) / sr;
  const c1 = Math.cos(w), c2 = Math.cos(2 * w);
  const num = c.b0 * c.b0 + c.b1 * c.b1 + c.b2 * c.b2 + 2 * (c.b0 * c.b1 + c.b1 * c.b2) * c1 + 2 * c.b0 * c.b2 * c2;
  const den = 1 + c.a1 * c.a1 + c.a2 * c.a2 + 2 * (c.a1 + c.a1 * c.a2) * c1 + 2 * c.a2 * c2;
  return 10 * Math.log10(Math.max(num, 1e-30) / Math.max(den, 1e-30));
}

/** One filter section with its own state (one channel). */
export class Biquad {
  constructor(c = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }) {
    this.z1 = 0;
    this.z2 = 0;
    this.set(c);
  }

  set(c) {
    this.b0 = c.b0; this.b1 = c.b1; this.b2 = c.b2; this.a1 = c.a1; this.a2 = c.a2;
    return this;
  }

  reset() {
    this.z1 = this.z2 = 0;
  }

  tick(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

/** A cascade of sections sharing one channel. */
export class Cascade {
  constructor(coeffs = []) {
    this.sections = coeffs.map((c) => new Biquad(c));
  }

  /** Replace coefficients, keeping state where the section count is unchanged. */
  set(coeffs) {
    if (coeffs.length !== this.sections.length) this.sections = coeffs.map((c) => new Biquad(c));
    else coeffs.forEach((c, i) => this.sections[i].set(c));
    return this;
  }

  tick(x) {
    const s = this.sections;
    for (let i = 0; i < s.length; i++) x = s[i].tick(x);
    return x;
  }

  reset() {
    for (const s of this.sections) s.reset();
  }
}

/** Response (dB) of a list of coefficient sets at frequency f. */
export function cascadeDb(coeffs, f, sr) {
  let db = 0;
  for (const c of coeffs) db += magDb(c, f, sr);
  return db;
}
