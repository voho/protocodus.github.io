// Product previews are complete before play and keep purchase controls usable at both sizes.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.TYRAN_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.TYRAN_BROWSER||'chrome',headless:true});
const output=process.env.TYRAN_SHOP_OUTPUT||'/tmp/tyran-shop-art';await mkdir(output,{recursive:true});
const errors=[];
try {
  for(const [name,viewport]of [['desktop',{width:1440,height:1100}],['mobile',{width:390,height:844}]]){
    const page=await browser.newPage({viewport});page.on('pageerror',error=>errors.push(error.message));
    await page.goto(process.env.TYRAN_URL||'http://127.0.0.1:8773/fun/tyran/');
    await page.waitForFunction(()=>window.tyran&&document.body.dataset.ready==='true');
    const ready=await page.evaluate(async()=>{const {shopArtStats}=await import('./shop-art.js');return shopArtStats();});
    assert.equal(ready.count,11);assert.equal(ready.decoded,11,'All previews decode before launch is enabled');
    const requests=[];page.on('request',request=>{if(request.resourceType()==='image')requests.push(request.url());});
    await page.evaluate(async()=>{
      const {spawnEnemy,killEnemy}=await import('./sim.js');tyran.launch(1);tyran.state.credits=20000;
      killEnemy(tyran.state,spawnEnemy(tyran.state,9,tyran.state.width/2,180));tyran.step(3.4);
    });
    await page.waitForFunction(()=>tyran.scene==='hangar');
    await page.locator('.shop-art img').first().waitFor();
    const images=await page.locator('.shop-art img').evaluateAll(images=>images.map(image=>({complete:image.complete,width:image.naturalWidth,height:image.naturalHeight,src:image.src,display:image.getBoundingClientRect().height})));
    assert.equal(images.length,11);assert.ok(images.every(image=>image.complete&&image.width===640&&image.height===280&&image.display>90),'All eleven previews are real, decoded, visible-sized images');
    assert.equal(new Set(images.map(image=>image.src)).size,11,'Every product has a distinct preview');
    assert.deepEqual(requests,[],'Opening the shop makes no image network requests');
    const geometry=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,cards:[...document.querySelectorAll('.upgrade-card,.weapon-card')].map(card=>{
      const box=card.getBoundingClientRect();return [...card.querySelectorAll('.upgrade-name,.weapon-copy,.upgrade-cost,.weapon-status')].every(el=>{const child=el.getBoundingClientRect();return child.left>=box.left&&child.right<=box.right+1;});
    })}));
    assert.equal(geometry.overflow,false);assert.ok(geometry.cards.every(Boolean),'Names, prices and status fit their cards');
    for(const section of ['upgrade','weapon','supply']){
      await page.locator(`#${section}-list`).scrollIntoViewIfNeeded();
      await page.screenshot({path:`${output}/${name}-${section}.png`});
    }
    const before=await page.evaluate(()=>({credits:tyran.state.credits,level:tyran.state.upgrades.weapon}));
    await page.locator('[data-upgrade="weapon"]').click();
    const after=await page.evaluate(()=>({credits:tyran.state.credits,level:tyran.state.upgrades.weapon}));
    assert.equal(after.level,before.level+1);assert.ok(after.credits<before.credits,'Art does not intercept purchase clicks');
    await page.locator('[data-primary="scatter"]').click();
    assert.equal(await page.evaluate(()=>tyran.state.primary),'scatter');
    await page.locator('[data-supply="drone"]').click();
    assert.equal(await page.evaluate(()=>tyran.state.players[0].drones),1);
    assert.deepEqual((await page.locator('.shop-art img').evaluateAll(images=>images.map(image=>image.src))),images.map(image=>image.src),'Purchases reuse the same cached previews');
    await page.close();
  }
  assert.deepEqual(errors,[]);console.log('PASS eleven predecoded unique shop images, desktop/mobile layout, no image downloads, and upgrade/weapon/supply purchases.');
}finally{await browser.close();}
