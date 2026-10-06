import { randomSource } from './world-noise.js';

const SIZE=128,STONE_SCALE=.55,surfaces=new Map(),materials=new WeakMap();
const PALETTES={
  taiga:{stone:[142,145,130],joint:[77,86,70],moss:[86,108,64]},
  tundra:{stone:[157,164,158],joint:[87,101,90],moss:[111,129,99]},
  desert:{stone:[185,159,119],joint:[117,94,64],moss:[133,119,75]},
};
const color=(rgb,light=1,offset=0)=>`rgb(${rgb.map(n=>Math.round(Math.max(0,Math.min(255,n*light+offset)))).join(',')})`;

function clip(points,a,b,d){
  const next=[];
  for(let n=0;n<points.length;n++){
    const p=points[n],q=points[(n+1)%points.length],ps=p[0]*a+p[1]*b-d,qs=q[0]*a+q[1]*b-d;
    if(ps<=0)next.push(p);
    if((ps<0)!==(qs<0)){const t=ps/(ps-qs);next.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);}
  }
  return next;
}

// Uneven, tightly fitted fieldstones have no horizontal courses. Periodic
// Voronoi cells wrap at the material's edges, keeping walls seamless on pans.
const stones=(()=>{
  const r=randomSource(39197),sites=[];
  for(let n=0;n<220;n++)sites.push([r()*SIZE,r()*SIZE,1+r()*3]);
  return sites.map(([x,y,weight])=>{
    let points=[[x-40,y-40],[x+40,y-40],[x+40,y+40],[x-40,y+40]];
    for(const [sx,sy,other]of sites)for(const ox of[-SIZE,0,SIZE])for(const oy of[-SIZE,0,SIZE]){
      const u=sx+ox,v=sy+oy,a=u-x,b=v-y;
      if(!a&&!b||a*a+b*b>2500)continue;
      points=clip(points,a,b,(u*u+v*v-x*x-y*y+weight*weight-other*other)/2);
      if(!points.length)break;
    }
    if(points.length<3)return null;
    const cx=points.reduce((sum,p)=>sum+p[0],0)/points.length,cy=points.reduce((sum,p)=>sum+p[1],0)/points.length;
    const inset=.89+r()*.045;
    return{points:points.map(([u,v])=>[cx+(u-cx)*inset,cy+(v-cy)*inset]),cx,cy,tone:(r()-.5)*37,warm:(r()-.5)*12,split:r()<.23,moss:r()<.2,seed:Math.floor(r()*1e8)};
  }).filter(Boolean);
})();

function material(c,biome,side,pixelScale){
  let cache=materials.get(c);if(!cache)materials.set(c,cache=new Map());
  const density=Math.max(1,Math.min(3,Math.ceil(pixelScale))),key=`${biome}:${side}:${density}`;
  if(cache.has(key))return cache.get(key);
  let canvas=surfaces.get(key);
  if(!canvas){
    canvas=document.createElement('canvas');canvas.width=canvas.height=SIZE*density;
    const p=PALETTES[biome]||PALETTES.taiga,light=side===0?.8:1,ctx=canvas.getContext('2d');ctx.scale(density,density);
    ctx.fillStyle=color(p.joint,light);ctx.fillRect(0,0,SIZE,SIZE);
    for(const stone of stones){
      const{points,cx,cy,tone,warm,split,moss,seed}=stone,r=randomSource(seed),rgb=[p.stone[0]+warm,p.stone[1]+warm*.25,p.stone[2]-warm*.3];
      const minX=Math.min(...points.map(p=>p[0])),maxX=Math.max(...points.map(p=>p[0])),minY=Math.min(...points.map(p=>p[1])),maxY=Math.max(...points.map(p=>p[1]));
      for(const ox of[-SIZE,0,SIZE])for(const oy of[-SIZE,0,SIZE]){
        if(maxX+ox<0||minX+ox>SIZE||maxY+oy<0||minY+oy>SIZE)continue;
        ctx.save();ctx.translate(ox,oy);ctx.beginPath();points.forEach(([u,v],i)=>i?ctx.lineTo(u,v):ctx.moveTo(u,v));ctx.closePath();
        const shade=ctx.createLinearGradient(minX,minY,maxX,maxY);shade.addColorStop(0,color(rgb,light,tone+11));shade.addColorStop(.5,color(rgb,light,tone));shade.addColorStop(1,color(rgb,light,tone-13));
        ctx.fillStyle=shade;ctx.fill();ctx.clip();
        ctx.strokeStyle='rgba(29,38,28,.38)';ctx.lineWidth=.75;ctx.stroke();
        // Light catches only the upper-facing broken facets, never a full
        // rectangular outline. Small chips and pores break up each face.
        ctx.beginPath();for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];if((a[1]+b[1])/2<cy){ctx.moveTo(a[0],a[1]+.3);ctx.lineTo(b[0],b[1]+.3);}}
        ctx.strokeStyle='rgba(246,238,215,.4)';ctx.lineWidth=.65;ctx.stroke();
        if(split){ctx.beginPath();ctx.moveTo(cx-3,cy-5);ctx.lineTo(cx-.4,cy-.4);ctx.lineTo(cx+2,cy+1.2);ctx.lineTo(cx+1.3,cy+4);ctx.strokeStyle='rgba(38,44,34,.28)';ctx.lineWidth=.45;ctx.stroke();}
        for(let n=0;n<22;n++){const u=minX+r()*(maxX-minX),v=minY+r()*(maxY-minY),size=.25+r()*.75;ctx.fillStyle=n%3?'rgba(34,41,31,.22)':'rgba(242,234,213,.32)';ctx.fillRect(u,v,size,size*.65);}
        if(moss&&biome!=='desert'){ctx.globalAlpha=.55;ctx.fillStyle=color(p.moss,light);for(let n=0;n<4;n++){const point=points[n%points.length];ctx.beginPath();ctx.ellipse(point[0]+.6,point[1]+.9,.6+r()*1.1,.45+r()*.8,r(),0,Math.PI*2);ctx.fill();}}
        ctx.restore();
      }
    }
    // 3 climates × 2 wall directions × 3 densities: at most 7 MiB of shared
    // material pixels, regardless of how many prepared scenery contexts draw.
    surfaces.set(key,canvas);
  }
  const value={pattern:c.createPattern(canvas,'repeat'),density};cache.set(key,value);return value;
}

export function paintFoundationStones(c,{path,tops,drop,side,seed},biome,pixelScale){
  if(drop<=0)return;
  const first=tops[0],last=tops.at(-1),width=Math.abs(last.x-first.x),{pattern,density}=material(c,biome,side,pixelScale);
  if(!width)return;
  c.save();c.clip(path);c.transform(Math.sign(last.x-first.x),(last.y-first.y)/width,0,1,first.x,first.y);
  pattern.setTransform(new DOMMatrix([STONE_SCALE/density,0,0,STONE_SCALE/density,-(seed>>>0)%SIZE,-(seed>>>8)%SIZE]));
  c.fillStyle=pattern;c.fillRect(0,0,width,drop+.5);c.restore();
}
