// Actual decoded art and terrain pixels verify that gardens share world ground,
// while architecture, fences and the physical house rotations remain intact.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.TRANSPORT_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.TRANSPORT_BROWSER||'chrome',headless:true});
const base=process.env.TRANSPORT_URL||'http://127.0.0.1:8765/fun/transport/';
const output=process.env.TRANSPORT_SCREENSHOTS||'/tmp/transport-house-ground-browser';
await mkdir(output,{recursive:true});const results=[],errors=[];
try{
 for(const dpr of[1,2]){
  const context=await browser.newContext({viewport:{width:1000,height:740},deviceScaleFactor:dpr}),page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/house-ground-check',route=>route.fulfill({contentType:'text/html',body:'<style>body{margin:0}canvas{display:block;width:1000px;height:740px}</style><canvas width="1000" height="740"></canvas>'}));
  await page.goto(new URL('house-ground-check',base).href);
  await page.evaluate(async()=>{
   const h=await import('./raster-houses.js'),{houseTerrainCutout,houseGroundStats}=await import('./house-ground.js'),{createRenderer}=await import('./renderer.js'),{createGame}=await import('./model.js'),{preloadWorldArt}=await import('./atlas-runtime.js'),{createSprites}=await import('./sprites.js');
   await h.preloadHouses({cells:[64,128,256],waitMs:20000});await preloadWorldArt({cells:[64,128,256],waitMs:20000});
   const hash=canvas=>{let value=2166136261;for(const byte of canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data)value=Math.imul(value^byte,16777619);return value>>>0;};
   const load=url=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=url;});
   window.gardenQA={h,houseTerrainCutout,houseGroundStats,createRenderer,createGame,createSprites,hash,load};
  });
  const art=await page.evaluate(async()=>{
   const q=gardenQA,rows=[];
   for(const biome of q.h.HOUSE_BIOMES)for(const design of q.h.HOUSE_DESIGNS)for(const rotation of q.h.HOUSE_ROTATIONS){
    const original=await q.load(q.h.HOUSE_DESIGN_ATLAS_URLS[biome][design][rotation]),masked=q.houseTerrainCutout(original,256,biome),source=document.createElement('canvas');source.width=source.height=768;source.getContext('2d').drawImage(original,0,0);
    const a=source.getContext('2d').getImageData(0,0,768,768).data,b=masked.getContext('2d').getImageData(0,0,768,768).data;
    for(let kind=0;kind<9;kind++){
     const ox=kind%3*256,oy=Math.floor(kind/3)*256;let removed=0,changed=0,roofChanges=0,fullyRevealed=0,visible=0;
     for(let y=0;y<256;y++)for(let x=0;x<256;x++){
      const n=((oy+y)*768+ox+x)*4;if(a[n+3]>32)visible++;
      if(a[n+3]!==b[n+3]){changed++;removed+=a[n+3]-b[n+3];if(y<135||Math.abs(x-128)<57&&y<180)roofChanges++;if(a[n+3]>200&&b[n+3]===0)fullyRevealed++;}
     }
     rows.push({biome,design,rotation,kind:q.h.HOUSE_KINDS[kind],changed,removed,roofChanges,fullyRevealed,visible});
    }
    if(q.houseTerrainCutout(original,256,biome)!==masked)throw Error('Prepared garden image was rebuilt on a warm draw');
   }
   return{rows,stats:q.houseGroundStats()};
  });
  for(const row of art.rows){assert.equal(row.roofChanges,0,`${row.biome} ${row.kind} design ${row.design}/${row.rotation} keeps architecture intact`);assert.ok(row.changed>20,`${JSON.stringify(row)} garden substrate can expose terrain`);assert.ok(row.changed<row.visible*.45,'gardens retain their fences, flowerbeds, paths and house silhouette');assert.ok(row.fullyRevealed>5,`${JSON.stringify(row)} includes completely transparent lawn pixels`);}
  assert.ok(art.stats.bytes<=art.stats.limit);results.push({dpr,art});
  for(const biome of['taiga','tundra','desert']){
   await page.evaluate(biome=>{
    const q=gardenQA,base=q.createGame({biome,size:'regional',seed:1847}),g={...base,width:32,height:32,tiles:Array.from({length:32*32},()=>({terrain:'grass',elevation:.35,variant:0})),cities:[],industries:[],stations:[],routes:[],vehicles:[],revision:1};
    for(let design=0;design<3;design++)for(let rotation=0;rotation<2;rotation++){const x=12+design*3,y=12+rotation*3,t=g.tiles[y*32+x];t.building={kind:'house-cheap-1',level:1,footprint:1};t.variant=design*6+rotation;}
    const canvas=document.querySelector('canvas'),renderer=q.createRenderer(canvas,g,{zoom:2,layers:{trees:false,names:false,industryIcons:false,routes:false}});q.world={game:g,canvas,renderer};renderer.focus(15,13.5);
   },biome);
   for(const zoom of[.5,1,2]){
    const row=await page.evaluate(zoom=>{
     const q=gardenQA,w=q.world,r=w.renderer;r.setZoom(zoom);r.render(0);const before=r.getStats(),original=q.hash(w.canvas);r.render(0);const warm=r.getStats(),again=q.hash(w.canvas);
     r.pan(96,-48);r.render(0);r.pan(-96,48);r.render(0);const restored=q.hash(w.canvas);let terrainReveal=null;
     if(zoom===2){
      r.setLayers({buildings:false});r.render(0);const background=w.canvas.getContext('2d').getImageData(0,0,w.canvas.width,w.canvas.height).data;
      r.setLayers({buildings:true});r.render(0);const foreground=w.canvas.getContext('2d').getImageData(0,0,w.canvas.width,w.canvas.height).data;
      const density=zoom*devicePixelRatio*1.5,plain=q.createSprites(w.game.biome,{pixelScale:density}),cut=q.createSprites(w.game.biome,{pixelScale:density,gardenGround:'terrain'}),a=plain('house-cheap-1',0),b=cut('house-cheap-1',0),aa=a.getContext('2d').getImageData(0,0,a.width,a.height).data,bb=b.getContext('2d').getImageData(0,0,b.width,b.height).data,center=r.worldToScreen(12,12),left=Math.round((center.x-24*zoom)*devicePixelRatio),top=Math.round((center.y-48*zoom)*devicePixelRatio);
      let checked=0,matches=0;
      for(let y=Math.floor(b.height*.65);y<b.height;y++)for(let x=0;x<b.width;x++){
       const index=(y*b.width+x)*4;if(aa[index+3]<220||bb[index+3]!==0)continue;
       const target=((top+y)*w.canvas.width+left+x)*4;if(target<0||target+3>=background.length)continue;
       checked++;if([0,1,2,3].every(c=>background[target+c]===foreground[target+c]))matches++;
      }
      terrainReveal={checked,matches};
     }
     // A garden on steep land replays the world ground on its raised top.
     const t=w.game.tiles[12*32+12];t.elevation=.72;w.game.revision++;r.setGame(w.game);r.setZoom(zoom);r.focus(15,13.5);r.render(0);const raised=r.getStats(),raisedHash=q.hash(w.canvas);r.render(0);const warmRaised=r.getStats();
     return{zoom,terrainReveal,original,again,restored,warmChunks:warm.composedChunks-before.composedChunks,warmFoundations:warm.foundationBuilds-before.foundationBuilds,raisedHash,raisedSurfaces:raised.gardenSurfaces,warmRaisedSurfaces:warmRaised.gardenSurfaces,ground:warmRaised.houseArtwork.gardenGround};
    },zoom);
    if(row.terrainReveal){assert.ok(row.terrainReveal.checked>2,`garden has actual displayed terrain pixels: ${JSON.stringify(row.terrainReveal)}`);assert.equal(row.terrainReveal.matches,row.terrainReveal.checked,'revealed garden pixels exactly match the world color and grain underneath');}assert.equal(row.original,row.again,'warm garden pixels are stable');assert.equal(row.original,row.restored,'pan return preserves lawn/stone registration');assert.equal(row.warmChunks,0);assert.equal(row.warmFoundations,0);assert.notEqual(row.raisedHash,row.original,'a sloped garden visibly gains a foundation');assert.ok(row.raisedSurfaces.entries>0,'raised gardens use world terrain surfaces');assert.deepEqual(row.raisedSurfaces,row.warmRaisedSurfaces,'warm foundations do not regenerate terrain');assert.ok(row.ground.bytes<=row.ground.limit);assert.ok(row.raisedSurfaces.bytes<=row.raisedSurfaces.limit);
    results.push({dpr,biome,...row});
    if(zoom===2)await page.locator('canvas').screenshot({path:`${output}/${biome}-slope-dpr${dpr}.png`});
    await page.evaluate(()=>{const w=gardenQA.world;w.game.tiles[12*32+12].elevation=.35;w.game.revision++;w.renderer.setGame(w.game);w.renderer.focus(15,13.5);});
   }
  }
  await context.close();
 }
 assert.deepEqual(errors,[]);await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));
 console.log(`PASS ${results.filter(row=>row.biome).length} terrain/zoom/DPR profiles and ${results.filter(row=>row.art).reduce((n,row)=>n+row.art.rows.length,0)} house garden cutouts.`);
}finally{await browser.close();}
