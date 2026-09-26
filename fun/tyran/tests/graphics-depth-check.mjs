// Large-display density, independent cloud planes and motion-safe rendering.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.TYRAN_PLAYWRIGHT||'playwright');
const output=process.env.TYRAN_GRAPHICS_OUTPUT||'/tmp/tyran-graphics-qa';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:process.env.TYRAN_BROWSER||'chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:2560,height:1440}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(new URL('worlds.js',process.env.TYRAN_URL||'http://127.0.0.1:8773/fun/tyran/').href);
  await page.setContent('<body style="margin:0;background:#080f19"><canvas width="2560" height="1440"></canvas></body>');
  const result=await page.evaluate(async()=>{
    const {WorldRenderer,PARALLAX_LAYERS}=await import('./worlds.js'),world=new WorldRenderer();await world.ready;
    world.warmEpoch++;world.warmJobs=[];world.queueWarm=()=>{};
    const surface=document.querySelector('canvas'),c=surface.getContext('2d'),frames=[];
    world.setDetailScale(2560,'high');
    const tile=world.getTile(0),scenery=world.getSceneryLayer(0,world.getBand(0));
    const dimensions={terrain:[tile.width,tile.height],scenery:[scenery.width,scenery.height]};
    world.parallaxX=12;const cloud={x:600,y:600,r:200,phase:1};
    const rates=[1,2].map(layer=>{
      const a=world.cloudPosition(cloud,900,0,2,layer),b=world.cloudPosition(cloud,900,100,2,layer);
      const frozen=world.cloudPosition(cloud,900,100,99,layer,false),still=world.cloudPosition(cloud,900,0,0,layer,false);
      return {speed:(b.y-a.y)/100,reducedSpeed:(frozen.y-still.y)/100,reducedX:frozen.x===still.x};
    });
    for(const index of [0,3,6,7,9]){
      world.setWorld(index);world.draw(c,2560,1440,3200,3,'high',1280);
      const buildings=world.visibleProps.filter(p=>['building','tower','refinery','fortress','station'].includes(p.type)&&p.screenY>70&&p.screenY<550);
      for(const p of buildings.slice(0,4))world.hit(p.screenX*world.scale,p.screenY*world.scale,0,p.maxHp*.77);
      world.draw(c,2560,1440,3200,3,'high',1280);
      frames.push({name:world.world.id,png:surface.toDataURL()});
    }
    world.draw(c,2560,1440,3200,3,'high',1280,false);const still=surface.toDataURL();
    world.draw(c,2560,1440,3200,99,'high',1280,false);const frozen=still===surface.toDataURL();
    const target=world.visibleProps.find(p=>['pylon','fortress','station','ruin'].includes(p.type));
    if(!target)throw Error('Missing building fixture');
    world.hit(target.screenX*world.scale,target.screenY*world.scale,0,target.maxHp*.2);
    const hp=target.hp;
    world.setDetailScale(1200,'low');world.draw(c,2560,1440,3200,3,'low',1280);
    const downgrade={density:world.detailScale,tileWidth:world.getTile(0).width,hp:world.getBand(target.row).find(p=>p.id===target.id).hp===hp};
    world.setDetailScale(3840,'high');
    let maxBytes=0,maxTiles=0,maxScenery=0;
    for(let i=0;i<35;i++){
      world.draw(c,2560,1440,i*8000,3,'high',1280);
      maxBytes=Math.max(maxBytes,world.memoryStats().stripBytes);maxTiles=Math.max(maxTiles,world.tiles.size);maxScenery=Math.max(maxScenery,world.sceneryLayers[0].size);
    }
    return {dimensions,rates,frozen,downgrade,maxBytes,maxTiles,maxScenery,layers:PARALLAX_LAYERS.map(l=>l.id),frames};
  });
  assert.deepEqual(result.dimensions,{terrain:[2800,1600],scenery:[2800,2160]},'large displays retain source detail in both cached planes');
  assert.deepEqual(result.layers,['ground','atmosphere','foreground']);
  assert(Math.abs(result.rates[0].speed-1.32)<1e-9&&Math.abs(result.rates[1].speed-1.85)<1e-9,'cloud planes visibly separate during scrolling');
  assert(result.rates.every(r=>r.reducedSpeed===1&&r.reducedX),'reduced motion removes extra parallax and drift');
  assert(result.frozen,'all ambient decoration freezes with reduced motion');
  assert.deepEqual(result.downgrade,{density:1,tileWidth:1400,hp:true},'low quality sheds dense strips without losing building damage');
  assert(result.maxTiles<=4&&result.maxScenery<=4&&result.maxBytes<140*1024**2,'high-detail streaming stays bounded');
  for(const frame of result.frames)await writeFile(`${output}/enhanced-${frame.name}.png`,Buffer.from(frame.png.split(',')[1],'base64'));
  delete result.frames;
  // The complete game keeps a native 4K backing surface while using the same arena.
  await page.setViewportSize({width:3840,height:2160});
  await page.goto(process.env.TYRAN_URL||'http://127.0.0.1:8773/fun/tyran/');await page.waitForFunction(()=>window.tyran);
  const display=await page.evaluate(()=>{const c=document.querySelector('#game-canvas');return {width:c.width,height:c.height,density:tyran.world.detailScale};});
  assert.deepEqual(display,{width:3840,height:2160,density:2},'high quality starts at native 4K and keeps adaptive rendering available');
  assert.deepEqual(errors,[]);
  await writeFile(`${output}/depth-results.json`,JSON.stringify({...result,display},null,2));
  console.log('PASS large-screen detail, three parallax planes, reduced motion, quality changes and bounded streaming.');
  console.log(JSON.stringify({...result,display}));
} finally {await browser.close();}
