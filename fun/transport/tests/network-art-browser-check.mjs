// Generated network textures must cover bends and junctions at every zoom,
// while the connected geometric bed preserves their navigable topology.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const baseURL = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-network-art';
await mkdir(output, { recursive: true });
const errors = [], results = [];
try {
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1240, height: 900 }, deviceScaleFactor: dpr });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.route('**/network-art-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:0;background:#95a981;font:16px system-ui}canvas{display:block;width:1200px;height:800px}</style><canvas></canvas>' }));
    await page.goto(new URL('network-art-qa', baseURL).href);
    await page.evaluate(async () => {
      const { createRenderer } = await import('./renderer.js'), { createGame } = await import('./model.js');
      const { drawRasterNetwork } = await import('./raster-transport.js'), art = await import('./atlas-runtime.js');
      await art.preloadWorldArt({ waitMs: 12000 });
      const game = createGame({ size: 'regional', seed: 418 });
      for (const key of ['cities', 'industries', 'stations', 'vehicles', 'routes', 'zones']) game[key] = [];
      for (const t of game.tiles) Object.assign(t, { terrain: 'grass', elevation: .25, detail: '', building: null, zone: null, road: false, rail: false, bridge: false, tunnel: false });
      const tile = (x, y) => game.tiles[y * game.width + x], directions = [[0,-1],[1,0],[0,1],[-1,0]];
      const patterns = [3, 6, 9, 12, 7, 11, 15];
      const centers = [];
      for (const [row, mode] of ['road','rail'].entries()) for (const [column, mask] of patterns.entries()) {
        const x = 15 + column * 3, y = 22 + row * 5; tile(x,y)[mode] = true;
        for (let i=0;i<4;i++) if(mask & (1<<i)){const [dx,dy]=directions[i];tile(x+dx,y+dy)[mode]=true;}
        centers.push({ x, y, mode, mask });
      }
      game.revision++;
      const canvas = document.querySelector('canvas'), renderer = createRenderer(canvas, game, { layers: { names:false, trees:false, buildings:false, industryIcons:false, lighting:false, routes:false } });
      window.networkArtQA = { game, renderer, canvas, drawRasterNetwork, art, directions, centers };
    });
    for (const zoom of [.5, 1, 2]) {
      const checks = await page.evaluate(zoom => {
        const q=networkArtQA, kinds=['road','rail','road-bridge','rail-bridge'], masks=[];
        const expectedIndices={road:3,rail:4,'road-bridge':5,'rail-bridge':6};
        for (const kind of kinds) for(let mask=1;mask<16;mask++) {
          const canvas=document.createElement('canvas');canvas.width=canvas.height=64*zoom*devicePixelRatio;
          const c=canvas.getContext('2d'), draws=[],original=c.drawImage.bind(c);
          c.drawImage=(image,...args)=>{draws.push({src:image.src,index:args[1]/args[3]*3+args[0]/args[2]});original(image,...args);};
          c.scale(zoom*devicePixelRatio,zoom*devicePixelRatio);
          const arms=q.directions.filter((_,i)=>mask&(1<<i));
          const painted=q.drawRasterNetwork(c,kind,32,32,arms,zoom*devicePixelRatio);
          const straight=arms.length<=2&&arms.every(([dx,dy])=>arms[0][0]===0?dx===0:dy===0);
          masks.push({kind,mask,painted,draws,expectedDraws:straight?1:arms.length,expectedIndex:expectedIndices[kind],ink:Array.from(c.getImageData(0,0,canvas.width,canvas.height).data).some((v,i)=>i%4===3&&v>0)});
        }
        q.renderer.setZoom(zoom);q.renderer.focus(24,25);
        const observed=[],draw=CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage=function(image,...args){
          if(image.src?.includes('/infrastructure/'))observed.push(args[1]/args[3]*3+args[0]/args[2]);
          return draw.call(this,image,...args);
        };
        try{q.renderer.render(0);}finally{CanvasRenderingContext2D.prototype.drawImage=draw;}
        const composed=q.renderer.getStats().composedChunks;q.renderer.render(0);
        return{masks,observed,extra:q.renderer.getStats().composedChunks-composed,stats:q.art.worldArtStats()};
      },zoom);
      assert.deepEqual(checks.stats.errors,[]);
      for(const p of checks.masks){
        const label=`${p.kind} mask ${p.mask} zoom ${zoom} DPR ${dpr}`;
        assert.equal(p.painted,true,label);assert.equal(p.ink,true,label);assert.equal(p.draws.length,p.expectedDraws,label);
        for(const draw of p.draws){assert.ok(draw.src.includes('/infrastructure/'),label);assert.equal(draw.index,p.expectedIndex,label);}
      }
      // Each mode has 18 textured junction arms and their approach pieces.
      // Cached chunk gutters may repeat individual pieces.
      for(const index of [3,4])assert.ok(checks.observed.filter(i=>i===index).length>=30,'real renderer uses generated textures on connected bends and junctions');
      assert.equal(checks.extra,0,'unchanged generated network chunks remain cached');
      results.push({zoom,dpr,shapes:checks.masks.length,infrastructureDraws:checks.observed.length});
      await page.locator('canvas').screenshot({path:`${output}/junctions-zoom${zoom}-dpr${dpr}.png`});
    }
    await context.close();
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,results,output},null,2));
} finally {await browser.close();}
