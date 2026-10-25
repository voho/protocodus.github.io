/* A lit table for a small puzzle, seen straight from above: renderer,
   camera, lights, reflections, backdrop, bloom, the weather of a theme
   and the frame loop, shared by Zipper and Patcher. A board adds its own
   meshes to `scene` and asks the stage to frame them. */
import * as THREE from 'three';
import { createBloom, canRenderHalfFloat } from './bloom.js';
import { createBursts } from './particles.js';

const BACKDROP_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy * 2.0, 1.0, 1.0);
}`;

/* A vertical gradient with a soft pool of light behind the board, two
   slow drifting pools of colour that never stop (an aurora, at a crawl),
   a pulse of light where the last move landed, faint scenery by the
   theme's motif, and darker corners. It is drawn over the whole screen,
   whatever the camera does. */
const BACKDROP_FRAGMENT = /* glsl */ `
uniform vec3 uTop, uBottom, uGlow, uBlobA, uBlobB, uPulseColour;
uniform float uAspect, uTime, uPulse, uMotif;
uniform vec2 uPulseAt;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  vec3 colour = mix(uBottom, uTop, smoothstep(0.0, 1.0, vUv.y));
  vec2 a = vec2(sin(uTime * 0.11) * 0.55, cos(uTime * 0.08) * 0.28 + 0.12);
  vec2 b = vec2(cos(uTime * 0.07) * 0.6, sin(uTime * 0.09) * 0.3 - 0.08);
  colour += uBlobA * exp(-dot(p - a, p - a) * 2.6);
  colour += uBlobB * exp(-dot(p - b, p - b) * 2.2);
  vec2 d = p - vec2(0.0, 0.06);
  colour += uGlow * exp(-dot(d, d) * 4.0);
  vec2 q = p - (uPulseAt - 0.5) * vec2(uAspect, 1.0);
  colour += uPulseColour * uPulse * exp(-dot(q, q) * 5.0);
  // Quiet, distinct scenery behind the table. Analytic shapes need no assets.
  float pattern = 0.0;
  if (uMotif < 0.5) {
    float ribbon = sin(p.x * 4.0 + sin(p.y * 6.0 + uTime * 0.08) * 1.4);
    pattern = pow(max(0.0, 1.0 - abs(p.y - ribbon * 0.18 - 0.15)), 14.0) * 0.18;
  } else if (uMotif < 1.5) {
    pattern = pow(0.5 + 0.5 * sin(length(p - vec2(0.4, -0.5)) * 28.0 - uTime * 0.13), 10.0) * 0.065;
  } else if (uMotif < 2.5) {
    vec2 grid = fract((p + vec2(uTime * 0.003, uTime * 0.006)) * 9.0) - 0.5;
    pattern = exp(-dot(grid, grid) * 110.0) * 0.12;
  } else if (uMotif < 3.5) {
    pattern = pow(0.5 + 0.5 * sin(p.y * 32.0 + sin(p.x * 3.0) * 3.0), 6.0) * 0.08;
  } else if (uMotif < 4.5) {
    pattern = pow(0.5 + 0.5 * sin(p.y * 43.0 + sin(p.x * 7.0 + uTime * 0.07)), 12.0) * 0.07;
  } else {
    vec2 grid = fract(p * 14.0) - 0.5;
    pattern = exp(-dot(grid, grid) * 180.0) * (0.06 + 0.04 * sin(uTime * 0.3 + floor(p.x * 14.0)));
  }
  colour += uGlow * pattern * 2.0;
  colour *= 1.0 - 0.6 * smoothstep(0.4, 1.05, length(p));
  gl_FragColor = vec4(colour, 1.0);
}`;

/* Reflections come from a small lit room rendered once into a PMREM: a
   dim glow overhead, a cool and a warm panel at the sides, a strip in the
   accent behind and two glints in the theme's colours low at the sides.
   Seen from straight above, every flat top mirrors the ceiling, so the
   ceiling stays soft and the colour comes in on the bevels. */
function studioEnvironment(renderer, accent, secondary) {
  const room = new THREE.Scene();
  const add = (geometry, colour, intensity, position, rotation, side = THREE.DoubleSide) => {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(colour).multiplyScalar(intensity), side });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    room.add(mesh);
  };
  add(new THREE.BoxGeometry(24, 24, 24), '#0a0c10', 1, [0, 0, 0], [0, 0, 0], THREE.BackSide);
  add(new THREE.PlaneGeometry(10, 10), '#ffffff', 1.4, [0, 11.9, 0], [Math.PI / 2, 0, 0]);
  add(new THREE.PlaneGeometry(4, 9), '#cfe0ff', 3, [-11.9, 2, 0], [0, Math.PI / 2, 0]);
  add(new THREE.PlaneGeometry(4, 9), '#ffe2c4', 2, [11.9, 2, -3], [0, -Math.PI / 2, 0]);
  add(new THREE.PlaneGeometry(14, 1.2), accent, 4, [0, 5, -11.9], [0, 0, 0]);
  add(new THREE.PlaneGeometry(6, 2), accent, 2.5, [-8, -2, 9], [0, Math.PI * 0.8, 0]);
  add(new THREE.PlaneGeometry(6, 2), secondary, 2.5, [8, -1, 9], [0, -Math.PI * 0.8, 0]);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(room, 0.04).texture;
  pmrem.dispose();
  room.traverse((object) => { object.geometry?.dispose(); object.material?.dispose(); });
  return texture;
}

/* A soft round dot for the weather. */
function dotTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/* `null` when the browser has no WebGL 2; the page says so itself. */
export function createStage(canvas, { theme, exposure = 1.1 }) {
  let probe = null;
  try { probe = document.createElement('canvas').getContext('webgl2'); } catch { probe = null; }
  if (!probe) return null;
  const hdr = canRenderHalfFloat(probe);
  probe.getExtension('WEBGL_lose_context')?.loseContext();

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // A touch screen is almost always a phone or a tablet: fewer pixels, a
  // smaller shadow map and a lower idle frame rate keep it cool.
  const mobile = window.matchMedia('(any-pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: 'high-performance',
    // In HDR the path, the numbers and the walls keep their real brightness
    // until the tone mapping, and the bloom can let the brightest bleed.
    outputBufferType: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
  });
  let pixelRatio = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  // A long lens straight above the table, so the board reads as flat as a
  // printed grid and the depth is left to the light, the shadows and the
  // bevels. It never turns or tilts; up on the screen is the far side of
  // the table.
  const camera = new THREE.PerspectiveCamera(24, 1, 0.5, 200);
  camera.up.set(0, 0, -1);
  scene.add(camera);

  const backdropMaterial = new THREE.ShaderMaterial({
    vertexShader: BACKDROP_VERTEX, fragmentShader: BACKDROP_FRAGMENT,
    uniforms: {
      uTop: { value: new THREE.Color() },
      uBottom: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() },
      uBlobA: { value: new THREE.Color() },
      uBlobB: { value: new THREE.Color() },
      uPulseColour: { value: new THREE.Color() },
      uPulse: { value: 0 },
      uPulseAt: { value: new THREE.Vector2(0.5, 0.5) },
      uAspect: { value: 1 },
      uTime: { value: 0 },
      uMotif: { value: 0 },
    },
    depthTest: false, depthWrite: false,
  });
  const backdropMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), backdropMaterial);
  backdropMesh.renderOrder = -10;
  backdropMesh.frustumCulled = false;
  backdropMesh.position.z = -100;
  camera.add(backdropMesh);

  scene.environmentIntensity = 0.6;
  const hemisphere = new THREE.HemisphereLight('#ffffff', '#000000', 0.5);
  scene.add(hemisphere);
  // The key light comes in low enough that its glint on the glossy tops
  // misses a camera straight above, and the shadows show the relief.
  const key = new THREE.DirectionalLight('#ffffff', 2.6);
  key.position.set(-6, 8, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 40;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight('#ffffff', 1.5);
  rim.position.set(4, 5, -8);
  scene.add(rim);
  const rimAccent = new THREE.Color(), rimSecondary = new THREE.Color();
  const flashLight = new THREE.PointLight('#ffffff', 0, 14, 1.4);
  flashLight.position.set(0, 2.5, 0);
  scene.add(flashLight);

  // The board floats; its shadow lands on an invisible floor below.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: 0.3 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1;
  floor.receiveShadow = true;
  scene.add(floor);

  const bloom = hdr ? createBloom({ strength: 0.42, threshold: 1, knee: 0.5, spread: 1.15, levels: mobile ? 4 : 5 }) : null;
  renderer.setEffects(bloom ? [bloom] : []);
  const dot = dotTexture();

  // The camera descends to its resting height over the table.
  const rig = { distance: 60, target: { distance: 30 }, center: new THREE.Vector3() };
  let halfW = 3, halfD = 3, width = 1, height = 1;
  const listeners = new Set();
  let running = false, last = 0, time = 0, flash = 0;
  let pendingFrame = 0;
  // A move lands: a pulse of light in the backdrop.
  let pulse = 0;
  /* The table is still most of the time. While nothing moves it is drawn
     a few times a second (the weather drifts on), and every change wakes
     it up to the full frame rate for a moment. */
  let activeUntil = 0;
  let lastDraw = 0;
  const idleGap = reduced ? 1000 : (mobile ? 1 / 15 : 1 / 24) * 1000;
  let slowFrames = 0, qualityCooldown = 0, previousActive = false;
  // What a theme dresses: the pool of light it may breathe, its
  // reflections and its weather.
  const glowBase = new THREE.Color();
  let breathe = 0;
  let environment = null;
  const weather = [];

  /* Whether the board's corners all land inside `limits` (in clip space)
     from `distance` above the table. */
  const fitCamera = new THREE.PerspectiveCamera();
  const corner = new THREE.Vector3();
  function fits(distance, limits) {
    fitCamera.fov = camera.fov; fitCamera.aspect = camera.aspect; fitCamera.near = camera.near; fitCamera.far = camera.far;
    if (camera.view?.enabled) fitCamera.setViewOffset(width, height, 0, camera.view.offsetY, width, height);
    else fitCamera.updateProjectionMatrix();
    fitCamera.up.copy(camera.up);
    fitCamera.position.set(rig.center.x, rig.center.y + distance, rig.center.z);
    fitCamera.lookAt(rig.center);
    fitCamera.updateMatrixWorld();
    for (const x of [-halfW, halfW]) for (const z of [-halfD, halfD]) for (const y of [-0.4, 0.9]) {
      corner.set(x, y, z).project(fitCamera);
      if (Math.abs(corner.x) > limits.x || corner.y > limits.top || corner.y < -limits.bottom) return false;
    }
    return true;
  }
  /* The nearest the camera can stand with the whole board clear of the
     panels at the top and bottom of the window. */
  function refit() {
    const pad = height < 500 ? 8 : 14;
    // A panel that is missing or hidden has no size; the board then takes
    // the whole window rather than squeezing against its edge.
    const panel = (selector) => { const rect = document.querySelector(selector)?.getBoundingClientRect(); return rect?.height > 0 ? rect : null; };
    const topBar = panel('.hud-top')?.bottom ?? 0;
    const bottomTop = panel('.hud-bottom')?.top ?? height;
    // Shift the optical centre into the free space between the controls.
    // A centered frustum wastes much of a phone's asymmetric play area.
    const centreY = (topBar + bottomTop) / 2;
    camera.setViewOffset(width, height, 0, height / 2 - centreY, width, height);
    const limits = { x: 0.92, top: 1 - 2 * (topBar + pad) / height, bottom: 2 * (bottomTop - pad) / height - 1 };
    let near = 2, far = 150;
    for (let i = 0; i < 26; i++) {
      const middle = (near + far) / 2;
      if (fits(middle, limits)) far = middle; else near = middle;
    }
    rig.target.distance = far;
  }
  function resize() {
    width = canvas.clientWidth || window.innerWidth;
    height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const span = 2 * 100 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    backdropMesh.scale.set(span * camera.aspect * 1.02, span * 1.02, 1);
    backdropMaterial.uniforms.uAspect.value = camera.aspect;
    // A camera at rest moves straight to the new height; one still on its
    // way down keeps descending.
    const before = rig.target.distance;
    refit();
    if (Math.abs(rig.distance - before) < 0.05) rig.distance = rig.target.distance;
  }

  function frame(now) {
    if (!running) return;
    pendingFrame = requestAnimationFrame(frame);
    const settled = Math.abs(rig.target.distance - rig.distance) < 0.003;
    const active = now < activeUntil || !settled || flash > 0 || pulse > 0;
    if (!active && now - lastDraw < idleGap) return;
    // Exponential easing is stable for any step, so a slow device keeps the
    // same pace in real time rather than slowing every motion down.
    const frameGap = now - last;
    // Reduce resolution only after sustained slow active frames; idle throttling
    // and returning from a background tab must never lower the quality.
    if (active && previousActive && now > qualityCooldown) {
      slowFrames = frameGap > 28 ? slowFrames + 1 : Math.max(0, slowFrames - 2);
      if (slowFrames >= 75 && pixelRatio > 0.8) {
        pixelRatio = Math.max(0.8, pixelRatio - 0.25);
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(width, height, false);
        if (pixelRatio <= 1) renderer.setEffects([]);
        qualityCooldown = now + 4000;
        slowFrames = 0;
      }
    }
    previousActive = active;
    const dt = Math.min(active ? 0.1 : 0.25, Math.max(0, frameGap / 1000));
    last = now;
    lastDraw = now;
    time += dt;
    rig.distance += (rig.target.distance - rig.distance) * (1 - Math.exp(-dt * 5));
    camera.position.set(rig.center.x, rig.center.y + rig.distance, rig.center.z);
    camera.lookAt(rig.center);
    flash = Math.max(0, flash - dt * 2.2);
    flashLight.intensity = flash * flash * 60;
    pulse = Math.max(0, pulse - dt * 1.8);
    backdropMaterial.uniforms.uPulse.value = pulse * pulse;
    backdropMaterial.uniforms.uTime.value = reduced ? 0 : time;
    // A volcano's glow swells and fades; elsewhere the pool of light holds still.
    backdropMaterial.uniforms.uGlow.value.copy(glowBase).multiplyScalar(1 + breathe * (0.5 + 0.5 * Math.sin(time * 0.7)));
    // The rim light wanders between the two accents, so highlights never sit still.
    rim.color.copy(rimAccent).lerp(rimSecondary, 0.5 + 0.5 * Math.sin(time * 0.23));
    for (const listener of listeners) listener(dt, time);
    renderer.render(scene, camera);
  }

  /* A drifting cloud of soft dots: fireflies, bubbles, snow, embers or a
     starfield, by the spec's speeds. Each dot's brightness breathes on its
     own when `twinkle` is set. Sizes follow the camera's height, so the
     dots stay the same on the screen whatever board is framed. */
  function pointsCloud({ count = 80, colours = ['#ffffff'], size = 0.12, extent = 7, floor: low = -1, ceiling = 4, rise = 0, sway = 0.2, twinkle = 0 }) {
    const n = Math.max(4, Math.round(count * (mobile ? 0.5 : 1)));
    const positions = new Float32Array(n * 3), colourData = new Float32Array(n * 3), base = new Float32Array(n * 3);
    const phase = new Float32Array(n), pace = new Float32Array(n);
    const tint = new THREE.Color();
    for (let i = 0; i < n; i++) {
      positions[i * 3] = (Math.random() * 2 - 1) * extent;
      positions[i * 3 + 1] = low + Math.random() * (ceiling - low);
      positions[i * 3 + 2] = (Math.random() * 2 - 1) * extent;
      tint.set(colours[i % colours.length]);
      base.set([tint.r, tint.g, tint.b], i * 3);
      colourData.set([tint.r, tint.g, tint.b], i * 3);
      phase[i] = Math.random() * Math.PI * 2;
      pace[i] = 0.6 + Math.random() * 0.8;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colourData, 3));
    const material = new THREE.PointsMaterial({
      size, map: dot, vertexColors: true, transparent: true, opacity: 0.6,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    scene.add(points);
    const stop = stage.onFrame((dt, t) => {
      material.size = size * rig.distance / 30;
      if (reduced) return;
      const p = geometry.attributes.position.array, c = geometry.attributes.color.array;
      for (let i = 0; i < n; i++) {
        p[i * 3 + 1] += dt * rise * pace[i];
        p[i * 3] += Math.sin(t * 0.5 + phase[i]) * dt * sway;
        p[i * 3 + 2] += Math.cos(t * 0.4 + phase[i] * 1.7) * dt * sway;
        if (rise > 0 && p[i * 3 + 1] > ceiling) p[i * 3 + 1] = low;
        else if (rise < 0 && p[i * 3 + 1] < low) p[i * 3 + 1] = ceiling;
        if (twinkle) {
          const bright = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * twinkle * pace[i] + phase[i]));
          c[i * 3] = base[i * 3] * bright; c[i * 3 + 1] = base[i * 3 + 1] * bright; c[i * 3 + 2] = base[i * 3 + 2] * bright;
        }
      }
      geometry.attributes.position.needsUpdate = true;
      if (twinkle) geometry.attributes.color.needsUpdate = true;
    });
    return { dispose() { stop(); scene.remove(points); geometry.dispose(); material.dispose(); } };
  }

  /* Now and then, a spray of sparks from somewhere round the table,
     thrown inward and up. */
  function sparkShower({ colours = ['#ffd27a', '#ffffff'], every = [0.8, 2] }) {
    const bursts = createBursts(scene, { max: 160, additive: true });
    let next = time + 0.5;
    const stop = stage.onFrame((dt, t) => {
      if (!reduced && t >= next) {
        next = t + every[0] + Math.random() * (every[1] - every[0]);
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.max(halfW, halfD) + 0.6 + Math.random() * 1.5;
        bursts.burst({
          origin: new THREE.Vector3(Math.cos(angle) * radius, 0.2, Math.sin(angle) * radius), count: 6 + Math.floor(Math.random() * 8), colours,
          direction: new THREE.Vector3(-Math.cos(angle), 1.2, -Math.sin(angle)), speed: [1.5, 4], spread: 0.7,
          gravityPull: 5, airDrag: 1.2, lifespan: [0.3, 0.8], size: [0.12, 0.03], spinRate: 2,
        });
        stage.wake(1.2);
      }
      bursts.update(dt);
      if (bursts.alive) stage.wake(0.3);
    });
    return { dispose() { stop(); scene.remove(bursts.mesh); bursts.mesh.geometry.dispose(); bursts.mesh.material.dispose(); } };
  }

  /* Big soft discs of colour drifting under the table, slowly, forever;
     the board hides the ones beneath it. */
  function bokeh(colours, extent = 11) {
    const layers = [];
    for (const [size, share, speed] of [[2.4, 0.45, 0.05], [1.2, 0.55, 0.08]]) {
      const n = Math.max(4, Math.round(36 * share * (mobile ? 0.5 : 1)));
      const positions = new Float32Array(n * 3), colourData = new Float32Array(n * 3);
      const tint = new THREE.Color();
      for (let i = 0; i < n; i++) {
        positions[i * 3] = (Math.random() * 2 - 1) * extent;
        positions[i * 3 + 1] = -7 + Math.random() * 4;
        positions[i * 3 + 2] = (Math.random() * 2 - 1) * extent;
        tint.set(colours[i % colours.length]);
        colourData.set([tint.r, tint.g, tint.b], i * 3);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colourData, 3));
      const material = new THREE.PointsMaterial({
        size, map: dot, vertexColors: true, transparent: true, opacity: 0.18,
        blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
      });
      const points = new THREE.Points(geometry, material);
      points.frustumCulled = false;
      scene.add(points);
      const phase = Float32Array.from({ length: n }, () => Math.random() * Math.PI * 2);
      const stop = stage.onFrame((dt, t) => {
        material.size = size * rig.distance / 30;
        if (reduced) return;
        const p = geometry.attributes.position.array;
        for (let i = 0; i < n; i++) {
          p[i * 3] += dt * speed * Math.cos(phase[i]) + Math.sin(t * 0.2 + phase[i]) * dt * 0.1;
          p[i * 3 + 2] += dt * speed * Math.sin(phase[i]);
          if (p[i * 3] > extent) p[i * 3] = -extent; else if (p[i * 3] < -extent) p[i * 3] = extent;
          if (p[i * 3 + 2] > extent) p[i * 3 + 2] = -extent; else if (p[i * 3 + 2] < -extent) p[i * 3 + 2] = extent;
        }
        geometry.attributes.position.needsUpdate = true;
      });
      layers.push({ dispose() { stop(); scene.remove(points); geometry.dispose(); material.dispose(); } });
    }
    return { dispose() { for (const layer of layers) layer.dispose(); } };
  }

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();

  const stage = {
    renderer, scene, camera, key, rim, hdr, reduced,
    get time() { return time; },
    get width() { return width; },
    get height() { return height; },
    /* The board's half extents on the table, so the camera and the shadow
       map cover it. */
    frame(w, d) {
      halfW = w; halfD = d;
      const reach = Math.max(w, d) + 1.5;
      Object.assign(key.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach });
      key.shadow.camera.updateProjectionMatrix();
      refit();
    },
    /* The point on the plane y = `planeY` under a pointer, or null. */
    pick(clientX, clientY, planeY = 0) {
      const rect = canvas.getBoundingClientRect();
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      plane.constant = -planeY;
      return raycaster.ray.intersectPlane(plane, hit) ? hit : null;
    },
    /* Where a point on the table is on the page, in client pixels. */
    project(point) {
      const rect = canvas.getBoundingClientRect();
      corner.copy(point).project(camera);
      return { x: rect.left + (corner.x + 1) / 2 * rect.width, y: rect.top + (1 - corner.y) / 2 * rect.height };
    },
    onFrame(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    /* Something moved: draw every frame for the next `seconds`. */
    wake(seconds = 0.8) { activeUntil = Math.max(activeUntil, performance.now() + seconds * 1000); },
    flash(colour, strength = 1) { if (reduced) return; flashLight.color.set(colour); flash = Math.max(flash, strength); stage.wake(); },
    /* A glossy material: a clear coat on a desktop GPU, plain shading on a
       phone, where the second specular lobe is not worth the heat. */
    material({ clearcoat = 1, clearcoatRoughness = 0.12, ...rest }) {
      return mobile ? new THREE.MeshStandardMaterial(rest) : new THREE.MeshPhysicalMaterial({ clearcoat, clearcoatRoughness, ...rest });
    },
    /* Light blooms in the backdrop behind a point on the table. */
    pulse(point, colour, strength = 1) {
      if (reduced) return;
      corner.copy(point).project(camera);
      backdropMaterial.uniforms.uPulseAt.value.set((corner.x + 1) / 2, (corner.y + 1) / 2);
      backdropMaterial.uniforms.uPulseColour.value.set(colour).multiplyScalar(0.35);
      pulse = Math.max(pulse, Math.min(1.4, strength));
      stage.wake(1);
    },
    /* Dress the table in a theme: its sky, its light, its reflections and
       its weather. The boards redress themselves. */
    setTheme(theme) {
      const { backdrop, light } = theme;
      const u = backdropMaterial.uniforms;
      u.uTop.value.set(backdrop.top);
      u.uBottom.value.set(backdrop.bottom);
      u.uBlobA.value.set(backdrop.blobA).multiplyScalar(backdrop.blobStrength);
      u.uBlobB.value.set(backdrop.blobB).multiplyScalar(backdrop.blobStrength);
      u.uMotif.value = theme.motif;
      glowBase.set(backdrop.glow).multiplyScalar(backdrop.glowStrength);
      breathe = backdrop.breathe || 0;
      hemisphere.color.set(light.sky);
      hemisphere.groundColor.set(light.ground);
      key.color.set(light.key);
      rimAccent.set(theme.accent);
      rimSecondary.set(theme.secondary);
      environment?.dispose();
      environment = studioEnvironment(renderer, theme.accent, theme.secondary);
      scene.environment = environment;
      for (const item of weather) item.dispose();
      weather.length = 0;
      weather.push(bokeh(theme.bokeh));
      for (const spec of theme.ambient) weather.push(spec.kind === 'sparks' ? sparkShower(spec) : pointsCloud(spec));
      stage.wake(1);
    },
    start() {
      if (running) return;
      running = true;
      last = performance.now();
      previousActive = false; slowFrames = 0;
      stage.wake(1);
      // A frame queued before a stop would otherwise run alongside this one.
      cancelAnimationFrame(pendingFrame);
      pendingFrame = requestAnimationFrame(frame);
    },
    stop() { running = false; cancelAnimationFrame(pendingFrame); },
  };

  window.addEventListener('resize', () => { resize(); stage.wake(1); });
  window.visualViewport?.addEventListener('resize', () => { resize(); stage.wake(1); });
  const controlsObserver = new ResizeObserver(() => { resize(); stage.wake(1); });
  for (const panel of document.querySelectorAll('.hud-top, .hud-bottom')) controlsObserver.observe(panel);
  // A lost context (a tab in the background too long, a driver reset)
  // comes back by itself; three re-uploads what it needs.
  canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); stage.stop(); });
  canvas.addEventListener('webglcontextrestored', () => { stage.start(); stage.wake(1); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stage.stop(); else stage.start(); });
  resize();
  stage.setTheme(theme);
  rig.distance = rig.target.distance * 1.6;
  return stage;
}
