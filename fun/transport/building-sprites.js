import { BUILDINGS, LEGACY_BUILDING_KINDS } from './buildings.js';
import { SPRITE_SCALE, featureSpriteUnits, BUILDING_PALETTES, BUILDING_REGISTRATION } from './sprite-art-direction.js';

// Native emergency artwork shares the authored cells' ground registration.
// u and v follow the two ground axes across the shared architectural
// envelope; z is always metres. Parcel growth never enlarges human features.
const HALF_ENVELOPE_METRES = BUILDING_REGISTRATION.architecturalEnvelopeMetresPerTile / 2;
const HALF_GROUND = featureSpriteUnits(HALF_ENVELOPE_METRES);
const profiles = new WeakMap();
const profile = c => profiles.get(c);
const footprint = c => profile(c).footprint;
const feature = (c, metres) => featureSpriteUnits(metres, footprint(c));
const planSize = (c, metres) => metres / (HALF_ENVELOPE_METRES * footprint(c));
const at = (c, u, v, z = 0) => [16 + (u - v) * HALF_GROUND, 24 + (u + v) * HALF_GROUND / 2 - feature(c, z)];
const fine = c => profile(c).detail !== 'region';
const palette = c => profile(c).palette;
export const NATIVE_TOWN_BUILDING_KINDS = Object.freeze([...LEGACY_BUILDING_KINDS, ...Object.keys(BUILDINGS).filter(kind => BUILDINGS[kind].buildOnly)]);

function shade(color, factor) {
  const rgb = color.startsWith('#') ? [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)) : color.match(/\d+/g).map(Number);
  return `rgb(${rgb.map(channel => Math.max(0, Math.min(255, Math.round(channel * factor)))).join(',')})`;
}
function poly(c, points, color) { c.fillStyle = color; c.beginPath(); points.forEach(([x,y], i) => i ? c.lineTo(x,y) : c.moveTo(x,y)); c.closePath(); c.fill(); }
function stroke(c, points, color, width = .45) { c.strokeStyle = color; c.lineWidth = width / footprint(c); c.beginPath(); points.forEach(([x,y], i) => i ? c.lineTo(x,y) : c.moveTo(x,y)); c.stroke(); }
const flat = (c,u0,v0,u1,v1,color,z=0) => poly(c,[at(c,u0,v0,z),at(c,u1,v0,z),at(c,u1,v1,z),at(c,u0,v1,z)],color);
const facade = (c,u0,u1,v,z0,z1,color) => poly(c,[at(c,u0,v,z0),at(c,u1,v,z0),at(c,u1,v,z1),at(c,u0,v,z1)],color);
const side = (c,u,v0,v1,z0,z1,color) => poly(c,[at(c,u,v0,z0),at(c,u,v1,z0),at(c,u,v1,z1),at(c,u,v0,z1)],color);
function box(c,u0,v0,u1,v1,z0,z1,color,top=shade(color,1.05)) {
  facade(c,u0,u1,v1,z0,z1,color);
  side(c,u1,v0,v1,z0,z1,shade(color,.78));
  flat(c,u0,v0,u1,v1,top,z1);
}
function roof(c,b,color,style='hip',rise=2) {
  const {u0,v0,u1,v1,height}=b, e=.04, vm=(v0+v1)/2;
  if(style==='flat') { box(c,u0-e,v0-e,u1+e,v1+e,height,height+.18,color); return; }
  const inset=style==='hip'?Math.min((u1-u0)*.2,(v1-v0)*.22):0;
  const ridge0=u0+inset,ridge1=u1-inset;
  poly(c,[at(c,u0-e,v0-e,height),at(c,u1+e,v0-e,height),at(c,ridge1,vm,height+rise),at(c,ridge0,vm,height+rise)],shade(color,.86));
  poly(c,[at(c,u1+e,v0-e,height),at(c,u1+e,v1+e,height),at(c,ridge1,vm,height+rise)],shade(color,.72));
  if(inset)poly(c,[at(c,u0-e,v0-e,height),at(c,u0-e,v1+e,height),at(c,ridge0,vm,height+rise)],shade(color,.94));
  poly(c,[at(c,u0-e,v1+e,height),at(c,u1+e,v1+e,height),at(c,ridge1,vm,height+rise),at(c,ridge0,vm,height+rise)],color);
  if(profile(c).biome==='tundra')poly(c,[at(c,ridge0,vm,height+rise),at(c,ridge1,vm,height+rise),at(c,ridge1+.03,vm+.12,height+rise*.77),at(c,ridge0-.03,vm+.12,height+rise*.77)],palette(c).snow);
}
function block(c,u0,v0,u1,v1,floors=1,{wall=palette(c).plaster,roofColor=palette(c).slate,style='hip',rise=2,base=0,height=base+floors*SPRITE_SCALE.storeyHeightMetres}={}) {
  const b={u0,v0,u1,v1,height,floors,base};
  if(base===0)flat(c,u0+.04,v0+.04,u1+.09,v1+.09,'#263d3530');
  box(c,u0,v0,u1,v1,base,height,wall);
  // Complete, fixed 3m storeys create quiet broad facade tones, without courses.
  if(fine(c))for(let floor=1;floor<floors;floor+=2)facade(c,u0,u1,v1,base+floor*SPRITE_SCALE.storeyHeightMetres,base+(floor+1)*SPRITE_SCALE.storeyHeightMetres,'#53635a0c');
  roof(c,b,roofColor,style,rise);
  return b;
}
function opening(c,b,u,width,z,height,color,face='front') {
  const half=planSize(c,width)/2;
  if(face==='side')side(c,b.u1,u-half,u+half,z,z+height,color);
  else facade(c,u-half,u+half,b.v1,z,z+height,color);
}
function door(c,b,u=(b.u0+b.u1)/2,leaves=1,color=shade(palette(c).timber,.72),z=b.base) {
  opening(c,b,u,SPRITE_SCALE.doorWidthMetres*leaves,z,SPRITE_SCALE.doorHeightMetres,color);
}
function windows(c,b,{count=3,floors=b.floors,sideCount=1}={}) {
  const p=palette(c);
  for(let floor=0;floor<floors;floor++)for(let i=0;i<count;i++) {
    const u=b.u0+(b.u1-b.u0)*(i+.5)/count,z=b.base+floor*SPRITE_SCALE.storeyHeightMetres+.8;
    opening(c,b,u,SPRITE_SCALE.windowHeightMetres,z,SPRITE_SCALE.windowHeightMetres,p.ink);
    if(fine(c))opening(c,b,u,SPRITE_SCALE.windowHeightMetres,z+SPRITE_SCALE.windowHeightMetres*.15,SPRITE_SCALE.windowHeightMetres*.65,p.glass);
  }
  for(let floor=0;floor<floors;floor++)for(let i=0;i<sideCount;i++)opening(c,b,b.v0+(b.v1-b.v0)*(i+.5)/sideCount,SPRITE_SCALE.windowHeightMetres,b.base+floor*SPRITE_SCALE.storeyHeightMetres+.8,SPRITE_SCALE.windowHeightMetres,p.ink,'side');
}
function bay(c,b,u,width=3.2) { opening(c,b,u,width,0,SPRITE_SCALE.loadingBayHeightMetres,palette(c).ink); }
function awning(c,b,u0,u1,color,height=2.5,depth=.14) {
  flat(c,u0,b.v1,u1,b.v1+depth,color,height);
  facade(c,u0,u1,b.v1+depth,height-.3,height,shade(color,.85));
}
function porch(c,b,u0,u1,color=palette(c).stone,height=2.6) {
  const p=palette(c),depth=.16,post=planSize(c,.25);
  box(c,u0,b.v1,u0+post,b.v1+depth,0,height,p.cream);
  box(c,u1-post,b.v1,u1,b.v1+depth,0,height,p.cream);
  flat(c,u0-.02,b.v1-.01,u1+.02,b.v1+depth+.03,color,height);
}
function chimney(c,b,u,v,height=1.8,width=.65) {
  const d=planSize(c,width)/2,p=palette(c);
  box(c,u-d,v-d,u+d,v+d,b.height+.8,b.height+.8+height,p.brick);
}
function plot(c,paved=false) {
  if(!paved&&profile(c).gardenGround==='terrain')return;
  const p=palette(c);flat(c,-.95,-.95,.95,.95,paved?p.paving:p.ground);
}
function path(c,u0,v0,u1,v1) { flat(c,u0,v0,u1,v1,palette(c).path); }
function hedge(c,u0,v0,u1,v1) { box(c,u0,v0,u1,v1,0,SPRITE_SCALE.fenceHeightMetres,palette(c).foliage); }
function disc(c,u,v,r,color,height=0) { const [x,y]=at(c,u,v,height);c.fillStyle=color;c.beginPath();c.ellipse(x,y,r*HALF_GROUND*Math.SQRT2,r*HALF_GROUND/Math.SQRT2,0,0,Math.PI*2);c.fill(); }
function tree(c,u,v,size=1) {
  const p=palette(c),[x,y]=at(c,u,v),r=feature(c,2.3*size),h=feature(c,4.4*size);
  c.fillStyle='#354b3830';c.beginPath();c.ellipse(x+r*.2,y,r,r*.45,0,0,Math.PI*2);c.fill();
  stroke(c,[[x,y],[x,y-h*.65]],p.timber,.65);
  if(profile(c).biome==='tundra') {
    poly(c,[[x,y-h*1.5],[x-r,y],[x+r,y]],p.foliage);
    poly(c,[[x,y-h*1.5],[x-r*.55,y-h*.6],[x+r*.2,y-h*.7]],p.snow);
  } else {
    c.fillStyle=p.foliage;c.beginPath();c.ellipse(x,y-h*.75,r,profile(c).biome==='desert'?r*.5:r,0,0,Math.PI*2);c.fill();
    if(fine(c)){c.fillStyle=shade(p.foliage,1.1);c.beginPath();c.ellipse(x-r*.23,y-h*.85,r*.68,r*.66,0,0,Math.PI*2);c.fill();}
  }
}
function planting(c,u0,v0,u1,v1,color=palette(c).foliage) { box(c,u0,v0,u1,v1,0,.4,color); }
function car(c,u,v,color=palette(c).metal,alongU=true) {
  const du=planSize(c,alongU?4.2:1.8)/2,dv=planSize(c,alongU?1.8:4.2)/2;
  box(c,u-du,v-dv,u+du,v+dv,0,.8,color);
  box(c,u-du*.6,v-dv*.8,u+du*.35,v+dv*.8,.8,1.45,palette(c).glass);
}
function garden(c) { plot(c);path(c,-.12,.35,.12,.95);hedge(c,-.9,-.8,-.83,.8);hedge(c,.83,-.8,.9,.8); }
function home(c,kind) {
  const p=palette(c),variant=profile(c).variant;
  const roofColor=[p.terracotta,p.slate,p.timber][(variant+Number(kind.at(-1)))%3];
  const options={roofColor,wall:[p.plaster,p.stone,p.brick][variant%3]};
  garden(c);
  if(kind==='house-cheap-1') {
    const b=block(c,-.62,-.5,.62,.4,1,options);windows(c,b,{count:2});door(c,b,0);porch(c,b,-.18,.18);chimney(c,b,.4,-.2);tree(c,-.74,-.65,.65);planting(c,.45,.65,.74,.83);
  } else if(kind==='house-cheap-2') {
    const b=block(c,-.46,-.66,.46,.34,1,{...options,wall:p.timber,style:'gable',rise:3});windows(c,b,{count:2});door(c,b,.1);chimney(c,b,.33,-.45);box(c,-.77,.45,-.5,.7,0,.9,p.timber);tree(c,.68,-.61,.75);
  } else if(kind==='house-cheap-3') {
    for(const [u0,u1] of [[-.76,0],[0,.76]]) { const b=block(c,u0,-.54,u1,.4,1,{...options,style:'gable',rise:1.7});windows(c,b,{count:2,sideCount:0});door(c,b,u0+(u1-u0)*.7); }
    planting(c,-.75,.69,-.38,.86);planting(c,.38,.69,.75,.86,p.ochre);
  } else if(kind==='house-normal-1') {
    const b=block(c,-.65,-.68,.27,.3,2,{...options,style:'gable',rise:2.3});windows(c,b,{count:2});door(c,b,-.17);porch(c,b,-.35,.03);
    const garage=block(c,.27,-.16,.77,.54,1,{...options,style:'gable',rise:1.4});opening(c,garage,.52,2.5,0,2.3,p.metal);tree(c,-.73,.64,.65);
  } else if(kind==='house-normal-2') {
    const b=block(c,-.57,-.56,.61,.4,2,{...options,wall:p.brick,rise:2.1});windows(c,b,{count:3});door(c,b,.02);
    flat(c,-.25,b.v1,.29,b.v1+.12,p.stone,3);facade(c,-.25,.29,b.v1+.12,3,3.45,p.metal);chimney(c,b,.42,-.38);tree(c,-.74,-.6,.75);
  } else if(kind==='house-normal-3') {
    block(c,-.75,-.74,-.22,-.23,1,{...options,rise:1.7});const b=block(c,-.75,-.23,.75,.42,1,{...options,rise:1.7});windows(c,b,{count:3});door(c,b,-.3);path(c,.28,.5,.71,.82);tree(c,.72,-.65,.75);
  } else if(kind==='house-expensive-1') {
    for(const [u0,u1] of [[-.84,-.4],[.4,.84]]) { const wing=block(c,u0,-.27,u1,.48,1,{...options,wall:p.plaster,rise:2.2});windows(c,wing,{count:2}); }
    const b=block(c,-.4,-.71,.4,.4,2,{...options,wall:p.plaster,rise:3});windows(c,b,{count:3});door(c,b,0,2);porch(c,b,-.2,.2,p.stone,3.2);disc(c,0,.76,.19,p.stone);disc(c,0,.76,.13,p.water);tree(c,-.78,-.75);tree(c,.8,-.72);
  } else if(kind==='house-expensive-2') {
    const b=block(c,-.67,-.65,.69,.44,3,{...options,rise:2.8});windows(c,b,{count:4});door(c,b,0,2);porch(c,b,-.2,.2);chimney(c,b,-.48,-.4,2.3);
    for(const u of [-.34,.34]){const d=block(c,u-.11,-.03,u+.11,.19,1,{...options,base:9,height:10.2,style:'gable',rise:1});opening(c,d,u,1.2,9,1.2,p.ink);}
  } else if(kind==='house-expensive-3') {
    const back=block(c,-.82,-.73,.82,-.34,2,{...options,rise:2});windows(c,back,{count:5});door(c,back,0);
    for(const [u0,u1] of [[-.82,-.46],[.46,.82]]){const wing=block(c,u0,-.34,u1,.62,2,{...options,rise:2});windows(c,wing,{count:2});}
    path(c,-.42,-.3,.42,.69);flat(c,-.26,.03,.26,.52,p.water);planting(c,-.35,.72,.35,.84);
  }
}
function civic(c,kind) {
  const p=palette(c);
  if(kind==='school'&&profile(c).gardenGround==='terrain') {
    // Leave the planted play area open to the underlying world texture.
    flat(c,-.95,-.95,.95,.12,p.paving);flat(c,-.95,.12,.28,.95,p.paving);flat(c,.28,.8,.95,.95,p.paving);
  } else plot(c,kind!=='church');
  if(kind==='school') {
    if(profile(c).gardenGround!=='terrain')flat(c,.28,.12,.84,.8,p.ground);const wing=block(c,-.78,-.56,.72,-.12,1,{roofColor:p.terracotta});windows(c,wing,{count:5,sideCount:0});
    const b=block(c,-.78,-.56,-.26,.55,2,{style:'gable',roofColor:p.terracotta,rise:2.5});windows(c,b,{count:2});door(c,b,-.5,2);path(c,-.65,.55,-.37,.95);
    // One broad play structure, rather than many miniature swing bars.
    box(c,.46,.37,.73,.57,0,1.5,p.ochre,p.burgundy);
  } else if(kind==='hospital') {
    const main=block(c,-.82,-.38,.82,.45,2,{style:'flat',wall:p.plaster,roofColor:p.metal});windows(c,main,{count:6});door(c,main,0,2,p.glass);porch(c,main,-.28,.28,p.metal);
    const tower=block(c,-.32,-.82,.36,-.38,3,{style:'flat',wall:p.stone,roofColor:p.metal});windows(c,tower,{count:3});
    facade(c,-.1,.13,tower.v1,7,7.8,p.burgundy);facade(c,-.04,.07,tower.v1,6.65,8.15,p.burgundy);car(c,-.58,.78,p.cream);car(c,.61,.78,p.metal);
  } else if(kind==='police-station') {
    const b=block(c,-.73,-.59,.66,.44,2,{style:'flat',wall:p.stone});windows(c,b,{count:4});door(c,b,0);facade(c,-.7,.62,b.v1,2.8,3.45,p.slate);
    box(c,.66,-.57,.83,.16,0,7.5,p.metal);stroke(c,[at(c,.73,-.2,7.5),at(c,.73,-.2,10)],p.ink,.6);car(c,-.48,.75,p.cream);car(c,.48,.75,p.slate);
  } else if(kind==='fire-station') {
    const b=block(c,-.8,-.35,.48,.5,1,{height:4.6,style:'flat',wall:p.brick,roofColor:p.metal});bay(c,b,-.51);bay(c,b,.12);
    const tower=block(c,.48,-.73,.82,.5,3,{wall:p.brick,style:'flat'});windows(c,tower,{count:1,sideCount:1});path(c,-.8,.51,.5,.95);
  } else if(kind==='stadium') {
    flat(c,-.71,-.58,.71,.64,p.foliage);flat(c,-.65,-.51,.65,.57,p.ground);
    for(const v of [-.86,.72]){box(c,-.85,v,.83,v+.15,0,3,p.stone);flat(c,-.89,v-.03,.87,v+.17,p.slate,4);}
    for(const u of [-.87,.75])box(c,u,-.7,u+.13,.71,0,2.5,p.stone);
    stroke(c,[at(c,-.59,-.45),at(c,.59,-.45),at(c,.59,.5),at(c,-.59,.5),at(c,-.59,-.45)],p.cream,.6);stroke(c,[at(c,0,-.45),at(c,0,.5)],p.cream,.5);disc(c,0,.02,.13,p.cream);disc(c,0,.02,.105,p.ground);
    if(fine(c))for(const [u,v] of [[-.86,-.82],[.86,-.82],[-.86,.86],[.86,.86]]){box(c,u-.012,v-.012,u+.012,v+.012,0,9,p.metal);box(c,u-.07,v-.03,u+.07,v+.03,9,9.6,p.cream);}
  } else if(kind==='church') {
    block(c,-.76,-.36,.76,.03,1,{height:4,style:'gable',rise:2.6});const nave=block(c,-.32,-.7,.32,.56,2,{style:'gable',rise:3.4});windows(c,nave,{count:2});
    const tower=block(c,-.18,.21,.18,.64,3,{height:10,style:'flat',wall:p.stone});windows(c,tower,{count:1,floors:2,sideCount:1});door(c,tower,0,2);
    const top=14;poly(c,[at(c,-.23,.16,10),at(c,.23,.16,10),at(c,0,.43,top)],shade(p.slate,.83));poly(c,[at(c,.23,.16,10),at(c,.23,.69,10),at(c,0,.43,top)],shade(p.slate,.7));poly(c,[at(c,-.23,.69,10),at(c,.23,.69,10),at(c,0,.43,top)],p.slate);
    stroke(c,[at(c,0,.43,14),at(c,0,.43,15.3)],p.cream,.55);stroke(c,[at(c,-.035,.43,14.7),at(c,.035,.43,14.7)],p.cream,.55);path(c,-.14,.65,.14,.95);tree(c,-.76,.7,.85);
  } else if(kind==='pub') {
    const b=block(c,-.63,-.63,.65,.42,2,{wall:p.plaster,roofColor:p.terracotta,style:'gable',rise:2.4});windows(c,b,{count:3});door(c,b,.16);awning(c,b,-.58,.6,p.burgundy);chimney(c,b,.43,-.35,2.6);
    facade(c,-.62,.65,b.v1,3,3.5,p.timber);planting(c,-.75,.62,-.4,.83);disc(c,.43,.73,.17,p.timber);
  }
}
function shop(c,kind) {
  const p=palette(c),design=Math.floor(profile(c).variant/5)%3,modern=design===2;plot(c,true);
  const settings={
    'shop-grocery':{u0:-.74,u1:.72,height:6,wall:p.plaster,roofColor:p.slate,style:modern?'flat':'hip',accent:p.foliage},
    'shop-bakery':{u0:-.57,u1:.58,height:6,wall:p.plaster,roofColor:p.terracotta,style:'gable',accent:p.ochre},
    'shop-butcher':{u0:-.52,u1:.61,height:6,wall:p.brick,roofColor:p.slate,style:'flat',accent:p.burgundy},
    'shop-hardware':{u0:-.78,u1:.55,height:3,wall:p.stone,roofColor:p.metal,style:'flat',accent:p.timber},
    'shop-florist':{u0:-.74,u1:.1,height:3,wall:p.plaster,roofColor:p.slate,style:modern?'flat':'gable',accent:p.foliage},
  }[kind];
  const b=block(c,settings.u0,design===1?-.71:-.58,settings.u1,.4,settings.height/3,{...settings,rise:kind==='shop-bakery'?2.8:1.9});
  if(settings.height>3)windows(c,b,{count:3});else windows(c,b,{count:2});
  door(c,b,settings.u1-.17);opening(c,b,settings.u0+(settings.u1-settings.u0)*.35,2.7,.45,1.5,p.glass);awning(c,b,settings.u0-.01,settings.u1+.01,settings.accent);
  if(kind==='shop-grocery'){planting(c,-.73,.63,-.13,.82,p.ochre);planting(c,.04,.63,.38,.82,p.foliage);}
  else if(kind==='shop-bakery'){chimney(c,b,-.39,-.36,3.4,1.2);box(c,-.81,-.65,-.58,-.05,0,2.5,p.brick);}
  else if(kind==='shop-butcher'){box(c,b.u0,-.6,b.u1,.06,6.18,6.9,p.stone);facade(c,-.29,.25,b.v1,3.1,3.75,p.burgundy);}
  else if(kind==='shop-hardware'){const annex=block(c,.55,-.58,.86,.38,1,{height:4.5,style:'flat',wall:p.metal});opening(c,annex,.7,1.7,0,3,p.ink);box(c,-.72,.65,-.12,.81,0,1.2,p.timber);}
  else {const glass=block(c,.14,-.61,.81,.43,1,{height:2.6,wall:p.glass,roofColor:shade(p.glass,1.14),style:'gable',rise:1.6});if(fine(c))windows(c,glass,{count:2,sideCount:1});planting(c,-.72,.64,.75,.82,p.burgundy);}
}
function park(c,kind) {
  const p=palette(c);plot(c);path(c,-.1,-.9,.1,.9);path(c,-.9,-.1,.9,.1);
  for(const [u,v] of [[-.74,-.68],[.74,-.68],[-.74,.7],[.74,.7]])tree(c,u,v,kind==='park-woodland'?1.25:.9);
  // Benches retain their metre dimensions on every parcel.
  for(const u of [-.4,.4]){const du=planSize(c,1.8)/2,dv=planSize(c,.45)/2;box(c,u-du,.21-dv,u+du,.21+dv,.35,.6,p.timber);}
  if(kind==='park-formal') { disc(c,0,0,.28,p.stone);disc(c,0,0,.2,p.water);for(const [u,v] of [[-.65,-.55],[.2,-.55],[-.65,.32],[.2,.32]])planting(c,u,v,u+.43,v+.22,p.ochre); }
  else if(kind==='park-woodland'){disc(c,.37,.4,.3,p.water);tree(c,-.35,-.4,1.3);tree(c,.25,-.64,1.2);tree(c,-.62,.2,1.1);}
  else {flat(c,.22,-.69,.77,-.19,p.ochre);box(c,.34,-.55,.58,-.3,0,1.8,p.timber,p.burgundy);}
}
function mall(c,kind) {
  const p=palette(c);plot(c,true);
  if(kind==='mall-neighborhood'){
    block(c,-.8,-.68,-.43,.44,1,{style:'hip',roofColor:p.terracotta});const b=block(c,-.8,-.68,.8,-.05,1,{style:'hip',roofColor:p.terracotta});for(const u of [-.52,0,.52]){door(c,b,u);awning(c,b,u-.2,u+.2,p.foliage);opening(c,b,u-.1,2,.4,1.4,p.glass);}
  } else {
    const b=block(c,-.8,-.61,.8,.43,2,{wall:p.stone,style:kind==='mall-modern'?'flat':'hip',roofColor:p.metal});windows(c,b,{count:7});for(const u of [-.5,0,.5]){door(c,b,u);awning(c,b,u-.2,u+.2,u?p.foliage:p.ochre);}
    block(c,-.3,-.72,.35,-.2,3,{height:kind==='mall-modern'?8:9,wall:p.glass,roofColor:p.metal,style:kind==='mall-modern'?'flat':'gable',rise:2});
  }
  path(c,-.8,.64,.8,.87);planting(c,-.83,.52,-.65,.73);planting(c,.65,.52,.83,.73);
}
function service(c,kind) {
  const p=palette(c);plot(c,true);
  if(kind==='service-post-office') {
    const b=block(c,-.67,-.65,.71,.34,2,{roofColor:p.terracotta});windows(c,b,{count:3});const entrance=block(c,-.24,.34,.26,.6,1,{style:'gable',rise:1.2});door(c,entrance,0);facade(c,-.21,.24,entrance.v1,2.4,2.9,p.burgundy);box(c,-.76,.55,-.76+planSize(c,.5),.55+planSize(c,.5),0,1.4,p.burgundy);
  } else if(kind==='service-bank') {
    const b=block(c,-.78,-.62,.78,.3,2,{style:'flat',wall:p.stone});windows(c,b,{count:5});door(c,b,0);path(c,-.47,.3,.47,.73);
    for(const u of [-.39,-.13,.13,.39]){const d=planSize(c,.45)/2;box(c,u-d,.49,u+d,.59,0,4.5,p.cream);}
    flat(c,-.47,.3,.47,.64,p.stone,4.5);poly(c,[at(c,-.5,.64,4.5),at(c,.5,.64,4.5),at(c,0,.64,6.2)],p.stone);
  } else if(kind==='service-hotel') {
    const b=block(c,-.67,-.68,.67,.42,4,{wall:p.plaster,roofColor:p.slate,rise:2.4});windows(c,b,{count:5});door(c,b,0,2);porch(c,b,-.27,.27,p.terracotta);chimney(c,b,-.47,-.46,2);block(c,-.25,-.47,.27,-.07,1,{base:12,height:14,style:'flat',wall:p.stone,roofColor:p.slate});
  } else if(kind==='service-garage') {
    const hall=block(c,-.15,-.5,.84,.5,1,{height:4.6,style:'flat',wall:p.stone});bay(c,hall,.33,4.2);const office=block(c,-.8,-.65,-.15,.5,2,{style:'flat',wall:p.plaster});windows(c,office,{count:2});door(c,office,-.48);car(c,.43,.72,p.ochre);box(c,-.75,.65,-.35,.81,0,1.1,p.metal);
  } else if(kind==='service-barber') {
    const b=block(c,-.47,-.66,.47,.42,2,{wall:p.plaster,roofColor:p.slate,style:'gable',rise:2.2});windows(c,b,{count:2});door(c,b,.25);opening(c,b,-.16,2.1,.45,1.5,p.glass);
    const u=.55,d=planSize(c,.35)/2;box(c,u-d,.35,u+d,.43,0,2.4,p.cream);box(c,u-d,.35,u+d,.43,.6,1.2,p.burgundy);box(c,u-d,.35,u+d,.43,1.8,2.4,p.burgundy);chimney(c,b,.3,-.42);
  }
}
export function drawTownBuilding(ctx,kind,biome,detailLevel='town',variant=0,{gardenGround='art',footprint:requestedFootprint}={}) {
  if(!NATIVE_TOWN_BUILDING_KINDS.includes(kind))return false;
  const p=BUILDING_PALETTES[biome]||BUILDING_PALETTES.taiga;
  // A blocked saved parcel can retain its original span after catalog growth.
  // Convert physical features against the span the caller actually renders.
  const span=Number.isInteger(requestedFootprint)&&requestedFootprint>0?requestedFootprint:BUILDINGS[kind].footprint;
  // These derived colours stay within the canonical muted materials, including
  // climate ground and planting; families do not invent independent palettes.
  profiles.set(ctx,{kind,biome,detail:detailLevel,gardenGround,variant:Math.abs(Math.floor(variant))%15,footprint:span,palette:{...p,paving:p.paving||p.stone,path:p.path||shade(p.stone,1.08),water:p.water||p.glass,snow:p.snow||p.cream}});
  try {
    if(kind.startsWith('house-'))home(ctx,kind);
    else if(kind.startsWith('shop-'))shop(ctx,kind);
    else if(kind.startsWith('park-'))park(ctx,kind);
    else if(kind.startsWith('mall-'))mall(ctx,kind);
    else if(kind.startsWith('service-'))service(ctx,kind);
    else civic(ctx,kind);
    return true;
  } finally { profiles.delete(ctx); }
}
