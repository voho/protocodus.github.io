import { createSprites } from './sprites.js';
import { industryFootprint } from './industry-sites.js';
import { drawRasterInfrastructure, drawRasterNetwork, drawRasterVehicle } from './raster-transport.js';
import { houseAssetsRevision } from './raster-houses.js';
import { worldArtRevision } from './atlas-runtime.js';
import { drawIsometricInfrastructure } from './isometric-infrastructure.js';
import { drawAirportPortrait, drawAircraftPortrait } from './airport-art.js';
import { lineFor } from './route-lines.js';
import { drawFarmPortrait } from './farm-fields-art.js';
import { BUILDINGS } from './buildings.js';
import { WORKSHOP } from './data.js';
import { createSpriteCache } from './sprite-cache.js';

const selector = '[data-building-sprite],[data-industry-sprite],[data-infrastructure-sprite],[data-vehicle-sprite]';
const prepared = createSpriteCache({ limit: 32 * 1024 * 1024 });
const spriteBanks = new Map(), bankDensities = new WeakMap(), portraitBounds = new WeakMap();

export const artworkDensity = () => Math.min(2, Math.max(1, window.devicePixelRatio || 1));

function spriteBank(biome, pixelScale) {
  const key = `${biome}:${pixelScale}`;
  let sprites = spriteBanks.get(key);
  if (sprites) spriteBanks.delete(key);
  else {
    sprites = createSprites(biome, { pixelScale, detailLevel: 'detail', cache: prepared });
    bankDensities.set(sprites, pixelScale);
  }
  spriteBanks.set(key, sprites);
  // Factories are small closures; their images share one bounded byte budget.
  // Keep recent display densities across all three preview climates.
  if (spriteBanks.size > 18) spriteBanks.delete(spriteBanks.keys().next().value);
  return sprites;
}

/** Prepare enough source pixels for the destination, including small houses. */
export function portraitSprites(biome, width, height, footprint = 1, density = artworkDensity()) {
  const required = Math.max(width, height) * density / (32 * Math.max(1, footprint));
  return spriteBank(biome, 2 ** Math.ceil(Math.log2(Math.max(1, required))));
}

function visibleBounds(image) {
  let bounds = portraitBounds.get(image);
  if (!bounds) {
    const pixels = image.getContext('2d').getImageData(0, 0, image.width, image.height).data;
    let left = image.width, top = image.height, right = -1, bottom = -1;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (pixels[(y * image.width + x) * 4 + 3]) {
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    bounds = right < left ? { x: 0, y: 0, width: image.width, height: image.height } : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
    portraitBounds.set(image, bounds);
  }
  return bounds;
}

const fitScale = (bounds, width, height, inset) => Math.min(Math.max(1, width - inset * 2) / bounds.width, Math.max(1, height - inset * 2) / bounds.height);

/** Alpha fitting may need sharper art than the padded parcel frame suggests. */
export function portraitSprite(biome, kind, variant, level, detail, footprint, { width, height, density = artworkDensity(), inset = 6 } = {}) {
  const sprites = portraitSprites(biome, width, height, footprint, density);
  let image = sprites(kind, variant, level, detail, footprint);
  const enlargement = fitScale(visibleBounds(image), width, height, inset) * density;
  if (enlargement > 1 + 1e-7) {
    const pixelScale = 2 ** Math.ceil(Math.log2(bankDensities.get(sprites) * enlargement));
    image = spriteBank(biome, pixelScale)(kind, variant, level, detail, footprint);
  }
  return image;
}

/** Fit the complete visible parcel, fence and shadow without stretching it. */
export function drawSpritePortrait(context, image, { x = 0, y = 0, width, height, inset = 6 } = {}) {
  const bounds = visibleBounds(image);
  const scale = fitScale(bounds, width, height, inset);
  const w = bounds.width * scale, h = bounds.height * scale;
  context.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height, x + (width - w) / 2, y + (height - h) / 2, w, h);
}

// Ground/network previews need a separate padded projected frame. A square
// card transformed directly into a diamond can exceed the destination canvas,
// especially the native rail bridge's rounded deck ends.
function networkPortrait(kind, width, height, density) {
  const scale=2 ** Math.ceil(Math.log2(Math.max(1,Math.max(width,height)*density/44)));
  const key=`ui-network:${kind}:${scale}:${worldArtRevision()}`;
  let image=prepared.get(key);
  if(image)return image;
  image=document.createElement('canvas');image.width=image.height=96*scale;
  const c=image.getContext('2d');c.scale(scale,scale);c.translate(48,48);c.transform(.7,.35,-.7,.35,0,0);
  if(['road','road-bridge'].includes(kind))drawRasterNetwork(c,kind,0,0,[[0,-1],[0,1]],scale,{detailLevel:'detail'});
  else drawRasterInfrastructure(c,kind,-16,-16,32,32,scale);
  prepared.set(key,image);return image;
}

/** UI portraits use the same generated artwork and density selection as the map. */
export function drawUIArtwork(root, game) {
  const density = artworkDensity(), profile = `${game.biome}:${density}`;
  const canvases = root.querySelectorAll(selector);
  // Resolve portraits once per panel, never scan the entire fleet per canvas.
  const needsFleet = [...canvases].some(canvas => canvas.dataset.vehicleSprite && canvas.dataset.vehicleSprite !== 'purchase');
  const routes = needsFleet ? new Map(game.routes.map(route => [String(route.id), route])) : null;
  const vehicles = new Map();
  if (needsFleet) for (const vehicle of game.vehicles) {
    const id = String(vehicle.routeId);
    if (!vehicles.has(id)) vehicles.set(id, vehicle);
  }
  for (const canvas of canvases) {
    const width = Number(canvas.dataset.artWidth ||= canvas.width);
    const height = Number(canvas.dataset.artHeight ||= canvas.height);
    const route = canvas.dataset.vehicleSprite === 'purchase'
      ? { mode: canvas.dataset.mode, cargo: canvas.dataset.cargo }
      : routes?.get(canvas.dataset.vehicleSprite);
    const vehicle = route && (canvas.dataset.vehicleSprite === 'purchase'
      ? { level: Number(canvas.dataset.level), load: 0, capacity: 1 }
      : vehicles.get(String(route.id)));
    const buildingVariant = Number(canvas.dataset.buildingVariant) || 0;
    const buildingFootprint = Number(canvas.dataset.buildingFootprint) || BUILDINGS[canvas.dataset.buildingSprite]?.footprint || (canvas.dataset.buildingSprite === 'factory' ? WORKSHOP.footprint : 1);
    const buildingLevel = Number(canvas.dataset.buildingLevel) || 1;
    const industrySize = Number(canvas.dataset.industryFootprint) || industryFootprint(canvas.dataset.industrySprite);
    const industryVariant = Number(canvas.dataset.industryVariant) || 0;
    const identity = canvas.dataset.buildingSprite ? `${canvas.dataset.buildingSprite}:${buildingVariant}:${buildingFootprint}:${buildingLevel}` : canvas.dataset.industrySprite ? `${canvas.dataset.industrySprite}:${industrySize}:${industryVariant}` : canvas.dataset.infrastructureSprite ? `${canvas.dataset.infrastructureSprite}:${canvas.dataset.infrastructureAxis || 'x'}` : `${route?.mode}:${route?.cargo}:${vehicle?.level}${route?.mode === 'air' ? `:${lineFor(route).fill}` : ''}`;
    const key = `${profile}:${width}:${height}:${identity}:${houseAssetsRevision()}:${worldArtRevision()}`;
    if (canvas.dataset.artDrawn === key) continue;
    canvas.width = Math.round(width * density); canvas.height = Math.round(height * density);
    const context = canvas.getContext('2d');
    context.setTransform(density, 0, 0, density, 0, 0);
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    if (canvas.dataset.buildingSprite) {
      const sprite = portraitSprite(game.biome, canvas.dataset.buildingSprite, buildingVariant, buildingLevel, '', buildingFootprint, { width, height, density });
      drawSpritePortrait(context, sprite, { width, height });
    } else if (canvas.dataset.industrySprite) {
      const kind = canvas.dataset.industrySprite;
      if (industrySize < 5 || !drawFarmPortrait(context, kind, game.biome, { x: 6, y: 6, width: width - 12, height: height - 12, pixelScale: density, variant: industryVariant, footprint: industrySize })) {
        const image = portraitSprite(game.biome, kind, industryVariant, industrySize, '', industrySize, { width, height, density });
        drawSpritePortrait(context, image, { width, height });
      }
    } else if (canvas.dataset.infrastructureSprite) {
      const size = Math.min(width, height);
      const kind=canvas.dataset.infrastructureSprite;
      // Airport components and runway use the same full layout as the map.
      if(kind==='airport')drawAirportPortrait(context,width,height,{biome:game.biome,axis:canvas.dataset.infrastructureAxis || 'x'});
      else if(!drawIsometricInfrastructure(context,kind,(width-size)/2,0,size,size,density)){
        const image=networkPortrait(kind,width,height,density);
        drawSpritePortrait(context,image,{width,height});
      }
    } else if (route?.mode === 'air') {
      drawAircraftPortrait(context, width, height, { color: lineFor(route).fill });
    } else if (route) {
      const heading = Math.PI / 4, ship = route.mode === 'water';
      // Fill large Gallery cards while retaining the authored 256px source
      // ceiling at Retina density and fitting smaller route/inspector cards.
      const scale = Math.min(ship ? 2.9 : 6, Math.max(1, Math.min(width, height) - 12) / (ship ? 43 : 20));
      context.translate(width / 2, height / 2); context.scale(scale, scale); context.rotate(heading);
      drawRasterVehicle(context, { ...vehicle, load: 0, angle: heading }, route, { heading, pixelScale: density * scale });
    }
    canvas.dataset.artDrawn = key;
  }
}
