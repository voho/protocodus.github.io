// Wide arenas reveal more seeded world cells without magnifying terrain or moving saved props.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.TYRAN_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.TYRAN_BROWSER||'chrome',headless:true});
try {
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(new URL('worlds.js',process.env.TYRAN_URL||'http://127.0.0.1:8773/fun/tyran/').href);await page.setContent('');
  const result=await page.evaluate(async()=>{
    const {WorldRenderer}=await import('./worlds.js');
    const widths=[1200,1600,2100,3200],world=new WorldRenderer();await world.ready;
    world.warmEpoch++;world.warmJobs=[];const queue=world.queueWarm;world.queueWarm=()=>{};
    const identity=p=>JSON.stringify([p.id,p.x,p.y,p.size,p.type,p.variant,p.groundRole,p.bonus]);
    const seeded=[];
    for(let index=0;index<10;index++){
      world.setWorld(index,'wide-map-qa');world.setViewport(1200);
      const original=Array.from({length:7},(_,n)=>world.getBand(n-3)).flat();
      const damaged=original.find(p=>['temple','ruin','bunker','station','radar','dome','solar','refinery','building','tower','pylon','fortress','hut','satellite'].includes(p.type));
      if(!damaged)throw Error('Missing building fixture');
      world.scale=1;world.parallaxX=0;world.scroll=300-damaged.y;world.hit(damaged.x,300,0,damaged.maxHp*.4);
      const hp=damaged.hp,baseline=new Map(original.map(p=>[p.id,identity(p)]));let previous=baseline;
      const sizes=[];
      for(const width of widths){
        world.setViewport(width);
        const props=Array.from({length:7},(_,n)=>world.getBand(n-3)).flat(),current=new Map(props.map(p=>[p.id,identity(p)]));
        const stable=[...previous].every(([id,value])=>current.get(id)===value);
        const retained=props.find(p=>p.id===damaged.id);
        sizes.push({width,count:props.length,stable,hp:retained.hp===hp,newRight:width===1200||props.some(p=>p.x>1200&&p.x<width)});previous=current;
      }
      world.setViewport(1200);
      const restored=Array.from({length:7},(_,n)=>world.getBand(n-3)).flat();
      seeded.push({index,sizes,restored:restored.every(p=>baseline.get(p.id)===identity(p)),damage:restored.find(p=>p.id===damaged.id).hp===hp});
    }
    world.queueWarm=queue;world.setWorld(0,'wide-render-qa');world.setDetailScale(5120,'high');
    const surface=new OffscreenCanvas(3200,900),c=surface.getContext('2d'),renders=[];
    const hash=tile=>{const bytes=tile.getContext('2d').getImageData(0,0,2600,1600).data;let h=2166136261;for(let i=0;i<bytes.length;i+=29)h=Math.imul(h^bytes[i],16777619);return h>>>0;};
    let reference;
    for(const width of widths){
      await world.prepareReady(width,900);world.draw(c,width,900,0,0,'high',width*.5,false);
      const tile=world.getTile(0),common=hash(tile);reference??=common;
      const pixel=c.getImageData(width-1,100,1,700).data;
      renders.push({width,scale:world.scale,mapWidth:world.mapWidth,density:world.detailScale,tile:[tile.width,tile.height],sameTerrain:common===reference,
        fixedProps:world.visibleProps.every(p=>p.screenX===p.x&&p.screenY===p.y),covered:pixel.filter((_,i)=>i%4===3).every(alpha=>alpha===255),memory:world.memoryStats()});
    }
    // Resize while idle strip jobs are pending. Old-width canvases must never
    // enter the new caches or corrupt a later frame.
    world.prepare(3200,900,5000);world.prepareFlight(1600,900,5000);
    const resized=[...world.tiles.values(),...world.sceneryLayers[0].values()].every(canvas=>canvas.width===3600);
    world.setViewport(4000);const capped=world.detailScale===1;
    return {seeded,renders,resized,capped};
  });
  for(const check of result.seeded){
    assert(check.sizes.every(size=>size.stable&&size.hp&&size.newRight),`sector ${check.index}: widths preserve cell identities, supply choices and damage while adding columns`);
    assert(check.restored&&check.damage,`sector ${check.index}: shrinking restores the original map without resetting damage`);
    assert(check.sizes.at(-1).count>check.sizes[0].count,`sector ${check.index}: ultrawide reveals additional scenery`);
  }
  for(const frame of result.renders){
    assert.equal(frame.scale,1);assert.equal(frame.density,2);
    assert.deepEqual(frame.tile,[(frame.width+200)*2,1600]);
    assert(frame.sameTerrain&&frame.fixedProps&&frame.covered,'Shared terrain pixels, object size and complete right-edge coverage are preserved');
    const columnBytes=(frame.mapWidth+200)*frame.density**2*4;
    const stripLimit=columnBytes*(5*800+5*1080),scratchLimit=columnBytes*1080+2*260*260*4;
    assert(frame.memory.stripBytes<=stripLimit&&frame.memory.scratchBytes<=scratchLimit,'Caches are bounded by viewport columns, neighboring rows and one damage scratch');
  }
  assert(result.resized,'Old-width idle work is discarded on resize');assert(result.capped,'Oversized 2× backing strips fall back before exceeding8192pixels');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify(result.renders.map(({width,memory})=>({width,stripsMiB:(memory.stripBytes/1024**2).toFixed(1),scratchMiB:(memory.scratchBytes/1024**2).toFixed(1),terrainMiB:(memory.terrainBytes/1024**2).toFixed(1),sceneryMiB:(memory.spriteBytes/1024**2).toFixed(1)}))));
  console.log('PASS fixed-size terrain across1200/1600/2100/3200, ten seeded biomes, stable supplies/damage, extra columns, safe resize and bounded viewport caches.');
}finally{await browser.close();}
