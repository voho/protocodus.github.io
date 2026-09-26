// Isolated Chromium companies exercise generated artwork, native fallbacks,
// density changes and real 2×2 industry interactions without touching play saves.
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const baseURL = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-world-art-qa';
await mkdir(output, { recursive: true });
const errors = [], summaries = [], masters = [];
async function collect(directory, relative = '') {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${item.name}`, name = `${relative}${item.name}`;
    if (item.isDirectory()) await collect(path, `${name}/`);
    else if (item.name === 'atlas.json') masters.push({ path: `assets/world/${relative}atlas.png`, metadata: JSON.parse(await readFile(path, 'utf8')) });
  }
}
await collect(fileURLToPath(new URL('../assets/world', import.meta.url)));

async function install(page) {
  await page.evaluate(async () => {
    const model = await import('./model.js'), { createSprites } = await import('./sprites.js'), { createRenderer } = await import('./renderer.js');
    const assets = await import('./atlas-runtime.js'), buildings = await import('./raster-buildings.js'), industries = await import('./raster-industries.js');
    const houses = await import('./raster-houses.js'), identities = await import('./buildings.js');
    const { drawRasterNature } = await import('./raster-nature.js'), { BIOME_NATURE } = await import('./terrain-sprites.js');
    const canvas = document.createElement('canvas'); canvas.id = 'art-world'; canvas.style.cssText = 'width:1200px;height:760px;display:block';
    const panel = document.createElement('section'); panel.id = 'art-qa'; panel.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#eef0e0;padding:18px;overflow:auto;font:16px system-ui';
    panel.innerHTML = '<h2 style="margin:0 0 10px">Generated world artwork</h2>'; panel.append(canvas); document.body.append(panel);
    const hash = canvas => { let h = 2166136261; for (const b of canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data) h = Math.imul(h ^ b, 16777619); return h >>> 0; };
    const setup = biome => {
      const game = model.createGame({ biome, size: 'square512', seed: 1847 });
      const renderer = createRenderer(canvas, game, { layers: { lighting: true, names: true, industryIcons: true, routes: false } });
      renderer.focus(game.cities[0].x, game.cities[0].y); renderer.render(0); return { game, renderer };
    };
    window.artQA = { model, createSprites, createRenderer, assets, buildings, industries, houses, identities, drawRasterNature, BIOME_NATURE, canvas, hash, setup };
  });
}
async function emptyPage(context) {
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.route('**/world-art-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
  await page.goto(new URL('world-art-qa', baseURL).href); await install(page); return page;
}
try {
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: dpr });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(baseURL); await page.waitForFunction(() => window.transport?.renderer);
    await page.evaluate(() => transport.setSpeed(0));
    const ready = await page.evaluate(async () => { const a = await import('./atlas-runtime.js'); await a.preloadWorldArt({ waitMs: 8000 }); return a.worldArtStats(); });
    assert.equal(ready.ready, ready.atlases, 'every registered atlas decodes successfully'); assert.deepEqual(ready.errors, []);
    await page.screenshot({ path: `${output}/app-palette-dpr${dpr}.png` });
    if (dpr === 1) {
      const target = await page.evaluate(() => { const industry = transport.game.industries.find(site => site.footprint === 2); transport.setTool('inspect'); transport.renderer.setZoom(2); transport.renderer.focus(industry.x + .5, industry.y + .5); return industry; });
      for (const [dx, dy] of [[0,0], [1,0], [0,1], [1,1]]) {
        const point = await page.evaluate(({ target, dx, dy }) => { const r = document.querySelector('#world').getBoundingClientRect(), c = transport.renderer.getCamera(); return { x: r.left + r.width / 2 + ((target.x + dx + .5) * 32 - c.x) * c.zoom, y: r.top + r.height / 2 + ((target.y + dy + .5) * 32 - c.y) * c.zoom }; }, { target, dx, dy });
        await page.mouse.click(point.x, point.y);
        assert.equal(await page.locator('#inspector h3').textContent(), target.name, 'each of the four visible site tiles opens the same industry');
      }
      const overlap = await page.evaluate(async target => {
        const { build, industryAt } = await import('./model.js'), game = transport.game, before = JSON.stringify(game);
        const outcomes = [[0,0],[1,0],[0,1],[1,1]].map(([dx,dy]) => ({ found: industryAt(game,target.x+dx,target.y+dy)?.id, road: build(game,'road',target.x+dx,target.y+dy).ok }));
        return { outcomes, unchanged: before === JSON.stringify(game) };
      }, target);
      assert.ok(overlap.outcomes.every(result => result.found === target.id && result.road === false)); assert.equal(overlap.unchanged, true);
    }
    await install(page);
    if (dpr === 1) {
      const alpha = await page.evaluate(async masters => {
        const result = [];
        for (const { path, metadata } of masters) {
          const image = new Image(); await new Promise((resolve,reject) => { image.onload = resolve; image.onerror = reject; image.src = new URL(path, location.href).href; }); await image.decode();
          const c = document.createElement('canvas'); c.width = image.naturalWidth; c.height = image.naturalHeight; c.getContext('2d').drawImage(image, 0, 0);
          const pixels = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
          metadata.order.forEach((id,index) => {
            if (!id) return;
            const ox = index % metadata.columns * 256, oy = Math.floor(index / metadata.columns) * 256; let ink = 0, clear = 0;
            for (let y=0;y<256;y++) for(let x=0;x<256;x++){const a=pixels[((oy+y)*c.width+ox+x)*4+3]; if(a>16)ink++;if(a===0)clear++;}
            result.push({ id, ink, clear });
          });
        }
        return result;
      }, masters);
      for (const cell of alpha) { assert.ok(cell.ink > 200, `${cell.id} contains artwork`); assert.ok(cell.clear > 300, `${cell.id} keeps transparent surroundings`); }
    }
    for (const biome of ['taiga', 'tundra', 'desert']) {
      await page.evaluate(biome => { const q = artQA; Object.assign(q, q.setup(biome)); }, biome);
      const variants = await page.evaluate(biome => {
        const q = artQA, profiles = [];
        for (const detail of q.BIOME_NATURE[biome].mountains) {
          const hashes = []; let overflow = 0;
          for (let variant = 0; variant < 64; variant++) {
            const canvas = document.createElement('canvas');canvas.width=40;canvas.height=48;
            const c=canvas.getContext('2d');c.translate(4,12);q.drawRasterNature(c,'mountain',biome,detail,variant,1);hashes.push(q.hash(canvas));
            const data=c.getImageData(0,0,40,48).data;
            for(let y=0;y<48;y++)for(let x=0;x<40;x++)if((x<4||x>=36||y<4||y>=44)&&data[(y*40+x)*4+3]>3)overflow++;
          }
          profiles.push({detail,unique:new Set(hashes).size,overflow});
        }
        return profiles;
      },biome);
      for(const v of variants){assert.equal(v.unique,64,`${biome} ${v.detail} has 64 distinct relief compositions`);assert.equal(v.overflow,0,`${biome} ${v.detail} fits its cached surface`);}
      const profiles = [];
      for (const zoom of [.5, 1, 2]) {
        const exact = await page.evaluate(({ biome, zoom }) => {
          const q = artQA, density = zoom * devicePixelRatio, profile = zoom === .5 ? 'region' : zoom === 2 ? 'detail' : 'town';
          const sprite = q.createSprites(biome, { pixelScale: density, detailLevel: profile });
          const checks = [], compare = (kind, level, detail, draw, forest = false) => {
            const actual = sprite(kind, 6, level, detail), expected = document.createElement('canvas'); expected.width = actual.width; expected.height = actual.height;
            const c = expected.getContext('2d'); c.scale(density, density); c.translate(forest ? 8 : 0, forest ? 16 : 8);
            const painted = draw(c); checks.push({ kind, detail, painted, equal: q.hash(actual) === q.hash(expected), width: actual.width, height: actual.height });
          };
          for (const kind of q.buildings.RASTER_BUILDING_KINDS) compare(kind,1,'',c=>q.buildings.drawRasterBuilding(c,kind,biome,density));
          for (const [kind, def] of Object.entries(q.model.INDUSTRIES)) if (def.biomes.includes(biome)) compare(kind,2,'',c=>q.industries.drawRasterIndustry(c,kind,biome,density,{size:64}));
          for (const detail of q.BIOME_NATURE[biome].trees) compare('forest',1,detail,c=>q.drawRasterNature(c,'forest',biome,detail,6,density),true);
          for (const detail of q.BIOME_NATURE[biome].mountains) compare('mountain',1,detail,c=>q.drawRasterNature(c,'mountain',biome,detail,6,density));
          for (const detail of q.BIOME_NATURE[biome].plants) compare('terrain-detail',1,detail,c=>q.drawRasterNature(c,'terrain-detail',biome,detail,6,density));
          return checks;
        }, { biome, zoom });
        for (const entry of exact) { assert.equal(entry.painted, true, `${biome} ${entry.kind}/${entry.detail} has generated artwork`); assert.equal(entry.equal, true, `${biome} ${entry.kind}/${entry.detail} integrates the bitmap at native density`); }
        for (const focus of ['town', 'industry', 'nature', 'coast']) {
          const stats = await page.evaluate(({ zoom, focus }) => {
            const q = artQA; q.renderer.setZoom(zoom); q.game.day = 0;
            let p = q.game.cities[0];
            if (focus === 'industry') p = q.game.industries.find(i => !/mine|well|quarry|pit/.test(i.kind)) || q.game.industries[0];
            if (focus === 'nature') {
              let best = { x: 20, y: 20, score: -1 };
              for (let y=12;y<q.game.height-12;y+=12) for(let x=12;x<q.game.width-12;x+=12){let score=0;for(let dy=-4;dy<=4;dy+=2)for(let dx=-4;dx<=4;dx+=2){const t=q.game.tiles[(y+dy)*q.game.width+x+dx];score+=t.terrain==='forest'?2:['mountain','rock','water'].includes(t.terrain)?.5:0;if(t.building||t.road)score-=5;}if(score>best.score)best={x,y,score};}p=best;
            }
            if(focus==='coast')p={x:q.game.cities[0].x+3,y:q.game.cities[0].y+7};
            q.renderer.focus(p.x + (focus === 'industry' ? .5 : 0), p.y + (focus === 'industry' ? .5 : 0)); q.renderer.render(0);
            const before=q.renderer.getStats();q.renderer.render(0);return{...q.renderer.getStats(),extra:q.renderer.getStats().composedChunks-before.composedChunks};
          }, { zoom, focus });
          assert.ok(stats.cacheBytes <= stats.cacheLimit); assert.ok(stats.cacheLimit <= 256 * 1024 * 1024); assert.equal(stats.extra,0);
          assert.equal(stats.rasterScale, zoom * dpr); profiles.push(stats);
          await page.evaluate(async()=>{await new Promise(requestAnimationFrame);artQA.renderer.render(0);});
          await page.locator('#art-world').screenshot({ path: `${output}/${biome}-${focus}-zoom${zoom}-dpr${dpr}.png` });
        }
      }
      const layers = await page.evaluate(() => {
        const q=artQA, r=q.renderer; r.setZoom(2);r.focus(q.game.cities[0].x,q.game.cities[0].y);q.game.day=0;r.render(0);const visible=q.hash(q.canvas),state=JSON.stringify(q.game);
        r.setLayers({trees:false,buildings:false,roads:false,rails:false,stations:false,names:false,industryIcons:false});r.render(0);const hidden=q.hash(q.canvas);
        r.setLayers({trees:true,buildings:true,roads:true,rails:true,stations:true,names:true,industryIcons:true});r.render(0);const restored=q.hash(q.canvas);return{visible,hidden,restored,unchanged:state===JSON.stringify(q.game)};
      });
      assert.notEqual(layers.visible,layers.hidden);assert.equal(layers.visible,layers.restored);assert.equal(layers.unchanged,true);
      const night=await page.evaluate(()=>{
        const q=artQA,r=q.renderer,c=q.canvas.getContext('2d'),camera=r.getCamera();q.game.day=0;r.render(0);const day=c.getImageData(0,0,q.canvas.width,q.canvas.height).data;
        q.game.day=30;r.render(0);const dark=c.getImageData(0,0,q.canvas.width,q.canvas.height).data;let sampled=0,lit=0;
        for(let y=q.game.cities[0].y-4;y<=q.game.cities[0].y+4;y++)for(let x=q.game.cities[0].x-4;x<=q.game.cities[0].x+4;x++){
          const t=q.game.tiles[y*q.game.width+x];if(!t.building)continue;let kind=t.building.kind;
          if(['house','apartment'].includes(kind))kind=q.identities.residentialKind(t.variant??x*13+y,t.building.level||1);
          if(['shop','office'].includes(kind))kind=q.identities.commercialKind(t.variant??x*13+y,t.building.level||1);
          const panes=q.houses.hasRasterHouse(kind,q.game.biome)?q.houses.houseWindowAnchors(kind,q.game.biome):q.buildings.rasterBuildingWindows(kind,q.game.biome);
          for(const [wx,wy,w,h] of panes){
            const px=Math.floor(((x*32+wx+w/2-camera.x)*camera.zoom+600)*devicePixelRatio),py=Math.floor(((y*32+wy+h/2-camera.y)*camera.zoom+380)*devicePixelRatio);
            if(px<0||py<0||px>=q.canvas.width||py>=q.canvas.height)continue;const i=(py*q.canvas.width+px)*4;sampled++;
            if(dark[i]>day[i]*.53+18*.47+18)lit++;
          }
        }
        return{sampled,lit};
      });
      assert.ok(night.sampled>20);assert.ok(night.lit/night.sampled>.75,`${biome} generated window anchors visibly illuminate their panes`);
      await page.locator('#art-world').screenshot({path:`${output}/${biome}-town-night-dpr${dpr}.png`});
      const overview=await page.evaluate(()=>{const q=artQA;let map=document.querySelector('#art-map');if(!map){map=document.createElement('canvas');map.id='art-map';map.style.cssText='width:512px;height:512px';document.querySelector('#art-qa').append(map);}q.renderer.drawMinimap(map);return q.renderer.getStats();});
      assert.equal(overview.minimapWidth,512);assert.equal(overview.minimapHeight,512);
      await page.locator('#art-map').screenshot({path:`${output}/${biome}-full-map-dpr${dpr}.png`});
      summaries.push({biome,dpr,profiles:profiles.length,nightWindows:night,maxCacheMiB:+(Math.max(...profiles.map(s=>s.cacheBytes))/1048576).toFixed(1)});
    }
    await context.close();
  }

  const late = await browser.newContext({viewport:{width:1400,height:1000}});let release;
  const gate=new Promise(resolve=>{release=resolve;});await late.route('**/assets/world/**',async route=>{await gate;await route.continue();});
  const page=await emptyPage(late);
  const before=await page.evaluate(async()=>{const q=artQA;void q.assets.preloadWorldArt({waitMs:0});Object.assign(q,q.setup('taiga'));q.sprite=q.createSprites('taiga',{pixelScale:1});q.saved=JSON.stringify(q.game);const ready=await q.assets.preloadWorldArt({waitMs:25});return{ready,sprite:q.hash(q.sprite('school')),image:q.hash(q.canvas),stats:q.renderer.getStats(),camera:q.renderer.getCamera()};});
  assert.equal(before.ready,false);release();await page.waitForFunction(()=>artQA.assets.worldArtStats().ready===artQA.assets.worldArtStats().atlases);
  const after=await page.evaluate(()=>{const q=artQA;q.renderer.render(0);return{sprite:q.hash(q.sprite('school')),image:q.hash(q.canvas),stats:q.renderer.getStats(),unchanged:q.saved===JSON.stringify(q.game),camera:q.renderer.getCamera()};});
  assert.notEqual(before.sprite,after.sprite);assert.notEqual(before.image,after.image);assert.ok(after.stats.composedChunks>before.stats.composedChunks);assert.equal(after.unchanged,true);assert.deepEqual(before.camera,after.camera);await late.close();
  const missing=await browser.newContext({viewport:{width:1400,height:1000}});await missing.route('**/assets/world/**',route=>route.abort());const fallbackPage=await emptyPage(missing);
  const fallback=await fallbackPage.evaluate(async()=>{const q=artQA;await q.assets.preloadWorldArt();Object.assign(q,q.setup('taiga'));const sprite=q.createSprites('taiga',{pixelScale:1}),sample=sprite('school');return{stats:q.assets.worldArtStats(),width:sample.width,height:sample.height,ink:Array.from(sample.getContext('2d').getImageData(0,0,sample.width,sample.height).data).some((n,i)=>i%4===3&&n>0),chunks:q.renderer.getStats().composedChunks};});
  assert.equal(fallback.stats.ready,0);assert.equal(fallback.stats.errors.length,fallback.stats.atlases);assert.equal(fallback.ink,true);assert.ok(fallback.chunks>0);assert.equal(fallback.width,32);assert.equal(fallback.height,40);await missing.close();
  assert.deepEqual(errors,[]);console.log(JSON.stringify({summaries,sourceAtlases:masters.length,industryPicking:'all four tiles',loading:'late and missing artwork passed',output},null,2));
} finally {await browser.close();}
