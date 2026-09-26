// Controlled render time verifies scale, cleanup and the game-over transition.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.TYRAN_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.TYRAN_BROWSER||'chrome',headless:true});
const out=process.env.TYRAN_CINEMATIC_OUTPUT||'/tmp/tyran-cinematic-qa';
const errors=[];
try {
  const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1});
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    const frames=new Map();let id=0,time=1000;
    window.requestAnimationFrame=callback=>{frames.set(++id,callback);return id;};
    window.cancelAnimationFrame=key=>frames.delete(key);
    window.__frame=(milliseconds=1000/60)=>{time+=milliseconds;const queue=[...frames.values()];frames.clear();for(const callback of queue)callback(time);};
    window.__advance=seconds=>{for(let i=0;i<Math.ceil(seconds*60);i++)__frame();};
    window.__work={readbacks:0,gradients:0,signalCopies:0,signalArea:0};
    for(const prototype of [CanvasRenderingContext2D.prototype,OffscreenCanvasRenderingContext2D.prototype]){
      for(const method of ['getImageData','createRadialGradient','createLinearGradient']){
        const original=prototype[method];prototype[method]=function(...args){if(window.__measure)__work[method==='getImageData'?'readbacks':'gradients']++;return original.apply(this,args);};
      }
      const draw=prototype.drawImage;
      prototype.drawImage=function(source,...args){
        if(window.__measure&&['game-canvas','game-gpu-canvas'].includes(source.id)) {__work.signalCopies++;__work.signalArea+=args[2]*args[3];}
        return draw.call(this,source,...args);
      };
    }
    localStorage.clear();localStorage.setItem('tyran-muted','true');
  });
  await page.goto(process.env.TYRAN_URL||'http://127.0.0.1:8773/fun/tyran/');
  await page.waitForFunction(()=>window.tyran,null,{polling:20});
  await page.evaluate(async()=>{
    tyran.launch();await tyran.world.ready;tyran.state.bossSpawned=true;__frame(0);
    window.__snapshot=()=>({scene:tyran.scene,filter:document.querySelector('#game-canvas').style.filter,
      opacity:Number(document.querySelector('#game-canvas').style.opacity||1),panel:!document.querySelector('#end-screen').hidden,
      impact:tyran.fx.impact,glitch:tyran.fx.glitch,shake:tyran.fx.shake,rings:tyran.fx.rings.length,delayed:tyran.fx.delayed.length,
      frames:tyran.performance.frames,time:tyran.state.time});
  });
  const bursts=await page.evaluate(()=>{
    const sample=(event)=>{tyran.fx.reset();tyran.fx.emit(event);__advance(.1);return __snapshot();};
    __measure=true;
    const small=sample({type:'explosion',x:600,y:300,size:20});
    const heavy=sample({type:'explosion',x:600,y:300,size:54});
    const boss=sample({type:'explosion',x:600,y:300,size:110,boss:true});
    const work={...__work},canvas=document.querySelector('#game-canvas');__measure=false;
    return {small,heavy,boss,work,canvasArea:canvas.width*canvas.height};
  });
  assert.equal(bursts.small.impact,0);assert.equal(bursts.small.filter,'');
  assert(bursts.heavy.impact>0&&bursts.boss.impact>bursts.heavy.impact,'capital-ship camera response scales above ordinary kills');
  assert(bursts.heavy.shake>bursts.small.shake&&bursts.boss.shake>bursts.heavy.shake);
  assert.match(bursts.heavy.filter,/saturate\(/);assert.match(bursts.boss.filter,/blur\(/);
  assert(bursts.heavy.delayed>0&&bursts.boss.delayed>bursts.heavy.delayed,'large ships use staggered local detonations');
  assert.equal(bursts.work.readbacks,0);assert.equal(bursts.work.gradients,0,'warmed impacts reuse existing effect textures');
  assert(bursts.work.signalCopies>0&&bursts.work.signalArea/bursts.work.signalCopies<bursts.canvasArea*.012,'interference copies narrow strips, never a full frame');
  await mkdir(out,{recursive:true});await page.screenshot({path:`${out}/boss-impact.png`});
  const stopped=await page.evaluate(()=>{
    tyran.pause();const paused=__snapshot();__advance(.5);const held=__snapshot();
    tyran.pause();__frame(0);__advance(3.2);const settled=__snapshot();
    tyran.fx.reset();document.querySelector('#quality-toggle').click();__frame(0);
    __work.signalCopies=0;__measure=true;tyran.fx.emit({type:'explosion',x:600,y:300,size:110,boss:true});__advance(.1);__measure=false;
    const low={...__snapshot(),copies:__work.signalCopies};
    tyran.fx.reset();document.querySelector('#quality-toggle').click();__frame(0);
    return {paused,held,settled,low};
  });
  assert.equal(stopped.paused.filter,'');assert.equal(stopped.paused.impact,stopped.held.impact,'pause freezes the impact envelope');
  assert.equal(stopped.settled.filter,'');assert.equal(stopped.settled.impact,0);assert.equal(stopped.settled.glitch,0);assert.equal(stopped.settled.delayed,0);
  assert.equal(stopped.low.filter,'');assert.equal(stopped.low.copies,0,'low effects retain local explosions without full-screen interference');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(()=>tyran.fx.reduced,null,{polling:20});
  const reduced=await page.evaluate(()=>{__work.signalCopies=0;__measure=true;tyran.fx.emit({type:'explosion',x:600,y:300,size:110,boss:true});__advance(.1);__measure=false;return {...__snapshot(),copies:__work.signalCopies};});
  assert.equal(reduced.filter,'');assert.equal(reduced.impact,0);assert.equal(reduced.glitch,0);assert.equal(reduced.copies,0);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.waitForFunction(()=>!tyran.fx.reduced,null,{polling:20});
  const ending=await page.evaluate(async()=>{
    const {hurtPlayer}=await import('./sim.js');
    tyran.fx.reset();const pilot=tyran.state.players[0];pilot.hull=1;pilot.shield=0;pilot.hurt=0;pilot.guard=0;tyran.state.lives=0;
    hurtPlayer(tyran.state,pilot,1000);tyran.step(1/60);__frame(0);const impact=__snapshot();
    __advance(.15);const hold=__snapshot();__advance(.75);const middle=__snapshot();
    // A hidden tab neither finishes the transition nor accrues a catch-up jump.
    Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));
    __frame(5000);const hidden=__snapshot();
    Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));
    __frame(5000);const restored=__snapshot();
    return {impact,hold,middle,hidden,restored};
  });
  assert.equal(ending.impact.scene,'end');assert.equal(ending.impact.panel,false);assert.equal(ending.impact.opacity,1);
  assert.equal(ending.hold.opacity,1,'the fatal explosion is visible before fading begins');
  assert(ending.middle.opacity>0&&ending.middle.opacity<1);assert.equal(ending.middle.panel,false,'the end panel cannot interrupt the fade');
  assert.equal(ending.middle.time,ending.impact.time,'simulation is frozen throughout the ending');
  assert.equal(ending.hidden.opacity,ending.middle.opacity);assert.equal(ending.restored.opacity,ending.middle.opacity,'visibility restoration discards elapsed background time');
  await page.screenshot({path:`${out}/ending-mid-fade.png`});
  const finished=await page.evaluate(()=>{__advance(1);const black=__snapshot();__advance(1);const idle=__snapshot();return {black,idle,focus:document.activeElement.id,background:getComputedStyle(document.querySelector('#end-screen')).backgroundColor};});
  assert.equal(finished.black.opacity,0);assert.equal(finished.black.panel,true);assert.equal(finished.black.filter,'');
  assert.equal(finished.black.impact,0);assert.equal(finished.black.glitch,0);assert.equal(finished.focus,'retry-button');
  assert.equal(finished.background,'rgb(0, 0, 0)');assert.equal(finished.black.frames,finished.idle.frames,'completed game-over screen idles');
  await page.screenshot({path:`${out}/ending-black.png`});
  const retry=await page.evaluate(()=>{document.querySelector('#retry-button').click();__frame(0);return {...__snapshot(),arrow:document.querySelector('#retry-button > span')?.getAttribute('aria-hidden')};});
  assert.equal(retry.scene,'playing');assert.equal(retry.opacity,1);assert.equal(retry.filter,'');assert.equal(retry.panel,false);assert.equal(retry.arrow,'true');
  const menu=await page.evaluate(()=>{tyran.pause();document.querySelector('#menu-button').click();__frame(0);return {opacity:document.querySelector('#game-canvas').style.opacity,filter:document.querySelector('#game-canvas').style.filter,scene:tyran.scene};});
  assert.deepEqual(menu,{opacity:'',filter:'',scene:'menu'});
  assert.deepEqual(errors,[]);
  console.log('PASS proportional heavy/boss impacts, cached narrow-strip interference, reduced motion, pause/visibility safety, slow end fade, black panel, idle and retry/menu reset.');
  console.log(JSON.stringify({bursts,ending,finished},null,2));
} finally {await browser.close();}
