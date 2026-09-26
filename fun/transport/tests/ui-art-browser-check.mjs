// Generated art must remain visible through panel changes, filtering and DPR scaling.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
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
  for(const profile of [{name:'desktop',width:1440,height:1000,density:1},{name:'mobile',width:390,height:844,density:2}]) {
    const page = await browser.newPage({ viewport:{width:profile.width,height:profile.height}, deviceScaleFactor:profile.density, isMobile:profile.name==='mobile', hasTouch:profile.name==='mobile' });
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(url);await page.waitForFunction(()=>window.transport?.game);
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
    await page.locator('#route-search').fill('zz-no-route');await page.locator('#route-search').fill('');
    await portraits(page,'#route-list [data-vehicle-sprite]',profile.density);
    await page.screenshot({path:`${output}/${profile.name}-routes.png`});
    await page.evaluate(()=>document.querySelector('[data-open-chains]').click());
    await portraits(page,'#modal [data-industry-sprite]',profile.density,2);
    await page.locator('#chain-product').selectOption('all');
    await portraits(page,'#modal [data-industry-sprite]',profile.density,3);
    await page.screenshot({path:`${output}/${profile.name}-chains.png`});
    await page.locator('#modal .close-modal').click();
    await page.evaluate(()=>document.querySelector('#world-button').click());
    assert.deepEqual(await page.locator('[data-preview]').evaluateAll(canvases=>canvases.map(canvas=>[canvas.width,getComputedStyle(canvas).imageRendering])),Array(3).fill([280*profile.density,'auto']));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false,'No horizontal page overflow');
    await page.screenshot({path:`${output}/${profile.name}-world.png`});
    console.log(`${profile.name}: generated building/industry/infrastructure/vehicle/chains art, filtering, mode and cargo changes, DPR, and biome previews passed`);
    await page.close();
  }
  assert.deepEqual(errors,[]);console.log(`UI artwork checks passed. Screenshots: ${output}`);
} finally { await browser.close(); }
