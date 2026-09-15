/** TYRAN — original terrain paintings, destructible scenery and procedural fallback. */
export const WORLDS = [
  { id: 'jungle', name: 'EMERALD FRONTIER', subtitle: '01 / THE LIVING CANOPY', description: 'Ancient temples disappear beneath a vast emerald rainforest.', color: '#67f0b1', accent: '#b7ffcc', enemyColor: '#f05245', bossName: 'CANOPY DEVOURER' },
  { id: 'snow', name: 'POLAR SILENCE', subtitle: '02 / FROZEN SIGNAL', description: 'Glacial rivers cut through snowbound forests and abandoned outposts.', color: '#8bddff', accent: '#e3f8ff', enemyColor: '#ff3f9e', bossName: 'FROST COLOSSUS' },
  { id: 'desert', name: 'SUNKEN EMPIRE', subtitle: '03 / SANDS OF THE ANCIENTS', description: 'Cross golden dunes, ruined monuments and a forgotten empire.', color: '#ffc578', accent: '#ffe0a4', enemyColor: '#39e8ff', bossName: 'DUNE LEVIATHAN' },
  { id: 'paradise', name: 'AZURE ARCHIPELAGO', subtitle: '04 / TROUBLE IN PARADISE', description: 'Turquoise shallows, coral gardens and islands beneath drifting clouds.', color: '#51e5ed', accent: '#c1fff2', enemyColor: '#ff6338', bossName: 'CORAL DREADNOUGHT' },
  { id: 'asteroid', name: 'SHATTERED ORBIT', subtitle: '05 / THE MINING BELT', description: 'Navigate glittering debris fields and the wreckage of orbital industry.', color: '#b1a5ff', accent: '#e5ddff', enemyColor: '#74ed63', bossName: 'ORBITAL CRUSHER' },
  { id: 'mars', name: 'RED HORIZON', subtitle: '06 / THE LOST COLONY', description: 'Dust storms sweep ochre canyons and silent colony domes.', color: '#ff957a', accent: '#ffd0a1', enemyColor: '#45f0cf', bossName: 'MARTIAN SIEGEBREAKER' },
  { id: 'volcanic', name: 'INFERNO FOUNDRY', subtitle: '07 / INTO THE CALDERA', description: 'Rivers of molten rock feed a war machine buried in black basalt.', color: '#ff8055', accent: '#ffd28a', enemyColor: '#69cfff', bossName: 'MAGMA TITAN' },
  { id: 'neon', name: 'NEON AFTERLIFE', subtitle: '08 / CITY OF MACHINES', description: 'Rain-slick avenues and holographic towers pulse beneath your wings.', color: '#f080ff', accent: '#8ff4ff', enemyColor: '#f4ff52', bossName: 'METROPOLIS PRIME' },
  { id: 'alien', name: 'LUMINOUS GARDEN', subtitle: '09 / A WORLD THAT DREAMS', description: 'Bioluminescent forests grow around crystals and impossible ruins.', color: '#c895ff', accent: '#6fffe0', enemyColor: '#c7ff57', bossName: 'THE BLOOM SOVEREIGN' },
  { id: 'void', name: 'OBSIDIAN CITADEL', subtitle: '10 / THE LAST LIGHT', description: 'The final fortress hangs over an abyss of shattered stars.', color: '#ffa6c8', accent: '#ffe0ee', enemyColor: '#ffc94f', bossName: 'TYRAN, WORLD ENDER' },
];

const TILE = 1024;
const WIDTH = 1200;
const SECTION = 1792;
const BLEND = 128;
const PAD = 180;
const HIT_CELL = 160;
const TAU = Math.PI * 2;
const TERRAIN_ART = new Map();
// Art is loaded once, lazily; cached pixels also keep scenery off water/lava.
function loadTerrain(index) {
  if (TERRAIN_ART.has(index)) return TERRAIN_ART.get(index);
  const art = { ready:false, image:null, pixels:null, height:1800 };
  TERRAIN_ART.set(index,art);
  if (typeof Image === 'undefined') return art;
  const img = new Image();
  art.image=img;
  art.promise=new Promise(resolve=>{
    img.onload=()=>{
      art.height=WIDTH*img.naturalHeight/img.naturalWidth;
      const sample=canvas(128,192),ctx=sample.getContext('2d',{willReadFrequently:true});
      ctx.drawImage(img,0,0,128,192);
      try { art.pixels=ctx.getImageData(0,0,128,192).data; } catch { /* Art still draws if a host changes CORS. */ }
      art.ready=true;resolve(true);
    };
    img.onerror=()=>resolve(false);
    img.src=new URL(`./assets/world-${WORLDS[index].id}.webp`,import.meta.url).href;
  });
  return art;
}
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
function canvas(w,h) { const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w,h) : document.createElement('canvas'); c.width=w; c.height=h; return c; }
function circle(c,x,y,r,color) { c.fillStyle=color; c.beginPath(); c.arc(x,y,r,0,TAU); c.fill(); }
function ellipse(c,x,y,rx,ry,color) { c.fillStyle=color; c.beginPath(); c.ellipse(x,y,rx,ry,0,0,TAU); c.fill(); }
function polygon(c,points,fill,stroke=null,width=1) { c.beginPath(); points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y)); c.closePath(); if(fill){c.fillStyle=fill;c.fill();} if(stroke){c.strokeStyle=stroke;c.lineWidth=width;c.stroke();} }
function line(c,pts,color,width=1) { c.beginPath();pts.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.strokeStyle=color;c.lineWidth=width;c.stroke(); }
function glow(c,x,y,r,color,alpha=0.3) { const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,color);g.addColorStop(1,'transparent');c.globalAlpha=alpha;circle(c,x,y,r,g);c.globalAlpha=1; }
function blob(c,x,y,rx,ry,fill,rng,detail=16) { const p=[]; for(let i=0;i<detail;i++){const a=i/detail*TAU;const d=.77+rng()*.23;p.push([x+Math.cos(a)*rx*d,y+Math.sin(a)*ry*d]);} polygon(c,p,fill);return p; }
function laneX(y,index) { return 600 + Math.sin(y/510+index*1.7)*175+Math.sin(y/1180+index)*130; }
const STRUCTURES = new Set(['temple','bunker','station','radar','dome','solar','refinery','building','tower','pylon','fortress','hut','satellite']);
const EMISSIVE = new Set(['crystal','pylon','mushroom','radar','tower','vent']);
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

/** Procedural tile cache, destructible scenery and three atmospheric depth planes. */
export class WorldRenderer {
  constructor() {
    this.tiles=new Map();this.bands=new Map();this.sprites=new Map();this.sections=new Map();
    this.sceneryLayers=new Map();this.hitBuckets=new Map();this.visibleProps=[];this.destroyed=new Set();
    this.setWorld(0);
  }
  setWorld(index) {
    this.warmEpoch=(this.warmEpoch||0)+1;this.warmJobs=[];this.warmKeys=new Set();this.warmPending=false;
    this.index=((index%WORLDS.length)+WORLDS.length)%WORLDS.length;
    this.world=WORLDS[this.index];this.palette=PALETTES[this.index];
    this.art=loadTerrain(this.index);this.artActive=false;
    if(this.index+1<WORLDS.length)loadTerrain(this.index+1);
    this.tiles.clear();this.bands.clear();this.sprites.clear();this.sections.clear();this.sceneryLayers.clear();this.hitBuckets.clear();this.destroyed.clear();this.visibleProps.length=0;
    this.scale=1;this.scroll=0;this.clouds=[];this.lastPrune=null;
    const rng=random(this.index*19081+708);
    for(let i=0;i<7;i++)this.clouds.push({x:rng()*WIDTH,y:rng()*1500,r:180+rng()*180,speed:.12+rng()*.16,phase:rng()*TAU});
    this.cloudSprite=this.makeCloud();this.lightSprite=this.makeLight();this.scorchSprite=this.makeScorch();
    this.shaftSprite=this.makeShaft();this.vignetteSprite=this.makeVignette();
    const epoch=this.warmEpoch;
    this.art.promise?.then(()=>{
      if(epoch!==this.warmEpoch||!this.art.ready)return;
      const types=new Set([...this.palette.props,...DISTRICTS[this.index].flat()]);
      for(const type of types)for(let variant=0;variant<5;variant++)this.queueWarm(`sprite:${type}:${variant}`,()=>this.getSprite(type,variant));
      this.warmNearby(-1,2);
    });
  }
  queueWarm(key,work) {
    if(typeof requestIdleCallback!=='function'||this.warmKeys.has(key))return;
    this.warmKeys.add(key);this.warmJobs.push({key,work});this.runWarmQueue();
  }
  runWarmQueue() {
    if(this.warmPending||!this.warmJobs.length||typeof requestIdleCallback!=='function')return;
    this.warmPending=true;const epoch=this.warmEpoch;
    requestIdleCallback(deadline=>{
      if(epoch!==this.warmEpoch)return;
      this.warmPending=false;
      // Never force background work into an already busy animation frame.
      const start=performance.now();
      while(this.warmJobs.length&&deadline.timeRemaining()>3&&performance.now()-start<4) {
        const job=this.warmJobs.shift();this.warmKeys.delete(job.key);job.work();
      }
      this.runWarmQueue();
    });
  }
  warmNearby(first,last) {
    if(!this.art.ready)return;
    for(let row=first-1;row<=last+1;row++) {
      if(!this.tiles.has(row))this.queueWarm(`tile:${row}`,()=>{if(!this.artActive){this.tiles.clear();this.artActive=true;}this.getArtTile(row);});
      if(!this.sceneryLayers.has(row))this.queueWarm(`scenery:${row}`,()=>this.getSceneryLayer(row,this.getBand(row)));
    }
  }
  draw(ctx,W,H,scroll,time,quality='high') {
    const s=W/WIDTH,h=H/s;this.scale=s;this.scroll=scroll;this.visibleProps.length=0;
    ctx.save();ctx.scale(s,s);
    const first=Math.floor(-scroll/TILE),last=Math.floor((h-scroll)/TILE);
    if(this.art.ready&&!this.artActive) {
      // Keep band identities and damage: the first decoded painting must never move scenery.
      this.tiles.clear();this.artActive=true;
    }
    for(let row=first;row<=last;row++)ctx.drawImage(this.artActive?this.getArtTile(row):this.getTile(row),0,row*TILE+scroll,WIDTH,TILE+.5);
    this.drawSurfaceMotion(ctx,h,scroll,time,quality);
    // The bulk of the scenery (including persistent scorch marks) is one cached draw per band.
    for(let row=first-1;row<=last+1;row++) {
      const band=this.getBand(row),y=row*TILE+scroll;
      if(y+TILE+PAD<0||y-PAD>h)continue;
      ctx.drawImage(this.getSceneryLayer(row,band),0,y-PAD);
      for(let i=0;i<band.length;i++) {
        const prop=band[i],py=prop.y+scroll;
        if(py < -PAD || py>h+PAD || this.destroyed.has(prop.id))continue;
        prop.screenY=py;this.visibleProps.push(prop);
        if(prop.emissive&&quality!=='low') {
          const radius=prop.size*.8;ctx.globalAlpha=.12+Math.sin(time*1.7+prop.variant*2)*.035;
          ctx.drawImage(this.lightSprite,prop.x-radius,py-radius,radius*2,radius*2);
        }
      }
    }
    ctx.globalAlpha=1;this.drawAtmosphere(ctx,h,scroll,time,quality);
    ctx.drawImage(this.vignetteSprite,0,0,WIDTH,h);ctx.restore();
    if(this.lastPrune!==first) {
      this.lastPrune=first;
      for(const key of this.tiles.keys())if(key<first-2||key>last+2)this.tiles.delete(key);
      for(const key of this.sceneryLayers.keys())if(key<first-2||key>last+2)this.sceneryLayers.delete(key);
      this.warmNearby(first,last);
    }
  }
  getSection(section) {
    if(this.sections.has(section))return this.sections.get(section);
    const rng=random((section*87317)^(this.index*19433+1927));
    const district=((section%4)+4)%4;
    const zoom=[1.06,1.4,1.2,1.58][(district+this.index)%4];
    const out={index:section,district,zoom,pan:rng(),offset:rng()*1350,flip:rng()>.5,center:230+rng()*740,phase:rng()*TAU};
    this.sections.set(section,out);return out;
  }
  paintSection(c,section,top) {
    const art=this.art,d=this.getSection(section),w=WIDTH*d.zoom,th=art.height*d.zoom;
    const offset=d.offset-section*SECTION,first=Math.floor((top+offset)/th),last=Math.floor((top+TILE+offset)/th);
    const x=-(w-WIDTH)*d.pan;
    for(let tile=first;tile<=last;tile++) {
      const mirror=(tile&1)!==0,y=tile*th-offset-top;
      c.save();c.translate(d.flip?WIDTH-x:x,mirror?y+th:y);c.scale(d.flip?-1:1,mirror?-1:1);
      c.drawImage(art.image,0,0,w,th+.7);c.restore();
    }
  }
  getArtTile(row) {
    if(this.tiles.has(row))return this.tiles.get(row);
    const out=canvas(WIDTH,TILE),c=out.getContext('2d'),top=row*TILE;
    const first=Math.floor((top-BLEND)/SECTION),last=Math.floor((top+TILE+BLEND)/SECTION);
    this.paintSection(c,first,top);
    if(first!==last) {
      this.artScratch??=canvas(WIDTH,TILE);
      const layer=this.artScratch,lc=layer.getContext('2d');
      for(let section=first+1;section<=last;section++) {
        lc.clearRect(0,0,WIDTH,TILE);this.paintSection(lc,section,top);
        const boundary=section*SECTION-top,g=lc.createLinearGradient(0,boundary-BLEND,0,boundary+BLEND);
        g.addColorStop(0,'transparent');g.addColorStop(1,'#000');
        lc.globalCompositeOperation='destination-in';lc.fillStyle=g;lc.fillRect(0,0,WIDTH,TILE);lc.globalCompositeOperation='source-over';
        c.drawImage(layer,0,0);
      }
    }
    c.fillStyle=this.index===1?'rgba(9,24,44,.20)':this.index===3?'rgba(3,29,42,.12)':this.index===2?'rgba(30,18,29,.13)':'rgba(5,13,26,.13)';
    c.fillRect(0,0,WIDTH,TILE);
    this.drawDistrictGround(c,row);
    this.tiles.set(row,out);return out;
  }
  terrainColor(x,y) {
    if(!this.art.ready||!this.art.pixels)return null;
    const d=this.getSection(Math.floor(y/SECTION)),w=WIDTH*d.zoom,height=this.art.height*d.zoom;
    const offset=d.offset-d.index*SECTION,gy=y+offset,row=Math.floor(gy/height);
    let v=gy/height-row;if(row&1)v=1-v;
    let u=(x+(w-WIDTH)*d.pan)/w;if(d.flip)u=(WIDTH-x+(w-WIDTH)*d.pan)/w;
    const sx=Math.max(0,Math.min(127,Math.floor(u*128))),sy=Math.max(0,Math.min(191,Math.floor(v*192)));
    const i=(sy*128+sx)*4,p=this.art.pixels;return [p[i],p[i+1],p[i+2]];
  }
  suitableSite(type,x,y) {
    const color=this.terrainColor(x,y);if(!color)return true;
    const [r,g,b]=color;
    if(this.index===0)return g>b*.93;
    if(this.index===3)return type==='coral'?b>r*1.12:(g>b*1.1||r>b*1.1);
    if(this.index===6)return r<g*1.7;
    if(this.index===8)return type==='crystal'||type==='mushroom'||g<b*1.15;
    return true;
  }
  /** Inputs and returned effects are in the same screen coordinates as draw(). */
  hit(x,y,radius,damage,scroll=this.scroll) {
    const s=this.scale||1;x/=s;y=y/s-scroll;radius/=s;const result=[],reach=radius+64;
    const x0=Math.max(0,Math.floor((x-reach)/HIT_CELL)),x1=Math.min(7,Math.floor((x+reach)/HIT_CELL));
    const y0=Math.floor((y-reach)/HIT_CELL),y1=Math.floor((y+reach)/HIT_CELL);
    for(let by=y0;by<=y1;by++)for(let bx=x0;bx<=x1;bx++) {
      const bucket=this.hitBuckets.get(by*8+bx);if(!bucket)continue;
      for(let i=0;i<bucket.length;i++) {
        const prop=bucket[i];if(this.destroyed.has(prop.id))continue;
        if((x-prop.x)**2+(y-prop.y)**2>(radius+prop.size*.32)**2)continue;
        const wasDamaged=prop.hp<prop.maxHp;prop.hp-=damage;
        if(prop.hp<=0) {
          this.destroyed.add(prop.id);this.sceneryLayers.delete(prop.row);
          result.push({x:prop.x*s,y:(prop.y+scroll)*s,size:prop.size*s,color:prop.color,value:prop.value});
        } else if(!wasDamaged)this.sceneryLayers.delete(prop.row);
      }
    }
    return result;
  }
  getSceneryLayer(row,band) {
    if(this.sceneryLayers.has(row))return this.sceneryLayers.get(row);
    const out=canvas(WIDTH,TILE+PAD*2),c=out.getContext('2d');
    for(const prop of band) {
      const y=prop.y-row*TILE+PAD,scale=prop.size/100;
      if(this.destroyed.has(prop.id)) {this.drawScorch(c,prop.x,y,prop.size);continue;}
      c.drawImage(this.getSprite(prop.type,prop.variant),prop.x-130*scale,y-130*scale,260*scale,260*scale);
      if(prop.hp<prop.maxHp)ellipse(c,prop.x+4,y+5,prop.size*.22,prop.size*.16,'rgba(36,28,37,.36)');
    }
    this.sceneryLayers.set(row,out);return out;
  }
  getTile(row) {
    if(this.tiles.has(row))return this.tiles.get(row);
    const out=canvas(WIDTH,TILE),c=out.getContext('2d');const rng=random((row*98713)^(this.index*45893+5234));const p=this.palette;
    c.fillStyle=p.base;c.fillRect(0,0,WIDTH,TILE);
    if(this.index===4||this.index===9)this.drawSpace(c,row,rng);
    else if(this.index===7)this.drawCity(c,row,rng);
    else {
      for(let i=0;i<55;i++) {
        const x=rng()*WIDTH,y=rng()*TILE,r=50+rng()*210;
        c.globalAlpha=.08+rng()*.12;
        blob(c,x,y,r,r*(.3+rng()),i%3===0?p.low:i%3===1?p.mid:p.high,rng,19);
      }
      c.globalAlpha=1;
      if(this.index===3)this.drawIslands(c,row,rng);
      else if(this.index===2)this.drawDunes(c,row,rng);
      else if(this.index===5)this.drawCanyons(c,row,rng);
      else this.drawRiver(c,row,rng);
      if(this.index===0||this.index===8)this.drawGroundCover(c,rng);
      if(this.index===1)this.drawSnowbanks(c,row,rng);
      if(this.index===6)this.drawFissures(c,row,rng);
    }
    // Fine, deterministic dither gives the terrain an illustrated, tactile finish.
    for(let i=0;i<9500;i++) {
      const x=rng()*WIDTH,y=rng()*TILE,size=.6+rng()*2.4;
      c.fillStyle=i%3===0?'rgba(231,244,227,.048)':'rgba(0,3,10,.072)';c.fillRect(x,y,size,size*.7);
    }
    this.tiles.set(row,out);return out;
  }
  drawRiver(c,row,rng) {
    const p=this.palette,index=this.index;const points=[];
    for(let y=-45;y<=TILE+45;y+=22)points.push([laneX(y+row*TILE,index),y]);
    c.lineJoin='round';c.lineCap='round';
    const width=index===6?108:index===8?145:170;
    line(c,points,p.low,width+43);line(c,points,p.shore,width+15);line(c,points,p.water,width);
    c.globalAlpha=.26;line(c,points,index===6?'#ffad52':p.low,width*.53);c.globalAlpha=1;
    if(index===6){c.globalAlpha=.36;line(c,points,'#ffb957',width*.14);c.globalAlpha=1;}
    for(let i=0;i<150;i++) {
      const y=rng()*TILE,gy=y+row*TILE,x=laneX(gy,index)+(rng()-.5)*width*.8;
      c.globalAlpha=index===6?.3:.1;
      line(c,[[x,y],[x+8+rng()*30,y+1]],index===6?'#ffe291':'#b4f3ec',.5+rng()*1.3);
    }
    c.globalAlpha=1;
    for(let i=0;i<30;i++) {
      const y=rng()*TILE,x=laneX(y+row*TILE,index)+(rng()>.5?1:-1)*(width*.6+rng()*70);
      c.globalAlpha=.3;blob(c,x,y,20+rng()*42,12+rng()*15,p.high,rng,10);c.globalAlpha=1;
    }
  }
  drawGroundCover(c,rng) {
    const alien=this.index===8,p=this.palette;
    for(let i=0;i<750;i++) {
      const x=rng()*WIDTH,y=rng()*TILE,r=3+rng()*15;
      c.globalAlpha=.13+rng()*.18;
      ellipse(c,x+2,y+3,r,r*.55,p.low);
      ellipse(c,x,y,r,r*.5,alien?(i%5===0?'#7e6091':'#446466'):(i%4===0?'#659052':'#386c46'));
      if(i%5===0)line(c,[[x-r*.5,y],[x,y-r*.25],[x+r*.6,y]],p.high,1);
    }
    c.globalAlpha=1;
    // Old causeways crossing the living landscape.
    for(let n=0;n<2;n++){
      const x=rng()*WIDTH,y=rng()*TILE;c.save();c.translate(x,y);c.rotate((rng()-.5)*1.4);
      c.fillStyle=alien?'#514c6b':'#456251';c.fillRect(-35,-100,70,200);
      for(let i=0;i<10;i++){c.fillStyle=i%2?'rgba(0,0,0,.14)':'rgba(210,239,205,.08)';c.fillRect(-33,-98+i*20,66,17);}
      c.restore();
    }
  }
  drawSnowbanks(c,row,rng) {
    const p=this.palette;
    for(let i=0;i<85;i++) {
      const x=rng()*WIDTH,y=rng()*TILE,r=18+rng()*90;
      c.globalAlpha=.36;blob(c,x+8,y+8,r,r*.54,'#416c86',rng,14);
      c.globalAlpha=.72;blob(c,x,y,r,r*.51,p.high,rng,14);
    }
    c.globalAlpha=1;
    for(let i=0;i<12;i++) {
      const x=rng()*WIDTH,y=rng()*TILE;const pts=[[x,y]];for(let k=1;k<6;k++)pts.push([x+k*9+(rng()-.5)*12,y+k*10]);
      line(c,pts,'rgba(57,102,128,.28)',1);
    }
    // Snow vehicle tracks.
    const pts=[];for(let y=-40;y<TILE+40;y+=18)pts.push([laneX(y+row*TILE,3)*.6+130,y]);
    c.setLineDash([5,5]);line(c,pts,'rgba(56,94,112,.18)',3);line(c,pts.map(([x,y])=>[x+15,y]),'rgba(56,94,112,.18)',3);c.setLineDash([]);
  }
  drawDunes(c,row,rng) {
    for(let n=-2;n<12;n++) {
      const baseY=n*130;const pts=[];
      for(let x=-50;x<=WIDTH+50;x+=25){const gy=baseY+Math.sin(x/330+n*.91)*100;pts.push([x,gy]);}
      const g=c.createLinearGradient(0,baseY-10,0,baseY+125);g.addColorStop(0,'rgba(255,220,157,.29)');g.addColorStop(.27,'rgba(228,177,108,.10)');g.addColorStop(1,'rgba(70,43,34,.28)');
      polygon(c,[...pts,[WIDTH+50,baseY+185],[-50,baseY+185]],g);
      line(c,pts,'rgba(255,222,160,.23)',2);
      for(let k=1;k<6;k++)line(c,pts.map(([x,y])=>[x,y+k*6]),'rgba(239,195,130,.045)',1);
    }
    for(let i=0;i<60;i++){const x=rng()*WIDTH,y=rng()*TILE;c.globalAlpha=.2;blob(c,x,y,7+rng()*30,4+rng()*15,'#4a3f34',rng,7);c.globalAlpha=1;}
    // Half-buried floor plans, carved into the dunes.
    for(let i=0;i<4;i++){const x=rng()*WIDTH,y=rng()*TILE;c.save();c.translate(x,y);c.rotate(-.24);c.strokeStyle='rgba(77,61,44,.35)';c.lineWidth=8;c.strokeRect(-65,-60,130,120);c.strokeRect(-41,-38,82,76);c.fillStyle='rgba(227,186,120,.3)';c.fillRect(-73,-70,150,8);c.restore();}
  }
  drawIslands(c,row,rng) {
    for(let i=0;i<18;i++) {
      const x=rng()*WIDTH,y=rng()*TILE,r=42+rng()*150,ry=r*(.4+rng()*.45);
      c.globalAlpha=.23;blob(c,x,y,r*1.55,ry*1.55,'#62dbca',rng,22);c.globalAlpha=1;
      blob(c,x,y,r*1.17,ry*1.16,'#45b6aa',rng,22);
      blob(c,x,y,r,ry,'#d6cba0',rng,22);
      blob(c,x-2,y-3,r*.76,ry*.72,'#54794e',rng,22);
      blob(c,x-6,y-7,r*.63,ry*.58,'#356546',rng,22);
      for(let k=0;k<12;k++){const px=x+(rng()-.5)*r,py=y+(rng()-.5)*ry;ellipse(c,px,py,5+rng()*15,3+rng()*8,'rgba(116,146,78,.45)');}
    }
    for(let i=0;i<170;i++){const x=rng()*WIDTH,y=rng()*TILE;line(c,[[x,y],[x+15+rng()*60,y-1]],'rgba(180,255,246,.075)',1+rng());}
    for(let i=0;i<38;i++) {const x=rng()*WIDTH,y=rng()*TILE;c.globalAlpha=.18;blob(c,x,y,10+rng()*45,8+rng()*30,i%3?'#72d2b3':'#cc97b8',rng,13);c.globalAlpha=1;}
  }
  drawCanyons(c,row,rng) {
    for(let ridge=0;ridge<3;ridge++) {
      const pts=[];for(let y=-40;y<=TILE+40;y+=18){const gy=y+row*TILE;pts.push([laneX(gy,5)*.85+(ridge-1)*450,y]);}
      c.lineJoin='round';line(c,pts,'#54342f',160);line(c,pts.map(([x,y])=>[x-15,y]),'#9d5b42',125);line(c,pts.map(([x,y])=>[x-25,y]),'#bf7750',82);line(c,pts.map(([x,y])=>[x-30,y]),'#d48d5c',7);
    }
    for(let i=0;i<25;i++){const x=rng()*WIDTH,y=rng()*TILE,r=12+rng()*55;ellipse(c,x+3,y+4,r,r*.65,'rgba(60,32,30,.26)');ellipse(c,x,y,r,r*.65,'#ae6949');ellipse(c,x+2,y+2,r*.8,r*.48,'#7d4838');line(c,[[x-r*.6,y+r*.2],[x,y+r*.4],[x+r*.6,y+r*.2]],'rgba(228,152,99,.3)',2);}
  }
  drawFissures(c,row,rng) {
    c.lineJoin='round';
    for(let n=0;n<7;n++) {
      const x=rng()*WIDTH,y=rng()*TILE,points=[[x,y]];let px=x,py=y;
      for(let j=0;j<9;j++){px+=(rng()-.5)*65;py+=15+rng()*35;points.push([px,py]);}
      line(c,points,'#12181d',22);line(c,points,'#883e29',11);line(c,points,'#d7642f',4);line(c,points,'rgba(255,192,89,.6)',1);
    }
    for(let i=0;i<85;i++){const x=rng()*WIDTH,y=rng()*TILE,r=10+rng()*36;blob(c,x+4,y+6,r,r*.8,'#151a20',rng,8);blob(c,x,y,r,r*.8,'#40363a',rng,7);}
  }
  drawSpace(c,row,rng) {
    const voidWorld=this.index===9;
    for(let i=0;i<9;i++){const x=rng()*WIDTH,y=rng()*TILE;glow(c,x,y,170+rng()*300,voidWorld?'#693956':'#403862',.065);}
    for(let i=0;i<390;i++) {
      const x=rng()*WIDTH,y=rng()*TILE,r=.4+rng()*1.1;
      circle(c,x,y,r,['#8eabbf','#a8a0b9','#698593'][i%3]);
      if(i%50===0){line(c,[[x-5,y],[x+5,y]],'rgba(205,219,244,.3)',.6);line(c,[[x,y-5],[x,y+5]],'rgba(205,219,244,.3)',.6);}
    }
    if(voidWorld) {
      for(let side=0;side<2;side++) {
        const x=side?WIDTH-280:-100;
        polygon(c,[[x,0],[x+300,0],[x+350,TILE*.5],[x+280,TILE],[x,TILE]],'#252532','#4f4053',3);
        for(let i=0;i<13;i++){const y=i*84;c.fillStyle='#151b27';c.fillRect(x+30,y+8,220,67);c.fillStyle='#41404a';c.fillRect(x+31,y+9,218,3);line(c,[[x+42,y+66],[x+64,y+43],[x+200,y+43],[x+226,y+20]],'#574152',2);circle(c,x+250,y+32,2,'#df7c9d');}
      }
      for(let i=0;i<4;i++){const y=rng()*TILE;c.save();c.translate(600,y);c.scale(1,.5);c.strokeStyle='rgba(129,84,127,.12)';c.lineWidth=10;c.beginPath();c.arc(0,0,340,0,TAU);c.stroke();c.lineWidth=1;c.strokeStyle='rgba(229,151,200,.2)';c.beginPath();c.arc(0,0,364,0,TAU);c.stroke();c.restore();}
    } else {
      for(let i=0;i<42;i++) {
        const x=rng()*WIDTH,y=rng()*TILE,r=3+rng()*24;
        const pts=blob(c,x+4,y+4,r,r*.8,'#090e1d',rng,7);blob(c,x,y,r,r*.8,'#3b394a',rng,7);
        if(r>15){c.globalAlpha=.45;line(c,pts.slice(0,4).map(([px,py])=>[px-4,py-7]),'#70636a',2);c.globalAlpha=1;ellipse(c,x,y,r*.35,r*.25,'#222535');}
      }
      // Derelict orbital track, partially obscured by debris.
      const x=220+Math.sin(row*.9)*130;c.save();c.translate(x,0);c.rotate(.16);c.fillStyle='#272c3d';c.fillRect(0,-60,54,TILE+160);c.fillStyle='#151d2c';c.fillRect(8,-60,38,TILE+160);for(let y=-60;y<TILE+160;y+=52){line(c,[[4,y],[50,y+35]],'#4a4556',3);line(c,[[50,y],[4,y+35]],'#3c3d4f',3);}c.restore();
    }
  }
  drawCity(c,row,rng) {
    c.fillStyle='#172033';c.fillRect(0,0,WIDTH,TILE);
    for(let col=0;col<6;col++) {
      for(let n=-1;n<6;n++) {
        const x=col*220-70,y=n*224-(row*TILE%224);
        c.fillStyle='#101a2a';c.fillRect(x+170,y,45,224);c.fillRect(x,y+176,220,40);
        line(c,[[x+190,y],[x+190,y+175]],'rgba(164,137,226,.17)',1);
        c.setLineDash([10,12]);line(c,[[x+185,y],[x+185,y+176]],'rgba(234,184,133,.25)',1);c.setLineDash([]);
        c.fillStyle='#2b3048';c.fillRect(x+7,y+7,155,158);
        c.fillStyle='#3b3b53';c.fillRect(x+7,y+7,155,3);
        c.strokeStyle='#434159';c.lineWidth=1;c.strokeRect(x+15,y+15,139,143);
        for(let k=0;k<3;k++){const bx=x+24+k*43;const by=y+30+rng()*20;c.fillStyle='#111e30';c.fillRect(bx+5,by+10,33,87);c.fillStyle=k%2?'#354057':'#41405a';c.fillRect(bx,by,33,78);c.fillStyle='#535167';c.fillRect(bx,by,33,3);for(let j=0;j<5;j++){c.fillStyle=(j+k)%3===0?'#ab669f':'#487186';c.fillRect(bx+4,by+10+j*13,4,5);c.fillRect(bx+24,by+10+j*13,4,5);}}
        for(let k=0;k<7;k++){c.fillStyle='#626578';c.fillRect(x+170+k*5,y+179,2,10);}
        if((col+n)%3===0){c.fillStyle='#733f80';c.fillRect(x+23,y+145,64,4);glow(c,x+55,y+148,48,'#a354bd',.13);}
      }
    }
    const x=laneX(row*TILE,7);line(c,[[x,-100],[x+80,TILE+100]],'#0c1829',86);line(c,[[x-42,-100],[x+38,TILE+100]],'#63758e',2);line(c,[[x+42,-100],[x+122,TILE+100]],'#866397',2);
    c.globalAlpha=.04;for(let i=0;i<100;i++){const x=rng()*WIDTH,y=rng()*TILE;ellipse(c,x,y,20+rng()*40,2,'#c4e8ff');}c.globalAlpha=1;
  }
  getBand(row) {
    if(this.bands.has(row))return this.bands.get(row);
    const rng=random((row*33479)^(this.index*91021+31817)),props=[];
    const section=this.getSection(Math.floor((row+.5)*TILE/SECTION)),district=section.district;
    const types=DISTRICTS[this.index][district],formations=[];
    const natural=!types.some(type=>STRUCTURES.has(type)),count=natural?3:2;
    for(let f=0;f<count;f++) {
      const x=f===0?section.center:160+rng()*880,y=row*TILE+170+f*(TILE-340)/Math.max(1,count-1)+(rng()-.5)*120;
      formations.push({x,y,district,radius:natural?120+rng()*125:110+rng()*80,seed:Math.floor(rng()*2147483647)});
    }
    const add=(type,x,y,size,variant) => {
      const structure=STRUCTURES.has(type),maxHp=structure?45+size*.45:12+size*.22;
      const prop={id:`${this.index}:${row}:${props.length}`,row,x,y,type,size,variant,hp:maxHp,maxHp,value:structure?12:4,color:this.world.color,emissive:EMISSIVE.has(type)};
      // Kept for existing callers; draw() reuses the same object instead of copying it each frame.
      Object.defineProperty(prop,'ref',{value:prop});props.push(prop);
      const key=Math.floor(y/HIT_CELL)*8+Math.max(0,Math.min(7,Math.floor(x/HIT_CELL)));
      let bucket=this.hitBuckets.get(key);if(!bucket){bucket=[];this.hitBuckets.set(key,bucket);}bucket.push(prop);
    };
    for(let f=0;f<formations.length;f++) {
      const formation=formations[f],n=natural?11+Math.floor(rng()*9):11+Math.floor(rng()*5);
      for(let i=0;i<n;i++) {
        const type=types[i%types.length],structure=STRUCTURES.has(type);
        let x,y,attempt=0;
        do {
          if(structure) {
            x=formation.x+((i%3)-1)*formation.radius*.6+(rng()-.5)*14;
            y=formation.y+(Math.floor(i/3)-1.5)*formation.radius*.47+(rng()-.5)*12;
          } else {
            const angle=rng()*TAU,r=Math.sqrt(rng())*formation.radius;
            x=formation.x+Math.cos(angle)*r;y=formation.y+Math.sin(angle)*r*.84;
          }
          x=Math.max(40,Math.min(WIDTH-40,x));y=Math.max(row*TILE+20,Math.min((row+1)*TILE-20,y));
        } while(!this.suitableSite(type,x,y)&&++attempt<10);
        if(!this.suitableSite(type,x,y))continue;
        if(props.some(p=>(p.x-x)**2+(p.y-y)**2<(structure?43:24)**2))continue;
        const landmark=i===0&&structure,size=landmark?96+rng()*24:structure?49+rng()*35:27+rng()*58;
        add(type,x,y,size,Math.floor(rng()*5));
      }
    }
    // Sparse connecting scenery creates open stretches between denser formations.
    for(let i=0;i<7;i++) {
      const type=this.palette.props[Math.floor(rng()*this.palette.props.length)],x=45+rng()*(WIDTH-90),y=row*TILE+30+rng()*(TILE-60);
      if(this.suitableSite(type,x,y))add(type,x,y,30+rng()*32,Math.floor(rng()*5));
    }
    props.sort((a,b)=>a.y-b.y);props.formations=formations;this.bands.set(row,props);return props;
  }
  drawDistrictGround(c,row) {
    const p=this.palette;
    for(let band=row-1;band<=row+1;band++)for(const f of this.getBand(band).formations) {
      const y=f.y-row*TILE;if(y<-300||y>TILE+300)continue;
      const rng=random(f.seed),r=f.radius,d=f.district;
      c.save();c.translate(f.x,y);
      if(this.index===0||this.index===8) {
        // Ruined plazas and translucent fern/spore beds, nestled into the painted canopy.
        if(d===1&&this.index===0||d===2&&this.index===8) {
          c.rotate(-.16);c.globalAlpha=.22;
          c.fillStyle=p.low;c.fillRect(-r,-r*.65,r*2,r*1.3);
          for(let x=-r;x<r;x+=27)for(let y=-r*.65;y<r*.65;y+=25){c.fillStyle=rng()>.5?p.high:p.mid;c.fillRect(x+2,y+2,23,21);}
          c.strokeStyle=p.shore;c.lineWidth=3;c.strokeRect(-r+10,-r*.65+10,r*2-20,r*1.3-20);
        } else {
          for(let i=0;i<40;i++){const a=rng()*TAU,dist=Math.sqrt(rng())*r,x=Math.cos(a)*dist,y=Math.sin(a)*dist*.7;c.globalAlpha=.08+rng()*.13;ellipse(c,x,y,6+rng()*19,2+rng()*7,this.index===8?(i%3?'#539b83':'#c497c6'):'#85a773');}
        }
      } else if(this.index===1) {
        c.rotate(-.2);c.globalAlpha=.22;
        for(let i=0;i<(d===1?8:3);i++) {
          const x=(rng()-.5)*r*1.7,y=(rng()-.5)*r;const pts=[[x-r*.6,y]];
          for(let k=0;k<6;k++)pts.push([x-r*.6+k*r*.23,y+(rng()-.5)*26+k*14]);
          line(c,pts,'#d7f3ef',10);line(c,pts.map(([x,y])=>[x+3,y+5]),'#244761',d===1?7:3);line(c,pts,'#75bbc9',1.3);
        }
      } else if(this.index===2) {
        c.rotate(-.24);c.globalAlpha=d===1?.26:.1;
        if(d===1) {
          for(let i=0;i<3;i++){c.strokeStyle=i%2?p.low:p.high;c.lineWidth=7;c.strokeRect(-r+i*20,-r*.65+i*15,r*2-i*40,r*1.3-i*30);}
          for(let i=0;i<12;i++){c.fillStyle=p.mid;c.fillRect((rng()-.5)*r*2,(rng()-.5)*r*1.3,8+rng()*19,5+rng()*13);}
        } else for(let i=0;i<7;i++){c.beginPath();c.moveTo(-r,-r*.5+i*17);c.bezierCurveTo(-r*.3,-r+i*18,r*.3,r*.6+i*9,r,r*.4+i*13);c.strokeStyle=i%2?p.high:p.low;c.lineWidth=i%2?2:8;c.stroke();}
      } else if(this.index===3) {
        // Dappled coral shoals vary independently of the islands in the source painting.
        for(let i=0;i<70;i++){const a=rng()*TAU,dist=Math.sqrt(rng())*r,x=Math.cos(a)*dist,y=Math.sin(a)*dist*.65;const color=this.terrainColor(f.x+x,f.y+y);if(color&&color[2]<color[0]*1.08)continue;c.globalAlpha=.10+rng()*.16;ellipse(c,x,y,3+rng()*13,2+rng()*7,i%3?'#87e6ce':'#c4a1bc');}
      } else if(this.index===4) {
        c.rotate(.3+f.seed%7*.1);
        for(let i=0;i<85;i++){const x=(rng()-.5)*r*3,y=(rng()-.5)*r*.48,size=1+rng()*6;c.globalAlpha=.22+rng()*.3;ellipse(c,x+2,y+2,size,size*.65,'#050b19');ellipse(c,x,y,size,size*.65,i%4?p.mid:p.high);}
        if(d===1){c.globalAlpha=.45;line(c,[[-r,12],[-r*.3,-12],[r*.4,-12],[r,16]],'#6b6e86',7);line(c,[[-r,12],[-r*.3,-12],[r*.4,-12],[r,16]],'#182232',4);for(let i=-4;i<=4;i++)line(c,[[i*r/5,-22],[i*r/5+20,12]],'#4a526b',3);}
      } else if(this.index===5) {
        if(d===1||d===3) {
          c.globalAlpha=.2;c.fillStyle='#423d3f';c.fillRect(-r,-r*.7,r*2,r*1.4);
          for(let i=-1;i<=1;i++){line(c,[[-r,i*r*.47],[r,i*r*.47]],'#d3aa81',9);line(c,[[i*r*.6,-r*.7],[i*r*.6,r*.7]],'#d3aa81',7);}
        } else for(let i=0;i<65;i++) {
          const a=rng()*TAU,dist=(.65+rng()*.35)*r,x=Math.cos(a)*dist,y=Math.sin(a)*dist*.62;
          c.globalAlpha=.10+rng()*.16;ellipse(c,x+2,y+3,2+rng()*6,1+rng()*4,'#402d2b');
          ellipse(c,x,y,2+rng()*5,1+rng()*3,i%3?'#c9946d':'#dfb18a');
        }
      } else if(this.index===6) {
        c.globalAlpha=.34;
        const pts=[];for(let i=0;i<10;i++)pts.push([(rng()-.5)*r*.6,-r+i*r*.22]);
        line(c,pts,'#121923',12);line(c,pts,'#6f352c',6);line(c,pts,'#ff9a54',1.5);
        for(let i=0;i<35;i++){c.globalAlpha=.05+rng()*.08;ellipse(c,(rng()-.5)*r*2,(rng()-.5)*r*1.6,4+rng()*14,3+rng()*7,'#e1a47a');}
      } else if(this.index===7) {
        c.globalAlpha=.3;c.fillStyle='#101b2b';c.fillRect(-r,-r*.7,r*2,r*1.4);
        for(let i=-1;i<=1;i++){line(c,[[-r,i*r*.46],[r,i*r*.46]],'#697689',3);line(c,[[i*r*.62,-r*.7],[i*r*.62,r*.7]],i%2?'#397a92':'#ad4fa9',2);}
        c.globalAlpha=.2;c.strokeStyle=d===2?'#7bd1df':'#c178d2';c.lineWidth=2;
        c.strokeRect(-r+8,-r*.7+8,r*2-16,r*1.4-16);
        for(let i=0;i<10;i++){c.fillStyle='#c1b7c5';c.fillRect(r-18,-r*.6+i*r*.12,9,3);}
      } else {
        c.globalAlpha=.3;c.strokeStyle='#69516d';c.lineWidth=12;c.beginPath();c.ellipse(0,0,r,r*.65,0,0,TAU);c.stroke();
        c.lineWidth=2;c.strokeStyle='#c77b9d';c.beginPath();c.ellipse(0,0,r+8,r*.65+6,0,0,TAU);c.stroke();
        for(let i=0;i<10;i++){const a=i/10*TAU,x=Math.cos(a)*r,y=Math.sin(a)*r*.65;line(c,[[x*.84,y*.84],[x*1.16,y*1.16]],'#8c7791',5);}
      }
      c.restore();
    }
  }
  getSprite(type,variant) {
    const key=type+variant;if(this.sprites.has(key))return this.sprites.get(key);
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
    else this.spriteStructure(c,rng,type,variant);
    // Cached weathering and directional light tie vector scenery to the painted ground.
    c.globalCompositeOperation='source-atop';
    const light=c.createLinearGradient(-80,-80,65,90);light.addColorStop(0,'rgba(236,237,212,.22)');light.addColorStop(.44,'transparent');light.addColorStop(1,'rgba(4,12,25,.32)');c.fillStyle=light;c.fillRect(-130,-130,260,260);
    for(let i=0;i<1100;i++){const x=(rng()-.5)*180,y=(rng()-.5)*190;c.fillStyle=i%3?'rgba(10,19,27,.18)':'rgba(224,230,205,.18)';const size=.4+rng()*1.5;c.fillRect(x,y,size,size);}
    c.globalCompositeOperation='source-over';
    this.sprites.set(key,out);return out;
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
    const accent=this.world.accent;
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
    for(let i=0;i<16;i++){const x=100+rng()*280,y=95+rng()*130,r=55+rng()*65;const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,this.palette.fog);g.addColorStop(.45,this.palette.fog+'88');g.addColorStop(1,'transparent');c.globalAlpha=.2;circle(c,x,y,r,g);}return out;
  }
  drawSurfaceMotion(c,h,scroll,time,quality) {
    if(quality==='low')return;
    if(this.art.ready) {
      if(this.index===3||this.index===0){for(let i=0;i<16;i++){const x=(i*287.37)%WIDTH,y=(i*143+scroll*.98)%(h+30)-15;const color=this.terrainColor(x,y-scroll);if(color&&color[2]>color[0]*1.2){c.globalAlpha=.055+Math.sin(time*1.4+i)*.04;line(c,[[x-9,y],[x+9,y]],'#cafff7',1);}}c.globalAlpha=1;}
      return;
    }
    if([0,1,3,8].includes(this.index)) {
      c.save();c.globalCompositeOperation='screen';c.globalAlpha=.04;
      for(let i=0;i<20;i++) {const gy=i*91-scroll*.65,y=((gy%(h+100))+(h+100))%(h+100)-50;const x=this.index===3?((i*317+time*12)%WIDTH):laneX(y-scroll,this.index);line(c,[[x-35+Math.sin(time+i)*13,y],[x+30,y+2],[x+46,y-1]],'#c5fff4',1);}
      c.restore();
    }
    if(this.index===6){c.save();c.globalCompositeOperation='screen';c.globalAlpha=.055+Math.sin(time*1.9)*.015;const points=[];for(let y=-30;y<h+30;y+=30)points.push([laneX(y-scroll,this.index),y]);line(c,points,'#ffa85d',90);c.restore();}
    if(this.index===7) {
      for(let i=0;i<10;i++){const x=120+((i*220)%WIDTH),y=((i*137+time*(i%2?70:-90)+scroll*.9)%(h+160)+h+160)%(h+160)-80;c.fillStyle=i%2?'#ce8cae':'#96d8e7';c.fillRect(x,y,2,6);glow(c,x,y,13,i%2?'#e77fa7':'#9cdded',.24);}
    }
  }
  drawAtmosphere(c,h,scroll,time,quality) {
    const space=this.index===4||this.index===9;
    if(quality!=='low') {
      for(let i=0;i<this.clouds.length;i++){
        const cloud=this.clouds[i],period=h+650;
        const y=((cloud.y+scroll*cloud.speed) % period+period)%period-325;
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
      const y=((i*149.31+scroll*depth+time*(this.index===1?18:4))%(h+40)+h+40)%(h+40)-20;
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
