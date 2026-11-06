/* A quiet, north-up field sketch built from the actual mission layout.
   No enemy icons or live queries. Heights/cover are sampled once on demand;
   opening the sketch again only updates objective states and the player. */
const NS = 'http://www.w3.org/2000/svg';
const LABELS = {
  'saint-clair': { enter: 'Village checkpoint', square: 'Church square', river: 'River crossings', trench: 'Trench line', bunker: 'Bunker', flak: 'Flak gun', rally: 'Forest rally point' },
  'la-varenne': { hedge: 'First hedgerow', gun1: 'West gun', gun2: 'Middle gun', gun3: 'East gun', dump: 'Ammunition dump', rally: 'North road' },
  prague: { barricade: 'Tram barricade', relay: 'Radio annex', transmit: 'Tune the relay', report: 'Hold the annex', command: 'German command radio', rally: 'Rally courtyard' },
};
const number = n => Number(n.toFixed(2));
export function fieldPoint(data, x, z) {
  // Hedgerow's +X is west, the player's left when facing north.
  return [number(data.bounds.maxX - x + data.pad), number(data.bounds.maxZ - z + data.pad)];
}
const pointPath = points => points.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('');

export async function buildFieldMapData(level, { columns = 40, yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  const bounds = { ...level.bounds }, width = bounds.maxX - bounds.minX, depth = bounds.maxZ - bounds.minZ;
  if (!(width > 0 && depth > 0)) throw new Error('Invalid field map bounds');
  const extent = Math.max(width, depth), pad = extent * .045;
  const data = { bounds, pad, extent, width: width + pad * 2, height: depth + pad * 2, routes: [], contours: [], woods: '', water: '', markers: [] };
  const nx = Math.max(16, Math.min(64, Math.floor(columns))), nz = Math.max(24, Math.min(140, Math.round(nx * depth / width)));
  const dx = width / nx, dz = depth / nz, heights = new Float32Array((nx + 1) * (nz + 1));
  let low = Infinity, high = -Infinity;
  for (let j = 0; j <= nz; j++) {
    const z = bounds.minZ + j * dz;
    for (let i = 0; i <= nx; i++) {
      const h = level.baseHeight(bounds.minX + i * dx, z);
      if (!Number.isFinite(h)) throw new Error('Invalid field map height');
      heights[j * (nx + 1) + i] = h; low = Math.min(low, h); high = Math.max(high, h);
    }
    if (j % 8 === 7) await yieldTask();
  }
  // Merge consecutive cells in each row, keeping the SVG small and static.
  for (let j = 0; j < nz; j++) {
    const z = bounds.minZ + (j + .5) * dz;
    const rows = { woods: [], water: [] };
    for (let i = 0; i < nx; i++) {
      const x = bounds.minX + (i + .5) * dx, h = heights[j * (nx + 1) + i];
      rows.water.push(!!level.water?.contains(x, z));
      rows.woods.push(!rows.water.at(-1) && (level.splat?.(x, z, h, 0)?.[2] || 0) > .48);
    }
    for (const [kind, row] of Object.entries(rows)) {
      for (let i = 0; i < nx;) {
        if (!row[i]) { i++; continue; }
        const start = i; while (i < nx && row[i]) i++;
        const a = fieldPoint(data, bounds.minX + i * dx, bounds.minZ + (j + 1) * dz);
        data[kind] += `M${a[0]},${a[1]}h${number((i - start) * dx)}v${number(dz)}h${-number((i - start) * dx)}Z`;
      }
    }
    if (j % 8 === 7) await yieldTask();
  }
  const interval = Math.max(2, Math.ceil((high - low) / 12 / 2) * 2);
  for (let altitude = Math.ceil(low / interval) * interval; altitude < high; altitude += interval) {
    let path = '';
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = bounds.minX + i * dx, z = bounds.minZ + j * dz;
      const q = [[x, z], [x + dx, z], [x + dx, z + dz], [x, z + dz]];
      const h = [heights[j * (nx + 1) + i], heights[j * (nx + 1) + i + 1], heights[(j + 1) * (nx + 1) + i + 1], heights[(j + 1) * (nx + 1) + i]];
      const cross = [];
      for (let k = 0; k < 4; k++) {
        const next = (k + 1) % 4;
        if ((h[k] < altitude) === (h[next] < altitude)) continue;
        const t = (altitude - h[k]) / (h[next] - h[k]);
        cross.push(fieldPoint(data, q[k][0] + (q[next][0] - q[k][0]) * t, q[k][1] + (q[next][1] - q[k][1]) * t));
      }
      for (let k = 0; k + 1 < cross.length; k += 2) path += pointPath([cross[k], cross[k + 1]]);
    }
    if (path) data.contours.push(path);
    await yieldTask();
  }
  for (const [name, points] of Object.entries(level.lines || {})) {
    if (!Array.isArray(points) || points.length < 2) continue;
    const kind = /TRENCH/.test(name) ? 'trench' : /DRAIN|PATH|COURT|ROUTE/.test(name) ? 'path' : 'road';
    data.routes.push({ name, kind, path: pointPath(points.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1])).map(([x, z]) => fieldPoint(data, x, z))) });
  }
  level.objectives.forEach((o, index) => {
    let at = o.marker || (Number.isFinite(o.x) && Number.isFinite(o.z) ? [o.x, o.z] : null);
    if (!at && o.kind === 'clear') {
      const defenders = level.enemies.filter(e => o.groups.includes(e.group));
      if (defenders.length) at = [defenders.reduce((n, e) => n + e.at[0], 0) / defenders.length, defenders.reduce((n, e) => n + e.at[1], 0) / defenders.length];
    }
    data.markers.push({ id: o.id, number: index + 1, label: level.map?.labels?.[o.id] || LABELS[level.id]?.[o.id] || o.text, at: at ? fieldPoint(data, at[0], at[1]) : null });
  });
  data.start = fieldPoint(data, level.start[0], level.start[1]);
  data.scale = extent > 450 ? 100 : extent > 200 ? 50 : 20;
  return data;
}

export function renderFieldMap(container, data, { title = '', mission = null, player = null, yaw = 0 } = {}) {
  const svg = (tag, attrs = {}) => {
    const el = document.createElementNS(NS, tag);
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
    return el;
  };
  const scale = data.extent / 500, radius = data.extent / 75, font = data.extent / 36;
  const drawing = svg('svg', { viewBox: `0 0 ${data.width} ${data.height}`, role: 'img', 'aria-label': `${title} field sketch. North is up. Numbered markers match your orders.`, class: 'field-map-sketch' });
  drawing.append(svg('path', { d: data.woods, class: 'map-woods' }), svg('path', { d: data.water, class: 'map-water' }));
  for (const d of data.contours) drawing.append(svg('path', { d, class: 'map-contour', 'stroke-width': scale * .7 }));
  for (const route of data.routes) drawing.append(svg('path', { d: route.path, class: `map-route map-${route.kind}`, 'stroke-width': scale * (route.kind === 'road' ? 3.5 : 1.4), 'stroke-dasharray': route.kind === 'road' ? '' : `${scale * 5} ${scale * 3}` }));
  const status = id => mission?.isComplete(id) ? 'done' : mission?.isActive(id) ? 'current' : 'future';
  const clusters = [];
  for (const marker of data.markers.filter(m => m.at)) {
    const cluster = clusters.find(c => Math.hypot(c.at[0] - marker.at[0], c.at[1] - marker.at[1]) < radius * 2.2);
    if (cluster) cluster.markers.push(marker); else clusters.push({ at: marker.at, markers: [marker] });
  }
  for (const cluster of clusters) {
    const states = cluster.markers.map(m => status(m.id));
    const state = states.includes('current') ? 'current' : states.every(s => s === 'done') ? 'done' : 'future';
    const g = svg('g', { class: `map-objective ${state}` });
    if (cluster.markers.length > 1) {
      g.append(svg('ellipse', { cx: cluster.at[0], cy: cluster.at[1], rx: radius * (cluster.markers.length === 2 ? 1.65 : 2.55), ry: radius, 'stroke-width': scale * 1.4 }));
    } else g.append(svg('circle', { cx: cluster.at[0], cy: cluster.at[1], r: radius, 'stroke-width': scale * 1.4 }));
    const text = svg('text', { x: cluster.at[0], y: cluster.at[1], 'font-size': font * (cluster.markers.length > 1 ? .72 : 1), 'dominant-baseline': 'central', 'text-anchor': 'middle' });
    text.textContent = cluster.markers.map(m => m.number).join('·'); g.append(text); drawing.append(g);
  }
  const start = svg('text', { x: data.start[0], y: data.start[1] + radius * 2.7, 'font-size': font * .72, 'text-anchor': 'middle', class: 'map-start' });
  start.textContent = 'START'; drawing.append(start);
  if (player) {
    const at = fieldPoint(data, player.x, player.z);
    drawing.append(svg('path', { d: `M0,${-radius * 1.5}L${radius},${radius}L0,${radius * .45}L${-radius},${radius}Z`, class: 'map-player', transform: `translate(${at[0]} ${at[1]}) rotate(${-yaw * 180 / Math.PI})`, 'stroke-width': scale }));
  }
  const north = svg('text', { x: data.width - data.pad, y: data.pad * .65, 'font-size': font, 'text-anchor': 'middle', class: 'map-north' }); north.textContent = 'N ↑'; drawing.append(north);
  const barY = data.height - data.pad * .3;
  drawing.append(svg('path', { d: `M${data.pad},${barY - scale * 4}v${scale * 4}h${data.scale}v${-scale * 4}`, class: 'map-scale', 'stroke-width': scale }));
  const barText = svg('text', { x: data.pad, y: barY - scale * 8, 'font-size': font * .7, class: 'map-scale' }); barText.textContent = `${data.scale} m`; drawing.append(barText);
  const legend = document.createElement('ol'); legend.className = 'field-map-orders';
  for (const marker of data.markers) {
    const li = document.createElement('li'), state = status(marker.id);
    li.dataset.state = state; li.textContent = marker.label;
    if (state === 'current') li.setAttribute('aria-current', 'step');
    li.setAttribute('aria-label', `${marker.label} — ${state === 'done' ? 'completed' : state === 'current' ? 'current order' : 'upcoming order'}`);
    legend.append(li);
  }
  const chart = document.createElement('div'); chart.className = 'field-map-chart'; chart.append(drawing);
  container.className = 'field-map-content'; container.replaceChildren(chart, legend);
}
