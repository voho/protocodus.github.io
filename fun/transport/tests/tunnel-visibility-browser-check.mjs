// Automatic mountain crossings and engineered bores share body, badge,
// picking and selection visibility; no saved tunnel needs a migration.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.TRANSPORT_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.TRANSPORT_BROWSER||'chrome',headless:true});
const base=process.env.TRANSPORT_URL||'http://127.0.0.1:8765/fun/transport/';
const results=[],errors=[];
try{
  for(const dpr of [1,2]){
    const page=await browser.newPage({viewport:{width:800,height:520},deviceScaleFactor:dpr});
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/tunnel-visibility-qa',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0}canvas{width:800px;height:520px}</style><canvas></canvas>'}));
    await page.goto(new URL('tunnel-visibility-qa',base).href);
    const checks=await page.evaluate(async()=>{
      const [{createRenderer},{placeVehicle},{preloadWorldArt}]=await Promise.all([import('./renderer.js'),import('./model.js'),import('./atlas-runtime.js')]);
      await preloadWorldArt({waitMs:12000});
      const canvas=document.querySelector('canvas'),checks=[];
      for(const mode of ['road','rail'])for(const axis of ['x','y'])for(const engineered of [false,true]){
        const width=40,at=along=>axis==='x'?{x:along,y:20}:{x:20,y:along};
        const game={width,height:40,seed:1,day:1,biome:'taiga',revision:1,networkRevision:1,industries:[],cities:[],stations:[],routes:[],vehicles:[],zones:[],tiles:Array.from({length:1600},(_,i)=>{
          const along=axis==='x'?i%width:Math.floor(i/width),hill=along>=14&&along<=18;
          return{terrain:hill?'mountain':'grass',elevation:(hill?5:2)/7,detail:'',variant:0,road:false,rail:false,bridge:false,tunnel:false,building:null,zone:null};
        })};
        const path=Array.from({length:13},(_,i)=>at(10+i));
        for(const p of path){const tile=game.tiles[p.y*width+p.x];tile[mode]=true;if(tile.terrain==='mountain')Object.assign(tile,{tunnel:true,...engineered?{structureLevel:5,structureAxis:axis}:{}});}
        const route={id:'route',mode,cargo:'grain',active:true,stops:[],path,number:1},vehicle={id:'carrier',routeId:'route',progress:6,direction:1,load:10,capacity:20,level:1};
        game.routes=[route];game.vehicles=[vehicle];placeVehicle(route,vehicle);
        const saved=JSON.stringify(game),renderer=createRenderer(canvas,game,{layers:{grid:false,names:false,industryIcons:false,trees:false,buildings:false,weather:false,vehicles:true,vehicleLoads:true,stations:false,routes:false}});
        renderer.setZoom(2);const focus=at(16);renderer.focus(focus.x,focus.y);
        const c=canvas.getContext('2d'),draw=c.drawImage,arc=c.arc;let bodies=0,arcs=0;
        const capture=(view={})=>{bodies=0;arcs=0;renderer.render(1000,{settle:true,...view});return{bodies,arcs,indicators:renderer.getStats().vehicleIndicators};};
        c.drawImage=function(image,...args){if(image.vehicleFrame)bodies++;return draw.call(this,image,...args);};
        c.arc=function(...args){arcs++;return arc.call(this,...args);};
        const hidden=capture(),selected=capture({selectedVehicleId:'carrier'}),referenced=capture({hoverRef:'vehicle:carrier'}),p=renderer.worldToScreen(vehicle.x,vehicle.y),hiddenPick=renderer.vehicleAt(p.x,p.y)?.id||null;
        const noMutation=JSON.stringify(game)===saved,approaches=[];
        // Road poses directly test the visible mouth approaches. Rail ends
        // leave enough room for the complete consist outside either mouth.
        for(const progress of mode==='road'?[3.6,3.79,3.9,8.1,8.25,8.4]:[0,12]){
          vehicle.progress=progress;placeVehicle(route,vehicle);renderer.focus(vehicle.x,vehicle.y);
          const state=capture({selectedVehicleId:'carrier'}),point=renderer.vehicleWorldPoint(vehicle),screen=renderer.worldToScreen(point.x,point.y);
          approaches.push({progress,...state,picked:renderer.vehicleAt(screen.x,screen.y)?.id||null});
        }
        c.drawImage=draw;c.arc=arc;checks.push({mode,axis,engineered,hidden,selected,referenced,hiddenPick,noMutation,approaches});
      }
      return checks;
    });
    for(const check of checks){
      const label=`${check.mode}/${check.axis}/${check.engineered?'engineered':'automatic'}/DPR${dpr}`;
      for(const state of [check.hidden,check.selected,check.referenced]){
        assert.equal(state.bodies,0,`${label}: underground bodies are hidden`);assert.equal(state.arcs,0,`${label}: underground carriers leave no selection/locator ring`);
        assert.deepEqual(state.indicators,{empty:0,partial:0,full:0},`${label}: underground loads are hidden`);
      }
      assert.equal(check.hiddenPick,null,`${label}: an underground carrier cannot be picked`);assert.equal(check.noMutation,true,`${label}: rendering keeps saved data untouched`);
      for(const approach of check.approaches){
        const exposed=check.mode==='rail'||![3.9,8.1].includes(approach.progress);
        assert.equal(approach.bodies>0,exposed,`${label}: portal body visibility at${approach.progress}`);
        assert.equal(approach.arcs>0,exposed,`${label}: portal selection visibility at${approach.progress}`);
        assert.equal(approach.indicators.partial,Number(exposed),`${label}: portal load visibility at${approach.progress}`);
        assert.equal(approach.picked,exposed?'carrier':null,`${label}: portal picking at${approach.progress}`);
      }
      results.push({mode:check.mode,axis:check.axis,engineered:check.engineered,dpr});
    }
    await page.close();
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,profiles:results.length,results},null,2));
}finally{await browser.close();}
