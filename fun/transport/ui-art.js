import { createSprites } from './sprites.js';
import { drawRasterInfrastructure, drawRasterVehicle } from './raster-transport.js';
import { houseAssetsRevision } from './raster-houses.js';
import { worldArtRevision } from './atlas-runtime.js';
import { drawIsometricInfrastructure } from './isometric-infrastructure.js';
import { drawAirportPortrait, drawAircraftPortrait } from './airport-art.js';
import { lineFor } from './route-lines.js';

let profile = '', sprites;
const selector = '[data-building-sprite],[data-industry-sprite],[data-infrastructure-sprite],[data-vehicle-sprite]';

/** UI portraits use the same generated artwork and density selection as the map. */
export function drawUIArtwork(root, game) {
  const density = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const nextProfile = `${game.biome}:${density}`;
  if (profile !== nextProfile) {
    profile = nextProfile;
    sprites = createSprites(game.biome, { pixelScale: density * 2, detailLevel: 'detail' });
  }
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
    const identity = canvas.dataset.buildingSprite || canvas.dataset.industrySprite || canvas.dataset.infrastructureSprite || `${route?.mode}:${route?.cargo}:${vehicle?.level}${route?.mode === 'air' ? `:${lineFor(route).fill}` : ''}`;
    const key = `${profile}:${identity}:${houseAssetsRevision()}:${worldArtRevision()}`;
    if (canvas.dataset.artDrawn === key) continue;
    canvas.width = Math.round(width * density); canvas.height = Math.round(height * density);
    const context = canvas.getContext('2d');
    context.setTransform(density, 0, 0, density, 0, 0);
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    if (canvas.dataset.buildingSprite) {
      context.drawImage(sprites(canvas.dataset.buildingSprite, 0, 1), 16, 8, 64, 80);
    } else if (canvas.dataset.industrySprite) {
      context.drawImage(sprites(canvas.dataset.industrySprite, 0, 2), 8, 0, 96, 108);
    } else if (canvas.dataset.infrastructureSprite) {
      const size = Math.min(width, height);
      const kind=canvas.dataset.infrastructureSprite;
      // The airport and the plane are drawn natively: tower, terminal and a parked airliner on its apron.
      if(kind==='airport')drawAirportPortrait(context,width,height,{biome:game.biome});
      else if(!drawIsometricInfrastructure(context,kind,(width-size)/2,0,size,size,density)){
        context.save();context.translate(width/2,height/2);context.transform(.7,.35,-.7,.35,0,0);
        drawRasterInfrastructure(context,kind,-size/2,-size/2,size,size,density);context.restore();
      }
    } else if (route?.mode === 'air') {
      drawAircraftPortrait(context, width, height, { color: lineFor(route).fill });
    } else if (route) {
      const heading = Math.PI / 4, scale = route.mode === 'water' ? 1.4 : 2.2;
      context.translate(width / 2, height / 2); context.scale(scale, scale); context.rotate(heading);
      drawRasterVehicle(context, { ...vehicle, load: 0, angle: heading }, route, { heading, pixelScale: density * scale });
    }
    canvas.dataset.artDrawn = key;
  }
}
