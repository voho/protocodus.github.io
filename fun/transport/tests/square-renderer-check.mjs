// A continent must retain one-tile connections without rescanning four million
// tiles every time ecology changes. Browser storage stays isolated from play.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.TRANSPORT_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.TRANSPORT_BROWSER||'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:980}});
  await page.goto(process.env.TRANSPORT_URL||'http://127.0.0.1:8765/fun/transport/');
  await page.waitForFunction(()=>window.transport?.renderer);
  const result=await page.evaluate(async()=>{
    transport.setSpeed(0);
    const {createGame}=await import('./model.js'),{createRenderer}=await import('./renderer.js');
    const g=createGame({size:'regional',seed:81}),blank={...g.tiles[0],terrain:'grass',detail:'',road:false,rail:false,bridge:false,tunnel:false,building:null,zone:null};
    g.width=2048;g.height=2048;g.tiles=Array(g.width*g.height).fill(blank);
    g.tiles[900*g.width+100]={...blank,road:true};
    g.industries=[];g.cities=[];g.stations=[];g.routes=[];g.vehicles=[];
    const canvas=document.createElement('canvas'),mini=document.createElement('canvas');
    canvas.style='width:1200px;height:800px';mini.style='width:512px;height:512px';document.body.append(canvas,mini);
    const r=createRenderer(canvas,g,{layers:{names:false,industryIcons:false,routes:false,lighting:false}});
    const color=(x,y)=>Array.from(mini.getContext('2d').getImageData(x,y,1,1).data).slice(0,3);
    r.drawMinimap(mini);const initial=r.getStats(),thinRoad=color(25,225);
    r.setLayers({roads:false});r.drawMinimap(mini);const hiddenRoad=color(25,225);
    r.setLayers({roads:true});r.drawMinimap(mini);
    const original=g.tiles;let tileReads=0;
    g.tiles=new Proxy(original,{get(target,key){if(typeof key==='string'&&/^\d+$/.test(key))tileReads++;return Reflect.get(target,key);}});
    original[902*g.width+102]={...blank,terrain:'forest'};g.revision++;
    const start=performance.now();r.drawMinimap(mini);const ecologyMs=performance.now()-start,afterEcology=r.getStats();
    g.tiles=original;
    g.tiles[900*g.width+1500]={...blank,rail:true};g.networkRevision++;g.revision++;r.drawMinimap(mini);
    const afterNetwork=r.getStats(),thinRail=color(375,225),views=[];
    for(const zoom of[.5,1,2]){r.setZoom(zoom);r.render(0);const first=r.getStats();r.render(1000);const second=r.getStats();views.push({zoom,cache:second.cacheBytes,limit:second.cacheLimit,newChunks:second.composedChunks-first.composedChunks});}
    return{initial,thinRoad,hiddenRoad,thinRail,tileReads,ecologyMs,afterEcology,afterNetwork,views};
  });
  assert.equal(result.initial.minimapWidth,512);assert.equal(result.initial.minimapHeight,512);
  assert.equal(result.initial.minimapWorldWidth,2048);assert.equal(result.initial.minimapWorldHeight,2048);
  assert.deepEqual(result.thinRoad,[215,203,176],'a road missed by terrain sampling remains visible');
  assert.notDeepEqual(result.hiddenRoad,result.thinRoad,'roads obey their visibility switch');
  assert.deepEqual(result.thinRail,[101,95,82],'a new one-tile rail appears after a network revision');
  assert.ok(result.tileReads<=512*512+10,`ecology read ${result.tileReads} tiles instead of a bounded sample`);
  assert.equal(result.afterEcology.minimapNetworkScans,result.initial.minimapNetworkScans,'ecology reuses the sparse network index');
  assert.equal(result.afterNetwork.minimapNetworkScans,result.initial.minimapNetworkScans+1);
  for(const view of result.views){assert.ok(view.cache<=view.limit);assert.equal(view.newChunks,0,'a stationary view reuses its terrain chunks');}
  console.log(`2048² minimap: ${result.tileReads} ecology tile reads, ${result.ecologyMs.toFixed(1)}ms; thin networks and three zooms passed.`);
}finally{await browser.close();}
