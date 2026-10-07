// Every catalog portrait at its real selected Gallery size. Source sampling,
// aspect and alpha checks supplement visual contact sheets, not aesthetic goldens.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-gallery-portrait-quality';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [], failures = [], profiles = [];
try {
  for (const dpr of [1,1.3,2]) {
    const context = await browser.newContext({ viewport: { width: 1150, height: 800 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    page.on('response',r=>{if(r.status()>=400)failures.push(`${r.status()} ${r.url()}`);});
    await page.route('**/portrait-quality-qa',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><link rel="stylesheet" href="./tokens.css"><link rel="stylesheet" href="./components.css"><link rel="stylesheet" href="./dialogs.css"><link rel="stylesheet" href="./gallery.css"><div id="gallery"></div>'}));
    await page.goto(new URL('portrait-quality-qa',base).href);
    await page.evaluate(async()=>{
      const [{mountGallery},{galleryCatalog},atlas,houses]=await Promise.all([import('./gallery-view.js'),import('./catalog-data.js'),import('./atlas-runtime.js'),import('./raster-houses.js')]);
      await atlas.preloadWorldArt({cells:[16,32,64,128,256,512],waitMs:30000});
      await houses.preloadHouses({cells:[16,32,64,128,256,512],waitMs:30000});
      window.portraitQA={mountGallery,galleryCatalog,atlas,houses};
    });
    for(const biome of ['taiga','tundra','desert']) {
      const result=await page.evaluate(biome=>{
        const q=portraitQA,root=document.querySelector('#gallery'),game={biome,day:800,money:500000,seed:1847,routes:[],vehicles:[]},before=JSON.stringify(game);
        q.view?.dispose();q.view=q.mountGallery(root,game,{}, {climate:biome,category:'all'});
        const ids=[...root.querySelectorAll('[data-gallery-entry]')].map(e=>e.dataset.galleryEntry),rows=[],copies=[];
        for(const id of ids){
          root.querySelector(`[data-gallery-entry="${id}"]`).click();
          const canvas=root.querySelector('.gallery-portrait canvas');if(!canvas)continue;
          const css=canvas.getBoundingClientRect(),pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
          let ink=0,edge=0;for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(pixels[(y*canvas.width+x)*4+3]>16){ink++;if(x===0||y===0||x===canvas.width-1||y===canvas.height-1)edge++;}
          rows.push({id,css:{width:css.width,height:css.height},width:canvas.width,height:canvas.height,ink,edge});
          const copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;copy.getContext('2d').drawImage(canvas,0,0);copies.push({id,canvas:copy});
        }
        const sheet=document.createElement('canvas'),columns=6,cellW=174,cellH=184,density=devicePixelRatio;
        sheet.width=Math.round(columns*cellW*density);sheet.height=Math.round(Math.ceil(copies.length/columns)*cellH*density);
        const c=sheet.getContext('2d');c.scale(density,density);c.fillStyle='#e5e3d5';c.fillRect(0,0,sheet.width/density,sheet.height/density);c.font='10px sans-serif';
        for(const [i,copy]of copies.entries()){const x=i%columns*cellW,y=Math.floor(i/columns)*cellH;c.drawImage(copy.canvas,0,0,copy.canvas.width,copy.canvas.height,x+11,y+6,152,152);c.fillStyle='#34453f';c.fillText(copy.id,x+5,y+172,164);}
        return {rows,immutable:before===JSON.stringify(game),image:sheet.toDataURL('image/png').split(',')[1],assets:q.atlas.worldArtStats()};
      },biome);
      for(const row of result.rows){const label=`${biome}/DPR${dpr}/${row.id}`;assert.equal(row.css.width,152,label+' CSS width');assert.equal(row.css.height,152,label+' CSS height');assert.equal(row.width,Math.round(152*dpr),label+' physical width');assert.equal(row.height,Math.round(152*dpr),label+' physical height');assert.ok(row.ink>8,label+' visible artwork');assert.equal(row.edge,0,label+' complete isolated artwork');}
      assert.equal(result.immutable,true);assert.deepEqual(result.assets.errors,[]);
      await writeFile(`${output}/${biome}-dpr${dpr}.png`,Buffer.from(result.image,'base64'));
      profiles.push({biome,dpr,rows:result.rows});
    }
    await context.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
  await writeFile(`${output}/results.json`,JSON.stringify({profiles,errors,failures},null,2));
  console.log(JSON.stringify({profiles:profiles.length,portraits:profiles.reduce((n,p)=>n+p.rows.length,0),errors,output}));
} finally {await browser.close();}
