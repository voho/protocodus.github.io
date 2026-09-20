/** Small reusable material sprites and matching shoreline/cliff masks. No landscape images. */
import { MAP_TILE_SIZE } from './tile-map.js';
import { spriteCell } from './sprite-assets.js';

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
function edgeNormal([x,y]) {
  return x===0?[1,0]:x===1?[-1,0]:y===0?[0,1]:[0,-1];
}
function samePoint(a,b) {return a[0]===b[0]&&a[1]===b[1];}
// Every bank meets its neighbor at the same crossing and at a perpendicular
// tangent. Only the interior wanders, so all six variants fit every tile edge.
function contourParts(mask,variant,index) {
  const parts=[],points=CONTOURS[mask];
  const jagged=index===4||index===5||index===6||index===9;
  const angular=index===7||index===9;
  const random=rng(9817+mask*7187+variant*3307+index*1777);
  for(let i=0;i<points.length;i+=2) {
    const a=points[i],b=points[i+1],na=edgeNormal(a),nb=edgeNormal(b);
    const reach=angular?.34:.27+random()*.18;
    const ca=[a[0]+na[0]*reach,a[1]+na[1]*reach],cb=[b[0]+nb[0]*reach,b[1]+nb[1]*reach];
    const insideA=[a[0]+na[0]*.15,a[1]+na[1]*.15],insideB=[b[0]+nb[0]*.15,b[1]+nb[1]*.15];
    const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),nx=-dy/length,ny=dx/length;
    const phase=random()*TAU,bend=(random()-.5)*.27,roughness=angular?.037:jagged?.075:index===1?.043:.059;
    const result=[[a[0]*SIZE,a[1]*SIZE]];
    for(let step=0;step<=20;step++) {
      const t=step/20,q=1-t,envelope=Math.sin(Math.PI*t)**2;
      const rough=(Math.sin(t*TAU*3+phase)*.56+Math.sin(t*TAU*7+phase*1.7)*.30+Math.sin(t*TAU*11+phase*.6)*.14)*roughness;
      const drift=envelope*(bend+rough);
      result.push([(q*q*q*insideA[0]+3*q*q*t*ca[0]+3*q*t*t*cb[0]+t*t*t*insideB[0]+nx*drift)*SIZE,
        (q*q*q*insideA[1]+3*q*q*t*ca[1]+3*q*t*t*cb[1]+t*t*t*insideB[1]+ny*drift)*SIZE]);
    }
    result.push([b[0]*SIZE,b[1]*SIZE]);
    parts.push({a,b,points:result});
  }
  return parts;
}
function shape(c,mask,contours) {
  c.beginPath();
  const parts=mask===5?[POLYGONS[1],POLYGONS[4]]:mask===10?[POLYGONS[2],POLYGONS[8]]:[POLYGONS[mask]];
  for(const points of parts) {
    if(!points.length)continue;
    c.moveTo(points[0][0]*SIZE,points[0][1]*SIZE);
    for(let i=1;i<=points.length;i++) {
      const a=points[i-1],b=points[i%points.length];
      const boundary=contours.find(part=>(samePoint(part.a,a)&&samePoint(part.b,b))||(samePoint(part.a,b)&&samePoint(part.b,a)));
      if(boundary) {
        const points=samePoint(boundary.a,a)?boundary.points:[...boundary.points].reverse();
        for(const [x,y]of points)c.lineTo(x,y);
      } else c.lineTo(b[0]*SIZE,b[1]*SIZE);
    }
    c.closePath();
  }
}
function contour(c,parts,offset=0) {
  c.beginPath();
  for(const part of parts){
    const na=edgeNormal(part.a),nb=edgeNormal(part.b),first=part.points[0],last=part.points.at(-1);
    // Extend cast shadows beyond a tile before clipping; round caps at the
    // exact boundary would otherwise leave a small notch at every tile join.
    c.moveTo(first[0]-na[0]*20+offset*.42,first[1]-na[1]*20+offset);
    for(const [x,y]of part.points)c.lineTo(x+offset*.42,y+offset);
    c.lineTo(last[0]-nb[0]*20+offset*.42,last[1]-nb[1]*20+offset);
  }
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
    const texture=spriteCell('materials',index*4+material);
    if(texture) {
      // Cropping at varied scales keeps recognizable source features from
      // repeating as a row of identical stamps, while retaining fine detail.
      const zoom=1.22+(variant%3)*.15,span=SURFACE_SIZE*zoom;
      const dx=(random()-.5)*(span-SURFACE_SIZE)*.8,dy=(random()-.5)*(span-SURFACE_SIZE)*.8;
      c.save();c.translate(SURFACE_SIZE/2,SURFACE_SIZE/2);
      c.rotate((variant%4)*Math.PI/2);c.scale(variant>=4?-1:1,1);
      c.drawImage(texture,-span/2+dx,-span/2+dy,span,span);c.restore();
      const pixels=c.getImageData(0,0,SURFACE_SIZE,SURFACE_SIZE),data=pixels.data,base=rgb(this.colors[material]);
      const seam=grain(rng(4919+index*7717+material*811),7);
      let mean=0;
      for(let i=0;i<data.length;i+=4)mean+=data[i]*.2126+data[i+1]*.7152+data[i+2]*.0722;
      mean/=SURFACE_SIZE*SURFACE_SIZE;
      for(let y=0;y<SURFACE_SIZE;y++)for(let x=0;x<SURFACE_SIZE;x++) {
        const i=(y*SURFACE_SIZE+x)*4,luma=data[i]*.2126+data[i+1]*.7152+data[i+2]*.0722;
        const edge=Math.min(1,x/7,y/7,(SURFACE_SIZE-1-x)/7,(SURFACE_SIZE-1-y)/7);
        // Common edge tones join independently chosen cells without a hard seam.
        // Luminosity retains the generated relief; hue belongs to the biome.
        const contrast=material===0&&(index===4||index===9)?.3:.85;
        const shade=1+Math.max(-.48,Math.min(.58,(luma-mean)/128))*edge*contrast+seam(x,y)*.13;
        for(let k=0;k<3;k++)data[i+k]=Math.min(255,base[k]*shade);
        data[i+3]=255;
      }
      c.putImageData(pixels,0,0);this.addRelief(c,material,variant);this.materials.set(key,out);return out;
    }
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
    c.globalAlpha=1;c.resetTransform();this.addRelief(c,material,variant);this.materials.set(key,out);return out;
  }
  addRelief(c,material,variant) {
    const index=this.index,p=this.palette,random=rng(7121+index*5519+material*1319+variant*3323);
    const space=index===4||index===9,desert=index===2||index===5,organic=index===0||index===3||index===8;
    c.save();c.scale(RESOLUTION,RESOLUTION);c.lineCap='round';c.lineJoin='round';
    // All relief is baked into reusable material cells. Nothing below runs in
    // a warm frame, and insets keep local features away from stitching edges.
    if(material===0) {
      if(!space)for(let i=0;i<7;i++) {
        const x=10+random()*56,y=10+random()*75,length=9+random()*19;
        c.strokeStyle=index===6?p.shore:mix(this.colors[0],p.shore,.55);c.globalAlpha=.06+random()*.05;c.lineWidth=.45;
        c.beginPath();c.moveTo(x,y);c.bezierCurveTo(x+length*.3,y-3,x+length*.7,y+3,x+length,y);c.stroke();
      }
      c.restore();return;
    }
    const count=material===3?7:4;
    for(let i=0;i<count;i++) {
      const rx=5+random()*11,ry=rx*(desert?.43:.52+random()*.28),x=12+rx+random()*(76-rx*2),y=12+ry+random()*(72-ry*2),points=[];
      for(let j=0;j<12;j++) {
        const a=j/12*TAU,r=.65+random()*.35;
        points.push([x+Math.cos(a)*rx*r,y+Math.sin(a)*ry*r]);
      }
      const path=(dy=0)=>{c.beginPath();points.forEach(([px,py],j)=>j?c.lineTo(px,py+dy):c.moveTo(px,py+dy));c.closePath();};
      path(2.5);c.fillStyle=p.low;c.globalAlpha=material===3?.22:.12;c.fill();
      path();const shade=c.createLinearGradient(x,y-ry,x,y+ry);
      shade.addColorStop(0,mix(this.colors[material],p.high,.44));shade.addColorStop(.44,this.colors[material]);shade.addColorStop(1,mix(this.colors[material],p.low,.65));
      c.fillStyle=shade;c.globalAlpha=material===3?.36:.24;c.fill();
      // A broken sunward lip makes each mound read as relief instead of a dot.
      c.beginPath();for(let j=6;j<12;j++){const [px,py]=points[j];j===6?c.moveTo(px,py):c.lineTo(px,py);}
      c.strokeStyle=p.high;c.globalAlpha=.17;c.lineWidth=.65;c.stroke();
      if(organic) {
        c.fillStyle=i%2?p.high:p.low;c.globalAlpha=.12;
        for(let j=0;j<5;j++){const px=x+(random()-.5)*rx,py=y+(random()-.5)*ry;c.beginPath();c.ellipse(px,py,1+random()*2,.6+random(),random()*TAU,0,TAU);c.fill();}
      }
    }
    // Erosion channels, glacial fissures and cracked stone use different widths
    // and branching, but never add a competing bright color to the terrain.
    const fractured=material===3||index===1||index===4||index===5||index===6;
    for(let i=0;i<(fractured?4:2);i++) {
      const length=13+random()*22,x=12+random()*(76-length),y=14+random()*61,points=[];
      for(let j=0;j<6;j++)points.push([x+j*length/5,y+(j-2)*1.4+(random()-.5)*(desert?3:7)]);
      const stroke=(dy,color,width,alpha)=>{c.beginPath();points.forEach(([px,py],j)=>j?c.lineTo(px,py+dy):c.moveTo(px,py+dy));c.strokeStyle=color;c.lineWidth=width;c.globalAlpha=alpha;c.stroke();};
      stroke(1,p.high,1.2,fractured?.15:.08);stroke(0,p.low,fractured?1.5:.7,fractured?.32:.16);
      if(fractured&&i%2===0){const [px,py]=points[3];c.beginPath();c.moveTo(px,py);c.lineTo(px-1,py+4);c.lineTo(px+3,py+8);c.lineWidth=.8;c.globalAlpha=.23;c.stroke();}
    }
    if(desert||index===1)for(let i=0;i<5;i++) {
      const x=12+random()*45,y=12+random()*74,length=16+random()*22;
      c.strokeStyle=p.high;c.globalAlpha=.09;c.lineWidth=.7;
      c.beginPath();c.moveTo(x,y);c.bezierCurveTo(x+length*.3,y-4,x+length*.7,y+1,x+length,y-2);c.stroke();
    }
    c.restore();
  }
  get(material,variant,mask=15) {
    if(mask===15)return this.getMaterial(material,variant);
    const key=`${material}:${variant}:${mask}`;
    if(this.edges.has(key))return this.edges.get(key);
    const out=surface(),c=out.getContext('2d');c.scale(RESOLUTION,RESOLUTION);
    if(mask) {
      const p=this.palette,parts=contourParts(mask,variant,this.index),cliff=material===3;
      // Recessed banks and stratified cliff faces under each raised surface.
      c.lineCap='round';c.lineJoin='round';
      for(const [offset,width,alpha] of [[8,9,.17],[5,7,.25],[3,5,.38],[0,2,.58]]){
        contour(c,parts,cliff?offset:offset*.4);c.strokeStyle=p.low;c.globalAlpha=alpha;c.lineWidth=cliff?width:width*.55;c.stroke();
      }
      // Broken sediment shelves sit within the deeper cast shadow.
      if(cliff)for(const offset of [2.7,5.3]) {
        contour(c,parts,offset);c.strokeStyle=mix(this.colors[material],p.low,.4);c.globalAlpha=.5;c.lineWidth=.8;c.stroke();
      }
      c.globalAlpha=1;c.save();shape(c,mask,parts);c.clip();c.drawImage(this.getMaterial(material,variant),0,0,SIZE,SIZE);c.restore();
      contour(c,parts);c.strokeStyle=material===1?mix(this.colors[1],p.shore,.32):mix(this.colors[material],p.high,.4);c.globalAlpha=material===1?.55:.65;c.lineWidth=material===1?1.6:1.15;c.stroke();
      // Sparse bank chips soften the continuous contour without a repeated rim.
      const random=rng(3911+this.index*1193+mask*117+variant*911+material*551);
      for(const {points}of parts)for(let i=3;i<points.length-3;i+=3) {
        const [x,y]=points[i],r=.45+random()*.85;
        c.fillStyle=i%2?p.low:p.high;c.globalAlpha=.16+random()*.1;c.beginPath();c.ellipse(x+(random()-.5)*4,y+(random()-.5)*4,r*1.8,r,random()*TAU,0,TAU);c.fill();
      }
    }
    this.edges.set(key,out);return out;
  }
  warm() {for(let material=0;material<4;material++)for(let variant=0;variant<6;variant++)this.getMaterial(material,variant);}
}
