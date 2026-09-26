// Product previews are complete before play and keep purchase controls usable at both sizes.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.TYRAN_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.TYRAN_BROWSER||'chrome',headless:true});
const output=process.env.TYRAN_SHOP_OUTPUT||'/tmp/tyran-shop-art';await mkdir(output,{recursive:true});
const errors=[];
const upgradeKeys=['weapon','fireRate','firePower','shield','hull','recharge'];
const upgradePreview=(page,key)=>page.evaluate(async key=>{
  const{primaryStats,firingInterval,MAX_UPGRADE}=await import('./sim.js');
  const state=tyran.state,level=state.upgrades[key];
  const next={...state,upgrades:{...state.upgrades,[key]:Math.min(MAX_UPGRADE,level+1)}};
  const value=state=>{const profile=primaryStats(state);return key==='fireRate'?1/firingInterval(profile):profile.damage;};
  const current=value(state),upgraded=value(next),unit=key==='fireRate'?'volleys/s':'shot damage';
  return{level,current,upgraded,expected:`${current.toFixed(2)} → ${upgraded.toFixed(2)} ${unit}`,
    displayed:document.querySelector(`[data-upgrade="${key}"] .upgrade-preview`).textContent};
},key);
try {
  for(const [name,viewport]of [['desktop',{width:1440,height:1100}],['mobile',{width:390,height:844}]]){
    const page=await browser.newPage({viewport});page.on('pageerror',error=>errors.push(error.message));
    await page.goto(process.env.TYRAN_URL||'http://127.0.0.1:8773/fun/tyran/');
    await page.waitForFunction(()=>window.tyran&&document.body.dataset.ready==='true');
    const ready=await page.evaluate(async()=>{const {shopArtStats}=await import('./shop-art.js');return shopArtStats();});
    assert.equal(ready.count,13);assert.equal(ready.decoded,13,'All previews decode before launch is enabled');
    assert(ready.keys.includes('upgrade:fireRate')&&ready.keys.includes('upgrade:firePower'),'Both new upgrade previews are prepared before flight');
    await page.evaluate(()=>{
      window.lateShopArtBuilds=0;
      const create=document.createElement.bind(document);
      document.createElement=(name,...args)=>{if(name==='canvas'&&/shop-art\.js/.test(new Error().stack))lateShopArtBuilds++;return create(name,...args);};
    });
    const requests=[];page.on('request',request=>{if(request.resourceType()==='image')requests.push(request.url());});
    await page.evaluate(async()=>{
      const {spawnEnemy,killEnemy}=await import('./sim.js');tyran.launch(1);tyran.state.credits=20000;
      killEnemy(tyran.state,spawnEnemy(tyran.state,9,tyran.state.width/2,180));tyran.step(3.4);
    });
    await page.waitForFunction(()=>tyran.scene==='hangar');
    await page.locator('.shop-art img').first().waitFor();
    const upgrades=await page.locator('#upgrade-list [data-upgrade]').evaluateAll(cards=>cards.map(card=>({
      key:card.dataset.upgrade,preview:card.querySelector('.upgrade-preview').textContent,
    })));
    assert.deepEqual(upgrades.map(item=>item.key),upgradeKeys,'All six upgrade cards are present');
    assert(upgrades.every(item=>!/(?:NaN|undefined|Infinity)/.test(item.preview)&&/\d.*→.*\d/.test(item.preview)),
      'Every upgrade displays finite before/after values');
    for(const key of ['fireRate','firePower']){
      const preview=await upgradePreview(page,key);
      assert.equal(preview.displayed,preview.expected,`${key} preview agrees with the actual weapon stats and firing interval`);
      assert(preview.upgraded>preview.current,`${key} shows a real improvement`);
    }
    const images=await page.locator('.shop-art img').evaluateAll(images=>images.map(image=>({complete:image.complete,width:image.naturalWidth,height:image.naturalHeight,src:image.src,display:image.getBoundingClientRect().height})));
    assert.equal(images.length,13);assert.ok(images.every(image=>image.complete&&image.width===640&&image.height===280&&image.display>90),'All thirteen previews are real, decoded, visible-sized images');
    assert.equal(new Set(images.map(image=>image.src)).size,13,'Every product has a distinct preview');
    assert.deepEqual(requests,[],'Opening the shop makes no image network requests');
    const geometry=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,cards:[...document.querySelectorAll('.upgrade-card,.weapon-card')].map(card=>{
      const box=card.getBoundingClientRect();return [...card.querySelectorAll('.upgrade-name,.upgrade-preview,.weapon-copy,.upgrade-cost,.weapon-status')].every(el=>{
        const child=el.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(el);
        return child.left>=box.left&&child.right<=box.right+1&&[...range.getClientRects()].every(text=>text.left>=box.left&&text.right<=box.right+1);
      });
    })}));
    assert.equal(geometry.overflow,false);assert.ok(geometry.cards.every(Boolean),'Names, numeric previews, prices and status fit their cards');
    for(const section of ['upgrade','weapon','supply']){
      await page.locator(`#${section}-list`).scrollIntoViewIfNeeded();
      await page.screenshot({path:`${output}/${name}-${section}.png`});
    }
    for(const key of ['fireRate','firePower']){
      await page.locator(`[data-upgrade="${key}"]`).scrollIntoViewIfNeeded();
      await page.screenshot({path:`${output}/${name}-${key}.png`});
    }
    const before=await page.evaluate(()=>({credits:tyran.state.credits,level:tyran.state.upgrades.weapon}));
    await page.locator('[data-upgrade="weapon"]').click();
    const after=await page.evaluate(()=>({credits:tyran.state.credits,level:tyran.state.upgrades.weapon}));
    assert.equal(after.level,before.level+1);assert.ok(after.credits<before.credits,'Art does not intercept purchase clicks');
    for(const upgrade of ['fireRate','firePower']){
      const before=await upgradePreview(page,upgrade);
      await page.locator(`[data-upgrade="${upgrade}"]`).click();
      const after=await upgradePreview(page,upgrade);
      assert.equal(after.level,before.level+1,`${upgrade} artwork keeps its purchase button usable`);
      assert.equal(after.current,before.upgraded,`${upgrade} purchase applies the previewed value`);
      assert.equal(after.displayed,after.expected,`${upgrade} preview refreshes to the next actual values`);
      assert.notEqual(after.displayed,before.displayed,`${upgrade} preview changes after purchase`);
    }
    await page.locator('[data-primary="scatter"]').click();
    assert.equal(await page.evaluate(()=>tyran.state.primary),'scatter');
    await page.locator('[data-supply="drone"]').click();
    assert.equal(await page.evaluate(()=>tyran.state.players[0].drones),1);
    assert.deepEqual((await page.locator('.shop-art img').evaluateAll(images=>images.map(image=>image.src))),images.map(image=>image.src),'Purchases reuse the same cached previews');
    const reused=await page.evaluate(async()=>{const{warmShopArt,shopArtStats}=await import('./shop-art.js');await warmShopArt();return{stats:shopArtStats(),builds:lateShopArtBuilds};});
    assert.deepEqual(reused.stats,ready,'Repeated warmup keeps the existing decoded preview cache');
    assert.equal(reused.builds,0,'Flight, shop and purchases never rebuild shop artwork');
    await page.close();
  }
  assert.deepEqual(errors,[]);console.log('PASS six finite stat previews and purchase updates, thirteen predecoded unique shop images, desktop/mobile layout, no image downloads or late artwork builds, and upgrade/weapon/supply purchases.');
}finally{await browser.close();}
