// Weather grades the world without editing artwork or advancing paused games.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.TRANSPORT_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.TRANSPORT_BROWSER||'chrome',headless:true});
const base=process.env.TRANSPORT_URL||'http://127.0.0.1:8765/fun/transport/';
const output=process.env.TRANSPORT_SCREENSHOTS||'/tmp/transport-weather-qa';
await mkdir(output,{recursive:true});
const errors=[],profiles=[];
try{
 for(const dpr of [1,2]){
  const page=await browser.newPage({viewport:{width:1280,height:850},deviceScaleFactor:dpr});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/weather-qa',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0;background:#283e35}canvas{display:block;width:1280px;height:850px}</style><canvas></canvas>'}));
  await page.goto(new URL('weather-qa',base).href);
  const result=await page.evaluate(async()=>{
   const {createGame}=await import('./model.js'),{createRenderer}=await import('./renderer.js'),{createWeatherEffects,weatherPresentation,MAX_WEATHER_PARTICLES}=await import('./weather-effects.js');
   const {preloadHouses}=await import('./raster-houses.js'),{preloadWorldArt}=await import('./atlas-runtime.js');
   const game=createGame({biome:'taiga',size:'square512',seed:1847});
   await Promise.all([preloadHouses({biome:game.biome,waitMs:15000}),preloadWorldArt({biome:game.biome,waitMs:15000})]);
   const canvas=document.querySelector('canvas'),renderer=createRenderer(canvas,game,{layers:{names:false,industryIcons:false,grid:false,routes:false}});renderer.focus(game.cities[0].x,game.cities[0].y);renderer.setZoom(1);
   const camera=renderer.getCamera(),c=canvas.getContext('2d'),hash=()=>{let value=2166136261;for(const b of c.getImageData(0,0,canvas.width,canvas.height).data)value=Math.imul(value^b,16777619);return value>>>0;};
   const scenarios={};for(let day=0;day<360;day++){const w=weatherPresentation(game,camera.x/32,camera.y/32,day);for(const kind of ['rain','snow'])if(!scenarios[kind]||scenarios[kind].strength<w[kind])scenarios[kind]={day,strength:w[kind]};}
   const climates={};for(const biome of ['taiga','tundra','desert']){const sample={...game,biome},peak={rain:0,snow:0};for(let day=0;day<360;day++){const w=weatherPresentation(sample,camera.x/32,camera.y/32,day);peak.rain=Math.max(peak.rain,w.rain);peak.snow=Math.max(peak.snow,w.snow);}climates[biome]=peak;}
   // Scenery batches finish over a few frames after the first view; compare settled frames.
   game.day=scenarios.rain.day;for(let n=0;n<60;n++){renderer.render(0);const batches=renderer.getStats().sceneryBatches;if(!batches.waitingForCamera&&!batches.pending)break;await new Promise(resolve=>setTimeout(resolve,20));}
   renderer.render(0);const rainy=hash(),stats=renderer.getStats().weather,saved=JSON.stringify(game);renderer.render(10000);const paused=hash();renderer.setLayers({weather:false});renderer.render(0);const off=hash();renderer.setLayers({weather:true});renderer.render(0);const restored=hash();
   let took=0;for(let i=0;i<8;i++){const start=performance.now();renderer.render(i);took+=performance.now()-start;}
   // Isolate compositing and particles from normal water animation.
   let reduced=false;const draw=createWeatherEffects({reducedMotion:()=>reduced});
   function effect(time,on=true){game.day=time;c.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);c.fillStyle='#699741';c.fillRect(0,0,1280,850);draw(c,{game,layers:{weather:on},camera,width:1280,height:850});return{hash:hash(),sample:Array.from(c.getImageData(2,2,1,1).data),stats:draw.getStats()};}
   const plain=effect(scenarios.rain.day,false),rain=effect(scenarios.rain.day),moved=effect(scenarios.rain.day+.2);reduced=true;const quiet=effect(scenarios.rain.day);
   // Count cap is tested against a very large screen with a recording context,
   // without allocating a huge backing image just for the test.
   const calls=[];const fake={save(){},restore(){},fillRect(){},beginPath(){},moveTo(){},lineTo(){calls.push(1)},stroke(){},arc(){calls.push(1)},fill(){}};reduced=false;draw(fake,{game,layers:{},camera,width:16000,height:10000});const cap=draw.getStats();
   game.day=scenarios.rain.day;renderer.render(0);window.weatherQA={game,renderer,scenarios};
   return{dpr:devicePixelRatio,rainy,paused,off,restored,unchanged:saved===JSON.stringify(game),stats,scenarios,climates,plain,rain,moved,quiet,cap,calls:calls.length,limit:MAX_WEATHER_PARTICLES,warmFrameMs:took/8};
  });
  assert.equal(result.rainy,result.paused,'wall-clock time cannot animate a paused world');assert.notEqual(result.off,result.rainy);assert.equal(result.restored,result.rainy);assert.equal(result.unchanged,true);
  assert.ok(result.scenarios.rain.strength>.45);assert.ok(result.scenarios.snow.strength>.20,'the taiga has seasonal snow');
  assert.equal(result.climates.desert.snow,0,'desert heat prevents snowfall');assert.ok(result.climates.tundra.snow>.4,'cold tundra gets snow');
  assert.notEqual(result.rain.hash,result.moved.hash,'precipitation follows fractional simulation time');assert.equal(result.quiet.stats.particles,0);assert.notEqual(result.plain.hash,result.quiet.hash,'reduced motion keeps the weather color grade');
  const saturation=p=>Math.max(...p.slice(0,3))-Math.min(...p.slice(0,3));assert.ok(saturation(result.rain.sample)<saturation(result.plain.sample),'rain softens the palette');assert.ok(result.rain.sample[2]>result.plain.sample[2],'rain shifts the view toward colder colors');
  assert.ok(result.cap.particles<=result.limit);assert.ok(result.calls<=result.limit);assert.equal(result.cap.bytes,result.limit*16);
  await page.screenshot({path:`${output}/rain-dpr${dpr}.png`});
  await page.evaluate(()=>{weatherQA.game.day=weatherQA.scenarios.snow.day;weatherQA.renderer.render(0);});await page.screenshot({path:`${output}/snow-dpr${dpr}.png`});
  // Browser preference changes reach the renderer too, without rebuilding art.
  await page.emulateMedia({reducedMotion:'reduce'});const reduced=await page.evaluate(()=>{weatherQA.renderer.render(0);return weatherQA.renderer.getStats().weather;});assert.equal(reduced.particles,0);
  profiles.push(result);await page.close();
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({profiles,errors},null,2));
}finally{await browser.close();}
