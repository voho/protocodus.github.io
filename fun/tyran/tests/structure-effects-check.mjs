// Architectural decoration and flames must stay cached, damage-aware and quiet
// when reduced motion is requested, without mutating any saved prop state.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.TYRAN_PLAYWRIGHT||'playwright');
const output=process.env.TYRAN_STRUCTURE_OUTPUT||'/tmp/tyran-structure-qa';
const browser=await chromium.launch({channel:process.env.TYRAN_BROWSER||'chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1920,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(new URL('worlds.js',process.env.TYRAN_URL||'http://127.0.0.1:8773/fun/tyran/').href);
  await page.setContent('<body style="margin:0;background:#101b26"><canvas width="1920" height="1000"></canvas></body>');
  const result=await page.evaluate(async()=>{
    const {WorldRenderer}=await import('./worlds.js'),{StructureEffects}=await import('./structure-effects.js');
    const world=new WorldRenderer();world.setWorld(7);await world.ready;
    world.warmEpoch++;world.warmJobs=[];world.queueWarm=()=>{};
    const effects=new StructureEffects(world.index,world.palette,world.world.accent);
    const canvas=document.querySelector('canvas'),c=canvas.getContext('2d'),probe=document.createElement('canvas');
    probe.width=probe.height=256;const p=probe.getContext('2d');
    const prop={id:'effects-fixture',x:128,y:128,type:'building',size:92,variant:2,hp:100,maxHp:100};
    const sample=(time,motion=true,quality='high',destroyed=false)=>{
      p.clearRect(0,0,256,256);effects.draw(p,prop,time,quality,motion,destroyed);
      const pixels=p.getImageData(0,0,256,256).data;let hash=2166136261,alpha=0;
      for(let n=0;n<pixels.length;n++){hash=Math.imul(hash^pixels[n],16777619);if(n%4===3)alpha+=pixels[n];}
      return {hash:hash>>>0,alpha};
    };
    const alive=sample(1),aliveLater=sample(2);
    prop.hp=20;const original=JSON.stringify(prop),damaged=sample(1),damagedLater=sample(2),frozen=sample(1,false),frozenLater=sample(12,false),low=sample(1,true,'low');
    const unchanged=original===JSON.stringify(prop),destroyed=sample(1,true,'high',true);prop.hp=0;const dead=sample(1);
    const types=['temple','ruin','bunker','station','radar','dome','solar','refinery','building','tower','pylon','fortress','hut','satellite','crawler','hauler'];
    let foundationsInsideBounds=true;
    for(const type of types)for(let variant=0;variant<100;variant++){
      const current={...prop,hp:100,type,variant};effects.getFixtures(type);effects.getFoundation(type,variant);
      p.clearRect(0,0,256,256);effects.drawFoundation(p,current);
      const pixels=p.getImageData(0,0,256,256).data;
      for(let y=0;y<256;y++)for(let x=0;x<256;x++)if(Math.abs(x-128)>current.size*1.3||Math.abs(y-128)>current.size*1.3)foundationsInsideBounds&&=pixels[(y*256+x)*4+3]===0;
    }
    const memory=effects.memoryStats();let gradients=0,allocations=0,restored=true;
    const proto=OffscreenCanvasRenderingContext2D.prototype,radial=proto.createRadialGradient,linear=proto.createLinearGradient;
    proto.createRadialGradient=function(...args){gradients++;return radial.apply(this,args);};
    proto.createLinearGradient=function(...args){gradients++;return linear.apply(this,args);};
    const initial=effects.memoryStats().spriteCount;
    for(let i=0;i<120;i++){
      prop.hp=20;sample(i/60);effects.drawFoundation(p,prop);allocations+=effects.memoryStats().spriteCount-initial;
      p.globalAlpha=.43;p.globalCompositeOperation='source-over';effects.draw(p,prop,i/60);
      restored&&=Math.abs(p.globalAlpha-.43)<.0001&&p.globalCompositeOperation==='source-over';p.globalAlpha=1;
    }
    proto.createRadialGradient=radial;proto.createLinearGradient=linear;
    const nature=[];
    for(const type of ['tree','rock','fern','pine','basalt','crystal','mushroom']){prop.type=type;prop.hp=20;nature.push(sample(1).alpha);}
    let vehicleFlames=0;const drawImage=p.drawImage;
    p.drawImage=function(sprite,...args){if(sprite===effects.fire)vehicleFlames++;return drawImage.call(this,sprite,...args);};
    prop.type='crawler';prop.hp=20;sample(1);prop.type='hauler';sample(1);p.drawImage=drawImage;
    // Visual comparison at desktop scale, including intact and burning sites.
    c.fillStyle='#101b26';c.fillRect(0,0,1920,1000);c.font='16px sans-serif';
    const contactTypes=['building','refinery','bunker','station','tower','fortress'];
    for(let row=0;row<3;row++)for(let col=0;col<contactTypes.length;col++){
      const x=160+col*320,y=150+row*320,hp=[100,55,20][row],stage=row,type=contactTypes[col];
      const current={...prop,x,y,hp,type,size:145,variant:col%5};
      c.fillStyle=world.palette.base;c.fillRect(col*320,row*320,319,318);
      effects.drawFoundation(c,current);const extent=current.size*2.6;
      c.drawImage(world.getSprite(type,current.variant,stage),x-extent*.5,y-extent*.5,extent,extent);
      effects.draw(c,current,2,'high');
      c.fillStyle='#c3d4df';c.fillText(`${type} / ${hp}%`,col*320+18,row*320+293);
    }
    return {alive,aliveLater,damaged,damagedLater,frozen,frozenLater,low,unchanged,destroyed,dead,memory,gradients,allocations,restored,foundationsInsideBounds,nature,vehicleFlames};
  });
  assert.notEqual(result.alive.hash,result.aliveLater.hash,'operating fixtures animate');
  assert.notEqual(result.damaged.hash,result.damagedLater.hash,'standing damage animates flames and smoke');
  assert.equal(result.frozen.hash,result.frozenLater.hash,'reduced motion freezes all effect phases');
  assert(result.low.alpha>0&&result.low.alpha<result.damaged.alpha,'low quality retains compact flames with less visual work');
  assert.equal(result.destroyed.alpha,0,'a destroyed ledger flag immediately extinguishes effects');
  assert.equal(result.dead.alpha,0,'zero HP structures have no residual fire');
  assert(result.unchanged&&result.restored,'rendering preserves prop and context state');
  assert(result.foundationsInsideBounds,'foundations fit existing partial redraw bounds');
  assert(result.memory.spriteCount<=result.memory.spriteLimit&&result.memory.spriteBytes<8*1024*1024,'effect caches are bounded even with arbitrary variants');
  assert.equal(result.gradients,0,'warm effects do not build new gradients');
  assert.equal(result.allocations,0,'animation does not allocate cached surfaces');
  assert(result.nature.every(alpha=>alpha===0),'natural scenery receives no fire or architectural effects');
  assert.equal(result.vehicleFlames,0,'non-building vehicles cannot burn even with an older damaged save');
  assert.deepEqual(errors,[]);
  await mkdir(output,{recursive:true});await page.screenshot({path:`${output}/structure-contact.png`});
  await writeFile(`${output}/results.json`,JSON.stringify(result,null,2));
  console.log('Structure effects QA passed: deterministic animation, reduced motion, low quality, cold craters, bounded caches and no effect on nature.');
  console.log(JSON.stringify(result,null,2));
} finally {await browser.close();}
