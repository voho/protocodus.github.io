// Actual decoded art and terrain pixels verify that gardens share world ground,
// while architecture, fences and the physical house rotations remain intact.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
// Measured fence-foot landmarks identify the actual foreground garden, rather
// than assuming its fences, paths and shrubs are all bare lawn. Alpha 0–8 is
// the packer's existing invisible-matte range; report exact zeros separately.
function groundPolygonInside(polygon,x,y,inset=6){
  const cross=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
  const direction=Math.sign(cross(polygon[0],polygon[1],polygon[2]));
  return polygon.every((a,i)=>{const b=polygon[(i+1)%3];return direction*cross(a,b,[x,y])/Math.hypot(b[0]-a[0],b[1]-a[1])>inset;});
}
function measureGroundEvidence(data,width,cell,kind,calibration,spriteScale){
  const vertices=calibration?.sourceGroundVertices,scale=calibration?.uniformScale,offset=calibration?.translationMaster,footprint=calibration?.footprint;
  if(!vertices||!Number.isFinite(scale)||!Array.isArray(offset)||!Number.isInteger(footprint)||footprint<1||!spriteScale)return {landmarks:false,clearPixels:0,exactPixels:0,largestClearPatch:0,polygon:null};
  const polygon=['left','right','front'].map(name=>vertices[name]?.map((value,i)=>value*scale+offset[i]));
  if(polygon.some(point=>!point||point.length!==2||point.some(value=>!Number.isFinite(value))))return {landmarks:false,clearPixels:0,exactPixels:0,largestClearPatch:0,polygon:null};
  const cross=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]),direction=Math.sign(cross(polygon[0],polygon[1],polygon[2]));
  const inside=(x,y)=>polygon.every((a,i)=>{const b=polygon[(i+1)%3];return direction*cross(a,b,[x,y])/Math.hypot(b[0]-a[0],b[1]-a[1])>6;});
  const eligible=new Uint8Array(cell*cell),seen=new Uint8Array(cell*cell),queue=new Int32Array(cell*cell),ox=kind%3*cell,oy=Math.floor(kind/3)*cell;
  let clearPixels=0,exactPixels=0,largestClearPatch=0,interiorPixels=0;
  for(let y=0;y<cell;y++)for(let x=0;x<cell;x++){
    if(!inside((x+.5)*256/cell,(y+.5)*256/cell))continue;
    interiorPixels++;const alpha=data[((oy+y)*width+ox+x)*4+3];
    if(alpha<=8){eligible[y*cell+x]=1;clearPixels++;if(alpha===0)exactPixels++;}
  }
  for(let start=0;start<eligible.length;start++){
    if(!eligible[start]||seen[start])continue;
    let count=0,end=1;queue[0]=start;seen[start]=1;
    while(count<end){
      const n=queue[count++],x=n%cell,y=Math.floor(n/cell);
      for(const next of [x>0?n-1:-1,x+1<cell?n+1:-1,y>0?n-cell:-1,y+1<cell?n+cell:-1])if(next>=0&&eligible[next]&&!seen[next]){seen[next]=1;queue[end++]=next;}
    }
    largestClearPatch=Math.max(largestClearPatch,count);
  }
  // Require the same visible patch area at Town scale for every footprint:
  // 2.25 world-pixel² is 64 master pixels on one tile, 16 on two tiles. Paths
  // can split lawns, so also require substantial total measured clear ground.
  const worldAreaPerPixel=(spriteScale.billboardPixelsPerTile*footprint/cell)**2;
  const minimumConnectedPatch=Math.ceil(2.25/worldAreaPerPixel);
  const minimumClearPixels=Math.max(32,Math.ceil(interiorPixels*.05));
  return {landmarks:true,interiorPixels,clearPixels,exactPixels,largestClearPatch,minimumConnectedPatch,minimumClearPixels,minimumExactPixels:5,largestWorldPatchArea:largestClearPatch*worldAreaPerPixel,polygon};
}
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
  await page.addInitScript({content:`window.measureGroundEvidence=(${measureGroundEvidence.toString()});window.groundPolygonInside=(${groundPolygonInside.toString()});`});
  await page.goto(new URL('house-ground-check',base).href);
  await page.evaluate(async()=>{
   const h=await import('./raster-houses.js'),{houseTerrainCutout,houseGroundStats}=await import('./house-ground.js'),{createRenderer}=await import('./renderer.js'),{createGame}=await import('./model.js'),{preloadWorldArt}=await import('./atlas-runtime.js'),{createSprites}=await import('./sprites.js'),{BUILDING_PALETTES,BUILDING_REGISTRATION,featureMasterPixels,SPRITE_SCALE}=await import('./sprite-art-direction.js');
   await h.preloadHouses({cells:[64,128,256],waitMs:20000});await preloadWorldArt({cells:[64,128,256],waitMs:20000});
   const hash=canvas=>{let value=2166136261;for(const byte of canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data)value=Math.imul(value^byte,16777619);return value>>>0;};
   const load=url=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=url;});
   window.gardenQA={h,houseTerrainCutout,houseGroundStats,createRenderer,createGame,createSprites,hash,load,BUILDING_PALETTES,BUILDING_REGISTRATION,featureMasterPixels,SPRITE_SCALE,measureGroundEvidence,groundPolygonInside,gardenPolygons:new Map()};
  });
  const art=await page.evaluate(async()=>{
   const q=gardenQA,rows=[],diffs=[];
   for(const biome of q.h.HOUSE_BIOMES)for(const design of q.h.HOUSE_DESIGNS)for(const rotation of q.h.HOUSE_ROTATIONS){
    const url=q.h.HOUSE_DESIGN_ATLAS_URLS[biome][design][rotation],metadata=await fetch(new URL('atlas.json',url),{cache:'no-store'}).then(response=>{if(!response.ok)throw Error(`Missing house registration ${url}`);return response.json();}),authoredTransparent=metadata.physicalCalibration?.cells?.length===9&&metadata.physicalCalibration.cells.every(entry=>entry.bareGroundTransparent===true&&entry.gardenGround==='transparent'),original=await q.load(url),masked=q.houseTerrainCutout(original,256,biome,{authoredTransparent}),source=document.createElement('canvas');source.width=source.height=768;source.getContext('2d').drawImage(original,0,0);
    const a=source.getContext('2d').getImageData(0,0,768,768).data,b=masked.getContext('2d').getImageData(0,0,768,768).data,p=q.BUILDING_PALETTES[biome];
    const rgb=color=>[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)),distance=(a,b)=>a.reduce((sum,value,i)=>sum+Math.abs(value-b[i]),0);
    const protectedColors=Object.entries(p).filter(([name])=>name!=='ground'&&name!=='snow').map(([,color])=>rgb(color)),groundColors=[rgb(p.ground),...(p.snow?[rgb(p.snow)]:[])],halfWidth=q.featureMasterPixels(q.BUILDING_REGISTRATION.architecturalEnvelopeMetresPerTile*.96);
    const overlay=source.getContext('2d').getImageData(0,0,768,768);
    for(let kind=0;kind<9;kind++){
     const ox=kind%3*256,oy=Math.floor(kind/3)*256;let removed=0,changed=0,roofChanges=0,materialChanges=0,rgbChanges=0,alphaIncreases=0,fullyRevealed=0,sourceTransparentGround=0,groundCandidates=0,visible=0;
     for(let y=0;y<256;y++)for(let x=0;x<256;x++){
      const n=((oy+y)*768+ox+x)*4;if(a[n+3]>32)visible++;
      const color=[a[n],a[n+1],a[n+2]],dx=Math.abs(x+.5-128),back=192-halfWidth*.5+dx*.5,front=192+halfWidth*.5-dx*.5;
      const outsideGround=dx>=halfWidth-4||y+.5<=back+4||y+.5>=front-4,architectureCore=dx<72&&y+.5<218-dx*.16;
      if(!outsideGround&&!architectureCore){groundCandidates++;if(a[n+3]===0)sourceTransparentGround++;}
      // Canvas premultiplication discards hidden RGB at alpha zero. Surviving
      // authored materials, including antialiased edges, keep their exact RGB.
      if(b[n+3]>0&&[0,1,2].some(channel=>a[n+channel]!==b[n+channel]))rgbChanges++;
      if(b[n+3]>a[n+3])alphaIncreases++;
      if(a[n+3]!==b[n+3]){
       changed++;removed+=a[n+3]-b[n+3];if(outsideGround||architectureCore)roofChanges++;
       if(protectedColors.some(material=>distance(color,material)<=24)&&!groundColors.some(ground=>distance(color,ground)<=12))materialChanges++;
       if(a[n+3]>200&&b[n+3]===0)fullyRevealed++;
       overlay.data.set([207,74,104,255],n);
      }
     }
     const clearGroundEvidence=q.measureGroundEvidence(a,768,256,kind,metadata.physicalCalibration?.cells?.find(entry=>entry.id===q.h.HOUSE_KINDS[kind]),q.SPRITE_SCALE);
     if(kind===0&&design===0&&rotation===0&&clearGroundEvidence.polygon)q.gardenPolygons.set(biome,clearGroundEvidence.polygon);
     rows.push({clearGroundEvidence,authoredTransparent,biome,design,rotation,kind:q.h.HOUSE_KINDS[kind],changed,removed,roofChanges,materialChanges,rgbChanges,alphaIncreases,fullyRevealed,sourceTransparentGround,groundCandidates,visible});
    }
    if(q.houseTerrainCutout(original,256,biome,{authoredTransparent})!==masked)throw Error('Prepared garden image was rebuilt on a warm draw');
    if(devicePixelRatio===1){
     // Original / terrain cutout / magenta alpha changes let reviewers inspect
     // actual side wings, roof colours, foliage and fences across every cell.
     const diff=document.createElement('canvas');diff.width=2304;diff.height=768;const dc=diff.getContext('2d');dc.drawImage(source,0,0);dc.drawImage(masked,768,0);dc.putImageData(overlay,1536,0);
     diffs.push({name:`${biome}-design${design}-rotation${rotation}-alpha-diff.png`,data:diff.toDataURL('image/png').split(',')[1]});
    }
   }
   return{rows,stats:q.houseGroundStats(),diffs};
  });
  for(const row of art.rows){assert.equal(row.materialChanges,0,`${row.biome} ${row.kind} keeps canonical architecture, glass, wood, paths and foliage materials`);assert.equal(row.rgbChanges,0,'garden cutting preserves every original RGB value');assert.equal(row.alphaIncreases,0,'garden cutting never adds opacity');assert.equal(row.roofChanges,0,`${row.biome} ${row.kind} design ${row.design}/${row.rotation} keeps architecture intact`);assert.equal(row.clearGroundEvidence.landmarks,true,`${row.biome}/${row.kind} has measured garden landmarks`);assert.ok(row.clearGroundEvidence.largestClearPatch>=row.clearGroundEvidence.minimumConnectedPatch&&row.clearGroundEvidence.clearPixels>=row.clearGroundEvidence.minimumClearPixels,`${JSON.stringify(row)} has a world-visible clear-ground patch and substantial total measured clear ground`);assert.ok(row.changed<row.visible*.45,'gardens retain their fences, flowerbeds, paths and house silhouette');assert.ok(row.clearGroundEvidence.exactPixels>=row.clearGroundEvidence.minimumExactPixels,`${JSON.stringify(row)} includes actual alpha-zero ground pixels`);}
  for(const diff of art.diffs)await writeFile(`${output}/${diff.name}`,Buffer.from(diff.data,'base64'));
  const diffFiles=art.diffs.map(diff=>diff.name);delete art.diffs;art.diffFiles=diffFiles;
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
      let checked=0,matches=0,authoredTransparent=0,newlyCut=0;
      for(let y=Math.floor(b.height*.65);y<b.height;y++)for(let x=0;x<b.width;x++){
       const index=(y*b.width+x)*4,px=(x+.5)*256/b.width,py=((y+.5)*40/b.height-8)*8,polygon=q.gardenPolygons.get(w.game.biome);
       // Opaque objects are excluded by their alpha. Only actual zero-alpha
       // points within the measured ground polygon enter the world RGBA check.
       if(bb[index+3]!==0||!polygon||!q.groundPolygonInside(polygon,px,py,6))continue;
       if(aa[index+3]===0)authoredTransparent++;else newlyCut++;
       const target=((top+y)*w.canvas.width+left+x)*4;if(target<0||target+3>=background.length)continue;
       checked++;if([0,1,2,3].every(c=>background[target+c]===foreground[target+c]))matches++;
      }
      terrainReveal={checked,matches,authoredTransparent,newlyCut};
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
