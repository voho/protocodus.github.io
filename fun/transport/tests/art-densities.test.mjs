import test from 'node:test';
import assert from 'node:assert/strict';
import { PLOT_BUILDING_ATLASES, CITY_PLOT_ATLASES } from '../plot-building-catalog.js';
// A stand-in Image whose loads finish only when a test says so, sized like the atlas density it asks for.
const requests=[];
globalThis.Image=class{set src(url){this.url=url;const cell=Number(url.match(/-(\d+)\.png$/)?.[1]||256),catalog=PLOT_BUILDING_ATLASES.find(atlas=>url.includes(`/${atlas.id}/`)),columns=catalog?.columns||Number(new URL(url).searchParams.get('c')||3);this.naturalWidth=columns*cell;this.naturalHeight=(catalog?.rows||columns)*cell;requests.push(this);}get src(){return this.url;}decode(){return Promise.resolve();}};
globalThis.document??={};
const tick=()=>new Promise(resolve=>setImmediate(resolve)),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const cellsOf=path=>requests.filter(image=>image.url.includes(path)).map(image=>Number(image.url.match(/-(\d+)\.png$/)?.[1]||256)).sort((a,b)=>a-b);
const finish=async(path,{fail=[]}={})=>{for(const image of requests.filter(image=>image.url.includes(path)&&!image.done)){image.done=true;const cell=Number(image.url.match(/-(\d+)\.png$/)?.[1]||256);if(fail.includes(cell))image.onerror();else image.onload();}for(let n=0;n<4;n++)await tick();};
const context=()=>{const drawn=[],images=[];return{drawn,images,save(){},restore(){},translate(){},scale(){},drawImage(image,sx,sy,sw){drawn.push(sw);images.push(image.src);}};};
const art=await import('../atlas-runtime.js'),houses=await import('../raster-houses.js');
art.registerAtlas({id:'qa-lazy',path:'./qa/lazy/atlas',maxCell:256,entries:['qa-lazy:a']});
art.registerAtlas({id:'qa-batch-1',path:'./qa/batch-1/atlas',maxCell:256,biome:'qa',entries:['qa-batch-1:a']});
art.registerAtlas({id:'qa-batch-2',path:'./qa/batch-2/atlas',maxCell:256,biome:'qa',entries:['qa-batch-2:a']});
art.registerAtlas({id:'qa-failed',path:'./qa/failed/atlas',maxCell:256,biome:'qa-failed',entries:['qa-failed:a']});
art.registerAtlas({id:'qa-quiet',path:'./qa/quiet/atlas',maxCell:256,biome:'qa-quiet',entries:['qa-quiet:a']});
art.registerAtlas({id:'qa-eager',path:'./qa/eager/atlas',biome:'qa-eager',entries:['qa-eager:a']});

test('a view preloads 16–64 cells, or up to 128 on a high-density display; never 256',()=>{
  assert.deepEqual(art.startupArtCells(1),[16,32,64]);
  assert.deepEqual(art.startupArtCells(1.25),[16,32,64]);
  assert.deepEqual(art.startupArtCells(1.5),[16,32,64,128]);
  assert.deepEqual(art.startupArtCells(3),[16,32,64,128]);
});
test('startup loads only the requested densities, and a draw fetches the one it needs while the best loaded one stands in',async()=>{
  const ready=art.preloadWorldArt({biome:'qa-none',cells:art.startupArtCells(1),waitMs:1000});
  assert.deepEqual(cellsOf('/qa/lazy/'),[16,32,64]);
  await finish('/qa/lazy/');assert.equal(await ready,true);
  const c=context();
  assert.equal(art.drawAtlas(c,'qa-lazy:a',0,0,48,48,{pixelScale:4}),true);
  assert.equal(art.drawAtlas(c,'qa-lazy:a',0,0,48,48,{pixelScale:4}),true);
  assert.deepEqual(c.drawn,[64,64],'the best loaded level draws until the ideal one arrives');
  assert.deepEqual(cellsOf('/qa/lazy/'),[16,32,64,256],'one request for the ideal 256 cell, however often it is drawn');
  art.drawAtlas(c,'qa-lazy:a',0,0,24,24);art.drawAtlas(c,'qa-lazy:a',0,0,24,24,{pixelScale:8});
  assert.deepEqual(cellsOf('/qa/lazy/'),[16,32,64,256],'loaded and pending densities are not fetched again');
  await finish('/qa/lazy/');c.drawn.length=0;
  art.drawAtlas(c,'qa-lazy:a',0,0,48,48,{pixelScale:4});art.drawAtlas(c,'qa-lazy:a',0,0,48,48,{pixelScale:2});
  assert.deepEqual(c.drawn,[256,256],'a missing 128 cell is fetched while the next larger level draws');
  assert.deepEqual(cellsOf('/qa/lazy/'),[16,32,64,128,256]);
  await finish('/qa/lazy/');c.drawn.length=0;
  art.drawAtlas(c,'qa-lazy:a',0,0,48,48,{pixelScale:2});art.drawAtlas(c,'qa-lazy:a',0,0,48,48,{pixelScale:9});
  assert.deepEqual(c.drawn,[128,256],'with the ideal level loaded, a draw matches the eager choice');
});
test('late arrivals publish once per batch, and at once when nothing else is loading',async()=>{
  const seen=[],stop=art.onWorldArtChange(()=>seen.push(art.worldArtRevision())),start=art.worldArtRevision();
  void art.preloadWorldArt({biome:'qa',cells:[16,32],waitMs:0});
  assert.deepEqual(requests.filter(image=>image.url.includes('/qa/batch-')).map(image=>image.url.replace(/.*\/qa\//,'')),['batch-1/atlas-16.png','batch-2/atlas-16.png','batch-1/atlas-32.png','batch-2/atlas-32.png'],'every atlas gets usable art before any gets a sharper level');
  const first=requests.filter(image=>image.url.includes('/qa/batch-1/'));
  for(const image of first){image.done=true;image.onload();}
  await tick();await tick();
  assert.equal(art.worldArtRevision(),start,'arrivals wait while other densities are still loading');
  assert.equal(art.atlasAvailable('qa-batch-1:a'),true);
  await wait(200);
  assert.equal(art.worldArtRevision(),start+1,'150 ms without another arrival publishes the batch');
  await finish('/qa/batch-2/');
  assert.equal(art.worldArtRevision(),start+2,'the last arrival publishes immediately');
  await tick();stop();
  assert.deepEqual(seen,[start+1,start+2]);
  assert.equal(art.worldArtStats().loading,0);
});
test('a steady stream of awaited arrivals still publishes within 500 ms of the first',async()=>{
  const start=art.worldArtRevision(),c=context();
  for(const id of ['qa-batch-1:a','qa-batch-2:a'])for(const pixelScale of [2,4,8])art.drawAtlas(c,id,0,0,32,32,{pixelScale});
  assert.deepEqual(c.drawn,[32,32,32,32,32,32],'the best loaded level stands in');
  const queue=requests.filter(image=>/\/qa\/batch-\d\//.test(image.url)&&!image.done);
  assert.equal(queue.length,6);
  for(const image of queue.slice(0,5)){image.done=true;image.onload();await wait(100);}
  await wait(60);
  assert.equal(art.worldArtRevision(),start+1,'one publish inside the 600 ms stream');
  await finish('/qa/batch-');
  assert.equal(art.worldArtRevision(),start+2);
});
test('a failed density is not requested again until a retry, and a failed ideal falls back to a neighbour',async()=>{
  const c=context();
  assert.equal(art.drawAtlas(c,'qa-failed:a',0,0,32,32),false);
  assert.deepEqual(cellsOf('/qa/failed/'),[32],'an atlas without art fetches only the density a draw needs');
  await finish('/qa/failed/',{fail:[32]});
  assert.equal(art.drawAtlas(c,'qa-failed:a',0,0,32,32),false);
  assert.deepEqual(cellsOf('/qa/failed/'),[32,64],'the next larger density replaces a failed ideal');
  await finish('/qa/failed/');
  assert.equal(art.drawAtlas(c,'qa-failed:a',0,0,32,32),true);assert.deepEqual(c.drawn,[64]);
  assert.deepEqual(cellsOf('/qa/failed/'),[32,64],'a failed ideal is not fetched again by drawing');
  assert.match(art.worldArtStats().errors.find(error=>error.id==='qa-failed').error,/^32px/);
  void art.preloadWorldArt({biome:'qa-failed',cells:[16],retry:true,waitMs:0});
  assert.deepEqual(cellsOf('/qa/failed/'),[16,32,32,64],'a retry fetches the requested and failed densities');
  await finish('/qa/failed/');
  assert.equal(art.worldArtStats().errors.some(error=>error.id==='qa-failed'),false);
});
test('a density no draw stood in for joins without a publication; a failed or recovered ideal republishes',async()=>{
  void art.preloadWorldArt({biome:'qa-quiet',cells:[16],waitMs:0});
  await finish('/qa/quiet/');
  const start=art.worldArtRevision(),c=context();
  art.drawAtlas(c,'qa-quiet:a',0,0,32,32);
  void art.preloadWorldArt({biome:'qa-quiet',cells:[64,128],waitMs:0});
  assert.deepEqual(cellsOf('/qa/quiet/'),[16,32,64,128]);
  for(const image of requests.filter(image=>/\/qa\/quiet\/atlas-(64|128)/.test(image.url))){image.done=true;image.onload();}
  await wait(600);
  assert.equal(art.worldArtRevision(),start,'nothing drawn so far would pick the sharper densities');
  await finish('/qa/quiet/',{fail:[32]});
  assert.equal(art.worldArtRevision(),start+1,'the failed ideal republishes, so the draw moves to its neighbour');
  art.drawAtlas(c,'qa-quiet:a',0,0,32,32);
  void art.preloadWorldArt({biome:'qa-quiet',cells:[],retry:true,waitMs:0});
  await finish('/qa/quiet/');
  assert.equal(art.worldArtRevision(),start+2,'the recovered ideal republishes');
  art.drawAtlas(c,'qa-quiet:a',0,0,32,32);
  assert.deepEqual(c.drawn,[16,64,32]);
});
test('without a density list, preloading stays the eager loader that pixel checks compare against',async()=>{
  const ready=art.preloadWorldArt({biome:'qa-eager',waitMs:1000});
  assert.deepEqual(cellsOf('/qa/eager/'),[16,32,64,128],'every density up to the atlas maximum');
  await finish('/qa/eager/');assert.equal(await ready,true);
  assert.equal(art.worldArtStats().ready,art.worldArtStats().atlases);
});


// Each fixture owns fresh decoded state so neutral climate aliases cannot make
// a later failure/fallback scenario accidentally reuse an earlier ready sheet.
async function houseFixture(name) {
  const selected = await import(`../raster-houses.js?${name}`), before = requests.length;
  const images = () => requests.slice(before);
  const cells = (design=0,rotation=0) => images().filter(image=>image.url.includes(`/houses-design-${design}-rotation-${rotation}/`)).map(image=>Number(image.url.match(/-(\d+)\.png$/)[1])).sort((a,b)=>a-b);
  return { selected, images, cells };
}
const houseFolder=(design=0,rotation=0)=>`/houses-design-${design}-rotation-${rotation}/`;

test('neutral houses share climate requests, and load 256px and 512px only for views that need them',async()=>{
  const {selected,images,cells}=await houseFixture('neutral-master'),c=context();
  const ready=selected.preloadHouses({designs:[0],biome:'tundra',cells:[16,32,64],rotations:[0],waitMs:1000});
  assert.deepEqual(cells(),[16,32,64]);await finish(houseFolder());assert.equal(await ready,true);
  const revision=selected.houseAssetsRevision();
  for(const biome of ['tundra','desert'])assert.equal(selected.drawRasterHouse(c,'house-cheap-1',{pixelScale:3,biome}),true);
  assert.deepEqual(c.drawn,[64,64]);assert.deepEqual(cells(),[16,32,64,128]);
  await finish(houseFolder());assert.equal(selected.houseAssetsRevision(),revision+1);
  selected.drawRasterHouse(c,'house-cheap-1',{pixelScale:6,biome:'taiga'});assert.deepEqual(cells(),[16,32,64,128,256]);
  await finish(houseFolder());
  for(const biome of ['taiga','tundra','desert'])selected.drawRasterHouse(c,'house-cheap-1',{pixelScale:12,biome});
  assert.deepEqual(cells(),[16,32,64,128,256,512],'every climate shares the one dense request');
  await finish(houseFolder());selected.drawRasterHouse(c,'house-cheap-1',{pixelScale:12,biome:'desert'});
  assert.equal(c.drawn.at(-1),512,'a dense view draws the authored 512px cell');
  for(const biome of ['taiga','tundra','desert'])assert.equal(await selected.preloadHouses({designs:[0],biome,rotations:[0]}),true);
  assert.equal(images().length,6,'climate aliases never decode additional neutral copies');
  assert.deepEqual(selected.getHouseAssetStats('desert').lodCellSizes,[16,32,64,128,256,512]);
  assert.equal(selected.getHouseAssetStats('desert').activeBiome,'desert');
  assert.equal(selected.getHouseAssetStats().decodedBytes,9*4*[16,32,64,128,256,512].reduce((sum,cell)=>sum+cell*cell,0));
  assert.ok(images().every(image=>image.url.includes('/plot-buildings-v2/')),'current architecture never requests historical sheets');
});

test('a failed neutral house density falls back to its next larger density and retries once across climates',async()=>{
  const {selected,cells}=await houseFixture('neutral-failed-density'),c=context();
  void selected.preloadHouses({designs:[0],biome:'desert',cells:[32],rotations:[0],waitMs:0});
  await finish(houseFolder(),{fail:[32]});
  assert.equal(selected.drawRasterHouse(c,'house-cheap-1',{biome:'taiga'}),false);
  assert.deepEqual(cells(),[32,64]);await finish(houseFolder());
  assert.equal(selected.drawRasterHouse(c,'house-cheap-1',{biome:'tundra'}),true);
  assert.equal(c.drawn.at(-1),64);assert.deepEqual(cells(),[32,64],'drawing another climate does not repeat a failed density');
  const revision=selected.houseAssetsRevision();
  void selected.preloadHouses({designs:[0],biome:'tundra',cells:[],rotations:[0],retry:true,waitMs:0});
  assert.deepEqual(cells(),[32,32,64]);await finish(houseFolder());
  assert.equal(selected.houseAssetsRevision(),revision+1);selected.drawRasterHouse(c,'house-cheap-1',{biome:'desert'});
  assert.equal(c.drawn.at(-1),32);assert.deepEqual(selected.getHouseAssetStats().errors,{});
});

test('both physical house rotations share all climate aliases and keep density requests independent',async()=>{
  const {selected,images,cells}=await houseFixture('neutral-both-rotations');
  const ready=['taiga','tundra','desert'].map(biome=>selected.preloadHouses({designs:[0],biome,cells:[16,32,64],waitMs:1000}));
  assert.equal(images().length,6,'two orientations × three densities, shared by three climates');
  assert.deepEqual(cells(0,0),[16,32,64]);assert.deepEqual(cells(0,1),[16,32,64]);
  await finish('/plot-buildings-v2/');assert.deepEqual(await Promise.all(ready),[true,true,true]);
  const c=context(),stats=selected.getHouseAssetStats('taiga');assert.deepEqual(stats.availableRotations,[0,1]);
  for(const biome of ['taiga','tundra','desert']){
    assert.equal(selected.HOUSE_ATLAS_URLS[biome],selected.HOUSE_ATLAS_URLS.taiga);
    assert.equal(selected.HOUSE_ROTATION_ATLAS_URLS[biome][1],selected.HOUSE_ROTATION_ATLAS_URLS.taiga[1]);
    selected.drawRasterHouse(c,'house-cheap-2',{biome,rotation:1,pixelScale:3});
  }
  assert.ok(c.images.every(url=>url.includes(houseFolder(0,1))));assert.deepEqual(cells(0,1),[16,32,64,128]);
  assert.deepEqual(cells(0,0),[16,32,64],'an alternate draw does not request its unused primary density');
  await finish(houseFolder(0,1));selected.drawRasterHouse(c,'house-cheap-2',{biome:'taiga',rotation:1,pixelScale:3});
  assert.equal(c.drawn.at(-1),128);assert.equal(selected.getHouseAssetStats('taiga').lastRotation,1);
});

test('a pending or failed house rotation keeps its identity and recovers on a shared climate retry',async()=>{
  const {selected,cells}=await houseFixture('neutral-rotation-retry'),c=context();
  void selected.preloadHouses({designs:[0],biome:'taiga',rotations:[0],cells:[32],waitMs:0});await finish(houseFolder());
  const start=selected.houseAssetsRevision();
  for(const biome of ['tundra','desert'])assert.equal(selected.drawRasterHouse(c,'house-normal-3',{biome,rotation:1}),true);
  assert.deepEqual(cells(0,1),[32]);assert.ok(c.images.every(url=>url.includes(houseFolder())),'ready primary art stands in while rotation loads');
  await finish(houseFolder(0,1),{fail:[32]});assert.ok(selected.houseAssetsRevision()>start);
  selected.drawRasterHouse(c,'house-normal-3',{biome:'tundra',rotation:1});assert.deepEqual(cells(0,1),[32,64]);
  await finish(houseFolder(0,1));selected.drawRasterHouse(c,'house-normal-3',{biome:'desert',rotation:1});
  assert.match(c.images.at(-1),/houses-design-0-rotation-1\/atlas-64\.png$/);
  const revision=selected.houseAssetsRevision();
  void selected.preloadHouses({designs:[0],biome:'tundra',cells:[],rotations:[1],retry:true,waitMs:0});
  assert.deepEqual(cells(0,1),[32,32,64]);await finish(houseFolder(0,1));assert.equal(selected.houseAssetsRevision(),revision+1);
  selected.drawRasterHouse(c,'house-normal-3',{biome:'taiga',rotation:1});assert.match(c.images.at(-1),/houses-design-0-rotation-1\/atlas-32\.png$/);
  assert.equal(selected.getHouseAssetStats().errors['houses-design-0-rotation-1/32'],undefined);
});

test('cached house fallback choices switch immediately when a requested orientation decodes',async()=>{
  const {selected,images}=await houseFixture('neutral-selection-cache'),c=context();
  assert.equal(selected.hasRasterHouse('house-cheap-1','desert',1),false);
  void selected.preloadHouses({designs:[0],biome:'taiga',rotations:[0],cells:[32],waitMs:0});await finish(houseFolder());
  assert.equal(selected.hasRasterHouse('house-cheap-1','desert',1),true);assert.equal(selected.getHouseAssetStats('desert',1).activeBiome,'desert');
  void selected.preloadHouses({designs:[0],biome:'desert',rotations:[0,1],cells:[32],waitMs:0});
  const alternate=images().find(image=>!image.done&&image.url.includes(houseFolder(0,1)));assert.ok(alternate);
  selected.drawRasterHouse(c,'house-cheap-1',{biome:'desert',rotation:1});assert.match(c.images.at(-1),/houses-design-0-rotation-0\/atlas-32\.png$/);
  alternate.done=true;alternate.onload();await tick();await tick();
  selected.drawRasterHouse(c,'house-cheap-1',{biome:'desert',rotation:1});assert.match(c.images.at(-1),/houses-design-0-rotation-1\/atlas-32\.png$/);
  assert.equal(selected.getHouseAssetStats('unknown-climate',1).activeBiome,'taiga');
});

test('house startup loads every design and rotation once for all climates and sharpens only the drawn design',async()=>{
  const {selected,images,cells}=await houseFixture('neutral-design-densities');
  void selected.preloadHouses({biome:'desert',cells:[16,32],waitMs:0});
  void selected.preloadHouses({biome:'tundra',cells:[16,32],waitMs:0});
  assert.equal(images().length,12,'three designs × two rotations × two startup densities');
  assert.ok(images().every(image=>/-16\.png$|-32\.png$/.test(image.url)));await finish('/plot-buildings-v2/');
  assert.deepEqual(selected.getHouseAssetStats('desert').availableDesigns,[0,1,2]);
  const c=context();selected.drawRasterHouse(c,'house-cheap-1',{biome:'desert',design:2,rotation:1,pixelScale:3});
  assert.match(c.images.at(-1),/houses-design-2-rotation-1\/atlas-32\.png$/);assert.deepEqual(cells(2,1),[16,32,128]);
  assert.equal(images().filter(image=>image.url.endsWith('-128.png')).length,1);
  await finish(houseFolder(2,1));selected.drawRasterHouse(c,'house-cheap-1',{biome:'desert',design:2,rotation:1,pixelScale:3});
  assert.equal(c.drawn.at(-1),128);assert.equal(selected.getHouseAssetStats('desert',1,2).activeDesign,2);
});

test('one alternate house design is usable across climates without a base-design sheet',async()=>{
  const {selected,images}=await houseFixture('neutral-single-design');
  const ready=selected.preloadHouses({biome:'taiga',designs:[2],rotations:[1],cells:[16],waitMs:1000});await finish(houseFolder(2,1));
  assert.equal(await ready,true);assert.equal(images().length,1);
  for(const biome of ['taiga','tundra','desert']){
    const stats=selected.getHouseAssetStats(biome,1,2);assert.equal(stats.activeDesign,2);assert.equal(stats.activeRotation,1);assert.deepEqual(stats.availableDesigns,[2]);
    assert.equal(selected.hasRasterHouse('house-normal-3',biome,1,2),true);
  }
});

test('world atlas climate aliases share a decoded image, crop and late dense publication',async()=>{
  const before=requests.length,c=context();
  art.registerAtlas({id:'qa-neutral-aliases',path:'./qa/neutral/atlas',entries:[null,['qa-neutral:taiga','qa-neutral:tundra','qa-neutral:desert'],null],maxCell:512});
  for(const biome of ['taiga','tundra','desert'])assert.equal(art.drawAtlas(c,`qa-neutral:${biome}`,0,0,32,32),false);
  assert.equal(requests.length,before+1);await finish('/qa/neutral/');
  const draws=[],crop={save(){},restore(){},drawImage(image,...args){draws.push({image,args});}};
  for(const biome of ['taiga','tundra','desert'])assert.equal(art.drawAtlas(crop,`qa-neutral:${biome}`,0,0,32,32),true);
  assert.equal(draws[0].image,draws[1].image);assert.equal(draws[0].image,draws[2].image);assert.deepEqual(draws[0].args,draws[2].args);assert.equal(draws[0].args[0],32,'all aliases retain the second-cell column');
  const revision=art.worldArtRevision();
  for(const biome of ['taiga','tundra','desert'])art.drawAtlas(c,`qa-neutral:${biome}`,0,0,32,32,{pixelScale:12});
  assert.deepEqual(cellsOf('/qa/neutral/'),[32,512]);await finish('/qa/neutral/');assert.ok(art.worldArtRevision()>revision);
  for(const biome of ['taiga','tundra','desert'])art.drawAtlas(c,`qa-neutral:${biome}`,0,0,32,32,{pixelScale:12});
  assert.deepEqual(c.drawn.slice(-3),[512,512,512]);
});

test('neutral city sheets retain every design and climate alias while sharing dense decoded artwork',async()=>{
  const before=art.worldArtStats(),buildings=await import('../raster-buildings.js'),first=requests.length;
  assert.equal(art.worldArtStats().registered-before.registered,135,'every civic and shop-design climate identity remains registered');
  const ready=art.preloadWorldArt({biome:'taiga',cells:[32],waitMs:1000});
  assert.equal(requests.length-first,5,'one request for each neutral city sheet');await finish('/plot-buildings-v2/');assert.equal(await ready,true);
  const crops=[],c={save(){},restore(){},drawImage(image,...args){crops.push({image,args});}};
  for(const sheet of CITY_PLOT_ATLASES)for(const entry of sheet.entries.filter(Boolean)){
    const views=[];
    for(const biome of entry.eligibleBiomes){
      assert.equal(buildings.hasRasterBuilding(entry.kind,biome,entry.design),true);
      assert.equal(buildings.drawRasterBuilding(c,entry.kind,biome,1,{design:entry.design}),true);
      const draw=crops.at(-1);assert.ok(draw.image.src.includes(`/${sheet.id}/`));views.push(draw);
    }
    assert.equal(views[0].image,views[1].image);assert.equal(views[0].image,views[2].image);
    assert.deepEqual(views[0].args,views[2].args,`${entry.kind} design${entry.design}: all climate identities retain the calibrated cell`);
  }
  assert.equal(requests.length-first,5,'alias draws reuse their loaded 32px density');
  const cells=CITY_PLOT_ATLASES.reduce((sum,atlas)=>sum+atlas.columns*atlas.rows,0);
  assert.equal(art.worldArtStats().decodedBytes-before.decodedBytes,cells*32*32*4);
  const revision=art.worldArtRevision();
  for(const biome of ['taiga','tundra','desert'])for(const sheet of CITY_PLOT_ATLASES)for(const entry of sheet.entries.filter(Boolean))buildings.drawRasterBuilding(c,entry.kind,biome,12,{design:entry.design});
  const dense=requests.slice(first).filter(image=>image.url.endsWith('atlas-512.png'));
  assert.equal(dense.length,5,'large city parcels on Retina displays share one sharp request per sheet');
  await finish('/plot-buildings-v2/');assert.ok(art.worldArtRevision()>revision);
  assert.equal(art.worldArtStats().decodedBytes-before.decodedBytes,cells*(32*32+512*512)*4);
  buildings.drawRasterBuilding(c,'stadium','tundra',12);assert.equal(crops.at(-1).args[2],512);
});

test('runtime plot catalog matches generated slot identities, aliases and footprint calibration',async()=>{
  const {plotBuildingJobs}=await import('../tools/plot-building-jobs.mjs');
  const jobs=await plotBuildingJobs();
  const identity=atlas=>({id:atlas.id,type:atlas.type,columns:atlas.columns,rows:atlas.rows,entries:atlas.entries.map(entry=>entry&&({kind:entry.kind,footprint:entry.footprint,design:entry.design,rotation:entry.rotation,runtimeIds:entry.runtimeIds,eligibleBiomes:entry.eligibleBiomes}))});
  assert.deepEqual(PLOT_BUILDING_ATLASES.map(identity),jobs.map(identity),'art generation and runtime packing use the same registered cell order and scale');
  const aliases=PLOT_BUILDING_ATLASES.flatMap(atlas=>atlas.entries.flatMap(entry=>entry?.runtimeIds||[]));
  assert.equal(aliases.length,354);assert.equal(new Set(aliases).size,aliases.length,'no neutral identity can silently overwrite another atlas slot');
});

test('house raster availability and drawing reject a changed world footprint without fetching irrelevant densities',async()=>{
  const {selected,images}=await houseFixture('neutral-footprint-contract'),c=context();
  const ready=selected.preloadHouses({biome:'taiga',designs:[0],rotations:[0],cells:[32],waitMs:1000});await finish(houseFolder());assert.equal(await ready,true);
  const first=images().length;
  for(const entry of PLOT_BUILDING_ATLASES[0].entries){
    const wrong=entry.footprint===1?2:1,draws=c.drawn.length;
    assert.equal(selected.hasRasterHouse(entry.kind,'desert',0,0,wrong),false);
    assert.equal(selected.drawRasterHouse(c,entry.kind,{biome:'desert',footprint:wrong,pixelScale:16}),false);
    assert.equal(c.drawn.length,draws,`${entry.kind}: mismatched parcel never draws the larger catalog architecture`);
    assert.equal(selected.hasRasterHouse(entry.kind,'desert',0,0,entry.footprint),true);
    assert.equal(selected.drawRasterHouse(c,entry.kind,{biome:'desert',footprint:entry.footprint}),true);
    assert.equal(selected.drawRasterHouse(c,entry.kind,{biome:'desert'}),true,'normalized thumbnails retain their catalog logical footprint');
  }
  assert.equal(images().length,first,'a rejected world footprint does not request denser artwork');
});

test('city raster availability and drawing retain catalog calibration for resized thumbnails but decline compact world parcels',async()=>{
  const buildings=await import('../raster-buildings.js'),c=context(),first=requests.length;
  for(const entry of CITY_PLOT_ATLASES.flatMap(atlas=>atlas.entries.filter(Boolean))){
    const wrong=entry.footprint===1?2:1,draws=c.drawn.length;
    assert.equal(buildings.hasRasterBuilding(entry.kind,'taiga',entry.design,wrong),false);
    assert.equal(buildings.drawRasterBuilding(c,entry.kind,'taiga',16,{design:entry.design,footprint:wrong}),false);
    assert.equal(c.drawn.length,draws,`${entry.kind}: mismatched parcel never draws catalog artwork`);
    assert.equal(buildings.hasRasterBuilding(entry.kind,'taiga',entry.design,entry.footprint),true);
    assert.equal(buildings.drawRasterBuilding(c,entry.kind,'taiga',1,{design:entry.design,footprint:entry.footprint}),true);
    assert.equal(buildings.drawRasterBuilding(c,entry.kind,'taiga',1,{design:entry.design}),true,'a resized portrait still represents the correct logical parcel');
  }
  assert.equal(requests.length,first,'mismatched parcels cannot trigger needless high-density downloads');
});
