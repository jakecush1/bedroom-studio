// Master export: 24-bit PCM, or 16-bit PCM with TPDF dither (±1 LSB
// triangular noise decorrelates the rounding error so quiet fades and reverb
// tails don't turn into gritty quantisation distortion).

/**
 * @param {Float32Array[]} channels
 * @param {number} sampleRate
 * @param {16|24} bits
 * @returns {Blob}
 */
export function encodeMaster(channels, sampleRate, bits = 24, { dither = bits === 16, seed = 0x2545f491 } = {}) {
  const C = channels.length, n = channels[0].length, bps = bits / 8;
  const data = n * C * bps;
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF");
  v.setUint32(4, 36 + data, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, C, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * C * bps, true);
  v.setUint16(32, C * bps, true);
  v.setUint16(34, bits, true);
  str(36, "data");
  v.setUint32(40, data, true);
  // xorshift for reproducible dither
  let s = seed >>> 0;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const max = bits === 16 ? 32767 : 8388607, min = -max - 1;
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < C; c++) {
      let q = channels[c][i] * max;
      if (dither) q += rnd() - rnd();
      q = Math.round(q);
      if (q > max) q = max; else if (q < min) q = min;
      if (bits === 16) {
        v.setInt16(o, q, true);
        o += 2;
      } else {
        v.setUint8(o, q & 0xff);
        v.setUint8(o + 1, (q >> 8) & 0xff);
        v.setUint8(o + 2, (q >> 16) & 0xff);
        o += 3;
      }
    }
  }
  return new Blob([buf], { type: "audio/wav" });
}
