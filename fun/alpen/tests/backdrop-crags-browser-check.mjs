import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { createSky } from '../js/sky.js';
import { getWorldSeed, setWorldSeed } from '../js/noise.js';
const SIZE = 128;
const VERTEX = [
  'uniform float uSpan, uDistance;',
  'varying float vAO, vSunHorizon;',
  'varying highp vec3 vReal, vDir;',
  'varying highp float vDist;',
  'void main() {',
  '  vReal = vec3(1700.0 + position.x * uSpan, 1300.0 + position.y * uSpan * 4.0, -uDistance);',
  '  vDir = vReal; vDist = uDistance; vAO = 0.8; vSunHorizon = -0.4;',
  '  gl_Position = vec4(position.xy, 0.0, 1.0);',
  '}',
].join('\n');
export async function runBackdropCragCheck() {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const seed = getWorldSeed();
  let sky;
  try { setWorldSeed(0); sky = createSky(THREE); } finally { setWorldSeed(seed); }
  const renderer = new THREE.WebGLRenderer({ canvas: new OffscreenCanvas(SIZE, SIZE), antialias: false });
  const target = new THREE.WebGLRenderTarget(SIZE, SIZE), geometry = new THREE.PlaneGeometry(2, 2);
  const textures = new Set(), materials = new Set(), geometries = new Set();
  let candidate, reference;
  try {
    assert(await sky.backdropReady, 'load the production backdrop and maps');
    const source = sky.group.getObjectByName('backdrop-range').material;
    const marker = '    float snowPocket = 0.0;', output = 'gl_FragColor = vec4(c, 1.0);';
    assert(source.fragmentShader.includes(marker), 'find the production face-detail mask');
    assert(source.fragmentShader.includes(output), 'find the production shader output');
    const encoded = source.fragmentShader.replace(output, 'gl_FragColor = vec4(n * 0.5 + 0.5, snow);');
    const uniforms = { ...source.uniforms, uSpan: { value: 1000 }, uDistance: { value: 20000 }, uWhiteout: { value: 0 } };
    candidate = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: encoded, depthTest: false, depthWrite: false });
    reference = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX,
      fragmentShader: encoded.replace(marker, '    faceMask = 0.0;\n' + marker), depthTest: false, depthWrite: false });
    const solid = rgba => {
      const texture = new THREE.DataTexture(new Uint8Array(rgba), 1, 1);
      texture.needsUpdate = true; textures.add(texture); return texture;
    };
    const steep = solid([154, 218, 190, 255]), flat = solid([128, 128, 190, 255]);
    const snowRock = solid([166, 0, 0, 255]), forest = solid([0, 255, 0, 255]);
    const scene = new THREE.Scene(), quad = new THREE.Mesh(geometry, candidate);
    scene.add(quad);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const draw = material => {
      quad.material = material; renderer.setRenderTarget(target); renderer.render(scene, camera);
      const pixels = new Uint8Array(SIZE * SIZE * 4);
      renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels); return pixels;
    };
    const cases = [
      { name: 'rock-snow-20km', distance: 20000, visible: true },
      { name: 'rock-snow-28km', distance: 28000, visible: true },
      { name: 'forest', distance: 20000, forest: true },
      { name: 'flat', distance: 20000, flat: true },
      { name: 'unresolved', distance: 20000, span: 12000 },
      { name: 'whiteout', distance: 20000, whiteout: 1 },
      { name: 'far-cutoff', distance: 45000 },
      { name: 'beyond-cutoff', distance: 48000 },
    ];
    const records = [];
    for (const test of cases) {
      uniforms.uDistance.value = test.distance; uniforms.uSpan.value = test.span ?? 1000;
      uniforms.uWhiteout.value = test.whiteout ?? 0;
      uniforms.uShape = { value: test.flat ? flat : steep };
      uniforms.uCover = { value: test.forest ? forest : snowRock };
      candidate.uniforms.uShape = reference.uniforms.uShape = uniforms.uShape;
      candidate.uniforms.uCover = reference.uniforms.uCover = uniforms.uCover;
      const before = draw(reference), after = draw(candidate);
      let largest = 0, changed = 0, minY = 255;
      for (let i = 0; i < before.length; i++) {
        const delta = Math.abs(before[i] - after[i]); largest = Math.max(largest, delta);
        if (delta > 0) changed++; if (i % 4 === 1) minY = Math.min(minY, after[i]);
      }
      assert(minY >= 127, test.name + ': normals remain upward');
      if (test.visible) assert(largest >= 2 && changed > SIZE * SIZE / 4, test.name + ': resolved detail affects the shader');
      else assert(largest === 0, test.name + ': suppressed detail matches the bypass exactly');
      records.push({ name: test.name, largest, changed, minY });
    }

    Object.assign(uniforms, {
      uSunDir: { value: new THREE.Vector3(.05, 1, .08).normalize() },
      uKeyLight: { value: new THREE.Color(2, 1.9, 1.8) },
      uSkyFill: { value: new THREE.Color(.6, .8, 1) }, uGroundFill: { value: new THREE.Color(.4, .5, .6) },
      uAlpenglow: { value: new THREE.Color(0, 0, 0) },
      uRockCool: { value: new THREE.Color(.4, .4, .4) }, uRockWarm: { value: new THREE.Color(.4, .4, .4) },
      uSea: { value: 0 }, uClarity: { value: 80000 }, uValley: { value: 0 },
      uCurtain: { value: -100 }, uGlowStrength: { value: 0 },
    });
    const colorCandidate = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX,
      fragmentShader: source.fragmentShader, depthTest: false, depthWrite: false });
    const colorReference = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX,
      fragmentShader: source.fragmentShader.replace(marker, '    faceMask = 0.0;\n' + marker),
      depthTest: false, depthWrite: false });
    materials.add(colorCandidate); materials.add(colorReference);
    const fullSnow = solid([255, 0, 0, 255]), bareRock = solid([0, 0, 0, 255]);
    for (const [name, cover] of [['full-snow', fullSnow], ['bare-gray-rock', bareRock]]) {
      for (const distance of [20000, 28000]) {
        uniforms.uDistance.value = distance; uniforms.uSpan.value = 1000; uniforms.uWhiteout.value = 0;
        uniforms.uShape = { value: steep }; uniforms.uCover = { value: cover };
        colorCandidate.uniforms.uShape = colorReference.uniforms.uShape = uniforms.uShape;
        colorCandidate.uniforms.uCover = colorReference.uniforms.uCover = uniforms.uCover;
        const before = draw(colorReference), after = draw(colorCandidate);
        let largest = 0, changedPixels = 0, sum = 0;
        for (let i = 0; i < before.length; i += 4) {
          let pixelMax = 0;
          for (let channel = 0; channel < 3; channel++) {
            const difference = Math.abs(before[i + channel] - after[i + channel]);
            largest = Math.max(largest, difference); pixelMax = Math.max(pixelMax, difference); sum += difference;
          }
          if (pixelMax > 0) changedPixels++;
        }
        const changedFraction = changedPixels / (SIZE * SIZE), mean = sum / (SIZE * SIZE * 3);
        assert(largest >= 2 && changedFraction >= .15 && mean >= .15,
          name + '-' + distance + ': detail affects final high-sun RGB ' + JSON.stringify({ largest, changedFraction, mean }));
        records.push({ name: name + '-' + distance + '-final-rgb', largest, changedFraction, mean });
      }
    }
    const gl = renderer.getContext();
    assert(gl.getError() === gl.NO_ERROR, 'compile and render without WebGL errors');
    return { cases: records.length, records };
  } finally {
    candidate?.dispose(); reference?.dispose(); geometry.dispose(); target.dispose();
    sky.group.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      for (const material of [].concat(object.material || [])) {
        materials.add(material);
        for (const uniform of Object.values(material.uniforms || {})) if (uniform.value?.isTexture) textures.add(uniform.value);
      }
    });
    for (const material of materials) material.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const texture of textures) texture.dispose();
    sky.probe.dispose(); renderer.dispose(); renderer.forceContextLoss();
  }
}

// Inspect the actual loaded range at the same native-size review camera.
export function inspectBackdropModel(a, view) {
  const sourceGroup = a.sky.group.getObjectByName('backdrop');
  const source = sourceGroup.children.find(o => o.name === 'backdrop-range').material;
  const output = 'gl_FragColor = vec4(c, 1.0);', marker = '    float snowPocket = 0.0;';
  const renderer = a.renderer, width = renderer.domElement.width, height = renderer.domElement.height;
  const target = new THREE.WebGLRenderTarget(width, height);
  const oldTarget = renderer.getRenderTarget(), oldClear = renderer.getClearColor(new THREE.Color()).clone();
  const oldAlpha = renderer.getClearAlpha(), oldAutoClear = renderer.autoClear;
  const scene = new THREE.Scene(), group = sourceGroup.clone(true);
  group.matrix.copy(sourceGroup.matrixWorld); group.matrixAutoUpdate = false; scene.add(group);
  const camera = a.camera.clone(); camera.position.fromArray(view.eye); camera.up.set(0, 1, 0);
  camera.lookAt(...view.target); camera.fov = view.fov; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  const materials = [];
  const material = fragmentShader => {
    const m = new THREE.ShaderMaterial({ uniforms: source.uniforms, vertexShader: source.vertexShader,
      fragmentShader, side: THREE.FrontSide, depthWrite: true, depthTest: true });
    materials.push(m); return m;
  };
  const draw = m => {
    group.traverse(o => { if (o.isMesh) o.material = m; });
    renderer.setRenderTarget(target); renderer.clear(); renderer.render(scene, camera);
    const bytes = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, bytes); return bytes;
  };
  try {
    renderer.autoClear = false; renderer.setClearColor(0, 0);
    const masks = draw(material(source.fragmentShader.replace(output,
      'gl_FragColor = vec4(faceMask, dot(faceSeen, faceWeight), cover.r, 1.0);')));
    const terrain = draw(material(source.fragmentShader.replace(output,
      'gl_FragColor = vec4(sqrt(max(0.0, 1.0-dot(nxz,nxz))), cover.g, vDist/48000.0, 1.0);')));
    const before = draw(material(source.fragmentShader.replace(marker, '    faceMask = 0.0;\n' + marker)));
    const after = draw(material(source.fragmentShader));
    const records = [];
    for (const rect of view.crops) {
      let count = 0, active = 0, resolved = 0, fullSnow = 0, flat = 0, forest = 0;
      let maskSum = 0, changed = 0, sum = 0, largest = 0;
      for (let dy = 0; dy < rect.height; dy++) for (let dx = 0; dx < rect.width; dx++) {
        const x = Math.floor((rect.x + dx) * width / 1100);
        const y = height - 1 - Math.floor((rect.y + dy) * height / 700);
        const i = (y * width + x) * 4;
        if (masks[i + 3] < 250) continue;
        count++; active += masks[i] > 5; resolved += masks[i + 1] > 5;
        fullSnow += masks[i + 2] >= 209; flat += terrain[i] >= 242; forest += terrain[i + 1] >= 148;
        maskSum += masks[i] * masks[i + 1] / 65025;
        let max = 0;
        for (let c = 0; c < 3; c++) {
          const d = Math.abs(after[i + c] - before[i + c]); max = Math.max(max, d); sum += d; largest = Math.max(largest, d);
        }
        changed += max > 0;
      }
      records.push({ name: rect.name, pixels: count, activeFraction: active / count,
        resolvedFraction: resolved / count, fullSnowFraction: fullSnow / count,
        flatFraction: flat / count, forestFraction: forest / count, meanMask: maskSum / count,
        changedFraction: changed / count, meanRGB: sum / (count * 3), largest });
    }
    return records;
  } finally {
    renderer.setRenderTarget(oldTarget); renderer.setClearColor(oldClear, oldAlpha); renderer.autoClear = oldAutoClear;
    target.dispose(); for (const m of materials) m.dispose();
  }
}
