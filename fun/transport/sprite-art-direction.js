// One scale and art direction for generated buildings and native fallbacks.
// Metres describe visual proportions; simulation distances remain grid tiles.
export const SPRITE_SCALE = Object.freeze({
  tileMetres: 16,
  worldPixelsPerMetre: 2,
  billboardPixelsPerTile: 72,
  masterCellPixels: 256,
  humanHeightMetres: 1.75,
  doorHeightMetres: 2.1,
  doorWidthMetres: 0.95,
  storeyHeightMetres: 3,
  windowHeightMetres: 1.2,
  fenceHeightMetres: 1.2,
  loadingBayHeightMetres: 4.2,
});

export function featureWorldPixels(metres) { return metres * SPRITE_SCALE.worldPixelsPerMetre; }
export function featureSpriteUnits(metres, footprint = 1) {
  return featureWorldPixels(metres) / (SPRITE_SCALE.billboardPixelsPerTile / 32 * footprint);
}
export function featureMasterPixels(metres, footprint = 1, cellPixels = SPRITE_SCALE.masterCellPixels) {
  return featureWorldPixels(metres) * cellPixels / (SPRITE_SCALE.billboardPixelsPerTile * footprint);
}

// The registered point is the centre of the architectural ground, not the
// lowest opaque pixel: shadows, gardens and overhanging roofs can change bounds.
// A whole 16m tile projects to 64x32 world pixels. The 72px frame provides
// filtering gutters around a cutout occupying almost the whole parcel.
export const BUILDING_REGISTRATION = Object.freeze({
  groundCenterMaster: Object.freeze([128, 192]),
  groundEdgeSlope: .5,
  architecturalEnvelopeMetresPerTile: 15,
  eastWorldPixelsPerMetre: Object.freeze([SPRITE_SCALE.worldPixelsPerMetre, SPRITE_SCALE.worldPixelsPerMetre / 2]),
  northWorldPixelsPerMetre: Object.freeze([-SPRITE_SCALE.worldPixelsPerMetre, SPRITE_SCALE.worldPixelsPerMetre / 2]),
  upWorldPixelsPerMetre: Object.freeze([0, -SPRITE_SCALE.worldPixelsPerMetre]),
});

export function projectBuildingMasterPoint(eastMetres, northMetres, heightMetres = 0, footprint = 1, cellPixels = SPRITE_SCALE.masterCellPixels) {
  if (![eastMetres, northMetres, heightMetres, cellPixels].every(Number.isFinite) || cellPixels <= 0 || !Number.isInteger(footprint) || footprint <= 0) throw new Error('Building registration needs finite coordinates and a positive footprint and cell size.');
  const pixelsPerMetre = featureMasterPixels(1, footprint, cellPixels);
  const [cx, cy] = BUILDING_REGISTRATION.groundCenterMaster.map(value => value * cellPixels / SPRITE_SCALE.masterCellPixels);
  return [cx + (eastMetres - northMetres) * pixelsPerMetre, cy + (eastMetres + northMetres) * pixelsPerMetre / 2 - heightMetres * pixelsPerMetre];
}

export function buildingGroundEnvelope(footprint = 1, cellPixels = SPRITE_SCALE.masterCellPixels) {
  const half = BUILDING_REGISTRATION.architecturalEnvelopeMetresPerTile * footprint / 2;
  return [[-half, -half], [half, -half], [half, half], [-half, half]].map(([east, north]) => projectBuildingMasterPoint(east, north, 0, footprint, cellPixels));
}

// Families share materials. Climate changes the ground and planting rather
// than assigning every building family a different set of wall and roof hues.
export const BUILDING_MATERIAL_PALETTE = Object.freeze({
  plaster: '#e3d7b7', stone: '#c7bca5', brick: '#b1846c', timber: '#997a5b',
  slate: '#697780', terracotta: '#a76f51', glass: '#769493', metal: '#6c7878',
  ink: '#4b5954', cream: '#f0e9d6', ochre: '#c2a269', burgundy: '#996b63',
  paving: '#cdc6ae', path: '#d8cfb2', water: '#658f9c',
});
export const BUILDING_PALETTES = Object.freeze({
  taiga: Object.freeze({ ...BUILDING_MATERIAL_PALETTE, ground: '#91a77a', foliage: '#758f63' }),
  tundra: Object.freeze({ ...BUILDING_MATERIAL_PALETTE, ground: '#cbd4c5', foliage: '#799588', snow: '#edf0e6' }),
  desert: Object.freeze({ ...BUILDING_MATERIAL_PALETTE, ground: '#c6b48b', foliage: '#899265' }),
});

export const BUILDING_STYLE = Object.freeze([
  'Fixed orthographic 2:1 dimetric camera: ground edges at +26.565 and -26.565 degrees, vertical walls, two visible facades, no perspective convergence.',
  'Lock every building, roof ridge, garden boundary, fence, court and yard to the same two ground axes. No in-plot yaw, diagonal rotation, camera tilt or camera rotation. An alternate entrance orientation swaps the two grid axes; it never rotates a building off-grid.',
  'Quiet hand-painted miniature architecture with clean silhouettes, broad roof and wall colour masses, restrained warm materials, northwest daylight and soft contact shadows.',
  'A consistent world scale: one tile is 16 metres square. A person is 1.75m tall; ordinary personnel doors are 2.1m high and 0.95m wide; storeys are 3m; windows are about 1.2m high; low fences are 1.2m. Vehicle loading bays are 4.2m high and visibly distinct from personnel doors.',
  'Bigger buildings gain additional rooms, wings, floors and repeated bays at the SAME human scale. Never enlarge doors, windows, people, garden fences or benches to fill a bigger parcel.',
  'Designed to remain recognizable at Region 0.5x and Town 1x: distinctive roofline, clear facade shading, a few large openings and broad planted clusters. No individual bricks, roof tiles, woodgrain scratches, tiny lettering, tiny flower dots, dense crate grids, fine handrails, thin window mullions or decorative speckle.',
  'Preserve useful large identifiers such as loading sheds, silos, greenhouses, chimneys, awnings and sports surfaces. No people as decorative scale filler, no text or logos.',
  'Use the supplied semantic muted material swatches across all families; maintain broad light and shaded facades within those hues. Give each identity a distinct roofline or one large identifying mass, with restrained slate, terracotta, foliage, ochre or burgundy accents. Recognition at Town size must come from silhouette and broad colour blocks, not tiny ornaments or texture.',
  'Use almost the whole occupied plot: distribute architecture, wings, working equipment, fences, paths and planted groups across a 15m envelope per 16m tile. Leave only a narrow setback. Houses retain a usable garden and low fence; farms retain their surrounding fields. Extend layouts with more rooms and bays at the shared human scale.',
  'Genuine RGBA transparency is the ground key for EVERY family. Leave ALL bare grass, snow, sand and generic earth transparent, including enclosed gardens and industry yards. Preserve isolated plants, contact shadows, paths, paving, courts, pools, crop beds and mineral heaps. No coloured ground diamond, lawn rim, backdrop card, raised plinth or scenery outside the plot. A sprite must composite over any world texture without a ground-colour patch.',
]);

export function buildingGenerationPrompt({ entries, columns = 3, rows = 3, biome = 'taiga', direction = '', cellPixels = 256 }) {
  if (![columns, rows].every(value => Number.isInteger(value) && value > 0) || !Number.isFinite(cellPixels) || cellPixels <= 0) throw new Error('Atlas dimensions and cell size must be positive.');
  if (!Array.isArray(entries) || entries.length !== columns * rows) throw new Error('One entry is required for every atlas slot.');
  const climate = { taiga:'Temperate green grass, muted red brick, pale plaster, timber, slate and terracotta roofs.', tundra:'Cool pale grass, restrained snow caps and evergreen planting; preserve every physical dimension.', desert:'Warm dusty sand, pale stone and plaster, terracotta and sparse dry planting; preserve every physical dimension.' }[biome];
  if (!climate) throw new Error('Unknown building climate.');
  const swatches = `Canonical ${biome} material swatches: ${Object.entries(BUILDING_PALETTES[biome]).map(([material, color]) => `${material} ${color}`).join('; ')}. These are restrained painted colour targets, with soft light/shade variation, not saturated replacements.`;
  const envelope = buildingGroundEnvelope(1, cellPixels).map(([x, y]) => `(${x.toFixed(1)},${y.toFixed(1)})`).join(', ');
  const registration = `Physical ground registration in every ${cellPixels}px square cell: parcel centre is (${(cellPixels / 2).toFixed(1)},${(cellPixels * .75).toFixed(1)}), independent of alpha bounds, shadows, roof height and planting. Around that centre project east/north/up metres with x=(east-north)*2 and y=(east+north)-height*2 in world pixels, then multiply by ${cellPixels}/(${SPRITE_SCALE.billboardPixelsPerTile}*footprint). The architectural/garden envelope spans ${BUILDING_REGISTRATION.architecturalEnvelopeMetresPerTile}m*footprint square; its exact 2:1 ground vertices are ${envelope}. Use the available plot width while keeping physical metre scale and transparent bare ground. Register the actual ground centre, never the silhouette bottom or contact-shadow extremity. Keep all complete architecture and planting inside the transparent cell with filtering gutters.`;
  const slots = entries.map((entry, index) => {
    if (!entry) return `Slot ${index + 1}: EMPTY transparent cell.`;
    const footprint = entry.footprint ?? 1;
    if (!Number.isInteger(footprint) || footprint <= 0) throw new Error(`Slot ${index + 1} needs a positive integer footprint.`);
    return `Slot ${index + 1}: ${entry.name || entry.id}; ${footprint}x${footprint} tile parcel (${footprint * SPRITE_SCALE.tileMetres}m square). At a ${cellPixels}px normalized cell, personnel door height is ${featureMasterPixels(SPRITE_SCALE.doorHeightMetres, footprint, cellPixels).toFixed(1)}px, a storey ${featureMasterPixels(SPRITE_SCALE.storeyHeightMetres, footprint, cellPixels).toFixed(1)}px and a low fence ${featureMasterPixels(SPRITE_SCALE.fenceHeightMetres, footprint, cellPixels).toFixed(1)}px. ${entry.description || ''}`;
  });
  return [...BUILDING_STYLE, `Production ${columns}x${rows} atlas, exactly ${entries.length} slots in row-major order; each cell is a registered architectural cutout at the stated parcel scale, not a close-up of the building. Follow each slot's parcel-to-cell calibration: equal footprints share one pixel-to-metre scale; larger footprints have proportionally smaller doors in the normalized cell so they render at the same world height. Do not give different footprint tiers equal door pixel heights. Do not independently fit each building's bounding box.`, registration, climate, swatches, direction, ...slots].filter(Boolean).join('\n');
}
