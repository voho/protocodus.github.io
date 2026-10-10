import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.ASHLINE_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.ASHLINE_BROWSER||'chrome',headless:true});
const output=process.env.ASHLINE_SCREENSHOTS||'/tmp/ashline-population-qa';await mkdir(output,{recursive:true});
const errors=[];
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.ASHLINE_URL||'http://127.0.0.1:8000/fun/ashline/');await page.waitForFunction(()=>window.ashline?.booted);await page.locator('#deploy').click(); await page.waitForFunction(() => ashline.state && !ashline.loading && !ashline.paused, null, {timeout: 120000});
  await page.locator('#zoom-out').click();await page.locator('#zoom-out').click();
  const result=await page.evaluate(async()=>{
    const {UNIT_CAP,UNIT_CAP_PER_NEXUS,unitCapacity,raceUnit,addEntity,updateGame,issueOrder}=await import('./sim.js'),{spriteNativeZoom}=await import('./assets.js'),{encodeGame,decodeGame}=await import('./save.js');
    const s=ashline.state,roles=['rifle','rocket','scout','tank','artillery','striker'];
    s.aiTeams=[];s.ai.nextThink=1e9;s.terrain.fill(0);s.minerals.fill(0);s.mineralTypes.fill(0);s.navVersion++;
    s.visible.forEach(v=>v.fill(1));s.explored.forEach(v=>v.fill(1));s.entities=s.entities.filter(e=>e.kind==='building');
    // Fill each side to the population its single starting nexus allows. addEntity gives the fixture the exact
    // entity shape that live spawns have, so the save round trip below validates real data.
    const caps=[0,1].map(team=>unitCapacity(s,team));
    for(let team=0;team<2;team++)for(let i=0;i<caps[team];i++){
      const e=addEntity(s,team,'unit',raceUnit(s,team,roles[i%roles.length]),50.5+i%20*1.1,43.5+Math.floor(i/20)*1.1+team*16);
      Object.assign(e,{angle:(i%32)*Math.PI/16,cooldown:1e6});
    }
    updateGame(s,.05);s.fogClock=1e6;s.visible.forEach(v=>v.fill(1));
    const selected=s.entities.filter(e=>e.kind==='unit'&&e.team===0);ashline.view.selected=new Set(selected.map(e=>e.id));
    Object.assign(ashline.view,{x:70,y:55.5,zoom:spriteNativeZoom(ashline.renderer.dpr)*.5});
    ashline.renderer.terrainSource=null;
    issueOrder(s,selected.map(e=>e.id),{type:'move',x:80,y:49});
    const slots=new Set(selected.map(e=>`${e.order.x}:${e.order.y}`)).size,frames=[];
    for(let i=0;i<50;i++){
      const start=performance.now();updateGame(s,1/30);ashline.renderer.draw(s,ashline.view);if(i>=10)frames.push(performance.now()-start);
    }
    s.fogClock=0;
    const restored=decodeGame(encodeGame(s)).game;
    s.fogClock=1e6;
    frames.sort((a,b)=>a-b);
    return {cap:UNIT_CAP,perNexus:UNIT_CAP_PER_NEXUS,caps,counts:[0,1].map(t=>restored.entities.filter(e=>e.kind==='unit'&&e.team===t).length),slots,medianMs:frames[Math.floor(frames.length/2)],p95Ms:frames[Math.floor(frames.length*.95)]};
  });
  // One completed nexus grants UNIT_CAP_PER_NEXUS slots; more nexuses raise it toward the UNIT_CAP ceiling.
  const cap=result.perNexus;assert(cap>0&&cap<result.cap);assert.deepEqual(result.caps,[cap,cap]);
  assert.deepEqual(result.counts,[cap,cap]);assert.equal(result.slots,cap,`Every member of a ${cap}-unit order has a personal destination`);
  await page.waitForTimeout(200);assert.equal(await page.locator('#army').textContent(),`${cap} / ${cap}`);
  const capacityTitle=await page.locator('.army-resource').getAttribute('title');
  assert(capacityTitle.startsWith(`${cap} deployed`)&&capacityTitle.includes(`${cap} slots`)&&capacityTitle.includes(`maximum ${result.cap}`),`Capacity tooltip explains per-nexus slots and the ceiling: ${capacityTitle}`);
  if(await page.locator('#command-console').isHidden())await page.locator('#command-toggle').click();await page.locator('#train-tab').click();
  assert(await page.locator('[data-type=harvester]').isDisabled());assert((await page.locator('[data-type=harvester]').innerText()).includes(`Unit limit reached (${cap})`),'Recruitment explains the population limit');
  if(await page.locator('#command-console').isVisible())await page.locator('#command-close').click();
  await page.screenshot({path:`${output}/population-${cap*2}-units.png`});
  assert.deepEqual(errors,[]);console.log('Population browser check passed:',JSON.stringify(result));
}finally{await browser.close();}
