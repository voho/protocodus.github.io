// Biome QA: deterministic scenery, save continuity, unchanged navigation, visual contrast and fog.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium} = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({channel: process.env.ASHLINE_BROWSER || 'chrome', headless: true});
const output = process.env.ASHLINE_SCREENSHOTS || '/tmp/ashline-environments-qa';
await mkdir(output, {recursive: true});
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 900}, hasTouch: true}), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.ASHLINE_URL || 'http://127.0.0.1:8000/fun/ashline/');
  await page.waitForFunction(() => window.ashline?.booted);
  await page.evaluate(async () => (await import('./assets.js')).startAssets());
  const results = await page.evaluate(async () => {
    const {createGame,addEntity} = await import('./sim.js'), {encodeGame,decodeGame} = await import('./save.js');
    const {ENVIRONMENTS} = await import('./environments.js'), r = ashline.renderer, v = ashline.view;
    document.querySelector('#briefing').close(); document.body.dataset.screen = 'game';
    document.querySelector('#command-console').hidden = true;
    const results = [], scenes = {};
    for (const environment of Object.keys(ENVIRONMENTS)) {
      const s = createGame('BIOME-VISUAL-06','normal',{width:144,height:112,profile:'deadwood',environment});
      const before = ['terrain','minerals','mineralTypes','blocked'].map(k => [k,s[k].slice()]);
      const rng = s.rng;
      r.createTerrain(s);
      const first = JSON.stringify(r.scenery), trees = JSON.stringify(r.rockProps), count = r.scenery.length;
      const hash = r.terrain.getContext('2d').getImageData(0,0,r.terrain.width,r.terrain.height).data.reduce((h,v)=>(Math.imul(h,31)+v)|0,17);
      r.createTerrain(decodeGame(encodeGame(s)).game);
      const saved = first === JSON.stringify(r.scenery) && trees === JSON.stringify(r.rockProps);
      const depleted = decodeGame(encodeGame(s)).game; depleted.minerals.fill(0); r.createTerrain(depleted);
      const stableAfterMining = first === JSON.stringify(r.scenery);
      results.push({environment,count,hash,saved,stableAfterMining,kinds:[...new Set(r.scenery.map(p=>p.kind))],unchanged:rng===s.rng&&before.every(([key,values])=>s[key].every((value,i)=>value===values[i]))});
      r.createTerrain(s);
      const candidates = r.rockProps.filter(p=>p.kind==='tree'&&p.x>20&&p.x<s.width-20&&p.y>18&&p.y<s.height-18);
      const anchor = candidates.reduce((best,p)=> {
        const score = r.rockProps.filter(q=>q.kind==='tree'&&Math.hypot(q.x-p.x,q.y-p.y)<7).length;
        return !best||score>best.score?{...p,score}:best;
      },null);
      if (!anchor) throw new Error('No grove for contrast fixture');
      s.entities = []; s.effects = []; s.visible[0].fill(1); s.explored[0].fill(1); s.time = 2.5;
      const ground=[];
      for(let y=Math.floor(anchor.y)-4;y<=anchor.y+4;y++)for(let x=Math.floor(anchor.x)-5;x<=anchor.x+5;x++)
        if(!s.blocked[y*s.width+x]&&!s.minerals[y*s.width+x])ground.push({x:x+.5,y:y+.5});
      const slots=[];
      for(const p of ground.sort((a,b)=>Math.hypot(a.x-anchor.x,a.y-anchor.y)-Math.hypot(b.x-anchor.x,b.y-anchor.y)))
        if(slots.every(q=>Math.hypot(q.x-p.x,q.y-p.y)>1.4))slots.push(p);
      for(const [i,type] of ['rifle','tank','rocket','scout','artillery','rifle','tank','rocket','scout','artillery'].entries()) {
        const p=slots[i]; if(!p)break;
        const e=addEntity(s,i<5?0:1,'unit',type,p.x,p.y); e.angle=i*.71;
      }
      scenes[environment]={s,anchor};
    }
    window.biomeScene=(environment,zoom)=> {
      const {s,anchor}=scenes[environment]; r.resize();
      Object.assign(v,{x:anchor.x,y:anchor.y,zoom}); v.selected.clear(); r.draw(s,v);
    };
    return results;
  });
  assert.equal(new Set(results.map(r=>r.hash)).size,4,'Each biome has a distinct ground material');
  for(const r of results) {
    assert(r.count>30,`${r.environment} has substantial matching scenery`);
    assert.deepEqual(r.kinds.sort(),['debris','plant','stones']);
    assert(r.saved&&r.stableAfterMining&&r.unchanged,`${r.environment} decor is deterministic through save/mining without affecting simulation`);
  }
  assert(await page.locator('#world').isVisible(), 'Battlefield is visible for visual review');
  for(const environment of ['ash','jungle','desert','tundra']) {
    for(const [device,viewport,zooms] of [['desktop',{width:1440,height:900},[32,16]],['mobile',{width:390,height:844},[24,16]]]) {
      await page.setViewportSize(viewport);
      // Let the game's resize listener finish before it can clear our static render.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      for(const zoom of zooms) {
        await page.evaluate(({environment,zoom})=>biomeScene(environment,zoom),{environment,zoom});
        await page.screenshot({path:`${output}/${environment}-${device}-${zoom}.png`});
      }
    }
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify(results,null,2));
  console.log(`Environment checks passed; review ${output}`);
} finally { await browser.close(); }
