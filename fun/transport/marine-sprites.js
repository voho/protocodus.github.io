// Generated marine art is cached at each view's display density. The native
// drawings below are recovery artwork while PNGs load or cannot be fetched.
// Eight authored headings keep hull edges stable on the water grid.
import { drawRasterVehicle } from './raster-transport.js';
import { worldArtRevision } from './atlas-runtime.js';
import { createSpriteCache } from './sprite-cache.js';
import { drawNativeVehicle, drawNativePort } from './native-transport-art.js';
export const MARINE_SIZE = 64;
function line(c,points,color,width=.8){c.strokeStyle=color;c.lineWidth=width;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();}

export function createMarineSprites({ pixelScale = 1, detailLevel = 'town', cache:sharedCache=null } = {}) {
  const scale = Math.max(.25, Number(pixelScale) || 1), cache = sharedCache||createSpriteCache({limit:32*1024*1024}),prefix=`marine:${scale}:${detailLevel}:`;
  // A mixed fleet readily exceeds 64 heading/cargo/color combinations. Bound
  // the backing pixels instead, so a harbor does not rebuild every ship on
  // every frame just because another route entered the view.
  let revision=worldArtRevision(),created=0,hits=0;cache.syncRevision(revision);
  function raster(key, angle, draw) {
    if(revision!==worldArtRevision()){revision=worldArtRevision();cache.syncRevision(revision);}
    key=prefix+key;const cached=cache.get(key);if(cached){hits++;return cached;}
    const image = document.createElement('canvas'); image.width = image.height = Math.ceil(MARINE_SIZE * scale);
    const c = image.getContext('2d'); c.scale(scale, scale); c.translate(MARINE_SIZE / 2, MARINE_SIZE / 2); c.rotate(angle); draw(c);
    cache.set(key, image);created++;return image;
  }
  return {
    ship(vehicle, route) {
      const heading = ((Math.round((Number.isFinite(vehicle.angle) ? vehicle.angle : 0) / (Math.PI / 4)) % 8) + 8) % 8;
      const ratio = Math.max(0, Math.min(1, (vehicle.load || 0) / Math.max(1, vehicle.capacity || 1))), band = ratio ? Math.max(1, Math.ceil(ratio * 3)) : 0;
      const cargo = route?.cargo || 'goods', color = route?.color || '#a66d4b';
      return raster(`ship:${heading}:${cargo}:${band}:${color}`, heading * Math.PI / 4, c => {if(!drawRasterVehicle(c,vehicle,{...route,mode:'water'},{pixelScale:scale,heading:heading*Math.PI/4})){c.rotate(-heading*Math.PI/4);drawNativeVehicle(c,vehicle,{...route,mode:'water'},{heading:heading*Math.PI/4});}});
    },
    port(landAngle) {
      const heading = ((Math.round((landAngle - Math.PI) / (Math.PI / 2)) % 4) + 4) % 4;
      return raster(`port:${heading}`, 0, c => drawNativePort(c,{heading:heading*Math.PI/2,detail:detailLevel}));
    },
    getStats: () => ({ ...cache.getStats(),count:cache.getStats().entries,created,hits,pixelScale: scale, size: Math.ceil(MARINE_SIZE * scale),shared:Boolean(sharedCache) }),
  };
}

export function drawShipWake(c, vehicle, now, profile = 'town') {
  if (vehicle.dwellRemaining > 0 || vehicle.waiting) return;
  c.save(); c.translate((vehicle.x + .5) * 32, (vehicle.y + .5) * 32); c.rotate(Number.isFinite(vehicle.angle) ? vehicle.angle : 0);
  const phase = Math.sin(now * .004 + vehicle.x * 2 + vehicle.y) * .65, regional = profile === 'region';
  line(c, [[-15, -3], [-22, -4.4], [-29, -6 + phase]], '#d0e3d679', regional ? 1.8 : 1.1);
  line(c, [[-15, 3], [-22, 4.4], [-29, 6 - phase]], '#d0e3d679', regional ? 1.8 : 1.1);
  if (!regional) { line(c, [[-18, -.7], [-24, phase], [-31, .5]], '#d9eadd65', 1.1); line(c, [[12, -4], [17, -2], [19, 0], [17, 2], [12, 4]], '#e0ecda6d', .75); }
  c.restore();
}
