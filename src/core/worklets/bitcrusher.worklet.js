// Real-time version of bitcrusher_effect() from MP1_G1_Sound_Engine/bitcrusher.py.
//
//   amp_levels = 2 ** bit_depth
//   q = round((clip(y,-1,1) + 1) * 0.5 * (amp_levels - 1))
//   y = q / (amp_levels - 1) * 2 - 1
//   reduction_factor = max(1, int(2 ** max(0, (16 - bit_depth) / 4)))
//   y = repeat(y[::reduction_factor], reduction_factor)
//
// The Python version downsamples by slicing and repeating the whole file;
// here the same result comes from a sample-and-hold that latches every
// `factor` samples. "link" keeps the original coupling between bit depth and
// downsampling; unlinked, the rate knob sets the factor directly.

class BitcrusherProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "bits", defaultValue: 8, minValue: 1, maxValue: 16, automationRate: "k-rate" },
      { name: "factor", defaultValue: 4, minValue: 1, maxValue: 64, automationRate: "k-rate" },
      { name: "mix", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "link", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "bypass", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" }
    ];
  }

  constructor() {
    super();
    this.held = [0, 0];
    this.count = [0, 0];
    this.meterAcc = 0;
    this.meterN = 0;
    this.port.onmessage = (e) => {
      if (e.data === "reset") { this.count = [0, 0]; }
    };
  }

  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) {
      for (const ch of output) ch.fill(0);
      return true;
    }
    const bits = params.bits[0];
    const link = params.link[0] >= 0.5;
    const mix = params.mix[0];
    const bypass = params.bypass[0] >= 0.5;
    const factor = link
      ? Math.max(1, Math.floor(Math.pow(2, Math.max(0, (16 - bits) / 4))))
      : Math.max(1, Math.round(params.factor[0]));
    const levels = Math.pow(2, bits) - 1;

    for (let c = 0; c < output.length; c++) {
      const src = input[c] || input[0];
      const dst = output[c];
      const s = Math.min(c, 1);
      if (bypass) { dst.set(src); continue; }
      let held = this.held[s];
      let count = this.count[s];
      for (let i = 0; i < dst.length; i++) {
        if (count <= 0) {
          let x = src[i];
          x = x < -1 ? -1 : x > 1 ? 1 : x;
          const q = Math.round((x + 1) * 0.5 * levels);
          held = (q / levels) * 2 - 1;
          count = factor;
        }
        count--;
        dst[i] = src[i] * (1 - mix) + held * mix;
      }
      this.held[s] = held;
      this.count[s] = count;
    }
    return true;
  }
}

registerProcessor("bitcrusher", BitcrusherProcessor);
