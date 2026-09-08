import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.ASHLINE_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.ASHLINE_BROWSER||'chrome',headless:true});
const output=process.env.ASHLINE_SCREENSHOTS||'/tmp/ashline-population-qa';await mkdir(output,{recursive:true});
const errors=[];
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.ASHLINE_URL||'http://127.0.0.1:4173/fun/ashline/');await page.waitForFunction(()=>window.ashline?.booted);await page.locator('#deploy').click();
  await page.locator('#zoom-out').click();await page.locator('#zoom-out').click();
  const result=await page.evaluate(async()=>{
    const {UNIT_CAP,UNITS,raceUnit,updateGame,issueOrder}=await import('./sim.js'),{spriteNativeZoom}=await import('./assets.js'),{encodeGame,decodeGame}=await import('./save.js');
    const s=ashline.state,roles=['rifle','rocket','scout','tank','artillery','striker'],template=structuredClone(s.entities.find(e=>e.kind==='unit'));
    s.aiTeams=[];s.ai.nextThink=1e9;s.terrain.fill(0);s.minerals.fill(0);s.mineralTypes.fill(0);s.navVersion++;
    s.visible.forEach(v=>v.fill(1));s.explored.forEach(v=>v.fill(1));s.entities=s.entities.filter(e=>e.kind==='building');
    for(let team=0;team<2;team++)for(let i=0;i<UNIT_CAP;i++){
      const type=raceUnit(s,team,roles[i%roles.length]),d=UNITS[type];
      s.entities.push({...structuredClone(template),id:s.nextId++,team,type,size:d.size,hp:d.hp,maxHp:d.hp,x:50.5+i%20*1.1,y:43.5+Math.floor(i/20)*1.1+team*16,angle:(i%32)*Math.PI/16,cooldown:1e6,order:{type:'idle'},path:[],kills:0,tech:[]});
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
    return {cap:UNIT_CAP,counts:[0,1].map(t=>restored.entities.filter(e=>e.kind==='unit'&&e.team===t).length),slots,medianMs:frames[Math.floor(frames.length/2)],p95Ms:frames[Math.floor(frames.length*.95)]};
  });
  assert.equal(result.cap,200);assert.deepEqual(result.counts,[200,200]);assert.equal(result.slots,200,'Every member of a 200-unit order has a personal destination');
  await page.waitForTimeout(200);assert.equal(await page.locator('#army').textContent(),'200');assert.match(await page.locator('.army-resource').innerText(),/UNITS \/ 200/);
  if(await page.locator('#command-console').isHidden())await page.locator('#command-toggle').click();await page.locator('#train-tab').click();
  assert(await page.locator('[data-type=harvester]').isDisabled());assert.match(await page.locator('[data-type=harvester]').innerText(),/Unit limit reached \(200\)/);
  if(await page.locator('#command-console').isVisible())await page.locator('#command-close').click();
  await page.screenshot({path:`${output}/400-units.png`});
  assert.deepEqual(errors,[]);console.log('Population browser check passed:',JSON.stringify(result));
}finally{await browser.close();}
