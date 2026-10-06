import { randomSource } from './world-noise.js';
import { industrySize, isFarmIndustry } from './industry-sites.js';
import { drawRasterFarmCore } from './raster-industries.js';
import { drawNativeFarmCore } from './processing-sprites.js';

const TILE = 32, TEXTURE_SIZE = 128;
const textures = new Map();
const PALETTES = {
  taiga: { soil:'#78613c', light:'#c6ae68', grain:'#d8c077', straw:'#998b43', leaf:'#6b893d', highlight:'#b2bf61', shade:'#344b29', fence:'#b6a07b', post:'#7d6546' },
  desert: { soil:'#a18452', light:'#debd7b', grain:'#e6c674', straw:'#a18b46', leaf:'#809b46', highlight:'#c9cf6c', shade:'#4c5d2f', fence:'#ceb184', post:'#997248' },
  tundra: { soil:'#84795f', light:'#cdc1a0', grain:'#d4c9a0', straw:'#aaa07a', leaf:'#7b8d61', highlight:'#c2caa2', shade:'#55614d', fence:'#c6bca0', post:'#897c61' },
};
export const isLargeFarm = site => Boolean(site && isFarmIndustry(site.kind) && industrySize(site) === 7);
export const farmCore = site => ({ x:site.x+1, y:site.y+1, span:2 });
export const farmCrop = (site, seed = 0) => site.kind === 'farm' ? ((site.variant ?? (Math.imul(site.x,31)+site.y+seed)) & 1 ? 'corn' : 'wheat') : site.kind === 'vegetable-farm' ? 'vegetables' : site.kind === 'orchard' ? 'orchard' : 'pasture';

// The working yard is deliberately open. A lane reaches its south gate and
// crops occupy the rest of the plot, with the original meadow between beds.
export function farmFieldCell(site, x, y) {
  const u=x-site.x,v=y-site.y;
  return isLargeFarm(site) && u>=0 && v>=0 && u<7 && v<7 && !(u<3&&v<3);
}

function texture(crop, biome) {
  const key=`${biome}:${crop}`;
  if(textures.has(key))return textures.get(key);
  const image=typeof OffscreenCanvas==='function'?new OffscreenCanvas(TEXTURE_SIZE,TEXTURE_SIZE):document.createElement('canvas');
  image.width=image.height=TEXTURE_SIZE;
  const c=image.getContext('2d'),p=PALETTES[biome]||PALETTES.taiga,r=randomSource(1937+crop.length*787+biome.length*83);
  c.scale(2,2);
  // Semi-transparent ground marks let each world's existing terrain colour
  // and grain show through, including dry grass and hillside lighting.
  if(crop==='pasture'||crop==='orchard'){
    for(let n=0;n<200;n++){
      const x=r()*64,y=r()*64;c.globalAlpha=.12+r()*.25;
      c.fillStyle=n%3?p.leaf:p.highlight;c.fillRect(x,y,.35+r()*.65,.25+r()*.4);
    }
    if(crop==='orchard'){
      c.globalAlpha=.18;c.strokeStyle=p.soil;c.lineWidth=2.5;
      for(let x=8;x<64;x+=16){c.beginPath();c.moveTo(x,0);c.lineTo(x,64);c.stroke();}
    }
  }else{
    c.fillStyle=p.soil;c.globalAlpha=crop==='vegetables'?.3:.19;c.fillRect(0,0,64,64);
    if(crop==='wheat'){c.fillStyle=p.grain;c.globalAlpha=.15;c.fillRect(0,0,64,64);}
    const spacing=crop==='corn'?6.4:crop==='vegetables'?8:4.4;
    c.lineCap='round';
    for(let x=spacing/2;x<64;x+=spacing){
      c.globalAlpha=crop==='vegetables'?.42:.27;c.strokeStyle=p.soil;c.lineWidth=crop==='wheat'?1.3:3.1;
      c.beginPath();c.moveTo(x,0);c.lineTo(x,64);c.stroke();
      for(let y=2;y<64;y+=crop==='wheat'?2.6:crop==='corn'?3.8:5){
        const xx=x+(r()-.5)*.6,yy=y+(r()-.5)*1.6;
        c.globalAlpha=.9;
        if(crop==='wheat'){
          c.strokeStyle=p.straw;c.lineWidth=.45;c.beginPath();c.moveTo(xx,yy+1.9);c.lineTo(xx+.6,yy-1.4);c.stroke();
          c.fillStyle=r()>.45?p.grain:p.light;c.beginPath();c.ellipse(xx+.5,yy-.75,.75,1.4,.3,0,Math.PI*2);c.fill();
          c.globalAlpha=.45;c.fillStyle=p.grain;c.fillRect(xx-1.2,yy+.7,1.1,.45);
        }else if(crop==='corn'){
          c.strokeStyle=p.shade;c.lineWidth=.65;c.beginPath();c.moveTo(xx,yy+2);c.lineTo(xx,yy-1.7);c.stroke();
          for(const side of [-1,1]){
            c.fillStyle=side<0?p.leaf:p.highlight;c.beginPath();c.moveTo(xx,yy+1.2);c.quadraticCurveTo(xx+side*3.5,yy+.7,xx+side*2.5,yy-1.3);c.quadraticCurveTo(xx+side*.5,yy-1.1,xx,yy+1.2);c.fill();
          }
          c.fillStyle=p.grain;c.fillRect(xx-.35,yy-2.3,.65,1.5);
        }else{
          const cropRow=Math.floor(x/spacing)%3;
          c.fillStyle=cropRow===2?'#776384':p.shade;c.beginPath();c.ellipse(xx+.35,yy+.35,2.1,1.65,0,0,Math.PI*2);c.fill();
          c.fillStyle=cropRow===2?'#ae89a0':p.leaf;c.beginPath();c.ellipse(xx-.25,yy-.25,1.8,1.35,0,0,Math.PI*2);c.fill();
          c.fillStyle=cropRow===1?'#d59152':p.highlight;c.fillRect(xx-.4,yy-.7,.85,.65);
        }
      }
    }
    c.globalAlpha=.16;c.fillStyle=p.light;
    for(let n=0;n<160;n++)c.fillRect(r()*64,r()*64,.3+r()*.45,.25+r()*.4);
  }
  c.globalAlpha=1;textures.set(key,image);return image;
}

// This runs only while a terrain chunk is composed. The mesh projects the
// fields together with roads and world grass, so every row follows slopes.
export function paintFarmFields(c, bounds, industryAt, biome, seed = 0) {
  const p=PALETTES[biome]||PALETTES.taiga,plots=new Map();
  for(let y=bounds.y0;y<bounds.y1;y++)for(let x=bounds.x0;x<bounds.x1;x++){
    const site=industryAt(x,y);if(!isLargeFarm(site))continue;
    let plot=plots.get(site);if(!plot){plot={field:new Path2D(),yard:new Path2D(),lane:new Path2D()};plots.set(site,plot);}
    const u=x-site.x,v=y-site.y,left=x*TILE,top=y*TILE;
    if(u<3&&v<3){if(u>=1&&v>=1)plot.yard.rect(left,top,TILE,TILE);continue;}
    const margin=2.4,px=left+(u===0?5:margin),py=top+(v===0?5:margin),w=TILE-(u===0||u===6?5:margin)-margin,h=TILE-(v===0||v===6?5:margin)-margin;
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
    const pattern=c.createPattern(texture(farmCrop(site,seed),biome),'repeat');pattern.setTransform({a:.5,d:.5});
    c.fillStyle=pattern;c.fill(plot.field);
    c.fillStyle=p.soil;c.globalAlpha=.19;c.fill(plot.yard);c.globalAlpha=.48;c.fill(plot.lane);
    c.globalAlpha=1;
  }
  c.restore();
}

// Each segment belongs to its own perimeter tile. Back and front fences can
// therefore share the normal scene depth ordering with trucks and tree crowns.
export function farmFenceSections(site, x, y) {
  if(!isLargeFarm(site))return [];
  const u=x-site.x,v=y-site.y,result=[];
  if(v===0)result.push({a:[x+(u===0?.12:0),y+.12],b:[x+(u===6?.88:1),y+.12],front:false});
  if(u===0)result.push({a:[x+.12,y+(v===0?.12:0)],b:[x+.12,y+(v===6?.88:1)],front:false});
  if(u===6)result.push({a:[x+.88,y+(v===0?.12:0)],b:[x+.88,y+(v===6?.88:1)],front:true});
  if(v===6){
    // Two shorter runs leave a real opening rather than painting a fence
    // through the vehicle access lane.
    if(u!==1&&u!==2)result.push({a:[x+(u===0?.12:0),y+.88],b:[x+(u===6?.88:1),y+.88],front:true});
    else if(u===1)result.push({a:[x,y+.88],b:[site.x+1.72,y+.88],front:true});
    else result.push({a:[site.x+2.28,y+.88],b:[x+1,y+.88],front:true});
  }
  return result;
}

export function paintFarmFence(c, section, project, biome) {
  const p=PALETTES[biome]||PALETTES.taiga,a=project(...section.a),b=project(...section.b),height=4.7;
  c.save();c.lineCap='round';c.lineJoin='round';
  c.strokeStyle=p.post;c.lineWidth=1.3;
  for(const t of [0,.5,1]){const x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;c.beginPath();c.moveTo(x,y);c.lineTo(x,y-height);c.stroke();}
  for(const lift of [1.8,3.7]){
    c.strokeStyle=p.post;c.lineWidth=1.1;c.beginPath();c.moveTo(a.x,a.y-lift+.5);c.lineTo(b.x,b.y-lift+.5);c.stroke();
    c.strokeStyle=p.fence;c.lineWidth=.7;c.beginPath();c.moveTo(a.x,a.y-lift);c.lineTo(b.x,b.y-lift);c.stroke();
  }
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
  const p=PALETTES[biome]||PALETTES.taiga;
  c.save();c.translate(point.x,point.y);
  c.fillStyle='#233a282c';c.beginPath();c.ellipse(1,1,object.kind==='cow'?4:6,1.8,0,0,Math.PI*2);c.fill();
  if(object.kind==='fruit-tree'){
    c.strokeStyle=p.post;c.lineWidth=1.3;c.beginPath();c.moveTo(0,0);c.lineTo(-.5,-8);c.moveTo(-.5,-5);c.lineTo(-3,-9);c.moveTo(-.5,-6);c.lineTo(3,-10);c.stroke();
    for(const [x,y,r,color]of [[-3,-8,3.7,p.shade],[2.6,-8.7,4,p.leaf],[0,-11.5,3.7,p.leaf],[-1.7,-11.1,2.8,p.highlight]]){c.fillStyle=color;c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill();}
    c.fillStyle=object.variant&1?'#c99043':'#c16e4c';for(const [x,y]of [[-3,-10],[2,-12],[3,-7],[-1,-8]]){c.beginPath();c.arc(x,y,.75,0,Math.PI*2);c.fill();}
    c.fillStyle=p.highlight;c.globalAlpha=.5;c.fillRect(-3.5,-12.5,1.6,.65);c.fillRect(1.3,-10.8,1.6,.6);
  }else{
    c.fillStyle='#564b3b';for(const x of [-2.4,1.8])c.fillRect(x,-1.7,.65,2.6);
    c.fillStyle=object.variant?'#c5b59b':'#e4dfcc';c.beginPath();c.ellipse(0,-2.7,3.8,2,0,0,Math.PI*2);c.fill();c.fillRect(2.3,-4,2,2.6);
    c.fillStyle=object.variant?'#8f7657':'#574f42';c.fillRect(-2,-4,1.6,2);c.fillRect(.5,-2.8,1.3,1.5);c.fillRect(3.4,-2,1.2,.8);
  }
  c.restore();
}

export const farmFieldsArtStats = () => ({ textures:textures.size, textureBytes:textures.size*TEXTURE_SIZE*TEXTURE_SIZE*4, textureLimit:15*TEXTURE_SIZE*TEXTURE_SIZE*4 });

// Build menus show the same field layout and small core as the map, rather
// than stretching the barn to the size of the entire agricultural plot.
export function drawFarmPortrait(c, kind, biome = 'taiga', { x=0, y=0, width=96, height=108, pixelScale=1, variant=0 } = {}) {
  if(!isFarmIndustry(kind))return false;
  const site={kind,x:0,y:0,footprint:7,variant},image=document.createElement('canvas');image.width=image.height=7*TILE;
  const ground=image.getContext('2d');ground.fillStyle=biome==='desert'?'#b7ac77':biome==='tundra'?'#9aa58a':'#8caa65';ground.fillRect(0,0,image.width,image.height);
  paintFarmFields(ground,{x0:0,y0:0,x1:7,y1:7},()=>site,biome);
  const scale=Math.min((width-8)/(14*TILE),(height-8)/(8*TILE)),ox=x+width/2,oy=y+(height-7*TILE*scale)/2;
  const project=(u,v)=>({x:ox+(u-v)*TILE*scale,y:oy+(u+v)*TILE/2*scale});
  c.save();c.transform(scale,scale/2,-scale,scale/2,ox,oy);c.drawImage(image,0,0);c.restore();
  const objects=[];
  for(let v=0;v<7;v++)for(let u=0;u<7;u++){
    for(const section of farmFenceSections(site,u,v))objects.push({depth:(section.a[0]+section.b[0]+section.a[1]+section.b[1])/2,draw:()=>{c.save();c.translate(ox,oy);c.scale(scale,scale);paintFarmFence(c,section,(a,b)=>({x:(a-b)*TILE,y:(a+b)*TILE/2}),biome);c.restore();}});
    for(const object of farmFieldObjects(site,u,v))objects.push({depth:object.x+object.y,draw:()=>{const p=project(object.x,object.y);c.save();c.translate(p.x,p.y);c.scale(scale,scale);paintFarmFieldObject(c,object,{x:0,y:0},biome);c.restore();}});
  }
  objects.push({depth:5,draw:()=>{
    const p=project(2,2);c.save();c.translate(p.x-48*scale,p.y-84*scale);c.scale(1.5*scale,1.5*scale);c.translate(0,8);
    if(!drawRasterFarmCore(c,kind,biome,pixelScale*1.5*scale,{size:64})){c.scale(2,2);drawNativeFarmCore(c,kind,randomSource(1937+kind.length*787),biome,'detail');}
    c.restore();
  }});
  objects.sort((a,b)=>a.depth-b.depth);for(const object of objects)object.draw();
  image.width=image.height=0;return true;
}
