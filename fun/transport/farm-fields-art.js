import { randomSource } from './world-noise.js';
import { industrySize, industryFootprint, isFarmIndustry } from './industry-sites.js';
import { drawRasterFarmCore } from './raster-industries.js';
import { drawNativeFarmCore } from './processing-sprites.js';
import { featureWorldPixels, SPRITE_SCALE } from './sprite-art-direction.js';

const TILE = 32, TEXTURE_SIZE = 128;
const textures = new Map();
const PALETTES = {
  taiga: { soil:'#78613c', light:'#c6ae68', grain:'#d8c077', straw:'#998b43', leaf:'#6b893d', highlight:'#b2bf61', shade:'#344b29', fence:'#b6a07b', post:'#7d6546' },
  desert: { soil:'#a18452', light:'#debd7b', grain:'#e6c674', straw:'#a18b46', leaf:'#809b46', highlight:'#c9cf6c', shade:'#4c5d2f', fence:'#ceb184', post:'#997248' },
  tundra: { soil:'#84795f', light:'#cdc1a0', grain:'#d4c9a0', straw:'#aaa07a', leaf:'#7b8d61', highlight:'#c2caa2', shade:'#55614d', fence:'#c6bca0', post:'#897c61' },
};
export const isLargeFarm = site => Boolean(site && isFarmIndustry(site.kind) && industrySize(site) >= 5);
export const farmCore = site => ({ x:site.x+1, y:site.y+1, span:2 });
export const farmCrop = (site, seed = 0) => site.kind === 'farm' ? ((site.variant ?? (Math.imul(site.x,31)+site.y+seed)) & 1 ? 'corn' : 'wheat') : site.kind === 'vegetable-farm' ? 'vegetables' : site.kind === 'orchard' ? 'orchard' : 'pasture';

// The working yard is deliberately open. A lane reaches its south gate and
// crops occupy the rest of the plot, with the original meadow between beds.
export function farmFieldCell(site, x, y) {
  const u=x-site.x,v=y-site.y;
  return isLargeFarm(site) && u>=0 && v>=0 && u<industrySize(site) && v<industrySize(site) && !(u<3&&v<3);
}

// Authored as open rows rather than an opaque patch of replacement terrain.
// Broad beds, short harvest bands and wide headlands survive the Region view.
function texture(crop, biome) {
  const key=`${biome}:${crop}`;if(textures.has(key))return textures.get(key);
  const image=typeof OffscreenCanvas==='function'?new OffscreenCanvas(TEXTURE_SIZE,TEXTURE_SIZE):document.createElement('canvas');
  image.width=image.height=TEXTURE_SIZE;
  const c=image.getContext('2d'),p=PALETTES[biome]||PALETTES.taiga;c.scale(2,2);
  if(crop==='pasture'){
    for(const [x,y]of [[10,12],[43,19],[24,42],[55,53]]){c.fillStyle=p.leaf;c.globalAlpha=.24;c.beginPath();c.ellipse(x,y,4.2,2.1,-.4,0,Math.PI*2);c.fill();}
  }else if(crop==='orchard'){
    c.fillStyle=p.soil;c.globalAlpha=.25;for(const x of [12,44])c.fillRect(x,0,3,64);
  }else{
    const spacing=crop==='wheat'?8:12,bed=crop==='vegetables'?7:crop==='corn'?6:5;
    for(let x=2;x<64;x+=spacing){
      c.fillStyle=p.soil;c.globalAlpha=.38;c.fillRect(x,0,bed,64);
      c.fillStyle=crop==='wheat'?p.grain:p.leaf;c.globalAlpha=.85;c.fillRect(x+1,0,bed-2,64);
      c.fillStyle=crop==='wheat'?p.light:p.highlight;c.globalAlpha=.55;c.fillRect(x+1,0,1,64);
      // Harvest gaps expose the furrow and prevent a wallpaper stripe effect.
      for(let y=(Math.floor(x/spacing)%3)*6;y<64;y+=18){c.clearRect(x,y,bed,2);}
      if(crop==='vegetables'&&Math.floor(x/spacing)%2){c.fillStyle='#997a72';c.globalAlpha=.85;c.fillRect(x+2,0,bed-4,64);}
    }
  }
  c.globalAlpha=1;textures.set(key,image);return image;
}

// This runs only while a terrain chunk is composed. The mesh projects the
// fields together with roads and world grass, so every row follows slopes.
export function paintFarmFields(c, bounds, industryAt, biome, seed = 0, { transparentGround = false } = {}) {
  const p=PALETTES[biome]||PALETTES.taiga,plots=new Map();
  for(let y=bounds.y0;y<bounds.y1;y++)for(let x=bounds.x0;x<bounds.x1;x++){
    const site=industryAt(x,y);if(!isLargeFarm(site))continue;
    let plot=plots.get(site);if(!plot){plot={field:new Path2D(),lane:new Path2D()};plots.set(site,plot);}
    const u=x-site.x,v=y-site.y,left=x*TILE,top=y*TILE;
    if(u<3&&v<3)continue;
    const margin=2.4,px=left+(u===0?5:margin),py=top+(v===0?5:margin),w=TILE-(u===0||u===industrySize(site)-1?5:margin)-margin,h=TILE-(v===0||v===industrySize(site)-1?5:margin)-margin;
    // Headland lanes separate planted beds, and the loading lane remains
    // clear all the way from the front gate to the barn's working apron.
    if(u===1||u===2){
      const laneLeft=(site.x+1.76)*TILE,laneRight=(site.x+2.24)*TILE;
      if(px<laneLeft)plot.field.rect(px,py,Math.max(0,Math.min(w,laneLeft-px)),h);
      if(px+w>laneRight)plot.field.rect(Math.max(px,laneRight),py,px+w-Math.max(px,laneRight),h);
      const lx=Math.max(left,laneLeft),rx=Math.min(left+TILE,laneRight);
      if(rx>lx)plot.lane.rect(lx,top,rx-lx,TILE);
    }else plot.field.rect(px,py,w,h);
  }
  c.save();
  for(const [site,plot]of plots){
    const crop=farmCrop(site,seed);
    if(!transparentGround||!['pasture','orchard'].includes(crop)){
      const pattern=c.createPattern(texture(crop,biome),'repeat');pattern.setTransform({a:.5,d:.5});
      c.fillStyle=pattern;c.fill(plot.field);
    }
    c.fillStyle=p.light;c.globalAlpha=.5;c.fill(plot.lane);
    c.globalAlpha=1;
  }
  c.restore();
}

// Each segment belongs to its own perimeter tile. Back and front fences can
// therefore share the normal scene depth ordering with trucks and tree crowns.
export function farmFenceSections(site, x, y) {
  if(!isLargeFarm(site))return [];
  const u=x-site.x,v=y-site.y,result=[];
  if(v===0)result.push({a:[x+(u===0?.12:0),y+.12],b:[x+(u===industrySize(site)-1?.88:1),y+.12],front:false});
  if(u===0)result.push({a:[x+.12,y+(v===0?.12:0)],b:[x+.12,y+(v===industrySize(site)-1?.88:1)],front:false});
  if(u===industrySize(site)-1)result.push({a:[x+.88,y+(v===0?.12:0)],b:[x+.88,y+(v===industrySize(site)-1?.88:1)],front:true});
  if(v===industrySize(site)-1){
    // Two shorter runs leave a real opening rather than painting a fence
    // through the vehicle access lane.
    if(u!==1&&u!==2)result.push({a:[x+(u===0?.12:0),y+.88],b:[x+(u===industrySize(site)-1?.88:1),y+.88],front:true});
    else if(u===1)result.push({a:[x,y+.88],b:[site.x+1.72,y+.88],front:true});
    else result.push({a:[site.x+2.28,y+.88],b:[x+1,y+.88],front:true});
  }
  return result;
}

export function paintFarmFence(c, section, project, biome) {
  const p=PALETTES[biome]||PALETTES.taiga,a=project(...section.a),b=project(...section.b),height=featureWorldPixels(SPRITE_SCALE.fenceHeightMetres);
  c.save();c.lineCap='square';c.lineJoin='round';
  // Three slim posts and a broad pale top rail; the diagonal brace makes the
  // new agricultural fence legible without introducing a dense wire mesh.
  for(const t of [0,.5,1]){
    const x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;
    c.fillStyle=p.post;c.fillRect(x-.3,y-height,.6,height);c.fillStyle=p.fence;c.fillRect(x-.3,y-height,.25,height);
  }
  c.strokeStyle=p.fence;c.lineWidth=.48;c.beginPath();c.moveTo(a.x,a.y-height*.83);c.lineTo(b.x,b.y-height*.83);c.stroke();
  c.strokeStyle=p.post;c.lineWidth=.3;c.beginPath();c.moveTo(a.x,a.y-height*.2);c.lineTo(b.x,b.y-height*.65);c.stroke();
  c.restore();
}

export function farmFieldObjects(site, x, y, seed = 0) {
  if(!farmFieldCell(site,x,y))return [];
  const u=x-site.x,v=y-site.y;
  if(u===1||u===2)return [];
  if(site.kind==='orchard')return [{kind:'fruit-tree',x:x+.5,y:y+.45,variant:(x*13+y*7+seed)%4}];
  if(farmCrop(site,seed)==='pasture'&&(u*7+v+seed)%7===0)return [{kind:'cow',x:x+.5,y:y+.5,variant:(x+y+seed)&1}];
  return [];
}

export function paintFarmFieldObject(c, object, point, biome) {
  const p=PALETTES[biome]||PALETTES.taiga,at=(u,v,z=0)=>[point.x+(u-v)*2,point.y+(u+v)-z*2];
  const poly=(points,color)=>{c.fillStyle=color;c.beginPath();points.forEach(([u,v,z=0],i)=>{const q=at(u,v,z);i?c.lineTo(...q):c.moveTo(...q);});c.closePath();c.fill();};
  c.save();
  if(object.kind==='fruit-tree'){
    poly([[-1.8,-.7],[1.5,-.6],[2.5,1.3],[-.5,1.4]],'#26382b28');
    poly([[-.17,-.13], [.17,-.13,0],[.17,-.13,3.2],[-.17,-.13,3.2]],p.post);
    // Top canopy plus two side volumes: the orchard shares the elevated
    // dimetric camera and never becomes a frontal circular tree silhouette.
    poly([[-1.5,0,3],[0,-1.5,3.6],[1.5,0,3.1],[0,1.5,2.7]],p.leaf);
    poly([[-1.5,0,3],[0,1.5,2.7],[0,1.25,1.7],[-1.25,0,2]],p.highlight);
    poly([[0,1.5,2.7],[1.5,0,3.1],[1.25,0,2.1],[0,1.25,1.7]],p.shade);
    poly([[-.8,-.1,3.35],[-.1,-.8,3.65],[.3,-.25,3.55],[-.35,.35,3.2]],p.highlight);
    if(object.variant&1)poly([[-.7,.6,2.9],[-.3,.8,2.9],[-.3,.8,2.55],[-.7,.6,2.55]],'#b38858');
  }else{
    const coat=object.variant?'#b6a68d':'#ded8c4';
    poly([[-1.3,-.5],[1.3,-.5],[1.7,.8],[-.8,.8]],'#26382b25');
    for(const [u,v]of[[-.8,-.25],[.8,-.25],[-.8,.35],[.8,.35]])poly([[u-.07,v],[u+.07,v],[u+.07,v,.8],[u-.07,v,.8]],p.post);
    poly([[-1.1,-.4,.7],[1.1,-.4,.7],[1.1,-.4,1.5],[-1.1,-.4,1.5]],coat);
    poly([[-1.1,-.4,1.5],[1.1,-.4,1.5],[1.1,.4,1.5],[-1.1,.4,1.5]],'#eee5cf');
    poly([[-1.1,.4,.7],[1.1,.4,.7],[1.1,.4,1.5],[-1.1,.4,1.5]],coat);
    poly([[1.1,-.3,1],[1.65,-.3,.8],[1.65,.3,.8],[1.1,.3,1.4]],p.post);
    poly([[-.7,.4,1],[-.25,.4,1],[-.25,.4,1.5],[-.7,.4,1.5]],p.shade);
  }
  c.restore();
}

export const farmFieldsArtStats = () => ({ textures:textures.size, textureBytes:textures.size*TEXTURE_SIZE*TEXTURE_SIZE*4, textureLimit:15*TEXTURE_SIZE*TEXTURE_SIZE*4 });

// Build menus show the same field layout and small core as the map, rather
// than stretching the barn to the size of the entire agricultural plot.
export function drawFarmPortrait(c, kind, biome = 'taiga', { x=0, y=0, width=96, height=108, pixelScale=1, variant=0, footprint=industryFootprint(kind) } = {}) {
  if(!isFarmIndustry(kind))return false;
  const span=footprint===7?7:5,site={kind,x:0,y:0,footprint:span,variant},image=document.createElement('canvas');image.width=image.height=span*TILE;
  const ground=image.getContext('2d');
  paintFarmFields(ground,{x0:0,y0:0,x1:span,y1:span},()=>site,biome,0,{transparentGround:true});
  const scale=Math.min((width-8)/(2*span*TILE),(height-8)/((span+1)*TILE)),ox=x+width/2,oy=y+(height-span*TILE*scale)/2;
  const project=(u,v)=>({x:ox+(u-v)*TILE*scale,y:oy+(u+v)*TILE/2*scale});
  c.save();c.transform(scale,scale/2,-scale,scale/2,ox,oy);c.drawImage(image,0,0);c.restore();
  const objects=[];
  for(let v=0;v<span;v++)for(let u=0;u<span;u++){
    for(const section of farmFenceSections(site,u,v))objects.push({depth:(section.a[0]+section.b[0]+section.a[1]+section.b[1])/2,draw:()=>{c.save();c.translate(ox,oy);c.scale(scale,scale);paintFarmFence(c,section,(a,b)=>({x:(a-b)*TILE,y:(a+b)*TILE/2}),biome);c.restore();}});
    for(const object of farmFieldObjects(site,u,v))objects.push({depth:object.x+object.y,draw:()=>{const p=project(object.x,object.y);c.save();c.translate(p.x,p.y);c.scale(scale,scale);paintFarmFieldObject(c,object,{x:0,y:0},biome);c.restore();}});
  }
  objects.push({depth:5,draw:()=>{
    const frame=SPRITE_SCALE.billboardPixelsPerTile,density=frame/TILE,p=project(2,2);
    c.save();c.translate(p.x-frame*scale,p.y-(frame*1.5+frame/4)*scale);c.scale(density*scale,density*scale);c.translate(0,8);
    if(!drawRasterFarmCore(c,kind,biome,pixelScale*density*scale,{size:64})){c.scale(2,2);drawNativeFarmCore(c,kind,randomSource(1937+kind.length*787),biome,'detail',2,{gardenGround:'terrain'});}
    c.restore();
  }});
  objects.sort((a,b)=>a.depth-b.depth);for(const object of objects)object.draw();
  image.width=image.height=0;return true;
}
