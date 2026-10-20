// WAV encode/decode. Encoding mirrors write_wav() in group1_render_cli.py
// (16-bit PCM) and save_8bit_wav() in bitcrusher.py (8-bit unsigned PCM).

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * @param {Float32Array[]} channels  one Float32Array per channel, equal lengths
 * @param {number} sampleRate
 * @param {8|16} bits
 */
export function encodeWav(channels, sampleRate, bits = 16) {
  const chans = channels.length;
  const len = channels[0].length;
  const bytesPerSample = bits / 8;
  const dataBytes = len * chans * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, chans, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * chans * bytesPerSample, true);
  view.setUint16(32, chans * bytesPerSample, true);
  view.setUint16(34, bits, true);
  str(36, "data");
  view.setUint32(40, dataBytes, true);
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < chans; c++) {
      const s = clamp(channels[c][i], -1, 1);
      if (bits === 8) {
        // unsigned 8-bit: ((y + 1) * 127.5) as in save_8bit_wav
        view.setUint8(off, Math.round((s + 1) * 127.5));
        off += 1;
      } else {
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
      }
    }
  }
  return new Blob([buf], { type: "audio/wav" });
}

export function audioBufferToWav(buffer, bits = 16) {
  const chans = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
  return encodeWav(chans, buffer.sampleRate, bits);
}

/**
 * Minimal PCM WAV decoder (8/16/24/32-bit int, 32-bit float). Used by the
 * build scripts and tests where decodeAudioData is not available.
 * Returns { sampleRate, channels: Float32Array[] }.
 */
export function decodeWav(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const tag = (o) => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a RIFF/WAVE file");
  let off = 12;
  let fmt = null;
  while (off + 8 <= view.byteLength) {
    const id = tag(off);
    const size = view.getUint32(off + 4, true);
    const body = off + 8;
    if (id === "fmt ") {
      fmt = {
        format: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true)
      };
      if (fmt.format === 0xfffe && size >= 26) fmt.format = view.getUint16(body + 24, true);
    } else if (id === "data" && fmt) {
      const n = Math.floor(Math.min(size, view.byteLength - body) / (fmt.bits / 8) / fmt.channels);
      const out = Array.from({ length: fmt.channels }, () => new Float32Array(n));
      let p = body;
      const bps = fmt.bits / 8;
      for (let i = 0; i < n; i++) {
        for (let c = 0; c < fmt.channels; c++) {
          let v;
          if (fmt.format === 3 && fmt.bits === 32) v = view.getFloat32(p, true);
          else if (fmt.bits === 8) v = (view.getUint8(p) - 128) / 128;
          else if (fmt.bits === 16) v = view.getInt16(p, true) / 32768;
          else if (fmt.bits === 24) {
            let x = view.getUint8(p) | (view.getUint8(p + 1) << 8) | (view.getUint8(p + 2) << 16);
            if (x & 0x800000) x |= ~0xffffff;
            v = x / 8388608;
          } else if (fmt.bits === 32) v = view.getInt32(p, true) / 2147483648;
          else throw new Error(`unsupported bit depth ${fmt.bits}`);
          out[c][i] = v;
          p += bps;
        }
      }
      return { sampleRate: fmt.sampleRate, channels: out };
    }
    off = body + size + (size & 1);
  }
  throw new Error("no data chunk found");
}

export function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
