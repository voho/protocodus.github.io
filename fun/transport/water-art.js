import { noise as fieldNoise } from './world-noise.js';

// Local, seeded water detail painted inside the coastline clip. These washes
// live in terrain chunks; only a handful of restrained wave groups animate.
const TONES={
  taiga:{deep:'#285d68',shelf:'#76aaa0',sand:'#b7b48c',wet:'#607964',foam:'#dce8ce',reflection:'#244d43'},
  tundra:{deep:'#405f74',shelf:'#96bab8',sand:'#b8c5bb',wet:'#728d89',foam:'#dbe7df',reflection:'#3c6063'},
  desert:{deep:'#376975',shelf:'#83b6ad',sand:'#c6ad7c',wet:'#978e70',foam:'#e9e1c5',reflection:'#536d4c'},
};
function noise(x,y,seed){let n=Math.imul(x+37,374761393)^Math.imul(y+113,668265263)^seed;n=Math.imul(n^(n>>>13),1274126177);return((n^(n>>>16))>>>0)/4294967296;}
function stroke(c,points,color,width){c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.strokeStyle=color;c.lineWidth=width;c.stroke();}
function wash(c,x,y,r,color,alpha){const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,color+alpha);g.addColorStop(1,color+'00');c.fillStyle=g;c.fillRect(x-r,y-r,r*2,r*2);}

export function paintWaterRelief(c,b,tile,biome,seed,profile,layers,{treeIsVisible=()=>true}={}){
  const tone=TONES[biome]||TONES.taiga;
  const land=(x,y)=>{const t=tile(x,y);return t&&t.terrain!=='water';};
  c.save();c.lineCap='round';
  for(let y=b.y0;y<b.y1;y++)for(let x=b.x0;x<b.x1;x++){
    const t=tile(x,y);if(t?.terrain!=='water')continue;
    const px=x*32,py=y*32,n=noise(x,y,seed),n2=noise(x+731,y-251,seed),shelf=fieldNoise(x,y,seed+271,4.3);
    let depth=4;
    for(let d=1;d<=3;d++)if(land(x-d,y)||land(x+d,y)||land(x,y-d)||land(x,y+d)||land(x-d,y-d)||land(x+d,y+d)||land(x+d,y-d)||land(x-d,y+d)){depth=d;break;}
    if(depth<4){
      wash(c,px+9+n*14,py+10+n2*12,22+shelf*19,tone.shelf,depth===1?(shelf>.5?'48':'34'):depth===2?'25':'12');
      if(depth===1&&shelf>.56)wash(c,px+16+(n-.5)*12,py+16+(n2-.5)*12,12+n*11,tone.sand,'14');
    }else{
      const basin=fieldNoise(x,y,seed+283,9.7);
      wash(c,px+12+n*8,py+12+n2*8,28+n2*15,basin>.52?tone.shelf:tone.deep,basin>.52?'0b':'20');
    }
    // Submerged sand and stones trace shallow banks. Their world-anchored marks
    // meet seamlessly where cached chunks overlap, including fractional DPRs.
    if(depth===1){
      for(const [dx,dy]of [[0,-1],[-1,0],[1,0],[0,1]])if(land(x+dx,y+dy)){
        const bank=tile(x+dx,y+dy),bx=px+16+dx*13,by=py+16+dy*13;
        // Only sedimentary stretches expose pale sand. Rocky, wooded and steep
        // banks stay darker, making a coast read as varied geology.
        const sediment=bank.terrain==='sand'||(!['rock','mountain','forest'].includes(bank.terrain)&&shelf>.48);
        wash(c,bx,by,8+shelf*12,sediment?tone.sand:tone.deep,sediment?'30':'16');
        if(profile!=='region'&&sediment&&n>.45)for(let j=0;j<2;j++){
          const along=6+noise(x*7+j,y*3,seed)*20,xx=dx?bx:px+along,yy=dy?by:py+along;
          stroke(c,[[xx,yy],[xx+1.1+n,yy-.3]],tone.sand+'46',.65);
        }
        const reflectedTree=layers.trees&&bank.terrain==='forest'&&treeIsVisible(x+dx,y+dy);
        if(dy===-1&&n>.62&&(reflectedTree||(layers.buildings&&bank.building))){
          const color=reflectedTree?tone.reflection+'1c':'#d3cab124';
          for(let j=0;j<(n>.5?3:2);j++){const xx=px+5+j*9+n2*4,h=4+noise(x+j,y+19,seed)*7;stroke(c,[[xx,py+4],[xx-1,py+7],[xx+1,py+h]],color,reflectedTree?2.5:4);}
        }
      }
    }
    // Broken, gently curved ripples instead of identical horizontal dashes.
    const count=profile==='region'?0:n>.45?1:0;
    for(let k=0;k<count;k++){
      const a=noise(x*3+k,y*5+13,seed),xx=px+4+a*21,yy=py+5+noise(x+37,y*2+k,seed)*22,w=3+n2*6;
      stroke(c,[[xx,yy],[xx+w*.45,yy-.5],[xx+w,yy]],tone.shelf+'25',profile==='region'?.7:.6);
      if(profile==='detail'&&n>.68)stroke(c,[[xx+1,yy+2.1],[xx+w*.7,yy+2.3]],tone.deep+'25',.45);
    }
  }
  c.restore();
}

const TAU=Math.PI*2;
const alpha=n=>Math.round(Math.max(0,Math.min(1,n))*255).toString(16).padStart(2,'0');
function curve(c,a,p,b,color,width){c.beginPath();c.moveTo(...a);c.quadraticCurveTo(...p,...b);c.strokeStyle=color;c.lineWidth=width;c.stroke();}
function onCurve(a,p,b,t){const u=1-t;return[u*u*a[0]+2*u*t*p[0]+t*t*b[0],u*u*a[1]+2*u*t*p[1]+t*t*b[1]];}
function curvePart(c,a,p,b,from,to,color,width){
  const start=onCurve(a,p,b,from),end=onCurve(a,p,b,to),derivative=[2*((1-from)*(p[0]-a[0])+from*(b[0]-p[0])),2*((1-from)*(p[1]-a[1])+from*(b[1]-p[1]))];
  curve(c,start,[start[0]+derivative[0]*(to-from)/2,start[1]+derivative[1]*(to-from)/2],end,color,width);
}

// Both static bank paint and dynamic lapping use these exact quadratic curves.
// Ignore artificial contour edges at chunk bounds by checking both sides.
function coastEdges(contours,tile,seed){
  const edges=[];
  for(const points of contours)for(let i=0;i<points.length;i++){
    const p=points[i],prev=points[(i+points.length-1)%points.length],next=points[(i+1)%points.length],a=[(prev[0]+p[0])/2,(prev[1]+p[1])/2],b=[(next[0]+p[0])/2,(next[1]+p[1])/2],mid=onCurve(a,p,b,.5),dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
    if(length<1)continue;
    let nx=-dy/length,ny=dx/length;
    const first=tile(Math.floor((mid[0]+nx*12)/32),Math.floor((mid[1]+ny*12)/32)),second=tile(Math.floor((mid[0]-nx*12)/32),Math.floor((mid[1]-ny*12)/32));
    if(!first||!second||(first.terrain==='water')===(second.terrain==='water'))continue;
    const bank=first.terrain==='water'?second:first,water=first.terrain==='water'?first:second;
    if(first.terrain==='water'){nx=-nx;ny=-ny;}
    const n=noise(Math.floor(mid[0]),Math.floor(mid[1]),seed+967),shelf=fieldNoise(mid[0]/32,mid[1]/32,seed+971,5.3),sediment=bank.terrain==='sand'||(!['mountain','rock','forest'].includes(bank.terrain)&&shelf>.52);
    edges.push({a,p,b,n,nx,ny,sediment,river:water.detail==='river',blocked:Boolean(water.road||water.rail)});
  }
  return edges;
}
const shifted=(point,nx,ny,d)=>[point[0]+nx*d,point[1]+ny*d];
// Draw after the cached water fill/relief. The damp bank and clipped shallows
// stay fixed while the separate presentation layer carries the moving crests.
export function paintCoast(c,contours,tile,biome,seed,profile,waterPath){
  const tone=TONES[biome]||TONES.taiga,edges=coastEdges(contours,tile,seed);
  c.save();c.lineCap='round';c.lineJoin='round';
  for(const e of edges){
    const {a,p,b,n,nx,ny,sediment}=e;
    curve(c,shifted(a,nx,ny,1.5),shifted(p,nx,ny,1.5),shifted(b,nx,ny,1.5),tone.wet+alpha(.11+n*.07),5+n*3);
    if(sediment)curve(c,shifted(a,nx,ny,2.6),shifted(p,nx,ny,2.6),shifted(b,nx,ny,2.6),tone.sand+alpha(.14+n*.11),3+n*3);
  }
  c.save();if(waterPath)c.clip(waterPath,'evenodd');
  for(const e of edges){
    const {a,p,b,n,nx,ny,river}=e;
    curve(c,shifted(a,nx,ny,-2),shifted(p,nx,ny,-2),shifted(b,nx,ny,-2),tone.shelf+alpha(.1+n*.08),8+n*5);
    if(n>(river?.85:profile==='region'?.68:.57)){
      const from=.08+n*.19,to=Math.min(.93,from+.22+(1-n)*.42);
      curvePart(c,a,p,b,from,to,tone.foam+alpha(.1+n*.08),profile==='region'?1.2:.75+n*.35);
    }
  }
  c.restore();c.restore();return edges.length;
}

// Seeded selection and neighbor reads happen once when a visible chunk is
// prepared. Animation samples just these small, reusable geometry records.
function waterWave(x,y,river,vertical,profile,seed,tile){
  const region=profile==='region',detail=profile==='detail',density=river?(region?.21:detail?.42:.30):(region?.075:detail?.17:.11);
  if(noise(x,y,seed+9281)>=density)return null;
  if(tile){const t=tile(x,y);if(!t||t.terrain!=='water'||t.road||t.rail)return null;}
  const a=noise(x+311,y-79,seed+9283),b=noise(x-157,y+503,seed+9293);
  const shore=tile&&[[0,-1],[1,0],[0,1],[-1,0]].some(([dx,dy])=>tile(x+dx,y+dy)?.terrain!=='water');
  const direction=river?(vertical?[0,1]:[1,0]):[Math.SQRT1_2,-Math.SQRT1_2];
  return{x,y,a,b,shore,river,direction,normal:[-direction[1],direction[0]],region,detail};
}
function drawWave(c,w,time,tone){
  const {x,y,a,b,shore,river,direction,normal,region,detail}=w,phase=TAU*(time/(13+a*9)+b),cycle=((time/(18+a*12)+b)%1+1)%1;
  const drift=shore?Math.sin(phase)*.6:river?(cycle-.5)*6:Math.sin(phase)*1.6,length=shore?8+a*2:river?7+a*5:region?13+a*5:detail?8+a*5:10+a*5;
  const cx=x*32+16+(a-.5)*(shore?1.5:5)+direction[0]*drift,cy=y*32+16+(b-.5)*(shore?1.5:5)+direction[1]*drift;
  const point=(along,across)=>[cx+direction[0]*along+normal[0]*across,cy+direction[1]*along+normal[1]*across];
  // A flowing river group is fully transparent at its wrap; open water uses
  // a continuous bounded drift and fade, with no sparkle or hard reset.
  const fade=river?Math.sin(cycle*Math.PI)**2*.75:.45+(.5+.5*Math.sin(phase))*.30,width=region?1.4:detail?.65:1.05;
  c.save();c.globalAlpha*=fade;c.lineCap='round';c.lineJoin='round';
  stroke(c,[point(-length/2,0),point(-length*.15,-.55),point(length*.2,-.35),point(length/2,.15)],tone.shelf+'a0',width);
  let strokes=1;
  if(a>.32){stroke(c,[point(-length*.28,2.1),point(length*.08,2.35),point(length*.34,2.1)],tone.foam+'64',width*.62);strokes++;}
  if(detail&&b>.7){stroke(c,[point(-length*.1,-2.1),point(length*.12,-2.3)],tone.foam+'82',.5);strokes++;}
  c.restore();return strokes;
}

// Standalone local drawing remains useful for previews and native-art checks.
// Production rendering prepares these groups with the terrain chunk instead.
export function drawWaterMotion(c,x,y,river,vertical,day,biome,{profile='town',seed=0,tile}={}){
  const wave=waterWave(x,y,river,vertical,profile,seed,tile);
  return wave?drawWave(c,wave,Number.isFinite(day)?day:0,TONES[biome]||TONES.taiga):0;
}

export function prepareWaterMotion(bounds,contours,tile,seed=0,profile='town',waterPath,{pixelScale=1}={}){
  const waves=[],shores=[],cells=[],{x0,y0,x1,y1}=bounds,wet=(x,y)=>tile(x,y)?.terrain==='water'?1:0;
  const open=(x,y)=>{const t=tile(x,y);return t?.terrain==='water'&&!t.road&&!t.rail;};
  const guard=Math.min(8,1/(Number.isFinite(pixelScale)&&pixelScale>0?pixelScale:1));
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
    const t=tile(x,y);if(t?.terrain!=='water'||t.road||t.rail)continue;
    const left=x*32+(open(x-1,y)?0:guard),top=y*32+(open(x,y-1)?0:guard),right=(x+1)*32-(open(x+1,y)?0:guard),bottom=(y+1)*32-(open(x,y+1)?0:guard);
    cells.push([left,top,right-left,bottom-top]);
    const river=t.detail==='river',vertical=river&&wet(x,y-1)+wet(x,y+1)>wet(x-1,y)+wet(x+1,y),wave=waterWave(x,y,river,vertical,profile,seed,tile);
    if(wave)waves.push(wave);
  }
  for(const e of coastEdges(contours,tile,seed)){
    if(e.blocked||e.n<(e.river?.78:profile==='region'?.50:.36))continue;
    const xs=[e.a[0],e.p[0],e.b[0]],ys=[e.a[1],e.p[1],e.b[1]];
    if(Math.max(...xs)<x0*32-7||Math.min(...xs)>x1*32+7||Math.max(...ys)<y0*32-7||Math.min(...ys)>y1*32+7)continue;
    const mid=onCurve(e.a,e.p,e.b,.5),phase=fieldNoise(mid[0]/32,mid[1]/32,seed+9781,6.2);
    shores.push({...e,phase,from:.12+e.n*.14,to:.62+e.n*.18});
  }
  // Intersect the smoothed coast with the actual flat water faces. The latter
  // excludes raised bank triangles and engineered crossing tiles. A one-pixel
  // guard at exposed edges keeps Canvas clip antialiasing off dry-land pixels;
  // internal water joins stay exact, including across cached chunk boundaries.
  let tilePath=null;
  if(typeof Path2D==='function'){
    tilePath=new Path2D();for(const cell of cells)tilePath.rect(...cell);
  }
  return{bounds:{...bounds},waterPath,tilePath,waves,shores,profile};
}

export function drawPreparedWaterMotion(c,motion,day,biome,{reducedMotion=false}={}){
  if(!motion||(!motion.waves.length&&!motion.shores.length))return{waves:0,shores:0,strokes:0};
  const tone=TONES[biome]||TONES.taiga,time=reducedMotion?0:Number.isFinite(day)?day:0,{x0,y0,x1,y1}=motion.bounds;
  c.save();c.beginPath();c.rect(x0*32,y0*32,(x1-x0)*32,(y1-y0)*32);c.clip();
  if(motion.waterPath)c.clip(motion.waterPath,'evenodd');
  if(motion.tilePath)c.clip(motion.tilePath);
  let strokes=0;
  for(const wave of motion.waves)strokes+=drawWave(c,wave,time,tone);
  c.lineCap='round';c.lineJoin='round';
  for(const e of motion.shores){
    // Lapping follows the real, unchanged quadratic bank. Adjacent stretches
    // share a slow spatial phase; generous gaps keep lakes from wearing a ring.
    const cycle=((time/(23+e.n*11)+e.phase)%1+1)%1,fade=Math.sin(cycle*Math.PI)**2;
    const distance=e.river?2.2+(1-cycle)*1.4:1.8+(1-cycle)*3.0;
    const a=shifted(e.a,e.nx,e.ny,-distance),p=shifted(e.p,e.nx,e.ny,-distance),b=shifted(e.b,e.nx,e.ny,-distance);
    const width=motion.profile==='region'?1.25:motion.profile==='detail'?.75:1;
    // A faint, wider wash travels underneath the crest, never onto dry land.
    curvePart(c,a,p,b,e.from+.035,e.to-.045,tone.shelf+alpha(fade*.075),width+1.8);strokes++;
    curvePart(c,a,p,b,e.from,e.to,tone.foam+alpha(fade*(e.river?.12:.19)),width);strokes++;
  }
  c.restore();return{waves:motion.waves.length,shores:motion.shores.length,strokes};
}
