// Ground encounters are seeded scenery, independent of render timing and saves.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.TYRAN_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.TYRAN_BROWSER||'chrome',headless:true});
const output=process.env.TYRAN_GROUND_OUTPUT||'/tmp/tyran-ground-sites';
try {
  const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(new URL('worlds.js',process.env.TYRAN_URL||'http://127.0.0.1:8773/fun/tyran/').href);
  await page.setContent('<canvas width="1200" height="900"></canvas>');
  const result=await page.evaluate(async()=>{
    const {WorldRenderer,WORLDS}=await import('./worlds.js'),canvas=document.querySelector('canvas'),c=canvas.getContext('2d');
    const world=new WorldRenderer();await world.ready;world.warmEpoch++;world.warmJobs=[];world.queueWarm=()=>{};
    const counts=[],bonuses=new Set(),snapshots=[];
    const board=document.createElement('canvas');board.width=2000;board.height=840;const bc=board.getContext('2d');
    const signature=surface=>{
      const data=surface.getContext('2d').getImageData(0,0,surface.width,surface.height).data;let hash=2166136261,alpha=0;
      for(let i=0;i<data.length;i++){hash=Math.imul(hash^data[i],16777619);if(i%4===3)alpha+=data[i];}
      return {hash:hash>>>0,alpha};
    };
    for(let index=0;index<10;index++){
      world.setWorld(index);const roles={turret:0,cache:0},initial=[];let example;
      for(let row=1;row>=-12;row--){
        const sites=world.getBand(row).filter(prop=>prop.groundRole);
        if(sites.length>2)throw new Error('Too many active sites in one band');
        for(const prop of sites){
          roles[prop.groundRole]++;initial.push([prop.id,prop.groundRole,prop.bonus,prop.phase]);
          if(prop.bonus)bonuses.add(prop.bonus);
        }
        if(!example&&sites.length===2)example=sites;
      }
      counts.push({world:WORLDS[index].id,...roles});
      world.bands.clear();world.hitBuckets.clear();
      const rebuilt=[];
      for(let row=1;row>=-12;row--)for(const prop of world.getBand(row))if(prop.groundRole)rebuilt.push([prop.id,prop.groundRole,prop.bonus,prop.phase]);
      if(JSON.stringify(initial)!==JSON.stringify(rebuilt))throw new Error('Eviction changed site roles');
      const [turret,cache]=example.sort((a,b)=>a.groundRole==='turret'?-1:1);
      const x=index%5*400,y=Math.floor(index/5)*420;
      bc.fillStyle=world.palette.low;bc.fillRect(x,y,400,420);
      for(const [n,prop]of [turret,cache].entries()){
        const marker={...prop,x:x+100+n*200,y:y+175,size:125};
        const sprite=world.getSprite(prop.type,prop.variant),size=marker.size*2.6;
        bc.drawImage(sprite,marker.x-size*.5,marker.y-size*.5,size,size);
        world.setTurretActivity([{id:prop.id,angle:Math.PI*.68,charge:.85,flash:0}]);
        world.drawGroundSite(bc,marker,3,false);
      }
      bc.fillStyle='#d9e5e4';bc.font='17px sans-serif';bc.fillText(WORLDS[index].name,x+12,y+365);
      bc.font='15px sans-serif';bc.fillText('Ground turret',x+35,y+395);bc.fillText(`Supply: ${cache.bonus}`,x+210,y+395);
      snapshots.push(initial.length);
    }
    world.setWorld(0);let prop;
    for(let row=0;row>=-12&&!prop;row--)prop=world.getBand(row).find(p=>p.groundRole==='turret');
    const scroll=350-prop.y,expectedX=(prop.x+6)*.5,expectedY=175;
    // No draw call: dimensions, focus and scrolling must be enough for simulation.
    const target=world.getGroundTargets(600,450,scroll,150).find(t=>t.id===prop.id);
    const projection={target,expectedX,expectedY,scale:world.scale,scroll:world.scroll,offset:world.parallaxX};
    const shifted=world.getGroundTargets(900,500,scroll+80,900).find(t=>t.id===prop.id);
    const shiftedExpected={x:(prop.x-12)*.75,y:430*.75};
    world.setTurretActivity([{id:prop.id,angle:Math.PI*.4,charge:.4,flash:0}]);
    const marker={...prop,x:600,y:450,size:100};
    const markerPixels=(time,motion=false)=>{c.clearRect(0,0,1200,900);world.drawGroundSite(c,marker,time,motion);return signature(canvas);};
    const steady=markerPixels(0),steadyLater=markerPixels(5);
    world.setTurretActivity([{id:prop.id,angle:Math.PI*.4,charge:.9,flash:0}]);
    const charged=markerPixels(5),sprites=world.siteSprites;
    const original=c.createRadialGradient;c.createRadialGradient=()=>{throw new Error('Per-frame ground marker gradient');};
    world.drawGroundSite(c,marker,10,true);c.createRadialGradient=original;
    const destroyed=world.hit(shifted.x,shifted.y,2,prop.maxHp+1,scroll+80).filter(p=>p.id===prop.id);
    const repeat=world.hit(shifted.x,shifted.y,2,prop.maxHp+1,scroll+80).filter(p=>p.id===prop.id);
    const after=world.getGroundTargets(900,500,scroll+80,900).find(t=>t.id===prop.id);
    const deadPixels=markerPixels(8);
    const ledger=new Map(world.damage),dead=new Set(world.destroyed);
    world.restoreDamage(ledger,dead);const restored=world.getBand(prop.row).find(p=>p.id===prop.id);
    const restoredTarget=world.getGroundTargets(900,500,scroll+80,900).some(t=>t.id===prop.id);
    const resetOnRestore=world.turretActivity.size===0;
    const cache=world.getBand(prop.row).find(p=>p.groundRole==='cache');
    world.getGroundTargets(1200,900,350-cache.y,600);
    const reward=world.hit(cache.x,350,2,cache.maxHp+1,350-cache.y).find(p=>p.id===cache.id);
    const duplicate=world.hit(cache.x,350,2,cache.maxHp+1,350-cache.y).find(p=>p.id===cache.id);
    world.setTurretActivity([{id:'old',angle:0,charge:1}]);world.setWorld(0);
    return {counts,bonuses:[...bonuses].sort(),snapshots,projection,shifted,shiftedExpected,
      steady,steadyLater,charged,deadPixels,destroyed,repeat,removed:!after,restoredDead:restored.hp===0&&!restoredTarget,
      resetOnRestore,resetOnWorld:world.turretActivity.size===0,reward,duplicate:!!duplicate,cached:world.siteSprites===sprites,
      contact:board.toDataURL()};
  });
  assert(result.counts.every(count=>count.turret>0&&count.cache>0),'every biome has turrets and supply caches along the route');
  assert.deepEqual(result.bonuses,['credit','invulnerable','rapid','repair']);
  assert.equal(result.projection.target.x,result.projection.expectedX);
  assert.equal(result.projection.target.y,result.projection.expectedY);
  assert.equal(result.shifted.x,result.shiftedExpected.x);
  assert.equal(result.shifted.y,result.shiftedExpected.y);
  assert.deepEqual(result.steady,result.steadyLater,'reduced motion freezes decorative ground indicators');
  assert.notEqual(result.steady.hash,result.charged.hash,'live weapon charge remains readable with reduced motion');
  assert.equal(result.deadPixels.alpha,0,'craters lose every active marker');
  assert.equal(result.destroyed.length,1);assert.equal(result.destroyed[0].groundRole,'turret');assert.equal(result.repeat.length,0);
  assert(result.removed&&result.restoredDead&&result.resetOnRestore&&result.resetOnWorld,'destroyed turrets stay silent after regeneration and restore');
  assert.equal(result.reward.groundRole,'cache');assert(result.bonuses.includes(result.reward.bonus));assert(!result.duplicate,'supply structures drop their bonus only once');
  assert(result.cached,'static marker artwork is reused');assert.deepEqual(errors,[]);
  await mkdir(output,{recursive:true});await writeFile(`${output}/sites.png`,Buffer.from(result.contact.split(',')[1],'base64'));delete result.contact;
  await writeFile(`${output}/results.json`,JSON.stringify(result,null,2));
  console.log('PASS ground sites: all biomes, deterministic roles, live projection, once-only rewards, persisted destruction, cached visuals and reduced motion.');
  console.log(JSON.stringify(result.counts));
} finally {await browser.close();}
