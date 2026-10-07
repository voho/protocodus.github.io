// Density selection uses the shipped PNG dimensions, rather than invented
// Image sizes. Pixel quality and original-source limits belong to the packing
// checks: a larger selected canvas alone does not prove additional detail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openSync, readSync, closeSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function pngDimensions(url) {
  const bytes = Buffer.alloc(24), file = openSync(fileURLToPath(url), 'r');
  try { assert.equal(readSync(file, bytes, 0, bytes.length, 0), bytes.length); }
  finally { closeSync(file); }
  assert.deepEqual([...bytes.subarray(0, 8)], [137,80,78,71,13,10,26,10], `${url} is a PNG`);
  assert.equal(bytes.toString('ascii', 12, 16), 'IHDR');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

const requests = [], originalImage = globalThis.Image;
globalThis.Image = class {
  set src(url) {
    this.url = url;
    const request = { image:this, url, cell:Number(url.match(/-(\d+)\.png$/)?.[1]), done:false };
    try { [this.naturalWidth, this.naturalHeight] = pngDimensions(new URL(url)); }
    catch (error) { request.error = error; }
    requests.push(request);
  }
  get src() { return this.url; }
  decode() { return Promise.resolve(); }
};
test.after(() => { if (originalImage === undefined) delete globalThis.Image; else globalThis.Image = originalImage; });

const art = await import('../atlas-runtime.js');
const [nature, infrastructure, directions] = await Promise.all([
  import('../raster-nature.js'), import('../isometric-infrastructure.js'), import('../vehicle-directions.js'),
]);
// Import the actual fallback registration too; do not manufacture a test atlas
// with a higher ceiling than the game uses.
const transport = await import('../raster-transport.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function finishRequests() {
  for (const request of requests.filter(request => !request.done)) {
    request.done = true;
    assert.ifError(request.error);
    request.image.onload();
  }
  for (let n=0; n<4; n++) await tick();
}

const families = [
  ['nature-mountains', 3, 3, 1024], ['nature-rocks', 3, 3, 1024],
  ['isometric-infrastructure-v2', 3, 2, 512],
  ...directions.VEHICLE_KINDS.map(kind => [`vehicle-${kind}-dimetric-v2`,3,3,256]),
  ['vehicles-dimetric-v2', 3, 3, 256],
  ['city-ground-v3', 3, 3, 512],
];
const metadata = new Map(families.map(([id]) => [id, JSON.parse(readFileSync(new URL(`../assets/world/${id}/atlas.json`, import.meta.url),'utf8'))]));

// Record atlas-to-prepared sampling. Checking a later prepared-canvas copy
// would miss a source that had already been enlarged during preparation.
function context() {
  const draws=[], stack=[];
  let matrix={a:1,b:0,c:0,d:1,e:0,f:0};
  return {
    draws,
    beginPath() {}, rect() {}, clip() {}, moveTo() {}, lineTo() {}, closePath() {}, arc() {},
    save() { stack.push({...matrix}); },
    restore() { matrix=stack.pop(); },
    translate(x,y) { matrix.e+=matrix.a*x+matrix.c*y; matrix.f+=matrix.b*x+matrix.d*y; },
    scale(x,y) { matrix.a*=x;matrix.b*=x;matrix.c*=y;matrix.d*=y; },
    rotate(angle) {
      const cosine=Math.cos(angle),sine=Math.sin(angle),previous={...matrix};
      matrix.a=previous.a*cosine+previous.c*sine;matrix.b=previous.b*cosine+previous.d*sine;
      matrix.c=previous.c*cosine-previous.a*sine;matrix.d=previous.d*cosine-previous.b*sine;
    },
    drawImage(image,...args) { draws.push({image,args,matrix:{...matrix}}); },
  };
}
const cellsFor = family => requests.filter(request => request.url.includes(`/${family}/`)).map(request => request.cell);
const profiles = [.5,1,2].flatMap(zoom => [1,2].map(dpr => ({zoom,dpr,scale:zoom*dpr})));

async function checkDraw({family,id,slotId=id,size,bounds,draw,flipX=false,label}) {
  const sheet=metadata.get(family), expected=sheet.cellSizes.find(cell => cell>=size)||sheet.cellSizes.at(-1);
  assert.ok(expected>=size, `${label}: registered densities cover the physical draw size`);
  const first=context(); assert.equal(draw(first),true,`${label}: startup art is usable`);
  assert.ok(cellsFor(family).includes(expected),`${label}: the draw requests ${expected}px without an eager high-density preload`);
  await finishRequests();
  const c=context(); assert.equal(draw(c),true,label); assert.equal(c.draws.length,1,label);
  const {image,args,matrix}=c.draws[0], cell=args[2], index=sheet.order.indexOf(slotId);
  assert.notEqual(index,-1,`${label}: original slot identity exists`);
  assert.equal(cell,expected,`${label}: atlas sampling chooses the smallest loaded sufficient source`);
  assert.ok(cell>=size,`${label}: atlas-to-prepared sampling does not enlarge a capped source`);
  assert.deepEqual(args.slice(0,4),[index%sheet.columns*cell,Math.floor(index/sheet.columns)*cell,cell,cell],`${label}: whole original cell and orientation`);
  assert.equal(image.naturalWidth,sheet.columns*cell); assert.equal(image.naturalHeight,sheet.rows*cell);
  assert.ok(image.src.endsWith(`/${family}/atlas-${cell}.png`),label);
  const [x,y,w,h]=args.slice(4), left=matrix.a*x+matrix.e, right=matrix.a*(x+w)+matrix.e;
  assert.deepEqual([Math.min(left,right),matrix.d*y+matrix.f,w,h],bounds,`${label}: source density preserves world footprint and anchor`);
  assert.deepEqual([matrix.a,matrix.b,matrix.c,matrix.d].map(value=>value||0),[flipX?-1:1,0,0,1],`${label}: density preserves the authored camera and explicit reflection`);
}

test('higher object densities retain their real PNG grid and metadata slot order',() => {
  const levels=[16,32,64,128,256,512,1024];
  for (const [family,columns,rows,maxCell] of families) {
    const sheet=metadata.get(family);
    assert.equal(sheet.columns,columns,family); assert.equal(sheet.rows,rows,family);
    assert.deepEqual(sheet.cellSizes,levels.filter(cell=>cell<=maxCell),family);
    assert.equal(sheet.order.length,columns*rows,family);
    for (const cell of sheet.cellSizes) assert.deepEqual(pngDimensions(new URL(`../assets/world/${family}/atlas-${cell}.png`,import.meta.url)),[columns*cell,rows*cell],`${family} ${cell}px`);
  }
  for (const kind of ['ferry','cargo-ship','tanker']) assert.deepEqual(metadata.get(`vehicle-${kind}-dimetric-v2`).order,['NW','N','NE','W',null,'E','SW','S','SE'].map(heading=>heading&&`vehicle:${kind}:${heading}`));
  assert.deepEqual(metadata.get('isometric-infrastructure-v2').order,['bus-stop','train-stop','port-w','port-e','port-n','port-s']);
});

test('startup remains bounded at 128px even though large objects have higher ceilings',async() => {
  assert.deepEqual(art.startupArtCells(1),[16,32,64]);
  assert.deepEqual(art.startupArtCells(2),[16,32,64,128]);
  assert.deepEqual(art.startupArtCells(4),[16,32,64,128]);
  const ready=art.preloadWorldArt({cells:art.startupArtCells(2),waitMs:1000});
  assert.ok(requests.length>0);
  assert.ok(requests.every(request=>request.cell<=128),'startup never decodes the new large sheets');
  await finishRequests(); assert.equal(await ready,true);
  for (const [family] of families) assert.deepEqual(cellsFor(family),[16,32,64,128],family);
  assert.deepEqual(art.worldArtStats().errors,[]);
});

test('terrain masses lazily select 512/1024 without changing two- or three-tile geometry',async() => {
  const rocks=[
    ['taiga','rock',1,'taiga-boulder'],['taiga','rock',0,'taiga-scree'],
    ['tundra','glacial',0,'tundra-glacial'],['tundra','snow',0,'tundra-snow'],['tundra','ice',0,'tundra-ice'],
    ['desert','rock',1,'desert-boulder'],['desert','dunes',0,'desert-dunes'],['desert','saltflat',0,'desert-salt'],['desert','rock',0,'desert-strata'],
  ];
  const cases=[
    ...nature.NATURE_ART_CATALOG.mountains.flatMap(detail=>[0,1].map(variant=>({kind:'mountain',family:'nature-mountains',biome:'taiga',detail,variant,id:`nature-mountains:${detail}`}))),
    ...rocks.map(([biome,detail,variant,id])=>({kind:'rock',family:'nature-rocks',biome,detail,variant,id:`nature-rocks:${id}`})),
  ];
  for (const entry of cases) for (const span of [2,3]) for (const {zoom,dpr,scale} of profiles) {
    const size=(entry.kind==='mountain'?60:56)*span, layout=nature.natureObjectLayout(span);
    await checkDraw({family:entry.family,id:entry.id,size:size*scale,bounds:[layout.anchorX-size/2,layout.anchorY+14*span-size,size,size],flipX:entry.variant%2===1,
      draw:c=>nature.drawRasterNatureObject(c,entry.kind,entry.biome,entry.detail,entry.variant,span,scale),label:`${entry.id} variant${entry.variant} span${span} zoom${zoom} DPR${dpr}`});
  }
  for (const family of ['nature-mountains','nature-rocks']) {
    assert.ok(cellsFor(family).includes(512),`${family}: intermediate view requested 512px`);
    assert.ok(cellsFor(family).includes(1024),`${family}: Detail on DPR2 requested 1024px`);
  }
});

test('all port orientations use 512px in Detail on DPR2 with the original 70px frame',async() => {
  for (const [dx,dy,heading] of [[-1,0,'w'],[1,0,'e'],[0,-1,'n'],[0,1,'s']]) for (const {zoom,dpr,scale} of profiles) {
    await checkDraw({family:'isometric-infrastructure-v2',id:`isometric:port-${heading}`,slotId:`port-${heading}`,size:70*scale,bounds:[7-35,11-54,70,70],
      draw:c=>infrastructure.drawIsometricPort(c,dx,dy,7,11,scale),label:`port-${heading} zoom${zoom} DPR${dpr}`});
  }
  assert.ok(cellsFor('isometric-infrastructure-v2').includes(512));
});

test('roads retain their connected terrain-plane geometry and have sufficient Detail sources',async() => {
  const directions=[[0,-1],[1,0],[0,1],[-1,0]], sheet=metadata.get('city-ground-v3');
  for (const kind of ['road','road-bridge']) for (let mask=1;mask<16;mask++) for (const {zoom,dpr,scale} of profiles) {
    const arms=directions.filter((_,index)=>mask&(1<<index)),label=`${kind} connections${mask} zoom${zoom} DPR${dpr}`;
    const first=context();assert.equal(transport.drawRasterNetwork(first,kind,7,11,arms,scale),true,label);
    await finishRequests();
    const c=context();assert.equal(transport.drawRasterNetwork(c,kind,7,11,arms,scale),true,label);
    const straight=arms.length<=2&&arms.every(([dx,dy])=>arms[0][0]===0?dx===0:dy===0);
    const strips=c.draws.filter(draw=>draw.args[6]!==32),junctions=c.draws.filter(draw=>draw.args[6]===32),width=kind==='road'?44:40;
    assert.equal(strips.length,straight?1:arms.length,`${label}: each connected arm retains its original strip`);
    assert.equal(junctions.length,kind==='road'&&!straight?1:0,`${label}: the original unmarked road junction is retained`);
    for (const draw of c.draws) {
      const [sx,sy,cell,cellHeight,x,y,w,h]=draw.args,index=sy/cell*3+sx/cell,required=Math.max(w,h)*scale;
      assert.equal(cellHeight,cell,`${label}: samples an isolated square cell`);
      assert.ok(cell>=required,`${label}: source ${cell}px covers ${required}px at atlas-to-prepared sampling`);
      assert.equal(cell,sheet.cellSizes.find(value=>value>=required),`${label}: uses the smallest sufficient density`);
      if(w===32) {assert.equal(sheet.order[index],'ground:road-junction',label);assert.deepEqual([x,y,w,h],[-16,-16,32,32],label);}
      else {assert.equal(sheet.order[index],`ground:${kind}`,label);assert.deepEqual([x,y,w,h],[-width/2,-18,width,36],`${label}: network strip scale and placement are unchanged`);}
      const determinant=draw.matrix.a*draw.matrix.d-draw.matrix.b*draw.matrix.c;
      assert.ok(Math.abs(determinant-1)<1e-9,`${label}: arm rotation does not stretch the texture`);
    }
  }
  assert.ok(cellsFor('city-ground-v3').includes(256),'Detail/DPR2 requests the retained 256px road master');
  for (const zone of ['residential','commercial','industrial']) for (const {zoom,dpr,scale} of profiles) {
    await checkDraw({family:'city-ground-v3',id:`zone:${zone}`,size:44*scale,bounds:[0,0,44,44],
      draw:c=>transport.drawRasterZone(c,zone,0,0,44,scale),label:`${zone} zone zoom${zoom} DPR${dpr}`});
  }
});

test('ships and their recovery sheet use 256px without growing the vehicle or rotating its camera',async() => {
  for (const kind of directions.VEHICLE_KINDS) for (let i=0;i<8;i++) for (const {zoom,dpr,scale} of profiles) {
    const ship=['ferry','cargo-ship','tanker'].includes(kind), size=ship?43:20, family=`vehicle-${kind}-dimetric-v2`;
    if (!metadata.has(family)) metadata.set(family,JSON.parse(readFileSync(new URL(`../assets/world/${family}/atlas.json`,import.meta.url),'utf8')));
    await checkDraw({family,id:`vehicle:${kind}:${directions.VEHICLE_HEADINGS[i]}`,size:size*scale,bounds:[-size/2,-size/2,size,size],
      draw:c=>directions.drawDirectionalVehicle(c,kind,i*Math.PI/4,size,scale),label:`${kind} ${directions.VEHICLE_HEADINGS[i]} zoom${zoom} DPR${dpr}`});
  }
  for (const kind of ['ferry','cargo-ship','tanker']) for (const {zoom,dpr,scale} of profiles) {
    await checkDraw({family:'vehicles-dimetric-v2',id:`vehicle:${kind}`,size:43*scale,bounds:[-21.5,-21.5,43,43],
      draw:c=>art.drawAtlas(c,`vehicle:${kind}`,-21.5,-21.5,43,43,{pixelScale:scale}),label:`recovery ${kind} zoom${zoom} DPR${dpr}`});
  }
  for (const family of ['vehicle-ferry-dimetric-v2','vehicle-cargo-ship-dimetric-v2','vehicle-tanker-dimetric-v2','vehicles-dimetric-v2']) assert.ok(cellsFor(family).includes(256),`${family}: Detail on DPR2 requests 256px`);
  for (const kind of directions.VEHICLE_KINDS.filter(kind=>!['ferry','cargo-ship','tanker'].includes(kind))) assert.ok(cellsFor(`vehicle-${kind}-dimetric-v2`).every(cell=>cell<=128),`${kind}: ordinary map views leave the sharper portrait density unrequested`);
  const urls=requests.map(request=>request.url); assert.equal(new Set(urls).size,urls.length,'each family and density decodes once across views and orientations');
  assert.deepEqual(art.worldArtStats().errors,[]);
});

test('Gallery terrestrial vehicle portraits lazily request 256px while retaining every authored heading',async() => {
  for (const kind of ['bus','express-bus','truck','locomotive','coach','wagon']) {
    const family=`vehicle-${kind}-dimetric-v2`;
    assert.ok(!cellsFor(family).includes(256),`${kind}: map views did not request portrait-only resolution`);
    for (const scale of [6,7.8,12]) for (let index=0;index<8;index++) {
      await checkDraw({family,id:`vehicle:${kind}:${directions.VEHICLE_HEADINGS[index]}`,size:20*scale,bounds:[-10,-10,20,20],
        draw:c=>directions.drawDirectionalVehicle(c,kind,index*Math.PI/4,20,scale),label:`Gallery ${kind} ${directions.VEHICLE_HEADINGS[index]} scale${scale}`});
    }
    assert.ok(cellsFor(family).includes(256),`${kind}: 240px Gallery sampling uses the retained 256px master`);
  }
  const urls=requests.map(request=>request.url);assert.equal(new Set(urls).size,urls.length,'portrait requests reuse decoded frames across every heading and density');
  assert.deepEqual(art.worldArtStats().errors,[]);
});
