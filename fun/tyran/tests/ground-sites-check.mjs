// Supply buildings remain seeded and destructible; all retired ground guns stay absent.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.TYRAN_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.TYRAN_BROWSER||'chrome',headless:true});
try {
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(new URL('worlds.js',process.env.TYRAN_URL||'http://127.0.0.1:8773/fun/tyran/').href);
  const result=await page.evaluate(async()=>{
    const {WorldRenderer}=await import('./worlds.js'),world=new WorldRenderer();await world.ready;
    world.warmEpoch++;world.warmJobs=[];world.queueWarm=()=>{};
    const counts=[],bonuses=new Set();
    const canvas=new OffscreenCanvas(1200,900),c=canvas.getContext('2d');
    for(let index=0;index<10;index++){
      world.setWorld(index);const first=[];
      for(let row=1;row>=-12;row--)for(const prop of world.getBand(row)){
        if(prop.groundRole==='turret')throw Error('Retired ground turret');
        if(prop.groundRole){first.push([prop.id,prop.groundRole,prop.bonus]);bonuses.add(prop.bonus);}
      }
      world.bands.clear();world.hitBuckets.clear();const rebuilt=[];
      for(let row=1;row>=-12;row--)for(const prop of world.getBand(row))if(prop.groundRole)rebuilt.push([prop.id,prop.groundRole,prop.bonus]);
      if(JSON.stringify(first)!==JSON.stringify(rebuilt))throw Error('Supply identities changed on eviction');
      counts.push(first.length);
    }
    world.setWorld(0);let prop;
    for(let row=0;row>=-20&&!prop;row--)prop=world.getBand(row).find(p=>p.groundRole==='cache');
    const scroll=350-prop.y;
    const targets=world.getGroundTargets(900,500,scroll,900);
    const x=(prop.x-12)*.75,y=350*.75;
    const marker={...prop,x:600,y:450,size:100};
    const pixels=(time,motion=false)=>{c.clearRect(0,0,1200,900);world.drawGroundSite(c,marker,time,motion);return [...c.getImageData(500,350,200,200).data].join(',');};
    const still=pixels(0),stillLater=pixels(5),active=pixels(5,true);
    const reward=world.hit(x,y,2,prop.maxHp+1,scroll).find(p=>p.id===prop.id);
    const duplicate=world.hit(x,y,2,prop.maxHp+1,scroll).find(p=>p.id===prop.id);
    const dead=pixels(5);
    world.restoreDamage(world.damage,world.destroyed);
    const restored=world.getBand(prop.row).find(p=>p.id===prop.id);
    world.setTurretActivity([{id:'legacy',charge:1}]);
    return {counts,bonuses:[...bonuses].sort(),targets,still:still===stillLater,active:active!==still,
      reward,duplicate:!!duplicate,dead:!dead.split(',').some(Number),restored:restored.hp===0,
      noGuns:world.turretActivity.size===0&&!world.siteSprites.turret};
  });
  assert(result.counts.every(n=>n>0),'every biome retains supply buildings');
  assert.deepEqual(result.bonuses,['credit','invulnerable','rapid','repair']);
  assert.deepEqual(result.targets,[],'ground targeting never exposes guns');
  assert(result.noGuns,'legacy gun activity and turret artwork are gone');
  assert(result.still&&result.active,'supply animation respects reduced motion');
  assert(result.reward?.groundRole==='cache'&&!result.duplicate,'supply buildings reward destruction once');
  assert(result.dead&&result.restored,'destroyed supply markers remain dark after reload');
  assert.deepEqual(errors,[]);
  console.log('PASS seeded supply buildings, no ground turrets, aligned hits, one-time rewards and reduced motion.');
} finally {await browser.close();}
