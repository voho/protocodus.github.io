// Optional full-world smoke (several minutes on a software GPU):
// node fun/hedgerow/tests/runtime-browser-smoke.mjs [mission-id] [quality]
// Captures actual rendered scenes, then tests simulation/menus without
// submitting extra GPU frames. This is not a performance benchmark or a
// complete combat playthrough. Do not add ?debug: its hidden-frame watchdog
// intentionally keeps drawing even when requestAnimationFrame is controlled.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
const server = createServer(async (req, res) => {
  try {
    let path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!path.startsWith(root)) throw new Error('path');
    let info = await stat(path);
    if (info.isDirectory()) { path = resolve(path, 'index.html'); info = await stat(path); }
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Content-Length': info.size });
    createReadStream(path).on('error', () => res.destroy()).pipe(res);
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const mission = process.argv[2] || 'saint-clair';
const quality = process.argv[3] || 'medium';
const out = resolve(process.env.HEDGEROW_QA_OUTPUT || resolve(root, 'work/qa-world'), `${mission}-${quality}`) + sep;
await mkdir(out, {recursive:true});
const executablePath = process.env.CHROMIUM_PATH || (await stat('/usr/bin/chromium').catch(() => null) ? '/usr/bin/chromium' : undefined);
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless:true, args:['--enable-unsafe-swiftshader','--use-angle=swiftshader'] });
const page = await browser.newPage({viewport:{width:960,height:640}});
page.setDefaultTimeout(30000);
page.setDefaultNavigationTimeout(30000);
const errors=[];
page.on('pageerror', e=>errors.push(e.stack));
page.on('console', m=>{ if(m.type()==='error') errors.push(m.text()); if(m.text().startsWith('QA:')) console.log(m.text()); });
page.on('response',r=>{if(r.status()>=400 && new URL(r.url()).origin===origin) errors.push(`${r.status()} ${r.url()}`);});
await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.fulfill({body:''}));
await page.addInitScript(q=>{
  localStorage.setItem('hedgerow.settings',JSON.stringify({quality:q,volume:0}));
  const raf=requestAnimationFrame;
  window.requestAnimationFrame=cb=>cb.name==='frame'?0:raf(cb);
  document.addEventListener('DOMContentLoaded',()=>{
    const label=document.querySelector('[data-loading-label]');
    let previous='';
    new MutationObserver(()=>{ const next=label.textContent.split(' · ')[0]; if(next!==previous){previous=next;console.log('QA: '+next);} }).observe(label,{childList:true,subtree:true});
  });
},quality);
const report={mission,quality};
try{
  console.log(`Loading ${mission} ${quality}`);
  await page.goto(`${origin}/fun/hedgerow/?mission=${mission}&god`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.hedgerow?.state==='menu',null,{timeout:300000,polling:1000});
  console.log('Rendering menu');
  await page.evaluate(()=>hedgerow.step());
  await page.screenshot({path:out+'menu.png',animations:'disabled',timeout:120000});
  console.log('Opening briefing');
  await page.locator('[data-action="briefing"]').click({force:true});
  assert.equal(await page.locator('[data-screen="briefing"]').getAttribute('aria-hidden'),'false');
  await page.screenshot({path:out+'briefing.png',animations:'disabled',timeout:120000});
  console.log('Starting mission');
  await page.locator('[data-action="start"]').click({force:true});
  await page.waitForFunction(()=>hedgerow.state==='playing',null,{timeout:10000,polling:100});
  await page.evaluate(async()=>{
    const renderer=hedgerow.G.renderer, draw=renderer.render; renderer.render=()=>{};
    for(let i=0;i<35;i++){await new Promise(r=>setTimeout(r,16));hedgerow.step();}
    renderer.render=draw; hedgerow.step();
  });
  await page.screenshot({path:out+'gameplay.png',animations:'disabled',timeout:120000});
  report.initial=await page.evaluate(()=>({state:hedgerow.state,position:hedgerow.G.player.pos.toArray(),weapon:hedgerow.G.player.weapon,ammo:hedgerow.G.player.ammo[hedgerow.G.player.weapon].mag,render:hedgerow.G.renderer.info.render,objective:document.querySelector('[data-objective-text]').textContent}));
  console.log('Checking fire, aim, pause, settings');
  await page.evaluate(()=>{window.qaDraw=hedgerow.G.renderer.render;hedgerow.G.renderer.render=()=>{};});
  await page.evaluate(()=>{hedgerow.input.test.click();hedgerow.step();});
  report.afterShot=await page.evaluate(()=>hedgerow.G.player.ammo[hedgerow.G.player.weapon].mag);
  assert.equal(report.afterShot,report.initial.ammo-1);
  report.aimRequested=await page.evaluate(()=>{
    const player=hedgerow.G.player, boltActive=player.boltAge>=0;
    hedgerow.input.test.aim(true);hedgerow.step();
    return {boltActive,boltAge:player.boltAge,aiming:player.wasAiming};
  });
  if(report.aimRequested.boltActive) assert.equal(report.aimRequested.aiming,false,'aim stays suppressed during the real bolt cycle');
  else assert.equal(report.aimRequested.aiming,true,'an idle weapon can aim immediately');
  // Kar98k aim resumes after its production bolt action. With the RAF frozen,
  // advance the real main loop; never alter action fields to skip the cycle.
  report.aimRecovery=await page.evaluate(async()=>{
    const player=hedgerow.G.player, start=hedgerow.G.time;
    let steps=0;
    while(player.boltAge>=0 && hedgerow.state==='playing' && steps<180 && hedgerow.G.time-start<3){
      await new Promise(r=>setTimeout(r,16));hedgerow.step();steps++;
    }
    const boltAge=player.boltAge, elapsed=hedgerow.G.time-start;
    // The cycle clears at the end of player.update; aim is resolved next step.
    if(boltAge<0){await new Promise(r=>setTimeout(r,16));hedgerow.step();}
    return {steps,elapsed,boltAge,aiming:player.wasAiming,state:hedgerow.state};
  });
  assert.equal(report.aimRecovery.state,'playing','the aim check remains in normal simulation');
  assert.ok(report.aimRecovery.boltAge<0,'the bolt cycle completes within 180 steps and 3 simulation seconds');
  assert.equal(report.aimRecovery.aiming,true,'held aim resumes on the next real step');
  await page.evaluate(()=>document.exitPointerLock());
  await page.waitForFunction(()=>hedgerow.state==='paused',null,{polling:100});
  await page.screenshot({path:out+'pause.png',animations:'disabled',timeout:120000});
  await page.locator('[data-screen="pause"] [data-action="settings"]').click({force:true});
  await page.locator('[data-setting="cameraShake"]').uncheck({force:true});
  await page.locator('[data-setting="motionBlur"]').check({force:true});
  report.preferences=await page.evaluate(()=>({motionBlur:hedgerow.G.settings.motionBlur,cameraMotion:hedgerow.G.rig.cameraMotion}));
  assert.deepEqual(report.preferences,{motionBlur:true,cameraMotion:0});
  await page.screenshot({path:out+'settings.png',animations:'disabled',timeout:120000});
  console.log('Checking death while paused and checkpoint recovery');
  await page.locator('[data-screen="settings"] [data-action="back"]').click({force:true});
  await page.locator('[data-action="resume"]').click({force:true});
  await page.waitForFunction(()=>hedgerow.state==='playing',null,{polling:100});
  await page.evaluate(()=>{hedgerow.G.godMode=false;hedgerow.G.player.damage(1000);document.exitPointerLock();});
  await page.waitForFunction(()=>hedgerow.state==='paused',null,{polling:100});
  report.deathPaused=await page.evaluate(async()=>{
    const before={time:hedgerow.G.time,health:hedgerow.G.player.health,alive:hedgerow.G.player.alive};
    for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,16));hedgerow.step();}
    return {before,after:{time:hedgerow.G.time,health:hedgerow.G.player.health,alive:hedgerow.G.player.alive},state:hedgerow.state};
  });
  assert.equal(report.deathPaused.state,'paused','the death camera remains paused');
  assert.equal(report.deathPaused.before.alive,false,'the real damage call killed the player');
  assert.deepEqual(report.deathPaused.after,report.deathPaused.before,'paused main steps preserve the dead player and simulation clock');
  await page.locator('[data-action="resume"]').click({force:true});
  // The game RAF is deliberately frozen above. Advance the production main
  // loop so its simulation-time death camera can finish after resuming.
  // Wall-clock waiting alone would leave the presentation frozen forever.
  report.deathPresentation=await page.evaluate(async()=>{
    const start=hedgerow.G.time;
    let steps=0;
    while(hedgerow.state==='playing' && steps<400){
      await new Promise(r=>setTimeout(r,16));hedgerow.step();steps++;
    }
    const arrived=hedgerow.state;
    for(let i=0;i<10;i++){await new Promise(r=>setTimeout(r,16));hedgerow.step();}
    return {steps,elapsed:hedgerow.G.time-start,arrived,state:hedgerow.state};
  });
  assert.equal(report.deathPresentation.arrived,'dead','resumed simulation steps finish the death camera');
  assert.equal(report.deathPresentation.state,'dead','the death menu remains stable');
  await page.locator('[data-screen="dead"] [data-action="checkpoint"]').click({force:true});
  await page.waitForFunction(()=>hedgerow.G.player.alive && hedgerow.state==='playing',null,{polling:100});
  report.checkpointRecovery=true;
  assert.deepEqual(errors,[]);
  console.log('PASS',report);
}catch(e){report.failure=e.stack;console.log('FAIL',e.message);console.log(await page.evaluate(()=>({state:window.hedgerow?.state,loading:document.querySelector('[data-loading-label]')?.textContent,error:document.querySelector('[data-error-text]')?.textContent})).catch(()=>null));await page.screenshot({path:out+'failure.png',timeout:10000}).catch(()=>{});process.exitCode=1;}
finally{report.errors=errors;await writeFile(out+'report.json',JSON.stringify(report,null,2));await browser.close();await new Promise(done=>server.close(done));}
