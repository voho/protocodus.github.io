// Generated fleet art must replace late-loading fallback art without changing
// headings, collision scale or the distinct complementary flight palettes.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const output = process.env.TYRAN_SCREENSHOTS || '/tmp/tyran-qa';
await mkdir(output, { recursive: true });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route('**/assets/sprites/fleet.png', async route => {
    await held;
    if (process.env.TYRAN_FLEET_SOURCE) await route.fulfill({ path: process.env.TYRAN_FLEET_SOURCE, contentType: 'image/png' });
    else await route.continue();
  });
  await page.goto(process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/', { waitUntil: 'domcontentloaded' });
  assert.equal(await page.locator('#startup-status').isVisible(),true,'Slow loading has a visible preparation state');
  assert.equal(await page.locator('#menu-screen').evaluate(menu=>menu.inert),true,'Menu controls cannot silently accept input before artwork is ready');
  const before = await page.evaluate(async () => {
    const { drawShip } = await import('./ships.js');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 320;
    window.rasterFleetProbe = canvas;
    drawShip(canvas.getContext('2d'), 160, 160, 70, 4, null, 0, { world: 0, thrust: 0, quality: 'low' });
    return canvas.toDataURL();
  });
  release();
  await page.waitForFunction(()=>window.tyran);
  assert.equal(await page.locator('#startup-status').isVisible(),false,'Preparation status clears after decode');
  assert.equal(await page.locator('#menu-screen').evaluate(menu=>menu.inert),false,'Loaded menu becomes interactive');
  const result = await page.evaluate(async () => {
    const { spriteCell, spritesReady, spriteStatus } = await import('./sprite-assets.js');
    await spritesReady;
    const { drawShip, warmShipSprites, SHIP_PALETTES } = await import('./ships.js');
    const probe = window.rasterFleetProbe, c = probe.getContext('2d');
    c.clearRect(0,0,320,320);
    drawShip(c,160,160,70,4,null,0,{world:0,thrust:0,quality:'low'});
    const after = probe.toDataURL();
    const fleet = Array.from({length:11},(_,index) => spriteCell('fleet',index));
    const cells = fleet.map(cell => {
      if (!cell) return null;
      const pixels = cell.getContext('2d').getImageData(0,0,cell.width,cell.height).data;
      let occupied = 0, empty = 0, edge = 0;
      for(let i=3;i<pixels.length;i+=4) {if(pixels[i]>160)occupied++;if(pixels[i]<8)empty++;}
      for(let x=0;x<cell.width;x++)edge+=pixels[x*4+3]+pixels[((cell.height-1)*cell.width+x)*4+3];
      for(let y=0;y<cell.height;y++)edge+=pixels[(y*cell.width)*4+3]+pixels[(y*cell.width+cell.width-1)*4+3];
      return { width:cell.width,height:cell.height,occupied,empty,edge };
    });
    const paletteSignatures=[];
    document.body.innerHTML='<canvas id="raster-fleet" width="1440" height="1200" style="position:fixed;inset:0;width:1440px;height:1200px"></canvas>';
    const board=document.querySelector('#raster-fleet').getContext('2d');
    const ground=['#274537','#b6c6ce','#b18a53','#178b98','#343335','#8a4434','#392d2a','#33283e','#574469','#252330'];
    for(let world=0;world<10;world++){
      warmShipSprites(SHIP_PALETTES[world],world);warmShipSprites('#71ecff',world,true);
      board.fillStyle=ground[world];board.fillRect(0,world*120,1440,120);
      board.fillStyle='#091016';board.fillRect(0,world*120,1440,22);board.font='12px monospace';board.fillStyle='#fff';board.fillText(SHIP_PALETTES[world].id,8,world*120+15);
      for(let kind=-1;kind<10;kind++)drawShip(board,64+(kind+1)*130,world*120+72,kind===9?33:27,kind<0?'player':kind,null,0,{world,thrust:0,quality:'high'});
      c.clearRect(0,0,320,320);drawShip(c,160,160,70,4,null,0,{world,thrust:0,quality:'low'});
      paletteSignatures.push(probe.toDataURL());
    }
    return {after,cells,cacheReused:spriteCell('fleet',0)===fleet[0],paletteCount:new Set(paletteSignatures).size,status:spriteStatus()};
  });
  assert.equal(result.status.fleet.state,'ready');
  assert.notEqual(result.after,before,'Late asset arrival must replace already-cached procedural hulls');
  assert.equal(result.cacheReused,true,'Decoded atlas cells must be reused');
  for(const cell of result.cells){assert.ok(cell,'Every hull cell exists');assert.ok(cell.width>50&&cell.height>50);assert.ok(cell.occupied>500,'Hull has opaque material');assert.ok(cell.empty>100,'Hull retains a transparent silhouette');assert.equal(cell.edge,0,'Hulls crossing source grid boundaries remain whole and padded');}
  assert.equal(result.paletteCount,10,'All ten fleet palettes must remain distinct');
  await page.screenshot({path:`${output}/raster-fleet.png`});
  console.log('Raster fleet QA passed: 11 transparent hulls, ten palettes, reused cells and replacement of late fallback artwork.');
} finally { await browser.close(); }
