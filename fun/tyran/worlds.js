/** Tyran: deterministic tile maps and reusable terrain/scenery sprites. */
import { MAP_TILE_SIZE, hashLevel, tileAt } from './tile-map.js';
import { TerrainSprites } from './terrain-sprites.js';
import { spritesReady, spriteRevision, spriteCell } from './sprite-assets.js';

export const WORLDS = [
  { id: 'jungle', name: 'Emerald Frontier', subtitle: '01 / The Living Canopy', description: 'Ancient temples disappear beneath a vast emerald rainforest.', color: '#67f0b1', accent: '#b7ffcc', enemyColor: '#f05245', bossName: 'Canopy Devourer' },
  { id: 'snow', name: 'Polar Silence', subtitle: '02 / Frozen Signal', description: 'Glacial rivers cut through snowbound forests and abandoned outposts.', color: '#8bddff', accent: '#e3f8ff', enemyColor: '#ff3f9e', bossName: 'Frost Colossus' },
  { id: 'desert', name: 'Sunken Empire', subtitle: '03 / Sands of the Ancients', description: 'Cross golden dunes, ruined monuments and a forgotten empire.', color: '#ffc578', accent: '#ffe0a4', enemyColor: '#39e8ff', bossName: 'Dune Leviathan' },
  { id: 'paradise', name: 'Azure Archipelago', subtitle: '04 / Trouble in Paradise', description: 'Turquoise shallows, coral gardens and islands beneath drifting clouds.', color: '#51e5ed', accent: '#c1fff2', enemyColor: '#ff6338', bossName: 'Coral Dreadnought' },
  { id: 'asteroid', name: 'Shattered Orbit', subtitle: '05 / The Mining Belt', description: 'Navigate glittering debris fields and the wreckage of orbital industry.', color: '#b1a5ff', accent: '#e5ddff', enemyColor: '#74ed63', bossName: 'Orbital Crusher' },
  { id: 'mars', name: 'Red Horizon', subtitle: '06 / The Lost Colony', description: 'Dust storms sweep ochre canyons and silent colony domes.', color: '#ff957a', accent: '#ffd0a1', enemyColor: '#45f0cf', bossName: 'Martian Siegebreaker' },
  { id: 'volcanic', name: 'Inferno Foundry', subtitle: '07 / Into the Caldera', description: 'Rivers of molten rock feed a war machine buried in black basalt.', color: '#ff8055', accent: '#ffd28a', enemyColor: '#69cfff', bossName: 'Magma Titan' },
  { id: 'neon', name: 'Neon Afterlife', subtitle: '08 / City of Machines', description: 'Rain-slick avenues and holographic towers pulse beneath your wings.', color: '#f080ff', accent: '#8ff4ff', enemyColor: '#f4ff52', bossName: 'Metropolis Prime' },
  { id: 'alien', name: 'Luminous Garden', subtitle: '09 / A World That Dreams', description: 'Bioluminescent forests grow around crystals and impossible ruins.', color: '#c895ff', accent: '#6fffe0', enemyColor: '#c7ff57', bossName: 'The Bloom Sovereign' },
  { id: 'void', name: 'Obsidian Citadel', subtitle: '10 / The Last Light', description: 'The final fortress hangs over an abyss of shattered stars.', color: '#ffa6c8', accent: '#ffe0ee', enemyColor: '#ffc94f', bossName: 'Tyran, World Ender' },
];


const TILE = 800; // Eight rows of 100px map cells per cached strip.
const WIDTH = 1200;
const MARGIN = MAP_TILE_SIZE; // Actual offscreen cells cover lateral drift.
const PAD = 140;
const HIT_CELL = 160;
const TAU = Math.PI * 2;
export const PARALLAX_LAYERS = Object.freeze([
  { id:'ground', label:'Terrain and scenery', speed:1, x:1 },
  { id:'atmosphere', label:'Clouds and drifting particles', speed:1.16, x:1.35 },
].map(Object.freeze));
const PALETTES = [
  { base:'#102e2c', low:'#09201f', mid:'#214c3d', high:'#406e44', water:'#0b4b53', shore:'#387f6e', fog:'#aecdc5', props:['tree','palm','temple','fern','bunker','tree'] },
  { base:'#7899a6', low:'#536e82', mid:'#a7c3ca', high:'#dce9e6', water:'#366b86', shore:'#b4e4e5', fog:'#d8f3ff', props:['pine','pine','ice','station','rock','radar'] },
  { base:'#987047', low:'#694c38', mid:'#bb9059', high:'#dfb879', water:'#565c59', shore:'#d7af72', fog:'#f2c687', props:['cactus','ruin','rock','temple','cactus','bunker'] },
  { base:'#086171', low:'#064656', mid:'#087f8b', high:'#27a8ad', water:'#128ca2', shore:'#61ded5', fog:'#e1ffff', props:['palm','palm','coral','hut','rock','station'] },
  { base:'#111626', low:'#080d1b', mid:'#27283e', high:'#696175', water:'#141a30', shore:'#3b4664', fog:'#aa9fc6', props:['asteroid','asteroid','crystal','satellite','station','asteroid'] },
  { base:'#854d3c', low:'#52332f', mid:'#a66348', high:'#c78559', water:'#603e37', shore:'#c78458', fog:'#f4af81', props:['rock','dome','rock','solar','radar','station'] },
  { base:'#29252b', low:'#151920', mid:'#3d3035', high:'#61504b', water:'#d54723', shore:'#ed7436', fog:'#b96753', props:['basalt','vent','refinery','basalt','crystal','radar'] },
  { base:'#192138', low:'#101a2c', mid:'#27304a', high:'#46526a', water:'#111a2e', shore:'#4c507e', fog:'#8195bb', props:['building','building','tower','building','solar','station'] },
  { base:'#252243', low:'#141c32', mid:'#43304e', high:'#69516c', water:'#24545b', shore:'#449879', fog:'#b4b6ef', props:['mushroom','crystal','alienTree','mushroom','temple','pod'] },
  { base:'#171823', low:'#090f1a', mid:'#292633', high:'#4b4656', water:'#171b2d', shore:'#6b4b64', fog:'#b291bb', props:['pylon','fortress','crystal','pylon','station','ruin'] },
];

function random(seed) {
  let a = seed >>> 0;
  return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
function canvas(w,h) { const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w,h) : document.createElement('canvas'); c.width=w; c.height=h; return c; }
function circle(c,x,y,r,color) { c.fillStyle=color; c.beginPath(); c.arc(x,y,r,0,TAU); c.fill(); }
function ellipse(c,x,y,rx,ry,color) { c.fillStyle=color; c.beginPath(); c.ellipse(x,y,rx,ry,0,0,TAU); c.fill(); }
function polygon(c,points,fill,stroke=null,width=1) { c.beginPath(); points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y)); c.closePath(); if(fill){c.fillStyle=fill;c.fill();} if(stroke){c.strokeStyle=stroke;c.lineWidth=width;c.stroke();} }
function line(c,pts,color,width=1) { c.beginPath();pts.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.strokeStyle=color;c.lineWidth=width;c.stroke(); }
function glow(c,x,y,r,color,alpha=0.3) { const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,color);g.addColorStop(1,'transparent');c.globalAlpha=alpha;circle(c,x,y,r,g);c.globalAlpha=1; }
function blob(c,x,y,rx,ry,fill,rng,detail=16) { const p=[]; for(let i=0;i<detail;i++){const a=i/detail*TAU;const d=.77+rng()*.23;p.push([x+Math.cos(a)*rx*d,y+Math.sin(a)*ry*d]);} polygon(c,p,fill);return p; }
const STRUCTURES = new Set(['temple','bunker','station','radar','dome','solar','refinery','building','tower','pylon','fortress','hut','satellite']);
const EMISSIVE = new Set(['crystal','pylon','mushroom','radar','tower','vent']);
const NATURE_SPRITES = Object.freeze(['tree','alienTree','palm','pine','fern','cactus','mushroom','pod','ice','crystal','rock','asteroid','basalt','vent','coral','cloud']);
const STRUCTURE_SPRITES = Object.freeze(['temple','ruin','bunker','station','radar','dome','solar','refinery','building','tower','pylon','fortress','hut','satellite','crawler','hauler']);
const STRUCTURE_ATLASES = Object.freeze(['structures','structureLight','structureHeavy','structureCrater']);
const STRUCTURE_STRENGTH = Object.freeze({temple:1.5,ruin:.7,bunker:1.8,station:1.35,radar:.9,dome:1.05,solar:.7,refinery:1.55,building:1.4,tower:1.15,pylon:.85,fortress:2.2,hut:.65,satellite:.9,crawler:1.55,hauler:1.15});
export function structureDurability(type,size) {
  return Math.round(size*size*.085*(STRUCTURE_STRENGTH[type]||1));
}
export function structureStage({hp,maxHp}) {
  const health=hp/maxHp;
  return health<=0?3:health<=.35?2:health<=.7?1:0;
}
const FOLIAGE = new Set(['tree','alienTree','palm','pine','fern','cactus','mushroom','pod','coral']);
const rgb = hex => [1,3,5].map(offset=>parseInt(hex.slice(offset,offset+2),16));
const mixColor = (a,b,t) => a.map((channel,i)=>channel+(b[i]-channel)*t);
// Each biome alternates between open country, natural formations and inhabited sites.
const DISTRICTS = [
  [['tree','fern','tree','palm'],['temple','ruin','fern','tree'],['bunker','radar','tree','fern'],['palm','fern','rock']],
  [['pine','pine','rock'],['ice','ice','rock'],['station','radar','solar','pine'],['pine','ice']],
  [['cactus','rock','cactus'],['temple','ruin','rock'],['bunker','solar','radar'],['rock','ruin','cactus']],
  [['palm','hut','palm'],['coral','coral','rock'],['station','solar','hut','palm'],['palm','coral']],
  [['asteroid','asteroid','crystal'],['satellite','station','asteroid'],['crystal','asteroid'],['asteroid','satellite']],
  [['rock','rock'],['dome','solar','station','radar'],['rock','crystal'],['station','solar','dome']],
  [['basalt','vent','basalt'],['refinery','radar','basalt'],['crystal','vent'],['basalt','refinery']],
  [['building','tower','building'],['solar','station','building'],['tower','tower','building'],['building','radar','station']],
  [['mushroom','alienTree','pod'],['crystal','crystal','mushroom'],['temple','pod','alienTree'],['alienTree','mushroom']],
  [['pylon','fortress','pylon'],['ruin','crystal','station'],['fortress','pylon'],['crystal','pylon','ruin']],
];

/** Seeded terrain and scenery share one ground plane; only atmosphere drifts. */
export class WorldRenderer {
  constructor() {
    this.tiles=new Map();this.bands=new Map();this.sprites=new Map();
    this.sceneryLayers=[new Map()];
    this.layerViews=[{zoom:1,x:0,y:0,first:0,last:0}];
    this.hitBuckets=new Map();this.visibleProps=[];this.damage=new Map();this.destroyed=new Set();
    this.setWorld(0);
  }
  setWorld(index, seed='tyran-v2') {
    const nextIndex=((Math.floor(Number(index)||0)%WORLDS.length)+WORLDS.length)%WORLDS.length;
    const nextHash=hashLevel(WORLDS[nextIndex].id,seed),reuse=this.index===nextIndex&&this.levelHash===nextHash;
    this.index=nextIndex;
    this.world=WORLDS[this.index];this.palette=PALETTES[this.index];
    this.seed=seed;this.levelHash=nextHash;
    if(!reuse||this.damage.size||this.destroyed.size){
      this.bands.clear();this.hitBuckets.clear();
      for(const layers of this.sceneryLayers)layers.clear();
    }
    this.damage.clear();this.destroyed.clear();this.visibleProps.length=0;
    this.scale=1;this.scroll=0;this.parallaxX=0;
    // A preview or retry reuses immutable artwork while resetting destruction.
    if(reuse)return;
    this.warmEpoch=(this.warmEpoch||0)+1;this.warmJobs=[];this.warmKeys=new Set();this.warmPending=false;
    this.terrain=new TerrainSprites(this.index,this.palette);this.tiles.clear();this.sprites.clear();this.clouds=[];
    const rng=random(this.levelHash);
    for(let i=0;i<7;i++)this.clouds.push({x:rng()*WIDTH,y:rng()*1500,r:150+rng()*160,phase:rng()*TAU});
    this.cloudSprite=this.makeCloud();this.lightSprite=this.makeLight();this.scorchSprite=this.makeScorch();
    this.shaftSprite=this.makeShaft();this.vignetteSprite=this.makeVignette();this.substrateSprite=this.makeSubstrate();
    this.assetRevision=spriteRevision;
    this.ready=spritesReady.then(()=>{
      if(this.index===nextIndex&&this.levelHash===nextHash)this.refreshSpriteAssets();
    });
    for(let material=0;material<4;material++)for(let variant=0;variant<6;variant++)this.queueWarm(`material:${material}:${variant}`,()=>this.terrain.getMaterial(material,variant));
    this.warmScenery();
  }
  warmScenery() {
    const types=new Set([...this.palette.props,...DISTRICTS[this.index].flat(),'crawler','hauler']);
    for(const type of types)for(let variant=0;variant<5;variant++){
      const stages=STRUCTURE_SPRITES.includes(type)?4:1;
      for(let stage=0;stage<stages;stage++)this.queueWarm(`sprite:${type}:${variant}:${stage}`,()=>this.getSprite(type,variant,stage));
    }
  }
  refreshSpriteAssets() {
    if(this.assetRevision===spriteRevision)return;
    this.assetRevision=spriteRevision;this.sprites.clear();
    this.tiles.clear();this.terrain.materials.clear();this.terrain.edges.clear();
    for(const layer of this.sceneryLayers)layer.clear();
    this.cloudSprite=this.makeCloud();this.warmScenery();
  }
  queueWarm(key,work) {
    if(typeof requestIdleCallback!=='function'||this.warmKeys.has(key))return;
    this.warmKeys.add(key);this.warmJobs.push({key,work});this.runWarmQueue();
  }
  restoreDamage(damage, destroyed, sceneryVersion=2) {
    this.damage=new Map(damage);this.destroyed=new Set(destroyed);
    this.bands.clear();this.hitBuckets.clear();this.visibleProps.length=0;
    for(const layer of this.sceneryLayers)layer.clear();
    if(sceneryVersion<2){
      // Old saves stored absolute HP against the previous, smaller health totals.
      // Visit only damaged rows, then discard their transient geometry immediately.
      const rows=new Set([...this.damage.keys()].map(id=>Number(id.split(':')[1])).filter(Number.isFinite));
      for(const row of rows){
        for(const prop of this.getBand(row))if(this.damage.has(prop.id)&&STRUCTURE_SPRITES.includes(prop.type)){
          const oldMaxHp=STRUCTURES.has(prop.type)?45+prop.size*.45:12+prop.size*.22;
          const health=clamp(this.damage.get(prop.id)/oldMaxHp,0,1);
          this.damage.set(prop.id,this.destroyed.has(prop.id)?0:health*prop.maxHp);
        }
        this.bands.clear();this.hitBuckets.clear();
      }
    }
  }
  prepare(width,height) {
    const last=Math.floor(height/(width/WIDTH)/TILE);
    for(let row=-1;row<=last;row++){
      if(!this.tiles.has(row))this.queueWarm(`terrain:${row}`,()=>this.getTile(row));
      if(!this.sceneryLayers[0].has(row)){
        this.queueWarm(`scenery:0:${row}`,()=>this.getSceneryLayer(row,this.getBand(row)));
      }
    }
  }
  runWarmQueue() {
    if(this.warmPending||!this.warmJobs.length||typeof requestIdleCallback!=='function')return;
    this.warmPending=true;const epoch=this.warmEpoch;
    requestIdleCallback(deadline=>{
      if(epoch!==this.warmEpoch)return;
      this.warmPending=false;const start=performance.now();
      while(this.warmJobs.length&&deadline.timeRemaining()>3&&performance.now()-start<3) {
        const job=this.warmJobs.shift();this.warmKeys.delete(job.key);job.work();
      }
      this.runWarmQueue();
    });
  }
  tileAt(col,row) {return tileAt(this.levelHash,this.index,col,row);}
  makeSubstrate() {
    const out=canvas(600,600),c=out.getContext('2d'),p=this.palette,rng=random(this.levelHash^5371);
    c.fillStyle=p.low;c.fillRect(0,0,600,600);
    const space=this.index===4||this.index===9;
    for(let i=0;i<(space?180:40);i++) {
      const x=rng()*600,y=rng()*600;c.globalAlpha=space?.15+rng()*.3:.04+rng()*.05;
      if(space){c.fillStyle='#9aa6bd';c.fillRect(x,y,.5+rng(),.5+rng());}
      else ellipse(c,x,y,8+rng()*65,2+rng()*9,p.shore);
    }
    return out;
  }
  drawSubstrate(c,h,scroll) {
    c.fillStyle=this.palette.low;c.fillRect(-MARGIN,0,WIDTH+MARGIN*2,h);
    const shift=scroll*PARALLAX_LAYERS[0].speed,first=Math.floor(-shift/600);
    for(let row=first;row*600+shift<h;row++)for(let col=-1;col<3;col++)c.drawImage(this.substrateSprite,col*600,row*600+shift);
  }
  getTile(row) {
    if(this.tiles.has(row))return this.tiles.get(row);
    const out=canvas(WIDTH+MARGIN*2,TILE),c=out.getContext('2d');
    for(let y=0;y<TILE/MAP_TILE_SIZE;y++)for(let col=-1;col<=WIDTH/MAP_TILE_SIZE;col++) {
      const tile=this.tileAt(col,row*(TILE/MAP_TILE_SIZE)+y),x=col*MAP_TILE_SIZE+MARGIN,py=y*MAP_TILE_SIZE;
      c.globalAlpha=.86;c.drawImage(this.terrain.getMaterial(0,tile.variant),x,py,MAP_TILE_SIZE,MAP_TILE_SIZE);c.globalAlpha=1;
      for(let material=1;material<4;material++)if(tile.cornerMasks[material])c.drawImage(this.terrain.get(material,tile.variant,tile.cornerMasks[material]),x,py,MAP_TILE_SIZE,MAP_TILE_SIZE);
    }
    this.tiles.set(row,out);return out;
  }
  getBand(row) {
    if(this.bands.has(row))return this.bands.get(row);
    const props=[],rng=random(this.levelHash^Math.imul(row,33479));
    const district=Math.floor(rng()*DISTRICTS[this.index].length),types=DISTRICTS[this.index][district];
    for(let y=0;y<TILE/MAP_TILE_SIZE;y++)for(let col=-1;col<=WIDTH/MAP_TILE_SIZE;col++) {
      const tileRow=row*(TILE/MAP_TILE_SIZE)+y,tile=this.tileAt(col,tileRow);
      const r=random(this.levelHash^Math.imul(tileRow,90149)^Math.imul(col,19433));
      const space=this.index===4||this.index===9;
      if(tile.material===0&&!(this.index===3&&r()<.09))continue;
      const vegetation=[0,1,3,8].includes(this.index);
      const density=vegetation?(tile.material>=2?.7:.18):space?.4:.27;
      if(r()>density)continue;
      let type=types[Math.floor(r()*types.length)];
      if(this.index===3&&tile.material<=1)type='coral';
      if(STRUCTURES.has(type)&&tile.material<2)type=this.palette.props[0];
      if(!vegetation&&tile.material>=2&&r()<.18)type=r()<.55?'crawler':'hauler';
      const cluster=vegetation&&['tree','pine','palm','fern','alienTree','mushroom','pod'].includes(type)?2+Math.floor(r()*3):1;
      for(let n=0;n<cluster;n++){
        const x=(col+.18+r()*.64)*MAP_TILE_SIZE,py=(tileRow+.16+r()*.68)*MAP_TILE_SIZE;
        const structure=STRUCTURES.has(type),vehicle=type==='crawler'||type==='hauler';
        const size=vehicle?34+r()*12:structure?52+r()*35:30+r()*33;
        const maxHp=STRUCTURE_SPRITES.includes(type)?structureDurability(type,size):12+size*.22,id=`${this.levelHash}:${row}:${col}:${y}:${n}`;
        const prop={id,row,x,y:py,type,size,variant:Math.floor(r()*5),hp:this.damage.get(id)??maxHp,maxHp,value:structure?12:4,color:this.world.color,emissive:EMISSIVE.has(type),depth:0};
        props.push(prop);
        const key=`${Math.floor(py/HIT_CELL)}:${Math.floor(x/HIT_CELL)}`;
        let bucket=this.hitBuckets.get(key);if(!bucket){bucket=[];this.hitBuckets.set(key,bucket);}bucket.push(prop);
      }
    }
    props.sort((a,b)=>a.y-b.y);this.bands.set(row,props);return props;
  }
  getSceneryLayer(row,band,depth=0) {
    const cache=this.sceneryLayers[depth];if(cache.has(row))return cache.get(row);
    const out=canvas(WIDTH+MARGIN*2,TILE+PAD*2),c=out.getContext('2d');
    for(const prop of band) {
      const y=prop.y-row*TILE+PAD,x=prop.x+MARGIN,scale=prop.size/100;
      const structural=STRUCTURE_SPRITES.includes(prop.type),destroyed=this.destroyed.has(prop.id);
      if(destroyed&&!structural){this.drawScorch(c,x,y,prop.size);continue;}
      const stage=structural?(destroyed?3:structureStage(prop)):0;
      c.drawImage(this.getSprite(prop.type,prop.variant,stage),x-130*scale,y-130*scale,260*scale,260*scale);
      if(!structural&&prop.hp<prop.maxHp)ellipse(c,x+4,y+5,prop.size*.22,prop.size*.16,'rgba(36,28,37,.36)');
    }
    cache.set(row,out);return out;
  }
  drawGroundScenery(c,h,scroll,time,quality) {
    const view=this.layerViews[0];view.x=this.parallaxX;view.y=scroll;
    const first=view.first=Math.floor((-scroll-PAD)/TILE);
    const last=view.last=Math.floor((h-scroll+PAD)/TILE),cache=this.sceneryLayers[0];
    c.save();c.translate(view.x,view.y);
    for(let row=first;row<=last;row++) {
      const band=this.getBand(row);c.globalAlpha=1;
      c.drawImage(this.getSceneryLayer(row,band),-MARGIN,row*TILE-PAD);
      for(const prop of band){
        if(this.destroyed.has(prop.id))continue;
        const y=prop.y+scroll;if(y<-PAD||y>h+PAD)continue;
        prop.screenX=prop.x+view.x;prop.screenY=y;this.visibleProps.push(prop);
        if(prop.emissive&&quality!=='low'){
          const radius=prop.size*.65;c.globalAlpha=.1+Math.sin(time*1.7+prop.variant*2)*.03;
          c.drawImage(this.lightSprite,prop.x-radius,prop.y-radius,radius*2,radius*2);
        }
      }
    }
    c.restore();
    for(const row of cache.keys())if(row<first-1||row>last+1)cache.delete(row);
  }
  draw(ctx,W,H,scroll,time,quality='high',focusX=W*.5) {
    this.refreshSpriteAssets();
    const s=W/WIDTH,h=H/s;
    this.scale=s;this.scroll=scroll;this.parallaxX=(.5-clamp(focusX/W,0,1))*WIDTH*.02;this.visibleProps.length=0;
    ctx.save();ctx.scale(s,s);
    ctx.save();ctx.translate(this.parallaxX,0);
    this.drawSubstrate(ctx,h,scroll);
    const first=Math.floor(-scroll/TILE),last=Math.floor((h-scroll)/TILE);
    for(let row=first;row<=last;row++)ctx.drawImage(this.getTile(row),-MARGIN,row*TILE+scroll,WIDTH+MARGIN*2,TILE+.5);
    ctx.restore();
    this.drawGroundScenery(ctx,h,scroll,time,quality);
    ctx.globalAlpha=1;ctx.save();ctx.translate(this.parallaxX*PARALLAX_LAYERS[1].x,0);this.drawAtmosphere(ctx,h,scroll,time,quality);ctx.restore();
    ctx.drawImage(this.vignetteSprite,0,0,WIDTH,h);ctx.restore();
    for(const row of this.tiles.keys())if(row<first-1||row>last+1)this.tiles.delete(row);
    // Keep only nearby pixel caches and regenerated bands. Damage is a compact ledger.
    for(const [row,band] of this.bands)if(!this.layerViews.some(view=>row>=view.first-1&&row<=view.last+1)){
      for(const prop of band){const key=`${Math.floor(prop.y/HIT_CELL)}:${Math.floor(prop.x/HIT_CELL)}`,bucket=this.hitBuckets.get(key);if(bucket){const i=bucket.indexOf(prop);if(i>=0)bucket.splice(i,1);if(!bucket.length)this.hitBuckets.delete(key);}}
      this.bands.delete(row);
    }
    const epoch=this.warmEpoch;
    if(!this.tiles.has(first-1))this.queueWarm(`terrain:${first-1}`,()=>{if(epoch===this.warmEpoch)this.getTile(first-1);});
  }
  /** All ground sprites and hits use exactly the terrain's translation. */
  hit(x,y,radius,damage,scroll=this.scroll) {
    const s=this.scale||1,px=x/s-this.parallaxX,py=y/s-scroll,r=radius/s,reach=r+40,result=[];
    for(let by=Math.floor((py-reach)/HIT_CELL);by<=Math.floor((py+reach)/HIT_CELL);by++)for(let bx=Math.floor((px-reach)/HIT_CELL);bx<=Math.floor((px+reach)/HIT_CELL);bx++){
      const bucket=this.hitBuckets.get(`${by}:${bx}`);if(!bucket)continue;
      for(const prop of bucket){
        if(this.destroyed.has(prop.id)||(px-prop.x)**2+(py-prop.y)**2>(r+prop.size*.32)**2)continue;
        const structural=STRUCTURE_SPRITES.includes(prop.type),before=structural?structureStage(prop):prop.hp<prop.maxHp?1:0;
        prop.hp=Math.max(0,prop.hp-damage);this.damage.set(prop.id,prop.hp);
        const after=structural?structureStage(prop):prop.hp<=0?3:prop.hp<prop.maxHp?1:0;
        if(after!==before)this.sceneryLayers[0].delete(prop.row);
        if(prop.hp<=0){
          this.destroyed.add(prop.id);
          result.push({id:prop.id,x:(prop.x+this.parallaxX)*s,y:(prop.y+scroll)*s,size:prop.size*s,footprint:prop.size,structural,blastRadius:clamp(prop.size*2.8,120,250)*s,color:prop.color,value:prop.value});
        }
      }
    }
    return result;
  }
  spriteVehicle(c,rng,type) {
    const p=this.palette,hauler=type==='hauler',w=hauler?25:30,h=hauler?47:34;
    c.fillStyle=p.low;c.fillRect(-w-7,-h,w*2+14,h*2);
    for(const x of [-w-7,w]){c.fillStyle='#252e30';c.fillRect(x,-h,7,h*2);for(let y=-h+2;y<h;y+=6){c.fillStyle='#61706a';c.fillRect(x+1,y,5,2);}}
    c.fillStyle=p.mid;c.fillRect(-w,-h+2,w*2,h*2-4);c.strokeStyle=p.high;c.lineWidth=2;c.strokeRect(-w+2,-h+4,w*2-4,h*2-8);
    if(hauler){c.fillStyle=p.low;c.fillRect(-w+4,-h+7,w*2-8,20);for(let y=-8;y<h-5;y+=9){c.fillStyle=p.high;c.fillRect(-w+4,y,w*2-8,2);}}
    else{ellipse(c,0,0,18,21,p.low);ellipse(c,-2,-3,16,18,p.high);line(c,[[0,-10],[0,-57]],'#667875',7);line(c,[[-2,-12],[-2,-56]],'#9aab95',2);}
    c.fillStyle='#bdc4a2';c.fillRect(-w+4,-h+3,5,2);c.fillRect(w-9,-h+3,5,2);
  }
  getSprite(type,variant,stage=0) {
    const key=`${type}:${variant}:${stage}`;if(this.sprites.has(key))return this.sprites.get(key);
    const realistic=this.makeAtlasSprite(type,variant,stage);
    if(realistic){this.sprites.set(key,realistic);return realistic;}
    if(stage>0){const damaged=this.makeDamagedFallback(type,variant,stage);this.sprites.set(key,damaged);return damaged;}
    const out=canvas(260,260),c=out.getContext('2d'),rng=random(variant*5811+this.index*741+1636);
    c.translate(130,130);c.lineJoin='round';c.lineCap='round';
    // Consistent sunlight from the upper left grounds all scenery.
    ellipse(c,13,20,52,31,'rgba(2,8,18,.35)');
    if(type==='tree'||type==='alienTree')this.spriteTree(c,rng,type==='alienTree');
    else if(type==='palm')this.spritePalm(c,rng);
    else if(type==='pine')this.spritePine(c,rng);
    else if(type==='fern')this.spriteFern(c,rng);
    else if(type==='cactus')this.spriteCactus(c,rng);
    else if(type==='mushroom'||type==='pod')this.spriteMushroom(c,rng,type==='pod');
    else if(type==='ice'||type==='crystal')this.spriteCrystal(c,rng,type==='ice');
    else if(type==='rock'||type==='asteroid'||type==='basalt'||type==='vent')this.spriteRock(c,rng,type);
    else if(type==='coral')this.spriteCoral(c,rng);
    else if(type==='crawler'||type==='hauler')this.spriteVehicle(c,rng,type);
    else this.spriteStructure(c,rng,type,variant);
    // Cached weathering and directional light tie scenery to the terrain palette.
    c.globalCompositeOperation='source-atop';
    const light=c.createLinearGradient(-80,-80,65,90);light.addColorStop(0,'rgba(236,237,212,.22)');light.addColorStop(.44,'transparent');light.addColorStop(1,'rgba(4,12,25,.32)');c.fillStyle=light;c.fillRect(-130,-130,260,260);
    for(let i=0;i<1100;i++){const x=(rng()-.5)*180,y=(rng()-.5)*190;c.fillStyle=i%3?'rgba(10,19,27,.18)':'rgba(224,230,205,.18)';const size=.4+rng()*1.5;c.fillRect(x,y,size,size);}
    c.globalCompositeOperation='source-over';
    this.sprites.set(key,out);return out;
  }
  makeDamagedFallback(type,variant,stage) {
    const out=canvas(260,260),c=out.getContext('2d'),rng=random(variant*531+STRUCTURE_SPRITES.indexOf(type)*731);
    if(stage===3){
      this.drawScorch(c,130,130,130);
      for(let i=0;i<30;i++){
        const a=rng()*TAU,r=18+rng()*63,x=130+Math.cos(a)*r,y=130+Math.sin(a)*r*.7;
        c.fillStyle=i%3?this.palette.low:this.palette.mid;c.fillRect(x,y,2+rng()*7,2+rng()*5);
      }
    } else {
      c.drawImage(this.getSprite(type,variant),0,0);c.globalCompositeOperation='source-atop';
      for(let i=0;i<(stage===1?4:9);i++){
        const x=88+rng()*84,y=83+rng()*88,r=stage===1?8+rng()*8:12+rng()*14;
        ellipse(c,x,y,r,r*.72,'rgba(6,11,15,.8)');line(c,[[x-r,y-r],[x,y],[x+r*.8,y-r*.4]],this.palette.low,stage+1);
      }
      c.globalCompositeOperation='source-over';
    }
    return out;
  }
  sceneryRamp(type) {
    const p=this.palette;
    // Ground materials keep their biome hues; the fleet owns the complementary colors.
    if(['tree','palm','fern'].includes(type))return ['#162c25','#29533a','#527a4a','#91a575'].map(rgb);
    if(type==='pine')return ['#2d4b50','#56797d','#a7c2c3','#e0eae0'].map(rgb);
    if(type==='cactus')return ['#39463a','#607253','#91956b','#b8b18a'].map(rgb);
    if(type==='alienTree'||type==='pod')return ['#25343d','#40575b','#698279','#a1b49c'].map(rgb);
    if(type==='mushroom')return ['#282d44','#52485f','#80708b','#b2a4b7'].map(rgb);
    if(type==='coral')return ['#28535b','#537d7d','#93aaa0','#bfd1bb'].map(rgb);
    if(type==='ice')return ['#436575','#739ba9','#b3ced2','#e0eae4'].map(rgb);
    if(type==='crystal'&&this.index!==6)return [rgb(p.low),mixColor(rgb(p.mid),rgb('#738097'),.3),mixColor(rgb(p.high),rgb('#99a5b6'),.3),mixColor(rgb(p.high),rgb('#d1d7dc'),.5)];
    const structure=STRUCTURE_SPRITES.includes(type),neutral=structure?.3:0;
    return [
      mixColor(rgb(p.low),rgb('#101922'),.2),
      mixColor(rgb(p.mid),rgb('#616968'),neutral),
      mixColor(rgb(p.high),rgb('#a3aaa4'),neutral),
      mixColor(rgb(p.high),rgb(p.fog),structure?.5:.38),
    ];
  }
  makeAtlasSprite(type,variant,stage=0) {
    const naturalIndex=NATURE_SPRITES.indexOf(type),structureIndex=STRUCTURE_SPRITES.indexOf(type);
    const source=naturalIndex>=0?spriteCell('nature',naturalIndex):structureIndex>=0?spriteCell(STRUCTURE_ATLASES[stage],structureIndex):null;
    if(!source)return null;
    const out=canvas(260,260),body=canvas(260,260),c=out.getContext('2d'),b=body.getContext('2d');
    const rng=random(variant*5811+this.index*741+1636),foliage=FOLIAGE.has(type),vehicle=type==='crawler'||type==='hauler';
    const extent=(vehicle?126:foliage?164:STRUCTURE_SPRITES.includes(type)?176:145)*(.96+variant*.02);
    const scale=extent/Math.max(source.width,source.height),w=source.width*scale,h=source.height*scale;
    b.save();b.translate(130,130);
    if(foliage&&variant%2)b.scale(-1,1);
    b.drawImage(source,-w*.5,-h*.5,w,h);b.restore();
    const pixels=b.getImageData(0,0,260,260),data=pixels.data,ramp=this.sceneryRamp(type);
    const exposure=.96+variant*.018,ember=type==='vent'&&this.index===6?rgb(this.palette.shore):null;
    for(let i=0;i<data.length;i+=4){
      if(!data[i+3])continue;
      // Preserve photographed surface detail while mapping all colors to the material ramp.
      const x=(i/4)%260,y=Math.floor(i/4/260),light=1+(260-x-y)/260*.08;
      const luminance=clamp((data[i]*.2126+data[i+1]*.7152+data[i+2]*.0722)/255*exposure*light,0,.9999);
      const position=luminance*3,step=Math.floor(position),fraction=position-step;
      const incandescent=ember&&data[i]>100&&data[i]>data[i+1]*1.45;
      for(let channel=0;channel<3;channel++)data[i+channel]=incandescent?ember[channel]*(.64+luminance*.36):ramp[step][channel]+(ramp[step+1][channel]-ramp[step][channel])*fraction;
    }
    b.putImageData(pixels,0,0);
    if(stage===3){c.drawImage(body,0,0);return out;}
    // Shadows use the actual silhouette, including fronds, antennae and tracks.
    c.drawImage(body,0,0);c.globalCompositeOperation='source-in';c.fillStyle=foliage?'rgba(3,12,15,.42)':'rgba(3,10,16,.48)';c.fillRect(0,0,260,260);
    c.globalCompositeOperation='source-over';
    const shadow=canvas(260,260),shadowContext=shadow.getContext('2d');shadowContext.drawImage(out,0,0);c.clearRect(0,0,260,260);
    c.filter=foliage?'blur(3px)':'blur(2px)';c.drawImage(shadow,10,foliage?19:13);c.filter='none';
    c.drawImage(body,0,0);
    // Small, stable weathering variations avoid five identical silhouettes at flight speed.
    if(structureIndex>=0){
      c.globalCompositeOperation='source-atop';c.globalAlpha=.055;
      for(let i=0;i<32;i++){c.fillStyle=i%2?this.palette.high:this.palette.low;c.fillRect(70+rng()*120,70+rng()*120,1+rng()*5,1+rng()*3);}
      c.globalAlpha=1;c.globalCompositeOperation='source-over';
    }
    return out;
  }
  spriteTree(c,rng,alien=false) {
    const dark=alien?'#203947':'#143d30',mid=alien?'#416b69':'#2e6342',light=alien?'#709885':'#65945a';
    line(c,[[0,30],[-3,-13],[12,-38]],alien?'#665066':'#645243',12);
    for(let i=0;i<12;i++) {const a=i/12*TAU+rng()*.3,r=20+rng()*34,x=Math.cos(a)*r,y=Math.sin(a)*r*.8-10;line(c,[[0,0],[x,y]],'#394c3b',4);blob(c,x+5,y+10,29,24,dark,rng,13);blob(c,x,y,28,22,mid,rng,13);blob(c,x-6,y-6,19,14,light,rng,13);for(let k=0;k<7;k++){ellipse(c,x+(rng()-.5)*35,y+(rng()-.5)*25,3+rng()*4,2,'rgba(197,223,153,.14)');}}
    for(let i=0;i<5;i++) {const x=(rng()-.5)*60,y=(rng()-.5)*50;line(c,[[x,y],[x+5,y+18],[x-3,y+26]],alien?'#83ceb0':'#73955a',1.3);}
    if(alien){for(let i=0;i<11;i++){const a=rng()*TAU,r=rng()*50,x=Math.cos(a)*r,y=Math.sin(a)*r;circle(c,x,y,2,'#a6f3c3');}}
  }
  spritePalm(c,rng) {
    line(c,[[8,45],[4,15],[-6,-10]],'#494f3a',12);line(c,[[5,41],[0,14],[-9,-10]],'#a38e59',6);
    for(let k=0;k<6;k++)line(c,[[0,k*7+2],[7,k*7+3]],'#5f6540',2);
    for(let i=0;i<9;i++) {
      const a=i/9*TAU+rng()*.3,len=48+rng()*27;const dx=Math.cos(a),dy=Math.sin(a)*.72;
      const tip=[-6+dx*len,-10+dy*len+8];
      polygon(c,[[-6,-10],[-6+dx*len*.45-dy*14,-10+dy*len*.45+dx*14],tip,[-6+dx*len*.45+dy*12,-10+dy*len*.45-dx*12]],i%2?'#4d8150':'#356b42');
      line(c,[[-6,-10],[-6+dx*len*.5,-10+dy*len*.5],tip],'#8caf67',1.8);
      for(let k=1;k<7;k++){const f=k/8,bx=-6+dx*len*f,by=-10+dy*len*f;const w=Math.sin(f*Math.PI)*12;line(c,[[bx-dy*w,by+dx*w],[bx,by],[bx+dy*w,by-dx*w]],'rgba(12,58,35,.38)',1.2);}
    }
    circle(c,-5,-10,8,'#62784c');circle(c,-4,-8,3,'#b3ad65');
  }
  spritePine(c,rng) {
    line(c,[[0,38],[0,-40]],'#4b606a',9);
    for(let tier=0;tier<4;tier++) {
      const r=55-tier*11,y=18-tier*14;
      const pts=[];for(let i=0;i<12;i++){const a=i/12*TAU;pts.push([Math.cos(a)*r*(i%2?.64:1),y+Math.sin(a)*r*.55]);}
      polygon(c,pts,'#476b74');polygon(c,pts.map(([x,py])=>[x*.91,py-7]),tier%2?'#bed7d7':'#d4e5df');
      line(c,[[-r*.66,y-8],[0,y-r*.35],[r*.6,y-9]],'#eff6e8',2.5);
    }
    circle(c,-3,-37,5,'#edf5ed');
  }
  spriteFern(c,rng) {
    for(let i=0;i<12;i++){const a=i/12*TAU,len=30+rng()*32;const dx=Math.cos(a),dy=Math.sin(a)*.75;line(c,[[0,0],[dx*len,dy*len]],'#86a360',1.8);for(let n=1;n<7;n++){const f=n/7,x=dx*len*f,y=dy*len*f,w=(1-f)*17+2;polygon(c,[[x,y],[x-dy*w-dx*6,y+dx*w-dy*6],[x+dx*5,y+dy*5]],'#477349');polygon(c,[[x,y],[x+dy*w-dx*6,y-dx*w-dy*6],[x+dx*5,y+dy*5]],'#649355');}}
    circle(c,0,0,6,'#729c52');
  }
  spriteCactus(c,rng) {
    ellipse(c,8,14,34,17,'rgba(58,55,36,.28)');
    const g=c.createLinearGradient(-17,0,16,0);g.addColorStop(0,'#69805b');g.addColorStop(.4,'#8d9961');g.addColorStop(1,'#46614a');
    c.strokeStyle='#46674f';c.lineWidth=18;c.beginPath();c.moveTo(-4,2);c.lineTo(-31,-8);c.lineTo(-32,-31);c.stroke();
    c.strokeStyle='#879967';c.lineWidth=10;c.beginPath();c.moveTo(-6,-2);c.lineTo(-32,-12);c.lineTo(-33,-32);c.stroke();
    c.strokeStyle='#45644c';c.lineWidth=17;c.beginPath();c.moveTo(4,-13);c.lineTo(29,-23);c.lineTo(29,-45);c.stroke();
    c.strokeStyle='#799160';c.lineWidth=9;c.beginPath();c.moveTo(4,-17);c.lineTo(26,-26);c.lineTo(26,-45);c.stroke();
    c.fillStyle=g;c.beginPath();c.roundRect(-14,-63,29,82,14);c.fill();
    line(c,[[-5,-57],[-6,12]],'#b0b27a',2);line(c,[[5,-57],[5,12]],'#4b6d4d',2);
    for(let i=0;i<12;i++){const x=(rng()-.5)*21,y=-48+rng()*57;line(c,[[x-2,y-2],[x+1,y+1]],'#d8c999',.8);}
    circle(c,-2,-63,5,'#d49889');circle(c,-4,-65,2,'#f2caa3');
  }
  spriteMushroom(c,rng,pod=false) {
    for(let n=0;n<(pod?3:4);n++) {
      const x=(rng()-.5)*65,y=(rng()-.5)*55,r=pod?19+rng()*12:17+rng()*27;
      line(c,[[x,y+23],[x-5,y-2]],'#776f8c',10);line(c,[[x-3,y+23],[x-8,y]],'#afa0ba',3);
      const g=c.createRadialGradient(x-r*.3,y-r*.3,1,x,y,r);g.addColorStop(0,pod?'#9bd8be':'#b391c7');g.addColorStop(.55,pod?'#568e88':'#795b9f');g.addColorStop(1,pod?'#325766':'#3f3f70');
      ellipse(c,x,y+6,r,r*.7,'#20364c');ellipse(c,x,y,r,r*.7,g);line(c,[[x-r*.7,y+4],[x,y+r*.55],[x+r*.7,y+4]],'#7bd9bf',2);
      for(let k=0;k<6;k++){const a=rng()*TAU,d=rng()*r*.7;circle(c,x+Math.cos(a)*d,y+Math.sin(a)*d*.6,1+rng()*2.5,pod?'#b5f7d6':'#dab6e1');}
    }
  }
  spriteCrystal(c,rng,ice=false) {
    const colors=ice?['#b3dfe6','#e4f4eb','#689fb8']:this.index===6?['#bf654e','#ffb17c','#653c44']:['#82a8c5','#c6c0f3','#514d88'];
    for(let i=0;i<7;i++) {
      const x=(rng()-.5)*66,y=(rng()-.5)*52,h=30+rng()*45,w=10+rng()*17;
      polygon(c,[[x-w,y],[x-w*.8,y-h*.7],[x,y-h],[x+w,y-h*.62],[x+w*.85,y],[x,y+10]],colors[0],colors[2],1);
      polygon(c,[[x-w*.8,y-h*.7],[x,y-h],[x,y+7],[x-w,y]],colors[1]);
      polygon(c,[[x,y-h],[x+w,y-h*.62],[x+w*.85,y],[x,y+7]],colors[2]);
      line(c,[[x-w*.8,y-h*.7],[x,y-h],[x+w,y-h*.62]],ice?'#f0fffa':'#c9e7ff',1.5);
      line(c,[[x,y-h+4],[x,y+2]],'rgba(226,255,254,.6)',1);
    }
    glow(c,0,-10,65,ice?'#a4edff':this.world.color,.14);
  }
  spriteRock(c,rng,type) {
    const p=this.palette;const space=type==='asteroid';
    const low=space?'#242435':p.low,mid=space?'#58505d':p.mid,high=space?'#84767c':p.high;
    const pts=[];for(let i=0;i<11;i++){const a=i/11*TAU,r=40+rng()*18;pts.push([Math.cos(a)*r,Math.sin(a)*r*.75]);}
    polygon(c,pts.map(([x,y])=>[x+8,y+12]),low);polygon(c,pts,mid);
    for(let i=0;i<pts.length;i++){const next=(i+1)%pts.length;polygon(c,[pts[i],pts[next],[-9,-12]],i<5?low:high);}
    c.globalAlpha=.36;polygon(c,pts,mid);c.globalAlpha=1;
    line(c,pts.slice(6,11),high,2.5);
    for(let i=0;i<5;i++){const x=(rng()-.5)*60,y=(rng()-.5)*40,r=4+rng()*9;ellipse(c,x,y,r,r*.68,low);line(c,[[x-r*.6,y+2],[x,y+r*.65],[x+r*.7,y+1]],high,1.1);}
    if(type==='basalt'||type==='vent') {line(c,[[-27,-15],[-8,-4],[-14,13],[7,23]],'#bd6345',1.5);if(type==='vent'){ellipse(c,0,-7,17,11,'#211c28');ellipse(c,0,-7,12,7,'#d86534');ellipse(c,0,-8,7,4,'#ffbd68');glow(c,0,-7,60,'#ff773c',.35);}}
    if(space){for(let i=0;i<5;i++){const x=(rng()-.5)*60,y=(rng()-.5)*40;line(c,[[x-2,y],[x+2,y-3],[x+5,y]],'#a393b8',1);}}
  }
  spriteCoral(c,rng) {
    for(let n=0;n<6;n++) {const x=(rng()-.5)*65,y=(rng()-.5)*45,color=['#b68e9e','#719eaa','#c1aa95'][n%3];for(let k=0;k<4;k++){const a=-Math.PI+.5+k*.7;const px=x+Math.cos(a)*22,py=y+Math.sin(a)*27;line(c,[[x,y+11],[x,y],[px,py]],color,4);line(c,[[px,py],[px-6,py-7]],color,2.5);line(c,[[px,py],[px+4,py-8]],color,2.5);circle(c,px,py,2,'#d8c5b7');}}
  }
  spriteStructure(c,rng,type,variant) {
    const p=this.palette,neon=this.index===7,alien=this.index===8,voidWorld=this.index===9;
    const panel=neon?'#42445f':this.index===1?'#b2c5c9':this.index===2?'#a99068':this.index===5?'#ab9790':voidWorld?'#514554':alien?'#737183':'#74817d';
    const dark=neon?'#20283c':voidWorld?'#292431':'#384c53';
    const accent=this.palette.shore;
    if(type==='temple'||type==='ruin') {
      const sand=this.index===2;
      for(let i=0;i<4;i++){const r=59-i*10,y=16-i*5;polygon(c,[[-r,-r*.55+y],[r,-r*.55+y],[r,r*.55+y],[-r,r*.55+y]],sand?['#79654c','#ad956c','#c8ac7d','#dbbf8b'][i]:['#34494a','#506966','#77867a','#94a08b'][i],sand?'#564b3c':'#263e3e',2);for(let j=0;j<4;j++)line(c,[[-r+j*r*.5,y+r*.55],[-r+j*r*.5,y-r*.55]],'rgba(25,42,42,.3)',1);}
      polygon(c,[[-20,-23],[20,-23],[20,13],[-20,13]],'#2b4043','#b2b395',2);
      polygon(c,[[-11,-19],[11,-19],[11,5],[-11,5]],'#172d33');
      for(let i=0;i<5;i++){c.fillStyle=sand?'#c5ad7e':'#698871';c.fillRect(-8,15+i*5,16+i*5,3);}
      for(let i=0;i<7;i++){const x=(rng()-.5)*105,y=(rng()-.5)*65;blob(c,x,y,5+rng()*8,4+rng()*6,sand?'#bba270':'#577359',rng,6);}
      if(alien||voidWorld){line(c,[[-28,-10],[-28,-23],[0,-37],[28,-23],[28,-10]],accent,2);glow(c,0,-12,40,this.world.color,.17);}
      return;
    }
    if(type==='solar'||type==='satellite') {
      line(c,[[-65,0],[65,0]],'#9caaa7',5);
      for(const side of [-1,1]){const x=side<0?-71:27;polygon(c,[[x,-36],[x+45,-36],[x+45,33],[x,33]],'#274e68','#9bafa8',2);for(let col=0;col<3;col++)for(let row=0;row<5;row++){c.fillStyle=(col+row)%3===0?'#376789':'#244a6a';c.fillRect(x+3+col*14,-33+row*13,11,10);line(c,[[x+3+col*14,-32+row*13],[x+12+col*14,-32+row*13]],'#578ba0',.8);}}
      polygon(c,[[-19,-38],[17,-38],[22,33],[-20,33]],panel,dark,3);line(c,[[-12,-29],[10,-29]],'#d1d8cf',3);circle(c,0,4,12,dark);circle(c,-2,2,8,'#83b2b5');line(c,[[0,-40],[0,-70]],'#8aa5a7',2);circle(c,0,-71,3,accent);return;
    }
    if(type==='dome') {
      ellipse(c,0,15,60,40,dark);ellipse(c,-3,6,57,39,panel);
      const g=c.createRadialGradient(-22,-19,1,0,0,52);g.addColorStop(0,'#d4e3db');g.addColorStop(.35,'#86b5bb');g.addColorStop(1,'#355e76');
      ellipse(c,0,-3,49,37,g);c.save();c.beginPath();c.ellipse(0,-3,49,37,0,0,TAU);c.clip();for(let i=-2;i<3;i++){c.strokeStyle='rgba(219,232,211,.45)';c.lineWidth=2;c.beginPath();c.ellipse(i*20,-3,26,38,0,0,TAU);c.stroke();}line(c,[[-55,-10],[55,-10]],'rgba(219,232,211,.4)',2);line(c,[[-55,10],[55,10]],'rgba(219,232,211,.4)',2);c.restore();c.fillStyle=panel;c.fillRect(-12,25,24,23);c.fillStyle=dark;c.fillRect(-8,31,16,15);line(c,[[-8,31],[8,31]],accent,2);return;
    }
    if(type==='hut') {
      for(const x of [-35,35])line(c,[[x,-15],[x,52]],'#526b64',7);
      polygon(c,[[-51,-27],[10,-51],[52,-24],[51,32],[-52,32]],'#495c50');
      polygon(c,[[-57,-25],[0,-58],[57,-25],[0,5]],'#a39c70');polygon(c,[[-57,-25],[0,5],[0,36],[-57,6]],'#847f5d');polygon(c,[[0,5],[57,-25],[57,6],[0,36]],'#555f4c');
      for(let i=0;i<10;i++)line(c,[[-51+i*5,-23-i*2.5],[-i*.6,6-i*5]],'#b3ad7c',1);return;
    }
    const tall=['tower','pylon','fortress','building','refinery'].includes(type);
    const w=type==='tower'?27:type==='pylon'?28:type==='fortress'?67:48;
    const h=tall?50:33, lift=tall?30:12;
    polygon(c,[[-w,-h],[w,-h],[w+8,h+12],[-w+8,h+12]],dark,'#233741',3);
    polygon(c,[[w,-h-lift],[w+8,-h+12],[w+8,h+12],[w,h-lift]],neon?'#222b43':'#405359');
    polygon(c,[[-w,h-lift],[w,h-lift],[w+8,h+12],[-w+8,h+12]],neon?'#303249':'#4f6060');
    polygon(c,[[-w,-h-lift],[w,-h-lift],[w,h-lift],[-w,h-lift]],panel,dark,3);
    line(c,[[-w,-h-lift],[w,-h-lift]],neon?'#8b759e':'#c2c9b7',2);
    line(c,[[-w,-h-lift],[-w,h-lift]],neon?'#796d99':'#a0b3a5',2);
    if(type==='building'||type==='tower'||type==='fortress'||type==='pylon') {
      const rim=voidWorld?'#b282a2':neon?(variant%2?'#b972c6':'#64b7c4'):'#88a19d';
      c.fillStyle=dark;c.fillRect(-w+9,-h-lift+10,w*2-18,h*2-20);c.strokeStyle=rim;c.lineWidth=1;c.strokeRect(-w+8,-h-lift+9,w*2-16,h*2-18);
      for(let j=0;j<3;j++){const y=h-lift+7+j*5;line(c,[[-w+10,y],[w-6,y]],j===1?rim:'rgba(5,15,25,.5)',1.5);}
      for(let k=0;k<3;k++){c.fillStyle='#4e5267';c.fillRect(-w+15,-h-lift+17+k*19,Math.max(12,w*2-30),12);line(c,[[-w+18,-h-lift+21+k*19],[w-16,-h-lift+21+k*19]],'#7f7c91',1);}
      if(type==='pylon'||type==='tower'){polygon(c,[[0,-h-lift-24],[16,-h-lift+14],[0,-h-lift+38],[-16,-h-lift+14]],voidWorld?'#db9eaf':'#9cd5e0',rim,2);glow(c,0,-h-lift+10,56,this.world.color,.22);}
      if(neon){c.save();c.translate(w+2,-20);c.rotate(Math.PI/2);c.fillStyle='#713775';c.fillRect(-18,-5,38,13);c.fillStyle='#d8a0ed';for(let j=0;j<4;j++)c.fillRect(-13+j*8,-2,4,7);c.restore();}
    } else {
      c.fillStyle=dark;c.fillRect(-w+9,-h-lift+8,w*2-18,13);for(let i=0;i<8;i++)line(c,[[-w+13+i*8,-h-lift+10],[-w+13+i*8,-h-lift+19]],'#7c908d',1);
      c.fillStyle='#435c60';c.fillRect(-28,-5-lift,53,26);line(c,[[-26,-5-lift],[23,-5-lift]],'#9aad9e',2);
      for(let i=0;i<3;i++){c.fillStyle='#90aaa8';c.fillRect(-19+i*15,3-lift,8,7);}
    }
    for(const x of [-w+5,w-5])for(const y of [-h-lift+5,h-lift-5]){circle(c,x,y,2,'#c1c4b0');circle(c,x+.6,y+.6,.8,dark);}
    if(type==='radar') {
      line(c,[[3,11],[3,-35]],'#637d7f',6);c.save();c.translate(0,-29);c.rotate(-.43);const g=c.createLinearGradient(-27,0,27,0);g.addColorStop(0,'#d5e1d5');g.addColorStop(1,'#728f93');ellipse(c,0,0,28,17,g);c.strokeStyle='#486570';c.lineWidth=1;for(let k=-1;k<2;k++){c.beginPath();c.ellipse(k*9,0,10,16,0,0,TAU);c.stroke();}line(c,[[-26,0],[26,0]],'#486570',1);line(c,[[0,0],[0,-23]],'#bacabc',2);circle(c,0,-23,3,accent);c.restore();
    }
    if(type==='refinery'){for(let i=0;i<2;i++){const x=-25+i*44;ellipse(c,x,-26,15,14,'#5c6869');c.fillStyle='#424b51';c.fillRect(x-14,-50,28,23);ellipse(c,x,-50,14,9,'#7e8580');ellipse(c,x,-51,10,6,'#26323c');circle(c,x,-51,5,'#b46c50');}line(c,[[-34,18],[34,18]],'#c6a569',3);}
    // Lit warning strips and access panels make scenery readable at flight speed.
    for(let i=0;i<5;i++)line(c,[[-17+i*7,h-lift-3],[-13+i*7,h-lift-7]],i%2?'#d0b478':'#3a464a',2);
    circle(c,w-10,-h-lift+12,2.5,accent);circle(c,w-10,-h-lift+20,1.5,'#cc937f');
  }
  drawScorch(c,x,y,size) {
    const r=size*.66;c.drawImage(this.scorchSprite,x-r,y-r,r*2,r*2);
  }
  makeLight() {
    const out=canvas(128,128),c=out.getContext('2d');glow(c,64,64,64,this.world.accent,1);return out;
  }
  makeScorch() {
    const out=canvas(160,160),c=out.getContext('2d'),rng=random(61821+this.index);
    const g=c.createRadialGradient(80,80,8,80,80,77);g.addColorStop(0,'rgba(6,11,18,.72)');g.addColorStop(.5,'rgba(10,17,24,.45)');g.addColorStop(1,'transparent');ellipse(c,80,80,77,53,g);
    for(let i=0;i<15;i++){const a=rng()*TAU,d=rng()*50;c.fillStyle=i%3?'#394347':'#5c5c55';c.fillRect(80+Math.cos(a)*d,80+Math.sin(a)*d*.65,2+rng()*6,2+rng()*5);}return out;
  }
  makeShaft() {
    const out=canvas(256,512),c=out.getContext('2d'),g=c.createLinearGradient(0,0,160,512);
    g.addColorStop(0,this.world.accent);g.addColorStop(1,'transparent');polygon(c,[[0,0],[32,0],[256,512],[120,512]],g);return out;
  }
  makeVignette() {
    const out=canvas(256,1),c=out.getContext('2d'),g=c.createLinearGradient(0,0,256,0);
    g.addColorStop(0,'rgba(3,9,22,.34)');g.addColorStop(.22,'transparent');g.addColorStop(.78,'transparent');g.addColorStop(1,'rgba(3,9,22,.34)');c.fillStyle=g;c.fillRect(0,0,256,1);return out;
  }
  makeCloud() {
    const out=canvas(480,320),c=out.getContext('2d'),rng=random(777+this.index);
    const source=spriteCell('nature',15);
    if(source){
      const scale=Math.min(450/source.width,290/source.height),w=source.width*scale,h=source.height*scale;
      c.drawImage(source,(480-w)*.5,(320-h)*.5,w,h);
      const pixels=c.getImageData(0,0,480,320),data=pixels.data,fog=rgb(this.palette.fog);
      for(let i=0;i<data.length;i+=4){
        if(!data[i+3])continue;
        const light=.38+(data[i]*.2126+data[i+1]*.7152+data[i+2]*.0722)/255*.62;
        for(let channel=0;channel<3;channel++)data[i+channel]=fog[channel]*light;
      }
      c.putImageData(pixels,0,0);
      return out;
    }
    for(let i=0;i<16;i++){const x=100+rng()*280,y=95+rng()*130,r=55+rng()*65;const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,this.palette.fog);g.addColorStop(.45,this.palette.fog+'88');g.addColorStop(1,'transparent');c.globalAlpha=.2;circle(c,x,y,r,g);}return out;
  }
  drawAtmosphere(c,h,scroll,time,quality) {
    const space=this.index===4||this.index===9;
    if(quality!=='low') {
      for(let i=0;i<this.clouds.length;i++){
        const cloud=this.clouds[i],period=h+650;
        const y=((cloud.y+scroll*PARALLAX_LAYERS[1].speed) % period+period)%period-325;
        const x=cloud.x+Math.sin(time*.05+cloud.phase)*100;
        c.globalAlpha=space?.07:this.index===1?.15:this.index===3?.17:this.index===6?.12:.1;
        c.drawImage(this.cloudSprite,x-cloud.r,y-cloud.r*.67,cloud.r*2,cloud.r*1.34);
      }
      c.globalAlpha=1;
    }
    const count=quality==='low'?13:this.index===1?75:this.index===7?70:38;
    for(let i=0;i<count;i++) {
      const depth=.3+(i%7)*.13;
      const x=((i*191.7+Math.sin(time*.2+i)*18+(this.index===2||this.index===5?time*55:0))%WIDTH+WIDTH)%WIDTH;
      const y=((i*149.31+scroll*PARALLAX_LAYERS[1].speed+time*(this.index===1?18:4))%(h+40)+h+40)%(h+40)-20;
      if(this.index===7){line(c,[[x,y],[x-4,y+17]],'rgba(162,189,220,.17)',.8);continue;}
      if(this.index===2||this.index===5){line(c,[[x,y],[x+6+depth*8,y+1]],'rgba(238,194,145,.2)',.7);continue;}
      const color=this.index===1?'#e4f6f2':this.index===6?'#ffa26e':this.index===8?'#a9ffd3':space?'#c6c1e6':'#acdabb';
      c.globalAlpha=this.index===1?.25+depth*.28:this.index===6?.15+Math.sin(time+i)*.12:.16+Math.sin(time*.8+i)*.1;
      circle(c,x,y,(space?.6:1)*depth,color);
      if(this.index===6&&i%4===0)line(c,[[x,y],[x-1,y+5]],color,.7);
    }
    c.globalAlpha=1;
    if(this.index===0||this.index===3||this.index===8) {
      // Slow, soft sun shafts sit above the canopy and behind combat effects.
      c.save();c.globalCompositeOperation='screen';c.globalAlpha=.023;
      for(let i=0;i<3;i++){const x=100+i*390+Math.sin(time*.03+i)*60;c.drawImage(this.shaftSprite,x-24,0,384,h);}
      c.restore();
    }
  }
}
