// A pitched bay replaces its parapet. Neighboring piers and merlons keep their
// own clearance, even where two lintels share a single bearing.
export function selectRoofs(ward, flagBay) {
  const result = new Map();
  if (!ward.zones) return result;
  const { heights, zones, pattern, spans } = ward;
  const occupants = [...ward.orcs, ...ward.barrels];
  const choices = [];
  for (let bay = 0; bay < spans.length; bay++) {
    const height = heights[bay], zone = zones[bay];
    if (bay === flagBay || zone === 'wall' || zone === 'court' ||
        occupants.some(([c, floor]) => c === bay && floor === height)) continue;
    const inset = (neighbor) => neighbor > height ? 16 : neighbor === height ? 11 : -7;
    const left = inset(heights[bay - 1]), right = inset(heights[bay + 1]);
    const width = spans[bay] - left - right;
    if (width < 38) continue;
    const type = zone === 'hall' || zone === 'gallery' ? 'tile' : (bay + pattern) % 2 ? 'copper' : 'slate';
    const flank = height > (heights[bay - 1] ?? 0) || height > (heights[bay + 1] ?? 0);
    const score = (flank ? 3 : 0) + (zone === 'hall' || zone === 'tower' ? 2 : 0) +
      height * 0.12 + ((bay * 37 + pattern) % 29) / 29;
    choices.push({ bay, type, left, width, score });
  }
  choices.sort((a, b) => b.score - a.score);
  const limit = spans.length < 7 ? 1 : spans.length < 10 ? 2 : 3;
  for (const roof of choices) {
    if (result.has(roof.bay - 1) || result.has(roof.bay + 1)) continue;
    result.set(roof.bay, roof);
    if (result.size === limit) break;
  }
  return result;
}

export function roofVertices(width, height) {
  return [{ x: -width / 2, y: height / 3 }, { x: 0, y: -2 * height / 3 }, { x: width / 2, y: height / 3 }];
}

const pigments = {
  slate: ['#8097b2', '#526c8a', '#304763', '#152b41', '#a2b2c1', '#5d708b'],
  copper: ['#80ae9b', '#518674', '#306453', '#193f3c', '#c1c9aa', '#739987'],
  tile: ['#e0a26b', '#b96b41', '#86462f', '#552f2e', '#f0c28b', '#c58660'],
};
const roofArt = new Map();

export function prepareRoofArt() {
  if (roofArt.size) return;
  for (const [type, [sun, face, shade, dark, trim, glint]] of Object.entries(pigments)) {
    const canvas = document.createElement('canvas');
    const w = canvas.width = 384, h = canvas.height = 220;
    const ctx = canvas.getContext('2d'), apex = w / 2, ridge = w * 0.68;
    const path = (...points) => {
      ctx.beginPath(); ctx.moveTo(points[0], points[1]);
      for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
    };
    path(1, h-1, apex, 1, w-1, h-1);
    ctx.closePath(); ctx.clip();
    const light = ctx.createLinearGradient(0, 0, w * 0.65, h);
    light.addColorStop(0, sun); light.addColorStop(0.65, face); light.addColorStop(1, shade);
    ctx.fillStyle = light; ctx.fillRect(0, 0, w, h);
    path(apex, 0, w, h, ridge, h); ctx.fillStyle = shade; ctx.fill();
    // Courses widen towards the eave. The far hip recedes into shadow.
    for (let row = 0; row < 7; row++) {
      const top = h * (row / 7) ** 1.17, bottom = h * ((row + 1) / 7) ** 1.17;
      const depth = bottom / h, left = apex * (1 - depth), mid = apex + (ridge - apex) * depth;
      const right = w - left;
      const joints = Math.max(2, row + 2);
      ctx.lineWidth = 2 + depth * 1.8; ctx.strokeStyle = dark;
      path(left, bottom - 3, mid, bottom - 5, right, bottom - 2); ctx.stroke();
      ctx.strokeStyle = glint; ctx.lineWidth = 1 + depth * 1.7;
      path(left, bottom - 6, mid, bottom - 8); ctx.stroke();
      ctx.strokeStyle = shade; ctx.lineWidth = 2.1;
      for (let i = 1; i < joints; i++) {
        const fraction = (i - (row % 2) * 0.42) / joints;
        const x = left + (mid - left) * fraction;
        path(x - (x - apex) * (bottom-top) / bottom, top, x, bottom - 5); ctx.stroke();
      }
    }
    ctx.lineJoin = 'round'; ctx.strokeStyle = dark; ctx.lineWidth = 7;
    path(0, h - 1, apex, 1, w, h - 1); ctx.stroke();
    ctx.strokeStyle = trim; ctx.lineWidth = 3.7;
    path(1, h - 1, apex, 2, ridge, h); ctx.stroke();
    ctx.fillStyle = dark; ctx.fillRect(0, h - 10, w, 10);
    ctx.fillStyle = glint; ctx.fillRect(0, h - 11, w, 3);
    roofArt.set(type, canvas);
  }
}

export function drawRoof(ctx, roof) {
  prepareRoofArt();
  const w = roof.width, h = roof.height;
  ctx.drawImage(roofArt.get(roof.roofType), -w / 2, -2 * h / 3, w, h);
}
