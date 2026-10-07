// Verify sparse artwork has real transparent gaps, stays selectable and renders
// as one patch at every supported view density.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.TRANSPORT_PLAYWRIGHT||'playwright');
const output=process.env.TRANSPORT_OUTPUT||'/tmp/transport-sparse-nature';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:process.env.TRANSPORT_BROWSER||'chrome',headless:true});
const errors=[],profiles=[];
try {
  for(const dpr of [1,2]) {
    const page=await browser.newPage({viewport:{width:1152,height:980},deviceScaleFactor:dpr});
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/sparse-nature-qa',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><body style="margin:0;background:#dce1d0"><canvas></canvas></body>'}));
    await page.goto(new URL('sparse-nature-qa',process.env.TRANSPORT_URL||'http://127.0.0.1:8765/fun/transport/').href);
    const result=await page.evaluate(async dpr=>{
      const [nature,assets,sprites]=await Promise.all([import('./raster-nature.js'),import('./atlas-runtime.js'),import('./sprites.js')]);
      await assets.preloadWorldArt({waitMs:30000});
      const canvas=document.querySelector('canvas'),c=canvas.getContext('2d');canvas.width=1152*dpr;canvas.height=900*dpr;c.scale(dpr,dpr);
      const pixels=canvas=>{const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let ink=0,clear=0,edge=0;for(let i=3;i<data.length;i+=4){const x=(i-3)/4%canvas.width,y=Math.floor((i-3)/4/canvas.width);if(!data[i])clear++;if(data[i]>32)ink++;if(!x||!y||x===canvas.width-1||y===canvas.height-1)edge=Math.max(edge,data[i]);}return{ink,clear,edge};};
      const records=[],runtime=[],calls=[];const original=CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage=function(image,...args){if(image instanceof HTMLImageElement)calls.push(image.src);return original.call(this,image,...args);};
      for(const [biomeIndex,biome] of ['taiga','tundra','desert'].entries()) {
        const kinds=nature.NATURE_ART_CATALOG.ground[biome].filter(k=>k.endsWith('-sparse'));
        if(kinds.length!==9)throw Error(`Missing sparse identities for ${biome}`);
        for(const [index,sparse] of kinds.entries()) {
          const kind=sparse.replace(/-sparse$/,''),id=`nature-ground-${biome}:${kind}`;
          const variants=Array.from({length:64},(_,v)=>nature.rasterGroundIdentity(kind,biome,v));
          if(!variants.includes(id)||!variants.includes(`${id}-sparse`))throw Error(`Dense or sparse artwork unreachable: ${id}`);
          for(const selected of variants)if(!assets.atlasAvailable(selected))throw Error(`Unregistered ${selected}`);
          if(nature.rasterGroundIdentity(sparse,biome,37)!==`${id}-sparse`)throw Error(`Named sparse identity changed: ${id}`);
          if(nature.nativeNatureDetail(sparse)!==kind)throw Error(`Missing native recovery for ${id}`);
          const pair=[];
          for(const suffix of ['', '-sparse']) {
            const image=new Image();image.src=new URL(`./assets/world/nature-ground-${biome}/${suffix?'sparse/':''}atlas-256.png`,location.href).href;await image.decode();
            const cell=document.createElement('canvas');cell.width=cell.height=256;cell.getContext('2d').drawImage(image,index%3*256,Math.floor(index/3)*256,256,256,0,0,256,256);
            const p=pixels(cell);if(p.ink<20||p.clear<256*256*.2||p.edge)throw Error(`Opaque, empty or clipped ${id}${suffix}`);pair.push(p);
            const x=biomeIndex*384+(suffix?192:0),y=index*100;c.fillStyle=biome==='desert'?'#d0bc8d':biome==='tundra'?'#b8c9c4':'#b8c4a1';c.fillRect(x,y,192,100);c.drawImage(cell,x+42,y,96,96);c.fillStyle='#26392e';c.font='11px system-ui';c.fillText(`${biome} ${suffix?'sparse ':''}${kind}`,x+5,y+94);
          }
          if(pair[1].ink>=pair[0].ink*.8)throw Error(`Sparse artwork is too dense: ${id}`);
          records.push({biome,kind,denseInk:pair[0].ink,sparseInk:pair[1].ink,ratio:pair[1].ink/pair[0].ink});
          for(const zoom of [.5,1,2]) {
            const get=sprites.createSprites(biome,{pixelScale:zoom*dpr,detailLevel:zoom===.5?'region':zoom===2?'detail':'town'});calls.length=0;
            const image=get('terrain-detail',17,1,sparse),p=pixels(image);
            if(!p.ink||p.edge>=32||calls.length!==1||!calls[0].includes('/sparse/atlas-'))throw Error(`Bad sparse runtime patch ${id}/${zoom}/${dpr}`);
            runtime.push({biome,kind,zoom,dpr,...p});
          }
        }
      }
      return {records,runtime};
    },dpr);
    profiles.push(result);
    await page.locator('canvas').screenshot({path:`${output}/dense-and-sparse-dpr${dpr}.png`});
    await page.close();
  }
} finally {await browser.close();}
assert.deepEqual(errors,[]);
await writeFile(`${output}/results.json`,JSON.stringify(profiles,null,2));
console.log(`PASS 27 distinct sparse patches,54 alpha/density checks,162 runtime profiles; ${output}`);
