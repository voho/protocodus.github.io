// Undo promises follow current world state without discarding the confirmation.
import assert from 'node:assert/strict';
import {createWorldFromMenu} from './browser-start.mjs';
const {chromium} = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({channel:process.env.TRANSPORT_BROWSER || 'chrome',headless:true});
const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const errors = [];

async function rememberToast(page,name) {
 const toast=page.locator('.toast').filter({has:page.getByRole('button',{name:'Undo',exact:true})}).last();
 await toast.waitFor();
 // Keep the notice around, as hovering or keyboard focus does, so expiration
 // cannot accidentally satisfy an invalidation assertion on a slower machine.
 await toast.evaluate((el,name)=>{el.dataset.undoTest=name;el.toastLifetime.pause('test');},name);
 return page.locator(`[data-undo-test="${name}"]`);
}
async function stroke(page,tool,from,to=from) {
 const points=await page.evaluate(({tool,from,to})=>{
  transport.setTool(tool);transport.renderer.focus((from.x+to.x)/2,(from.y+to.y)/2);
  const bounds=document.querySelector('#world').getBoundingClientRect();
  return [from,to].map(p=>{const screen=transport.renderer.worldToScreen(p.x,p.y);return {x:bounds.left+screen.x,y:bounds.top+screen.y};});
 },{tool,from,to});
 for(const p of points)await page.waitForFunction(p=>document.elementFromPoint(p.x,p.y)?.id==='world',p);
 await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();
 if(from.x!==to.x||from.y!==to.y)await page.mouse.move(points[1].x,points[1].y,{steps:4});
 await page.mouse.up();
}

try {
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(url);await createWorldFromMenu(page);
 await page.locator('#objective-plan').click();await page.locator('#build-connection-plan').click();
 await page.locator('#route-form').waitFor();
 const connection=await rememberToast(page,'connection');
 assert.equal(await connection.getByRole('button',{name:'Undo',exact:true}).count(),1);
 const routes=await page.evaluate(()=>transport.game.routes.length);
 await page.locator('#route-form button[type="submit"]').click();
 assert.equal(await page.evaluate(()=>transport.game.routes.length),routes+1);
 assert.equal(await connection.getByRole('button',{name:'Undo',exact:true}).count(),0,'launch removes the invalid Undo action synchronously');
 assert.equal(await connection.isVisible(),true,'the successful construction confirmation stays');
 assert.doesNotMatch(await page.locator('#toast-region').innerText(),/can no longer be undone|Nothing to undo/);

 await page.evaluate(async()=>{
  const g=transport.game,{releaseTerrainObjects}=await import('./terrain-objects.js'),points=[];
  transport.setTool('inspect');transport.setView('build');document.querySelector('#dismiss-objective')?.click();
  for(const el of [...document.querySelector('#toast-region').children])el.dismissToast();
  for(let y=90;y<=120;y++)for(let x=90;x<=125;x++)points.push({x,y});
  releaseTerrainObjects(g,points);
  for(const {x,y} of points)Object.assign(g.tiles[y*g.width+x],{terrain:'grass',elevation:2/7,detail:'',publicRoad:false,road:false,rail:false,bridge:false,tunnel:false,building:null,zone:null});
  for(const key of ['cities','industries','stations','routes','vehicles','zones'])g[key]=[];
  g.money=1_000_000;g.revision++;g.networkRevision++;
  transport.renderer.setGame(g);transport.renderer.setZoom(1);
 });
 await stroke(page,'road',{x:100,y:100},{x:104,y:100});
 const first=await rememberToast(page,'first');
 await stroke(page,'road',{x:100,y:107},{x:104,y:107});
 const second=await rememberToast(page,'second');
 assert.equal(await first.getByRole('button',{name:'Undo',exact:true}).count(),1,'an unrelated build leaves an older valid Undo available');
 await second.getByRole('button',{name:'Undo',exact:true}).click();
 assert.equal(await page.evaluate(()=>transport.game.tiles[107*transport.game.width+102].road),false,'a retained action still undoes its construction');
 assert.equal(await first.getByRole('button',{name:'Undo',exact:true}).count(),1);
 await stroke(page,'rail',{x:100,y:100},{x:104,y:100});
 assert.equal(await first.isVisible(),true);
 assert.equal(await first.getByRole('button',{name:'Undo',exact:true}).count(),0,'overlapping later construction withdraws the old promise');

 await page.evaluate(()=>{
  const g=transport.game;
  for(const el of [...document.querySelector('#toast-region').children])el.dismissToast();
  g.cities.push({id:'undo-town',name:'Testford',x:110,y:109,population:400,activity:100,growth:0,passengers:100,mail:0,delivered:0,supplies:100,lastServiceDay:Math.floor(g.day),fundedUntil:Math.floor(g.day)+100});
  g.tiles[109*g.width+112].road=true;g.revision++;g.networkRevision++;
 });
 await stroke(page,'residential',{x:112,y:110});
 const development=await rememberToast(page,'development');
 await development.getByRole('button',{name:'Undo',exact:true}).focus();
 const grew=await page.evaluate(async()=>{
  const g=transport.game,{tick,settlementSuitability}=await import('./model.js'),zone=g.zones.find(p=>p.x===112&&p.y===110);
  zone.progress=.999;
  for(let day=0;day<20&&!g.tiles[110*g.width+112].building;day++)tick(g,1);
  return {ok:Boolean(g.tiles[110*g.width+112].building),day:g.day,zone,suitability:settlementSuitability(g,{x:112,y:110}),city:g.cities[0]};
 });
 assert.equal(grew.ok,true,`the simulation develops the zoned tile: ${JSON.stringify(grew)}`);
 await page.waitForFunction(()=>!document.querySelector('[data-undo-test="development"] .toast-action'));
 assert.equal(await development.isVisible(),true);
 assert.equal(await page.evaluate(()=>document.activeElement.id),'world','withdrawing a focused action returns keyboard focus to the map');
 assert.deepEqual(errors,[]);
 console.log('Undo toast browser check passed: route launch, overlapping builds, unrelated valid Undo, simulation development and keyboard focus.');
} finally {
 await browser.close();
}
