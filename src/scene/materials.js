// Scanned PBR materials (CC0, Poly Haven — see README) and wall grime.
import * as THREE from "three";

export const loadingManager = new THREE.LoadingManager();
const loader = new THREE.TextureLoader(loadingManager);
const base = `${import.meta.env.BASE_URL}assets/textures/`;
const texCache = new Map();

function tex(file, srgb, repeat) {
  const key = `${file}|${repeat ? repeat.join("x") : ""}`;
  if (texCache.has(key)) return texCache.get(key);
  const t = loader.load(base + file);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  texCache.set(key, t);
  return t;
}

/**
 * A scanned material. name ∈ plaster | floor | wood | cotton | leather.
 * color tints the albedo; repeat tiles the maps.
 */
export function pbr(name, { color = 0xffffff, repeat = [1, 1], roughness = 1, normalScale = 1, metalness = 0, side = THREE.FrontSide } = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    map: tex(`${name}_diff.jpg`, true, repeat),
    normalMap: tex(`${name}_nor.jpg`, false, repeat),
    normalScale: new THREE.Vector2(normalScale, normalScale),
    roughnessMap: tex(`${name}_rough.jpg`, false, repeat),
    roughness,
    metalness,
    side
  });
}

/**
 * Multiply a material's albedo by a large, non-repeating grime map addressed
 * through a second UV set ("uvGrime"), so tiled scans don't look tiled.
 */
export function withGrime(mat, grimeTex) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.grimeMap = { value: grimeTex };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 uvGrime;\nvarying vec2 vGrimeUv;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvGrimeUv = uvGrime;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D grimeMap;\nvarying vec2 vGrimeUv;")
      .replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.rgb *= texture2D(grimeMap, vGrimeUv).rgb;");
  };
  mat.customProgramCacheKey = () => `grime-${grimeTex.uuid}`;
  return mat;
}
