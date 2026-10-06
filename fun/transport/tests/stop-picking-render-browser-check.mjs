import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-stop-picking';
await mkdir(output, { recursive:true });
const browser = await chromium.launch({ channel:process.env.TRANSPORT_BROWSER || 'chrome', headless:true });
const results=[],errors=[];
try {
  for (const dpr of [1,2]) {
    const page=await browser.newPage({ viewport:{width:1100,height:800},deviceScaleFactor:dpr });
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/stop-picking-qa',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0}canvas{width:1100px;height:800px}</style><canvas></canvas>'}));
    await page.goto(new URL('stop-picking-qa',base).href);
    await page.evaluate(async()=>{
      const [{createRenderer},{preloadWorldArt},{preloadHouses}]=await Promise.all([import('./renderer.js'),import('./atlas-runtime.js'),import('./raster-houses.js')]);
      await Promise.all([preloadWorldArt({waitMs:12000}),preloadHouses({biome:'taiga',waitMs:12000})]);
      const tiles=Array.from({length:4096},()=>({terrain:'grass',elevation:.25,detail:'',variant:0,building:null,road:false,rail:false,publicRoad:false}));
      for(let y=20;y<=38;y+=2)for(let x=20;x<=38;x+=2)tiles[y*64+x].building={kind:'house-cheap-1',level:1,footprint:1};
      for(let x=18;x<=40;x++)tiles[31*64+x].road=true;
      const stations=[{id:'a',name:'West stop',mode:'road',x:23,y:31},{id:'b',name:'East stop',mode:'road',x:35,y:31},{id:'c',name:'Rail station',mode:'rail',x:31,y:33}];
      tiles[33*64+31].rail=true;
      const game={biome:'taiga',seed:1,width:64,height:64,tiles,revision:1,networkRevision:1,day:0,cities:[],industries:[],stations,routes:[],vehicles:[],zones:[],terrainObjects:[]};
      const canvas=document.querySelector('canvas'),context=canvas.getContext('2d'),draw=context.drawImage.bind(context),calls=[];
      context.drawImage=(image,...args)=>{if(args.length===4)calls.push({width:args[2],height:args[3],alpha:context.globalAlpha});return draw(image,...args);};
      const renderer=createRenderer(canvas,game,{layers:{weather:false,names:false,industryIcons:false,trees:false,vehicleLoads:false},sceneryPanSettleMs:0});
      const hash=()=>{let value=2166136261;for(const byte of context.getImageData(0,0,canvas.width,canvas.height).data)value=Math.imul(value^byte,16777619);return value>>>0;};
      window.stopQA={canvas,game,renderer,calls,hash};
    });
    for(const zoom of [.5,1,2]) {
      await page.evaluate(zoom=>{stopQA.renderer.setZoom(zoom);stopQA.renderer.focus(29,29);for(let n=0;n<20;n++)stopQA.renderer.render(n*16,{settle:true});},zoom);
      await page.waitForTimeout(350);
      const row=await page.evaluate(({zoom,dpr})=>{
        const {renderer:r,canvas,game,calls,hash}=stopQA,rect=canvas.getBoundingClientRect(),view={settle:true};
        r.render(1000,view);const before=hash(),builds=r.getStats().sceneBuilds;
        calls.length=0;r.render(1000,{...view,stopPicking:{mode:'road',selectedId:'a',reducedMotion:true}});
        const faded=calls.filter(call=>call.alpha<.3),houses=calls.filter(call=>call.width===48&&call.height===60),road=game.stations[0],rail=game.stations[2],a=r.stationMarker(road),b=r.stationMarker(rail);
        const pick=marker=>r.stationAtMarker(rect.left+marker.x+marker.size/2,rect.top+marker.y+marker.size/2,{slop:8})?.id;
        const roadPick=pick(a),railPick=pick(b),during=hash();r.render(2000,{...view,stopPicking:{mode:'road',selectedId:'a',reducedMotion:true}});const still=hash();
        r.render(2000,view);const after=hash(),afterBuilds=r.getStats().sceneBuilds;
        r.setLayers({stations:false});r.render(3000,{...view,stopPicking:{mode:'road',reducedMotion:true}});const hiddenLayerPick=pick(r.stationMarker(road));
        r.render(3000,view);const hiddenNormalPick=pick(r.stationMarker(road));r.setLayers({stations:true});
        return {zoom,dpr,before,during,still,after,builds,afterBuilds,roadPick,railPick,hiddenLayerPick,hiddenNormalPick,faded:faded.length,houses,batches:r.getStats().sceneryBatches.draws};
      },{zoom,dpr});
      assert.ok(row.faded>0,'buildings fade through both direct and cached scene paths');
      assert.ok(row.houses.every(call=>Math.abs(call.alpha-.28)<.001),'individual house draws retain the selection opacity');
      assert.equal(row.roadPick,'a');assert.equal(row.railPick,undefined,'other transport modes cannot be selected');
      assert.notEqual(row.before,row.during,'selection changes the visible map');
      assert.equal(row.during,row.still,'reduced motion has a steady highlight');
      assert.equal(row.before,row.after,'leaving selection restores unmodified cached artwork');
      assert.equal(row.builds,row.afterBuilds,'selection does not rebuild the scenery');
      assert.equal(row.hiddenLayerPick,'a','stop selection remains usable when the ordinary stops layer is hidden');
      assert.equal(row.hiddenNormalPick,undefined,'normal picking respects the hidden stops layer');
      results.push(row);
    }
    await page.evaluate(()=>stopQA.renderer.render(1000,{stopPicking:{mode:'road',selectedId:'a',reducedMotion:true},settle:true}));
    if(dpr===1)await page.screenshot({path:`${output}/picking-stops.png`});
    await page.close();
  }
  assert.deepEqual(errors,[]);await writeFile(`${output}/results.json`,JSON.stringify({results,errors},null,2));
  console.log(JSON.stringify({profiles:results.length,errors},null,2));
} finally {await browser.close();}
