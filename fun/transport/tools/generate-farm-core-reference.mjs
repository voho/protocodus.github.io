#!/usr/bin/env node
// Geometry-only farm construction guide, derived from the canonical camera.
import { writeFile } from 'node:fs/promises';
import { BUILDING_PALETTES, projectBuildingMasterPoint } from '../sprite-art-direction.js';
const [output, biome='taiga'] = process.argv.slice(2), colors=BUILDING_PALETTES[biome];
if (!output || !colors) throw new Error('Usage: generate-farm-core-reference.mjs output.svg [biome]');
const p=(e,n,h=0)=>projectBuildingMasterPoint(e,n,h,2,512);
const points=a=>a.map(v=>v.map(c=>c.toFixed(3)).join(',')).join(' ');
const polygon=(a,fill)=>`<polygon points="${points(a)}" fill="${fill}" stroke="${colors.ink}" stroke-width=".8"/>`;
function barn(e,n,w,d,z,rise,wall,roof,loading=true) {
  const q=(a,b,h=0)=>p(e+a,n+b,h), x=w/2,y=d/2;
  let result=polygon([q(-x,y),q(x,y),q(x,y,z),q(-x,y,z)],wall)
    +polygon([q(x,-y),q(x,y),q(x,y,z),q(x,-y,z)],colors.stone)
    +polygon([q(-x,-y,z),q(x,-y,z),q(x,0,z+rise),q(-x,0,z+rise)],roof)
    +polygon([q(-x,y,z),q(x,y,z),q(x,0,z+rise),q(-x,0,z+rise)],roof)
    +polygon([q(x,-y,z),q(x,y,z),q(x,0,z+rise)],wall);
  const dx=-w/4,half=.475;
  result+=polygon([q(dx-half,y),q(dx+half,y),q(dx+half,y,2.1),q(dx-half,y,2.1)],colors.ink);
  if(loading){const bx=w/5,bh=Math.min(z,4.2);result+=polygon([q(bx-1.5,y),q(bx+1.5,y),q(bx+1.5,y,bh),q(bx-1.5,y,bh)],colors.ink);}
  return result;
}
function shelter(e,n,w,d,z,roof){
  const q=(a,b,h=0)=>p(e+a,n+b,h),x=w/2,y=d/2;
  return polygon([q(-x,-y,z),q(x,-y,z),q(x,y,z),q(-x,y,z)],roof)+[-1,1].flatMap(a=>[-1,1].map(b=>{const bottom=q(a*x,b*y),top=q(a*x,b*y,z);return `<path d="M${top.join(',')}L${bottom.join(',')}" stroke="${colors.timber}" stroke-width="3.3"/>`;})).join('');
}
function silo(e,n,r,z){const [x,y]=p(e,n),ry=r*10.6666667/Math.SQRT2,rx=ry*2,h=z*10.6666667;return `<path d="M${x-rx},${y-h}V${y}A${rx},${ry} 0 0 0 ${x+rx},${y}V${y-h}Z" fill="${colors.metal}" stroke="${colors.ink}" stroke-width=".8"/><ellipse cx="${x}" cy="${y-h}" rx="${rx}" ry="${ry}" fill="${colors.stone}" stroke="${colors.ink}" stroke-width=".8"/><path d="M${x-rx},${y-h}Q${x},${y-h-17} ${x+rx},${y-h}" fill="${colors.metal}" stroke="${colors.ink}" stroke-width=".8"/>`;}
function greenhouse(){const e=4,n=-3,w=8,d=8,z=3,rise=1.8,q=(a,b,h=0)=>p(e+a,n+b,h),x=w/2,y=d/2;let s=polygon([q(-x,y),q(x,y),q(x,y,z),q(-x,y,z)],colors.glass)+polygon([q(x,-y),q(x,y),q(x,y,z),q(x,-y,z)],colors.glass)+polygon([q(-x,-y,z),q(x,-y,z),q(x,0,z+rise),q(-x,0,z+rise)],colors.glass)+polygon([q(-x,y,z),q(x,y,z),q(x,0,z+rise),q(-x,0,z+rise)],colors.glass)+polygon([q(x,-y,z),q(x,y,z),q(x,0,z+rise)],colors.glass);for(const a of [-2,0,2])s+=`<polyline points="${points([q(a,-y),q(a,-y,z),q(a,0,z+rise),q(a,y,z),q(a,y)])}" stroke="${colors.cream}" stroke-width="1.8" fill="none"/>`;return s;}
const forms=[
  barn(-2,-1,12,8,4,2,colors.burgundy,colors.slate)+silo(6,-5,1.8,9)+shelter(5,5,6,4,3,colors.slate),
  barn(-1,-2,15,7,4,2,colors.plaster,colors.terracotta)+silo(6,5,1.7,3.4)+shelter(-4,5,6,4,3,colors.slate),
  greenhouse()+barn(-4,4,7,6,3,1.5,colors.timber,colors.slate),
  barn(-3,-1,11,7,3,2,colors.plaster,colors.terracotta,false)+shelter(5,4,6,5,3,colors.terracotta),
  barn(-3,-3,13,6,3.5,2,colors.timber,colors.slate)+barn(5,0,5,9,3.5,2,colors.timber,colors.slate,false)+shelter(0,6,8,4,3,colors.slate),
];
const cells=forms.map((form,i)=>`<g transform="translate(${i%3*512},${Math.floor(i/3)*512})">${polygon([p(-10,-10),p(10,-10),p(10,10),p(-10,10)],colors.ground)}${form}<path d="M248 384h16M256 376v16" fill="none" stroke="${colors.cream}" stroke-width="1"/></g>`).join('');
await writeFile(output,`<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024" viewBox="0 0 1536 1024"><rect width="1536" height="1024" fill="#f6f4ed"/>${cells}</svg>\n`);
