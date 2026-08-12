import * as THREE from 'three';
import {
  LOCATIONS,
  clamp,
  eclipseStateAt,
  formatClock,
  phaseAt,
} from './model.mjs';

let prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (event) => {
  prefersReducedMotion = event.matches;
  if (event.matches) state.playing = false;
});
const canvas = document.querySelector('#stage');
const loadingScreen = document.querySelector('.loading-screen');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
} catch {
  document.body.classList.add('no-webgl');
  loadingScreen.querySelector('.loading-orbit')?.remove();
  loadingScreen.querySelector('p').textContent = 'Tento 3D model potřebuje WebGL. Zapněte hardwarovou akceleraci nebo jej otevřete v novějším prohlížeči.';
  throw new Error('WebGL se nepodařilo spustit');
}

renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x090c17);
const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 300);
const cameraTarget = new THREE.Vector3();
const desiredCamera = new THREE.Vector3();
const desiredTarget = new THREE.Vector3();
let lastFrameTime = performance.now();

const SUN_X = -36;
const EARTH_X = 26;
const MOON_X = 18.8;
const SUN_RADIUS = 5.8;
const EARTH_RADIUS = 3.2;
const MOON_RADIUS = 0.88;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const tempVector = new THREE.Vector3();
const tempVector2 = new THREE.Vector3();
const tempColor = new THREE.Color();

const state = {
  location: LOCATIONS.prague,
  progress: 0,
  playing: !prefersReducedMotion,
  speedIndex: 0,
  speedOptions: [1, 2, 4],
  automaticCamera: true,
  manualView: 'system',
  effectiveView: 'system',
  trueSizes: false,
  lastChapter: -1,
  layers: { labels: true, rays: true, shadows: true, orbit: true },
  elapsed: 0,
  loopHold: 0,
  dialogWasPlaying: false,
  orbit: { active: false, theta: 0, phi: Math.PI / 2.2, distance: 45 },
};

function seededRandom(seed = 20260812) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

function makeCanvasTexture(width, height, paint) {
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = width;
  textureCanvas.height = height;
  const context = textureCanvas.getContext('2d');
  paint(context, width, height);
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

function makeGlowTexture() {
  return makeCanvasTexture(256, 256, (context, width) => {
    const gradient = context.createRadialGradient(width / 2, width / 2, 8, width / 2, width / 2, width / 2);
    gradient.addColorStop(0, 'rgba(255,255,230,1)');
    gradient.addColorStop(0.16, 'rgba(255,196,50,.82)');
    gradient.addColorStop(0.42, 'rgba(255,142,20,.23)');
    gradient.addColorStop(1, 'rgba(255,120,0,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, width);
  });
}

function makeSunTexture() {
  const random = seededRandom(12);
  return makeCanvasTexture(512, 256, (context, width, height) => {
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#fff4ad');
    gradient.addColorStop(0.5, '#ffbd31');
    gradient.addColorStop(1, '#ff8a1f');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    context.globalAlpha = 0.16;
    for (let i = 0; i < 180; i += 1) {
      context.fillStyle = random() > 0.55 ? '#fffbd7' : '#d95b15';
      context.beginPath();
      context.ellipse(random() * width, random() * height, 2 + random() * 14, 1 + random() * 4,
        random() * Math.PI, 0, Math.PI * 2);
      context.fill();
    }
  });
}

const glowTexture = makeGlowTexture();

function addStars() {
  const random = seededRandom();
  const positions = [];
  const colors = [];
  const cool = new THREE.Color(0x9ed4ff);
  const warm = new THREE.Color(0xffe2b1);
  for (let i = 0; i < 1100; i += 1) {
    positions.push((random() - .5) * 260, (random() - .5) * 180, -20 - random() * 110);
    const color = tempColor.copy(cool).lerp(warm, random());
    colors.push(color.r, color.g, color.b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: .18,
    sizeAttenuation: true,
    transparent: true,
    opacity: .72,
    vertexColors: true,
    depthWrite: false,
  });
  const stars = new THREE.Points(geometry, material);
  scene.add(stars);
  return stars;
}

const stars = addStars();
scene.add(new THREE.HemisphereLight(0xaecfff, 0x07101e, 1.15));
const sunlight = new THREE.DirectionalLight(0xfff1c4, 3.8);
sunlight.position.set(SUN_X, 7, 5);
scene.add(sunlight);

const systemRoot = new THREE.Group();
scene.add(systemRoot);

const sunVisual = new THREE.Group();
sunVisual.position.set(SUN_X, 0, 0);
systemRoot.add(sunVisual);

const sunMesh = new THREE.Mesh(
  new THREE.SphereGeometry(SUN_RADIUS, 56, 32),
  new THREE.MeshBasicMaterial({ map: makeSunTexture(), color: 0xffd36a }),
);
sunVisual.add(sunMesh);

const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: glowTexture,
  color: 0xffb52d,
  transparent: true,
  opacity: .78,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
}));
sunGlow.scale.setScalar(18);
sunVisual.add(sunGlow);

const earthVisual = new THREE.Group();
earthVisual.position.set(EARTH_X, 0, 0);
systemRoot.add(earthVisual);

const earthMesh = new THREE.Mesh(
  new THREE.SphereGeometry(EARTH_RADIUS, 56, 36),
  new THREE.MeshPhysicalMaterial({
    color: 0x126a9f,
    roughness: .52,
    metalness: 0,
    clearcoat: .22,
    clearcoatRoughness: .68,
  }),
);
earthMesh.rotation.y = -1.8;
earthMesh.rotation.z = -0.12;
earthVisual.add(earthMesh);

const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(EARTH_RADIUS * 1.035, 48, 28),
  new THREE.MeshBasicMaterial({
    color: 0x4aaeff,
    transparent: true,
    opacity: .14,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }),
);
earthVisual.add(atmosphere);

function createGlobeGrid() {
  const grid = new THREE.Group();
  const material = new THREE.LineBasicMaterial({ color: 0x8fdcff, transparent: true, opacity: .075 });
  for (let latitude = -60; latitude <= 60; latitude += 30) {
    const lat = THREE.MathUtils.degToRad(latitude);
    const radius = EARTH_RADIUS * Math.cos(lat) * 1.007;
    const y = EARTH_RADIUS * Math.sin(lat);
    const points = Array.from({ length: 65 }, (_, index) => {
      const angle = index / 64 * Math.PI * 2;
      return new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
    });
    grid.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));
  }
  for (let longitude = 0; longitude < 180; longitude += 30) {
    const lon = THREE.MathUtils.degToRad(longitude);
    const points = Array.from({ length: 65 }, (_, index) => {
      const angle = index / 64 * Math.PI * 2;
      return new THREE.Vector3(
        Math.cos(angle) * Math.cos(lon) * EARTH_RADIUS * 1.007,
        Math.sin(angle) * EARTH_RADIUS * 1.007,
        Math.cos(angle) * Math.sin(lon) * EARTH_RADIUS * 1.007,
      );
    });
    grid.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));
  }
  return grid;
}

const globeGrid = createGlobeGrid();
earthVisual.add(globeGrid);

function surfacePoint(y, z, radius = EARTH_RADIUS * 1.008) {
  return new THREE.Vector3(-Math.sqrt(Math.max(.01, radius ** 2 - y ** 2 - z ** 2)), y, z);
}

const pathCurve = new THREE.CatmullRomCurve3([
  surfacePoint(2.82, -.75),
  surfacePoint(2.68, -.2),
  surfacePoint(2.46, .35),
  surfacePoint(2.2, .78),
  surfacePoint(1.94, 1.16),
]);
const eclipsePath = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints(pathCurve.getPoints(90)),
  new THREE.LineBasicMaterial({ color: 0xffb648, transparent: true, opacity: .9 }),
);
earthVisual.add(eclipsePath);

const shadowSkin = new THREE.Mesh(
  new THREE.SphereGeometry(EARTH_RADIUS * 1.002, 96, 64),
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      moonCenter: { value: new THREE.Vector3() },
      moonRadius: { value: MOON_RADIUS },
      sunCenter: { value: new THREE.Vector3(SUN_X, 0, 0) },
      sunRadius: { value: SUN_RADIUS },
    },
    vertexShader: `
      varying vec3 vWorld;
      varying vec3 vWorldNormal;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 moonCenter;
      uniform float moonRadius;
      uniform vec3 sunCenter;
      uniform float sunRadius;
      varying vec3 vWorld;
      varying vec3 vWorldNormal;

      float discOverlap(float d, float sunAngle, float moonAngle) {
        float total = sunAngle + moonAngle;
        if (d >= total) return 0.0;
        float difference = abs(sunAngle - moonAngle);
        float smaller = min(sunAngle, moonAngle);
        if (d <= difference) return (smaller * smaller) / (sunAngle * sunAngle);
        float a = acos(clamp((d * d + sunAngle * sunAngle - moonAngle * moonAngle) / (2.0 * d * sunAngle), -1.0, 1.0));
        float b = acos(clamp((d * d + moonAngle * moonAngle - sunAngle * sunAngle) / (2.0 * d * moonAngle), -1.0, 1.0));
        float lens = 0.5 * sqrt(max(0.0,
          (-d + total) * (d + sunAngle - moonAngle) * (d - sunAngle + moonAngle) * (d + total)));
        return clamp((sunAngle * sunAngle * a + moonAngle * moonAngle * b - lens)
          / (3.14159265 * sunAngle * sunAngle), 0.0, 1.0);
      }

      void main() {
        vec3 toSun = sunCenter - vWorld;
        vec3 toMoon = moonCenter - vWorld;
        float sunDistance = length(toSun);
        float moonDistance = length(toMoon);
        float sunAngle = asin(clamp(sunRadius / sunDistance, 0.0, 1.0));
        float moonAngle = asin(clamp(moonRadius / moonDistance, 0.0, 1.0));
        float separation = acos(clamp(dot(toSun / sunDistance, toMoon / moonDistance), -1.0, 1.0));
        float covered = discOverlap(separation, sunAngle, moonAngle);
        float daylight = smoothstep(-0.1, 0.25, dot(vWorldNormal, toSun / sunDistance));
        gl_FragColor = vec4(0.0, 0.0, 0.0, covered * 0.85 * daylight);
      }
    `,
  }),
);
earthVisual.add(shadowSkin);

const locationMarker = new THREE.Group();
const markerDot = new THREE.Mesh(
  new THREE.SphereGeometry(.095, 16, 10),
  new THREE.MeshBasicMaterial({ color: 0xff8a70 }),
);
const markerRing = new THREE.Mesh(
  new THREE.RingGeometry(.18, .22, 32),
  new THREE.MeshBasicMaterial({ color: 0xff8a70, transparent: true, opacity: .75, side: THREE.DoubleSide, depthWrite: false }),
);
locationMarker.add(markerDot, markerRing);
earthVisual.add(locationMarker);

const earthLocator = new THREE.Mesh(
  new THREE.RingGeometry(.72, .76, 48),
  new THREE.MeshBasicMaterial({ color: 0xff8a70, transparent: true, opacity: .8, side: THREE.DoubleSide, depthTest: false }),
);
earthLocator.position.copy(earthVisual.position);
earthLocator.visible = false;
systemRoot.add(earthLocator);

const moonVisual = new THREE.Group();
systemRoot.add(moonVisual);
const moonMesh = new THREE.Mesh(
  new THREE.SphereGeometry(MOON_RADIUS, 64, 40),
  new THREE.MeshPhysicalMaterial({
    color: 0x8f959e,
    roughness: .58,
    metalness: 0,
    clearcoat: .18,
    clearcoatRoughness: .7,
  }),
);
moonVisual.add(moonMesh);

const moonHalo = new THREE.Mesh(
  new THREE.RingGeometry(1.08, 1.12, 48),
  new THREE.MeshBasicMaterial({ color: 0xff8a70, transparent: true, opacity: .45, side: THREE.DoubleSide, depthWrite: false }),
);
moonHalo.visible = false;
moonVisual.add(moonHalo);

const orbitRig = new THREE.Group();
orbitRig.position.set(EARTH_X, 0, 0);
systemRoot.add(orbitRig);
const ORBIT_HOME = new THREE.Vector3(-1, 0, 0);

const orbitPoints = Array.from({ length: 129 }, (_, index) => {
  const angle = index / 128 * Math.PI * 2;
  const tilt = THREE.MathUtils.degToRad(5.1);
  return new THREE.Vector3(
    Math.cos(angle) * 7.2,
    Math.sin(angle) * Math.sin(tilt) * 7.2,
    Math.sin(angle) * Math.cos(tilt) * 7.2,
  );
});
const moonOrbit = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints(orbitPoints),
  new THREE.LineDashedMaterial({ color: 0xff8a70, transparent: true, opacity: .55, dashSize: .28, gapSize: .2 }),
);
moonOrbit.computeLineDistances();
orbitRig.add(moonOrbit);

const orbitPlane = new THREE.Mesh(
  new THREE.RingGeometry(7.05, 7.12, 96),
  new THREE.MeshBasicMaterial({ color: 0xff8a70, transparent: true, opacity: .055, side: THREE.DoubleSide, depthWrite: false }),
);
orbitPlane.rotation.x = Math.PI / 2 - THREE.MathUtils.degToRad(5.1);
orbitRig.add(orbitPlane);

function createShadowCone(opacity) {
  return new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 1, 48, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }),
  );
}

function setConeRadii(mesh, radiusAtMoon, radiusAtEarth) {
  const fitted = mesh.userData;
  if (Math.abs((fitted.near ?? -1) - radiusAtMoon) < 0.01
    && Math.abs((fitted.far ?? -1) - radiusAtEarth) < 0.01) return;
  fitted.near = radiusAtMoon;
  fitted.far = radiusAtEarth;
  mesh.geometry.dispose();
  mesh.geometry = new THREE.CylinderGeometry(radiusAtEarth, radiusAtMoon, 1, 48, 1, true);
}

const shadowCones = new THREE.Group();
const penumbraCone = createShadowCone(.12);
const umbraCone = createShadowCone(.5);
shadowCones.add(penumbraCone, umbraCone);
systemRoot.add(shadowCones);

const rayPositions = new Float32Array(8 * 3);
const lightRaysGeometry = new THREE.BufferGeometry();
lightRaysGeometry.setAttribute('position', new THREE.BufferAttribute(rayPositions, 3));
const lightRays = new THREE.LineSegments(
  lightRaysGeometry,
  new THREE.LineBasicMaterial({ color: 0xffdda0, transparent: true, opacity: .34 }),
);
systemRoot.add(lightRays);

const observerRoot = new THREE.Group();
observerRoot.visible = false;
scene.add(observerRoot);

const skyTexture = makeCanvasTexture(64, 512, (context, width, height) => {
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#071426');
  gradient.addColorStop(.58, '#334768');
  gradient.addColorStop(.82, '#c35c38');
  gradient.addColorStop(1, '#f0a34f');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
});
const skyMaterial = new THREE.MeshBasicMaterial({ map: skyTexture, color: 0xffffff, depthWrite: false });
const sky = new THREE.Mesh(new THREE.PlaneGeometry(150, 85), skyMaterial);
sky.position.set(0, 5, -52);
observerRoot.add(sky);

const observerStarPositions = [];
const observerRandom = seededRandom(99);
for (let i = 0; i < 150; i += 1) {
  observerStarPositions.push((observerRandom() - .5) * 105, observerRandom() * 45, -48);
}
const observerStarGeometry = new THREE.BufferGeometry();
observerStarGeometry.setAttribute('position', new THREE.Float32BufferAttribute(observerStarPositions, 3));
const observerStarMaterial = new THREE.PointsMaterial({ color: 0xe7f3ff, size: .11, transparent: true, opacity: 0, depthWrite: false });
const observerStars = new THREE.Points(observerStarGeometry, observerStarMaterial);
observerRoot.add(observerStars);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(150, 19),
  new THREE.MeshBasicMaterial({ color: 0x070910 }),
);
ground.position.set(0, -14.6, -29);
observerRoot.add(ground);
const horizonGlow = new THREE.Mesh(
  new THREE.PlaneGeometry(150, .12),
  new THREE.MeshBasicMaterial({ color: 0xffb35b, transparent: true, opacity: .38 }),
);
horizonGlow.position.set(0, -5.1, -30);
observerRoot.add(horizonGlow);

const skySun = new THREE.Group();
const skySunMesh = new THREE.Mesh(
  new THREE.SphereGeometry(3, 48, 28),
  new THREE.MeshBasicMaterial({ map: makeSunTexture(), color: 0xffd57a }),
);
const skySunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: glowTexture,
  color: 0xffaa32,
  transparent: true,
  opacity: .8,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
}));
skySunGlow.scale.setScalar(12.8);
skySun.add(skySunGlow, skySunMesh);
skySun.position.z = -40;
observerRoot.add(skySun);

const skyMoon = new THREE.Mesh(
  new THREE.SphereGeometry(3, 48, 28),
  new THREE.MeshBasicMaterial({ color: 0x02040a }),
);
skyMoon.position.z = -39.2;
observerRoot.add(skyMoon);

const corona = new THREE.Sprite(new THREE.SpriteMaterial({
  map: glowTexture,
  color: 0xe4efff,
  transparent: true,
  opacity: 0,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
}));
corona.scale.setScalar(17);
corona.position.z = -40.2;
observerRoot.add(corona);

function alignBetween(mesh, start, end) {
  const direction = tempVector.subVectors(end, start);
  const length = direction.length();
  mesh.position.copy(start).add(end).multiplyScalar(.5);
  mesh.quaternion.setFromUnitVectors(Y_AXIS, direction.normalize());
  mesh.scale.set(1, length, 1);
}

function orientOnSphere(group, point) {
  group.position.copy(point).multiplyScalar(1.004);
  group.quaternion.setFromUnitVectors(Z_AXIS, tempVector.copy(point).normalize());
}

function updateLightRays(moonPosition, shadowPoint) {
  const axes = [
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, -1, 0),
  ];
  const sunPosition = sunVisual.position;
  let cursor = 0;
  axes.forEach((axis) => {
    const from = sunPosition.clone().addScaledVector(axis, SUN_RADIUS);
    const sameMoonLimb = moonPosition.clone().addScaledVector(axis, MOON_RADIUS);
    const oppositeMoonLimb = moonPosition.clone().addScaledVector(axis, -MOON_RADIUS);
    const extendToEarth = (through) => {
      const amount = (shadowPoint.x - from.x) / Math.max(.001, through.x - from.x);
      return from.clone().lerp(through, amount);
    };
    [from, extendToEarth(sameMoonLimb), from, extendToEarth(oppositeMoonLimb)].forEach((point) => {
      rayPositions[cursor] = point.x;
      rayPositions[cursor + 1] = point.y;
      rayPositions[cursor + 2] = point.z;
      cursor += 3;
    });
  });
  lightRaysGeometry.attributes.position.needsUpdate = true;
}

function updateLocationMarker() {
  if (state.location.kind === 'total') {
    const maxProgress = (state.location.maximum - state.location.start)
      / (state.location.end - state.location.start);
    const maximumState = eclipseStateAt(state.location, maxProgress);
    orientOnSphere(locationMarker, pathCurve.getPoint(globalPathProgress(maximumState)));
  } else {
    const [y, z] = state.location.marker;
    orientOnSphere(locationMarker, surfacePoint(y, z));
  }
  const coverage = (Math.round(state.location.maxCoverage * 1000) / 10).toLocaleString('cs-CZ');
  document.querySelector('[data-world-label="place"]').innerHTML = `${state.location.name} <i>Zakryto ${coverage} %</i>`;
}

function globalPathProgress(eclipseState) {
  const utcMinutes = eclipseState.minutes - state.location.utcOffset * 60;
  return clamp((utcMinutes - (17 * 60 + 2)) / 90);
}

function updateSystem(eclipseState, delta) {
  const scaleEase = prefersReducedMotion ? 1 : 1 - Math.exp(-delta * 5);
  const earthScale = state.trueSizes ? .0167 : 1;
  const moonScale = state.trueSizes ? .0165 : 1;
  earthVisual.scale.lerp(new THREE.Vector3(earthScale, earthScale, earthScale), scaleEase);
  moonVisual.scale.lerp(new THREE.Vector3(moonScale, moonScale, moonScale), scaleEase);
  moonHalo.scale.setScalar(state.trueSizes ? 1 / Math.max(.0165, moonVisual.scale.x) : 1);

  const pathPoint = pathCurve.getPoint(globalPathProgress(eclipseState));
  const shadowWorld = pathPoint.clone().multiplyScalar(earthVisual.scale.x).add(earthVisual.position);
  const rayAmount = (MOON_X - SUN_X) / Math.max(1, shadowWorld.x - SUN_X);
  const moonPosition = new THREE.Vector3(
    MOON_X,
    shadowWorld.y * rayAmount,
    shadowWorld.z * rayAmount,
  );
  moonVisual.position.copy(moonPosition);
  moonVisual.lookAt(camera.position);
  orbitRig.quaternion.setFromUnitVectors(
    ORBIT_HOME,
    tempVector2.copy(moonPosition).sub(earthVisual.position).normalize(),
  );

  const sunDistance = moonPosition.distanceTo(sunVisual.position);
  const shadowLength = moonPosition.distanceTo(shadowWorld);
  const moonRadiusNow = MOON_RADIUS * moonVisual.scale.x;
  const umbraAtEarth = Math.max(.03,
    moonRadiusNow - shadowLength * (SUN_RADIUS - moonRadiusNow) / sunDistance);
  const penumbraAtEarth = moonRadiusNow + shadowLength * (SUN_RADIUS + moonRadiusNow) / sunDistance;
  setConeRadii(umbraCone, moonRadiusNow * .985, umbraAtEarth);
  setConeRadii(penumbraCone, moonRadiusNow * .985, penumbraAtEarth);
  alignBetween(penumbraCone, moonPosition, shadowWorld);
  alignBetween(umbraCone, moonPosition, shadowWorld);
  shadowSkin.material.uniforms.moonCenter.value.copy(moonPosition);
  shadowSkin.material.uniforms.moonRadius.value = moonRadiusNow;
  updateLightRays(moonPosition, shadowWorld);

  if (!prefersReducedMotion) {
    sunMesh.rotation.y += delta * .025;
    markerRing.scale.setScalar(1 + Math.sin(state.elapsed * 3) * .14);
  }
}

function updateObserver(eclipseState) {
  const p = eclipseState.progress;
  const sunX = -8 + p * 14;
  let sunY = -5.25 + clamp(eclipseState.altitude, -2, 32) * .63;
  if (state.location.endKind === 'sunset' && p > .9) {
    sunY += (-9 - sunY) * ((p - .9) / .1);
  }
  skySun.position.set(sunX, sunY, -40);

  const angle = -.38;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const projectionScale = (18 - skyMoon.position.z) / (18 - skySun.position.z);
  const dx = -eclipseState.offsetX * 3 * projectionScale;
  const dy = eclipseState.offsetY * 3 * projectionScale;
  skyMoon.scale.setScalar(state.location.moonRadius * projectionScale);
  skyMoon.position.set(
    sunX * projectionScale + dx * cos - dy * sin,
    sunY * projectionScale + dx * sin + dy * cos,
    -39.2,
  );
  corona.position.copy(skySun.position);
  corona.position.z = -40.2;

  const darkness = Math.pow(eclipseState.coverage, 2.1);
  skyMaterial.color.setRGB(1 - darkness * .48, 1 - darkness * .4, 1 - darkness * .25);
  observerStarMaterial.opacity = clamp((darkness - .48) * 1.25) * (state.location.kind === 'total' ? 1 : .45);
  skySunGlow.material.opacity = .82 - darkness * .42;
  corona.material.opacity = state.location.kind === 'total' ? clamp((eclipseState.coverage - .9995) * 2000) * .88 : 0;
  horizonGlow.material.opacity = .36 - darkness * .24;
}

const chapterViews = ['system', 'orbit', 'shadow', 'observer'];
const chapterContent = [
  {
    label: 'Seřazení',
    title: 'Tři tělesa. Jedna přímka.',
    copy: () => 'Slunce svítí, Měsíc světlo zastaví a Země zachytí jeho stín.',
    summary: () => 'Slunce, Měsíc a Země jsou seřazené. Měsíc leží mezi Sluncem a Zemí.',
  },
  {
    label: 'Sklon dráhy',
    title: 'Malý sklon mění všechno.',
    copy: () => 'Dráha Měsíce je vůči dráze Země skloněná asi o 5°. Jeho stín proto většinou Zemi mine a zatmění nenastává každý měsíc.',
    summary: () => 'Měsíc obíhá po dráze skloněné asi o pět stupňů.',
  },
  {
    label: 'Stín',
    title: 'Jeden Měsíc. Dva druhy stínu.',
    copy: (location) => location.kind === 'total'
      ? `${location.name} vstoupí do úzkého plného stínu, takže celé Slunce na chvíli zmizí.`
      : `${location.name} leží v širokém polostínu, takže Měsíc zakryje jen část Slunce.`,
    summary: (location) => location.kind === 'total'
      ? `${location.name} leží v plném stínu a uvidí úplné zatmění.`
      : `${location.name} leží v polostínu a uvidí částečné zatmění.`,
  },
  {
    label: 'Vaše obloha',
    title: 'Teď se postavte na Zemi.',
    copy: (location) => location.id === 'prague'
      ? 'V Praze bude ve 20:12 zakryto 86,3 % Slunce. Ve 20:26 pak Slunce zapadne za obzor stále částečně zakryté.'
      : location.kind === 'total'
        ? `${location.over} se den na chvíli promění v soumrak, protože Měsíc zakryje celý jasný kotouč Slunce.`
        : `${location.over} Měsíc zakryje přes 85 % Slunce, které pak zapadne ještě během zatmění.`,
    summary: (location) => `Pohled na oblohu ${location.from} ukazuje přechod Měsíce přes Slunce.`,
  },
];

const elements = {
  lesson: document.querySelector('.lesson'),
  chapterCount: document.querySelector('[data-chapter-count]'),
  chapterLabel: document.querySelector('[data-chapter-label]'),
  chapterTitle: document.querySelector('[data-chapter-title]'),
  chapterCopy: document.querySelector('[data-chapter-copy]'),
  sceneSummary: document.querySelector('[data-scene-summary]'),
  time: document.querySelector('[data-time]'),
  zone: document.querySelector('[data-zone]'),
  phase: document.querySelector('[data-phase]'),
  coverage: document.querySelector('[data-coverage]'),
  slider: document.querySelector('#eclipse-time'),
  rangeProgress: document.querySelector('[data-range-progress]'),
  maximumTick: document.querySelector('[data-maximum-tick]'),
  maximumLabel: document.querySelector('[data-maximum-label]'),
  endLabel: document.querySelector('[data-end-label]'),
  play: document.querySelector('[data-play]'),
  playIcon: document.querySelector('[data-play-icon]'),
  speed: document.querySelector('[data-speed]'),
  scale: document.querySelector('[data-scale]'),
  sceneNote: document.querySelector('[data-scene-note]'),
  labels: document.querySelector('.world-labels'),
  veil: document.querySelector('.view-veil'),
};

function currentChapter() {
  if (state.automaticCamera) {
    const maxProgress = Math.min(1,
      (state.location.maximum - state.location.start) / (state.location.end - state.location.start));
    return state.progress >= maxProgress - 0.2 ? 2 : 0;
  }
  return { system: 0, orbit: 1, shadow: 2, observer: 3 }[state.manualView] ?? 0;
}

function refreshChapter(force = false) {
  const chapter = currentChapter();
  if (!force && chapter === state.lastChapter) return;
  state.lastChapter = chapter;
  const content = chapterContent[chapter];
  elements.lesson.classList.add('is-changing');
  const update = () => {
    elements.chapterCount.textContent = `0${chapter + 1} / 04`;
    elements.chapterLabel.textContent = content.label;
    elements.chapterTitle.textContent = content.title;
    elements.chapterCopy.textContent = content.copy(state.location);
    elements.sceneSummary.textContent = content.summary(state.location);
    elements.lesson.classList.remove('is-changing');
  };
  if (prefersReducedMotion || force) update();
  else setTimeout(update, 130);
}

function setView(view, automatic = false) {
  if ((automatic || view === 'auto') && state.trueSizes) setScaleMode(false);
  state.automaticCamera = automatic || view === 'auto';
  if (!state.automaticCamera) state.manualView = view;
  state.orbit.active = false;
  document.querySelectorAll('[data-view]').forEach((button) => {
    const pressed = state.automaticCamera ? button.dataset.view === 'auto' : button.dataset.view === state.manualView;
    button.setAttribute('aria-pressed', String(pressed));
  });
  state.lastChapter = -1;
  refreshChapter(true);
}

function switchWorld(nextView) {
  const observer = nextView === 'observer';
  const wasObserver = state.effectiveView === 'observer';
  if (observer !== wasObserver) {
    elements.veil.classList.add('on');
    setTimeout(() => {
      systemRoot.visible = !observer;
      observerRoot.visible = observer;
      camera.position.copy(observer ? new THREE.Vector3(0, 0, 18) : shotFor(nextView).position);
      cameraTarget.copy(observer ? new THREE.Vector3(0, -1, -40) : shotFor(nextView).target);
      requestAnimationFrame(() => elements.veil.classList.remove('on'));
      syncLayers();
    }, prefersReducedMotion ? 0 : 150);
  }
  state.effectiveView = nextView;
}

function shotFor(view) {
  const aspect = innerWidth / innerHeight;
  const halfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  if (view === 'orbit') {
    return {
      position: new THREE.Vector3(18, 12, Math.max(29, 17 / (halfFov * aspect))),
      target: new THREE.Vector3(22, .2, 0),
    };
  }
  if (view === 'shadow') {
    return {
      position: new THREE.Vector3(11.5, 6, Math.max(19, 10 / (halfFov * aspect))),
      target: new THREE.Vector3(24.2, 1.1, .45),
    };
  }
  if (view === 'observer') {
    return {
      position: new THREE.Vector3(0, 0, 18),
      target: new THREE.Vector3(0, -1, -40),
    };
  }
  return {
    position: new THREE.Vector3(0, 13, Math.max(62, 44 / (halfFov * aspect))),
    target: new THREE.Vector3(-3.5, 0, 0),
  };
}

function updateCamera(delta) {
  const requestedView = state.automaticCamera ? chapterViews[currentChapter()] : state.manualView;
  if (requestedView !== state.effectiveView) switchWorld(requestedView);
  const shot = shotFor(requestedView);

  if (state.orbit.active && requestedView !== 'observer') {
    desiredTarget.copy(shot.target);
    desiredCamera.setFromSpherical(new THREE.Spherical(
      state.orbit.distance,
      state.orbit.phi,
      state.orbit.theta,
    )).add(desiredTarget);
  } else {
    desiredCamera.copy(shot.position);
    desiredTarget.copy(shot.target);
  }

  const amount = prefersReducedMotion ? 1 : 1 - Math.exp(-delta * 2.7);
  camera.position.lerp(desiredCamera, amount);
  cameraTarget.lerp(desiredTarget, amount);
  camera.lookAt(cameraTarget);
}

function syncTimeline(eclipseState) {
  const percent = state.progress * 100;
  const clock = formatClock(eclipseState.minutes);
  elements.time.textContent = clock;
  elements.time.dateTime = clock;
  elements.zone.textContent = state.location.zone;
  elements.phase.textContent = phaseAt(state.location, eclipseState);
  elements.coverage.textContent = `${Math.round(eclipseState.coverage * 100)} %`;
  elements.slider.value = Math.round(state.progress * 1000);
  const pct = Math.round(eclipseState.coverage * 100);
  const pctWord = pct === 1 ? 'procento' : pct >= 2 && pct <= 4 ? 'procenta' : 'procent';
  elements.slider.setAttribute('aria-valuetext', `${formatClock(eclipseState.minutes)} ${state.location.zone}, zakryto ${pct} ${pctWord} Slunce`);
  elements.rangeProgress.style.width = `${percent}%`;
  elements.maximumTick.style.display = eclipseState.maxProgress < 1 ? '' : 'none';
  elements.maximumTick.style.left = `${Math.min(eclipseState.maxProgress, 1) * 100}%`;
  elements.playIcon.textContent = state.loopHold > 0 ? '↺' : state.playing ? 'Ⅱ' : state.progress >= .999 ? '↺' : '▶︎';
  elements.play.setAttribute('aria-label', state.playing ? 'Pozastavit časosběr' : state.progress >= .999 ? 'Přehrát časosběr znovu' : 'Spustit časosběr');
}

function syncLocationUI() {
  document.querySelectorAll('[data-location-name]').forEach((node) => { node.textContent = state.location.name; });
  document.querySelectorAll('[data-sky-label]').forEach((node) => { node.textContent = state.location.name; });
  document.querySelectorAll('[data-location]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.location === state.location.id));
  });
  elements.maximumLabel.textContent = state.location.maximum >= state.location.end
    ? 'Maximum až po západu'
    : `Maximum · ${formatClock(state.location.maximum)}`;
  elements.endLabel.textContent = `${state.location.endKind === 'sunset' ? 'Západ' : 'Poslední kontakt'} · ${formatClock(state.location.end)}`;
  updateLocationMarker();
  state.lastChapter = -1;
  refreshChapter(true);
}

function syncLayers() {
  elements.labels.classList.toggle('is-hidden', !state.layers.labels);
  lightRays.visible = state.layers.rays && systemRoot.visible && !state.trueSizes;
  shadowCones.visible = state.layers.shadows && systemRoot.visible && !state.trueSizes;
  shadowSkin.visible = state.layers.shadows && !state.trueSizes;
  moonOrbit.visible = state.layers.orbit && systemRoot.visible;
  orbitPlane.visible = state.layers.orbit && systemRoot.visible;
}

function setScaleMode(trueSizes) {
  state.trueSizes = trueSizes;
  elements.scale.setAttribute('aria-pressed', String(trueSizes));
  elements.scale.textContent = trueSizes ? 'Velikosti: skutečné' : 'Velikosti: názorné';
  elements.sceneNote.textContent = trueSizes
    ? 'Skutečný poměr velikostí · vzdálenosti zůstávají zkrácené · kroužky ukazují polohu'
    : 'Názorný model · tělesa zvětšena, vzdálenosti zkráceny';
  earthLocator.visible = trueSizes;
  moonHalo.visible = trueSizes;
  if (trueSizes) setView('system');
  syncLayers();
}

function setLocation(id) {
  const location = LOCATIONS[id];
  if (!location) return;
  state.location = location;
  state.progress = 0;
  state.loopHold = 0;
  state.playing = !prefersReducedMotion;
  state.automaticCamera = true;
  setScaleMode(false);
  setView('auto', true);
  syncLocationUI();
}

function projectLabel(element, worldPosition, visible = true, offsetX = 0, offsetY = 0) {
  const projected = tempVector.copy(worldPosition).project(camera);
  const onScreen = visible && projected.z > -1 && projected.z < 1
    && Math.abs(projected.x) < 1.08 && Math.abs(projected.y) < 1.08;
  element.classList.toggle('is-visible', onScreen);
  if (!onScreen) return;
  const rawX = (projected.x * .5 + .5) * innerWidth + offsetX;
  const rawY = (-projected.y * .5 + .5) * innerHeight + offsetY;
  const halfWidth = element.offsetWidth * .5;
  const halfHeight = element.offsetHeight * .5;
  const x = clamp(rawX, halfWidth + 8, innerWidth - halfWidth - 8);
  const y = clamp(rawY, halfHeight + 8, innerHeight - halfHeight - 8);
  element.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
}

const labelElements = Object.fromEntries(
  [...document.querySelectorAll('[data-world-label]')].map((node) => [node.dataset.worldLabel, node]),
);

function updateLabels() {
  if (!state.layers.labels) return;
  camera.updateMatrixWorld();
  const compact = innerWidth <= 600;
  const observer = state.effectiveView === 'observer';
  if (observer) {
    projectLabel(labelElements.sun, skySun.position, true, compact ? -34 : -66, compact ? -24 : -34);
    projectLabel(labelElements.moon, skyMoon.position, true, compact ? 34 : 66, compact ? -16 : -22);
    projectLabel(labelElements.earth, tempVector, false);
    projectLabel(labelElements.umbra, tempVector, false);
    projectLabel(labelElements.penumbra, tempVector, false);
    projectLabel(labelElements.place, new THREE.Vector3(14, -3.7, -29), true, compact ? 20 : 36, -16);
    return;
  }
  const markerWorld = locationMarker.getWorldPosition(new THREE.Vector3());
  const shadowView = state.effectiveView === 'shadow';
  projectLabel(labelElements.sun, sunVisual.position, true, compact ? 30 : 45, 0);
  projectLabel(labelElements.moon, moonVisual.position, true, -16, compact ? -26 : -36);
  projectLabel(labelElements.earth, earthVisual.position, true, 0, compact ? 34 : 48);
  projectLabel(labelElements.umbra, umbraCone.position, shadowView && state.layers.shadows && !state.trueSizes, 0, -34);
  projectLabel(labelElements.penumbra, penumbraCone.position.clone().lerp(earthVisual.position, .4), shadowView && state.layers.shadows && !state.trueSizes, 0, 38);
  projectLabel(labelElements.place, markerWorld, !state.trueSizes, compact ? 28 : 58, -28);
}

document.querySelectorAll('[data-view]').forEach((button) => {
  button.addEventListener('click', () => {
    if (button.dataset.view === 'observer' && state.trueSizes) setScaleMode(false);
    setView(button.dataset.view, button.dataset.view === 'auto');
  });
});

elements.scale.addEventListener('click', () => setScaleMode(!state.trueSizes));

elements.play.addEventListener('click', () => {
  if (state.playing) {
    state.playing = false;
    state.loopHold = 0;
    return;
  }
  if (state.progress >= .999) state.progress = 0;
  state.playing = true;
});

elements.speed.addEventListener('click', () => {
  state.speedIndex = (state.speedIndex + 1) % state.speedOptions.length;
  elements.speed.textContent = `${state.speedOptions[state.speedIndex]}×`;
});

elements.slider.addEventListener('input', () => {
  state.progress = Number(elements.slider.value) / 1000;
  state.loopHold = 0;
  state.playing = false;
});

document.querySelectorAll('[data-open]').forEach((button) => {
  button.addEventListener('click', () => {
    const dialog = document.getElementById(button.dataset.open);
    if (dialog?.showModal) {
      state.dialogWasPlaying = state.playing;
      state.playing = false;
      dialog.showModal();
    }
  });
});

document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    if (state.dialogWasPlaying) state.playing = true;
    state.dialogWasPlaying = false;
  });
});

document.querySelectorAll('[data-location]').forEach((button) => {
  button.addEventListener('click', () => {
    setLocation(button.dataset.location);
    document.querySelector('#location-dialog').close();
  });
});

document.querySelectorAll('[data-layer]').forEach((checkbox) => {
  checkbox.addEventListener('change', () => {
    state.layers[checkbox.dataset.layer] = checkbox.checked;
    syncLayers();
  });
});

const pointers = new Map();
let pinchDistance = 0;

function beginOrbit() {
  const shot = shotFor(state.effectiveView);
  const spherical = new THREE.Spherical().setFromVector3(camera.position.clone().sub(shot.target));
  state.orbit.theta = spherical.theta;
  state.orbit.phi = spherical.phi;
  state.orbit.distance = spherical.radius;
  state.orbit.active = true;
  setView(state.effectiveView);
  state.orbit.active = true;
}

function pointerGap() {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

canvas.addEventListener('pointerdown', (event) => {
  if (state.effectiveView === 'observer') return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  canvas.setPointerCapture(event.pointerId);
  if (pointers.size === 2) pinchDistance = pointerGap();
  if (pointers.size === 1) beginOrbit();
});

canvas.addEventListener('pointermove', (event) => {
  const pointer = pointers.get(event.pointerId);
  if (!pointer || !state.orbit.active) return;
  if (pointers.size >= 2) {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    const gap = pointerGap();
    state.orbit.distance = clamp(state.orbit.distance + (pinchDistance - gap) * .12, 8, 110);
    pinchDistance = gap;
    return;
  }
  const dx = event.clientX - pointer.x;
  const dy = event.clientY - pointer.y;
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  state.orbit.theta -= dx * .006;
  state.orbit.phi = clamp(state.orbit.phi + dy * .006, .2, Math.PI - .2);
});

function releasePointer(event) {
  pointers.delete(event.pointerId);
  if (pointers.size < 2) pinchDistance = 0;
}

canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);
canvas.addEventListener('wheel', (event) => {
  if (state.effectiveView === 'observer') return;
  event.preventDefault();
  if (!state.orbit.active) beginOrbit();
  state.orbit.distance = clamp(state.orbit.distance + event.deltaY * .03, 8, 110);
}, { passive: false });

addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target.matches('input, button, a') || document.querySelector('dialog[open]')) return;
  if (event.code === 'Space') {
    event.preventDefault();
    elements.play.click();
  } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    state.progress = clamp(state.progress + (event.key === 'ArrowRight' ? .015 : -.015));
    state.playing = false;
  } else if (event.key.toLowerCase() === 'c') {
    setView('auto', true);
  } else if (event.key.toLowerCase() === 'l') {
    state.layers.labels = !state.layers.labels;
    const checkbox = document.querySelector('[data-layer="labels"]');
    checkbox.checked = state.layers.labels;
    syncLayers();
  }
});

function resize() {
  const width = innerWidth;
  const height = innerHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

addEventListener('resize', resize);
resize();

let restoreWasPlaying = false;
canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  restoreWasPlaying = state.playing;
  state.playing = false;
  document.body.classList.add('is-loading');
  document.body.classList.remove('is-ready');
  loadingScreen.querySelector('p').textContent = '3D pohled se zastavil. Znovu skládáme oblohu…';
});
canvas.addEventListener('webglcontextrestored', () => {
  state.playing = restoreWasPlaying;
  document.body.classList.add('is-ready');
  document.body.classList.remove('is-loading');
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) lastFrameTime = performance.now();
});

updateLocationMarker();
syncLocationUI();
syncLayers();
camera.position.copy(shotFor('system').position);
cameraTarget.copy(shotFor('system').target);
camera.lookAt(cameraTarget);

let firstFrame = true;
renderer.setAnimationLoop((frameTime) => {
  const rawDelta = document.hidden ? 0 : Math.min((frameTime - lastFrameTime) / 1000, .05);
  lastFrameTime = frameTime;
  const delta = rawDelta || 0;
  state.elapsed += delta;

  if (state.playing && state.loopHold > 0) {
    state.loopHold -= delta;
    if (state.loopHold <= 0) {
      state.progress = 0;
      if (state.automaticCamera) setView('auto', true);
    }
  } else if (state.playing) {
    state.progress += delta / 11.25 * state.speedOptions[state.speedIndex];
    if (state.progress >= 1) {
      state.progress = 1;
      state.loopHold = 1.6;
    }
  }

  const eclipseState = eclipseStateAt(state.location, state.progress);
  updateSystem(eclipseState, delta);
  updateObserver(eclipseState);
  updateCamera(delta);
  refreshChapter();
  syncTimeline(eclipseState);
  updateLabels();

  if (!prefersReducedMotion) {
    stars.material.opacity = .69 + Math.sin(state.elapsed * .4) * .035;
    sunGlow.material.opacity = .74 + Math.sin(state.elapsed * .8) * .04;
  }

  renderer.render(scene, camera);

  if (firstFrame) {
    firstFrame = false;
    requestAnimationFrame(() => {
      document.body.classList.add('is-ready');
      document.body.classList.remove('is-loading');
    });
  }
});
