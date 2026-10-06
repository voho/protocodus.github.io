// Real construction gestures in isolated storage; the player's company is untouched.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createWorldFromMenu,loadAutosaveFromMenu} from './browser-start.mjs';
const {chromium}=await import(process.env.TRANSPORT_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.TRANSPORT_BROWSER||'chrome',headless:true});
const url=process.env.TRANSPORT_URL||'http://127.0.0.1:8765/fun/transport/';
const output=process.env.TRANSPORT_SCREENSHOTS||'/tmp/transport-earthworks';
await mkdir(output,{recursive:true});
const errors=[];

async function start(viewport){
 const page=await browser.newPage({viewport});
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(url);await createWorldFromMenu(page);return page;
}
async function fixture(page){return page.evaluate(async()=>{
 const g=transport.game;let site;
 for(let y=32;y<g.height-48&&!site;y+=24)for(let x=32;x<g.width-40;x+=28){
  if(![...g.cities,...g.industries,...g.stations].some(p=>p.x>=x-8&&p.x<=x+30&&p.y>=y-8&&p.y<=y+45)){site={x,y};break;}
 }
 if(!site)throw new Error('No free earthworks test site.');
 const {releaseTerrainObjects}=await import('./terrain-objects.js'),cleared=[];
 for(let y=site.y-7;y<=site.y+39;y++)for(let x=site.x-7;x<=site.x+23;x++)cleared.push({x,y});
 releaseTerrainObjects(g,cleared);
 for(let y=site.y-6;y<=site.y+38;y++)for(let x=site.x-6;x<=site.x+22;x++){
  const t=g.tiles[y*g.width+x];Object.assign(t,{terrain:'grass',elevation:3/7,detail:'',variant:0,road:false,rail:false,bridge:false,tunnel:false,building:null,zone:null});
  delete t.publicRoad;delete t.structureAxis;delete t.structureLevel;
 }
 // Wide cross-sections make straight approaches. Keep the four scenes far
 // enough apart that the neighboring river does not turn a portal sideways.
 for(const dy of [0,8,16,24]){
  const levels=dy===16?[3,3,2,1,0,0,0,0,0,0,1,2,3,3]:dy===8||dy===24?[3,3,4,5,5,5,5,5,5,5,5,4,3,3]:[3,3,2,1,1,1,1,1,1,1,1,2,3,3];
  for(let dx=0;dx<levels.length;dx++)for(let across=-2;across<=2;across++){
   const t=g.tiles[(site.y+dy+across)*g.width+site.x+dx];t.elevation=levels[dx]/7;
   if(dy===16&&dx>=4&&dx<=8){t.terrain='water';t.elevation=0;}
  }
 }
 g.money=1000000;g.revision++;g.networkRevision++;
 transport.renderer.setZoom(1);return site;
});}
async function screen(page,tiles,vertices=false){return page.evaluate(({tiles,vertices})=>{
 const center=tiles.reduce((s,p)=>({x:s.x+p.x/tiles.length,y:s.y+p.y/tiles.length}),{x:0,y:0});
 transport.renderer.focus(center.x-(vertices?.5:0),center.y-(vertices?.5:0));
 const r=document.querySelector('#world').getBoundingClientRect();
 return tiles.map(p=>{const screen=vertices?transport.renderer.gridPointToScreen(p.x,p.y):transport.renderer.worldToScreen(p.x,p.y);return{x:r.left+screen.x,y:r.top+screen.y};});
},{tiles,vertices});}
// Choosing a tool, or a crossing mode while a span tool is active, closes the drawer.
async function drawer(page){if(!await page.locator('.sidebar').evaluate(el=>el.classList.contains('drawer-open')))await page.locator('.main-nav [data-view="build"]').click();}
async function choose(page,tool){
 await drawer(page);
 if(!await page.locator('.engineering-tools').evaluate(el=>el.open))await page.locator('.engineering-tools summary').click();
 const mode=tool.startsWith('rail')?'rail':'road';
 if(['bridge','tunnel','railbridge','railtunnel'].includes(tool)){await page.locator(`[data-crossing-mode="${mode}"]`).click();await drawer(page);}
 await page.locator(`[data-tool="${tool}"]`).click();
}
async function state(page,site){return page.evaluate(site=>{
 const g=transport.game,tiles=[];
 for(let dy=0;dy<40;dy++)for(let dx=0;dx<20;dx++)tiles.push(g.tiles[(site.y+dy)*g.width+site.x+dx]);
 return{money:g.money,tiles:JSON.stringify(tiles)};
},site);}
async function beginDrag(page,a,b,vertices=false){
 const [from,to]=await screen(page,[a,b],vertices);
 await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:6});
 return await page.locator('#placement-tip').innerText();
}

try{
 const page=await start({width:1280,height:920}),site=await fixture(page),tile=(dx,dy)=>({x:site.x+dx,y:site.y+dy});
 assert.equal(await page.locator('.engineering-tools').evaluate(el=>el.open),false,'secondary tools start collapsed');
 await choose(page,'raise');assert.match(await page.locator('#active-tool-hint').innerText(),/\+1 level/);
 let [p]=await screen(page,[tile(16,32)],true);await page.mouse.move(p.x,p.y);
 assert.match(await page.locator('#placement-tip').innerText(),/Level 3 → 4/);
 await page.mouse.click(p.x,p.y);
 assert.equal(await page.evaluate(({x,y})=>transport.game.tiles[y*transport.game.width+x].elevation,tile(16,32)),4/7);
 await choose(page,'lower');[p]=await screen(page,[tile(16,32)],true);await page.mouse.click(p.x,p.y);
 assert.equal(await page.evaluate(({x,y})=>transport.game.tiles[y*transport.game.width+x].elevation,tile(16,32)),3/7);
 await choose(page,'raise');
 assert.match(await beginDrag(page,tile(16,34),tile(18,34),true),/\+1 level \/ (?:tile|point).*3 (?:tiles|points)/);await page.mouse.up();
 assert.deepEqual(await page.evaluate(({x,y})=>[0,1,2].map(dx=>transport.game.tiles[y*transport.game.width+x+dx].elevation),tile(16,34)),[4/7,4/7,4/7],'one level per selected vertex');

 // A second drag is cancelled before release and must not charge or change land.
 const beforeCancel=await state(page,site);await beginDrag(page,tile(16,34),tile(18,34),true);await page.keyboard.press('Escape');await page.mouse.up();
 assert.deepEqual(await state(page,site),beforeCancel);
 await choose(page,'bridge');[p]=await screen(page,[tile(1,16)]);await page.mouse.move(p.x,p.y);
 assert.match(await page.locator('#placement-tip').innerText(),/at least 3 tiles/);
 const beforeSingle=await state(page,site);await page.mouse.click(p.x,p.y);assert.deepEqual(await state(page,site),beforeSingle,'explicit spans cannot be built with a single click');
 for(const [tool,dy] of [['bridge',0],['tunnel',8],['railbridge',16],['railtunnel',24]]){
  await choose(page,tool);
  const before=await state(page,site),tip=await beginDrag(page,tile(0,dy),tile(12,dy+(tool==='bridge'?1:0)));
  assert.match(tip,/Level 3/);assert.match(tip,/13 tiles/);
  const cost=Number(tip.match(/\$([\d,]+)/)[1].replaceAll(',',''));
  await page.mouse.up();const after=await state(page,site);assert.equal(before.money-after.money,cost,'shown cost equals charged cost');
  const built=await page.evaluate(({x,y})=>Array.from({length:13},(_,dx)=>transport.game.tiles[y*transport.game.width+x+dx]),tile(0,dy));
  const mode=tool.startsWith('rail')?'rail':'road',structure=tool.endsWith('bridge')?'bridge':'tunnel';
  assert.ok(built.every(t=>t[mode]));assert.ok(built.slice(1,-1).every(t=>t[structure]&&t.structureLevel===7&&t.structureAxis==='x'),'visible level3 retains legacy 16-step metadata code7');
  if(tool==='bridge')assert.equal(await page.evaluate(({x,y})=>transport.game.tiles[y*transport.game.width+x].road,tile(12,1)),false,'off-axis cursor snaps to a straight span');
 }
 await choose(page,'raise');[p]=await screen(page,[tile(1,0)],true);await page.mouse.move(p.x,p.y);
 assert.match(await page.locator('#placement-tip').innerText(),/Clear|network/);
 const protectedState=await state(page,site);await page.mouse.click(p.x,p.y);assert.deepEqual(await state(page,site),protectedState);

 // Mismatched endpoints reject the complete span before spending.
 await page.evaluate(({x,y})=>{const g=transport.game;for(const [dx,dy]of[[0,0],[1,0],[0,1],[1,1]])g.tiles[(y+dy)*g.width+x+dx].elevation=4/7;g.revision++;},tile(6,32));
 await choose(page,'bridge');const invalidBefore=await state(page,site);
 assert.match(await beginDrag(page,tile(0,32),tile(6,32)),/Match both ends|start level|same level/);
 assert.equal(await page.locator('#placement-tip').evaluate(el=>el.classList.contains('invalid')),true);
 await page.mouse.up();assert.deepEqual(await state(page,site),invalidBefore);

 await page.evaluate(site=>{transport.setTool('inspect');transport.renderer.setZoom(.5);transport.renderer.focus(site.x+6,site.y+12);},site);
 await page.screenshot({path:`${output}/terrain-crossings-desktop.png`});
 const saved=await state(page,site);await page.evaluate(()=>transport.persist());await page.reload();await loadAutosaveFromMenu(page);
 const loaded=await state(page,site);assert.deepEqual(JSON.parse(loaded.tiles),JSON.parse(saved.tiles),'terrain and crossing metadata survive real local-storage reload');
 await page.close();

 assert.deepEqual(errors,[]);console.log('PASS: terrain gestures, level/cost previews, all four spans, cancellation, protected tiles, atomic rejection, and local save/reload.');
}finally{await browser.close();}
