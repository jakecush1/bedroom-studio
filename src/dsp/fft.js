// Real-input FFT (length n, power of two) computed with an n/2 complex FFT.
// forward() returns the n/2+1 non-negative-frequency bins, like numpy.fft.rfft.

export class RealFFT {
  constructor(n) {
    if (n & (n - 1)) throw new Error("FFT size must be a power of two");
    this.n = n;
    const h = n >> 1;
    this.h = h;
    let bits = 0;
    while (1 << bits < h) bits++;
    this.rev = new Uint32Array(h);
    for (let i = 0; i < h; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    // twiddles for the half-size complex FFT
    this.cos = new Float64Array(h >> 1 || 1);
    this.sin = new Float64Array(h >> 1 || 1);
    for (let i = 0; i < h >> 1; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / h);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / h);
    }
    // post-processing twiddles e^{-2πik/n}
    this.wr = new Float64Array(h + 1);
    this.wi = new Float64Array(h + 1);
    for (let k = 0; k <= h; k++) {
      this.wr[k] = Math.cos((2 * Math.PI * k) / n);
      this.wi[k] = -Math.sin((2 * Math.PI * k) / n);
    }
    this.re = new Float64Array(h);
    this.im = new Float64Array(h);
  }

  _complex(re, im, inverse = false) {
    const h = this.h;
    for (let size = 2; size <= h; size <<= 1) {
      const half = size >> 1;
      const step = h / size;
      for (let i = 0; i < h; i += size) {
        for (let j = 0; j < half; j++) {
          const c = this.cos[j * step], s = inverse ? -this.sin[j * step] : this.sin[j * step];
          const a = i + j, b = a + half;
          const tr = re[b] * c - im[b] * s;
          const ti = re[b] * s + im[b] * c;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }

  /** x: real signal of length n → outRe/outIm of length n/2+1 */
  forward(x, outRe, outIm) {
    const h = this.h, re = this.re, im = this.im, rev = this.rev;
    for (let k = 0; k < h; k++) {
      const r = rev[k];
      re[r] = x[2 * k] || 0;
      im[r] = x[2 * k + 1] || 0;
    }
    this._complex(re, im);
    for (let k = 0; k <= h; k++) {
      const a = k % h, b = (h - k) % h;
      const zr = re[a], zi = im[a];
      const cr = re[b], ci = -im[b];
      const er = 0.5 * (zr + cr), ei = 0.5 * (zi + ci);
      // O = -i/2 (z - conj)
      const dr = zr - cr, di = zi - ci;
      const or = 0.5 * di, oi = -0.5 * dr;
      const wr = this.wr[k], wi = this.wi[k];
      outRe[k] = er + wr * or - wi * oi;
      outIm[k] = ei + wr * oi + wi * or;
    }
  }

  /** inverse of forward(): bins (n/2+1) → real signal of length n (numpy irfft) */
  inverse(inRe, inIm, out) {
    const h = this.h, re = this.re, im = this.im, rev = this.rev, n = this.n;
    // rebuild the packed half-size spectrum Z[k] = E[k] + i·O[k]
    const tmpR = new Float64Array(h), tmpI = new Float64Array(h);
    for (let k = 0; k < h; k++) {
      const xr = inRe[k], xi = inIm[k];
      const yr = inRe[h - k], yi = -inIm[h - k]; // conj(X[h-k])
      const er = 0.5 * (xr + yr), ei = 0.5 * (xi + yi);
      // O = (X - conj(X[h-k])) * conj(W^k) / 2
      const dr = 0.5 * (xr - yr), di = 0.5 * (xi - yi);
      const wr = this.wr[k], wi = -this.wi[k];
      const or = dr * wr - di * wi, oi = dr * wi + di * wr;
      tmpR[k] = er - oi;
      tmpI[k] = ei + or;
    }
    for (let k = 0; k < h; k++) {
      re[rev[k]] = tmpR[k];
      im[rev[k]] = tmpI[k];
    }
    this._complex(re, im, true);
    for (let k = 0; k < h; k++) {
      out[2 * k] = re[k] / h;
      out[2 * k + 1] = im[k] / h;
    }
    void n;
  }
}

const cache = new Map();
export function getFFT(n) {
  if (!cache.has(n)) cache.set(n, new RealFFT(n));
  return cache.get(n);
}

/** Periodic Hann window (scipy get_window('hann', n, fftbins=True), as librosa uses). */
export function hann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}
