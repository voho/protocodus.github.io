// Real generated panes and transport lamps stay on their upright isometric art.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const baseURL = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const errors = [], profiles = [];
try {
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/isometric-lighting-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
    await page.goto(new URL('isometric-lighting-qa', baseURL).href);
    profiles.push(...await page.evaluate(async () => {
      const { createLighting } = await import('./lighting.js'), { createSprites } = await import('./sprites.js');
      const { projectPoint, projectAngle } = await import('./isometric.js'), { vehicleFrameAngle } = await import('./vehicle-directions.js');
      const { preloadWorldArt } = await import('./atlas-runtime.js'), houses = await import('./raster-houses.js');
      const civic = await import('./raster-buildings.js'), industry = await import('./raster-industries.js');
      const { isometricStationLights, drawIsometricPort, drawIsometricStop } = await import('./isometric-infrastructure.js');
      const { DEFAULT_LAYERS } = await import('./visibility.js');
      await Promise.all([preloadWorldArt({ waitMs: 10000 }), houses.preloadHouses({ waitMs: 10000 })]);
      const canvas = document.createElement('canvas'), width = 600, height = 440, dpr = devicePixelRatio;
      canvas.width = width * dpr; canvas.height = height * dpr; document.body.append(canvas);
      const c = canvas.getContext('2d'), drawLighting = createLighting(), result = [];
      const arc = c.arc.bind(c); let bulbs = []; c.arc = (...args) => { bulbs.push(args.slice(0,2)); arc(...args); };
      const game = { width: 8, height: 8, day: 30, seed: 7, biome: 'taiga', tiles: [], vehicles: [] };
      const reset = () => { game.tiles = Array.from({ length: 64 }, () => ({ terrain: 'grass' })); game.vehicles = []; };
      const without = { ...DEFAULT_LAYERS, buildings: false, roads: false, rails: false, stations: false, vehicles: false };
      for (const biome of ['taiga', 'tundra', 'desert']) for (const zoom of [.5, 1, 2]) {
        game.biome = biome;
        const project = (x, y) => { const p = projectPoint((x - 3) * 32, (y - 3) * 32); return { x: width / 2 + p.x * zoom, y: height / 2 + p.y * zoom }; };
        const options = { game, layers: without, camera: { x: 0, y: 0, zoom }, width, height, bounds: { x0: 0, y0: 0, x1: 8, y1: 8 }, industryIndex: new Map(), stationIndex: new Map(), routesById: new Map(), project, projected: true };
        const sprites = createSprites(biome, { pixelScale: zoom * dpr });
        const fixtures = [
          { kind: 'house-expensive-1', span: 1, panes: houses.houseWindowAnchors('house-expensive-1', biome) },
          { kind: 'house-expensive-1', span: 2, panes: houses.houseWindowAnchors('house-expensive-1', biome) },
          { kind: 'hospital', span: 1, panes: civic.rasterBuildingWindows('hospital', biome) },
          { kind: 'hospital', span: 2, panes: civic.rasterBuildingWindows('hospital', biome) },
          { kind: 'stadium', span: 3, panes: civic.rasterBuildingWindows('stadium', biome) },
          { kind: 'refinery', span: 1, panes: industry.rasterIndustryWindows('refinery', biome), industry: true },
          { kind: 'refinery', span: 2, panes: industry.rasterIndustryWindows('refinery', biome), industry: true },
          { kind: 'refinery', span: 3, panes: industry.rasterIndustryWindows('refinery', biome), industry: true },
        ];
        let sampled = 0, lit = 0;
        for (const fixture of fixtures) {
          reset(); options.industryIndex.clear(); const { kind, span, panes } = fixture;
          if (!panes.length) throw new Error(`Missing generated pane fixture ${biome}/${kind}`);
          if (fixture.industry) options.industryIndex.set(27, { x: 3, y: 3, kind, footprint: span });
          else game.tiles[27].building = { kind, footprint: span };
          const center = project(3 + (span - 1) / 2, 3 + (span - 1) / 2);
          const render = buildings => {
            c.setTransform(dpr,0,0,dpr,0,0); c.fillStyle = '#738970'; c.fillRect(0,0,width,height);
            c.drawImage(sprites(kind,0,fixture.industry?span:1,'',span), center.x - 24 * span * zoom, center.y - (36 * span + 12) * zoom, 48 * span * zoom, (48 * span + 12) * zoom);
            drawLighting(c, { ...options, layers: { ...without, buildings } });
            return c.getImageData(0,0,canvas.width,canvas.height).data;
          };
          const unlit = render(false), bright = render(true);
          for (const [x,y,w,h] of panes) {
            const px = Math.floor((center.x + (x + w/2 - 16) * 1.5 * span * zoom) * dpr);
            const py = Math.floor((center.y + (y + h/2 - 24) * 1.5 * span * zoom) * dpr);
            const offset = (py * canvas.width + px) * 4; sampled++;
            if (bright[offset] + bright[offset+1] > unlit[offset] + unlit[offset+1] + 18) lit++;
          }
        }
        result.push({ biome, zoom, dpr, sampled, lit });
        // Projected screen directions must select the same eight headings as art.
        reset(); options.industryIndex.clear(); options.routesById.set('road', { mode: 'road' });
        for (let heading = 0; heading < 8; heading++) {
          const angle = heading * Math.PI / 4; game.vehicles = [{ routeId: 'road', x: 3, y: 3, angle }]; bulbs = [];
          drawLighting(c, { ...options, layers: { ...without, vehicles: true } });
          const screenAngle = vehicleFrameAngle(projectAngle(angle));
          const p = project(3,3), expected = [p.x + 8 * Math.cos(screenAngle) * zoom, p.y + 8 * Math.sin(screenAngle) * zoom];
          if (bulbs.length !== 2 || Math.hypot(bulbs[0][0]-expected[0], bulbs[0][1]-expected[1]) > .0001) throw new Error(`Vehicle beam heading mismatch ${heading}`);
        }
        // A ship nose can cross a bridge tile even when its projected heading does not.
        reset(); options.routesById.set('ship', { mode: 'water' });
        game.vehicles = [{ routeId: 'ship', x: 3.1, y: 3.5, angle: 0 }];
        game.tiles[36] = { terrain: 'water', bridge: true, road: true }; bulbs = [];
        drawLighting(c, { ...options, layers: { ...without, vehicles: true, roads: true } });
        const hull = project(3.1,3.5), nose = [hull.x + 18 * Math.cos(Math.atan(.5)) * zoom, hull.y + 18 * Math.sin(Math.atan(.5)) * zoom];
        if (bulbs.some(p => Math.hypot(p[0]-nose[0],p[1]-nose[1]) < .0001)) throw new Error('Headlight leaked through bridge');
        for (const [mode, dx, dy] of [['road',0,0],['rail',0,0],['water',-1,0],['water',1,0],['water',0,-1],['water',0,1]]) {
          reset(); options.stationIndex.set(27, { mode }); const port = mode === 'water', stationCenter = project(3,3);
          if (port) { for (const tile of game.tiles) tile.terrain = 'water'; game.tiles[(3+dy)*8+3+dx].terrain = 'grass'; }
          const render = stations => {
            c.setTransform(dpr,0,0,dpr,0,0); c.fillStyle = port ? '#507581' : '#738970'; c.fillRect(0,0,width,height);
            c.save(); c.translate(stationCenter.x,stationCenter.y); c.scale(zoom,zoom);
            if (port) drawIsometricPort(c,dx,dy,0,0,zoom*dpr); else drawIsometricStop(c,mode,11,2,zoom*dpr); c.restore();
            drawLighting(c, { ...options, layers: { ...without, stations } }); return c.getImageData(0,0,canvas.width,canvas.height).data;
          };
          const unlit = render(false), bright = render(true), panes = isometricStationLights(mode,dx,dy);
          if (!panes.length) throw new Error('Missing station fixture');
          for (const [x,y,w,h] of panes) {
            const px = Math.floor((stationCenter.x + (x+w/2+(port?0:11))*zoom)*dpr), py = Math.floor((stationCenter.y + (y+h/2+(port?0:2))*zoom)*dpr);
            const i = (py*canvas.width+px)*4;
            if (bright[i]+bright[i+1] <= unlit[i]+unlit[i+1]+18) throw new Error(`Station light left pane ${mode}/${dx}/${dy}`);
          }
          options.stationIndex.clear();
        }
      }
      return result;
    }));
    await context.close();
  }
  for (const profile of profiles) assert.equal(profile.lit, profile.sampled, `${JSON.stringify(profile)} authored panes light at their sprite coordinates`);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ profiles, headingChecks: profiles.length * 8, bridgeOcclusion: 'world coordinates', stationProfiles: profiles.length * 6, dockLamps: 'measured upright panes in four shoreline views' }, null, 2));
} finally { await browser.close(); }
