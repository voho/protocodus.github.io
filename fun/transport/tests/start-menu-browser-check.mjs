import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const{chromium}=await import(process.env.TRANSPORT_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.TRANSPORT_BROWSER||'chrome',headless:true});
const base=process.env.TRANSPORT_URL||'http://127.0.0.1:8765/fun/transport/',out=process.env.TRANSPORT_OUTPUT||'/tmp/transport-start-menu-qa';await mkdir(out,{recursive:true});
const errors=[],results=[];
async function ready(page){await page.waitForFunction(()=>window.transport&&document.querySelector('#loading-screen').hidden,{},{timeout:60000});await page.evaluate(()=>transport.setSpeed(0));}
// Continue is offered after the menu's first paint; wait past that before asserting it is absent.
const settled=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,80))));
const overlaps=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
try{
 const page=await browser.newPage({viewport:{width:1440,height:960}});page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.locator('#start-menu').waitFor();
 assert.equal(await page.evaluate(()=>Boolean(window.transport)),false);assert.equal(await page.evaluate(()=>localStorage.length),0);
 await settled(page);assert.equal(await page.locator('#start-continue').count(),0,'no autosave, no Continue');assert.equal(await page.evaluate(()=>document.activeElement.id),'start-new');
 await page.locator('#start-load').click();assert.match(await page.locator('#start-saves').innerText(),/No saved worlds/);
 await page.locator('#start-new').click();await page.locator('input[name=biome][value=desert]').check();await page.locator('[name=townCount]').fill('6');await page.locator('[name=industryDistricts]').fill('2');
 await page.locator('.start-advanced summary').click();await page.locator('[name=seed]').fill('1847');await page.screenshot({path:`${out}/desktop-menu.png`});
 await page.locator('#start-create').click();await ready(page);
 const company=await page.evaluate(()=>({biome:transport.game.biome,towns:transport.game.cities.length,industries:transport.game.industries.length,options:transport.game.generationOptions,seed:transport.game.seed}));
 assert.equal(company.biome,'desert');assert.equal(company.towns,6);assert.deepEqual(company.options,{townCount:6,industryDistricts:2});results.push(company);
 await page.screenshot({path:`${out}/desktop-game.png`});
 // A paused world names itself on the map; dialogs cover it and the chip resumes play.
 const chip=page.locator('.paused-chip');assert.equal(await chip.isVisible(),true);assert.equal(await chip.innerText(),'Paused · Space to resume');
 await page.evaluate(()=>transport.setSpeed(1));await page.locator('#world').focus();assert.equal(await chip.isVisible(),false);
 await page.keyboard.press('Space');await chip.waitFor();assert.equal(await page.evaluate(()=>transport.speed),0);
 await page.keyboard.press('Space');await chip.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>transport.speed),1);
 await page.keyboard.press('Space');await chip.waitFor();await page.keyboard.press('Control+s');await page.locator('#modal[open]').waitFor();assert.equal(await chip.isVisible(),false,'Save/load hides the paused chip');
 await page.locator('#modal .close-modal').click();await chip.waitFor();await chip.click();await chip.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>transport.speed),1);
 await page.evaluate(()=>transport.setSpeed(0));await page.evaluate(()=>transport.persist());
 // Menu navigation does not simulate, discard, or overwrite the current world.
 await page.locator('#game-menu-button').click();await page.locator('#main-menu-button').click();const before=await page.evaluate(()=>({day:transport.game.day,raw:localStorage.getItem('transport-save-v1')}));
 await settled(page);assert.equal(await page.locator('#start-continue').count(),0,'Main menu offers Resume, not Continue');assert.equal(await page.locator('#start-resume').isVisible(),true);assert.equal(await chip.isVisible(),false);
 await page.waitForTimeout(120);await page.keyboard.press('r');assert.equal(await page.evaluate(()=>transport.game.day),before.day);
 await page.locator('#start-resume').click();assert.equal(await page.evaluate(()=>localStorage.getItem('transport-save-v1')),before.raw);
 // Creating a replacement must recover from quota errors without losing saves.
 await page.locator('#game-menu-button').click();await page.locator('#world-button').click();
 await page.evaluate(()=>{window.originalStorageSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='transport-save-v1')throw new DOMException('Quota exceeded','QuotaExceededError');return originalStorageSetItem.call(this,key,value);};});
 await page.locator('#start-create').click();await page.waitForFunction(()=>document.querySelector('#start-message')?.textContent.includes('Could not save'));
 assert.equal(await page.locator('#start-menu').isVisible(),true);assert.equal(await page.evaluate(()=>localStorage.getItem('transport-save-v1')),before.raw);
 await page.evaluate(()=>{Storage.prototype.setItem=originalStorageSetItem;});await page.locator('#start-resume').click();
 // Reload opens a menu and preserves autosave until the player selects Continue.
 await page.reload();await page.locator('#start-menu').waitFor();assert.equal(await page.evaluate(()=>Boolean(window.transport)),false);assert.equal(await page.evaluate(()=>localStorage.getItem('transport-save-v1')),before.raw);
 const resume=page.locator('#start-continue');await resume.waitFor();assert.equal(await page.evaluate(()=>document.activeElement.id),'start-continue');
 assert.equal(await resume.locator('strong').innerText(),'Continue');assert.match(await resume.locator('small').innerText(),/^Desert · Jan 1950 · \$[\d,]+ · saved (just now|\d+ minutes? ago)$/);
 await page.locator('#start-load').click();assert.match(await page.locator('.start-save').filter({hasText:'Autosave'}).locator('small').innerText(),/^Desert · Jan 1950 · \$[\d,]+ · \d+ × \d+ · 1 route$/);
 await page.screenshot({path:`${out}/desktop-continue.png`});await resume.click();await ready(page);
 assert.deepEqual(await page.evaluate(()=>transport.game.generationOptions),company.options);assert.equal(await page.evaluate(()=>transport.game.seed),1847);
 const mobile=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,reducedMotion:'reduce'});mobile.on('pageerror',e=>errors.push(e.message));await mobile.goto(base);await mobile.locator('#start-menu').waitFor();
 assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth),390);const box=await mobile.locator('#start-create').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390&&box.height>=44);
 await mobile.screenshot({path:`${out}/mobile-menu.png`});await mobile.locator('#start-create').click();await ready(mobile);await mobile.screenshot({path:`${out}/mobile-game.png`});
 const mobileChip=mobile.locator('.paused-chip');assert.equal(await mobileChip.innerText(),'Paused · Tap to resume');await mobile.evaluate(()=>transport.setTool('road'));
 const chipBox=await mobileChip.boundingBox(),barBox=await mobile.locator('#active-tool-bar').boundingBox();assert.ok(chipBox.x>=0&&chipBox.x+chipBox.width<=390&&!overlaps(chipBox,barBox),'the paused chip clears the active tool bar');
 await mobile.screenshot({path:`${out}/mobile-paused-tool.png`});assert.deepEqual(errors,[]);
 console.log(JSON.stringify({results,errors,out},null,2));
}finally{await browser.close();}
