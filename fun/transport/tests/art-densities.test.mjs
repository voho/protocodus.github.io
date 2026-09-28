import test from 'node:test';
import assert from 'node:assert/strict';
// A stand-in Image whose loads finish only when a test says so, sized like the atlas density it asks for.
const requests=[];
globalThis.Image=class{set src(url){this.url=url;const cell=Number(url.match(/-(\d+)\.png$/)?.[1]||256),columns=/house-atlas/.test(url)?3:Number(new URL(url).searchParams.get('c')||3);this.naturalWidth=this.naturalHeight=columns*cell;requests.push(this);}get src(){return this.url;}decode(){return Promise.resolve();}};
globalThis.document??={};
const tick=()=>new Promise(resolve=>setImmediate(resolve)),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const cellsOf=path=>requests.filter(image=>image.url.includes(path)).map(image=>Number(image.url.match(/-(\d+)\.png$/)?.[1]||256)).sort((a,b)=>a-b);
const finish=async(path,{fail=[]}={})=>{for(const image of requests.filter(image=>image.url.includes(path)&&!image.done)){image.done=true;const cell=Number(image.url.match(/-(\d+)\.png$/)?.[1]||256);if(fail.includes(cell))image.onerror();else image.onload();}for(let n=0;n<4;n++)await tick();};
const context=()=>{const drawn=[];return{drawn,save(){},restore(){},translate(){},scale(){},drawImage(image,sx,sy,sw){drawn.push(sw);}};};
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
test('houses preload the requested densities and fetch the master only when a draw needs it',async()=>{
  const ready=houses.preloadHouses({biome:'tundra',cells:[16,32,64],waitMs:1000});
  assert.deepEqual(cellsOf('/houses/tundra/'),[16,32,64]);
  await finish('/houses/tundra/');assert.equal(await ready,true);
  const revision=houses.houseAssetsRevision(),c=context();
  assert.equal(houses.drawRasterHouse(c,'house-cheap-1',{pixelScale:3,biome:'tundra'}),true);
  assert.equal(houses.drawRasterHouse(c,'house-cheap-2',{pixelScale:3,biome:'tundra'}),true);
  assert.deepEqual(c.drawn,[64,64]);
  assert.deepEqual(cellsOf('/houses/tundra/'),[16,32,64,128]);
  houses.drawRasterHouse(c,'house-cheap-1',{pixelScale:1.5,biome:'tundra'});
  assert.deepEqual(cellsOf('/houses/tundra/'),[16,32,64,128]);
  await finish('/houses/tundra/');
  assert.equal(houses.houseAssetsRevision(),revision+1);
  houses.drawRasterHouse(c,'house-cheap-1',{pixelScale:6,biome:'tundra'});
  assert.deepEqual(cellsOf('/houses/tundra/'),[16,32,64,128,256]);
  assert.equal(requests.filter(image=>/houses\/tundra\/house-atlas\.png$/.test(image.url)).length,1,'the 256 master loads on demand');
  await finish('/houses/tundra/');
  assert.deepEqual(houses.getHouseAssetStats('tundra').lodCellSizes,[16,32,64,128,256]);
  assert.equal(await houses.preloadHouses({biome:'tundra'}),true);
  assert.equal(requests.filter(image=>image.url.includes('/houses/tundra/')).length,5,'a loaded climate needs no further request');
  assert.deepEqual(cellsOf('/houses/taiga/'),[],'other climates stay unloaded');
});
test('a failed house density gives way to the next larger one, as an eager load would draw',async()=>{
  void houses.preloadHouses({biome:'desert',cells:[32],waitMs:0});
  await finish('/houses/desert/',{fail:[32]});
  const c=context();houses.drawRasterHouse(c,'house-cheap-1',{pixelScale:1,biome:'desert'});
  assert.deepEqual(cellsOf('/houses/desert/'),[32,64]);
  await finish('/houses/desert/');houses.drawRasterHouse(c,'house-cheap-1',{pixelScale:1,biome:'desert'});
  assert.deepEqual(cellsOf('/houses/desert/'),[32,64],'a failed density is not fetched again by drawing');
  assert.equal(houses.getHouseAssetStats('desert').lastCellSize,64);
});
test('without a density list, preloading stays the eager loader that pixel checks compare against',async()=>{
  const ready=art.preloadWorldArt({biome:'qa-eager',waitMs:1000});
  assert.deepEqual(cellsOf('/qa/eager/'),[16,32,64,128],'every density up to the atlas maximum');
  await finish('/qa/eager/');assert.equal(await ready,true);
  assert.equal(art.worldArtStats().ready,art.worldArtStats().atlases);
});
