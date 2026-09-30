// Verify the two terrain faces, texture registration, shared chunk edges and light.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const {chromium}=await import(process.env.TRANSPORT_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.TRANSPORT_BROWSER||'chrome',headless:true});
const base=process.env.TRANSPORT_URL||'http://127.0.0.1:8765/fun/transport/';
const output=process.env.TRANSPORT_SCREENSHOTS||'/tmp/transport-terrain-mesh';
await mkdir(output,{recursive:true});
const profiles=[],errors=[];
try{
  for(const dpr of [1,2]){
    const page=await browser.newPage({viewport:{width:1200,height:820},deviceScaleFactor:dpr});
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/terrain-mesh-qa',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0;background:#eee8d7}canvas{display:block;width:1200px;height:820px}</style><canvas></canvas>'}));
    await page.goto(new URL('terrain-mesh-qa',base).href);
    const rows=await page.evaluate(async()=>{
      const {drawTerrainMesh,paintTerrainTile,facetLight}=await import('./terrain-mesh.js'),{projectGround,tileSurface,HEIGHT_STEP}=await import('./terrain-geometry.js');
      const canvas=document.querySelector('canvas'),c=canvas.getContext('2d'),dpr=devicePixelRatio;
      canvas.width=1200*dpr;canvas.height=820*dpr;
      const game={width:16,height:16,seed:901,revision:1,biome:'taiga',tiles:Array.from({length:256},(_,i)=>{
        const x=i%16,y=Math.floor(i/16),hill=Math.max(0,1-Math.hypot(x-8,y-8)/5);
        return{terrain:x<3?'water':'grass',elevation:x<3?0:.12+hill*.8,detail:'',variant:0};
      })},bounds={x0:4,y0:4,x1:12,y1:12};
      const original=JSON.stringify(game),rows=[];
      const rgb=(x,y)=>[65+x*8,74+y*8,82];
      function texture(b,scale,uniform=false,illustration=false){
        const image=document.createElement('canvas'),sourceX=b.x0*32-8,sourceY=b.y0*32-8;
        image.width=Math.ceil(((b.x1-b.x0)*32+16)*scale);image.height=Math.ceil(((b.y1-b.y0)*32+16)*scale);
        const t=image.getContext('2d');t.scale(scale,scale);t.translate(-sourceX,-sourceY);
        t.fillStyle=uniform?'#6c8d54':'#819768';t.fillRect(sourceX,sourceY,image.width/scale,image.height/scale);
        if(!uniform)for(let y=b.y0-1;y<=b.y1;y++)for(let x=b.x0-1;x<=b.x1;x++){
          t.fillStyle=illustration?x<3?'#447f93':`rgb(${105+x*2},${137+y},${79+y*2})`:`rgb(${rgb(x,y).join(',')})`;t.fillRect(x*32,y*32,32,32);
        }
        if(illustration){
          t.fillStyle='#6c7167';t.fillRect(3*32,8*32+10,13*32,12);t.fillStyle='#d7cfac';t.fillRect(3*32,8*32+15,13*32,2);
          t.strokeStyle='#e2e8ce45';t.lineWidth=.5;for(let n=0;n<=16;n++){t.beginPath();t.moveTo(n*32,0);t.lineTo(n*32,512);t.moveTo(0,n*32);t.lineTo(512,n*32);t.stroke();}
        }
        return{canvas:image,sourceX,sourceY,sourceScale:scale};
      }
      for(const zoom of [.5,1,2]){
        const density=zoom*dpr,center=projectGround(game,8,8),offset={x:600-center.x*zoom,y:410-center.y*zoom};
        function reset(){c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,canvas.width,canvas.height);c.setTransform(density,0,0,density,offset.x*dpr,offset.y*dpr);c.imageSmoothingEnabled=false;}
        const chunks=[];for(let y=4;y<12;y+=4)for(let x=4;x<12;x+=4)chunks.push({x0:x,y0:y,x1:x+4,y1:y+4});
        reset();let triangles=0;
        for(const b of chunks)triangles+=drawTerrainMesh(c,{game,...texture(b,density),bounds:b,shade:false}).triangles;
        const colorPixels=c.getImageData(0,0,canvas.width,canvas.height).data;
        function sample(p,pixels){const x=Math.floor((p.x*zoom+offset.x)*dpr),y=Math.floor((p.y*zoom+offset.y)*dpr),i=(y*canvas.width+x)*4;return Array.from(pixels.slice(i,i+4));}
        let colorError=0,samples=0;
        for(let y=4;y<12;y++)for(let x=4;x<12;x++)for(const tri of tileSurface(game,x,y).triangles){
          const u=tri.reduce((n,p)=>n+p.u,0)/3,v=tri.reduce((n,p)=>n+p.v,0)/3,p=projectGround(game,u,v),pixel=sample(p,colorPixels),expected=rgb(x,y);
          colorError=Math.max(colorError,...expected.map((value,n)=>Math.abs(pixel[n]-value)));samples++;
        }
        reset();for(const b of chunks)drawTerrainMesh(c,{game,...texture(b,density,true),bounds:b,shade:false});
        const uniform=c.getImageData(0,0,canvas.width,canvas.height).data;let minimumAlpha=255,edgeColorError=0,seamSamples=0;
        for(let v=5;v<=11;v+=.25)for(let u=5;u<=11;u+=.25){
          const pixel=sample(projectGround(game,u,v),uniform);minimumAlpha=Math.min(minimumAlpha,pixel[3]);edgeColorError=Math.max(edgeColorError,...[108,141,84].map((value,n)=>Math.abs(pixel[n]-value)));seamSamples++;
        }
        // A uniform inclined plane has one light value. Internal triangle edges
        // must match face interiors, rather than showing an unshaded wireframe.
        const plane={...game,revision:2,tiles:game.tiles.map((t,i)=>({...t,terrain:'grass',elevation:Math.max(0,Math.min(7,11-i%16))/7}))},patch={x0:6,y0:6,x1:10,y1:10};
        reset();for(let py=6;py<10;py+=2)for(let px=6;px<10;px+=2){const b={x0:px,y0:py,x1:px+2,y1:py+2};drawTerrainMesh(c,{game:plane,...texture(b,density,true),bounds:b});}
        const shaded=c.getImageData(0,0,canvas.width,canvas.height).data,reference=sample(projectGround(plane,7.5,7.5),shaded);let shadedEdgeError=0,shadedAlpha=255;
        for(let v=6.25;v<=9.75;v+=.125)for(let u=6.25;u<=9.75;u+=.125){const pixel=sample(projectGround(plane,u,v),shaded);shadedAlpha=Math.min(shadedAlpha,pixel[3]);shadedEdgeError=Math.max(shadedEdgeError,...reference.slice(0,3).map((value,n)=>Math.abs(pixel[n]-value)));}
        // A bridge bank can provide raised east corners while keeping the
        // NW-SE diagonal continuous. Transparent network art must stay transparent.
        const bank=tileSurface(plane,8,8);delete bank.triangles;for(const name of ['ne','se'])bank[name]={...bank[name],y:bank[name].y-6,height:bank[name].height+6/HEIGHT_STEP};
        const road=document.createElement('canvas');road.width=road.height=32*density;const rc=road.getContext('2d');rc.scale(density,density);rc.fillStyle='#ce785b';rc.fillRect(0,12,32,8);
        reset();const bankTriangles=paintTerrainTile(c,road,{game:plane,x:8,y:8,sourceX:8*32,sourceY:8*32,sourceScale:density,shade:false,surface:bank});
        const bankPixels=c.getImageData(0,0,canvas.width,canvas.height).data;
        const bankRoad=sample({x:(bank.nw.x+bank.se.x)/2,y:(bank.nw.y+bank.se.y)/2},bankPixels),bankAir=sample({x:bank.nw.x*.5+bank.ne.x*.4+bank.se.x*.1,y:bank.nw.y*.5+bank.ne.y*.4+bank.se.y*.1},bankPixels);
        rows.push({dpr,zoom,triangles,colorError,samples,minimumAlpha,edgeColorError,seamSamples,shadedEdgeError,shadedAlpha,bankTriangles,bankRoad,bankAir,unchanged:JSON.stringify(game)===original});
      }
      const center={u:.5,v:.5,height:1},corners=[{u:0,v:0,height:0},{u:1,v:0,height:0},{u:1,v:1,height:0},{u:0,v:1,height:0}];
      const north=facetLight([center,corners[0],corners[1]]),south=facetLight([center,corners[2],corners[3]]),flat=facetLight(corners.slice(0,3));
      const full={x0:0,y0:0,x1:16,y1:16},mid=projectGround(game,8,8);
      c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,canvas.width,canvas.height);c.setTransform(dpr,0,0,dpr,600-mid.x,360-mid.y);c.imageSmoothingEnabled=true;
      drawTerrainMesh(c,{game,...texture(full,dpr,false,true),bounds:full});
      return{rows,north,south,flat};
    });
    for(const row of rows.rows){assert.equal(row.triangles,128);assert.ok(row.colorError<=3,JSON.stringify(row));assert.equal(row.minimumAlpha,255,JSON.stringify(row));assert.ok(row.edgeColorError<=2,JSON.stringify(row));assert.ok(row.shadedEdgeError<=1,JSON.stringify(row));assert.equal(row.shadedAlpha,255);assert.equal(row.bankTriangles,2);assert.deepEqual(row.bankRoad,[206,120,91,255]);assert.equal(row.bankAir[3],0);assert.ok(row.unchanged);}
    assert.equal(rows.flat,1);assert.ok(rows.north>1&&rows.north>rows.south&&rows.south<1,'northwest slopes receive the key light');
    profiles.push(...rows.rows);await page.locator('canvas').screenshot({path:`${output}/raised-terrain-dpr${dpr}.png`});await page.close();
  }
  // Detail at Retina density must retain the whole visible mesh set. Keeping
  // both source textures and projected meshes previously exhausted the LRU
  // here, forcing every unchanged chunk to be rebuilt on every frame.
  const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:2});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/terrain-cache-qa',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0}canvas{display:block;width:1280px;height:900px}</style><canvas></canvas>'}));
  await page.goto(new URL('terrain-cache-qa',base).href);
  const cache=await page.evaluate(async()=>{
    const {createGame}=await import('./model.js'),{createRenderer}=await import('./renderer.js'),{preloadWorldArt}=await import('./atlas-runtime.js');
    await preloadWorldArt({waitMs:15000});
    const game=createGame({biome:'taiga',size:'compact',seed:418});
    for(const tile of game.tiles){Object.assign(tile,{terrain:'grass',elevation:4/7,detail:'',road:false,rail:false,bridge:false,tunnel:false,building:null,zone:null});delete tile.terrainObject;delete tile.structureAxis;delete tile.structureLevel;}
    game.cities=[];game.industries=[];game.stations=[];game.routes=[];game.vehicles=[];game.zones=[];game.revision++;
    const canvas=document.querySelector('canvas'),renderer=createRenderer(canvas,game,{layers:{names:false,industryIcons:false,routes:false,grid:false,trees:false}});
    renderer.resize();renderer.setZoom(2);renderer.focus(24,22);
    function frame(){
      const before=renderer.getStats().composedChunks;renderer.render(0);const stats=renderer.getStats();
      return{composed:stats.composedChunks-before,count:stats.chunkCount,bytes:stats.cacheBytes,limit:stats.cacheLimit,max:stats.cacheMax,rasterScale:stats.rasterScale};
    }
    function pixels(){return canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;}
    const cold=frame(),initial=pixels(),warm=[frame(),frame()];
    const tile=game.tiles[22*game.width+24];tile.elevation=5/7;game.revision++;
    const changed=frame(),raised=pixels(),changedWarm=frame();
    tile.elevation=4/7;game.revision++;
    const restored=frame(),final=pixels(),restoredWarm=frame();
    let changedPixels=0,restoredDifferences=0,baselineHash=0;
    for(let i=0;i<initial.length;i++){if(initial[i]!==raised[i])changedPixels++;if(initial[i]!==final[i])restoredDifferences++;baselineHash=Math.imul(baselineHash^initial[i],16777619);}
    return{cold,warm,changed,changedWarm,restored,restoredWarm,changedPixels,restoredDifferences,baselineHash};
  });
  assert.equal(cache.cold.rasterScale,4);assert.ok(cache.cold.composed>0);
  for(const frame of [cache.cold,...cache.warm,cache.changed,cache.changedWarm,cache.restored,cache.restoredWarm]){assert.ok(frame.bytes<=frame.limit);assert.ok(frame.limit<=frame.max);}
  for(const frame of [...cache.warm,cache.changedWarm,cache.restoredWarm])assert.equal(frame.composed,0,'unchanged Retina Detail frames reuse their terrain meshes');
  assert.ok(cache.changed.composed>0&&cache.changed.composed<cache.cold.composed,'a local height edit only rebuilds affected chunks');
  assert.ok(cache.restored.composed>0);assert.ok(cache.changedPixels>0);assert.equal(cache.restoredDifferences,0,'restoring height restores every terrain pixel');
  await page.close();
  assert.deepEqual(errors,[]);console.log(JSON.stringify({profiles,cache,output},null,2));
}finally{await browser.close();}
