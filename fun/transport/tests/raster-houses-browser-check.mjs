// Real decoded PNGs, isolated browser storage, and deliberately slow/missing
// requests exercise the generated houses independently of simulation time.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const baseURL = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-raster-houses-qa';
const errors = [], results = [];
await mkdir(output, { recursive: true });

async function harness(context) {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/raster-houses-qa', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:24px;background:#edf0de;color:#354736;font:15px system-ui}h1{font-size:22px;margin:0 0 18px}h2{font-size:15px;margin:0 0 12px}canvas{display:block}section{padding:20px;background:#f8f5e8;margin-bottom:18px;border-radius:12px}.master{width:768px;height:768px}.world{width:1040px;height:720px}#gallery{width:1060px}.grid{background:repeating-conic-gradient(#c8d2ba 0 25%,#e3e9d7 0 50%) 50%/16px 16px}</style><h1>Generated house artwork</h1><main id="gallery"></main>` }));
  await page.goto(new URL('raster-houses-qa', baseURL).href);
  await page.evaluate(async () => {
    const assets = await import('./raster-houses.js'), { createSprites } = await import('./sprites.js');
    const { createRenderer } = await import('./renderer.js'), { createGame } = await import('./model.js');
    const { drawTownBuilding } = await import('./building-sprites.js');
    const hash = canvas => {
      let value = 2166136261;
      for (const byte of canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data) value = Math.imul(value ^ byte, 16777619);
      return value >>> 0;
    };
    const load = async url => {
      const image = new Image();
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
      await image.decode(); return image;
    };
    const canvas = (width, height) => { const c = document.createElement('canvas'); c.width = width; c.height = height; return c; };
    const section = label => {
      const el = document.createElement('section'), heading = document.createElement('h2');
      heading.textContent = label; el.append(heading); document.querySelector('#gallery').append(el); return el;
    };
    const setupWorld = biome => {
      const game = createGame({ biome, size: 'regional', seed: 1847 });
      const view = canvas(1040, 720); view.className = 'world';
      document.querySelector('#gallery').replaceChildren(view);
      const renderer = createRenderer(view, game, { layers: { names: false, industryIcons: false, routes: false } });
      renderer.focus(game.cities[0].x + 3, game.cities[0].y); renderer.render(0);
      return { game, renderer, view };
    };
    window.houseQA = { assets, createSprites, createRenderer, createGame, drawTownBuilding, hash, load, canvas, section, setupWorld };
  });
  return page;
}

try {
  for (const dpr of process.env.TRANSPORT_HOUSE_FALLBACK_ONLY ? [] : [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: dpr });
    const page = await harness(context);
    const loaded = await page.evaluate(() => houseQA.assets.preloadHouses());
    assert.equal(loaded, true, 'at least one complete generated atlas set loads');
    const checks = await page.evaluate(async () => {
      const q = houseQA, { assets, canvas, hash } = q, masters = [], profiles = [];
      for (const biome of assets.HOUSE_BIOMES) for (const design of assets.HOUSE_DESIGNS) for (const rotation of assets.HOUSE_ROTATIONS) {
        const image = await q.load(assets.HOUSE_DESIGN_ATLAS_URLS[biome][design][rotation]);
        const master = canvas(image.naturalWidth, image.naturalHeight); master.getContext('2d').drawImage(image, 0, 0);
        const data = master.getContext('2d').getImageData(0, 0, master.width, master.height).data, silhouettes = [];
        for (let index = 0; index < 9; index++) {
          const ox = index % 3 * 256, oy = Math.floor(index / 3) * 256;
          let transparent = 0, visible = 0, borderVisible = 0;
          for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
            const alpha = data[((oy + y) * master.width + ox + x) * 4 + 3];
            if (alpha === 0) transparent++; if (alpha > 32) visible++;
            if ((x < 2 || x > 253 || y < 2 || y > 253) && alpha > 32) borderVisible++;
          }
          silhouettes.push({ kind: assets.HOUSE_KINDS[index], transparent, visible, borderVisible });
        }
        masters.push({ biome, design, rotation, width: master.width, height: master.height, silhouettes });
        for (const [zoom, detailLevel] of [[.5, 'region'], [1, 'town'], [2, 'detail']]) {
          const pixelScale = zoom * devicePixelRatio, cell = 32 * pixelScale;
          const atlas = await q.load(new URL(assets.HOUSE_DESIGN_ATLAS_URLS[biome][design][rotation].replace(/atlas-\d+\.png$/, `atlas-${cell}.png`), location.href).href);
          const sprite = q.createSprites(biome, { pixelScale, detailLevel }), houses = [];
          for (let index = 0; index < 9; index++) {
            const kind = assets.HOUSE_KINDS[index], actual = sprite(kind, design * 6 + rotation, 1);
            const expected = canvas(32 * pixelScale, 40 * pixelScale), c = expected.getContext('2d');
            c.imageSmoothingEnabled = false;
            c.drawImage(atlas, index % 3 * cell, Math.floor(index / 3) * cell, cell, cell, 0, 8 * pixelScale, cell, cell);
            houses.push({ kind, width: actual.width, height: actual.height, hash: hash(actual), matchesLOD: hash(actual) === hash(expected), sharesRotation: actual === sprite(kind,design * 6 + rotation + 18,1), distinctRotation: actual !== sprite(kind,design * 6 + 1-rotation,1), distinctPixels: hash(actual) !== hash(sprite(kind,design * 6 + 1-rotation,1)), distinctDesign: hash(actual) !== hash(sprite(kind,((design + 1) % 3) * 6 + rotation,1)), stable: actual === sprite(kind,design * 6 + rotation,1) });
          }
          profiles.push({ biome, design, rotation, zoom, cell, houses, artwork: assets.getHouseAssetStats(biome,rotation,design) });
        }
      }
      const {drawUIArtwork}=await import('./ui-art.js'),{BUILDINGS}=await import('./buildings.js'),ui=[];
      const visible=image=>{
        const pixels=image.getContext('2d').getImageData(0,0,image.width,image.height).data;
        let left=image.width,top=image.height,right=-1,bottom=-1;
        for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)if(pixels[(y*image.width+x)*4+3]){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
        return{left,top,sw:right-left+1,sh:bottom-top+1};
      };
      for(const biome of assets.HOUSE_BIOMES){
        const root=document.createElement('div'),portrait=canvas(96,100),density=Math.min(2,Math.max(1,devicePixelRatio));
        root.append(portrait);const sprites=new Map();
        for(const kind of assets.HOUSE_KINDS)for(const design of assets.HOUSE_DESIGNS)for(const rotation of assets.HOUSE_ROTATIONS){
          const variant=design*6+rotation;portrait.dataset.buildingSprite=kind;portrait.dataset.buildingVariant=String(variant);
          drawUIArtwork(root,{biome,routes:[],vehicles:[]});
          const span=BUILDINGS[kind].footprint;let pixelScale=2**Math.ceil(Math.log2(Math.max(1,100*density/(32*span))));
          if(!sprites.has(pixelScale))sprites.set(pixelScale,q.createSprites(biome,{pixelScale,detailLevel:'detail'}));
          let source=sprites.get(pixelScale)(kind,variant,1,'',span),bounds=visible(source);
          const enlargement=Math.min(84/bounds.sw,88/bounds.sh)*density;
          if(enlargement>1+1e-7){pixelScale=2**Math.ceil(Math.log2(pixelScale*enlargement));if(!sprites.has(pixelScale))sprites.set(pixelScale,q.createSprites(biome,{pixelScale,detailLevel:'detail'}));source=sprites.get(pixelScale)(kind,variant,1,'',span);bounds=visible(source);}
          const{left,top,sw,sh}=bounds,fit=Math.min(84/sw,88/sh),w=sw*fit,h=sh*fit;
          const expected=canvas(96*density,100*density),c=expected.getContext('2d');c.scale(density,density);c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';c.drawImage(source,left,top,sw,sh,(96-w)/2,(100-h)/2,w,h);
          const key=portrait.dataset.artDrawn,first=hash(portrait);drawUIArtwork(root,{biome,routes:[],vehicles:[]});
          ui.push({biome,kind,variant,matches:first===hash(expected),sharp:sw>=w*density&&sh>=h*density,stable:portrait.dataset.artDrawn===key&&hash(portrait)===first});
        }
      }
      return { masters, profiles, ui, stats: assets.getHouseAssetStats() };
    });
    assert.deepEqual(checks.stats.availableBiomes.slice().sort(), ['desert', 'taiga', 'tundra']);
    assert.equal(checks.masters.length, 18);
    assert.deepEqual(checks.stats.availableDesigns, [0,1,2]);
    assert.ok(checks.stats.decodedBytes <= 72 * 1024 * 1024, 'six shared neutral design/orientation sheets through512px retain a fixed decoded-art budget');
    for (const design of [0,1,2]) for (const rotation of [0,1]) assert.deepEqual(checks.stats.designStats[design].rotations[rotation].availableBiomes.slice().sort(), ['desert','taiga','tundra']);
    for (const rotation of [0,1]) assert.deepEqual(checks.stats.rotationStats[rotation].availableBiomes.slice().sort(), ['desert','taiga','tundra']);
    for (const master of checks.masters) {
      assert.equal(master.width, 768); assert.equal(master.height, 768);
      for (const silhouette of master.silhouettes) {
        assert.ok(silhouette.transparent > 256 * 256 * .10, `${master.biome} rotation ${master.rotation} ${silhouette.kind} has a transparent cutout, not an opaque background`);
        assert.ok(silhouette.visible > 256 * 256 * .08, `${master.biome} rotation ${master.rotation} ${silhouette.kind} contains a substantial visible house`);
        assert.ok(silhouette.borderVisible < 80, `${master.biome} rotation ${master.rotation} ${silhouette.kind} is not clipped at its atlas cell edges`);
      }
    }
    for (const profile of checks.profiles) {
      assert.equal(new Set(profile.houses.map(house => house.hash)).size, 9, 'all nine houses have distinct pixels at each zoom and density');
      assert.equal(profile.artwork.activeBiome, profile.biome);
      assert.equal(profile.artwork.activeDesign, profile.design, 'all three physical designs have loaded climate artwork');
      assert.equal(profile.artwork.activeRotation, profile.rotation, 'both physical orientations have loaded climate artwork');
      assert.equal(profile.artwork.lastCellSize, profile.cell, 'renderer selects the authored native density');
      for (const house of profile.houses) {
        assert.equal(house.sharesRotation,true,'variants of the same authored rotation share one sprite');
        assert.equal(house.distinctRotation,true,'physical rotations retain separate cached sprites');
        assert.equal(house.distinctPixels,true,'physical rotations have distinct rendered pixels');
        assert.equal(house.distinctDesign,true,'architectural designs have distinct rendered pixels');
        assert.equal(house.stable,true,'random placement rotation stays stable for repeated draws');
        assert.equal(house.matchesLOD, true, `${profile.biome} rotation ${profile.rotation} ${house.kind} uses the generated bitmap at ${profile.cell}px`);
        assert.equal(house.width, profile.cell); assert.equal(house.height, profile.cell * 1.25);
        assert.ok(profile.artwork.rasterizedHouses[house.kind] > 0);
      }
    }
    for (const biome of ['taiga','tundra','desert']) for (const zoom of [.5,1,2]) for (const index of Array.from({length:9},(_,i)=>i)) {
      const identities=checks.profiles.filter(profile=>profile.biome===biome&&profile.zoom===zoom).map(profile=>profile.houses[index].hash);
      assert.equal(new Set(identities).size,6,`${biome} ${checks.profiles[0].houses[index].kind} zoom${zoom} has six distinct design/orientation images`);
    }
    for(const portrait of checks.ui){assert.equal(portrait.matches,true,`${portrait.biome} ${portrait.kind} variant${portrait.variant} UI portrait fits its exact map identity without distortion`);assert.equal(portrait.sharp,true,'UI source pixels cover the physical portrait size');assert.equal(portrait.stable,true,'repainting unchanged portraits reuses their bitmap');}
    // Full originals on a checkerboard make halos or accidental backgrounds
    // visible; the gallery below also shows the real 16/32/64 logical sizes.
    if (dpr === 1) for (const biome of ['taiga', 'tundra', 'desert']) {
      await page.evaluate(async biome => {
        const q = houseQA; document.querySelector('#gallery').replaceChildren();
        const section = q.section(`${biome} · 256 px generated originals`), master = q.canvas(768, 768);
        master.className = 'master grid'; master.getContext('2d').drawImage(await q.load(q.assets.HOUSE_ATLAS_URLS[biome]), 0, 0); section.append(master);
      }, biome);
      await page.locator('#gallery').screenshot({ path: `${output}/${biome}-source.png` });
    }
    await page.evaluate(() => {
      const q = houseQA; document.querySelector('#gallery').replaceChildren();
      for (const biome of q.assets.HOUSE_BIOMES) {
        const section = q.section(`${biome} · Region / Town / Detail · DPR ${devicePixelRatio}`);
        const gallery = q.canvas(1000 * devicePixelRatio, 210 * devicePixelRatio);
        gallery.style.width = '1000px'; gallery.style.height = '210px'; const c = gallery.getContext('2d');
        c.scale(devicePixelRatio, devicePixelRatio); c.imageSmoothingEnabled = false; c.fillStyle = biome === 'tundra' ? '#d8e1d6' : biome === 'desert' ? '#d8c096' : '#9aad7a'; c.fillRect(0, 0, 1000, 210);
        for (const [row, zoom, detailLevel] of [[0, .5, 'region'], [1, 1, 'town'], [2, 2, 'detail']]) {
          const sprite = q.createSprites(biome, { pixelScale: zoom * devicePixelRatio, detailLevel });
          q.assets.HOUSE_KINDS.forEach((kind, index) => c.drawImage(sprite(kind, index, 1), 20 + index * 108, 8 + row * 58, 32 * zoom, 40 * zoom));
        }
        section.append(gallery);
      }
    });
    await page.locator('#gallery').screenshot({ path: `${output}/houses-three-zooms-dpr${dpr}.png` });
    const tours = [];
    for (const biome of ['taiga', 'tundra', 'desert']) {
      await page.evaluate(biome => { houseQA.world = houseQA.setupWorld(biome); }, biome);
      for (const zoom of [.5, 1, 2]) {
        const stats = await page.evaluate(zoom => { const w = houseQA.world; w.renderer.setZoom(zoom); w.renderer.render(0); return w.renderer.getStats(); }, zoom);
        assert.equal(stats.houseArtwork.activeBiome, biome); assert.equal(stats.rasterScale, zoom * dpr);
        // A previously visited zoom can reuse its chunks without another
        // raster-house draw; lastCellSize then describes an earlier draw.
        assert.ok(stats.houseArtwork.lodCellSizes.includes(32 * zoom * dpr));
        await page.locator('.world').screenshot({ path: `${output}/${biome}-game-zoom${zoom}-dpr${dpr}.png` });
      }
      const tour = await page.evaluate(() => {
        const w = houseQA.world, frames = [];
        for (const zoom of [.5, 1, 2]) for (const [x, y] of [[20, 20], [45, 35], [76, 70], [110, 50], [60, 46]]) {
          w.renderer.setZoom(zoom); w.renderer.focus(x, y); w.renderer.render(0); const before = w.renderer.getStats();
          w.renderer.render(0); frames.push({ ...w.renderer.getStats(), recomposed: w.renderer.getStats().composedChunks - before.composedChunks });
        }
        return frames;
      });
      for (const stats of tour) { assert.ok(stats.cacheBytes <= stats.cacheLimit); assert.ok(stats.cacheLimit <= 256 * 1024 * 1024); assert.equal(stats.recomposed, 0); }
      tours.push(...tour);
    }
    results.push({ dpr, nativeProfiles: checks.profiles.length, checkedHouseSprites: checks.profiles.reduce((count, item) => count + item.houses.length, 0), checkedPortraits:checks.ui.length, maxCacheMiB: +(Math.max(...tours.map(item => item.cacheBytes)) / 1024 / 1024).toFixed(1) });
    await context.close();
  }

  // The alternate orientation may arrive after primary sprites are cached.
  // Keep the same house/climate visible until its own physical rotation loads.
  const alternate = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  let releaseAlternate;
  const alternateGate = new Promise(resolve => { releaseAlternate = resolve; });
  await alternate.route('**/assets/world/plot-buildings-v2/houses-*-rotation-1/**', async route => { await alternateGate; await route.continue(); });
  const alternatePage = await harness(alternate);
  const waitingAlternate = await alternatePage.evaluate(async () => {
    const q=houseQA;
    await q.assets.preloadHouses({biome:'taiga',cells:[16,32,64],rotations:[0]});
    q.rotationSprite=q.createSprites('taiga',{pixelScale:1});
    return { primary:q.hash(q.rotationSprite('house-cheap-1',0)), alternate:q.hash(q.rotationSprite('house-cheap-1',1)), rotation:q.assets.getHouseAssetStats('taiga').lastRotation, revision:q.assets.houseAssetsRevision() };
  });
  assert.equal(waitingAlternate.primary,waitingAlternate.alternate,'a pending alternate shows its same-climate primary house');
  assert.equal(waitingAlternate.rotation,0);
  releaseAlternate();
  await alternatePage.waitForFunction(() => houseQA.assets.getHouseAssetStats('taiga').availableRotations.length === 2 && houseQA.assets.getHouseAssetStats('taiga').status === 'ready');
  const loadedAlternate = await alternatePage.evaluate(() => {
    const q=houseQA,primary=q.hash(q.rotationSprite('house-cheap-1',0)),alternate=q.hash(q.rotationSprite('house-cheap-1',1));
    return {primary,alternate,stable:alternate===q.hash(q.rotationSprite('house-cheap-1',19)),rotation:q.assets.getHouseAssetStats('taiga').lastRotation,revision:q.assets.houseAssetsRevision()};
  });
  assert.equal(loadedAlternate.primary,waitingAlternate.primary);
  assert.notEqual(loadedAlternate.alternate,waitingAlternate.alternate,'arrival invalidates the cached primary fallback for rotation 1');
  assert.equal(loadedAlternate.stable,true);assert.equal(loadedAlternate.rotation,1);assert.ok(loadedAlternate.revision>waitingAlternate.revision);
  await alternate.close();

  // Architecture can arrive independently of rotation. A requested new design
  // uses a healthy same-climate base design until its own sheet has decoded.
  const designContext = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  let releaseDesign;
  const designGate = new Promise(resolve => { releaseDesign = resolve; });
  await designContext.route('**/assets/world/plot-buildings-v2/houses-design-1-*/**', async route => { await designGate; await route.continue(); });
  const designPage = await harness(designContext);
  const waitingDesign = await designPage.evaluate(async () => {
    const q = houseQA;
    await q.assets.preloadHouses({ biome:'taiga', designs:[0,2], cells:[16,32,64] });
    q.designSprite = q.createSprites('taiga', { pixelScale:1 });
    const base = q.designSprite('house-normal-2',1), requested = q.designSprite('house-normal-2',7);
    q.pendingDesignSprite = requested;
    return { base:q.hash(base), requested:q.hash(requested), repeated:requested===q.designSprite('house-normal-2',25), active:q.assets.getHouseAssetStats('taiga',1,1).activeDesign, revision:q.assets.houseAssetsRevision() };
  });
  assert.equal(waitingDesign.base, waitingDesign.requested, 'a pending design retains its climate and requested rotation');
  assert.equal(waitingDesign.repeated, true); assert.equal(waitingDesign.active, 0);
  releaseDesign();
  await designPage.waitForFunction(() => houseQA.assets.getHouseAssetStats('taiga',1,1).activeDesign === 1 && houseQA.assets.getHouseAssetStats('taiga').status === 'ready');
  const loadedDesign = await designPage.evaluate(() => {
    const q=houseQA,after=q.designSprite('house-normal-2',7);
    return { hash:q.hash(after), replaced:after!==q.pendingDesignSprite, repeated:after===q.designSprite('house-normal-2',25), revision:q.assets.houseAssetsRevision() };
  });
  assert.notEqual(loadedDesign.hash, waitingDesign.requested, 'the generated architecture changes the rendered pixels');
  assert.equal(loadedDesign.replaced, true); assert.equal(loadedDesign.repeated, true); assert.ok(loadedDesign.revision > waitingDesign.revision);
  await designContext.close();

  const missingDesigns = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await missingDesigns.route(/\/assets\/world\/plot-buildings-v2\/houses-design-[12]-rotation-[01]\//, route => route.abort());
  const missingDesignPage = await harness(missingDesigns);
  const healthyBase = await missingDesignPage.evaluate(async () => {
    const q=houseQA;await q.assets.preloadHouses({biome:'taiga'});
    const sprite=q.createSprites('taiga',{pixelScale:1});
    return q.assets.HOUSE_KINDS.every(kind => q.assets.HOUSE_DESIGNS.every(design => q.assets.HOUSE_ROTATIONS.every(rotation => q.hash(sprite(kind,design*6+rotation))===q.hash(sprite(kind,rotation)))));
  });
  assert.equal(healthyBase, true, 'missing alternate architecture keeps the healthy base design in its climate and rotation');
  await missingDesigns.close();

  // A slow connection may paint native fallback first. Once the PNGs arrive,
  // both existing sprite closures and existing renderer chunks must refresh.
  const delayed = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  let releaseImages;
  const gate = new Promise(resolve => { releaseImages = resolve; });
  await delayed.route('**/assets/world/plot-buildings-v2/houses-*/**', async route => { await gate; await route.continue(); });
  const slowPage = await harness(delayed);
  const before = await slowPage.evaluate(async () => {
    const q = houseQA; q.world = q.setupWorld('taiga'); q.sprite = q.createSprites('taiga', { pixelScale: 1 });
    q.beforeSprite = q.hash(q.sprite('house-cheap-1')); q.savedGame = JSON.stringify(q.world.game); q.beforeCamera = q.world.renderer.getCamera();
    const started = performance.now(), ready = await q.assets.preloadHouses({ waitMs: 25 });
    return { ready, waited: performance.now() - started, stats: q.world.renderer.getStats(), sprite: q.beforeSprite, image: q.hash(q.world.view) };
  });
  assert.equal(before.ready, false); assert.equal(before.stats.houseArtwork.status, 'loading'); assert.equal(before.stats.houseArtwork.activeBiome, null);
  assert.ok(before.waited < 1500, 'startup stops waiting for slow artwork after its bounded timeout');
  releaseImages();
  await slowPage.waitForFunction(() => houseQA.assets.getHouseAssetStats().status === 'ready' && houseQA.assets.getHouseAssetStats().availableBiomes.length === 3);
  const after = await slowPage.evaluate(() => {
    const q = houseQA; q.world.renderer.render(0); const stats = q.world.renderer.getStats(), image = q.hash(q.world.view);
    q.world.renderer.render(0);
    return { stats, image, sprite: q.hash(q.sprite('house-cheap-1')), stableChunks: q.world.renderer.getStats().composedChunks === stats.composedChunks, sameGame: q.savedGame === JSON.stringify(q.world.game), sameCamera: JSON.stringify(q.beforeCamera) === JSON.stringify(q.world.renderer.getCamera()) };
  });
  assert.notEqual(after.sprite, before.sprite, 'an existing sprite closure replaces its native fallback');
  assert.notEqual(after.image, before.image, 'visible cached town chunks refresh when artwork finishes loading');
  assert.ok(after.stats.composedChunks > before.stats.composedChunks);
  assert.equal(after.stableChunks, true); assert.equal(after.sameGame, true); assert.equal(after.sameCamera, true);
  await delayed.close();

  for (const missing of ['all']) {
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    await context.route('**/assets/world/plot-buildings-v2/houses-*/**', route => route.abort());
    const page = await harness(context);
    const fallback = await page.evaluate(async missing => {
      const q = houseQA, loaded = await q.assets.preloadHouses();
      const sprite = q.createSprites('tundra', { pixelScale: 2, detailLevel: 'detail' });
      const taiga = q.createSprites('taiga', { pixelScale: 2, detailLevel: 'detail' });
      const matches = q.assets.HOUSE_KINDS.map((kind, variant) => {
        const actual = sprite(kind, variant, 1), expected = q.canvas(64, 80);
        if (missing === 'all') { const c = expected.getContext('2d'); c.scale(2, 2); c.translate(0, 8); q.drawTownBuilding(c, kind, 'tundra', 'detail', variant); }
        else expected.getContext('2d').drawImage(taiga(kind, variant, 1), 0, 0);
        return q.hash(actual) === q.hash(expected);
      });
      const world = q.setupWorld('tundra'), stats = world.renderer.getStats();
      return { loaded, matches, stats, repeated: await q.assets.preloadHouses({ retry: false }) };
    }, missing);
    assert.deepEqual(fallback.matches, Array(9).fill(true), missing === 'all' ? 'missing images keep all nine native fallback houses' : 'a missing biome uses complete taiga artwork');
    assert.equal(fallback.loaded, missing !== 'all'); assert.equal(fallback.repeated, missing !== 'all');
    assert.equal(fallback.stats.houseArtwork.activeBiome, missing === 'all' ? null : 'taiga');
    assert.equal(fallback.stats.houseArtwork.status, missing === 'all' ? 'failed' : 'ready');
    await context.close();
  }
  assert.deepEqual(errors, [], 'house decoding and fallback do not throw browser errors');
  console.log(JSON.stringify({ results, delayed: 'sprite and chunk caches refresh without game or camera mutation', fallback: 'missing designs → healthy design at the same rotation; all missing → native', screenshots: output }, null, 2));
} finally { await browser.close(); }
