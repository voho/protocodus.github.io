// Real browser checks use a fresh context; the player's storage is never touched.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu, openGameAction } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/';
const output = '/tmp/transport-cohesion-qa';
await mkdir(output,{recursive:true});
const errors=[];
try {
 const page=await browser.newPage({viewport:{width:1440,height:960}});
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(url);await createWorldFromMenu(page);
 assert.deepEqual(await page.evaluate(()=>[transport.game.width,transport.game.height,transport.game.cities.length]),[512,512,48]);
 await page.locator('.main-nav [data-view="build"]').click();
 await page.locator('.project-card summary').click();
 assert.match(await page.locator('.project-card').innerText(),/first cargo route/);
 await page.locator('[data-project-action="source"]').click();
 assert.equal(await page.locator('#inspector').isVisible(),true);
 assert.ok(await page.locator('.industry-target').count()>0);
 await page.screenshot({path:`${output}/first-cargo-project.png`});
 await page.locator('#inspector .tiny-button').click();
 await page.locator('[data-view="industry"]').click();
 assert.equal(await page.locator('[data-industry]').count(),40,'Industries shows its 96 sites 40 to a page');
 await page.locator('#industry-kind').selectOption('steel-mill');
 // Eight steel mills fit on one page, so the list holds every one.
 assert.equal(await page.locator('[data-industry]').count(),await page.evaluate(()=>transport.game.industries.filter(site=>site.kind==='steel-mill').length));
 assert.match(await page.locator('.site-status').first().innerText(),/^Idle$/,'a mill nothing has supplied yet is idle, not a fault');
 await page.locator('#entity-search').fill('no-such-site');
 assert.equal(await page.locator('[data-industry]').count(),0);
 await page.waitForTimeout(7300);
 assert.equal(await page.locator('#entity-search').inputValue(),'no-such-site','periodic status updates preserve query');
 assert.equal(await page.locator('#entity-search').evaluate(el=>el===document.activeElement),true,'refresh preserves search focus');
 await page.locator('#entity-search').fill('steel');
 await page.locator('[data-industry]').first().click();
 assert.match(await page.locator('.industry-condition').innerText(),/makes steel once it gets iron ore and coal\./);
 await page.locator('#panel-content').evaluate(el=>el.scrollTop=el.scrollHeight);
 await page.locator('[data-view="build"]').click();
 assert.equal(await page.locator('#panel-content').evaluate(el=>el.scrollTop),0,'switching views returns to the main tools');
 await page.evaluate(async()=>{const {tick,build}=await import('./model.js');tick(transport.game,10);const c=transport.game.cities[0];for(let y=c.y-10;y<c.y+10;y++)for(let x=c.x-10;x<c.x+10;x++){const result=build(transport.game,'road',x,y);if(result.ok)return;}});
 await page.waitForTimeout(600);
 const money=await page.evaluate(()=>({net:Math.floor(transport.game.monthlyIncome-transport.game.monthlyIncomeAtAccountingStart-transport.game.monthlyOperatingExpenses),capital:Math.floor(transport.game.monthlyExpenses-transport.game.monthlyOperatingExpenses)}));
 await page.locator('#company-stats').click();
 assert.equal(await page.locator('#profit-exact').innerText(),`${money.net<0?'−':'+'}$${Math.abs(money.net).toLocaleString('en-US')}`);
 assert.equal(await page.locator('#building-exact').innerText(),`$${money.capital.toLocaleString('en-US')}`);
 await page.locator('#company-stats').click();
 await page.evaluate(()=>transport.setView('routes'));
 assert.match(await page.locator('[data-route-revenue]').first().getAttribute('title'),/route upkeep/i);
 // Cached formatters print the dates toLocaleDateString printed in the HUD and on route cards.
 await page.waitForFunction(()=>document.querySelector('[data-route-revenue]')?.title.includes('Tracked since'));
 const dates=await page.evaluate(()=>{const g=transport.game,r=g.routes[0],date=(day,options)=>new Date(Date.UTC(1950,0,1+Math.floor(day))).toLocaleDateString('en-US',{...options,timeZone:'UTC'}),short={day:'numeric',month:'short',year:'numeric'};return{month:date(g.day,{month:'short',year:'numeric'}),long:date(g.day,{day:'numeric',month:'long',year:'numeric'}),since:date(r.accountingStartDay||0,short),company:date(g.accountingStartDay||0,short)};});
 assert.equal(await page.locator('#date').textContent(),dates.month);assert.equal(await page.locator('#date').getAttribute('title'),dates.long);
 assert.ok((await page.locator('[data-route-revenue]').first().getAttribute('title')).includes(`Tracked since ${dates.since} ·`));
 assert.equal(await page.locator('[data-route-rate]').first().getAttribute('title'),`Average since ${dates.since}`);
 assert.equal(await page.locator('#profit-exact').getAttribute('title'),`Operating figures tracked since ${dates.company}`);
 // Disconnect and repair while paused: diagnostics must not wait for time to advance.
 await page.evaluate(async()=>{const {build,refreshRouteConnections}=await import('./model.js');const g=transport.game,c=g.cities[0];for(let y=0;y<g.height;y++){const t=g.tiles[y*g.width+c.x+12];if(t.road&&!g.stations.some(s=>s.x===c.x+12&&s.y===y))build(g,'bulldoze',c.x+12,y);}refreshRouteConnections(g);});
 await page.waitForFunction(()=>document.querySelector('[data-route-status]')?.textContent==='Not connected');
 assert.equal(await page.evaluate(()=>transport.speed),0);
 // New world activation is transactional even when the browser rejects writes.
 // Opening the main menu saves the current company first, so capture it afterwards.
 await openGameAction(page,'world-button');await page.locator('#start-world-form').waitFor();
 const before=await page.evaluate(()=>({seed:transport.game.seed,width:transport.game.width,raw:localStorage.getItem('transport-save-v1')}));
 assert.equal(await page.locator('#start-world-form [name="size"] option').count(),3);
 await page.locator('.start-advanced summary').click();await page.locator('#start-world-form [name="seed"]').fill('98261');await page.locator('#start-world-form [name="size"]').selectOption('square512');
 await page.evaluate(()=>{window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('Full','QuotaExceededError');};});
 await page.locator('#start-create').click();
 await page.waitForFunction(()=>document.querySelector('#start-message')?.textContent.includes('Existing saves are unchanged')&&!document.querySelector('#start-create').disabled);
 assert.deepEqual(await page.evaluate(()=>({seed:transport.game.seed,width:transport.game.width,raw:localStorage.getItem('transport-save-v1')})),before);
 assert.equal(await page.locator('#start-menu').evaluate(el=>el.open),true);
 assert.match(await page.locator('#start-message').innerText(),/Existing saves are unchanged/);
 await page.evaluate(()=>{Storage.prototype.setItem=window.originalSetItem;});
 await page.keyboard.press('Escape');
 await page.locator('#start-menu').waitFor({state:'detached'});
 assert.equal(await page.evaluate(()=>transport.game.seed),before.seed,'Escape resumes the unchanged company');
 assert.deepEqual(errors,[]);
 console.log('Cohesion browser checks passed: square opening, actionable freight, searches/focus, production explanations, operating accounts, paused disconnection, safe new worlds.');
} finally {await browser.close();}
