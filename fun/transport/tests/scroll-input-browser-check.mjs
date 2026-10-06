// Camera gestures must leave construction and clicking intact, without doing
// a full sprite/terrain pick for every pointer event or trackpad wheel packet.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWorldFromMenu } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-scroll-input-qa';
await mkdir(output, { recursive:true });
const errors=[],results=[];
const settle=page=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
try {
 for (const density of [1.25,2]) {
  const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:density});
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/');
  await createWorldFromMenu(page,{generationVersion:10});
  await page.evaluate(()=>document.querySelector('#dismiss-objective')?.click());
  await page.evaluate(()=>{
   const r=transport.renderer;window.inputQA={picks:0,hover:null,preview:[]};
   for(const method of ['screenToInspectTile','screenToTile','screenToVertex']){
    const original=r[method];r[method]=function(...args){inputQA.picks++;return original.apply(this,args);};
   }
   const render=r.render;r.render=function(now,state){inputQA.hover=state.hover;inputQA.preview=state.preview.map(p=>({x:p.x,y:p.y}));return render.call(this,now,state);};
  });
  const map=await page.locator('#world').boundingBox(),start={x:map.x+map.width/2,y:map.y+map.height/2},end={x:start.x+100,y:start.y+45};
  await page.mouse.move(start.x,start.y);await settle(page);
  const before=await page.evaluate(()=>({camera:transport.renderer.getCamera(),day:transport.game.day,revision:transport.game.revision,money:transport.game.money}));
  await page.mouse.down();await page.evaluate(()=>inputQA.picks=0);
  await page.mouse.move(end.x,end.y,{steps:24});await settle(page);
  const held=await page.evaluate(()=>({picks:inputQA.picks,hover:inputQA.hover,camera:transport.renderer.getCamera()}));
  assert.equal(held.picks,0,'Explore drag pans without inspecting sprites at each move');
  assert.equal(held.hover,null,'dragging clears the hover ring from the moving scenery');
  assert.notEqual(held.camera.x,before.camera.x,'the drag moves the camera');
  await page.mouse.up();await settle(page);
  const released=await page.evaluate(()=>({picks:inputQA.picks,hover:inputQA.hover,day:transport.game.day,revision:transport.game.revision,money:transport.game.money,inspector:!document.querySelector('#inspector').hidden}));
  assert.equal(released.picks,1,'release restores the hover with one detailed pick');
  assert.ok(released.hover,'the released pointer again hovers the map');
  assert.equal(released.inspector,false,'a moved drag does not inspect its starting tile');
  for(const field of ['day','revision','money'])assert.equal(released[field],before[field],`panning leaves ${field} unchanged`);
  // A stationary click still opens the town at the pressed tile.
  const town=await page.evaluate(()=>{
   const city=transport.game.cities[0],r=transport.renderer;r.focus(city.x,city.y);const rect=document.querySelector('#world').getBoundingClientRect(),p=r.worldToScreen(city.x,city.y);return {x:rect.left+p.x,y:rect.top+p.y,name:city.name};
  });
  await settle(page);await page.mouse.click(town.x,town.y);await settle(page);
  assert.match(await page.locator('#inspector-title').textContent(),new RegExp(town.name),'an Explore click still inspects the town');
  await page.keyboard.press('Escape');
  // A trackpad can emit several packets before one display frame. Refresh
  // the tile under its resting pointer once after the accumulated camera move.
  await page.mouse.move(start.x,start.y);await settle(page);
  const wheel=await page.evaluate(({x,y})=>{
   inputQA.picks=0;const canvas=document.querySelector('#world'),before=transport.renderer.getCamera();
   for(let n=0;n<16;n++)canvas.dispatchEvent(new WheelEvent('wheel',{clientX:x,clientY:y,deltaX:2,deltaY:0,bubbles:true,cancelable:true}));
   return {before,immediatePicks:inputQA.picks};
  },start);
  assert.equal(wheel.immediatePicks,0,'wheel packets only accumulate camera movement');
  await settle(page);
  const afterWheel=await page.evaluate(()=>({picks:inputQA.picks,camera:transport.renderer.getCamera()}));
  assert.equal(afterWheel.picks,1,'one frame refreshes hover after the wheel burst');
  assert.notEqual(afterWheel.camera.x,wheel.before.x);
  // Right-button and Space pans while constructing never produce a stroke.
  for(const kind of ['right','space','stop-swipe']){
   await page.evaluate(kind=>transport.setTool(kind==='stop-swipe'?'stop':'road'),kind);
   await page.mouse.move(start.x,start.y);await settle(page);
   const model=await page.evaluate(()=>({money:transport.game.money,revision:transport.game.revision,stations:transport.game.stations.length}));
   if(kind==='space')await page.keyboard.down('Space');
   await page.mouse.down(kind==='right'?{button:'right'}:{});await page.evaluate(()=>inputQA.picks=0);
   await page.mouse.move(end.x,end.y,{steps:16});await settle(page);
   assert.equal(await page.evaluate(()=>inputQA.picks),0,`${kind} pan skips unused placement picks`);
   assert.equal(await page.locator('#placement-tip').isVisible(),false,`${kind} pan hides the construction quote`);
   await page.mouse.up(kind==='right'?{button:'right'}:{});
   if(kind==='space')await page.keyboard.up('Space');
   await settle(page);
   assert.deepEqual(await page.evaluate(()=>({money:transport.game.money,revision:transport.game.revision,stations:transport.game.stations.length})),model,`${kind} pan never constructs at its starting tile`);
   assert.deepEqual(await page.evaluate(()=>inputQA.preview),[],`${kind} pan leaves no construction stroke`);
  }
  await page.evaluate(()=>transport.setTool('inspect'));await settle(page);
  await page.screenshot({path:`${output}/scroll-input-${density}.png`});
  results.push({density,dragMoves:24,dragPicks:held.picks,releasePicks:released.picks,wheelPackets:16,wheelPicks:afterWheel.picks});
  await page.close();
 }
 assert.deepEqual(errors,[]);
 await writeFile(`${output}/results.json`,JSON.stringify({results,errors},null,2));
 console.log(JSON.stringify({results,errors},null,2));
} finally { await browser.close(); }
