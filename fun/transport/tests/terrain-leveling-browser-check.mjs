import { openBuildArea } from './browser-build.mjs';
// Isolated browser companies: no connection to the player's local saves.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu, loadAutosaveFromMenu } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({channel:process.env.TRANSPORT_BROWSER || 'chrome',headless:true});
const url=process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output=process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-leveling-ui';
await mkdir(output,{recursive:true});
const errors=[];

async function fixture(page) {
  return page.evaluate(async()=>{
    transport.setSpeed(0);const game=transport.game;let center;
    for(let y=40;y<game.height-40&&!center;y+=24)for(let x=40;x<game.width-40&&!center;x+=24){
      if(![...game.cities,...game.industries,...game.stations].some(p=>Math.abs(p.x-x)<30&&Math.abs(p.y-y)<30))center={x,y};
    }
    if(!center)throw new Error('No free grading test area.');
    const {releaseTerrainObjects}=await import('./terrain-objects.js'),points=[];
    for(let dy=-20;dy<=20;dy++)for(let dx=-20;dx<=20;dx++)points.push({x:center.x+dx,y:center.y+dy});
    releaseTerrainObjects(game,points);
    for(let dy=-19;dy<=19;dy++)for(let dx=-19;dx<=19;dx++){
      const tile=game.tiles[(center.y+dy)*game.width+center.x+dx];
      Object.assign(tile,{terrain:'grass',elevation:4/7,detail:'',variant:0,road:false,rail:false,bridge:false,tunnel:false,building:null,zone:null});
      delete tile.publicRoad;delete tile.structureAxis;delete tile.structureLevel;
      if(Math.abs(dx)<=8&&Math.abs(dy)<=8)tile.elevation=(dx+dy<0?3:4)/7;
    }
    game.money=1000000;game.revision++;game.networkRevision++;
    transport.renderer.setZoom(1);transport.renderer.focus(center.x,center.y);transport.setView('build');
    return center;
  });
}
async function choose(page,key) {
  await openBuildArea(page, ['level','raise','lower'].includes(key) ? 'terrain' : 'network');
  const button=page.locator(`[data-tool="${key}"]`);await button.waitFor({state:'visible'});await button.click();
}
async function screen(page,point) {
  return page.evaluate(point=>{const p=(['Raise land','Lower land','Level land'].includes(document.querySelector('#active-tool-name').textContent)?transport.renderer.gridPointToScreen:transport.renderer.worldToScreen)(point.x,point.y),rect=document.querySelector('#world').getBoundingClientRect();return{x:p.x+rect.left,y:p.y+rect.top};},point);
}
async function snapshot(page,center) {
  return page.evaluate(center=>{
    const game=transport.game,tiles=[];
    for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++)tiles.push(structuredClone(game.tiles[(center.y+dy)*game.width+center.x+dx]));
    return{money:game.money,tiles};
  },center);
}
async function drag(page,a,b) {
  const from=await screen(page,a),to=await screen(page,b);
  for(const p of [from,to])await page.waitForFunction(p=>document.elementFromPoint(p.x,p.y)?.id==='world',p,{timeout:5000});
  await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:8});return()=>page.mouse.up();
}

try {
  for(const profile of [{name:'desktop',width:1440,height:960,dpr:1},{name:'desktop-hidpi',width:1440,height:960,dpr:2}]){
    if(process.env.TRANSPORT_PROFILE&&process.env.TRANSPORT_PROFILE!==profile.name)continue;
    const context=await browser.newContext({viewport:{width:profile.width,height:profile.height},deviceScaleFactor:profile.dpr});
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(`${profile.name}: ${error.message}`));
    await page.goto(url);await createWorldFromMenu(page);
    const center=await fixture(page),point=(dx,dy)=>({x:center.x+dx,y:center.y+dy});
    await choose(page,'level');assert.equal(await page.locator('#active-tool-name').innerText(),'Level land');
    assert.match(await page.locator('#active-tool-hint').innerText(),/area.*first point/i);
    assert.equal(await page.locator('.sidebar').evaluate(el=>el.classList.contains('drawer-open')),false,'choosing Level returns to the map');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);

    // A complex diagonal slope rejects the complete ordinary road gesture.
    await choose(page,'road');const beforeRoad=await snapshot(page,center);
    let release=await drag(page,point(-1,0),point(1,0));
    assert.match(await page.locator('#placement-tip').innerText(),/Level this slope first/);
    assert.equal(await page.locator('#placement-tip').evaluate(el=>el.classList.contains('invalid')),true);
    await release();assert.deepEqual(await snapshot(page,center),beforeRoad,'rejected road changes neither terrain nor balance');

    // Reverse-direction drag proves that target height follows the gesture's
    // first grid point, while its footprint is a filled rectangle, not an L-shaped line.
    await choose(page,'level');
    const start=point(2,-2),end=point(-2,2),expected=await page.evaluate(async({start,end})=>{
      const points=[start];for(let y=Math.min(start.y,end.y);y<=Math.max(start.y,end.y);y++)for(let x=Math.min(start.x,end.x);x<=Math.max(start.x,end.x);x++)if(x!==start.x||y!==start.y)points.push({x,y});
      const quote=(await import('./model.js')).quoteTerraformLevel(transport.game,points);return{cost:quote.cost,level:quote.level,count:quote.placements.length};
    },{start,end});
    const beforeLevel=await snapshot(page,center);release=await drag(page,start,end);
    const tip=await page.locator('#placement-tip').innerText();assert.match(tip,/25 points/);assert.match(tip,new RegExp(`Level ${expected.level}\\b`));
    const quoted=Number(tip.match(/\$([\d,]+)/)?.[1].replaceAll(',',''));assert.equal(quoted,expected.cost);
    await page.screenshot({path:`${output}/${profile.name}-level-preview.png`});
    await release();
    const afterLevel=await snapshot(page,center);assert.equal(beforeLevel.money-afterLevel.money,expected.cost);
    assert.equal(await page.evaluate(({start,end,level})=>{
      for(let y=Math.min(start.y,end.y);y<=Math.max(start.y,end.y);y++)for(let x=Math.min(start.x,end.x);x<=Math.max(start.x,end.x);x++)if(transport.game.tiles[y*transport.game.width+x].elevation!==level/7)return false;return true;
    },{start,end,level:expected.level}),true,'all 25 selected grid points reach the quoted height');

    // The same road stroke becomes usable after the paid grading operation.
    await choose(page,'road');release=await drag(page,point(-1,0),point(1,0));
    assert.equal(await page.locator('#placement-tip').evaluate(el=>el.classList.contains('invalid')),false);await release();
    assert.equal(await page.evaluate(center=>[-1,0,1].every(dx=>transport.game.tiles[center.y*transport.game.width+center.x+dx].road),center),true);

    // Lowering one clear corner creates a lower target; the intervening road
    // must reject the whole leveling area, even when other cells are editable.
    await page.evaluate(start=>{const game=transport.game;game.tiles[start.y*game.width+start.x].elevation=3/7;game.revision++;},start);
    await choose(page,'level');const protectedBefore=await snapshot(page,center);release=await drag(page,start,end);
    assert.match(await page.locator('#placement-tip').innerText(),/Clear buildings|networks/);await release();
    assert.deepEqual(await snapshot(page,center),protectedBefore,'protected-area rejection is atomic');
    await page.evaluate(()=>{transport.setTool('inspect');return transport.persist();});
    assert.equal(await page.locator('#save-status').innerText(),'Saved just now');
    const saved=await snapshot(page,center);await page.reload();await loadAutosaveFromMenu(page);
    await page.evaluate(center=>{transport.setSpeed(0);transport.renderer.setZoom(1);transport.renderer.focus(center.x,center.y);},center);
    assert.deepEqual((await snapshot(page,center)).tiles,saved.tiles,'graded land and roads survive actual local-storage reload');
    await page.screenshot({path:`${output}/${profile.name}-graded-road.png`});
    await context.close();
    console.log(`${profile.name}: Level tool, mouse rectangle, exact quote/payment, protected rejection, slope rejection/graded road and local-storage reload passed`);
  }
  assert.deepEqual(errors,[]);
} finally { await browser.close(); }
