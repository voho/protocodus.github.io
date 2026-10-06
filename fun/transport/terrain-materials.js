import { registerAtlas, drawAtlas, worldArtRevision } from './atlas-runtime.js';
import { noise, randomSource } from './world-noise.js';

// Authored ground is a material on the terrain mesh, rather than an upright
// sprite. The usual artwork publication invalidates already baked chunks.
for(const material of ['meadow','scree'])registerAtlas({
  id:`ground-${material}`,path:`./assets/materials/${material}`,
  columns:1,rows:1,entries:[`ground:${material}`],maxCell:256,
});

const SIZE=256,WORLD_SIZE=128;
const surfaces=new Map(),fallbacks=new Map(),mossStamps=new Map();
const TINTS={
  taiga:{meadow:['#9aaf7b',.14],scree:['#b2b49b',.13],sand:['#d9bd87',.65],snow:['#e0e5da',.76]},
  tundra:{meadow:['#c3ccc0',.37],scree:['#aebaae',.19],sand:['#c8c8ac',.6],snow:['#e1e8e0',.8]},
  desert:{meadow:['#c8aa6e',.52],scree:['#b9a17c',.3],sand:['#e0bb7b',.67],snow:['#e4dbc6',.79]},
};

export function groundMaterial(tile,biome){
  if(!tile||tile.terrain==='water')return null;
  if(tile.terrain==='snow'||['glacier','ice','saltflat'].includes(tile.detail)||biome==='tundra'&&(tile.elevation||0)>.58)return'snow';
  if(tile.terrain==='sand')return'sand';
  return tile.terrain==='mountain'||tile.terrain==='rock'?'scree':'meadow';
}

function canvas(width=SIZE,height=SIZE){return typeof OffscreenCanvas==='function'?new OffscreenCanvas(width,height):Object.assign(document.createElement('canvas'),{width,height});}
function materialSurface(kind,biome){
  const key=`${biome}:${kind}`,source=kind==='meadow'?'meadow':'scree';
  const cached=surfaces.get(key);if(cached)return cached;
  const image=canvas(),c=image.getContext('2d');
  if(!drawAtlas(c,`ground:${source}`,0,0,SIZE,SIZE,{pixelScale:1}))return null;
  const [color,opacity]=(TINTS[biome]||TINTS.taiga)[kind];
  c.globalCompositeOperation='source-atop';c.globalAlpha=opacity;c.fillStyle=color;c.fillRect(0,0,SIZE,SIZE);
  // Store only native authored textures: fallback images cannot mask a late
  // atlas decode. Four material types × three climates cap this bank at 3 MiB.
  surfaces.set(key,image);fallbacks.delete(key);return image;
}

function fallbackSurface(kind,biome){
  const key=`${biome}:${kind}`;if(fallbacks.has(key))return fallbacks.get(key);
  const image=canvas(),c=image.getContext('2d'),r=randomSource(43119+kind.length*271+biome.length*811);
  const colors=kind==='snow'?['#6f8075','#f0f2df','#929b86']:kind==='sand'?['#796849','#efe1b7','#a7936d']:['#526047','#d2d0b4','#928b70'];
  for(let n=0;n<7000;n++){
    const x=r()*SIZE,y=r()*SIZE,size=.7+r()*2.5;
    c.fillStyle=colors[n%3];c.globalAlpha=.18+r()*.29;
    c.fillRect(x,y,size,size*(.35+r()*.5));
  }
  fallbacks.set(key,image);return image;
}

let mossMask;
function mossStamp(biome,variant){
  const key=`${biome}:${variant}`;if(mossStamps.has(key))return mossStamps.get(key);
  const meadow=materialSurface('meadow',biome);if(!meadow)return null;
  const image=canvas(128,128),c=image.getContext('2d'),r=randomSource(81271+variant*1979),points=[],path=new Path2D();
  c.drawImage(meadow,0,0,128,128);
  for(let n=0;n<10;n++){const angle=n*Math.PI/5,d=40+r()*13;points.push([64+Math.cos(angle)*d,64+Math.sin(angle)*d]);}
  path.moveTo((points[9][0]+points[0][0])/2,(points[9][1]+points[0][1])/2);
  for(let n=0;n<10;n++){const point=points[n],next=points[(n+1)%10];path.quadraticCurveTo(point[0],point[1],(point[0]+next[0])/2,(point[1]+next[1])/2);}path.closePath();
  mossMask||=canvas(128,128);const mask=mossMask.getContext('2d');mask.clearRect(0,0,128,128);mask.fillStyle='#fff';mask.filter='blur(9px)';mask.fill(path);mask.filter='none';
  c.globalCompositeOperation='destination-in';c.drawImage(mossMask,0,0);mossStamps.set(key,image);return image;
}

let preparedRevision=-1;
let blendImage,blendMask;
const MATERIAL_ID={meadow:1,scree:2,sand:3,snow:4};
let maskPixels;
function transitionAxis(start,count,step=1){
  const axis=[];
  for(let n=0;n<count;n++){
    const position=start+(n+.5)*step,cell=Math.floor(position/32),phase=position-cell*32;
    let a=cell,b=cell,t=0;
    if(phase<7){a=cell-1;t=(phase+7)/14;}
    else if(phase>25){b=cell+1;t=(phase-25)/14;}
    axis.push({a,b,t:t*t*(3-2*t),cell});
  }
  return axis;
}
function prepareMasks(bounds,tile,biome,width,height,sourceX,sourceY){
  const x0=bounds.x0-2,y0=bounds.y0-2,columns=bounds.x1-bounds.x0+4,rows=bounds.y1-bounds.y0+4,field=new Uint8Array(columns*rows);
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++)field[y*columns+x]=MATERIAL_ID[groundMaterial(tile(x+x0,y+y0),biome)]||0;
  const xs=transitionAxis(sourceX,width,4),ys=transitionAxis(sourceY,height,4),weights=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const bx=xs[x],by=ys[y],primary=field[(by.cell-y0)*columns+bx.cell-x0],offset=(y*width+x)*4;
    const nw=field[(by.a-y0)*columns+bx.a-x0]||primary,ne=field[(by.a-y0)*columns+bx.b-x0]||primary;
    const sw=field[(by.b-y0)*columns+bx.a-x0]||primary,se=field[(by.b-y0)*columns+bx.b-x0]||primary;
    if(nw===ne&&nw===sw&&nw===se){if(nw)weights[offset+nw-1]=255;continue;}
    const a=(1-bx.t)*(1-by.t),b=bx.t*(1-by.t),d=(1-bx.t)*by.t,e=bx.t*by.t;
    for(let id=1;id<=4;id++)weights[offset+id-1]=Math.round(((nw===id?a:0)+(ne===id?b:0)+(sw===id?d:0)+(se===id?e:0))*255);
  }
  return weights;
}
// At most four pattern fills per cold chunk. A quarter-resolution alpha field
// feathers material boundaries, sampled on a world-anchored lattice. Texture
// density follows the destination, capped at the authored native resolution.
export function paintGroundTextures(c,bounds,tile,biome,profile,seed=0){
  const revision=worldArtRevision();if(revision!==preparedRevision){surfaces.clear();mossStamps.clear();preparedRevision=revision;}
  const masks=new Map(),land=new Path2D();
  const sourceX=(bounds.x0-1)*32,sourceY=(bounds.y0-1)*32,width=(bounds.x1-bounds.x0+2)*32,height=(bounds.y1-bounds.y0+2)*32;
  for(let y=bounds.y0-1;y<bounds.y1+1;y++)for(let x=bounds.x0-1;x<bounds.x1+1;x++){
    const kind=groundMaterial(tile(x,y),biome);if(!kind)continue;
    let path=masks.get(kind);if(!path){path=new Path2D();masks.set(kind,path);}path.rect(x*32,y*32,32,32);
    if(x>=bounds.x0&&x<bounds.x1&&y>=bounds.y0&&y<bounds.y1)land.rect(x*32,y*32,32,32);
  }
  if(!masks.size)return;
  const density=Math.min(2,Math.max(.5,Math.hypot(c.getTransform().a,c.getTransform().b))),imageWidth=width*density,imageHeight=height*density,maskWidth=width/4,maskHeight=height/4;
  blendImage||=canvas();blendMask||=canvas();
  if(blendImage.width!==imageWidth||blendImage.height!==imageHeight){blendImage.width=imageWidth;blendImage.height=imageHeight;}
  if(blendMask.width!==maskWidth||blendMask.height!==maskHeight){blendMask.width=maskWidth;blendMask.height=maskHeight;}
  const imageContext=blendImage.getContext('2d'),maskContext=blendMask.getContext('2d');
  const weights=masks.size>1?prepareMasks(bounds,tile,biome,maskWidth,maskHeight,sourceX,sourceY):null;
  if(weights&&(!maskPixels||maskPixels.width!==maskWidth||maskPixels.height!==maskHeight))maskPixels=maskContext.createImageData(maskWidth,maskHeight);
  c.save();c.clip(land);c.imageSmoothingEnabled=true;c.imageSmoothingQuality='low';
  // Fixed compositing order makes registration independent of which terrain
  // kind happens to appear first in any particular chunk.
  for(const kind of ['meadow','scree','sand','snow']){
    const path=masks.get(kind);if(!path)continue;
    const authored=materialSurface(kind,biome),surface=authored||fallbackSurface(kind,biome);
    const opacity=authored?(profile==='region'?.46:kind==='meadow'?.68:kind==='scree'?.58:.7):.8;
    if(!weights){
      const pattern=c.createPattern(surface,'repeat');pattern.setTransform({a:WORLD_SIZE/SIZE,d:WORLD_SIZE/SIZE});c.fillStyle=pattern;c.globalAlpha=opacity;c.fill(land);continue;
    }
    imageContext.setTransform(1,0,0,1,0,0);imageContext.globalAlpha=1;imageContext.globalCompositeOperation='source-over';imageContext.clearRect(0,0,imageWidth,imageHeight);
    imageContext.setTransform(density,0,0,density,-sourceX*density,-sourceY*density);
    const pattern=imageContext.createPattern(surface,'repeat');
    pattern.setTransform({a:WORLD_SIZE/SIZE,d:WORLD_SIZE/SIZE});
    imageContext.fillStyle=pattern;imageContext.fillRect(sourceX,sourceY,width,height);
    // Homogeneous hills have no material edge to feather. They draw directly
    // from a pattern; only mixed ground needs an intermediate alpha composite.
    if(weights){
      const id=MATERIAL_ID[kind]-1,data=maskPixels.data;
      for(let n=0;n<data.length;n+=4){data[n]=data[n+1]=data[n+2]=255;data[n+3]=weights[n+id];}
      maskContext.putImageData(maskPixels,0,0);
      imageContext.setTransform(1,0,0,1,0,0);imageContext.globalCompositeOperation='destination-in';imageContext.imageSmoothingEnabled=true;imageContext.imageSmoothingQuality='low';imageContext.drawImage(blendMask,0,0,imageWidth,imageHeight);
    }
    c.globalAlpha=opacity;
    c.drawImage(blendImage,sourceX,sourceY,width,height);
  }
  // Natural mineral ground includes islands of lichen and low vegetation.
  // Their irregular silhouettes occupy several cells and do not repeat with
  // the authored four-tile pattern, retaining a readable large-scale surface.
  c.globalAlpha=(profile==='region'?.22:.36)*(biome==='desert'?.48:1);
  for(let gy=Math.floor((bounds.y0-2)/2);gy<Math.ceil((bounds.y1+2)/2);gy++)for(let gx=Math.floor((bounds.x0-2)/2);gx<Math.ceil((bounds.x1+2)/2);gx++){
    const r=randomSource(seed+Math.imul(gx,31253)+Math.imul(gy,22727)+19843),x=(gx*2+r()*2)*32,y=(gy*2+r()*2)*32;
    if(groundMaterial(tile(Math.floor(x/32),Math.floor(y/32)),biome)!=='scree'||noise(gx,gy,seed+19877,4.7)<.42)continue;
    const radius=23+r()*26,image=mossStamp(biome,Math.floor(r()*4));if(image)c.drawImage(image,x-radius,y-radius*.7,radius*2,radius*1.4);
  }
  c.restore();
}

export function groundMaterialStats(){return{authoredSurfaces:surfaces.size,authoredBytes:surfaces.size*SIZE*SIZE*4,authoredLimit:12*SIZE*SIZE*4,fallbackBytes:fallbacks.size*SIZE*SIZE*4,mossBytes:mossStamps.size*128*128*4,mossLimit:12*128*128*4,scratchBytes:(blendImage?blendImage.width*blendImage.height*4:0)+(blendMask?blendMask.width*blendMask.height*4:0)+(mossMask?128*128*4:0)};}
