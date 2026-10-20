// Post-processing: hover outline, bloom, tone mapping and a lofi film pass.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutlinePass } from "three/examples/jsm/postprocessing/OutlinePass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";

const LofiShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uAmount: { value: 1 },
    uFocus: { value: 0 }
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; uniform float uAmount; uniform float uFocus;
    varying vec2 vUv;
    float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    void main(){
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      float ca = 0.0022 * uAmount * (0.25 + r2 * 3.5);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ca).b;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      // grade (after the reference photo): amber highlights, teal shadows,
      // a touch of S-curve contrast and slightly muted saturation
      col = mix(col, col * vec3(1.08, 0.99, 0.82), smoothstep(0.2, 0.85, l) * 0.6 * uAmount);
      col += vec3(-0.004, 0.006, 0.014) * (1.0 - smoothstep(0.0, 0.35, l)) * uAmount;
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.22 * uAmount);
      col = mix(vec3(l), col, 1.0 - 0.12 * uAmount);
      // vignette (stronger when a tool panel is open)
      float vig = smoothstep(0.95, 0.18, length(c * vec2(1.0, 1.2)));
      col *= mix(1.0, vig, (0.6 + 0.25 * uFocus) * uAmount);
      col *= 1.0 - 0.35 * uFocus;
      // grain + faint scanline
      float g = hash(uv * uRes + fract(uTime * 7.13) * 91.0) - 0.5;
      col += g * 0.05 * uAmount;
      col *= 1.0 - 0.025 * uAmount * step(0.5, fract(uv.y * uRes.y * 0.5));
      gl_FragColor = vec4(col, 1.0);
    }`
};

// Replaces NaN/Inf and clamps extreme HDR values: one bad pixel would
// otherwise be smeared across the whole frame by the bloom blur.
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      if (!(c.r == c.r) || !(c.g == c.g) || !(c.b == c.b)) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 48.0), 1.0); }`
};

export function createPost(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));

  // ambient occlusion: dark corners and contact shadows under everything
  const gtao = new GTAOPass(scene, camera, size.x / 2, size.y / 2);
  const gtaoSetSize = gtao.setSize.bind(gtao);
  gtao.setSize = (w, h) => gtaoSetSize(Math.max(1, Math.floor(w / 2)), Math.max(1, Math.floor(h / 2)));
  gtao.blendIntensity = 0.85;
  gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 12 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 8 });
  composer.addPass(gtao);

  const outline = new OutlinePass(new THREE.Vector2(size.x, size.y), scene, camera);
  outline.edgeStrength = 3.2;
  outline.edgeGlow = 0.6;
  outline.edgeThickness = 1.4;
  outline.pulsePeriod = 2.4;
  outline.visibleEdgeColor.set(0xffcf8a);
  outline.hiddenEdgeColor.set(0x5a3a20);
  composer.addPass(outline);

  composer.addPass(new ShaderPass(SanitizeShader));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.62, 0.5, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const lofi = new ShaderPass(LofiShader);
  composer.addPass(lofi);

  return {
    composer,
    gtao,
    outline,
    bloom,
    lofi,
    setSize(w, h, pr) {
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      lofi.uniforms.uRes.value.set(w * pr, h * pr);
    },
    render(t) {
      lofi.uniforms.uTime.value = t;
      composer.render();
    }
  };
}
