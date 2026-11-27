import { createShotCamera } from './camera-follow.js';

// The camera and the pointer share a projection. The physics world stays the same size at every zoom.
const WIDTH = 1200,
  GROUND = 389,
  GROUND_FRACTION = GROUND / 480;
const stops = [1, 1.35, 1.8, 2.5];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const tones = {
  dawn: ['#a498ae', '#fff1cc', '#c6beb0'],
  dusk: ['#8582ac', '#f4b18f', '#a09aa0'],
  night: ['#313958', '#546981', '#434c66'],
};

export function createView(field, panorama, source, dock) {
  const painting = document.createElement('canvas');
  const ctx = painting.getContext('2d', { alpha: false });
  const display = panorama.getContext('2d', { alpha: false });
  const atmosphericSkies = new WeakMap();
  const shotCamera = createShotCamera();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let zoomFrom = null,
    zoomTime = 0;
  const minus = document.getElementById('zoom-out'),
    plus = document.getElementById('zoom-in');
  const fit = document.getElementById('zoom-fit');
  let zoom = 0,
    center = WIDTH / 2,
    lift = 0,
    view = { x: 0, y: 0, width: WIDTH, height: 480 };
  let base = view;
  let manualDuringShot = false,
    readout = 0;
  let safeTop = 0,
    safeBottom = 1,
    fitScale = 1,
    crestRise = 335;
  let phase = 'day',
    seed = 1,
    geometryDirty = true,
    artDirty = true;
  let width = 1,
    height = 1,
    screenGround = 0,
    dpr = 1;
  let needsPresent = true,
    lastPaintW = 0,
    lastPaintH = 0;
  let pointers = new Map(),
    moved = false,
    focusX = WIDTH * 0.68;

  function measure() {
    width = field.clientWidth || 1;
    height = field.clientHeight || 1;
    const topOfDock = dock.getBoundingClientRect().top;
    const bottom = Math.max(24, height - topOfDock + 18);
    const preferred = height - bottom;
    const floorY = Math.min(height * 0.81, Math.max(height * 0.48, preferred));
    const minTop = height < 510 ? 60 : 115;
    const briefing = document.querySelector('.briefing').getBoundingClientRect();
    safeTop = Math.min(height * 0.48, briefing.bottom + 12);
    safeBottom = Math.max(safeTop + 30, topOfDock - 13);
    const top = Math.max(minTop, safeTop);
    fitScale = Math.min(width / WIDTH, Math.max(0.04, (floorY - top) / crestRise));
    const scale = fitScale * stops[zoom];
    const w = width / scale,
      h = height / scale;
    const x = w >= WIDTH ? (WIDTH - w) / 2 : clamp(center - w / 2, 0, WIDTH - w);
    const changed = screenGround !== floorY;
    screenGround = floorY;
    base = { x, y: GROUND - floorY / scale - lift, width: w, height: h };
    center = x + w / 2;
    view = zoomFrom || base;
    geometryDirty = false;
    artDirty ||= changed || lastPaintW !== width || lastPaintH !== height;
    needsPresent = true;
    minus.disabled = zoom === 0;
    plus.disabled = zoom === stops.length - 1;
    readout = Math.round(stops[zoom] * 100);
    fit.textContent = readout + '%';
    field.dataset.zoomed = String(zoom > 0);
    document.documentElement.style.setProperty('--dock-top-gap', Math.max(8, height - topOfDock + 9) + 'px');
  }
  function paint() {
    const ratio = Math.min(devicePixelRatio || 1, 3840 / width, 2560 / height);
    const pixelWidth = Math.max(1, Math.round(width * ratio));
    const pixelHeight = Math.max(1, Math.round(height * ratio));
    if (painting.width !== pixelWidth) painting.width = panorama.width = pixelWidth;
    if (painting.height !== pixelHeight) painting.height = panorama.height = pixelHeight;
    ctx.setTransform(painting.width / width, 0, 0, painting.height / height, 0, 0);
    lastPaintW = width;
    lastPaintH = height;
    const gy = clamp(screenGround, 1, height - 1),
      iw = source.naturalWidth,
      ih = source.naturalHeight;
    if (!source.complete || !iw) {
      const sky = ctx.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, '#7aafb6');
      sky.addColorStop(0.68, '#a4b584');
      sky.addColorStop(1, '#534c33');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);
    } else {
      const shelf = ih * GROUND_FRACTION;
      const skyScale = Math.max(width / iw, gy / shelf);
      const cropW = width / skyScale,
        cropH = gy / skyScale;
      const centerRatio = 0.5;
      const cropX = (iw - cropW) * centerRatio;
      const sky = atmosphericSkies.get(source);
      const sx = sky ? sky.width / iw : 1;
      const sy = sky ? sky.height / shelf : 1;
      ctx.drawImage(sky || source, cropX * sx, (shelf - cropH) * sy, cropW * sx, cropH * sy, -1, -1, width + 2, gy + 2);
      const mist = {
        day: [183, 202, 208],
        dawn: [201, 190, 190],
        dusk: [170, 167, 185],
        night: [100, 129, 149],
      }[phase] || [181, 202, 199];
      const haze = ctx.createLinearGradient(0, 0, 0, gy);
      for (const [at, opacity] of [
        [0, 0.07],
        [0.34, 0.23],
        [0.64, 0.48],
        [0.86, 0.48],
        [1, 0.38],
      ]) {
        haze.addColorStop(at, 'rgba(' + mist.join(',') + ',' + opacity + ')');
      }
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, width, gy);

      ctx.drawImage(source, cropX, shelf, cropW, ih - shelf, 0, gy, width, height - gy);
    }
    const tone = tones[phase];
    if (tone) {
      ctx.globalCompositeOperation = 'multiply';
      const tint = ctx.createLinearGradient(0, 0, 0, height);
      tint.addColorStop(0, tone[0]);
      tint.addColorStop(0.62, tone[1]);
      tint.addColorStop(1, tone[2]);
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (phase === 'night' || phase === 'dusk') {
      let state = seed | 0;
      const rand = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
      };
      const count = phase === 'night' ? 70 : 14;
      for (let i = 0; i < count; i++) {
        const x = rand() * width,
          y = rand() * gy * 0.37;
        ctx.globalAlpha = (0.24 + rand() * 0.63) * (1 - y / (gy * 0.5));
        ctx.fillStyle = '#fff7db';
        ctx.beginPath();
        ctx.arc(x, y, 0.4 + rand() * 0.95, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    const edge = ctx.createLinearGradient(0, 0, 0, height);
    edge.addColorStop(0, '#06101840');
    edge.addColorStop(0.21, '#08171c00');
    edge.addColorStop(0.74, '#08171c00');
    edge.addColorStop(1, '#070b0b9e');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, width, height);
    artDirty = false;
  }
  function extendEdge(start, cropW, y, h, sky) {
    display.drawImage(painting, start, sky ? 0 : painting.height - 1, cropW, 1, 0, y, panorama.width, h);
    const shade = display.createLinearGradient(0, sky ? y + h : y, 0, sky ? y : y + h);
    shade.addColorStop(0, 'transparent');
    shade.addColorStop(1, sky ? (phase === 'night' ? '#162134' : '#445973') : '#11181a');
    display.fillStyle = shade;
    display.fillRect(0, y, panorama.width, h);
  }
  // Grade the panorama once. Camera motion projects its sky and foreground
  // shelf from that cached painting, including shots above the skyline.
  function present() {
    const iw = painting.width,
      ih = painting.height;
    const horizon = ((GROUND - view.y) / view.height) * panorama.height;
    const shelf = clamp((screenGround / height) * ih, 1, ih - 1);
    const scale = width / (view.width * fitScale);
    const cropW = iw / clamp(1 + (scale - 1) * 0.16, 1, 1.45);
    const cx = clamp((view.x + view.width / 2) / WIDTH, 0, 1);
    const start = (iw - cropW) * cx;
    const foregroundScale = iw / cropW;
    const skyHeight = shelf * foregroundScale;
    const soilHeight = (ih - shelf) * foregroundScale;
    const skyY = horizon - skyHeight;
    if (skyY > 0) extendEdge(start, cropW, 0, skyY + 1, true);
    if (horizon > 0 && skyY < ih)
      display.drawImage(painting, start, 0, cropW, shelf, 0, skyY, iw, skyHeight + 0.4);
    if (horizon < ih && horizon + soilHeight > 0)
      display.drawImage(painting, start, shelf, cropW, ih - shelf, 0, horizon, iw, soilHeight + 0.4);
    if (horizon + soilHeight < ih) {
      const y = horizon + soilHeight;
      extendEdge(start, cropW, y, ih - y, false);
    }
    needsPresent = false;
  }
  function update(sim, events, dt, reduced) {
    if (dpr !== devicePixelRatio) {
      dpr = devicePixelRatio;
      geometryDirty = artDirty = true;
    }
    if (geometryDirty) measure();
    if (artDirty) {
      paint();
      needsPresent = true;
    }
    if (sim) {
      if (events.some((e) => e.type === 'launch')) manualDuringShot = false;
      let manualView = base;
      const easingZoom = zoomFrom && !reduced;
      if (easingZoom) {
        zoomTime = Math.min(1, zoomTime + dt / 0.52);
        const t = zoomTime * zoomTime * (3 - 2 * zoomTime);
        const w = zoomFrom.width * Math.pow(base.width / zoomFrom.width, t);
        const h = (w * height) / width;
        const x0 = zoomFrom.x + zoomFrom.width / 2,
          y0 = zoomFrom.y + zoomFrom.height / 2;
        manualView = {
          x: x0 + (base.x + base.width / 2 - x0) * t - w / 2,
          y: y0 + (base.y + base.height / 2 - y0) * t - h / 2,
          width: w,
          height: h,
        };
      }
      if (reduced || zoomTime === 1) zoomFrom = null;
      const next = shotCamera.update(
        manualView,
        { width, height, top: safeTop, bottom: safeBottom, fitScale },
        sim,
        events,
        dt,
        reduced || manualDuringShot,
      );
      const percent = Math.round((width / (next.width * fitScale)) * 20) * 5;
      if (!easingZoom && percent !== readout) {
        readout = percent;
        fit.textContent = percent + '%';
      }
      needsPresent ||= next.x !== view.x || next.y !== view.y || next.width !== view.width;
      view = next;
    }
    if (needsPresent) present();
    return view;
  }
  function target(clientX, clientY) {
    update();
    const rect = field.getBoundingClientRect();
    return {
      x: view.x + ((clientX - rect.left) * view.width) / width,
      y: view.y + ((clientY - rect.top) * view.height) / height,
    };
  }
  function zoomTo(index, about = focusX) {
    update();
    manualDuringShot = true;
    const next = clamp(index, 0, stops.length - 1);
    if (next === zoom) return;
    const position = clamp((about - view.x) / view.width, 0, 1);
    zoomFrom = reducedMotion.matches ? null : view;
    zoomTime = 0;
    const newWidth = width / (fitScale * stops[next]);
    center = about + (0.5 - position) * newWidth;
    zoom = next;
    if (!zoom) {
      center = WIDTH / 2;
      lift = 0;
    }
    geometryDirty = true;
    update();
  }
  minus.addEventListener('click', () => zoomTo(zoom - 1));
  plus.addEventListener('click', () => zoomTo(zoom + 1));
  fit.addEventListener('click', () => zoomTo(0));
  field.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || !e.deltaY) return;
      e.preventDefault();
      zoomTo(zoom + Math.sign(-e.deltaY), target(e.clientX, e.clientY).x);
    },
    { passive: false },
  );
  field.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    moved = false;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, originX: e.clientX, originY: e.clientY });
    if (zoom || e.pointerType === 'touch') field.setPointerCapture(e.pointerId);
  });
  field.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    if (Math.hypot(e.clientX - p.originX, e.clientY - p.originY) > 6) moved = true;
    if (zoom && moved && pointers.size === 1) {
      zoomFrom = null;
      center -= ((e.clientX - p.x) * view.width) / width;
      const roofLift = crestRise - (screenGround - safeTop) / (fitScale * stops[zoom]) + 24;
      lift = clamp(lift + ((e.clientY - p.y) * view.height) / height, -140, Math.max(120, roofLift));
      geometryDirty = true;
    }
    p.x = e.clientX;
    p.y = e.clientY;
  });
  field.addEventListener('pointerup', (e) => pointers.delete(e.pointerId));
  field.addEventListener('pointercancel', (e) => {
    moved = true;
    pointers.delete(e.pointerId);
  });
  const observer = new ResizeObserver(() => {
    geometryDirty = true;
  });
  observer.observe(field);
  observer.observe(dock);
  return {
    update,
    target,
    dragged: () => moved,
    async prepareSkies(images) {
      // The blurred, desaturated sky is shared by every phase and seed. Bake it
      // during preflight so changing fortresses never filters a 4K image on the play thread.
      const density = devicePixelRatio || 1;
      const pixelsWide = Math.min(3840, Math.max(innerWidth, screen.width) * density);
      const pixelsHigh = Math.min(2560, Math.max(innerHeight, screen.height) * density);
      for (const image of images) {
        const iw = image.naturalWidth;
        const shelf = image.naturalHeight * GROUND_FRACTION;
        const scale = Math.min(1, 2560 / iw, Math.max(pixelsWide / iw, pixelsHigh * 0.81 / shelf));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(iw * scale);
        canvas.height = Math.round(shelf * scale);
        const c = canvas.getContext('2d', { alpha: false });
        c.filter = 'saturate(.69) contrast(.88) blur(' + Math.min(2.4, pixelsWide / 1450).toFixed(2) + 'px)';
        c.drawImage(image, 0, 0, iw, shelf, -1, -1, canvas.width + 2, canvas.height + 2);
        // Snapshot flushes the deferred filters before controls become interactive.
        const sky = typeof createImageBitmap === 'function' ? await createImageBitmap(canvas).catch(() => canvas) : canvas;
        atmosphericSkies.set(image, sky);
      }
    },
    frame(phaseName, variant, image, sections) {
      if (source !== image) {
        image.hidden = true;
        image.id = 'scenery';
        source.replaceWith(image);
        source = image;
      }
      shotCamera.reset();
      zoomFrom = null;
      manualDuringShot = false;
      focusX = WIDTH * 0.68;
      phase = phaseName;
      seed = variant;
      crestRise = Math.max(335, ...sections.map((ward) =>
        GROUND - ward.base + Math.max(...ward.heights) * ward.storey + 45));
      zoom = 0;
      lift = 0;
      center = WIDTH / 2;
      geometryDirty = artDirty = true;
      update();
    },
    focusAt(x) {
      focusX = clamp(x, 0, WIDTH);
    },
    invalidate() {
      geometryDirty = true;
    },
  };
}
