// Selective camera corrections preserve untouched art and authored window panes.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-commerce-camera-qa';
await mkdir(output, { recursive: true });
const errors = [], profiles = [], integrity = [];
try {
  for (const dpr of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 720, height: 560 }, deviceScaleFactor: dpr });
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/commerce-camera-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
    await page.goto(new URL('commerce-camera-qa', base).href);
    const result = await page.evaluate(async () => {
      const art = await import('./raster-buildings.js'), atlas = await import('./atlas-runtime.js'), { createSprites } = await import('./sprites.js'), { createLighting } = await import('./lighting.js'), { DEFAULT_LAYERS } = await import('./visibility.js');
      await atlas.preloadWorldArt({ waitMs: 12000 });
      if (atlas.worldArtStats().errors.length) throw Error('Registered artwork failed to decode');
      const load = async url => { const im = new Image(); im.src = url; await im.decode(); return im; };
      const canvas = document.createElement('canvas'); canvas.width = 600 * devicePixelRatio; canvas.height = 440 * devicePixelRatio; document.body.append(canvas);
      const c = canvas.getContext('2d', { willReadFrequently: true }), light = createLighting(), results = [], integrity = [];
      const make = (w, h) => { const a = document.createElement('canvas'); a.width = w; a.height = h; return a; };
      for (const biome of ['taiga', 'tundra', 'desert']) {
        const oldPath = `assets/world/buildings-commerce/${biome}`, newPath = `assets/world/buildings-commerce-camera-v2/${biome}`;
        const meta = await fetch(`${newPath}/atlas.json`).then(r => r.json());
        if (devicePixelRatio === 1) for (const size of [16, 32, 64, 128, 256]) {
          const old = await load(`${oldPath}/atlas-${size}.png`), next = await load(`${newPath}/atlas-${size}.png`), a = make(size, size), ac = a.getContext('2d', { willReadFrequently: true });
          for (let index = 0; index < 9; index++) {
            const crop = im => { ac.clearRect(0, 0, size, size); ac.drawImage(im,index%3*size,Math.floor(index/3)*size,size,size,0,0,size,size);return ac.getImageData(0,0,size,size).data; };
            const before = crop(old), after = crop(next);let changed = 0;
            for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) changed++;
            integrity.push({ biome, size, id: meta.order[index], changed, expectedChange: [1,4,6].includes(index) });
          }
        }
        for (const kind of ['shop-hardware','service-bank','service-garage']) {
          const source = await load(`${newPath}/sources/${kind}.png`), probe = make(256,256), pc = probe.getContext('2d', { willReadFrequently: true });pc.drawImage(source,0,0);
          const panes = art.rasterBuildingWindows(kind,biome), samples = panes.map(([x,y,w,h]) => Array.from(pc.getImageData(Math.floor((x+w/2)*8),Math.floor((y+h/2)*8),1,1).data));
          if (!samples.length || samples.some(p => p[3] < 200 || p[0] > 160 || p[1] > 170)) throw Error(`Window anchor not in dark exposed glass ${kind}/${biome}: ${JSON.stringify(samples)}`);
          for (const zoom of [.5,1,2]) {
            const span = kind === 'shop-hardware' ? 1 : 2, dpr = devicePixelRatio, sprites = createSprites(biome,{pixelScale:zoom*dpr*1.5}), sprite = sprites(kind,0,1,'',span);
            const game = { width:8,height:8,day:30,seed:7,biome,tiles:Array.from({length:64},()=>({terrain:'grass'})),vehicles:[] };game.tiles[27].building={kind,footprint:span};
            const project = () => ({x:300,y:270}), options = {game,layers:{...DEFAULT_LAYERS,roads:false,rails:false,stations:false,vehicles:false},camera:{x:0,y:0,zoom},width:600,height:440,bounds:{x0:0,y0:0,x1:8,y1:8},industryIndex:new Map(),stationIndex:new Map(),routesById:new Map(),project,projected:true};
            const render = buildings => { c.setTransform(dpr,0,0,dpr,0,0);c.fillStyle='#738970';c.fillRect(0,0,600,440);c.drawImage(sprite,300-24*span*zoom,270-(36*span+12)*zoom,48*span*zoom,(48*span+12)*zoom);light(c,{...options,layers:{...options.layers,buildings}});return c.getImageData(0,0,canvas.width,canvas.height).data; };
            const unlit = render(false), bright = render(true);let lit=0;
            for(const [x,y,w,h] of panes){const px=Math.floor((300+(x+w/2-16)*1.5*span*zoom)*dpr),py=Math.floor((270+(y+h/2-24)*1.5*span*zoom)*dpr),i=(py*canvas.width+px)*4;if(bright[i]+bright[i+1]>unlit[i]+unlit[i+1]+18)lit++;}
            results.push({biome,kind,zoom,dpr,panes:panes.length,lit,glassSamples:samples});
          }
        }
      }
      return {results,integrity,stats:atlas.worldArtStats()};
    });
    profiles.push(...result.results);integrity.push(...result.integrity);await page.close();
  }
  for(const row of integrity)assert.equal(row.changed>0,row.expectedChange,`${row.biome}/${row.id}/${row.size}: only three selected cells change`);
  for(const row of profiles)assert.equal(row.lit,row.panes,`${row.biome}/${row.kind}/${row.zoom}/DPR${row.dpr}: glass lights in place`);
  assert.equal(profiles.length,54);assert.equal(integrity.length,135);assert.deepEqual(errors,[]);
  await writeFile(`${output}/results.json`,JSON.stringify({profiles,integrity,errors},null,2));console.log(JSON.stringify({profiles:profiles.length,verifiedCells:integrity.length,unchangedCells:integrity.filter(r=>!r.expectedChange).length,errors},null,2));
} finally { await browser.close(); }
