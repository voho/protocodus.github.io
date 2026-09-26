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
  const glows = new Map();
  function glowImage(color) {
    if (glows.has(color)) return glows.get(color);
    const image = document.createElement('canvas'); image.width = image.height = 64;
    const context = image.getContext('2d'), gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, color + 'b3'); gradient.addColorStop(.19, color + '65'); gradient.addColorStop(.55, color + '1d'); gradient.addColorStop(1, color + '00');
    context.fillStyle = gradient; context.fillRect(0, 0, 64, 64); glows.set(color, image); return image;
  }

  return function drawLighting(c, { game, layers, camera, width, height, bounds, industryIndex, stationIndex, routesById }) {
    if (layers.lighting === false) return;
    const state = daylightAt(game.day), night = state.night;
    if (night === 0 && state.dusk === 0) return;
    c.save();
    if (state.dusk > 0) { c.fillStyle = `rgba(177,115,67,${state.dusk * .085})`; c.fillRect(0, 0, width, height); }
    if (night <= 0) { c.restore(); return; }
    c.fillStyle = `rgba(18,29,61,${night * .47})`; c.fillRect(0, 0, width, height);
    const zoom = camera.zoom, project = (x, y) => ({ x: ((x + .5) * 32 - camera.x) * zoom + width / 2, y: ((y + .5) * 32 - camera.y) * zoom + height / 2 });
    const tile = (x, y) => x >= 0 && y >= 0 && x < game.width && y < game.height ? game.tiles[y * game.width + x] : null;
    const visible = p => p.x > -45 && p.y > -45 && p.x < width + 45 && p.y < height + 45;
    const glow = (x, y, radius, color = '#ffce83', power = 1) => { c.globalAlpha = night * power; c.drawImage(glowImage(color), x - radius, y - radius, radius * 2, radius * 2); c.globalAlpha = 1; };
    const bulb = (x, y, radius = .75, color = '#ffe1a0') => { c.globalAlpha = night; c.fillStyle = color; c.beginPath(); c.arc(x, y, Math.max(.65, radius * zoom), 0, TAU); c.fill(); c.globalAlpha = 1; };
    c.globalCompositeOperation = 'screen'; c.imageSmoothingEnabled = true;
    for (let y = bounds.y0; y < bounds.y1; y++) for (let x = bounds.x0; x < bounds.x1; x++) {
      const t = tile(x, y), id = y * game.width + x, p = project(x, y), hash = (Math.imul(x + 17, 73856093) ^ Math.imul(y + 31, 19349663) ^ (game.seed || 0)) >>> 0;
      if (layers.buildings && (t.building || industryIndex.has(id))) {
        const industry = industryIndex.get(id), count = industry ? 3 : 1 + hash % 3;
        for (let n = 0; n < count; n++) {
          const wx = p.x + (-8 + n * 5 + (hash % 3)) * zoom, wy = p.y + (industry ? 4 : 3 + hash % 3) * zoom;
          glow(wx, wy, Math.max(3, 6 * zoom), '#ffd28b', .48);
          c.globalAlpha = night * .92; c.fillStyle = '#ffe2a1'; c.fillRect(wx, wy, Math.max(.8, 1.5 * zoom), Math.max(.8, 1.7 * zoom)); c.globalAlpha = 1;
        }
      }
      if (layers.roads && t.road && hash % 11 === 0) {
        const lx = p.x + 9 * zoom, ly = p.y - 5 * zoom;
        glow(lx, ly, Math.max(5, 14 * zoom), '#ffcf82', .68); bulb(lx, ly, .9);
        c.globalAlpha = night * .55; c.strokeStyle = '#cfb478'; c.lineWidth = Math.max(.6, .7 * zoom); c.beginPath(); c.moveTo(lx, ly); c.lineTo(lx, ly + 5 * zoom); c.stroke(); c.globalAlpha = 1;
      }
      const station = layers.stations && stationIndex.get(id);
      if (station) {
        if (station.mode === 'water') {
          const shore = [[-1, 0], [0, -1], [1, 0], [0, 1]].find(([dx, dy]) => tile(x + dx, y + dy) && tile(x + dx, y + dy).terrain !== 'water') || [-1, 0];
          const angle = Math.atan2(shore[1], shore[0]) - Math.PI, cosine = Math.cos(angle), sine = Math.sin(angle);
          for (const [dx, dy] of [[12, 9], [-15, -13], [-20, 10]]) {
            const lx = p.x + (dx * cosine - dy * sine) * zoom, ly = p.y + (dx * sine + dy * cosine) * zoom;
            glow(lx, ly, Math.max(5, 13 * zoom), '#ffd493', .8); bulb(lx, ly, .85);
            c.globalAlpha = night * .21; c.fillStyle = '#eac589'; c.fillRect(lx - zoom, ly + 4 * zoom, Math.max(1, 2 * zoom), 4 * zoom); c.fillRect(lx - 1.5 * zoom, ly + 10 * zoom, Math.max(1, 3 * zoom), 1.5 * zoom); c.globalAlpha = 1;
          }
        } else { glow(p.x + 9 * zoom, p.y - 7 * zoom, Math.max(4, 10 * zoom), '#ffdf9c', .7); bulb(p.x + 9 * zoom, p.y - 7 * zoom); }
      }
    }
    if (layers.vehicles) for (const vehicle of game.vehicles || []) {
      const route = routesById.get(vehicle.routeId), p = project(vehicle.x, vehicle.y); if (!route || !visible(p)) continue;
      const angle = Number.isFinite(vehicle.angle) ? vehicle.angle : 0, cosine = Math.cos(angle), sine = Math.sin(angle), ship = route.mode === 'water';
      const point = (dx, dy) => ({ x: p.x + (dx * cosine - dy * sine) * zoom, y: p.y + (dx * sine + dy * cosine) * zoom });
      const underBridge = (dx, dy) => { const t = tile(Math.floor(vehicle.x + .5 + (dx * cosine - dy * sine) / 32), Math.floor(vehicle.y + .5 + (dx * sine + dy * cosine) / 32)); return ship && t?.bridge && ((layers.roads && t.road) || (layers.rails && t.rail)); };
      const nose = ship ? 18 : 7, head = point(nose, 0);
      if (!underBridge(nose, 0)) {
        c.save(); c.translate(head.x, head.y); c.rotate(angle); c.globalAlpha = night * (ship ? .34 : .55);
        const length = (ship ? 19 : 22) * zoom, beam = c.createRadialGradient(0, 0, 0, 0, 0, length);
        beam.addColorStop(0, '#ffe5aeb3'); beam.addColorStop(1, '#ffe5ae00'); c.fillStyle = beam;
        c.beginPath(); c.moveTo(0, -1.6 * zoom); c.lineTo(length, -7 * zoom); c.quadraticCurveTo(length * 1.1, 0, length, 7 * zoom); c.lineTo(0, 1.6 * zoom); c.closePath(); c.fill(); c.restore();
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
  };
}
