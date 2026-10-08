import { tileSurface, surfaceHeight, HEIGHT_STEP } from './terrain-geometry.js';

const TILE = 32;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
function normalLight(nx, ny, nz) {
  const length = Math.hypot(nx, ny, nz);
  if (!length) return 1;
  // Upper-left sunlight agrees with the buildings and lower-right shadows.
  return clamp(1 + ((-.75 * nx - .55 * ny + nz) / length - 1) * .52, .72, 1.16);
}

// Lighting follows the surface normal in world space. A horizontal face keeps
// its authored color; broad northwest slopes brighten and opposite slopes dim.
export function facetLight(triangle, heightStep = HEIGHT_STEP) {
  const [a, b, c] = triangle;
  const ax = (b.u - a.u) * TILE, ay = (b.v - a.v) * TILE, az = (b.height - a.height) * heightStep;
  const bx = (c.u - a.u) * TILE, by = (c.v - a.v) * TILE, bz = (c.height - a.height) * heightStep;
  let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
  return normalLight(nx, ny, nz);
}

// Shared vertices average the slopes on either side, so a quantized height
// change reads as part of the hillside instead of an isolated dark triangle.
// This reads the same bounded height field as projection and construction.
export function terrainVertexLight(game, x, y, heightStep = HEIGHT_STEP) {
  if (!heightStep) return 1;
  x = clamp(x, 0, game.width); y = clamp(y, 0, game.height);
  for (let v = y - 1; v <= y; v++) for (let u = x - 1; u <= x; u++) {
    if (u >= 0 && v >= 0 && u < game.width && v < game.height && game.tiles[v * game.width + u].terrain === 'water') return 1;
  }
  const x0 = Math.max(0, x - 1), x1 = Math.min(game.width, x + 1);
  const y0 = Math.max(0, y - 1), y1 = Math.min(game.height, y + 1);
  const dx = (surfaceHeight(game, x1, y) - surfaceHeight(game, x0, y)) / (x1 - x0 || 1);
  const dy = (surfaceHeight(game, x, y1) - surfaceHeight(game, x, y0)) / (y1 - y0 || 1);
  return normalLight(-dx * heightStep / TILE, -dy * heightStep / TILE, 1);
}

function path(c, points) {
  c.beginPath();c.moveTo(points[0].x,points[0].y);
  c.lineTo(points[1].x,points[1].y);c.lineTo(points[2].x,points[2].y);c.closePath();
}

function expandedTriangle(points, padding) {
  const center = {x:(points[0].x+points[1].x+points[2].x)/3,y:(points[0].y+points[1].y+points[2].y)/3};
  let radius = Infinity;
  for(let i=0;i<3;i++){
    const a=points[i],b=points[(i+1)%3],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
    if(length)radius=Math.min(radius,Math.abs(dx*(center.y-a.y)-dy*(center.x-a.x))/length);
  }
  const grow = 1 + padding / Math.max(.01,radius);
  return points.map(p=>({x:center.x+(p.x-center.x)*grow,y:center.y+(p.y-center.y)*grow}));
}

function paintTriangle(c,image,triangle,sourceX,sourceY,sourceScale,padding){
  const source=triangle.map(p=>({x:(p.u*TILE-sourceX)*sourceScale,y:(p.v*TILE-sourceY)*sourceScale}));
  const [s0,s1,s2]=source,[p0,p1,p2]=triangle;
  const sx1=s1.x-s0.x,sy1=s1.y-s0.y,sx2=s2.x-s0.x,sy2=s2.y-s0.y,det=sx1*sy2-sx2*sy1;
  if(Math.abs(det)<1e-8)return false;
  const dx1=p1.x-p0.x,dy1=p1.y-p0.y,dx2=p2.x-p0.x,dy2=p2.y-p0.y;
  const a=(dx1*sy2-dx2*sy1)/det,b=(dy1*sy2-dy2*sy1)/det;
  const cc=(dx2*sx1-dx1*sx2)/det,d=(dy2*sx1-dy1*sx2)/det;
  const e=p0.x-a*s0.x-cc*s0.y,f=p0.y-b*s0.x-d*s0.y;
  // A subpixel overlap covers Canvas clip antialiasing at shared edges. There
  // are no opaque contour strokes, and both faces share exact vertices.
  c.save();path(c,expandedTriangle(triangle,padding));c.clip();c.transform(a,b,cc,d,e,f);
  const imageWidth=image.width||image.naturalWidth,imageHeight=image.height||image.naturalHeight;
  const left=Math.max(0,Math.floor(Math.min(...source.map(p=>p.x))-sourceScale*8)),top=Math.max(0,Math.floor(Math.min(...source.map(p=>p.y))-sourceScale*8));
  const right=Math.min(imageWidth,Math.ceil(Math.max(...source.map(p=>p.x))+sourceScale*8)),bottom=Math.min(imageHeight,Math.ceil(Math.max(...source.map(p=>p.y))+sourceScale*8));
  if(right>left&&bottom>top)c.drawImage(image,left,top,right-left,bottom-top,left,top,right-left,bottom-top);
  c.restore();
  return true;
}

// One reusable source-sized scratch image serves every chunk. Lighting is baked
// before clipping, so an antialiased overlap blends two finished face colors;
// it cannot erase the neighboring shade or expose a bright chunk-border seam.
let litSource, lightMap, lightPixels, vertexLights = new Float64Array(0);
function copyLitSource(image) {
  const width=image.width||image.naturalWidth,height=image.height||image.naturalHeight;
  if (!litSource) litSource=typeof OffscreenCanvas==='function'?new OffscreenCanvas(width,height):document.createElement('canvas');
  if(litSource.width!==width)litSource.width=width;
  if(litSource.height!==height)litSource.height=height;
  const c=litSource.getContext('2d');
  c.setTransform(1,0,0,1,0,0);c.globalAlpha=1;c.globalCompositeOperation='copy';c.drawImage(image,0,0);
  return c;
}
function lightTexture(image, level) {
  if (level === 256) return image;
  const c=copyLitSource(image),light=level/256;
  c.globalCompositeOperation='source-atop';c.fillStyle=light<1?'#152218':'#fff6dc';c.globalAlpha=light<1?1-light:(light-1)*.75;c.fillRect(0,0,litSource.width,litSource.height);
  c.globalAlpha=1;c.globalCompositeOperation='source-over';
  return litSource;
}

// Four samples per tile are enough for the broad light field. Its lattice is
// fixed in world space, including the texture gutter, so separate chunks and
// fractional display densities interpolate identical light at shared edges.
// Only the source-sized scratch above and this tiny map are reused; the result
// is baked into the existing mesh cache, never recomputed on a warm frame.
function smoothLightTexture(image, game, sourceX, sourceY, sourceScale, heightStep) {
  if (!heightStep) return image;
  const step = TILE / 4, width = image.width || image.naturalWidth, height = image.height || image.naturalHeight;
  const left = Math.floor(sourceX / step) - 1, top = Math.floor(sourceY / step) - 1;
  const right = Math.ceil((sourceX + width / sourceScale) / step) + 1;
  const bottom = Math.ceil((sourceY + height / sourceScale) / step) + 1;
  const vx = Math.floor(left / 4), vy = Math.floor(top / 4);
  const columns = Math.ceil(right / 4) - vx + 1, rows = Math.ceil(bottom / 4) - vy + 1;
  if (vertexLights.length < columns * rows) vertexLights = new Float64Array(columns * rows);
  let shaded = false;
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const light = terrainVertexLight(game, vx + x, vy + y, heightStep);
    vertexLights[y * columns + x] = light; shaded ||= light !== 1;
  }
  if (!shaded) return image;
  const mw = right - left, mh = bottom - top;
  if (!lightMap) lightMap = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(mw, mh) : document.createElement('canvas');
  if (lightMap.width !== mw) lightMap.width = mw;
  if (lightMap.height !== mh) lightMap.height = mh;
  const m = lightMap.getContext('2d');
  if (!lightPixels || lightPixels.width !== mw || lightPixels.height !== mh) lightPixels = m.createImageData(mw, mh);
  const pixels = lightPixels.data;
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    const u = (left + x) / 4 - vx, v = (top + y) / 4 - vy;
    const ix = Math.floor(u), iy = Math.floor(v), a = u - ix, b = v - iy, at = iy * columns + ix;
    const north = vertexLights[at] * (1 - a) + vertexLights[at + 1] * a;
    const south = vertexLights[at + columns] * (1 - a) + vertexLights[at + columns + 1] * a;
    const light = north * (1 - b) + south * b, i = (y * mw + x) * 4, dark = light < 1;
    pixels[i] = dark ? 21 : 255; pixels[i + 1] = dark ? 34 : 246; pixels[i + 2] = dark ? 24 : 220;
    pixels[i + 3] = Math.round(255 * (dark ? 1 - light : (light - 1) * .75));
  }
  m.putImageData(lightPixels, 0, 0);
  const c = copyLitSource(image);
  c.globalCompositeOperation = 'source-atop'; c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'low';
  // Put texel centres on the world lattice, including shore vertices. A
  // half-texel offset here would filter land light back onto flat water.
  c.drawImage(lightMap, ((left - .5) * step - sourceX) * sourceScale, ((top - .5) * step - sourceY) * sourceScale, mw * step * sourceScale, mh * step * sourceScale);
  c.globalCompositeOperation = 'source-over';
  return litSource;
}
function paintFaces(c,image,faces,sourceX,sourceY,sourceScale,padding,shade,heightStep){
  const groups=new Map();let count=0;
  for(const triangle of faces){
    const level=shade?Math.round(facetLight(triangle,heightStep)*256):256;
    if(!groups.has(level))groups.set(level,[]);groups.get(level).push(triangle);
  }
  for(const[level,triangles]of groups){
    const texture=lightTexture(image,level);
    for(const triangle of triangles)if(paintTriangle(c,texture,triangle,sourceX,sourceY,sourceScale,padding))count++;
  }
  return count;
}

function overlapFor(c,overlap){
  const matrix=c.getTransform(),density=Math.max(.001,Math.hypot(matrix.a,matrix.b),Math.hypot(matrix.c,matrix.d));
  return overlap??.85/density;
}

// sourceX/Y are the unprojected world-pixel origin of the chunk texture, and
// sourceScale is its pixels per world pixel. The destination uses the caller's
// current transform over absolute projected world coordinates.
export function paintTerrainTile(c,image,{game,x,y,sourceX=0,sourceY=0,sourceScale=1,shade=true,overlap,surface:providedSurface,heightStep=HEIGHT_STEP}){
  const surface=providedSurface||tileSurface(game,x,y,heightStep),padding=overlapFor(c,overlap);
  const faces=surface.triangles||[[surface.nw,surface.ne,surface.se],[surface.nw,surface.se,surface.sw]];
  return paintFaces(c,image,faces,sourceX,sourceY,sourceScale,padding,shade,heightStep);
}

export function drawTerrainMesh(c,{game,canvas,sourceX=0,sourceY=0,sourceScale=1,bounds,shade=true,overlap,heightStep=HEIGHT_STEP}){
  const x0=Math.max(0,bounds.x0),y0=Math.max(0,bounds.y0),x1=Math.min(game.width,bounds.x1),y1=Math.min(game.height,bounds.y1);
  let tiles=0;const faces=[],padding=overlapFor(c,overlap);
  for(let depth=x0+y0;depth<x1+y1-1;depth++)for(let y=Math.max(y0,depth-x1+1);y<y1&&y<=depth-x0;y++){
    const x=depth-y,surface=tileSurface(game,x,y,heightStep);faces.push(...surface.triangles);
    tiles++;
  }
  const texture=shade?smoothLightTexture(canvas,game,sourceX,sourceY,sourceScale,heightStep):canvas;
  let triangles=0;
  for(const triangle of faces)if(paintTriangle(c,texture,triangle,sourceX,sourceY,sourceScale,padding))triangles++;
  return{tiles,triangles};
}
