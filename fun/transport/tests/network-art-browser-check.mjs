// Authored road surfaces and connected gray railway geometry must remain
// visible at every zoom and display density, including turns and junctions.
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
      const { RAIL_PALETTE } = await import('./rail-surface-art.js');
      const { ROAD_PALETTE } = await import('./road-surface-art.js');
      await art.preloadWorldArt({ waitMs: 12000 });
      const game = createGame({ size: 'regional', seed: 418 });
      for (const key of ['cities', 'industries', 'stations', 'vehicles', 'routes', 'zones']) game[key] = [];
      for (const t of game.tiles) { delete t.terrainObject; Object.assign(t, { terrain: 'grass', elevation: .25, detail: '', building: null, zone: null, road: false, rail: false, bridge: false, tunnel: false }); }
      const tile = (x, y) => game.tiles[y * game.width + x], directions = [[0,-1],[1,0],[0,1],[-1,0]];
      const patterns = [5, 10, 3, 6, 9, 12, 7, 11, 13, 14, 15];
      const centers = [];
      for (const [row, mode] of ['road','rail'].entries()) for (const [column, mask] of patterns.entries()) {
        const x = 15 + column * 3, y = 22 + row * 5; tile(x,y)[mode] = true;
        for (let i=0;i<4;i++) if(mask & (1<<i)){const [dx,dy]=directions[i];tile(x+dx,y+dy)[mode]=true;}
        centers.push({ x, y, mode, mask });
      }
      game.revision++;
      const canvas = document.querySelector('canvas'), renderer = createRenderer(canvas, game, { layers: { names:false, trees:false, buildings:false, industryIcons:false, routes:false } });
      window.networkArtQA = { game, renderer, canvas, drawRasterNetwork, art, directions, centers, palette: RAIL_PALETTE, roadPalette: ROAD_PALETTE };
    });
    for (const zoom of [.5, 1, 2]) {
      const checks = await page.evaluate(zoom => {
        const q=networkArtQA, kinds=['road','rail','road-bridge','rail-bridge'], masks=[];
        const expectedIndices={road:0,'road-bridge':2}, scale=zoom*devicePixelRatio;
        for (const kind of kinds) for(let mask=1;mask<16;mask++) {
          const canvas=document.createElement('canvas');canvas.width=canvas.height=64*zoom*devicePixelRatio;
          const c=canvas.getContext('2d'), draws=[],original=c.drawImage.bind(c);
          c.drawImage=(image,...args)=>{draws.push({src:image.src,index:args[1]/args[3]*3+args[0]/args[2]});original(image,...args);};
          c.scale(scale,scale);
          const arms=q.directions.filter((_,i)=>mask&(1<<i));
          const painted=q.drawRasterNetwork(c,kind,32,32,arms,scale,zoom===.5?'region':zoom===2?'detail':'town');
          const straight=arms.length<=2&&arms.every(([dx,dy])=>arms[0][0]===0?dx===0:dy===0);
          const pixels=c.getImageData(0,0,canvas.width,canvas.height).data;
          let opaque=0,coolGray=0;
          for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>200){opaque++;if(pixels[i+2]+2>=pixels[i]&&pixels[i+1]+2>=pixels[i])coolGray++;}
          const endpoints=q.directions.map(([dx,dy],i)=>({connected:Boolean(mask&(1<<i)),alpha:c.getImageData(Math.floor((32+dx*14)*scale),Math.floor((32+dy*14)*scale),1,1).data[3]}));
          masks.push({kind,mask,painted,draws,expectedDraws:0,junction:!straight&&kind==='road',expectedIndex:expectedIndices[kind],ink:Array.from(pixels).some((v,i)=>i%4===3&&v>0),opaque,coolGray,endpoints});
        }
        q.renderer.setZoom(zoom);q.renderer.focus(30,25);
        const observed=[],draw=CanvasRenderingContext2D.prototype.drawImage,stroke=CanvasRenderingContext2D.prototype.stroke;
        let steelStrokes=0,roadStrokes=0;
        CanvasRenderingContext2D.prototype.drawImage=function(image,...args){
          if(image.src?.includes('/city-ground-v3/'))observed.push(args[1]/args[3]*3+args[0]/args[2]);
          return draw.call(this,image,...args);
        };
        CanvasRenderingContext2D.prototype.stroke=function(...args){if(this.strokeStyle===q.palette.steel)steelStrokes++;if(this.strokeStyle===q.roadPalette.asphalt)roadStrokes++;return stroke.call(this,...args);};
        try{q.renderer.render(0);}finally{CanvasRenderingContext2D.prototype.drawImage=draw;CanvasRenderingContext2D.prototype.stroke=stroke;}
        const composed=q.renderer.getStats().composedChunks;q.renderer.render(0);
        return{masks,observed,steelStrokes,roadStrokes,extra:q.renderer.getStats().composedChunks-composed,stats:q.art.worldArtStats()};
      },zoom);
      assert.deepEqual(checks.stats.errors,[]);
      for(const p of checks.masks){
        const label=`${p.kind} mask ${p.mask} zoom ${zoom} DPR ${dpr}`;
        assert.equal(p.painted,true,label);assert.equal(p.ink,true,label);assert.equal(p.draws.length,p.expectedDraws,label);
        if(p.kind.startsWith('rail')){
          assert.ok(p.opaque>8,label);assert.ok(p.coolGray/p.opaque>.98,`${label}: visible material is cool gray`);
          for(const endpoint of p.endpoints)assert.equal(endpoint.alpha>128,endpoint.connected,`${label}: only connected arms reach the tile boundary`);
        }else{
          assert.ok(p.opaque>8,label);
          for(const endpoint of p.endpoints)assert.equal(endpoint.alpha>128,endpoint.connected,`${label}: only connected road arms reach the tile boundary`);
        }
      }
      assert.ok(checks.roadStrokes>=30,'real renderer paints the new carriageway on connected bends and junctions');
      assert.ok(checks.steelStrokes>=30,'real renderer paints gray steel on connected railway bends and junctions');
      assert.ok(!checks.observed.some(i=>i===1||i===3||i===5),'legacy brown rail strips and junction patches cannot cover gray geometry');
      assert.equal(checks.extra,0,'unchanged generated network chunks remain cached');
      results.push({zoom,dpr,shapes:checks.masks.length,roadSurfaceStrokes:checks.roadStrokes,railSteelStrokes:checks.steelStrokes});
      await page.locator('canvas').screenshot({path:`${output}/junctions-zoom${zoom}-dpr${dpr}.png`});
    }
    await context.close();
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,results,output},null,2));
} finally {await browser.close();}
