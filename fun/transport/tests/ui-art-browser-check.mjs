// Generated art must remain visible through panel changes, filtering and DPR scaling.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu, openGameAction } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-ui-art';
await mkdir(output, { recursive: true });
const errors = [];
async function portraits(page, selector, density, minimum = 1) {
  const result = await page.locator(selector).evaluateAll(canvases => canvases.map(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let painted = 0;for(let i=3;i<pixels.length;i+=4)if(pixels[i])painted++;
    return { drawn: canvas.dataset.artDrawn, width: canvas.width, logicalWidth: Number(canvas.dataset.artWidth), painted };
  }));
  assert.ok(result.length >= minimum, `Expected ${minimum} portraits for ${selector}`);
  for(const portrait of result) {
    assert.ok(portrait.drawn, `Missing render marker: ${selector}`);
    assert.ok(portrait.painted > 30, `Blank portrait: ${selector}`);
    assert.equal(portrait.width, portrait.logicalWidth * density, `Wrong UI density: ${selector}`);
  }
}
try {
  for(const profile of [{name:'desktop',width:1440,height:1000,density:1},{name:'desktop-hidpi',width:1440,height:1000,density:2}]) {
    const page = await browser.newPage({ viewport:{width:profile.width,height:profile.height}, deviceScaleFactor:profile.density });
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(url);await createWorldFromMenu(page);
    await page.evaluate(()=>{transport.setSpeed(0);transport.setView('build');});
    await portraits(page,'#panel-content [data-infrastructure-sprite]',profile.density,4);
    await page.locator('[data-category="towns"]').click();
    await portraits(page,'#panel-content [data-building-sprite]',profile.density,9);
    assert.equal(await page.locator('[data-building-sprite]').first().evaluate(el=>getComputedStyle(el).imageRendering),'auto');
    await page.locator('[data-category="industry"]').click();
    await portraits(page,'#panel-content [data-industry-sprite]',profile.density,3);
    await page.evaluate(()=>transport.setView('industry'));
    await portraits(page,'#entity-list [data-industry-sprite]',profile.density,3);
    await page.locator('#entity-search').fill('mine');
    await portraits(page,'#entity-list [data-industry-sprite]',profile.density);
    await page.evaluate(()=>{const i=transport.game.industries[0];transport.inspect(i.x,i.y,'industry');});
    await portraits(page,'#inspector [data-industry-sprite]',profile.density);
    await page.screenshot({path:`${output}/${profile.name}-industry.png`});
    await page.evaluate(()=>transport.setView('routes'));
    await portraits(page,'#route-list [data-vehicle-sprite]',profile.density);
    await portraits(page,'#route-form [data-vehicle-sprite]',profile.density);
    const firstImage=await page.locator('#route-form canvas').evaluate(el=>el.toDataURL());
    await page.locator('#route-form [name="mode"]').selectOption('water');
    const ferryImage=await page.locator('#route-form canvas').evaluate(el=>el.toDataURL());
    assert.notEqual(ferryImage,firstImage,'Mode selection updates vehicle art');
    await page.locator('[data-cargo-choice="oil"]').click();
    const tankerImage=await page.locator('#route-form canvas').evaluate(el=>el.toDataURL());
    assert.notEqual(tankerImage,ferryImage,'Cargo selection updates ferry to tanker');
    // Air in 1952: the airport's portrait in Build and its inspector, the plane's in the route list and the route form.
    await page.evaluate(async()=>{const model=await import('./model.js'),g=transport.game;g.day=730.02;g.lastDailyDay=730;g.lastMonth=24;g.money=5e6;const a=model.build(g,'airport-x',192,200).station,b=model.build(g,'airport-y',230,270).station;window.artQA={route:model.addRoute(g,{mode:'air',stops:[a.id,b.id],cargo:'passengers'}).route.id,airport:a};g.revision++;transport.setView('build');});
    await page.locator('[data-category="network"]').click();
    await portraits(page,'#panel-content [data-infrastructure-sprite="airport"]',profile.density);
    await page.evaluate(()=>transport.inspect(artQA.airport.x+4,artQA.airport.y+1));
    await portraits(page,'#inspector [data-infrastructure-sprite="airport"]',profile.density);
    await page.evaluate(()=>transport.setView('routes'));
    await portraits(page,`#route-list [data-vehicle-sprite="${await page.evaluate(()=>artQA.route)}"]`,profile.density);
    await page.locator('#route-form [name="mode"]').selectOption('air');
    await portraits(page,'#route-form [data-vehicle-sprite][data-mode="air"]',profile.density);
    assert.notEqual(await page.locator('#route-form canvas').evaluate(el=>el.toDataURL()),tankerImage,'Air shows the plane');
    await page.locator('#route-search').fill('zz-no-route');await page.locator('#route-search').fill('');
    await portraits(page,'#route-list [data-vehicle-sprite]',profile.density);
    await page.screenshot({path:`${output}/${profile.name}-routes.png`});
    await page.evaluate(()=>document.querySelector('[data-open-chains]').click());
    await portraits(page,'#modal [data-industry-sprite]',profile.density,2);
    await page.locator('#chain-product').selectOption('all');
    await portraits(page,'#modal [data-industry-sprite]',profile.density,3);
    await page.screenshot({path:`${output}/${profile.name}-chains.png`});
    await page.locator('#modal .close-modal').click();
    await openGameAction(page,'world-button');await page.locator('#start-world-form').waitFor();
    // The main menu's New game offers three landscape choices in place of generated biome previews.
    assert.equal(await page.locator('#start-world-form [name="biome"]').count(),3);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false,'No horizontal page overflow');
    await page.screenshot({path:`${output}/${profile.name}-world.png`});
    console.log(`${profile.name}: generated building/industry/infrastructure/vehicle/chains art, filtering, mode and cargo changes, DPR, and landscape choices passed`);
    await page.close();
  }
  assert.deepEqual(errors,[]);console.log(`UI artwork checks passed. Screenshots: ${output}`);
} finally { await browser.close(); }
