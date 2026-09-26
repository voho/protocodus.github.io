/** Cached architectural detail and ground-bound industrial/damage effects. */
const TAU=Math.PI*2;
const FIRE_FRAMES=12,FIRE_W=96,FIRE_H=144,DETAIL_SIZE=240;
const MODERN=new Set(['bunker','station','radar','dome','solar','refinery','building','tower','pylon','fortress','satellite','crawler','hauler']);
const STRUCTURAL=new Set([...MODERN,'temple','ruin','hut']);
const BURNABLE=new Set([...STRUCTURAL].filter(type=>type!=='crawler'&&type!=='hauler'));
const FOUNDATIONS=Object.freeze({
  bunker:'round',station:'round',radar:'round',dome:'round',
  solar:'deck',refinery:'deck',building:'deck',tower:'deck',fortress:'deck',
  temple:'stone',ruin:'stone',
});
// Positions are in a 100-unit prop footprint, matching the structure atlas.
const FIXTURES=Object.freeze({
  bunker:[[-59,3],[57,3]],station:[[-51,-49],[51,49]],
  radar:[[53,22],[50,45]],dome:[[-49,48],[49,48]],
  solar:[[53,-23],[53,24]],refinery:[[-57,4],[12,62]],
  building:[[-53,58],[51,58]],tower:[[-43,59],[43,59]],
  pylon:[[-53,-46],[54,44]],fortress:[[-47,-47],[47,47]],
  satellite:[[-10,-56],[10,55]],crawler:[[-25,-55],[25,-55]],
  hauler:[[-22,-58],[22,-58]],
});

function canvas(width,height) {
  const out=typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(width,height):document.createElement('canvas');
  out.width=width;out.height=height;return out;
}
function circle(c,x,y,r,fill) {c.fillStyle=fill;c.beginPath();c.arc(x,y,r,0,TAU);c.fill();}
function ellipse(c,x,y,rx,ry,fill) {c.fillStyle=fill;c.beginPath();c.ellipse(x,y,rx,ry,0,0,TAU);c.fill();}
function polygon(c,points,fill) {
  c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fillStyle=fill;c.fill();
}
function random(seed) {
  let value=seed>>>0;
  return ()=>{value+=0x6D2B79F5;let t=value;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};
}
function halo(color) {
  const out=canvas(128,128),c=out.getContext('2d'),g=c.createRadialGradient(64,64,0,64,64,64);
  g.addColorStop(0,color);g.addColorStop(.2,`${color}9c`);g.addColorStop(.55,`${color}28`);g.addColorStop(1,`${color}00`);
  circle(c,64,64,64,g);return out;
}

/**
 * All animation derives from the render clock and seeded prop geometry. There
 * is no particle ledger: eviction/reload reproduces the same standing damage,
 * and destroyed structures immediately go dark. Cached surfaces are limited to
 * 15 foundations, 13 fixture strips and four shared effect images per biome.
 */
export class StructureEffects {
  constructor(index,palette,accent='#b7ffcc') {
    this.index=index;this.palette=palette;this.accent=accent;
    this.foundations=new Map();this.fixtures=new Map();
    this.light=halo(accent);this.heat=halo('#ff8339');
    this.fire=this.makeFire();this.smoke=this.makeSmoke();
  }
  getFoundation(type,variant=0) {
    const kind=FOUNDATIONS[type];if(!kind)return null;
    const choice=((variant%5)+5)%5,key=`${kind}:${choice}`;
    if(this.foundations.has(key))return this.foundations.get(key);
    const out=canvas(DETAIL_SIZE,DETAIL_SIZE),c=out.getContext('2d'),p=this.palette;
    const rng=random(7391+choice*197+this.index*9187);
    c.translate(120,120);
    if(kind==='round') {
      ellipse(c,6,10,99,77,'rgba(2,8,13,.17)');
      ellipse(c,0,3,91,72,p.low);ellipse(c,-1,0,89,70,p.mid);
      c.globalAlpha=.44;ellipse(c,-1,0,85,66,p.low);c.globalAlpha=1;
      c.strokeStyle=p.high;c.globalAlpha=.28;c.lineWidth=1;
      c.beginPath();c.ellipse(-1,0,89,70,0,Math.PI,TAU);c.stroke();
      for(let n=0;n<12;n++) {
        const a=n/12*TAU;c.beginPath();c.moveTo(Math.cos(a)*79,Math.sin(a)*61);c.lineTo(Math.cos(a)*89,Math.sin(a)*70);c.stroke();
      }
    } else if(kind==='deck') {
      polygon(c,[[-89,-77],[91,-77],[101,81],[-79,81]],'rgba(3,10,16,.2)');
      polygon(c,[[-91,-80],[86,-80],[93,75],[-84,75]],p.low);
      polygon(c,[[-87,-77],[82,-77],[89,71],[-80,71]],p.mid);
      c.globalAlpha=.53;polygon(c,[[-83,-73],[78,-73],[85,67],[-76,67]],p.low);
      c.globalAlpha=.3;c.strokeStyle=p.high;c.lineWidth=1;
      for(let n=-1;n<2;n++){c.beginPath();c.moveTo(n*52-5,-75);c.lineTo(n*52+2,69);c.stroke();}
      for(let y=-36;y<70;y+=48){c.beginPath();c.moveTo(-84,y);c.lineTo(84,y);c.stroke();}
      // Loading apron, inset drainage and paired access stripes.
      c.globalAlpha=.62;c.fillStyle='#8d9c94';
      for(const x of [-69,68]){c.fillRect(x,-58,2,15);c.fillRect(x,37,2,15);}
      c.globalAlpha=.32;c.fillStyle='#c4ac73';
      for(let n=0;n<5;n++)c.fillRect(-19+n*9,60,5,3);
    } else {
      for(let n=0;n<33;n++) {
        const a=n/33*TAU,r=83+rng()*9,x=Math.cos(a)*r,y=Math.sin(a)*r*.78;
        c.globalAlpha=.26+rng()*.12;c.fillStyle=n%3?p.low:p.high;
        c.fillRect(x,y,5+rng()*7,3+rng()*5);
      }
    }
    // Dust, chips and wear stay baked into the apron, never animated per frame.
    for(let n=0;n<95;n++) {
      const a=rng()*TAU,r=75+rng()*17;c.globalAlpha=.08+rng()*.14;c.fillStyle=n%3?p.low:p.high;
      c.fillRect(Math.cos(a)*r,Math.sin(a)*r*.74,1+rng()*3,.5+rng()*1.5);
    }
    c.globalAlpha=1;this.foundations.set(key,out);return out;
  }
  drawFoundation(c,prop,x=prop.x,y=prop.y,destroyed=false) {
    if(destroyed||prop.hp<=0)return;
    const sprite=this.getFoundation(prop.type,prop.variant);if(!sprite)return;
    const extent=prop.size*2.4;
    c.save();c.globalAlpha=.64;c.drawImage(sprite,x-extent*.5,y-extent*.5,extent,extent);c.restore();
  }
  getFixtures(type) {
    const points=FIXTURES[type];if(!points)return null;
    if(this.fixtures.has(type))return this.fixtures.get(type);
    const out=canvas(DETAIL_SIZE,DETAIL_SIZE),c=out.getContext('2d');c.translate(120,120);
    const vehicle=type==='crawler'||type==='hauler';
    for(const [x,y]of points) {
      c.fillStyle='#101d28';c.fillRect(x-4,y-3,8,5);
      c.fillStyle=vehicle?'#c8c5ad':this.accent;c.fillRect(x-3,y-2,6,1.5);
      c.fillStyle='#e5eadc';c.globalAlpha=.65;c.fillRect(x-2,y-2,3,.6);c.globalAlpha=1;
    }
    if(this.index===7&&['building','tower','fortress'].includes(type)) {
      const edge=type==='fortress'?43:type==='tower'?59:64,top=type==='fortress'?-39:-61,bottom=type==='fortress'?43:53;
      const rail=(points,color)=>{
        c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));
        c.strokeStyle=color;c.globalAlpha=.1;c.lineWidth=8;c.stroke();
        c.globalAlpha=.84;c.lineWidth=2;c.stroke();
      };
      // City light is attached to roof rims and frontage, leaving the machinery
      // readable. The faint local spill is baked into this existing surface.
      rail([[-edge,15],[-edge,bottom],[-edge+29,bottom]],'#66eaff');
      rail([[-edge+10,top],[-edge+43,top]],'#66eaff');
      rail([[edge-31,top],[edge,top],[edge,top+27]],'#ec88f4');
      rail([[edge,-5],[edge,22]],'#ec88f4');
      for(let n=0;n<7;n++) {
        const x=-24+n*8,y=bottom+3;
        c.globalAlpha=.8;c.fillStyle='#111d2c';c.fillRect(x-1,y-1,6,6);
        c.globalAlpha=n%3===1?.36:.8;c.fillStyle=n%3===1?'#87c7db':'#f5ca88';c.fillRect(x,y,3.5,2);
      }
      c.globalAlpha=1;
    }
    this.fixtures.set(type,out);return out;
  }
  makeFire() {
    const out=canvas(FIRE_W*FIRE_FRAMES,FIRE_H),c=out.getContext('2d'),pixels=c.createImageData(out.width,out.height);
    const clamp=value=>Math.max(0,Math.min(1,value));
    const rng=random(18847),fieldNoise=Float32Array.from({length:1024},()=>rng());
    const noiseAt=(x,y)=>{
      const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
      const sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);
      const a=fieldNoise[((iy&31)<<5)+(ix&31)],b=fieldNoise[((iy&31)<<5)+((ix+1)&31)];
      const d=fieldNoise[(((iy+1)&31)<<5)+(ix&31)],e=fieldNoise[(((iy+1)&31)<<5)+((ix+1)&31)];
      return a+(b-a)*sx+(d+(e-d)*sx-a-(b-a)*sx)*sy;
    };
    for(let frame=0;frame<FIRE_FRAMES;frame++) {
      const phase=frame/FIRE_FRAMES*TAU;
      // A warped density field gives soft, broken flame edges and translucent
      // eddies. All twelve frames are rasterized once, including thermal color.
      for(let y=5;y<139;y++)for(let x=8;x<FIRE_W-8;x++) {
        const rise=(127-y)/117,height=clamp(rise),width=3+27*(1-height)**.68;
        const bend=Math.sin(height*10-phase)*height*12+Math.sin(height*19+phase*2)*height*3;
        const dx=x-48-bend;
        const field=Math.exp(-((Math.abs(dx)/(width*.8))**1.6));
        const noise=(noiseAt(x*.12+Math.sin(phase),y*.095-Math.cos(phase)*2)-.5)*.65
          +(noiseAt(x*.25+Math.cos(phase),y*.19+Math.sin(phase)*2)-.5)*.24;
        const density=field-height*.69+noise*(.35+height*.8);
        const alpha=clamp((density-.13)*2.5)*clamp((139-y)/16)*clamp((y-4)/13);
        if(alpha<.01)continue;
        const heat=clamp((1-height)*.74+field*.28+noise*.48),core=clamp((heat-.55)*2.4);
        const at=(y*out.width+frame*FIRE_W+x)*4;
        pixels.data[at]=255;pixels.data[at+1]=65+heat*138+core*40;
        pixels.data[at+2]=12+heat*32+core*113;pixels.data[at+3]=alpha*255;
      }
    }
    c.putImageData(pixels,0,0);
    return out;
  }
  makeSmoke() {
    const out=canvas(144,144),c=out.getContext('2d'),rng=random(76331);
    for(let n=0;n<13;n++) {
      const x=45+rng()*54,y=44+rng()*53,r=19+rng()*22,g=c.createRadialGradient(x,y,0,x,y,r);
      g.addColorStop(0,'rgba(24,30,38,.33)');g.addColorStop(.5,'rgba(29,34,42,.2)');g.addColorStop(1,'rgba(34,40,47,0)');
      circle(c,x,y,r,g);
    }
    return out;
  }
  draw(c,prop,time,quality='high',motion=true,destroyed=false) {
    if(destroyed||prop.hp<=0||!STRUCTURAL.has(prop.type))return;
    const health=prop.hp/prop.maxHp,stage=health<=.35?2:health<=.7?1:0;
    const s=prop.size,x=prop.x,y=prop.y,phase=prop.variant*1.79+x*.009;
    const clock=motion?time:0,low=quality==='low',power=stage===0?1:stage===1?.5:.17;
    c.save();
    const fixtures=this.getFixtures(prop.type);
    if(fixtures) {
      const pulse=.9+Math.sin(clock*1.4+phase)*.1;
      c.globalAlpha=power*pulse*.8;c.drawImage(fixtures,x-s*1.2,y-s*1.2,s*2.4,s*2.4);
      if(!low)for(const point of FIXTURES[prop.type]) {
        const lx=x+point[0]*s*.01,ly=y+point[1]*s*.01,r=s*.18;
        c.globalAlpha=power*pulse*.16;c.drawImage(this.light,lx-r,ly-r,r*2,r*2);
      }
    }
    // Live refinery stacks have a small pilot flare; damaged structures burn
    // only while standing. Supply markers remain clearly visible.
    const pilot=prop.type==='refinery'&&stage===0;
    if((stage&&BURNABLE.has(prop.type))||pilot) {
      const count=low||stage<2?1:2;
      for(let n=0;n<count;n++) {
        const px=x+s*(pilot?-.45:n===0?-.21:.27),py=y+s*(pilot?-.48:n===0?.09:-.15);
        const firePhase=clock*9+phase*2+n*4,frame=((Math.floor(firePhase)%FIRE_FRAMES)+FIRE_FRAMES)%FIRE_FRAMES;
        const flicker=.88+Math.sin(clock*7+phase+n*2)*.08+Math.sin(clock*11+phase)*.04;
        const width=s*(pilot?.19:stage===1?.28:.4),height=width*1.5;
        if(!low) {
          const radius=width*1.7;c.globalAlpha=(pilot?.16:.31)*flicker;
          c.drawImage(this.heat,px-radius,py-radius*.62,radius*2,radius*1.5);
          // Slow rising smoke uses only two cached puffs per damaged hotspot.
          if(!pilot)for(let puff=0;puff<2;puff++) {
            const age=((clock*.28+phase*.2+puff*.5+n*.3)%1+1)%1;
            const r=s*(.16+age*.2),drift=age*s*.17;
            c.globalAlpha=Math.sin(age*Math.PI)*(stage===2?.44:.3);
            c.drawImage(this.smoke,px+drift-r,py-height*.5-age*s*.46-r,r*2,r*2);
          }
        }
        c.globalAlpha=pilot?.8:.92;
        c.drawImage(this.fire,frame*FIRE_W,0,FIRE_W,FIRE_H,px-width*.5,py-height*.88,width,height);
        if(!low&&stage===2)for(let ember=0;ember<2;ember++) {
          const age=((clock*.61+phase+ember*.5+n*.3)%1+1)%1;
          c.globalAlpha=(1-age)*.7;c.fillStyle='#ffc275';
          c.fillRect(px+Math.sin(age*5+phase)*s*.08+age*s*.12,py-age*s*.61,Math.max(.6,s*.012),Math.max(.8,s*.02));
        }
      }
    }
    c.restore();
  }
  memoryStats() {
    const images=[this.light,this.heat,this.fire,this.smoke,...this.foundations.values(),...this.fixtures.values()];
    return {spriteCount:images.length,spriteLimit:32,spriteBytes:images.reduce((sum,sprite)=>sum+sprite.width*sprite.height*4,0)};
  }
}
