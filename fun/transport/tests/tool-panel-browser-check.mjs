import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu } from './browser-start.mjs';
const { chromium }=await import(process.env.TRANSPORT_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.TRANSPORT_BROWSER||'chrome',headless:true});
const out=process.env.TRANSPORT_SCREENSHOTS||'/tmp/transport-tool-panel';await mkdir(out,{recursive:true});
const errors=[];
try{
 const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:2});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.TRANSPORT_URL||'http://127.0.0.1:8765/fun/transport/');await createWorldFromMenu(page,{size:'square512'});
 await page.evaluate(()=>{transport.setView('build');window.roadCard=document.querySelector('[data-tool="road"]');window.roadArt=roadCard.querySelector('canvas');});
 for(const tool of ['road','stop','inspect']){
  await page.evaluate(tool=>transport.setTool(tool),tool);
  assert.equal(await page.evaluate(()=>document.querySelector('[data-tool="road"]')===roadCard&&roadCard.querySelector('canvas')===roadArt),true,'pure selection keeps authored card art and DOM');
  assert.equal(await page.locator('[data-build-stop-mode]').evaluate(el=>!el.hidden),tool==='stop');
  assert.equal(await page.locator('#panel-content [data-tool][aria-pressed="true"]').count(),tool==='inspect'?0:1);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'world');
 }
 assert.equal(await page.evaluate(()=>{transport.game.money+=1000;transport.game.revision++;transport.setTool('road');return document.querySelector('[data-tool="road"]')!==roadCard;}),true,'world and price changes rebuild the drawer');
 await page.evaluate(()=>{transport.setTool('stop');transport.setView('build');});await page.locator('[data-stop-mode="rail"]').click();
 assert.equal(await page.locator('[data-stop-mode="rail"]').getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('[data-tool="stop"] canvas').getAttribute('data-infrastructure-sprite'),'train-stop');
 assert.equal(await page.locator('[data-tool="railbridge"]').count(),1);
 await page.locator('[data-category="towns"]').click();
 const next=await page.locator('#building-group option').nth(1).getAttribute('value');await page.locator('#building-group').selectOption(next);
 const group=await page.evaluate(async()=>{const {BUILDINGS}=await import('./buildings.js');return [...document.querySelectorAll('.building-card')].map(el=>BUILDINGS[el.dataset.tool].group);});
 assert.ok(group.length);assert.ok(group.every(value=>value===next));
 const building=await page.locator('.building-card').first().getAttribute('data-tool');await page.locator('.building-card').first().click();
 assert.equal(await page.locator(`.building-card[data-tool="${building}"]`).getAttribute('aria-pressed'),'true');
 await page.evaluate(()=>transport.setView('build'));await page.locator('[data-category="industry"]').click();const industry=await page.locator('.industry-tool').first().getAttribute('data-tool');await page.locator('.industry-tool').first().click();
 assert.equal(await page.locator(`.industry-tool[data-tool="${industry}"]`).getAttribute('aria-pressed'),'true');
 await page.evaluate(()=>transport.setView('build'));await page.locator('[data-category="network"]').click();await page.locator('[data-tool="rail"]').click();await page.evaluate(()=>transport.setView('build'));
 await page.locator('.engineering-tools summary').click();await page.locator('[data-tool="railbridge"]').click();
 assert.equal(await page.locator('.engineering-tools').evaluate(el=>el.open),true);assert.equal(await page.locator('[data-crossing-mode="rail"]').getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('[data-tool="railbridge"]').getAttribute('aria-pressed'),'true');
 await page.evaluate(()=>transport.setView('industry'));
 const identity=await page.evaluate(()=>{
  window.siteCard=document.querySelector('#entity-list [data-industry]');window.siteArt=siteCard.querySelector('canvas');window.siteArts=new Set(document.querySelectorAll('#entity-list canvas'));
  const search=document.querySelector('#entity-search');search.dispatchEvent(new Event('input'));
  return{card:document.querySelector('#entity-list [data-industry]')===siteCard,art:document.querySelector('#entity-list canvas')===siteArt};
 });assert.deepEqual(identity,{card:true,art:true},'unchanged entity refresh preserves its interactive card and portrait');
 const updated=await page.evaluate(()=>{
  const site=transport.game.industries.find(site=>String(site.id)===siteCard.dataset.industry),before=siteCard.title;
  site.inventory={...site.inventory,qa:1};document.querySelector('#entity-search').dispatchEvent(new Event('input'));
  const card=document.querySelector(`#entity-list [data-industry="${site.id}"]`);
  return{cardChanged:card!==siteCard,titleChanged:card.title!==before,art:siteArts.has(card.querySelector('canvas'))};
 });assert.deepEqual(updated,{cardChanged:true,titleChanged:true,art:true},'changed inventory updates the card while retaining its portrait');
 await page.locator('#entity-search').fill('no matching site qa');assert.equal(await page.locator('#entity-list [data-industry]').count(),0);
 await page.locator('#entity-search').fill('');assert.ok(await page.locator('#entity-list [data-industry]').count());
 const kind=await page.locator('#industry-kind option').nth(1).getAttribute('value');await page.locator('#industry-kind').selectOption(kind);
 assert.equal(await page.evaluate(kind=>[...document.querySelectorAll('#entity-list [data-industry]')].every(card=>transport.game.industries.find(site=>String(site.id)===card.dataset.industry).kind===kind),kind),true);
 await page.locator('#industry-kind').selectOption('all');await page.locator('#entity-list [data-industry]').first().click();
 assert.equal(await page.locator('#inspector').evaluate(el=>!el.hidden),true,'retained card listeners still inspect the selected site');
 await page.screenshot({path:`${out}/tool-panel.png`});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks:'card/art reuse, selection, stop/crossing modes, categories, building dropdown, engineering, canvas focus, world/price refresh, entity refresh/filter/inspection',errors}));
}finally{await browser.close();}
