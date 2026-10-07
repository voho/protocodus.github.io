#!/usr/bin/env node
// A construction guide for image generation, not an artwork style replacement.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { BUILDING_PALETTES, BUILDING_REGISTRATION, SPRITE_SCALE, buildingGroundEnvelope, featureMasterPixels, projectBuildingMasterPoint } from '../sprite-art-direction.js';
import { BUILDINGS } from '../buildings.js';
import { HOUSE_KINDS } from '../raster-houses.js';

const points = vertices => vertices.map(point => point.map(value => value.toFixed(3)).join(',')).join(' ');
const label = (x, y, text, size = 14, extra = '') => `<text x="${x}" y="${y}" font-size="${size}" ${extra}>${text}</text>`;
const shade = (color, factor) => `#${[1, 3, 5].map(offset => Math.max(0, Math.min(255, Math.round(parseInt(color.slice(offset, offset + 2), 16) * factor))).toString(16).padStart(2, '0')).join('')}`;

// Exact production-cell geometry, without annotations that a generator could
// copy into the delivered artwork. These simple volumes demonstrate physical
// proportions and garden placement; generated art supplies the painted style.
export function houseReferenceSvg(biome = 'taiga', rotation = 0) {
  const palette = BUILDING_PALETTES[biome];
  if (!palette) throw new Error('Unknown building climate.');
  if (![0, 1].includes(rotation)) throw new Error('House orientation must be 0 or 1.');
  const shapes = HOUSE_KINDS.map((kind, index) => {
    const footprint = BUILDINGS[kind].footprint;
    const p = (east, north, height = 0) => rotation ? projectBuildingMasterPoint(north, east, height, footprint) : projectBuildingMasterPoint(east, north, height, footprint);
    const polygon = (vertices, fill) => `<polygon points="${points(vertices)}" fill="${fill}"/>`;
    const line = (vertices, color, width = 1) => `<polyline points="${points(vertices)}" fill="none" stroke="${color}" stroke-width="${width.toFixed(3)}" stroke-linejoin="round" stroke-linecap="round"/>`;
    const flat = (u0, v0, u1, v1, color, z = 0) => polygon([p(u0, v0, z), p(u1, v0, z), p(u1, v1, z), p(u0, v1, z)], color);
    const frontOpening = (u, v, width, bottom, height, color) => polygon([p(u - width / 2, v, bottom), p(u + width / 2, v, bottom), p(u + width / 2, v, bottom + height), p(u - width / 2, v, bottom + height)], color);
    const sideOpening = (u, v, width, bottom, height, color) => polygon([p(u, v - width / 2, bottom), p(u, v + width / 2, bottom), p(u, v + width / 2, bottom + height), p(u, v - width / 2, bottom + height)], color);
    function volume(u0, v0, u1, v1, height, wall, roofColor, pitched = true) {
      const faces = [
        polygon([p(u0, v1), p(u1, v1), p(u1, v1, height), p(u0, v1, height)], rotation ? shade(wall, .78) : wall),
        polygon([p(u1, v0), p(u1, v1), p(u1, v1, height), p(u1, v0, height)], rotation ? wall : shade(wall, .78)),
      ];
      const vm = (v0 + v1) / 2, rise = pitched ? Math.min(2.2, (v1 - v0) * .3) : 0;
      if (pitched) {
        faces.push(polygon([p(u0, v0, height), p(u1, v0, height), p(u1, vm, height + rise), p(u0, vm, height + rise)], shade(roofColor, .86)));
        faces.push(polygon([p(u1, v0, height), p(u1, v1, height), p(u1, vm, height + rise)], rotation ? shade(wall, 1.03) : shade(wall, .78)));
        faces.push(polygon([p(u0, v1, height), p(u1, v1, height), p(u1, vm, height + rise), p(u0, vm, height + rise)], roofColor));
      } else faces.push(flat(u0, v0, u1, v1, roofColor, height));
      // Two broad window openings per facade and floor, at true human height.
      for (let floor = 0; floor < height / SPRITE_SCALE.storeyHeightMetres; floor++) {
        const bottom = floor * SPRITE_SCALE.storeyHeightMetres + .8;
        for (const u of [u0 + (u1 - u0) * .22, u0 + (u1 - u0) * .78]) faces.push(frontOpening(u, v1, 1.1, bottom, SPRITE_SCALE.windowHeightMetres, palette.glass));
        faces.push(sideOpening(u1, v0 + (v1 - v0) * .38, 1.1, bottom, SPRITE_SCALE.windowHeightMetres, shade(palette.glass, .8)));
      }
      faces.push(frontOpening((u0 + u1) / 2, v1, SPRITE_SCALE.doorWidthMetres, 0, SPRITE_SCALE.doorHeightMetres, palette.ink));
      return faces.join('\n');
    }
    // The canonical envelope fills the available parcel at the shared metre
    // scale. Garden ground remains transparent for any underlying texture.
    const half = BUILDING_REGISTRATION.architecturalEnvelopeMetresPerTile * footprint / 2;
    const fenceHeight = SPRITE_SCALE.fenceHeightMetres, fenceWidth = featureMasterPixels(.12, footprint);
    const farFence = line([p(-half, half, fenceHeight), p(-half, -half, fenceHeight), p(half, -half, fenceHeight)], palette.cream, fenceWidth);
    const nearFence = line([p(-half, half, fenceHeight), p(-footprint * .7, half, fenceHeight)], palette.cream, fenceWidth) + line([p(footprint * .7, half, fenceHeight), p(half, half, fenceHeight), p(half, -half, fenceHeight)], palette.cream, fenceWidth);
    const fencePosts = [-1, -.5, 0, .5, 1].flatMap(step => [line([p(-half, step * half), p(-half, step * half, fenceHeight)], palette.cream, fenceWidth), line([p(half, step * half), p(half, step * half, fenceHeight)], palette.cream, fenceWidth)]).join('');
    const house = index === 0 ? volume(-3, -2.8, 3, 1.8, 3, palette.plaster, palette.terracotta)
      : index === 1 ? volume(-2.4, -3.2, 2.4, 2.2, 3, palette.timber, palette.slate)
      : index === 2 ? volume(-3.7, -2.7, 3.7, 1.5, 3, palette.plaster, palette.terracotta)
      : index === 3 ? volume(-3.3, -3.1, 3.3, 2.5, 6, palette.plaster, palette.slate)
      : index === 4 ? volume(-3.7, -3.1, 3.7, 2.3, 6, palette.brick, palette.terracotta)
      : index === 5 ? volume(-3.8, -3.1, 3.8, 2.1, 3, palette.stone, palette.slate, false)
      : index === 6 ? volume(-8, -4.6, -4.1, 3.1, 3, palette.stone, palette.slate) + volume(4.1, -4.6, 8, 3.1, 3, palette.stone, palette.slate) + volume(-4.1, -5.2, 4.1, 3.7, 6, palette.plaster, palette.slate)
      : index === 7 ? volume(-5.5, -5.8, 5.5, 4.2, 6, palette.brick, palette.slate)
      : volume(-7.5, -6.5, 7.5, -1.8, 6, palette.plaster, palette.terracotta) + volume(-7.5, -1.8, -3.6, 5.8, 3, palette.stone, palette.terracotta) + volume(3.6, -1.8, 7.5, 5.8, 3, palette.stone, palette.terracotta);
    const shrubs = [-1, 1].map(side => {
      const [x, y] = p(side * half * .76, -half * .73, .9);
      const radius = featureMasterPixels(1.2, footprint);
      return `<ellipse cx="${x}" cy="${y}" rx="${radius}" ry="${radius * .65}" fill="${palette.foliage}"/>`;
    }).join('');
    return `<g transform="translate(${index % 3 * 256},${Math.floor(index / 3) * 256})">${flat(-.6, 0, .6, half, palette.path)}${farFence}${shrubs}${house}${nearFence}${fencePosts}</g>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="768" viewBox="0 0 768 768">\n${shapes}\n</svg>\n`;
}

export function buildingReferenceSvg(biome = 'taiga') {
  const palette = BUILDING_PALETTES[biome];
  if (!palette) throw new Error('Unknown building climate.');
  const panels = [1, 2, 5].map((footprint, index) => {
    const p = (east, north, height = 0) => projectBuildingMasterPoint(east, north, height, footprint);
    const half = BUILDING_REGISTRATION.architecturalEnvelopeMetresPerTile * footprint / 2;
    const width = footprint === 1 ? 6 : footprint === 2 ? 14 : 32;
    const depth = footprint === 1 ? 5 : footprint === 2 ? 8 : 14;
    const front = depth / 2, east = width / 2, z = SPRITE_SCALE.storeyHeightMetres * 2;
    const doorEast = -width / 4, doorHalf = SPRITE_SCALE.doorWidthMetres / 2;
    const door = [p(doorEast - doorHalf, front), p(doorEast + doorHalf, front), p(doorEast + doorHalf, front, SPRITE_SCALE.doorHeightMetres), p(doorEast - doorHalf, front, SPRITE_SCALE.doorHeightMetres)];
    const personBase = p(-half * .72, half * .75), personTop = [personBase[0], personBase[1] - featureMasterPixels(SPRITE_SCALE.humanHeightMetres, footprint)];
    const eastAxis = [p(-half, 0), p(half, 0)], northAxis = [p(0, -half), p(0, half)];
    return `<g transform="translate(${36 + index * 328},164)">
      ${label(128, -42, `${footprint} × ${footprint} tiles · ${footprint * 16}m parcel`, 17, 'text-anchor="middle" font-weight="600"')}
      ${label(128, -18, `${BUILDING_REGISTRATION.architecturalEnvelopeMetresPerTile * footprint}m envelope · 256px master`, 14, 'text-anchor="middle"')}
      <rect width="256" height="256" fill="#fff" stroke="#adb4ae" stroke-dasharray="4 4"/>
      <polygon points="${points(buildingGroundEnvelope(footprint))}" fill="${palette.ground}" fill-opacity=".18" stroke="${palette.ink}" stroke-width="1.5"/>
      <polyline points="${points(eastAxis)}" fill="none" stroke="#b48369" stroke-width="1" stroke-dasharray="4 3"/>
      <polyline points="${points(northAxis)}" fill="none" stroke="#769493" stroke-width="1" stroke-dasharray="4 3"/>
      <polygon points="${points([p(-east, front), p(east, front), p(east, front, z), p(-east, front, z)])}" fill="${palette.plaster}" stroke="${palette.ink}" stroke-width=".7"/>
      <polygon points="${points([p(east, -front), p(east, front), p(east, front, z), p(east, -front, z)])}" fill="${palette.stone}" stroke="${palette.ink}" stroke-width=".7"/>
      <polygon points="${points([p(-east, -front, z), p(east, -front, z), p(east, front, z), p(-east, front, z)])}" fill="${palette.slate}" stroke="${palette.ink}" stroke-width=".7"/>
      <polygon points="${points(door)}" fill="${palette.ink}"/>
      <polyline points="${points([personBase, personTop])}" fill="none" stroke="${palette.ochre}" stroke-width="1.8"/>
      <circle cx="${personTop[0]}" cy="${personTop[1]}" r="1.3" fill="${palette.ochre}"/>
      <circle cx="128" cy="192" r="3" fill="#fff" stroke="${palette.ink}"/>
      <path d="M121 192h14M128 185v14" fill="none" stroke="${palette.ink}" stroke-width=".7"/>
      ${label(128, 281, 'Ground centre (128,192)', 14, 'text-anchor="middle"')}
      ${label(128, 302, `Door ${featureMasterPixels(2.1, footprint).toFixed(2)}px · person ${featureMasterPixels(1.75, footprint).toFixed(2)}px`, 13, 'text-anchor="middle"')}
      ${label(128, 322, `3m storey ${featureMasterPixels(3, footprint).toFixed(2)}px`, 13, 'text-anchor="middle"')}
    </g>`;
  }).join('\n');
  const swatches = Object.entries(palette).map(([material, color], index) => {
    const x = 36 + index % 8 * 122, y = 546 + Math.floor(index / 8) * 55;
    return `<rect x="${x}" y="${y}" width="20" height="20" fill="${color}" stroke="#69766e" stroke-width=".5"/>${label(x + 26, y + 14, material, 12)}${label(x + 26, y + 30, color, 10)}`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="736" viewBox="0 0 1040 736">
    <rect width="1040" height="736" fill="#f6f4ed"/>
    <g fill="${palette.ink}" font-family="Arial, sans-serif">
      ${label(36, 36, 'Transport · exact building geometry and shared materials', 23, 'font-weight="600"')}
      ${label(36, 62, 'Construction guide: retain the painted style; never copy guide labels, grid lines or reference people.', 14)}
      ${label(36, 87, 'Ground edges ±26.565° / slopes ±0.5 · upright walls · no off-grid yaw or camera rotation.', 14)}
      ${panels}
      ${label(36, 526, `Canonical ${biome} swatches · broad painted masses and northwest light`, 16, 'font-weight="600"')}
      ${swatches}
      ${label(36, 724, 'Native terrain supplies the full 16m parcel. Alpha bounds and shadow tips never define the physical ground centre.', 13)}
    </g>
  </svg>\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), [output, biome = 'taiga'] = args.filter(arg => !arg.startsWith('--'));
  const rotation = Number(args.find(arg => arg.startsWith('--rotation='))?.split('=')[1] || 0);
  const svg = args.includes('--houses') ? houseReferenceSvg(biome, rotation) : buildingReferenceSvg(biome);
  if (output) await writeFile(output, svg);
  else process.stdout.write(svg);
}
