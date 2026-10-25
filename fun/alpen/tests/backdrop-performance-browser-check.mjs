// In a served Alpen page:
// await (await import('./tests/backdrop-performance-browser-check.mjs')).runBackdropPerformanceCheck()
// Compare the complete production fragment output against the original,
// unconditional detail path, including its implicit rock mip gradients.
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { createSky } from '../js/sky.js';
import { getWorldSeed, setWorldSeed } from '../js/noise.js';

const SIZE = 128;
const REFERENCE_DETAIL = `
    vec3 slow = texture2D(uNoise, vReal.xz / 2300.0).rgb;
    vec2 fastUv = vReal.xz / 160.0 + vec2(0.37, 0.11);
    vec2 fineUv = mat2(0.8, -0.6, 0.6, 0.8) * vReal.xz / 47.0 + vec2(0.71, 0.23);
    vec3 fast = referenceLandNoise(fastUv);
    float fine = referenceLandNoise(fineUv).g;
    float near = 1.0 - smoothstep(2600.0, 7000.0, vDist);
    float mid = 1.0 - smoothstep(5000.0, 16000.0, vDist);
    // Each field's fade by the pixels one of its cells covers, unconditionally.
    float fineSeen = smoothstep(2.0, 6.0,
      0.125 / max(max(length(dFdx(fineUv)), length(dFdy(fineUv))), 1e-6));
    float fastSeen = smoothstep(2.5, 8.0,
      0.125 / max(max(length(dFdx(fastUv)), length(dFdy(fastUv))), 1e-6));
    fast = mix(vec3(0.5), fast, mid * fastSeen);
    fine = mix(0.5, fine, near * fineSeen);
    vec3 an = abs(n) + 0.001;
    vec3 q = vReal / 230.0;
    vec3 r = vec3(0.8 * vReal.x - 0.6 * vReal.z, vReal.y, 0.6 * vReal.x + 0.8 * vReal.z) / 61.0;
    vec3 strata = ((texture2D(uRockDetail, q.zy).rgb + texture2D(uRockDetail, r.zy + 0.31).rgb) * an.x
      + (texture2D(uRockDetail, q.xz).rgb + texture2D(uRockDetail, r.xz + 0.53).rgb) * an.y
      + (texture2D(uRockDetail, q.xy).rgb + texture2D(uRockDetail, r.xy + 0.17).rgb) * an.z)
      / (2.0 * (an.x + an.y + an.z));
    strata = mix(vec3(0.42), strata, mid);
`;
const VERTEX = `
  uniform vec2 uOrigin;
  uniform float uSpan, uDistance, uDistanceSpan;
  varying float vAO, vSunHorizon;
  varying highp vec3 vReal, vDir;
  varying highp float vDist;
  void main() {
    vec2 p = uOrigin + position.xy * uSpan;
    vReal = vec3(p.x, -500.0 + position.y * 400.0, p.y);
    vDir = vReal;
    vDist = uDistance + position.x * uDistanceSpan;
    vAO = 0.8;
    vSunHorizon = -0.4;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export async function runBackdropPerformanceCheck() {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const seed = getWorldSeed();
  let sky;
  try {
    setWorldSeed(0);
    sky = createSky(THREE);
  } finally { setWorldSeed(seed); }
  const renderer = new THREE.WebGLRenderer({
    canvas: new OffscreenCanvas(SIZE, SIZE), antialias: false,
  });
  const target = new THREE.WebGLRenderTarget(SIZE, SIZE);
  const geometry = new THREE.PlaneGeometry(2, 2);
  const textures = new Set(), materials = new Set(), geometries = new Set();
  let production, reference;
  try {
    assert(await sky.backdropReady, 'load the real terrain maps');
    const source = sky.group.getObjectByName('backdrop-range').material;
    const rock = await new THREE.TextureLoader().loadAsync(
      new URL('../assets/textures/rock/rock-granite.jpg', import.meta.url).href);
    rock.wrapS = rock.wrapT = THREE.RepeatWrapping;
    rock.colorSpace = THREE.SRGBColorSpace;
    rock.anisotropy = 4;
    textures.add(rock);
    const uniforms = {
      ...source.uniforms,
      uOrigin: { value: new THREE.Vector2() },
      uSpan: { value: 240 },
      uDistance: { value: 2400 },
      uDistanceSpan: { value: 0 },
      uRockDetail: { value: rock },
      uKeyLight: { value: new THREE.Color(2, 1.9, 1.8) },
      uSkyFill: { value: new THREE.Color(0.6, 0.8, 1) },
      uGroundFill: { value: new THREE.Color(0.5, 0.6, 0.7) },
      uSunDir: { value: new THREE.Vector3(0.5, 0.6, -0.4).normalize() },
    };
    const start = source.fragmentShader.indexOf('    vec3 slow = texture2D(uNoise');
    const end = source.fragmentShader.indexOf('    float grain = ', start);
    assert(start >= 0 && end > start, 'find the production detail block');
    const referenceShader = (source.fragmentShader.slice(0, start)
      + REFERENCE_DETAIL + source.fragmentShader.slice(end))
      .replace('  void main() {', `
  vec3 referenceLandNoise(vec2 uv) {
    return landNoise(uv, dFdx(uv), dFdy(uv));
  }
  void main() {`);
    production = new THREE.ShaderMaterial({
      uniforms, vertexShader: VERTEX, fragmentShader: source.fragmentShader,
      depthTest: false, depthWrite: false,
    });
    reference = new THREE.ShaderMaterial({
      uniforms, vertexShader: VERTEX, fragmentShader: referenceShader,
      depthTest: false, depthWrite: false,
    });
    const scene = new THREE.Scene(), quad = new THREE.Mesh(geometry, production);
    scene.add(quad);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const draw = material => {
      quad.material = material;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      const bytes = new Uint8Array(SIZE * SIZE * 4);
      renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, bytes);
      return bytes;
    };
    const solid = rgba => {
      const texture = new THREE.DataTexture(new Uint8Array(rgba), 1, 1);
      texture.needsUpdate = true;
      textures.add(texture);
      return texture;
    };
    const cliffShape = solid([249, 140, 190, 255]), cliffCover = solid([0, 0, 0, 255]);
    const records = [];
    for (const cliff of [false, true]) {
      uniforms.uShape = { value: cliff ? cliffShape : source.uniforms.uShape.value };
      uniforms.uCover = { value: cliff ? cliffCover : source.uniforms.uCover.value };
      for (const distance of [2400, 6999, 7000, 7001, 15999, 16000, 16001, 30000]) {
        for (const seam of [false, true]) {
          const boundary = distance === 7000 || distance === 16000;
          uniforms.uDistance.value = distance + (boundary ? 0.2 : 0);
          // A cutoff through a fragment quad checks gradients across the branch.
          uniforms.uDistanceSpan.value = boundary ? 8 : 0;
          uniforms.uOrigin.value.set(seam ? 0 : 1300, seam ? distance : -distance);
          const before = draw(reference), after = draw(production);
          let largest = 0, sum = 0;
          let lowest = Infinity, highest = -Infinity;
          for (let i = 0; i < before.length; i++) {
            const difference = Math.abs(before[i] - after[i]);
            largest = Math.max(largest, difference);
            sum += difference;
            if (i % 4 === 0) {
              const light = before[i] + before[i + 1] + before[i + 2];
              lowest = Math.min(lowest, light);
              highest = Math.max(highest, light);
              assert(before[i + 3] === 255 && after[i + 3] === 255,
                'both full shaders must draw an opaque surface');
            }
          }
          assert(highest - lowest >= 4, 'the reference must draw visible colour variation, not a blank fixture');
          assert(largest <= 1 && sum / before.length < 0.02,
            `detail optimization changes colour: ${JSON.stringify({ cliff, seam, distance, largest, mean: sum / before.length })}`);
          records.push({ cliff, seam, distance, largest, mean: sum / before.length });
        }
      }
    }
    assert(renderer.getContext().getError() === renderer.getContext().NO_ERROR,
      'the full shaders compile and render without a WebGL error');
    return { cases: records.length, largest: Math.max(...records.map(r => r.largest)), records };
  } finally {
    production?.dispose(); reference?.dispose(); geometry.dispose(); target.dispose();
    sky.group.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      for (const material of [].concat(object.material || [])) {
        materials.add(material);
        for (const uniform of Object.values(material.uniforms || {})) {
          if (uniform.value?.isTexture) textures.add(uniform.value);
        }
      }
    });
    for (const material of materials) material.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const texture of textures) texture.dispose();
    sky.probe.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
