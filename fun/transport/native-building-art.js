import { SPRITE_SCALE, BUILDING_PALETTES, BUILDING_REGISTRATION, featureSpriteUnits } from './sprite-art-direction.js';

// New native cutouts share the atlas camera and metre frame. Layout coordinates
// cover the complete parcel; heights and human features remain physical metres.
const tone = (color, amount) => `rgb(${[1,3,5].map(i => Math.round(parseInt(color.slice(i,i+2),16)*amount)).join(',')})`;
const polygon = (c, points, color) => { c.fillStyle=color;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fill(); };
export const NATIVE_BUILDING_ART_VERSION = 3;

export function drawNativeBuilding(c, kind, biome, { footprint=1, detail='town', variant=0, industry=false, farmCore=false }={}) {
  const p=BUILDING_PALETTES[biome]||BUILDING_PALETTES.taiga,span=Math.max(1,footprint),metres=BUILDING_REGISTRATION.architecturalEnvelopeMetresPerTile*span,unit=featureSpriteUnits(1,span),queue=[],shadows=[];
  const point=(u,v,z=0)=>[16+(u-v)*metres*unit,24+(u+v-1)*metres*unit/2-z*unit];
  const plane=(u0,v0,u1,v1,color,z=0)=>polygon(c,[[u0,v0],[u1,v0],[u1,v1],[u0,v1]].map(([u,v])=>point(u,v,z)),color);
  const stroke=(points,color,width=.16)=>{c.strokeStyle=color;c.lineWidth=featureSpriteUnits(width,span);c.beginPath();points.forEach(([u,v,z=0],i)=>{const q=point(u,v,z);i?c.lineTo(...q):c.moveTo(...q);});c.stroke();};
  const opening=(b,u,width,z,height,color)=>{
    const half=width/metres/2;
    polygon(c,[point(u-half,b.v1,z+height),point(u+half,b.v1,z+height),point(u+half,b.v1,z),point(u-half,b.v1,z)],color);
  };
  const box=(u0,v0,u1,v1,height,options={})=>{
    const wall=options.wall||p.plaster,roof=options.roof||p.slate,base=options.base||0,b={u0,v0,u1,v1,height,base};
    shadows.push(()=>{const pts=[[u0,v0],[u1,v0],[u1,v1],[u0,v1]].map(([u,v])=>point(u,v)),dx=height*unit*.4,dy=height*unit*.2;polygon(c,[pts[0],pts[1],[pts[1][0]+dx,pts[1][1]+dy],[pts[2][0]+dx,pts[2][1]+dy],[pts[3][0]+dx,pts[3][1]+dy]], '#23352b27');});
    queue.push({depth:(u0+u1+v0+v1)/2+base*.0001,paint(){
      polygon(c,[point(u0,v1,base),point(u1,v1,base),point(u1,v1,base+height),point(u0,v1,base+height)],wall);
      polygon(c,[point(u1,v0,base),point(u1,v1,base),point(u1,v1,base+height),point(u1,v0,base+height)],tone(wall,.76));
      plane(u0,v0,u1,v1,roof,base+height);
      if(options.gable){
        const ridge=(v0+v1)/2,rise=Math.min(options.gable,span*3.5),z=base+height;
        polygon(c,[point(u0,v0,z),point(u1,v0,z),point(u1,ridge,z+rise),point(u0,ridge,z+rise)],tone(roof,1.1));
        polygon(c,[point(u0,ridge,z+rise),point(u1,ridge,z+rise),point(u1,v1,z),point(u0,v1,z)],roof);
        polygon(c,[point(u1,v0,z),point(u1,v1,z),point(u1,ridge,z+rise)],tone(wall,.76));
      }
      if(options.windows!==false){
        const floors=Math.max(1,Math.floor(height/SPRITE_SCALE.storeyHeightMetres)),count=Math.max(1,Math.min(detail==='region'?3:5,Math.floor((u1-u0)*metres/3.8)));
        for(let floor=0;floor<floors;floor++)for(let i=0;i<count;i++){
          const u=u0+(u1-u0)*(i+.5)/count,z=base+floor*SPRITE_SCALE.storeyHeightMetres+.9;
          if(z+SPRITE_SCALE.windowHeightMetres<base+height)opening(b,u,SPRITE_SCALE.windowHeightMetres,z,SPRITE_SCALE.windowHeightMetres,p.ink);
        }
      }
      if(options.door!==false)opening(b,u0+(u1-u0)*.28,SPRITE_SCALE.doorWidthMetres*(options.leaves||1),base,SPRITE_SCALE.doorHeightMetres,tone(p.timber,.72));
      for(let i=0;i<(options.bays||0);i++)opening(b,u0+(u1-u0)*(.48+i*.36/Math.max(1,options.bays-1)),Math.min(3.2,(u1-u0)*metres*.2),base,SPRITE_SCALE.loadingBayHeightMetres,p.ink);
      options.paint?.(b);
    }});return b;
  };
  const plant=(u,v,size=2.6)=>{
    const radius=size/metres,height=Math.min(4.2,size*1.7),root=point(u,v),center=point(u,v,height*.7);
    shadows.push(()=>polygon(c,[[root[0]-size*unit,root[1]],[root[0]+size*unit*1.7,root[1]+size*unit*.25],[root[0]+size*unit,root[1]+size*unit*.65],[root[0]-size*unit*.6,root[1]+size*unit*.35]],'#23352b20'));
    queue.push({depth:u+v,paint(){
      stroke([[u,v],[u,v,height]],p.timber,.35);
      const crown=[point(u-radius,v,height*.65),point(u,v-radius,height*.82),point(u+radius,v,height*.65),point(u,v+radius,height*.46)];
      polygon(c,[crown[0],crown[1],center],tone(p.foliage,1.12));polygon(c,[crown[1],crown[2],crown[3],center],tone(p.foliage,.82));polygon(c,[crown[0],center,crown[3]],p.foliage);
    }});
  };
  const tank=(u,v,radius=3,height=7,color=p.metal)=>{
    const r=radius/metres;box(u-r,v-r,u+r,v+r,Math.min(height,span*11),{wall:color,roof:tone(color,1.13),windows:false,door:false});
  };
  const fence=(u0,v0,u1,v1)=>{
    const h=SPRITE_SCALE.fenceHeightMetres;queue.push({depth:(u0+u1+v0+v1)/2,paint(){
      stroke([[u0,v0,h*.75],[u1,v1,h*.75]],p.timber,.22);
      for(const t of [0,.5,1]){const u=u0+(u1-u0)*t,v=v0+(v1-v0)*t;stroke([[u,v],[u,v,h]],p.stone,.25);}
    }});
  };
  const hall=(u0,v0,u1,v1,height=6,options={})=>box(u0,v0,u1,v1,height,{gable:1.6,...options});
  const path=(u0,v0,u1,v1)=>plane(u0,v0,u1,v1,p.path);
  const markCourt=(color=p.foliage)=>{plane(.08,.12,.91,.9,color);stroke([[.12,.17],[.87,.17],[.87,.85],[.12,.85],[.12,.17]],p.cream,.22);stroke([[.5,.17],[.5,.85]],p.cream,.2);};
  const garden=()=>{path(.4,.56,.53,.96);fence(.035,.05,.035,.92);fence(.035,.92,.38,.92);fence(.62,.92,.95,.92);plant(.87,.13,span===1?1.3:2.5);plant(.87,.78,span===1?1.4:2.8);};
  c.save();c.lineJoin='round';c.lineCap='round';
  try{
    if(industry){
      const farms=['farm','dairy-farm','vegetable-farm','orchard','livestock-farm'];
      if(farms.includes(kind)){
        path(.08,.56,.92,.68);hall(.06,.09,.7,.53,5.1,{roof:kind==='orchard'?p.ochre:p.terracotta,bays:1});
        if(kind==='vegetable-farm'){hall(.56,.7,.93,.89,3.3,{roof:p.glass,wall:p.stone,door:false,windows:false});}
        else if(kind==='farm'||kind==='dairy-farm'){tank(.83,.23,Math.min(2.5,span*1.3),kind==='farm'?9:6,p.stone);tank(.83,.49,Math.min(2,span),5,p.metal);}
        else hall(.59,.72,.93,.91,3,{wall:p.timber,roof:p.slate,door:false,windows:false});
        if(!farmCore){for(let n=0;n<4;n++)plane(.09+n*.105,.74,.17+n*.105,.91,kind==='farm'?p.ochre:p.foliage);}
      }else if(/mine|quarry|sand-pit/.test(kind)){
        const mineral=kind==='coal-mine'?p.ink:kind==='copper-mine'?p.terracotta:kind==='iron-mine'?p.brick:kind==='sand-pit'?p.ochre:p.stone;
        plane(.08,.06,.79,.67,tone(mineral,.76));plane(.16,.13,.69,.57,mineral);plane(.24,.21,.61,.49,tone(mineral,.63));
        hall(.08,.72,.58,.94,4.8,{roof:p.metal,bays:1});
        box(.73,.64,.87,.82,Math.min(11,span*6),{wall:p.timber,roof:p.ochre,windows:false,door:false});
        box(.57,.37,.85,.45,Math.min(3.5,span*2),{wall:p.metal,roof:p.ochre,windows:false,door:false});
      }else if(kind==='oil-well'||kind==='refinery'){
        path(.06,.75,.94,.85);hall(.08,.08,.39,.32,3,{roof:p.slate});
        tank(.66,.22,Math.min(5,span*2.1),kind==='refinery'?12:5,p.stone);tank(.8,.58,Math.min(4,span*1.5),6,p.metal);tank(.43,.59,Math.min(3,span),kind==='refinery'?18:8,p.ochre);
        if(kind==='oil-well')box(.17,.51,.6,.59,Math.min(7,span*4),{wall:p.metal,roof:p.ochre,windows:false,door:false});
      }else if(kind==='logging-camp'||kind==='sawmill'){
        hall(.08,.09,.89,.4,5.2,{wall:p.timber,roof:kind==='sawmill'?p.metal:p.slate,bays:2});hall(.64,.54,.92,.91,4.8,{wall:p.timber,roof:p.terracotta,bays:1});
        for(let n=0;n<3;n++)box(.08,.52+n*.13,.52,.61+n*.13,1.2+n*.25,{wall:p.timber,roof:p.ochre,windows:false,door:false});
      }else if(kind==='fishery'){
        hall(.06,.08,.77,.45,4.8,{roof:p.slate,bays:2});for(const u of [.12,.46,.78])plane(u,.5,u+.09,.94,p.timber);box(.1,.58,.32,.71,1.4,{wall:p.cream,roof:p.metal,windows:false,door:false});
      }else{
        const signatures={'steel-mill':0,'food-plant':1,'furniture-factory':2,'machine-works':3,'fish-processor':4,'cement-works':5,'glassworks':6,'wire-mill':7,'goods-factory':8,'equipment-factory':9,'dairy-plant':10,cannery:11,'meat-packer':12},id=signatures[kind]||0;
        const roof=[p.slate,p.terracotta,p.metal,p.ochre][id%4];
        hall(.06,.08,.66,.4,6,{wall:id%2?p.plaster:p.brick,roof,bays:1});hall(.32,.55,.92,.92,6+(id%3)*1.5,{roof,bays:2});
        hall(.72,.08,.92,.36,3,{roof:p.slate,windows:false});
        if(id%3===0||kind==='cement-works'){tank(.13,.69,Math.min(3.2,span*1.25),Math.min(14,span*9),p.stone);tank(.21,.86,Math.min(2.2,span),9,p.metal);}
        else if(id%3===1)box(.1,.54,.23,.88,Math.min(11,span*6),{roof:p.cream,wall:p.stone,windows:false,door:false});
        else for(let n=0;n<2;n++)box(.08,.59+n*.18,.24,.72+n*.18,1.8,{wall:p.timber,roof:p.ochre,windows:false,door:false});
      }
    }else if(kind.startsWith('house-')){
      garden();const index=Number(kind.at(-1)),tier=kind.includes('expensive')?3:kind.includes('normal')?2:1,roof=[p.terracotta,p.slate,p.ochre][(index-1+Math.floor(variant/5))%3],wall=index===2?p.brick:p.plaster;
      if(tier===1&&index===3){for(let i=0;i<3;i++)hall(.06+i*.255,.12,.3+i*.255,.61,3,{roof,wall,windows:true});}
      else if(tier===3&&index===3){hall(.07,.08,.84,.3,6,{wall,roof});hall(.07,.3,.28,.79,6,{wall,roof});hall(.65,.3,.84,.79,3,{wall,roof});plane(.35,.4,.58,.68,p.water);}
      else{
        const height=tier===3?(index===2?9:6):tier===2&&index!==3?6:3;
        hall(.07,.09,.73,.61,height,{wall,roof,gable:index===2?1.1:2,leaves:tier===3?2:1});
        if(index===1||tier===2)hall(.1,.62,.42,.82,3,{wall,roof,door:false});
        if(index===2)box(.62,.68,.8,.87,2.6,{wall:p.timber,roof:p.slate,windows:false,door:false});
      }
    }else if(kind.startsWith('shop-')||kind==='pub'||kind==='service-post-office'||kind==='service-barber'){
      const names=['shop-grocery','shop-bakery','shop-butcher','shop-hardware','shop-florist','shop-cafe','shop-pharmacy','shop-bookshop','pub','service-post-office','service-barber'],id=names.indexOf(kind),accent=[p.foliage,p.ochre,p.burgundy,p.slate,p.terracotta][Math.max(0,id)%5];
      path(.05,.66,.93,.92);hall(.07,.08,.85,.66,id%3===0?6:3,{roof:accent,wall:id%2?p.stone:p.plaster,gable:id%2?1.2:2});
      box(.12,.61,.76,.79,.22,{base:2.55,wall:accent,roof:accent,windows:false,door:false});
      if(kind==='shop-florist')for(const u of [.12,.72])plant(u,.85,1.1);
      else box(.77,.83,.93,.93,.9,{wall:accent,roof:p.cream,windows:false,door:false});
      if(kind==='shop-pharmacy'){box(.47,.68,.54,.7,.9,{base:3,wall:p.cream,roof:p.cream,windows:false,door:false});box(.41,.68,.6,.7,.22,{base:3.34,wall:p.cream,roof:p.cream,windows:false,door:false});}
    }else if(kind.startsWith('park')||kind==='playground'){
      path(.08,.42,.92,.55);path(.43,.08,.55,.93);for(const [u,v]of[[.18,.2],[.75,.19],[.18,.77],[.8,.79]])plant(u,v,span===3?4:span===2?3:1.7);
      if(kind==='park-formal'||kind==='park')tank(.49,.49,1.7,.55,p.stone);
      if(kind==='park-formal')for(const u of [.26,.65])plane(u,.59,u+.1,.76,p.terracotta);
      if(kind==='park-village')box(.22,.59,.42,.78,2.5,{roof:p.terracotta,wall:p.timber,door:false,windows:false});
      if(kind==='park-woodland')for(const [u,v]of[[.6,.28],[.34,.65],[.72,.68]])plant(u,v,3.2);
      if(kind==='playground'){plane(.25,.25,.75,.75,p.ochre);box(.3,.28,.51,.49,2.2,{wall:p.timber,roof:p.burgundy,windows:false,door:false});box(.62,.51,.72,.81,.6,{wall:p.metal,roof:p.cream,windows:false,door:false});}
    }else if(['stadium','sports-field','tennis-courts','ballpark','swimming-pool'].includes(kind)){
      markCourt(kind==='swimming-pool'?p.water:kind==='tennis-courts'?p.terracotta:p.foliage);
      if(kind==='swimming-pool'){for(let n=1;n<4;n++)stroke([[.14,.19+n*.16],[.85,.19+n*.16]],p.cream,.13);hall(.08,.02,.88,.12,3,{roof:p.slate,windows:false});}
      if(kind==='sports-field')for(const u of [.12,.87]){
        stroke([[u,.35],[u,.35,2.4],[u,.65,2.4],[u,.65]],p.cream,.16);
        box(u-.014,.35,u+.014,.39,2.4,{wall:p.cream,roof:p.cream,windows:false,door:false});
      }
      if(kind==='tennis-courts'){
        stroke([[.5,.17,1],[.5,.85,1]],p.cream,.25);
        for(const v of [.17,.85])box(.49,v-.01,.51,v+.01,1.1,{wall:p.stone,roof:p.cream,windows:false,door:false});
      }
      if(kind==='stadium'||kind==='ballpark'){for(const [u0,v0,u1,v1,h]of[[.03,.04,.96,.14,6],[.03,.16,.14,.89,4.5],[.86,.16,.96,.89,4.5]])box(u0,v0,u1,v1,h,{wall:p.stone,roof:kind==='stadium'?p.burgundy:p.slate,windows:false,door:false});}
    }else if(kind==='church'){
      hall(.17,.12,.61,.82,Math.min(8,span*6),{wall:p.stone,roof:p.slate,gable:3.5,leaves:2});box(.64,.53,.88,.8,Math.min(16,span*10),{wall:p.stone,roof:p.slate,windows:false,leaves:2});path(.2,.83,.86,.94);
    }else if(kind==='fire-station'||kind==='service-garage'){
      hall(.05,.08,.31,.86,6,{wall:p.brick,roof:p.slate});box(.35,.2,.93,.87,4.8,{wall:p.stone,roof:p.terracotta,bays:kind==='fire-station'?2:1,door:false,windows:false});path(.35,.87,.93,.95);
    }else if(kind.startsWith('mall-')){
      const modern=kind==='mall-modern',large=kind!=='mall-neighborhood';path(.04,.73,.95,.94);box(.05,.07,.7,.7,large?6:3,{wall:p.stone,roof:modern?p.glass:p.slate});box(.73,.13,.94,.71,3,{wall:p.plaster,roof:p.terracotta});if(large)box(.15,.2,.62,.53,2.2,{base:6,wall:p.metal,roof:modern?p.cream:p.ochre,door:false,windows:false});
    }else{
      const layouts={school:[.08,.08,.88,.36,6],hospital:[.28,.06,.7,.85,9],'police-station':[.06,.09,.65,.61,6],'service-bank':[.08,.12,.86,.78,6],'service-hotel':[.1,.08,.68,.83,12],'sports-hall':[.07,.07,.91,.72,6],'town-hall':[.12,.13,.87,.64,6]},b=layouts[kind]||[.08,.1,.88,.7,6];
      hall(...b,{roof:kind==='hospital'?p.cream:kind==='town-hall'?p.terracotta:p.slate,wall:kind==='service-bank'?p.stone:p.plaster,gable:kind==='sports-hall'?2.3:1.2,leaves:kind==='school'||kind==='hospital'||kind==='service-hotel'?2:1});
      if(['school','hospital','police-station'].includes(kind))hall(.06,.5,.87,.79,3,{roof:p.slate,door:false});
      if(kind==='town-hall')box(.36,.25,.59,.49,5,{base:6,roof:p.ochre,wall:p.stone,windows:false,door:false});
      path(.06,.84,.94,.94);plant(.86,.14,2.2);plant(.86,.84,2);
    }
    for(const paint of shadows)paint();queue.sort((a,b)=>a.depth-b.depth);for(const item of queue)item.paint();
  }finally{c.restore();}
  return true;
}
