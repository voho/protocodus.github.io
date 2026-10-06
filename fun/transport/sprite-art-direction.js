// One scale and art direction for generated buildings and native fallbacks.
// Metres describe visual proportions; simulation distances remain grid tiles.
export const SPRITE_SCALE = Object.freeze({
  tileMetres: 16,
  worldPixelsPerMetre: 2,
  billboardPixelsPerTile: 48,
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
  return featureWorldPixels(metres) / (1.5 * footprint);
}
export function featureMasterPixels(metres, footprint = 1, cellPixels = SPRITE_SCALE.masterCellPixels) {
  return featureWorldPixels(metres) * cellPixels / (SPRITE_SCALE.billboardPixelsPerTile * footprint);
}

export const BUILDING_STYLE = Object.freeze([
  'Fixed orthographic 2:1 dimetric camera: ground edges at +26.565 and -26.565 degrees, vertical walls, two visible facades, no perspective convergence.',
  'Quiet hand-painted miniature architecture with clean silhouettes, broad roof and wall colour masses, restrained warm materials, northwest daylight and soft contact shadows.',
  'A consistent world scale: one tile is 16 metres square. A person is 1.75m tall; ordinary personnel doors are 2.1m high and 0.95m wide; storeys are 3m; windows are about 1.2m high; low fences are 1.2m. Vehicle loading bays are 4.2m high and visibly distinct from personnel doors.',
  'Bigger buildings gain additional rooms, wings, floors and repeated bays at the SAME human scale. Never enlarge doors, windows, people, garden fences or benches to fill a bigger parcel.',
  'Designed to remain recognizable at Region 0.5x and Town 1x: distinctive roofline, clear facade shading, a few large openings and broad planted clusters. No individual bricks, roof tiles, woodgrain scratches, tiny lettering, tiny flower dots, dense crate grids, fine handrails, thin window mullions or decorative speckle.',
  'Preserve useful large identifiers such as loading sheds, silos, greenhouses, chimneys, awnings and sports surfaces. No people as decorative scale filler, no text or logos.',
  'Genuine transparent background, isolated complete sprites with generous transparent gutters. No scenery outside the parcel, no backdrop cards or opaque plinth. Gardens blend with the climate terrain.',
]);

export function buildingGenerationPrompt({ entries, columns = 3, rows = 3, biome = 'taiga', direction = '', cellPixels = 256 }) {
  if (![columns, rows].every(value => Number.isInteger(value) && value > 0) || !Number.isFinite(cellPixels) || cellPixels <= 0) throw new Error('Atlas dimensions and cell size must be positive.');
  if (!Array.isArray(entries) || entries.length !== columns * rows) throw new Error('One entry is required for every atlas slot.');
  const climate = { taiga:'Temperate green grass, muted red brick, pale plaster, timber, slate and terracotta roofs.', tundra:'Cool pale grass, restrained snow caps and evergreen planting; preserve every physical dimension.', desert:'Warm dusty sand, pale stone and plaster, terracotta and sparse dry planting; preserve every physical dimension.' }[biome];
  if (!climate) throw new Error('Unknown building climate.');
  const slots = entries.map((entry, index) => {
    if (!entry) return `Slot ${index + 1}: EMPTY transparent cell.`;
    const footprint = entry.footprint ?? 1;
    if (!Number.isInteger(footprint) || footprint <= 0) throw new Error(`Slot ${index + 1} needs a positive integer footprint.`);
    return `Slot ${index + 1}: ${entry.name || entry.id}; ${footprint}x${footprint} tile parcel (${footprint * SPRITE_SCALE.tileMetres}m square). At a ${cellPixels}px normalized cell, personnel door height is ${featureMasterPixels(SPRITE_SCALE.doorHeightMetres, footprint, cellPixels).toFixed(1)}px, a storey ${featureMasterPixels(SPRITE_SCALE.storeyHeightMetres, footprint, cellPixels).toFixed(1)}px and a low fence ${featureMasterPixels(SPRITE_SCALE.fenceHeightMetres, footprint, cellPixels).toFixed(1)}px. ${entry.description || ''}`;
  });
  return [...BUILDING_STYLE, `Production ${columns}x${rows} atlas, exactly ${entries.length} slots in row-major order; each cell represents the stated full parcel, not a close-up of the building. Follow each slot's parcel-to-cell calibration: equal footprints share one pixel-to-metre scale; larger footprints have proportionally smaller doors in the normalized cell so they render at the same world height. Do not give different footprint tiers equal door pixel heights. Do not independently fit each building's bounding box.`, climate, direction, ...slots].filter(Boolean).join('\n');
}
