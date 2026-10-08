// Real app regression: expensive world commits run at 1 Hz, while recorded
// vehicle trajectories animate between them. Browser storage is isolated.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createWorldFromMenu,loadAutosaveFromMenu,openGameAction} from './browser-start.mjs';
const {chromium}=await import(process.env.TRANSPORT_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.TRANSPORT_BROWSER||'chrome',headless:true});
const url=process.env.TRANSPORT_URL||'http://127.0.0.1:8765/fun/transport/';
const output=process.env.TRANSPORT_OUTPUT||process.env.TRANSPORT_SCREENSHOTS||'/tmp/transport-world-cadence-qa';
await mkdir(output,{recursive:true});
const errors=[],result={speeds:[]};

function near(actual,expected,tolerance,message){assert.ok(Math.abs(actual-expected)<=tolerance,`${message}: ${actual} vs ${expected} (±${tolerance})`);}

try{
 const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(url);await createWorldFromMenu(page);
 await page.waitForFunction(()=>typeof transport.simulation?.getStats==='function');
 await page.evaluate(()=>{
  const vehicle=transport.game.vehicles[0];if(!vehicle)throw Error('The starter route has no vehicle.');
  transport.renderer.focus(vehicle.x,vehicle.y-1);
  window.cadenceQA={renders:0,
   summary(game){return{
    seed:game.seed,day:game.day,money:game.money,totalDelivered:game.totalDelivered,totalRevenue:game.totalRevenue,
    vehicles:game.vehicles.map(v=>Object.fromEntries(['id','routeId','x','y','angle','progress','direction','load','capacity','dwellRemaining','totalDistance','tripSerial'].map(key=>[key,v[key]]))),
    routeIds:game.routes.map(route=>route.id),
   };},
   sample(){const vehicle=transport.game.vehicles[0];return{
    time:performance.now(),day:transport.game.day,clock:transport.simulation.getStats(),renders:cadenceQA.renders,
    point:transport.renderer.vehicleWorldPoint(vehicle),authoritative:JSON.stringify(vehicle),
   };},
  };
  const render=transport.renderer.render;
  transport.renderer.render=function(...args){cadenceQA.renders++;return render.apply(this,args);};
 });
 // Actual seconds and game speed remain separate. Pausing flushes the final
 // fractional second so repeated short runs never lose simulation time.
 for(const speed of [1,3,8]){
  const measured=await page.evaluate(async speed=>{
   const point=transport.renderer.vehicleWorldPoint(transport.game.vehicles[0]);transport.renderer.focus(point.x,point.y-1);
   const beforeDay=transport.game.day,before=transport.simulation.getStats();
   transport.setSpeed(speed);const started=performance.now(),samples=[cadenceQA.sample()];
   const timer=setInterval(()=>samples.push(cadenceQA.sample()),25);
   await new Promise(resolve=>setTimeout(resolve,3300));clearInterval(timer);
   samples.push(cadenceQA.sample());const stopped=performance.now(),running=transport.simulation.getStats();
   transport.setSpeed(0);
   return{speed,beforeDay,afterDay:transport.game.day,elapsed:(stopped-started)/1000,before,running,after:transport.simulation.getStats(),samples};
  },speed);
  const ordinaryCommits=measured.running.commits-measured.before.commits;
  assert.ok(ordinaryCommits>=2&&ordinaryCommits<=4,`speed ${speed}: 1 Hz world commits, observed ${ordinaryCommits}`);
  near(measured.afterDay-measured.beforeDay,measured.elapsed*speed,.18*speed,`speed ${speed} preserves active elapsed time`);
  near(measured.after.pendingDays,0,1e-7,`speed ${speed}: pause commits pending time`);
  const changes=measured.samples.filter((sample,index)=>index&&sample.clock.commits!==measured.samples[index-1].clock.commits);
  for(let index=1;index<changes.length;index++)assert.ok(changes[index].time-changes[index-1].time>=750,`speed ${speed}: ordinary commits are spaced about one second apart`);
  const stable=measured.samples.slice(1).map((sample,index)=>[measured.samples[index],sample]).filter(([a,b])=>a.day===b.day&&a.clock.commits===b.clock.commits);
  assert.ok(stable.length>25,`speed ${speed}: committed world stays stable between updates`);
  for(const [a,b]of stable)assert.equal(b.authoritative,a.authoritative,`speed ${speed}: visual interpolation leaves the authoritative vehicle unchanged`);
  const moving=stable.filter(([a,b])=>b.renders>a.renders&&Math.hypot(a.point.x-b.point.x,a.point.y-b.point.y)>1e-5);
  assert.ok(moving.length>=5,`speed ${speed}: vehicles animate inside a stable world interval, observed ${moving.length} moving pairs`);
  const paused=await page.evaluate(()=>cadenceQA.sample());await page.waitForTimeout(350);
  const pausedAgain=await page.evaluate(()=>cadenceQA.sample());
  assert.equal(pausedAgain.day,paused.day,'pause stops the world clock');
  assert.deepEqual(pausedAgain.point,paused.point,'pause stops vehicle presentation');
  result.speeds.push({speed,elapsed:measured.elapsed,days:measured.afterDay-measured.beforeDay,ordinaryCommits,stablePairs:stable.length,movingRenderedPairs:moving.length,renders:measured.samples.at(-1).renders-measured.samples[0].renders});
 }
 // A speed change commits time spent at the previous rate. Every interval is
 // shorter than the world-update period, exposing dropped/re-rated fractions.
 result.transitions=await page.evaluate(async()=>{
  const day=transport.game.day,times=[];
  for(const speed of [1,3,8]){transport.setSpeed(speed);const from=performance.now();await new Promise(resolve=>setTimeout(resolve,380));times.push({speed,seconds:(performance.now()-from)/1000});}
  transport.setSpeed(0);return{days:transport.game.day-day,expected:times.reduce((sum,part)=>sum+part.seconds*part.speed,0),times,pendingDays:transport.simulation.getStats().pendingDays};
 });
 near(result.transitions.days,result.transitions.expected,.18,'speed transitions retain each interval at its original rate');
 near(result.transitions.pendingDays,0,1e-7,'pausing after speed changes leaves no pending simulation');

 // Headless browser tabs do not reliably enter the platform's hidden state.
 // Dispatch its real lifecycle handler with a controlled visibility getter.
 await page.evaluate(()=>transport.setSpeed(3));await page.waitForTimeout(420);
 const hidden=await page.evaluate(()=>{
  Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));
  return{day:transport.game.day,clock:transport.simulation.getStats()};
 });
 await page.waitForTimeout(1350);
 const hiddenAgain=await page.evaluate(()=>({day:transport.game.day,clock:transport.simulation.getStats()}));
 assert.equal(hiddenAgain.day,hidden.day,'hidden time never advances the world');
 assert.equal(hiddenAgain.clock.activeMs,hidden.clock.activeMs,'hidden time never enters the active-time buffer');
 const resumed=await page.evaluate(async()=>{
  const day=transport.game.day;delete document.hidden;const start=performance.now();document.dispatchEvent(new Event('visibilitychange'));
  await new Promise(resolve=>setTimeout(resolve,360));transport.setSpeed(0);
  return{days:transport.game.day-day,seconds:(performance.now()-start)/1000,clock:transport.simulation.getStats()};
 });
 near(resumed.days,resumed.seconds*3,.25,'returning to the visible page does not catch up hidden time');
 result.hidden={hiddenSeconds:1.35,resumedDays:resumed.days,resumedSeconds:resumed.seconds};
 // BFCache can preserve this same JS instance. Leaving and restoring the page
 // must stop active time even when no separate visibility event is delivered.
 await page.evaluate(()=>transport.setSpeed(3));await page.waitForTimeout(260);
 const leaving=await page.evaluate(()=>{
  window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
  return{day:transport.game.day,clock:transport.simulation.getStats()};
 });
 await page.waitForTimeout(700);
 const left=await page.evaluate(()=>({day:transport.game.day,clock:transport.simulation.getStats()}));
 assert.equal(left.day,leaving.day,'a page preserved in BFCache does not advance the world');
 assert.equal(left.clock.activeMs,leaving.clock.activeMs,'BFCache time never enters the active-time buffer');
 result.pageshow=await page.evaluate(async()=>{
  const day=transport.game.day,start=performance.now();window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
  await new Promise(resolve=>setTimeout(resolve,300));transport.setSpeed(0);
  return{days:transport.game.day-day,seconds:(performance.now()-start)/1000};
 });
 near(result.pageshow.days,result.pageshow.seconds*3,.25,'BFCache restoration starts from a fresh active timestamp');

 // Construction is an immediate user action even though ordinary world work
 // is delayed. Find a real buildable cell instead of altering the fixture.
 const build=await page.evaluate(async()=>{
  const {quoteBuildPlan}=await import('./construction-plan.js'),game=transport.game;
  for(let y=20;y<game.height-20;y+=3)for(let x=20;x<game.width-20;x+=3){
   const tile=game.tiles[y*game.width+x];if(tile.road||tile.rail||tile.building||tile.zone||tile.terrain==='water'||tile.terrain==='mountain')continue;
   const quote=quoteBuildPlan(game,'road',[{x,y}]);if(!quote.ok||quote.buildable!==1)continue;
   transport.setTool('road');transport.renderer.focus(x,y);
   const point=transport.renderer.worldToScreen(x,y),box=document.querySelector('#world').getBoundingClientRect();
   return{x,y,screen:{x:box.left+point.x,y:box.top+point.y},money:game.money,day:game.day,cost:quote.cost};
  }
  throw Error('No buildable cell for the paused construction check.');
 });
 await page.waitForFunction(point=>document.elementFromPoint(point.x,point.y)?.id==='world',build.screen);
 await page.mouse.click(build.screen.x,build.screen.y);
 const built=await page.evaluate(({x,y})=>({road:transport.game.tiles[y*transport.game.width+x].road,money:transport.game.money,day:transport.game.day}),build);
 assert.equal(built.road,true,'paused road construction commits immediately');
 near(build.money-built.money,build.cost,1e-7,'paused construction charges the quoted amount');
 assert.equal(built.day,build.day,'paused construction does not advance world time');
 result.construction={x:build.x,y:build.y,cost:build.cost};
 await page.screenshot({path:`${output}/paused-construction.png`});

 // Save only authoritative state. Presentation proxies and the one-second
 // display buffer must neither change the capture nor leak into storage.
 const checkpoint=await page.evaluate(()=>cadenceQA.summary(transport.game));
 assert.equal(await page.evaluate(()=>transport.persist()),true,'explicit save succeeds with the new clock');
 const saved=await page.evaluate(async()=>{
  const serialized=localStorage.getItem('transport-save-v1'),{restoreGame,validateGame}=await import('./model.js'),game=restoreGame(JSON.parse(serialized));
  if(!validateGame(game))throw Error('Clock checkpoint is invalid.');
  return{summary:cadenceQA.summary(game),serialized};
 });
 assert.deepEqual(saved.summary,checkpoint,'the saved world round-trips exactly while paused');
 await page.reload();await page.locator('#start-menu').waitFor({state:'visible'});
 assert.equal(await page.evaluate(()=>localStorage.getItem('transport-save-v1')),saved.serialized,'opening the menu preserves the checkpoint');
 await loadAutosaveFromMenu(page);
 const loaded=await page.evaluate(async serialized=>{
  const {restoreGame,tick}=await import('./model.js'),expected=restoreGame(JSON.parse(serialized));
  // The menu resumes at speed1 until the Pause button is clicked. Account for
  // that real fraction, including a possible daily boundary or paid delivery.
  tick(expected,transport.game.day-expected.day);
  return{seed:transport.game.seed,day:transport.game.day,money:transport.game.money,expectedMoney:expected.money,routeIds:transport.game.routes.map(route=>route.id),clock:transport.simulation.getStats()};
 },saved.serialized);
 result.reload={checkpointDay:checkpoint.day,loaded};
 await writeFile(`${output}/results.json`,JSON.stringify({...result,errors},null,2));
 assert.equal(loaded.seed,checkpoint.seed);assert.deepEqual(loaded.routeIds,checkpoint.routeIds);
 near(loaded.money,loaded.expectedMoney,1e-7,'loading preserves the company balance and accounts for its brief resumed interval');
 near(loaded.day-checkpoint.day,loaded.clock.activeMs/1000,1e-6,'loading advances exactly the new clock\'s active speed1 interval');
 near(loaded.clock.pendingDays,0,1e-7,'the paused restored world has no pending time');
 result.saved={day:checkpoint.day,restoredDay:loaded.day};
 await page.screenshot({path:`${output}/restored-world.png`});
 // Replacing the company resets pending time and its presentation history.
 // The old world's active milliseconds must never be replayed into a new one.
 await createWorldFromMenu(page,{seed:9271});
 result.newWorld=await page.evaluate(()=>({seed:transport.game.seed,day:transport.game.day,clock:transport.simulation.getStats()}));
 assert.equal(result.newWorld.seed,9271);
 near(result.newWorld.day,result.newWorld.clock.activeMs/1000,1e-6,'a newly created world starts at day zero and advances only its fresh active interval');
 assert.ok(result.newWorld.clock.presentationDay<=result.newWorld.day,'new worlds discard the previous presentation timeline');
 assert.ok(result.newWorld.clock.commits<=Math.ceil(result.newWorld.clock.activeMs/1000)+1,'new worlds discard the previous world\'s commit counter');
 near(result.newWorld.clock.pendingDays,0,1e-7,'the new paused world has no pending time');
 // Loading inside the live Save/load modal follows a different lifecycle from
 // the start menu. Closing it must resume the previous speed after loading ends.
 assert.equal(await page.evaluate(()=>{transport.setSpeed(1);return transport.persist();}),true,'the modal regression has a real autosave to load');
 await page.locator('#world').focus();await page.keyboard.press('Control+s');
 await page.locator('.saves-explorer').waitFor({state:'visible'});
 assert.equal(await page.evaluate(()=>transport.speed),0,'opening Save/load pauses the current world');
 await page.locator('[data-saves-view="load"]').click();
 const autosave=page.locator('[data-save-slot="autosave"]');
 await autosave.locator('[data-save-action="load"]').click();
 await autosave.locator('[data-save-confirm="load"]').click();
 await page.waitForFunction(()=>!document.querySelector('#modal').open&&document.querySelector('#loading-screen').hidden&&transport.speed>0);
 const modalBefore=await page.evaluate(()=>({day:transport.game.day,speed:transport.speed,clock:transport.simulation.getStats()}));
 assert.equal(modalBefore.speed,1,'loading from the live modal restores the previous running speed');
 assert.equal(modalBefore.clock.active,true,'loading from the live modal reactivates the world clock');
 await page.waitForTimeout(1250);
 const modalAfter=await page.evaluate(()=>({day:transport.game.day,clock:transport.simulation.getStats()}));
 assert.ok(modalAfter.day>modalBefore.day,'the world continues advancing after live modal loading');
 assert.ok(modalAfter.clock.commits>modalBefore.clock.commits,'an ordinary one-second commit runs after live modal loading');
 result.modalLoad={beforeDay:modalBefore.day,afterDay:modalAfter.day,commits:modalAfter.clock.commits-modalBefore.clock.commits};
 await page.evaluate(()=>transport.setSpeed(0));
 // A cooperative capture can hold a pause's final fraction. Queue another
 // save and open the menu while capture is held: ordinary frames cannot flush
 // it, so the queued snapshot itself must commit and store every pending day.
 let pausedCapture;
 try{
  pausedCapture=await page.evaluate(async()=>{
   const original=setTimeout,nativeTimer=original.bind(window);let reached,fail,deadline;
   const held=new Promise((resolve,reject)=>{reached=resolve;fail=reject;});
   window.captureQA={restore:()=>{window.setTimeout=original;}};
   window.setTimeout=function(callback,delay,...args){
    if(delay===0&&new Error().stack.includes('world-transfer.js')){
     window.setTimeout=original;
     captureQA.release=()=>{captureQA.release=null;callback(...args);};
     reached();return nativeTimer(()=>{},0);
    }
    return nativeTimer(callback,delay,...args);
   };
   deadline=nativeTimer(()=>fail(Error('The cooperative save did not reach its capture barrier.')),5000);
   transport.setSpeed(1);captureQA.promise=transport.persist();
   try{await held;}finally{clearTimeout(deadline);window.setTimeout=original;}
   await new Promise(resolve=>nativeTimer(resolve,240));transport.setSpeed(0);
   const day=transport.game.day,clock=transport.simulation.getStats();captureQA.promise=transport.persist();
   return{pausedDay:day,pendingDays:clock.pendingDays,expectedDay:day+clock.pendingDays};
  });
  assert.ok(pausedCapture.pendingDays>0,'the held capture retains a genuine active pause fraction');
  await openGameAction(page,'world-button');
  await page.locator('#loading-screen').waitFor({state:'visible'});
  await page.waitForFunction(()=>transport.simulation.getStats().active===false);
 }finally{
  await page.evaluate(()=>{captureQA?.restore?.();captureQA?.release?.();});
 }
 assert.equal(await page.evaluate(()=>captureQA.promise),true,'the queued save completes after capture is released');
 await page.locator('#start-menu').waitFor({state:'visible'});
 const queuedSave=await page.evaluate(()=>({day:transport.game.day,savedDay:JSON.parse(localStorage.getItem('transport-save-v1')).state.day,clock:transport.simulation.getStats()}));
 near(queuedSave.day,pausedCapture.expectedDay,1e-6,'the queued save commits the entire held pause fraction');
 near(queuedSave.savedDay,pausedCapture.expectedDay,1e-6,'the queued snapshot stores the entire held pause fraction');
 near(queuedSave.clock.pendingDays,0,1e-7,'the queued snapshot leaves no pending simulation time');
 await page.locator('#start-resume').click();
 await page.waitForFunction(()=>!document.querySelector('#start-menu')?.open&&!document.querySelector('#loading-screen').open);
 assert.equal(await page.evaluate(()=>transport.speed),0,'resuming after the queued capture preserves the paused speed');
 result.queuedCapture={...pausedCapture,savedDay:queuedSave.savedDay,liveDay:queuedSave.day};
 assert.deepEqual(errors,[],'no uncaught browser errors');
 await writeFile(`${output}/results.json`,JSON.stringify({...result,errors},null,2));
 console.log(`World cadence browser check passed: 1 Hz commits at 1/3/8 speed, smooth immutable vehicle presentation, accurate transitions, pause/hidden time, immediate construction, save/reload, new-world reset, live Save/load resume and queued capture pause accounting. ${output}`);
}finally{await browser.close();}
