import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {APP_PRELOAD} from '../app-preload.js';
import {openGameAction} from './browser-start.mjs';
const startupHTML=await readFile(new URL('../index.html',import.meta.url),'utf8');
const startupPreloads=[...startupHTML.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map(match=>match[1]);
const{chromium}=await import(process.env.TRANSPORT_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.TRANSPORT_BROWSER||'chrome',headless:true});
const base=process.env.TRANSPORT_URL||'http://127.0.0.1:8765/fun/transport/',out=process.env.TRANSPORT_OUTPUT||'/tmp/transport-start-menu-qa';await mkdir(out,{recursive:true});
const errors=[],results=[];
async function ready(page){await page.waitForFunction(()=>window.transport&&document.querySelector('#loading-screen').hidden,{},{timeout:60000});await page.evaluate(()=>transport.setSpeed(0));}
// Continue is offered after the menu's first paint; wait past that before asserting it is absent.
const settled=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,80))));
try{
 const page=await browser.newPage({viewport:{width:1440,height:960}});page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.locator('#start-menu').waitFor();
 assert.equal(await page.evaluate(()=>Boolean(window.transport)),false);assert.equal(await page.evaluate(()=>localStorage.length),0);
 await settled(page);assert.equal(await page.locator('#start-continue').count(),0,'no autosave, no Continue');assert.equal(await page.evaluate(()=>document.activeElement.id),'start-new');
 // The idle menu fetches the game's modules once, without running them or reaching for the world worker.
 await page.waitForFunction(()=>performance.getEntriesByType('resource').some(e=>e.name.endsWith('/app.js')));
 const preload=await page.evaluate(()=>({head:[...document.head.querySelectorAll('link[rel=modulepreload]')].map(link=>link.href),worker:performance.getEntriesByType('resource').some(e=>e.name.includes('world-worker')),transport:Boolean(window.transport)}));
 assert.deepEqual(preload,{head:[...startupPreloads,...APP_PRELOAD].map(path=>new URL(path,base).href),worker:false,transport:false});
 await page.locator('#start-load').click();assert.match(await page.locator('#start-saves').innerText(),/No saved worlds/);
 await page.locator('#start-new').click();await page.locator('input[name=biome][value=desert]').check();
 const landscape=await page.locator('#start-landscape').evaluate(async image=>{await image.decode();return {source:image.getAttribute('src'),width:image.naturalWidth};});
 assert.equal(landscape.source,'./assets/ui/start-desert.webp');assert.equal(landscape.width,1080,'landscape preview decodes from the static capture');
 assert.equal(await page.evaluate(()=>Boolean(window.transport)),false,'changing landscape does not start the game');assert.equal(await page.evaluate(()=>localStorage.length),0,'previewing landscape preserves storage');
 // A value out of range under a folded More options unfolds it and points at the field instead of blocking Create in silence.
 await page.locator('.start-advanced summary').click();await page.locator('[name=townCount]').fill('500');await page.locator('.start-advanced summary').click();
 await page.locator('#start-create').click();await page.waitForFunction(()=>document.querySelector('.start-advanced').open);
 assert.equal(await page.evaluate(()=>document.activeElement?.name),'townCount','the browser points at the out-of-range field');
 assert.ok(await page.locator('#start-menu').evaluate(el=>el.open)&&await page.locator('#loading-screen').evaluate(el=>!el.open),'no world is created');
 await page.locator('[name=townCount]').fill('6');await page.locator('[name=industryDistricts]').fill('2');
 await page.locator('[name=seed]').fill('1847');await page.screenshot({path:`${out}/desktop-menu.png`});
 await page.locator('#start-create').click();await ready(page);
 const company=await page.evaluate(()=>({biome:transport.game.biome,towns:transport.game.cities.length,industries:transport.game.industries.length,options:transport.game.generationOptions,seed:transport.game.seed}));
 assert.equal(company.biome,'desert');assert.equal(company.towns,6);assert.deepEqual(company.options,{townCount:6,industryDistricts:2});results.push(company);
 await page.screenshot({path:`${out}/desktop-game.png`});
 // A paused world says so under the date, in orange, and draws an orange line along the top of the map; Space and 1× resume.
 const note=page.locator('#date-note'),paused=()=>page.evaluate(()=>document.querySelector('#app').classList.contains('is-paused'));
 assert.equal(await note.innerText(),'Paused');assert.equal(await paused(),true);assert.match(await page.locator('.date-block').getAttribute('title'),/Press Space to resume/);
 await page.evaluate(()=>transport.setSpeed(1));await page.locator('#world').focus();assert.notEqual(await note.innerText(),'Paused');assert.equal(await paused(),false);
 await page.keyboard.press('Space');await page.waitForFunction(()=>document.querySelector('#date-note').textContent==='Paused');assert.equal(await page.evaluate(()=>transport.speed),0);
 await page.keyboard.press('Space');await page.waitForFunction(()=>document.querySelector('#date-note').textContent!=='Paused');assert.equal(await page.evaluate(()=>transport.speed),1);
 await page.keyboard.press('Space');await page.keyboard.press('Control+s');await page.locator('#modal[open]').waitFor();
 await page.locator('#modal .close-modal').click();assert.equal(await note.innerText(),'Paused','a dialog keeps the pause it started');await page.locator('[data-speed="1"]').click();assert.equal(await paused(),false);assert.equal(await page.evaluate(()=>transport.speed),1);
 await page.evaluate(()=>transport.setSpeed(0));await page.evaluate(()=>transport.persist());
 // Menu navigation does not simulate, discard, or overwrite the current world.
 await openGameAction(page,'main-menu-button');const before=await page.evaluate(()=>({day:transport.game.day,raw:localStorage.getItem('transport-save-v1')}));
 await settled(page);assert.equal(await page.locator('#start-continue').count(),0,'Main menu offers Resume, not Continue');assert.equal(await page.locator('#start-resume').isVisible(),true);
 assert.equal(await page.evaluate(()=>document.head.querySelectorAll('link[rel=modulepreload]').length),startupPreloads.length+APP_PRELOAD.length,'the in-game menu preloads nothing again');
 await page.waitForTimeout(120);await page.keyboard.press('r');assert.equal(await page.evaluate(()=>transport.game.day),before.day);
 await page.locator('#start-resume').click();assert.equal(await page.evaluate(()=>localStorage.getItem('transport-save-v1')),before.raw);
 // Creating a replacement must recover from quota errors without losing saves.
 await openGameAction(page,'world-button');
 await page.evaluate(()=>{window.originalStorageSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='transport-save-v1')throw new DOMException('Quota exceeded','QuotaExceededError');return originalStorageSetItem.call(this,key,value);};});
 await page.locator('#start-create').click();await page.waitForFunction(()=>document.querySelector('#start-message')?.textContent.includes('Could not save'));
 assert.equal(await page.locator('#start-menu').isVisible(),true);assert.equal(await page.evaluate(()=>localStorage.getItem('transport-save-v1')),before.raw);
 await page.evaluate(()=>{Storage.prototype.setItem=originalStorageSetItem;});await page.locator('#start-resume').click();
 // Reload opens a menu and preserves autosave until the player selects Continue.
 await page.reload();await page.locator('#start-menu').waitFor();assert.equal(await page.evaluate(()=>Boolean(window.transport)),false);assert.equal(await page.evaluate(()=>localStorage.getItem('transport-save-v1')),before.raw);
 const resume=page.locator('#start-continue');await resume.waitFor();assert.equal(await page.evaluate(()=>document.activeElement.id),'start-continue');
 assert.equal(await resume.locator('strong').innerText(),'Continue');assert.match(await resume.locator('small').innerText(),/^Desert, Jan 1950, saved (just now|\d+ minutes? ago)$/);
 await page.locator('#start-load').click();assert.match(await page.locator('.start-save').filter({hasText:'Autosave'}).locator('small').innerText(),/^Desert, Jan 1950, \$[\d,]+, \d+ × \d+, 1 route$/);
 await page.screenshot({path:`${out}/desktop-continue.png`});await resume.click();await ready(page);
 assert.deepEqual(await page.evaluate(()=>transport.game.generationOptions),company.options);assert.equal(await page.evaluate(()=>transport.game.seed),1847);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({results,errors,out},null,2));
}finally{await browser.close();}
