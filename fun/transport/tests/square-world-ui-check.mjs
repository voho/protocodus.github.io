// Isolated browser UI coverage for all selectable square maps and preserved saves.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.TRANSPORT_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.TRANSPORT_BROWSER||'chrome',headless:true});
const url=process.env.TRANSPORT_URL||'http://127.0.0.1:8765/fun/transport/';
const output='/tmp/transport-square-qa';await mkdir(output,{recursive:true});
const errors=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:980}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.waitForFunction(()=>window.transport);await page.evaluate(()=>transport.setSpeed(0));
 assert.deepEqual(await page.evaluate(()=>[transport.game.width,transport.game.height]),[512,512]);
 for(const size of [512,1024,2048]){
  await page.locator('#world-button').click();
  assert.deepEqual(await page.locator('[data-world-size]').evaluateAll(nodes=>nodes.map(n=>n.dataset.worldSize)),['square512','square1024','square2048']);
  await page.locator(`[data-world-size="square${size}"]`).click();
  await page.locator('#world-seed').fill(String(25000+size));
  await page.locator('#generate-world').click();
  await page.waitForFunction(size=>!document.querySelector('#modal').open&&transport.game.width===size,size,{timeout:60000});
  await page.evaluate(()=>transport.setSpeed(0));
  const facts=await page.evaluate(()=>({width:transport.game.width,height:transport.game.height,tiles:transport.game.tiles.length,saved:JSON.parse(localStorage.getItem('transport-save-v1')).state.width,mini:transport.renderer.getStats().minimapWidth}));
  assert.deepEqual([facts.width,facts.height,facts.tiles,facts.saved],[size,size,size*size,size]);assert.ok(facts.mini<=512);
 }
 await page.screenshot({path:`${output}/2048-game.png`});
 await page.locator('#atlas-button').click();
 const rect=await page.locator('#atlas-map').evaluate(el=>({w:el.clientWidth,h:el.clientHeight}));
 assert.ok(Math.abs(rect.w-rect.h)<=1,'square atlas is not stretched');
 await page.screenshot({path:`${output}/2048-atlas.png`});
 await page.keyboard.press('Escape');await page.reload();await page.waitForFunction(()=>window.transport?.game.width===2048,{timeout:60000});
 await page.evaluate(()=>transport.setSpeed(0));assert.equal(await page.evaluate(()=>transport.game.seed),27048);
 await page.close();
 for(const width of[390,320]){
  const mobile=await browser.newPage({viewport:{width,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});mobile.on('pageerror',e=>errors.push(e.message));
  await mobile.goto(url);await mobile.waitForFunction(()=>window.transport);await mobile.evaluate(()=>transport.setSpeed(0));
  await mobile.locator('#world-button').click();
  for(const card of await mobile.locator('[data-world-size]').all())assert.equal(await card.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
  assert.equal(await mobile.locator('#modal').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
  await mobile.screenshot({path:`${output}/mobile-${width}-worlds.png`});
  await mobile.keyboard.press('Escape');await mobile.locator('#atlas-button').click();
  const bounds=await mobile.locator('#atlas-map').evaluate(el=>({width:el.clientWidth,height:el.clientHeight}));assert.ok(Math.abs(bounds.width-bounds.height)<=1);
  await mobile.screenshot({path:`${output}/mobile-${width}-atlas.png`});await mobile.close();
 }
 assert.deepEqual(errors,[]);console.log('Square world UI passed:512²/1024²/2048² creation, autosave reload, bounded square atlas/minimap and mobile options.');
}finally{await browser.close();}
