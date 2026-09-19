/** Small reusable material sprites and matching shoreline/cliff masks. No landscape images. */
import { MAP_TILE_SIZE } from './tile-map.js';

const RESOLUTION = 2;
const SIZE = MAP_TILE_SIZE;
const SURFACE_SIZE = SIZE * RESOLUTION;
const TAU = Math.PI * 2;
const POLYGONS = [
  [], [[0,0],[.5,0],[0,.5]], [[.5,0],[1,0],[1,.5]], [[0,0],[1,0],[1,.5],[0,.5]],
  [[1,.5],[1,1],[.5,1]], [[0,0],[.5,0],[0,.5]], [[.5,0],[1,0],[1,1],[.5,1]],
  [[0,0],[1,0],[1,1],[.5,1],[0,.5]], [[0,.5],[.5,1],[0,1]],
  [[0,0],[.5,0],[.5,1],[0,1]], [[.5,0],[1,0],[1,.5]],
  [[0,0],[1,0],[1,.5],[.5,1],[0,1]], [[0,.5],[1,.5],[1,1],[0,1]],
  [[0,0],[.5,0],[1,.5],[1,1],[0,1]], [[.5,0],[1,0],[1,1],[0,1],[0,.5]],
  [[0,0],[1,0],[1,1],[0,1]],
];
const CONTOURS = [[],[[.5,0],[0,.5]],[[1,.5],[.5,0]],[[1,.5],[0,.5]],[[.5,1],[1,.5]],
  [[.5,0],[0,.5],[.5,1],[1,.5]],[[.5,1],[.5,0]],[[.5,1],[0,.5]],[[0,.5],[.5,1]],
  [[.5,0],[.5,1]],[[1,.5],[.5,0],[0,.5],[.5,1]],[[1,.5],[.5,1]],
  [[0,.5],[1,.5]],[[.5,0],[1,.5]],[[0,.5],[.5,0]],[]];

function surface() {
  const out = typeof OffscreenCanvas === 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(SURFACE_SIZE,SURFACE_SIZE);
  out.width = out.height = SURFACE_SIZE;
  return out;
}
function rng(seed) { let n=seed>>>0;return()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;}; }
function rgb(color) { return [1,3,5].map(i=>parseInt(color.slice(i,i+2),16)); }
function mix(a,b,t) { const x=rgb(a),y=rgb(b);return `rgb(${x.map((v,i)=>Math.round(v+(y[i]-v)*t)).join(',')})`; }
function grain(random, divisions) {
  const values=Float32Array.from({length:divisions*divisions},()=>random()-.5);
  return (x,y)=>{
    const u=x/SURFACE_SIZE*divisions,v=y/SURFACE_SIZE*divisions;
    const ix=Math.floor(u),iy=Math.floor(v),fx=u-ix,fy=v-iy;
    const sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);
    const a=values[iy*divisions+ix],b=values[iy*divisions+(ix+1)%divisions];
    const c=values[((iy+1)%divisions)*divisions+ix],d=values[((iy+1)%divisions)*divisions+(ix+1)%divisions];
    return (a+(b-a)*sx)*(1-sy)+(c+(d-c)*sx)*sy;
  };
}
function shape(c,mask) {
  c.beginPath();
  const parts=mask===5?[POLYGONS[1],POLYGONS[4]]:mask===10?[POLYGONS[2],POLYGONS[8]]:[POLYGONS[mask]];
  for(const points of parts) {
    if(!points.length)continue;
    c.moveTo(points[0][0]*SIZE,points[0][1]*SIZE);
    for(let i=1;i<=points.length;i++) {
      const a=points[i-1],b=points[i%points.length];
      if((a[0]===.5||a[1]===.5)&&(b[0]===.5||b[1]===.5))c.quadraticCurveTo(SIZE*.5,SIZE*.5,b[0]*SIZE,b[1]*SIZE);
      else c.lineTo(b[0]*SIZE,b[1]*SIZE);
    }
    c.closePath();
  }
}
function contour(c,mask,offset=0) {
  const points=CONTOURS[mask];c.beginPath();
  for(let i=0;i<points.length;i+=2){const a=points[i],b=points[i+1];c.moveTo(a[0]*SIZE,a[1]*SIZE+offset);c.quadraticCurveTo(SIZE*.5,SIZE*.5+offset,b[0]*SIZE,b[1]*SIZE+offset);}
}

export class TerrainSprites {
  constructor(index,palette) {
    this.index=index;this.palette=palette;this.materials=new Map();this.edges=new Map();
    const p=palette;
    this.colors=index===3?[p.water,'#9b9a72','#346d52','#537a54']:
      index===0?[p.water,'#4e5740',p.mid,p.high]:
      index===4||index===9?[p.low,p.base,p.mid,p.high]:
      index===6?[p.water,'#603429',p.base,p.mid]:[p.water,p.low,p.base,p.high];
  }
  getMaterial(material,variant) {
    const key=material*6+variant;
    if(this.materials.has(key))return this.materials.get(key);
    const out=surface(),c=out.getContext('2d'),p=this.palette,index=this.index;
    const random=rng(9037+index*11771+material*813+variant*3307);
    const base=rgb(this.colors[material]),pixels=c.createImageData(SURFACE_SIZE,SURFACE_SIZE),data=pixels.data;
    const coarse=grain(random,5),fine=grain(random,17),space=index===4||index===9;
    // Soft mineral/moss patches and fine grain, baked once. Edges share a base tone.
    for(let y=0;y<SURFACE_SIZE;y++)for(let x=0;x<SURFACE_SIZE;x++) {
      const u=x/RESOLUTION,v=y/RESOLUTION,i=(y*SURFACE_SIZE+x)*4;
      const edge=Math.min(1,x/16,y/16,(SURFACE_SIZE-1-x)/16,(SURFACE_SIZE-1-y)/16);
      let light=(random()-.5)*8+(coarse(x,y)*15+fine(x,y)*7)*edge;
      if(index===2||index===5)light+=Math.sin(v*.34+Math.sin(u*.046)*3)*4;
      if(material===0)light*=space?.08:.42;
      for(let k=0;k<3;k++)data[i+k]=Math.max(0,Math.min(255,base[k]+light));data[i+3]=255;
    }
    c.putImageData(pixels,0,0);c.scale(RESOLUTION,RESOLUTION);c.lineCap='round';
    if(material===0) {
      if(space){for(let i=0;i<12;i++){const x=random()*SIZE,y=random()*SIZE;c.fillStyle=i%4?'#718294':'#b0b8c3';c.globalAlpha=.16+random()*.25;c.fillRect(x,y,i%4?.5:1,.7);}}
      else for(let i=0;i<20;i++){
        const x=random()*SIZE,y=random()*SIZE;
        c.strokeStyle=index===6?'#ed9858':index===5?'#b77857':'#8ac0ba';c.globalAlpha=.055+random()*.08;c.lineWidth=.5;
        c.beginPath();c.moveTo(x,y);c.quadraticCurveTo(x+4,y-2,x+9+random()*12,y);c.stroke();
      }
    } else if(index===7||index===9) {
      c.globalAlpha=.28;c.strokeStyle=p.high;c.lineWidth=.7;c.strokeRect(4,4,92,92);
      for(let i=0;i<3;i++){const y=11+i*28;c.fillStyle=p.low;c.fillRect(9,y,82,24);c.fillStyle=p.mid;c.fillRect(10,y,80,1);for(let j=0;j<6;j++){c.fillStyle=p.high;c.fillRect(15+j*12,y+7,5,1);}}
      c.globalAlpha=.34;c.strokeStyle=index===7?'#8b7598':'#94738a';c.beginPath();c.moveTo(4,70);c.lineTo(19,70);c.lineTo(24,65);c.lineTo(80,65);c.stroke();
    } else {
      // Low relief fragments give the surface texture without competing with ships.
      for(let i=0;i<10;i++) {
        const x=10+random()*80,y=10+random()*80,rx=4+random()*11,ry=rx*(.4+random()*.25);
        c.globalAlpha=.12;c.fillStyle=p.low;
        c.beginPath();c.ellipse(x+1,y+2,rx,ry,0,0,TAU);c.fill();
        c.fillStyle=i%2?p.high:p.mid;c.globalAlpha=.13;
        c.beginPath();c.ellipse(x,y,rx,ry,0,0,TAU);c.fill();
        if(material===3){c.strokeStyle=p.high;c.globalAlpha=.2;c.lineWidth=.6;c.beginPath();c.ellipse(x,y,rx*.85,ry*.85,0,Math.PI,TAU);c.stroke();}
      }
      // Fine stones, sediment and leaf fragments; all rasterized once into the atlas.
      for(let i=0;i<130;i++){
        const x=random()*SIZE,y=random()*SIZE,r=.25+random()*1.8;
        c.globalAlpha=.10+random()*.15;c.fillStyle=i%3?p.low:p.high;
        c.beginPath();c.ellipse(x+1,y+1,r*1.2,r*.6,0,0,TAU);c.fill();
        c.fillStyle=i%3?p.high:p.shore;c.fillRect(x,y,r,.5);
      }
      if(index===0||index===3||index===8)for(let i=0;i<24;i++){
        const x=5+random()*90,y=5+random()*90;
        c.globalAlpha=.11+random()*.14;c.strokeStyle=i%2?p.high:p.low;c.lineWidth=.65;
        c.beginPath();c.moveTo(x-3,y+3);c.quadraticCurveTo(x-2,y-4,x+5,y-4);c.stroke();
      }
      if(material===3||index===5||index===6||index===4){
        for(let i=0;i<5;i++){
          const x=8+random()*84,y=8+random()*84;c.globalAlpha=.2;c.strokeStyle=p.low;c.lineWidth=1.1;
          c.beginPath();c.moveTo(x-8,y-6);c.lineTo(x,y);c.lineTo(x+4,y-2);c.lineTo(x+12,y+6);c.stroke();
          c.globalAlpha=.15;c.strokeStyle=p.high;c.lineWidth=.5;c.stroke();
        }
      }
    }
    c.globalAlpha=1;this.materials.set(key,out);return out;
  }
  get(material,variant,mask=15) {
    if(mask===15)return this.getMaterial(material,variant);
    const key=`${material}:${variant}:${mask}`;
    if(this.edges.has(key))return this.edges.get(key);
    const out=surface(),c=out.getContext('2d');c.scale(RESOLUTION,RESOLUTION);
    if(mask) {
      const p=this.palette;
      // Recessed banks and stratified cliff faces under each raised surface.
      c.lineCap='round';c.lineJoin='round';
      for(const [offset,width,alpha] of [[4,8,.28],[2,5,.45],[0,2,.65]]){
        contour(c,mask,offset);c.strokeStyle=p.low;c.globalAlpha=alpha;c.lineWidth=material===3?width:width*.6;c.stroke();
      }
      c.globalAlpha=1;c.save();shape(c,mask);c.clip();c.drawImage(this.getMaterial(material,variant),0,0,SIZE,SIZE);c.restore();
      contour(c,mask);c.strokeStyle=material===1?mix(this.colors[1],p.shore,.45):mix(this.colors[material],p.high,.35);c.globalAlpha=.8;c.lineWidth=material===1?2.4:1.5;c.stroke();
      if(material===3){contour(c,mask,2);c.strokeStyle=p.low;c.globalAlpha=.35;c.lineWidth=.8;c.stroke();}
    }
    this.edges.set(key,out);return out;
  }
  warm() {for(let material=0;material<4;material++)for(let variant=0;variant<6;variant++)this.getMaterial(material,variant);}
}
