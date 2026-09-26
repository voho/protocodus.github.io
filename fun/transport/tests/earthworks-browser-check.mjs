// Real construction gestures in isolated storage; the player's company is untouched.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.TRANSPORT_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.TRANSPORT_BROWSER||'chrome',headless:true});
const url=process.env.TRANSPORT_URL||'http://127.0.0.1:8765/fun/transport/';
const output=process.env.TRANSPORT_SCREENSHOTS||'/tmp/transport-earthworks';
await mkdir(output,{recursive:true});
const errors=[];

async function start(viewport,hasTouch=false){
 const page=await browser.newPage({viewport,hasTouch,isMobile:hasTouch});
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(url);await page.waitForFunction(()=>window.transport?.renderer);
 await page.evaluate(()=>transport.setSpeed(0));return page;
}
async function fixture(page){return page.evaluate(()=>{
 const g=transport.game;let site;
 for(let y=32;y<g.height-40&&!site;y+=24)for(let x=32;x<g.width-40;x+=28){
  if(![...g.cities,...g.industries,...g.stations].some(p=>p.x>=x-8&&p.x<=x+30&&p.y>=y-8&&p.y<=y+30)){site={x,y};break;}
 }
 if(!site)throw new Error('No free earthworks test site.');
 for(let y=site.y-2;y<=site.y+22;y++)for(let x=site.x-2;x<=site.x+22;x++){
  const t=g.tiles[y*g.width+x];Object.assign(t,{terrain:'grass',elevation:6/16,detail:'',variant:0,road:false,rail:false,bridge:false,tunnel:false,building:null,zone:null});
  delete t.publicRoad;delete t.structureAxis;delete t.structureLevel;
 }
 for(const dy of [0,4,8,12])for(let dx=1;dx<6;dx++){
  const t=g.tiles[(site.y+dy)*g.width+site.x+dx];t.elevation=(dy===4||dy===12?9:3)/16;
  if(dy===8){t.terrain='water';t.elevation=0;}
 }
 g.money=1000000;g.revision++;g.networkRevision++;
 transport.renderer.setZoom(1);return site;
});}
async function screen(page,tiles){return page.evaluate(tiles=>{
 const center=tiles.reduce((s,p)=>({x:s.x+p.x/tiles.length,y:s.y+p.y/tiles.length}),{x:0,y:0});
 transport.renderer.focus(center.x,center.y);
 const r=document.querySelector('#world').getBoundingClientRect(),c=transport.renderer.getCamera();
 return tiles.map(p=>({x:r.left+r.width/2+((p.x+.5)*32-c.x)*c.zoom,y:r.top+r.height/2+((p.y+.5)*32-c.y)*c.zoom}));
},tiles);}
async function choose(page,tool){
 if(await page.locator('.mobile-panel-toggle').isVisible()&&!await page.locator('.sidebar').evaluate(el=>el.classList.contains('mobile-open')))await page.locator('.mobile-panel-toggle').click();
 if(!await page.locator('.engineering-tools').evaluate(el=>el.open))await page.locator('.engineering-tools summary').click();
 const mode=tool.startsWith('rail')?'rail':'road';
 if(['bridge','tunnel','railbridge','railtunnel'].includes(tool))await page.locator(`[data-crossing-mode="${mode}"]`).click();
 await page.locator(`[data-tool="${tool}"]`).click();
}
async function state(page,site){return page.evaluate(site=>{
 const g=transport.game,tiles=[];
 for(let dy=0;dy<20;dy++)for(let dx=0;dx<20;dx++)tiles.push(g.tiles[(site.y+dy)*g.width+site.x+dx]);
 return{money:g.money,tiles:JSON.stringify(tiles)};
},site);}
async function beginDrag(page,a,b){
 const [from,to]=await screen(page,[a,b]);
 await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:6});
 return await page.locator('#placement-tip').innerText();
}

try{
 const page=await start({width:1280,height:920}),site=await fixture(page),tile=(dx,dy)=>({x:site.x+dx,y:site.y+dy});
 assert.equal(await page.locator('.engineering-tools').evaluate(el=>el.open),false,'secondary tools start collapsed');
 await choose(page,'raise');assert.match(await page.locator('#active-tool-hint').innerText(),/\+1 level/);
 let [p]=await screen(page,[tile(12,0)]);await page.mouse.move(p.x,p.y);
 assert.match(await page.locator('#placement-tip').innerText(),/Level 6 → 7/);
 await page.mouse.click(p.x,p.y);
 assert.equal(await page.evaluate(({x,y})=>transport.game.tiles[y*transport.game.width+x].elevation,tile(12,0)),7/16);
 await choose(page,'lower');await page.mouse.click(p.x,p.y);
 assert.equal(await page.evaluate(({x,y})=>transport.game.tiles[y*transport.game.width+x].elevation,tile(12,0)),6/16);
 await choose(page,'raise');
 assert.match(await beginDrag(page,tile(12,2),tile(14,2)),/\+1 level \/ tile.*3 tiles/);await page.mouse.up();
 assert.deepEqual(await page.evaluate(({x,y})=>[0,1,2].map(dx=>transport.game.tiles[y*transport.game.width+x+dx].elevation),tile(12,2)),[7/16,7/16,7/16],'one level per selected tile');

 // A second drag is cancelled before release and must not charge or change land.
 const beforeCancel=await state(page,site);await beginDrag(page,tile(12,2),tile(14,2));await page.keyboard.press('Escape');await page.mouse.up();
 assert.deepEqual(await state(page,site),beforeCancel);
 await choose(page,'bridge');[p]=await screen(page,[tile(1,8)]);await page.mouse.move(p.x,p.y);
 assert.match(await page.locator('#placement-tip').innerText(),/at least 3 tiles/);
 const beforeSingle=await state(page,site);await page.mouse.click(p.x,p.y);assert.deepEqual(await state(page,site),beforeSingle,'explicit spans cannot be built with a single click');
 for(const [tool,dy] of [['bridge',0],['tunnel',4],['railbridge',8],['railtunnel',12]]){
  await choose(page,tool);
  const before=await state(page,site),tip=await beginDrag(page,tile(0,dy),tile(6,dy+(tool==='bridge'?1:0)));
  assert.match(tip,/Level 6/);assert.match(tip,/7 tiles/);
  const cost=Number(tip.match(/\$([\d,]+)/)[1].replaceAll(',',''));
  await page.mouse.up();const after=await state(page,site);assert.equal(before.money-after.money,cost,'shown cost equals charged cost');
  const built=await page.evaluate(({x,y})=>[0,1,2,3,4,5,6].map(dx=>transport.game.tiles[y*transport.game.width+x+dx]),tile(0,dy));
  const mode=tool.startsWith('rail')?'rail':'road',structure=tool.endsWith('bridge')?'bridge':'tunnel';
  assert.ok(built.every(t=>t[mode]));assert.ok(built.slice(1,-1).every(t=>t[structure]&&t.structureLevel===6&&t.structureAxis==='x'));
  if(tool==='bridge')assert.equal(await page.evaluate(({x,y})=>transport.game.tiles[y*transport.game.width+x].road,tile(6,1)),false,'off-axis cursor snaps to a straight span');
 }
 await choose(page,'raise');[p]=await screen(page,[tile(1,0)]);await page.mouse.move(p.x,p.y);
 assert.match(await page.locator('#placement-tip').innerText(),/Clear|network/);
 const protectedState=await state(page,site);await page.mouse.click(p.x,p.y);assert.deepEqual(await state(page,site),protectedState);

 // Mismatched endpoints reject the complete span before spending.
 await page.evaluate(({x,y})=>{const g=transport.game;g.tiles[y*g.width+x].elevation=7/16;g.revision++;},tile(6,16));
 await choose(page,'bridge');const invalidBefore=await state(page,site);
 assert.match(await beginDrag(page,tile(0,16),tile(6,16)),/Match both ends|start level|same level/);
 assert.equal(await page.locator('#placement-tip').evaluate(el=>el.classList.contains('invalid')),true);
 await page.mouse.up();assert.deepEqual(await state(page,site),invalidBefore);

 await page.evaluate(site=>{transport.setTool('inspect');transport.renderer.focus(site.x+6,site.y+7);},site);
 await page.screenshot({path:`${output}/terrain-crossings-desktop.png`});
 const saved=await state(page,site);await page.evaluate(()=>transport.persist());await page.reload();await page.waitForFunction(()=>window.transport?.renderer);await page.evaluate(()=>transport.setSpeed(0));
 const loaded=await state(page,site);assert.deepEqual(JSON.parse(loaded.tiles),JSON.parse(saved.tiles),'terrain and crossing metadata survive real local-storage reload');
 await page.close();

 for(const width of [390,320]){
  const mobile=await start({width,height:844},true);await choose(mobile,'raise');
  assert.equal(await mobile.locator('.sidebar').evaluate(el=>el.classList.contains('mobile-open')),false,'choosing a terrain tool returns to the map');
  await mobile.locator('.mobile-panel-toggle').click();await mobile.locator('[data-crossing-mode="rail"]').click();await mobile.locator('[data-tool="railtunnel"]').click();
  assert.equal(await mobile.locator('#active-tool-name').innerText(),'Rail tunnel');
  assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal page overflow');
  await mobile.locator('.mobile-panel-toggle').click();await mobile.locator('.engineering-tools').scrollIntoViewIfNeeded();
  await mobile.screenshot({path:`${output}/terrain-tools-mobile-${width}.png`});await mobile.close();
 }
 assert.deepEqual(errors,[]);console.log('PASS: terrain gestures, level/cost previews, all four spans, cancellation, protected tiles, atomic rejection, local save/reload, and 320/390px controls.');
}finally{await browser.close();}
