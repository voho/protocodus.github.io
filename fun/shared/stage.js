/* A lit table for a small puzzle: renderer, camera, lights, reflections,
   backdrop, bloom and the frame loop, shared by Zipper and Patcher. A
   board adds its own meshes to `scene` and asks the stage to frame them. */
import * as THREE from 'three';
import { createBloom, canRenderHalfFloat } from './bloom.js';

const BACKDROP_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy * 2.0, 1.0, 1.0);
}`;

/* A vertical gradient with a soft pool of light behind the board, two
   slow drifting pools of colour that never stop (an aurora, at a crawl),
   a pulse of light where the last move landed, and darker corners. It
   hangs in front of the camera, so it is screen space. */
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
   soft light overhead, a cool and a warm panel at the sides and a strip in
   the accent behind, so glossy tops pick up believable highlights. */
function studioEnvironment(renderer, accent) {
  const room = new THREE.Scene();
  const add = (geometry, colour, intensity, position, rotation, side = THREE.DoubleSide) => {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(colour).multiplyScalar(intensity), side });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    room.add(mesh);
  };
  add(new THREE.BoxGeometry(24, 24, 24), '#0a0c10', 1, [0, 0, 0], [0, 0, 0], THREE.BackSide);
  add(new THREE.PlaneGeometry(7, 3), '#ffffff', 9, [0, 11.9, 1], [Math.PI / 2, 0, 0]);
  add(new THREE.PlaneGeometry(4, 9), '#cfe0ff', 3, [-11.9, 2, 0], [0, Math.PI / 2, 0]);
  add(new THREE.PlaneGeometry(4, 9), '#ffe2c4', 2, [11.9, 2, -3], [0, -Math.PI / 2, 0]);
  add(new THREE.PlaneGeometry(14, 1.2), accent, 4, [0, 5, -11.9], [0, 0, 0]);
  // Two coloured panels low at the sides: the gloss on the tiles and the
  // candy patches picks up a pink and a blue glint, as a sweet would.
  add(new THREE.PlaneGeometry(6, 2), '#ff7fb3', 2.5, [-8, -2, 9], [0, Math.PI * 0.8, 0]);
  add(new THREE.PlaneGeometry(6, 2), '#7fb8ff', 2.5, [8, -1, 9], [0, -Math.PI * 0.8, 0]);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(room, 0.04).texture;
  pmrem.dispose();
  room.traverse((object) => { object.geometry?.dispose(); object.material?.dispose(); });
  return texture;
}

/* A soft round dot for the drifting dust. */
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
export function createStage(canvas, { accent = '#87D7BE', secondary = '#f6d155', backdrop = {}, exposure = 1.1, elevation = 0.98 } = {}) {
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
  const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 160);
  scene.add(camera);

  const backdropMaterial = new THREE.ShaderMaterial({
    vertexShader: BACKDROP_VERTEX, fragmentShader: BACKDROP_FRAGMENT,
    uniforms: {
      uTop: { value: new THREE.Color(backdrop.top || '#10202b') },
      uBottom: { value: new THREE.Color(backdrop.bottom || '#05080c') },
      uGlow: { value: new THREE.Color(backdrop.glow || accent).multiplyScalar(backdrop.glowStrength ?? 0.12) },
      uBlobA: { value: new THREE.Color(backdrop.blobA || accent).multiplyScalar(backdrop.blobStrength ?? 0.07) },
      uBlobB: { value: new THREE.Color(backdrop.blobB || secondary).multiplyScalar(backdrop.blobStrength ?? 0.07) },
      uPulseColour: { value: new THREE.Color(accent) },
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

  scene.environment = studioEnvironment(renderer, accent);
  scene.environmentIntensity = 0.7;

  scene.add(new THREE.HemisphereLight('#9fc3d8', '#0a0d12', 0.5));
  const key = new THREE.DirectionalLight('#fff3e2', 2.6);
  key.position.set(-5, 11, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 40;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(accent, 1.5);
  rim.position.set(4, 5, -8);
  scene.add(rim);
  const rimAccent = new THREE.Color(accent), rimSecondary = new THREE.Color(secondary);
  const flashLight = new THREE.PointLight('#ffffff', 0, 14, 1.4);
  flashLight.position.set(0, 2.5, 0);
  scene.add(flashLight);

  // The board floats; its shadow lands on an invisible floor below.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: 0.4 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1;
  floor.receiveShadow = true;
  scene.add(floor);

  const bloom = hdr ? createBloom({ strength: 0.42, threshold: 1, knee: 0.5, spread: 1.15, levels: mobile ? 4 : 5 }) : null;
  renderer.setEffects(bloom ? [bloom] : []);

  // The camera approaches the table at its fixed resting angle.
  const rig = {
    azimuth: 0, elevation, distance: 40,
    target: { azimuth: 0, elevation, distance: 12 },
    base: elevation, center: new THREE.Vector3(),
  };
  const pointer = { x: 0, y: 0 };
  let halfW = 3, halfD = 3, width = 1, height = 1;
  const listeners = new Set();
  const atmosphere = [];
  let running = false, last = 0, time = 0, flash = 0;
  let pendingFrame = 0;
  // A move lands: a pulse of light in the backdrop and a nudge of the camera.
  let pulse = 0, kick = 0;
  /* The table is still most of the time. While nothing moves it is drawn
     a few times a second (the dust and the sway drift on), and every
     change wakes it up to the full frame rate for a moment. */
  let activeUntil = 0;
  let lastDraw = 0;
  const idleGap = reduced ? 1000 : (mobile ? 1 / 15 : 1 / 24) * 1000;
  let slowFrames = 0, qualityCooldown = 0, previousActive = false;

  /* Whether the board's corners all land inside `limits` (in clip space)
     from `distance` away at the resting angle. */
  const fitCamera = new THREE.PerspectiveCamera();
  const corner = new THREE.Vector3();
  function fits(distance, limits) {
    fitCamera.fov = camera.fov; fitCamera.aspect = camera.aspect; fitCamera.near = camera.near; fitCamera.far = camera.far;
    if (camera.view?.enabled) fitCamera.setViewOffset(width, height, 0, camera.view.offsetY, width, height);
    else fitCamera.updateProjectionMatrix();
    fitCamera.position.set(rig.center.x, rig.center.y + Math.sin(rig.base) * distance, rig.center.z + Math.cos(rig.base) * distance);
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
    const topBar = document.querySelector('.hud-top')?.getBoundingClientRect().bottom ?? 80;
    const bottomTop = document.querySelector('.hud-bottom')?.getBoundingClientRect().top ?? height - 90;
    // Shift the optical centre into the free space between the controls.
    // A centered frustum wastes much of a phone's asymmetric play area.
    const centreY = (topBar + bottomTop) / 2;
    camera.setViewOffset(width, height, 0, height / 2 - centreY, width, height);
    const limits = { x: 0.92, top: 1 - 2 * (topBar + pad) / height, bottom: 2 * (bottomTop - pad) / height - 1 };
    let near = 2, far = 90;
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
    refit();
    rig.distance = rig.target.distance;
  }

  function frame(now) {
    if (!running) return;
    pendingFrame = requestAnimationFrame(frame);
    // The tiny pointer response can finish settling at the idle frame rate.
    const settled = Math.abs(rig.target.distance - rig.distance) < 0.003
      && Math.abs(rig.target.azimuth - rig.azimuth) < 0.003 && Math.abs(rig.target.elevation - rig.elevation) < 0.003;
    const active = now < activeUntil || !settled || flash > 0 || pulse > 0 || kick > 0.001;
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
    const k = 1 - Math.exp(-dt * 5);
    const parallax = reduced ? 0 : 1;
    // A small response to pointer motion always settles back to the same
    // orientation, including after a solve or a change of puzzle.
    const settle = Math.exp(-dt * 3);
    pointer.x *= settle;
    pointer.y *= settle;
    rig.target.azimuth = pointer.x * 0.018 * parallax;
    rig.target.elevation = rig.base - pointer.y * 0.012 * parallax;
    rig.azimuth += (rig.target.azimuth - rig.azimuth) * k;
    rig.elevation += (rig.target.elevation - rig.elevation) * k;
    rig.distance += (rig.target.distance - rig.distance) * k;
    kick *= Math.exp(-dt * 7);
    const distance = rig.distance * (1 - kick * 0.02);
    const flat = Math.cos(rig.elevation) * distance;
    camera.position.set(
      rig.center.x + Math.sin(rig.azimuth) * flat,
      rig.center.y + Math.sin(rig.elevation) * distance,
      rig.center.z + Math.cos(rig.azimuth) * flat);
    camera.lookAt(rig.center);
    flash = Math.max(0, flash - dt * 2.2);
    flashLight.intensity = flash * flash * 60;
    pulse = Math.max(0, pulse - dt * 1.8);
    backdropMaterial.uniforms.uPulse.value = pulse * pulse;
    backdropMaterial.uniforms.uTime.value = reduced ? 0 : time;
    // The rim light wanders between the two accents, so highlights never sit still.
    rim.color.copy(rimAccent).lerp(rimSecondary, 0.5 + 0.5 * Math.sin(time * 0.23));
    for (const listener of listeners) listener(dt, time);
    renderer.render(scene, camera);
  }

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();

  const stage = {
    renderer, scene, camera, key, rim, hdr, reduced,
    setTheme(theme) {
      const uniforms = backdropMaterial.uniforms;
      uniforms.uTop.value.set(theme.top);
      uniforms.uBottom.value.set(theme.bottom);
      uniforms.uGlow.value.set(theme.accent).multiplyScalar(0.035);
      uniforms.uBlobA.value.set(theme.accent).multiplyScalar(0.04);
      uniforms.uBlobB.value.set(theme.secondary).multiplyScalar(0.035);
      uniforms.uMotif.value = theme.motif;
      rimAccent.set(theme.accent); rimSecondary.set(theme.secondary);
      for (const { geometry, material, vertex } of atmosphere) {
        if (!vertex) material.color.set(theme.accent);
        else {
          const colours = geometry.attributes.color;
          const tint = new THREE.Color();
          for (let i = 0; i < colours.count; i++) {
            tint.set(theme.palette[i % theme.palette.length]);
            colours.setXYZ(i, tint.r, tint.g, tint.b);
          }
          colours.needsUpdate = true;
        }
      }
      stage.wake(1);
    },
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
    /* The camera leans in a touch and springs back: the weight of a move. */
    kick(amount = 1) { if (!reduced) kick = Math.max(kick, amount); stage.wake(1); },
    /* Big soft discs of colour drifting behind and around the board,
       slowly, forever. */
    bokeh({ count = 36, colours = [accent, secondary, '#ffffff'], extent = 8, depth = 12 } = {}) {
      const layers = [];
      for (const [size, share, speed] of [[0.9, 0.45, 0.04], [0.45, 0.55, 0.07]]) {
        const n = Math.max(4, Math.round(count * share * (mobile ? 0.5 : 1)));
        const positions = new Float32Array(n * 3), colourData = new Float32Array(n * 3);
        const tint = new THREE.Color();
        for (let i = 0; i < n; i++) {
          // Well behind the far edge of any board, so the depth test keeps
          // them off the tiles and they only show around the board.
          positions[i * 3] = (Math.random() * 2 - 1) * extent;
          positions[i * 3 + 1] = Math.random() * 7 - 1.5;
          positions[i * 3 + 2] = -6 - Math.random() * depth;
          tint.set(colours[i % colours.length]);
          colourData.set([tint.r, tint.g, tint.b], i * 3);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colourData, 3));
        const material = new THREE.PointsMaterial({
          size, map: dotTexture(), vertexColors: true, transparent: true, opacity: 0.18,
          blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
        });
        const points = new THREE.Points(geometry, material);
        points.frustumCulled = false;
        scene.add(points);
        atmosphere.push({ geometry, material, vertex: true });
        const phase = Float32Array.from({ length: n }, () => Math.random() * Math.PI * 2);
        stage.onFrame((dt, t) => {
          if (reduced) return;
          const p = geometry.attributes.position.array;
          for (let i = 0; i < n; i++) {
            p[i * 3 + 1] += dt * speed;
            p[i * 3] += Math.sin(t * 0.2 + phase[i]) * dt * 0.08;
            if (p[i * 3 + 1] > 5.5) p[i * 3 + 1] = -1.5;
          }
          geometry.attributes.position.needsUpdate = true;
        });
        layers.push(points);
      }
      return layers;
    },
    /* Drifting specks in the air over the table, for depth. */
    dust({ count = 150, colour = accent, extent = 5, top = 4 } = {}) {
      count = Math.round(count * (mobile ? 0.5 : 1));
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() * 2 - 1) * extent;
        positions[i * 3 + 1] = Math.random() * top;
        positions[i * 3 + 2] = (Math.random() * 2 - 1) * extent;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        size: 0.07, map: dotTexture(), color: colour, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
      });
      const points = new THREE.Points(geometry, material);
      points.frustumCulled = false;
      scene.add(points);
      atmosphere.push({ geometry, material, vertex: false });
      const phase = Float32Array.from({ length: count }, () => Math.random() * Math.PI * 2);
      stage.onFrame((dt, t) => {
        if (reduced) return;
        const p = geometry.attributes.position.array;
        for (let i = 0; i < count; i++) {
          p[i * 3 + 1] += dt * 0.08;
          p[i * 3] += Math.sin(t * 0.4 + phase[i]) * dt * 0.05;
          if (p[i * 3 + 1] > top) p[i * 3 + 1] = 0;
        }
        geometry.attributes.position.needsUpdate = true;
      });
      return points;
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

  window.addEventListener('pointermove', (event) => {
    // A pressed button is a drag on the board: the view holds still for it.
    if (event.pointerType !== 'mouse' || event.buttons) return;
    pointer.x = (event.clientX / width) * 2 - 1;
    pointer.y = (event.clientY / height) * 2 - 1;
    stage.wake(0.5);
  });
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
  return stage;
}
