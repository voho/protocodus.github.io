import { residentialKind, commercialKind } from './buildings.js';
import { hasRasterHouse, houseWindowAnchors, houseAssetsRevision } from './raster-houses.js';
import { hasRasterIndustry, rasterIndustryWindows } from './raster-industries.js';
import { industrySize } from './industry-sites.js';
import { buildingSize } from './building-sites.js';
import { hasRasterBuilding, rasterBuildingWindows } from './raster-buildings.js';
import { vehicleHeadingIndex, vehicleFrameAngle } from './vehicle-directions.js';
import { isEngineeredTunnel, isUndergroundAt } from './structure-visibility.js';
import { isometricStationLights } from './isometric-infrastructure.js';
import { projectAngle } from './isometric.js';
import { worldArtRevision } from './atlas-runtime.js';

const TAU = Math.PI * 2;
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };

// One simulation day is one second at 1×. Day zero begins at midday, and the
// entire cycle follows saved simulation time, including pause and speed changes.
export function daylightAt(day = 0) {
  const phase = (((Number(day) || 0) % 60) + 60) % 60 / 60;
  const sun = Math.cos(phase * TAU);
  return { phase, night: smooth((.22 - sun) / 1.05), dusk: Math.max(0, 1 - Math.abs(sun) * 4) };
}

export function createLighting() {
  const glows = new Map(), beams = new Map(), windowsCache = new Map();
  let emitters = null, emitterBuilds = 0, beamBuilds = 0, beamBytes = 0, windowBytes = 0, windowBuilds = 0, windowPaints = 0;
  const BEAM_LIMIT = 2 * 1024 * 1024, WINDOW_LIMIT = 8 * 1024 * 1024;
  // Headlight geometry has only eight authored directions. Rasterize it once
  // at the current display density; simulation time only changes its opacity.
  function beamImage(ship, angle, zoom, dpr) {
    const key = `${ship ? 1 : 0}:${angle}:${zoom}:${dpr}`;
    let entry = beams.get(key);
    if (entry) { beams.delete(key); beams.set(key, entry); return entry; }
    const length = (ship ? 19 : 22) * zoom, padding = 1 / dpr;
    const cosine = Math.cos(angle), sine = Math.sin(angle);
    const points = [[0, -1.6 * zoom], [length, -7 * zoom], [length * 1.1, 0], [length, 7 * zoom], [0, 1.6 * zoom]]
      .map(([x, y]) => [x * cosine - y * sine, x * sine + y * cosine]);
    const left = Math.floor((Math.min(...points.map(p => p[0])) - padding) * dpr) / dpr;
    const top = Math.floor((Math.min(...points.map(p => p[1])) - padding) * dpr) / dpr;
    const right = Math.max(...points.map(p => p[0])) + padding, bottom = Math.max(...points.map(p => p[1])) + padding;
    const image = document.createElement('canvas');
    image.width = Math.ceil((right - left) * dpr); image.height = Math.ceil((bottom - top) * dpr);
    const c = image.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, -left * dpr, -top * dpr); c.rotate(angle);
    const gradient = c.createRadialGradient(0, 0, 0, 0, 0, length);
    gradient.addColorStop(0, '#ffe5aeb3'); gradient.addColorStop(1, '#ffe5ae00'); c.fillStyle = gradient;
    c.beginPath(); c.moveTo(0, -1.6 * zoom); c.lineTo(length, -7 * zoom);
    c.quadraticCurveTo(length * 1.1, 0, length, 7 * zoom); c.lineTo(0, 1.6 * zoom); c.closePath(); c.fill();
    entry = { image, left, top, width: image.width / dpr, height: image.height / dpr, bytes: image.width * image.height * 4 };
    while (beamBytes + entry.bytes > BEAM_LIMIT && beams.size) {
      const oldest = beams.keys().next().value, old = beams.get(oldest);
      beamBytes -= old.bytes; old.image.width = old.image.height = 0; beams.delete(oldest);
    }
    beams.set(key, entry); beamBytes += entry.bytes; beamBuilds++; return entry;
  }
  // Screen blending is associative, so a building's panes can share one light
  // image without losing overlapping glows. At dusk, repaint each reusable
  // small image once at the exact new opacity, not once per building.
  function windowImage(building, hash, zoom, dpr, projected, night, center) {
    const { raster, windows, span, count, industry, lightKey } = building;
    if (!count) return null;
    const key = `${lightKey}:${zoom}:${dpr}:${projected}`;
    let entry = windowsCache.get(key);
    if (entry) { windowsCache.delete(key); windowsCache.set(key, entry); }
    else {
      const artScale = projected ? 1.5 : 1, originX = projected ? 24 * span : 16, originY = projected ? 36 * span : 16;
      const panes = []; let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (let n = 0; n < count; n++) {
        const wx0 = raster ? windows[n][0] * span : (8 + n * 5 + hash % 3) * span;
        const wy0 = raster ? windows[n][1] * span : (industry ? 20 : 19 + hash % 3) * span;
        const wx = (wx0 * artScale - originX) * zoom, wy = (wy0 * artScale - originY) * zoom;
        const w = raster ? windows[n][2] * zoom * span * artScale : 1.5 * zoom;
        const h = raster ? windows[n][3] * zoom * span * artScale : 1.7 * zoom;
        const x = raster ? wx + w / 2 : wx, y = raster ? wy + h / 2 : wy;
        const radius = raster ? Math.max(3.5, 5 * zoom) : Math.max(3, 6 * zoom);
        const width = Math.max(.8, w), height = Math.max(.8, h);
        const rectX = raster ? x - width / 2 : x, rectY = raster ? y - height / 2 : y;
        panes.push({ x, y, radius, rectX, rectY, width, height });
        left = Math.min(left, x - radius, rectX); top = Math.min(top, y - radius, rectY);
        right = Math.max(right, x + radius, rectX + width); bottom = Math.max(bottom, y + radius, rectY + height);
      }
      left = Math.floor(left * dpr) / dpr; top = Math.floor(top * dpr) / dpr;
      const image = document.createElement('canvas');
      image.width = Math.ceil((right - left) * dpr) + 1; image.height = Math.ceil((bottom - top) * dpr) + 1;
      const context = image.getContext('2d');
      context.setTransform(dpr, 0, 0, dpr, -left * dpr, -top * dpr); context.globalCompositeOperation = 'screen';
      entry = { image, context, left, top, width: image.width / dpr, height: image.height / dpr, panes, night: -1, bytes: image.width * image.height * 4 };
      while (windowBytes + entry.bytes > WINDOW_LIMIT && windowsCache.size) {
        const oldest = windowsCache.keys().next().value, old = windowsCache.get(oldest);
        windowBytes -= old.bytes; old.image.width = old.image.height = 0; windowsCache.delete(oldest);
      }
      windowsCache.set(key, entry); windowBytes += entry.bytes; windowBuilds++;
    }
    // Bake the camera's fractional physical pixel into the light image. Drawing
    // a second interpolated copy would blur subpixel window panes while panning.
    const px = Math.round(center.x * dpr * 1e8) / 1e8, py = Math.round(center.y * dpr * 1e8) / 1e8;
    const phaseX = Math.round((px - Math.floor(px)) * 1e8) / (1e8 * dpr), phaseY = Math.round((py - Math.floor(py)) * 1e8) / (1e8 * dpr);
    if (entry.night !== night || entry.phaseX !== phaseX || entry.phaseY !== phaseY) {
      const c = entry.context;
      c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, entry.image.width, entry.image.height);
      c.setTransform(dpr, 0, 0, dpr, (phaseX - entry.left) * dpr, (phaseY - entry.top) * dpr);
      for (const pane of entry.panes) {
        c.globalAlpha = night * (raster ? .82 : .48);
        c.drawImage(glowImage('#ffd28b'), pane.x - pane.radius, pane.y - pane.radius, pane.radius * 2, pane.radius * 2);
        c.globalAlpha = night * (raster ? .9 : .92); c.fillStyle = raster ? '#ffe1a1' : '#ffe2a1';
        c.fillRect(pane.rectX, pane.rectY, pane.width, pane.height);
      }
      entry.night = night; entry.phaseX = phaseX; entry.phaseY = phaseY; windowPaints++;
    }
    return entry;
  }
  function staticEmitters(game, bounds, industryIndex, stationIndex, artwork) {
    const revision = game.revision, reusable = Number.isFinite(revision);
    if (reusable && emitters?.game === game && emitters.tiles === game.tiles && emitters.revision === revision &&
        emitters.artwork === artwork && emitters.biome === game.biome && emitters.seed === game.seed && emitters.industryIndex === industryIndex &&
        emitters.stationIndex === stationIndex && bounds.x0 >= emitters.x0 && bounds.y0 >= emitters.y0 &&
        bounds.x1 <= emitters.x1 && bounds.y1 <= emitters.y1) return emitters.items;
    const x0 = Math.max(0, bounds.x0 - 8), y0 = Math.max(0, bounds.y0 - 8);
    const x1 = Math.min(game.width, bounds.x1 + 8), y1 = Math.min(game.height, bounds.y1 + 8), items = [];
    const tile = (x, y) => x >= 0 && y >= 0 && x < game.width && y < game.height ? game.tiles[y * game.width + x] : null;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const id = y * game.width + x, t = game.tiles[id], industry = industryIndex.get(id), station = stationIndex.get(id);
      if (!t || (!t.building && !industry && !t.road && !station)) continue;
      const hash = (Math.imul(x + 17, 73856093) ^ Math.imul(y + 31, 19349663) ^ (game.seed || 0)) >>> 0;
      const item = { x, y, hash, road: t.road && !isEngineeredTunnel(t) && hash % 11 === 0, station };
      if (t.building || industry) {
        if (industry && (industry.x !== x || industry.y !== y)) { item.industryPart = true; }
        else {
          const legacy = t.building?.kind;
          const kind = ['house', 'apartment'].includes(legacy) ? residentialKind(t.variant ?? x * 13 + y, t.building.level || 1) : ['shop', 'office'].includes(legacy) ? commercialKind(t.variant ?? x * 13 + y, t.building.level || 1) : legacy;
          const zoneFactory = kind === 'factory' ? (game.biome === 'tundra' ? 'equipment-factory' : game.biome === 'desert' ? 'goods-factory' : 'furniture-factory') : null;
          const house = !industry && !zoneFactory && hasRasterHouse(kind, game.biome);
          const raster = industry ? hasRasterIndustry(industry.kind, game.biome) : zoneFactory ? hasRasterIndustry(zoneFactory, game.biome) : house || hasRasterBuilding(kind, game.biome);
          const windows = raster ? industry ? rasterIndustryWindows(industry.kind, game.biome) : zoneFactory ? rasterIndustryWindows(zoneFactory, game.biome) : house ? houseWindowAnchors(kind, game.biome) : rasterBuildingWindows(kind, game.biome) : null;
          item.building = { lightKey: `${artwork}:${game.biome}:${industry?.kind || zoneFactory || kind}:${industry ? industrySize(industry) : buildingSize(t.building)}:${raster ? 'raster' : `${!!industry}:${hash % 3}`}`, industry: !!industry, raster, windows, span: industry ? industrySize(industry) : buildingSize(t.building), count: raster ? windows.length : industry ? 3 : 1 + hash % 3 };
        }
      }
      if (station?.mode === 'water') item.shore = [[-1, 0], [0, -1], [1, 0], [0, 1]].find(([dx, dy]) => tile(x + dx, y + dy) && tile(x + dx, y + dy).terrain !== 'water') || [-1, 0];
      if (item.building || item.road || station || item.industryPart) items.push(item);
    }
    emitters = { game, tiles: game.tiles, revision, artwork, biome: game.biome, seed: game.seed, industryIndex, stationIndex, x0, y0, x1, y1, items };
    emitterBuilds++; return items;
  }
  function glowImage(color) {
    if (glows.has(color)) return glows.get(color);
    const image = document.createElement('canvas'); image.width = image.height = 64;
    const context = image.getContext('2d'), gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, color + 'b3'); gradient.addColorStop(.19, color + '65'); gradient.addColorStop(.55, color + '1d'); gradient.addColorStop(1, color + '00');
    context.fillStyle = gradient; context.fillRect(0, 0, 64, 64); glows.set(color, image); return image;
  }

  function drawLighting(c, { game, layers, camera, width, height, bounds, industryIndex, stationIndex, routesById, vehicles = game.vehicles || [], project: worldToScreen, projectVehicle, projectBuilding, projected = false, dpr, artRevision }) {
    if (layers.lighting === false) return;
    const state = daylightAt(game.day), night = state.night;
    const pixelRatio = Number.isFinite(dpr) && dpr > 0 ? dpr : Math.abs(c.getTransform().a) || 1;
    if (night === 0 && state.dusk === 0) return;
    c.save();
    if (state.dusk > 0) { c.fillStyle = `rgba(177,115,67,${state.dusk * .085})`; c.fillRect(0, 0, width, height); }
    if (night <= 0) { c.restore(); return; }
    c.fillStyle = `rgba(18,29,61,${night * .47})`; c.fillRect(0, 0, width, height);
    const zoom = camera.zoom, project = worldToScreen || ((x, y) => ({ x: ((x + .5) * 32 - camera.x) * zoom + width / 2, y: ((y + .5) * 32 - camera.y) * zoom + height / 2 }));
    const tile = (x, y) => x >= 0 && y >= 0 && x < game.width && y < game.height ? game.tiles[y * game.width + x] : null;
    const visible = p => p.x > -45 && p.y > -45 && p.x < width + 45 && p.y < height + 45;
    const glow = (x, y, radius, color = '#ffce83', power = 1) => { c.globalAlpha = night * power; c.drawImage(glowImage(color), x - radius, y - radius, radius * 2, radius * 2); c.globalAlpha = 1; };
    const bulb = (x, y, radius = .75, color = '#ffe1a0') => { c.globalAlpha = night; c.fillStyle = color; c.beginPath(); c.arc(x, y, Math.max(.65, radius * zoom), 0, TAU); c.fill(); c.globalAlpha = 1; };
    c.globalCompositeOperation = 'screen'; c.imageSmoothingEnabled = true;
    const items = staticEmitters(game, bounds, industryIndex, stationIndex, artRevision ?? `${worldArtRevision()}:${houseAssetsRevision()}`);
    for (const item of items) {
      const { x, y, hash } = item;
      if (x < bounds.x0 || y < bounds.y0 || x >= bounds.x1 || y >= bounds.y1) continue;
      if (layers.buildings && item.industryPart) continue;
      if (!(layers.buildings && item.building?.count || layers.roads && item.road || layers.stations && item.station)) continue;
      // Empty terrain and unlit infrastructure never need terrain projection.
      const p = !projected || layers.stations && item.station ? project(x, y) : null;
      if (layers.buildings && item.building?.count) {
        const { span } = item.building;
        // Only the footprint center is projected; authored panes stay upright.
        const center = projected ? projectBuilding ? projectBuilding(x, y, span) : project(x + (span - 1) / 2, y + (span - 1) / 2) : p;
        const extent = 36 * span * zoom + Math.max(6, 6 * zoom);
        if (center.x > -extent && center.y > -extent && center.x < width + extent && center.y < height + extent) {
          const image = windowImage(item.building, hash, zoom, pixelRatio, projected, night, center);
          if (image) c.drawImage(image.image, center.x + image.left - image.phaseX, center.y + image.top - image.phaseY, image.width, image.height);
        }
      }

      if (layers.roads && item.road) {
        const roadside = projected ? (projectVehicle||project)(x + 9 / 32, y, 'road') : { x: p.x + 9 * zoom, y: p.y };
        const lx = roadside.x, ly = roadside.y - 5 * zoom, radius = Math.max(5, 14 * zoom);
        if (lx > -radius && ly > -radius && lx < width + radius && ly < height + radius) {
          glow(lx, ly, radius, '#ffcf82', .68); bulb(lx, ly, .9);
          c.globalAlpha = night * .55; c.strokeStyle = '#cfb478'; c.lineWidth = Math.max(.6, .7 * zoom); c.beginPath(); c.moveTo(lx, ly); c.lineTo(lx, ly + 5 * zoom); c.stroke(); c.globalAlpha = 1;
        }
      }
      const station = layers.stations && item.station;
      if (station) {
        if (projected) {
          const port = station.mode === 'water';
          const shore = port ? item.shore : [0, 0];
          for (const [sx, sy, sw, sh] of isometricStationLights(station.mode, ...shore)) {
            const w = sw * zoom, h = sh * zoom, lx = p.x + ((port ? 0 : 11) + sx) * zoom + w / 2, ly = p.y + ((port ? 0 : 2) + sy) * zoom + h / 2;
            glow(lx, ly, Math.max(4, 8 * zoom), '#ffd493', .75);
            c.globalAlpha = night * .85; c.fillStyle = '#ffe1a1';
            c.fillRect(lx - Math.max(.8, w) / 2, ly - Math.max(.8, h) / 2, Math.max(.8, w), Math.max(.8, h)); c.globalAlpha = 1;
          }
        } else if (station.mode === 'water') {
          const shore = item.shore;
          const angle = Math.atan2(shore[1], shore[0]) - Math.PI, cosine = Math.cos(angle), sine = Math.sin(angle);
          for (const [dx, dy] of [[12, 9], [-15, -13], [-20, 10]]) {
            const rx = dx * cosine - dy * sine, ry = dx * sine + dy * cosine;
            const lamp = { x: p.x + rx * zoom, y: p.y + ry * zoom };
            const lx = lamp.x, ly = lamp.y;
            glow(lx, ly, Math.max(5, 13 * zoom), '#ffd493', .8); bulb(lx, ly, .85);
            c.globalAlpha = night * .21; c.fillStyle = '#eac589'; c.fillRect(lx - zoom, ly + 4 * zoom, Math.max(1, 2 * zoom), 4 * zoom); c.fillRect(lx - 1.5 * zoom, ly + 10 * zoom, Math.max(1, 3 * zoom), 1.5 * zoom); c.globalAlpha = 1;
          }
        } else { const ly = p.y - (projected ? 17 : 7) * zoom; glow(p.x + 9 * zoom, ly, Math.max(4, 10 * zoom), '#ffdf9c', .7); bulb(p.x + 9 * zoom, ly); }
      }
    }
    if (layers.vehicles) for (const vehicle of vehicles) {
      const route = routesById.get(vehicle.routeId);if(!route)continue;
      const p = (projectVehicle||project)(vehicle.x, vehicle.y, route.mode, vehicle); if (!visible(p) || (route.mode !== 'water' && isUndergroundAt(game, vehicle.x, vehicle.y))) continue;
      const worldAngle = Number.isFinite(vehicle.angle) ? vehicle.angle : 0, worldCosine = Math.cos(worldAngle), worldSine = Math.sin(worldAngle);
      // Height changes move the whole sprite vertically; they do not change
      // which authored compass frame points along the ground-plane direction.
      const angle = projected ? vehicleFrameAngle(projectAngle(worldAngle)) : vehicleHeadingIndex(worldAngle) * Math.PI / 4, cosine = Math.cos(angle), sine = Math.sin(angle), ship = route.mode === 'water';
      const point = (dx, dy) => ({ x: p.x + (dx * cosine - dy * sine) * zoom, y: p.y + (dx * sine + dy * cosine) * zoom });
      // Occlusion belongs to the world grid, not the vehicle's screen heading.
      const underBridge = (dx, dy) => { const t = tile(Math.floor(vehicle.x + .5 + (dx * worldCosine - dy * worldSine) / 32), Math.floor(vehicle.y + .5 + (dx * worldSine + dy * worldCosine) / 32)); return ship && t?.bridge && ((layers.roads && t.road) || (layers.rails && t.rail)); };
      const nose = ship ? 18 : 8, head = point(nose, 0);
      if (!underBridge(nose, 0)) {
        const beam = beamImage(ship, angle, zoom, pixelRatio);
        c.globalAlpha = night * (ship ? .34 : .55);
        c.drawImage(beam.image, head.x + beam.left, head.y + beam.top, beam.width, beam.height); c.globalAlpha = 1;
        glow(head.x, head.y, Math.max(3, 6 * zoom), '#ffe5ac', .75); bulb(head.x, head.y, .7);
      }
      if (ship) {
        for (const [dy, color] of [[-5.3, '#f69a78'], [5.3, '#9bdfb2']]) {
          if (underBridge(8, dy)) continue;
          const nav = point(8, dy); glow(nav.x, nav.y, Math.max(3, 7 * zoom), color, .75); bulb(nav.x, nav.y, .65, color);
          glow(nav.x, nav.y + 4 * zoom, Math.max(2, 4 * zoom), color, .23);
        }
        if (!underBridge(-9, 0)) { const cabin = point(-9, 0); glow(cabin.x, cabin.y, Math.max(3, 5 * zoom), '#ffe4a6', .46); }
      } else {
        const rear = point(-7, 0); glow(rear.x, rear.y, Math.max(2, 3.5 * zoom), '#ea8d6a', .55); bulb(rear.x, rear.y, .55, '#efb18b');
      }
    }
    c.restore();
  }
  drawLighting.clear = () => { emitters = null; };
  drawLighting.getStats = () => ({ emitterBuilds, staticEmitters: emitters?.items.length || 0, beamBuilds, beamCount: beams.size, beamBytes, beamLimit: BEAM_LIMIT, windowCount: windowsCache.size, windowBytes, windowLimit: WINDOW_LIMIT, windowBuilds, windowPaints });
  return drawLighting;
}
