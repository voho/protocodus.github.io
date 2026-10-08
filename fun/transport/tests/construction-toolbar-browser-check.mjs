// Direct desktop construction tools and selected-road/rail stop placement.
// Every context starts through the game menu with isolated browser storage.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWorldFromMenu } from './browser-start.mjs';

const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-construction-toolbar-qa';
await mkdir(output, { recursive:true });
const errors = [], results = [];
const tools = ['road', 'rail', 'stop', 'bulldoze'];
const shortcuts = { road:'R', rail:'T', stop:'S', bulldoze:'X' };
const toolButton = (page, tool) => page.locator(`.topbar [data-toolbar-tool="${tool}"]`);
const settle = page => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
const state = page => page.evaluate(() => ({
  day:transport.game.day, money:transport.game.money, expenses:transport.game.totalExpenses,
  stations:transport.game.stations.length, routes:transport.game.routes.length, revision:transport.game.revision,
}));
const saveValid = page => page.evaluate(async () => (await import('./model.js')).validateGame(transport.game));
const goalState = page => page.locator('#objective-card').evaluate(card => ({
  hidden:card.hidden, collapsed:card.classList.contains('collapsed'), open:card.classList.contains('open'),
  preference:localStorage.getItem('transport-next-goal-v2'), layers:localStorage.getItem('transport-visibility-v1'),
}));

async function pressed(page, expected) {
  assert.deepEqual(await page.locator('.topbar [data-toolbar-tool]').evaluateAll(buttons => buttons.filter(button => button.getAttribute('aria-pressed') === 'true').map(button => button.dataset.toolbarTool)), expected ? [expected] : [], 'the toolbar shows exactly the active construction tool');
}

async function layout(page, width) {
  const controls = await page.locator('.topbar [data-toolbar-tool], .topbar [data-open-gallery]').evaluateAll(buttons => buttons.map(button => {
    const rect=button.getBoundingClientRect(),style=getComputedStyle(button),at=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
    const visible=node=>{if(!node)return false;const bounds=node.getBoundingClientRect(),style=getComputedStyle(node);return bounds.width>1&&bounds.height>1&&style.display!=='none'&&style.visibility==='visible'&&Number(style.opacity)>0;};
    const hits=[rect.left+3,rect.right-3].map(x=>{const target=document.elementFromPoint(x,rect.y+rect.height/2);return target===button||button.contains(target);});
    return { tool:button.dataset.toolbarTool||'gallery',left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height,visible:style.visibility==='visible'&&style.display!=='none',hit:at===button||button.contains(at),edgeHits:hits,hitElement:at?.outerHTML.slice(0,500),icon:visible(button.querySelector('svg')),label:visible(button.querySelector('.nav-label')) };
  }));
  if(controls.some(control=>!control.hit||control.edgeHits.includes(false))){
    await page.screenshot({path:`${output}/toolbar-obstructed-${width}.png`});
    await writeFile(`${output}/toolbar-obstructed-${width}.json`,JSON.stringify(controls,null,2));
  }
  assert.equal(controls.length, 5, 'all four tools and Gallery are direct topbar controls');
  for (const control of controls) {
    assert.equal(control.visible, true, `${width}px ${control.tool} is visible`);
    assert.ok(control.left>=-.5&&control.right<=width+.5&&control.top>=-.5, `${width}px ${control.tool} stays in the viewport`);
    assert.ok(control.width>=32&&control.height>=30, `${width}px ${control.tool} remains an easy pointer target`);
    assert.equal(control.hit, true, `${width}px ${control.tool} is not covered by another control`);
    assert.deepEqual(control.edgeHits,[true,true], `${width}px ${control.tool} is fully visible and clickable at both edges`);
    assert.ok(control.icon||control.label, `${width}px ${control.tool} has a visible icon or label`);
    if(control.tool==='gallery')assert.equal(control.label,true, `${width}px Gallery keeps its visible name`);
    else {
      assert.equal(control.icon,true, `${width}px ${control.tool} keeps its identifying icon`);
      assert.equal(control.label,width>=1024, `${width}px ${control.tool} keeps a readable desktop and laptop name or the narrow-window icon fallback`);
    }
  }
  assert.equal(await page.locator('#game-menu [data-open-gallery]').count(), 0, 'Gallery stays on the main toolbar');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth+1), true, `${width}px header adds no horizontal page overflow`);
  return controls;
}

async function financeLayouts(page, width) {
  const profit=page.locator('#profit'),original=await profit.textContent(),world=await state(page),variants=[];
  await page.evaluate(()=>document.fonts.ready);
  try{
    // Legitimate profit displays must not resize the unrelated first-row tools.
    for(const value of ['+$0','-$27','-$120,000','-$1,200,000']){
      await profit.evaluate((node,value)=>{node.textContent=value;},value);await settle(page);
      const controls=await layout(page,width),header=await page.locator('.topbar').boundingBox(),lower=await page.locator('#company-stats, #profit, .topbar [data-speed], #date').evaluateAll(nodes=>nodes.map(node=>{
        const box=node.getBoundingClientRect(),at=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);
        return {control:node.id||`speed-${node.dataset.speed}`,rect:box.toJSON(),hit:at===node||node.contains(at),hitElement:at?.outerHTML.slice(0,500)};
      }));
      if(lower.some(control=>!control.hit||control.rect.top<header.y-.5||control.rect.bottom>header.y+header.height+.5)){
        await page.screenshot({path:`${output}/finance-obstructed-${width}.png`});
        await writeFile(`${output}/finance-obstructed-${width}.json`,JSON.stringify({value,header,lower},null,2));
      }
      for(const control of lower){
        assert.equal(control.hit,true,`${value} leaves ${control.control} accessible`);
        assert.ok(control.rect.top>=header.y-.5&&control.rect.bottom<=header.y+header.height+.5,`${value} keeps ${control.control} inside the header`);
      }
      assert.deepEqual(controls.map(({tool,left,right})=>({tool,left,right})),variants[0]?.positions||controls.map(({tool,left,right})=>({tool,left,right})),'finance text does not move the construction toolbar');
      variants.push({value,positions:controls.map(({tool,left,right})=>({tool,left,right})),lower});
      await page.screenshot({path:`${output}/toolbar-finance-${variants.length}-${width}.png`});
    }
  }finally{await profit.evaluate((node,value)=>{node.textContent=value;},original);}
  assert.deepEqual(await state(page),world,'finance display fixtures leave the company unchanged');
  return variants;
}

async function explore(page) {
  if (await page.locator('#active-tool-bar').isVisible()) await page.locator('#cancel-tool-button').click();
  if (await page.locator('.sidebar').getAttribute('aria-hidden') === 'false') await page.locator('#close-management').click();
  if (await page.locator('#inspector').isVisible()) await page.locator('#inspector .tiny-button').click();
  await page.locator('#world').focus();
  await pressed(page, null);
}

async function fixture(page) {
  return page.evaluate(async () => {
    const game=transport.game,{releaseTerrainObjects}=await import('./terrain-objects.js'),{buildPlan}=await import('./construction-plan.js'),{validateGame}=await import('./model.js');
    let origin;
    for(let y=32;y<game.height-40&&!origin;y+=24)for(let x=32;x<game.width-40;x+=28){
      if(![...game.cities,...game.industries,...game.stations].some(site=>site.x>=x-8&&site.x<=x+28&&site.y>=y-8&&site.y<=y+28)){origin={x,y};break;}
    }
    if(!origin)throw Error('No clear construction toolbar fixture');
    const {x,y}=origin,points=[],collar=[];
    for(let dy=-3;dy<=20;dy++)for(let dx=-3;dx<=24;dx++)points.push({x:x+dx,y:y+dy});
    // Nature parcels beside the flattened region also use its corner heights.
    for(let dy=-4;dy<=21;dy++)for(let dx=-4;dx<=25;dx++)collar.push({x:x+dx,y:y+dy});
    releaseTerrainObjects(game,collar);
    for(const point of points)Object.assign(game.tiles[point.y*game.width+point.x],{terrain:'grass',detail:'',elevation:.2,variant:0,road:false,rail:false,bridge:false,tunnel:false,publicRoad:false,building:null,zone:null});
    game.money=1_000_000;game.revision++;game.networkRevision++;
    const road=Array.from({length:9},(_,dx)=>({x:x+dx,y})),rail=Array.from({length:9},(_,dx)=>({x:x+dx,y:y+8})),crossing={x:x+14,y:y+14};
    for(const [kind,line] of [['road',road],['rail',rail],['road',[crossing]],['rail',[crossing]]]){
      const built=buildPlan(game,kind,line);if(!built.ok)throw Error(`Could not build ${kind} fixture: ${built.message}`);
    }
    if(!validateGame(game))throw Error('The construction toolbar fixture must be save-valid.');
    transport.renderer.setZoom(2);
    return { road:{x:x+4,y},rail:{x:x+4,y:y+8},crossing };
  });
}

async function pickNetwork(page, point, expectedModes) {
  await explore(page);
  const at=await page.evaluate(point=>{
    transport.renderer.focus(point.x,point.y);
    const box=document.querySelector('#world').getBoundingClientRect(),screen=transport.renderer.worldToScreen(point.x,point.y);
    return {x:box.left+screen.x,y:box.top+screen.y};
  },point);
  await settle(page);
  await page.waitForFunction(at=>document.elementFromPoint(at.x,at.y)?.id==='world',at);
  await page.mouse.click(at.x,at.y);
  await page.locator('#inspector').waitFor({state:'visible'});
  assert.equal(await page.locator('#inspector-title').textContent(), expectedModes.includes('road')?'Road':'Railway', 'the actual map click selects the network tile');
  assert.equal(await page.locator('#inspector [data-inspector-gallery]').isVisible(), true, 'selected infrastructure includes its Gallery information');
  assert.deepEqual(await page.locator('#inspector [data-build-selected-stop]').evaluateAll(buttons=>buttons.map(button=>button.dataset.buildSelectedStop)), expectedModes, 'the selected network offers only matching stop types');
}

async function openCurrentStop(page, stop, mode) {
  await explore(page);
  const at=await page.evaluate(stop=>{
    const renderer=transport.renderer;renderer.focus(stop.x,stop.y);renderer.render(performance.now(),{});
    const box=document.querySelector('#world').getBoundingClientRect(),marker=renderer.stationMarker(stop);
    return {x:box.left+marker.x,y:box.top+marker.y};
  },stop);
  await settle(page);await page.mouse.click(at.x,at.y);
  await page.locator('#station-route').waitFor({state:'visible'});
  assert.equal(await page.locator('#inspector-title').textContent(),stop.name,'an existing stop opens its current inspector');
  assert.equal(await page.locator('#inspector [data-build-selected-stop]').count(),0,'an existing stop never offers another stop on the occupied tile');
  assert.equal(await page.locator('#inspector-gallery-object-heading').textContent(),mode==='rail'?'Rail station':'Road stop');
  assert.equal(await page.locator('#inspector .inspector-station-art').getAttribute('data-infrastructure-sprite'),mode==='rail'?'train-stop':'bus-stop','the inspector uses the matching station artwork');
}

async function buildSelectedStop(page, point, mode, expectedModes, suffix) {
  await pickNetwork(page,point,expectedModes);
  const before=await state(page),quote=await page.evaluate(async({point,mode})=>{
    const {quoteBuildPlan}=await import('./construction-plan.js');
    const result=quoteBuildPlan(transport.game,mode==='rail'?'train-stop':'bus-stop',[point],{preferredMode:mode});
    if(!result.ok)throw Error(result.message);
    const tile=transport.game.tiles[point.y*transport.game.width+point.x];
    return {cost:result.cost,network:{road:tile.road,rail:tile.rail}};
  },{point,mode});
  const button=page.locator(`#inspector [data-build-selected-stop="${mode}"]`),label=await button.innerText();
  assert.match(label,mode==='rail'?/Build rail station/:/Build road stop/);
  assert.equal(Number(label.match(/\$([\d,]+)/)?.[1].replaceAll(',','')),quote.cost,'the selected-tile action shows the full construction quote');
  assert.equal(await button.isDisabled(),false);
  await button.click();
  await page.locator('[data-construction-next="route"]').waitFor({state:'visible'});
  const built=await page.evaluate(point=>{
    const game=transport.game,tile=game.tiles[point.y*game.width+point.x];
    return {stop:game.stations.find(stop=>stop.x===point.x&&stop.y===point.y),network:{road:tile.road,rail:tile.rail}};
  },point);
  assert.ok(built.stop,'the action immediately places a stop on the selected tile');
  assert.equal(built.stop.mode,mode,'the action uses the selected road or rail mode');
  assert.deepEqual(built.network,quote.network,'placing the stop preserves the existing network, including crossings');
  const after=await state(page);
  assert.equal(after.money,before.money-quote.cost,'construction spends exactly its displayed quote');
  assert.equal(after.stations,before.stations+1);assert.equal(after.routes,before.routes,'placing a stop does not launch a service');
  assert.equal(await saveValid(page),true,'immediate stop construction leaves a save-valid world');
  await pressed(page,null);
  assert.equal(await page.locator('#inspector').isHidden(),true,'successful construction returns to Build');
  await page.screenshot({path:`${output}/built-${suffix}.png`});
  await page.locator('[data-construction-next="route"]').click();
  assert.equal(await page.locator('#route-form [name="from"]').inputValue(),String(built.stop.id),'the next route is prefilled with the opened stop');
  assert.equal(await page.locator('#route-form [name="mode"]').inputValue(),mode);
  assert.equal(await page.locator('#route-forecast').isVisible(),true);
  await page.locator('#route-back').click();
  await openCurrentStop(page,built.stop,mode);
  await page.screenshot({path:`${output}/selected-${suffix}.png`});
  await page.locator('#inspector .tiny-button').click();await page.locator('#world').focus();await page.keyboard.press('Control+z');
  const undone=await state(page);
  assert.equal(undone.money,before.money,'Undo refunds the full selected-stop quote');
  assert.equal(undone.expenses,before.expenses,'Undo restores construction expenses');
  assert.equal(undone.stations,before.stations,'Undo removes the opened stop');
  assert.deepEqual(await page.evaluate(point=>{const tile=transport.game.tiles[point.y*transport.game.width+point.x];return {road:tile.road,rail:tile.rail};},point),quote.network,'Undo retains the pre-existing road and railway');
  assert.equal(await saveValid(page),true,'full selected-stop Undo leaves a save-valid world');
  return {mode,cost:quote.cost,point};
}

try {
  const profiles=[{name:'desktop',width:1440,height:1000,density:1},{name:'laptop',width:1024,height:768,density:1.25},{name:'narrow',width:520,height:760,density:2}],requested=process.env.TRANSPORT_PROFILE;
  assert.ok(!requested||profiles.some(profile=>profile.name===requested),'TRANSPORT_PROFILE names desktop, laptop or narrow');
  for(const profile of profiles){
    if(requested&&requested!==profile.name)continue;
    const context=await browser.newContext({viewport:{width:profile.width,height:profile.height},deviceScaleFactor:profile.density,reducedMotion:'reduce'}),page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    await page.goto(url);await createWorldFromMenu(page,{generationVersion:10});
    await page.evaluate(()=>document.querySelector('#dismiss-objective')?.click());
    await explore(page);
    const controls=await layout(page,profile.width);
    const finance=await financeLayouts(page,profile.width);
    if(profile.width===1440){for(const width of [1366,1280,1241,1240,1181,1100,1024]){await page.setViewportSize({width,height:1000});await layout(page,width);if(width===1241)await financeLayouts(page,width);await page.screenshot({path:`${output}/toolbar-${width}.png`});}await page.setViewportSize({width:1440,height:1000});}
    const initial=await state(page);
    for(const goal of ['open','folded']){
      await page.locator(goal==='open'?'#objective-chip':'#dismiss-objective').click();
      const beforeGoal=await goalState(page);
      assert.equal(beforeGoal.collapsed,goal==='folded','the goal starts in the requested state');
      for(const tool of tools){
        const button=toolButton(page,tool);assert.equal(await button.getAttribute('aria-keyshortcuts'),shortcuts[tool]);
        await button.click();await pressed(page,tool);
        assert.equal(await page.locator('#active-tool-bar').isVisible(),true);assert.equal(await page.evaluate(()=>document.activeElement?.id),'world','direct tools focus the map');
        assert.equal(await page.locator('#objective-card').isVisible(),false,`${tool} instructions get the shared map-side space without a goal underneath`);
        assert.deepEqual(await goalState(page),beforeGoal,`${tool} temporarily hiding the goal preserves its ${goal} state and display setting`);
        assert.deepEqual(await state(page),initial,'choosing a direct tool only changes the active UI');
        await page.locator('#cancel-tool-button').click();await pressed(page,null);
        assert.equal(await page.locator('#active-tool-bar').isVisible(),false,'finishing construction removes its instructions');
        assert.deepEqual(await goalState(page),beforeGoal,'the reopened Build drawer preserves the goal state');
        await page.locator('#close-management').click();
        assert.equal(await page.locator('#objective-card').isVisible(),true,'the goal returns when construction and its drawer finish');
        assert.deepEqual(await goalState(page),beforeGoal,`the restored goal keeps its ${goal} state and display setting`);
      }
    }
    await toolButton(page,'road').focus();await page.keyboard.press('Space');await pressed(page,'road');
    await toolButton(page,'rail').focus();await page.keyboard.press('Enter');await pressed(page,'rail');
    assert.equal(await page.evaluate(()=>transport.speed),0,'toolbar keyboard activation leaves the paused clock unchanged');
    for(const tool of tools){await page.locator('#world').focus();await page.keyboard.press(shortcuts[tool].toLowerCase());await pressed(page,tool);}
    assert.deepEqual(await state(page),initial,'keyboard shortcuts select tools without construction');
    const gallery=page.locator('.topbar [data-open-gallery]');await gallery.focus();await page.keyboard.press('Enter');
    await page.locator('#gallery-search').waitFor({state:'visible'});await page.locator('#gallery-search').fill('rail station');
    await page.locator('#modal [data-gallery-entry="transport:train-stop"]').waitFor({state:'visible'});
    await page.screenshot({path:`${output}/gallery-${profile.width}.png`});
    await page.keyboard.press('Escape');await page.locator('#modal').waitFor({state:'hidden'});
    await page.waitForFunction(()=>document.activeElement?.matches('.topbar [data-open-gallery]'));
    assert.deepEqual(await state(page),initial,'browsing the Gallery does not modify the world');
    await explore(page);await page.screenshot({path:`${output}/toolbar-${profile.width}.png`});
    const sites=await fixture(page),placements=[];
    placements.push(await buildSelectedStop(page,sites.road,'road',['road'],`road-${profile.width}`));
    placements.push(await buildSelectedStop(page,sites.rail,'rail',['rail'],`rail-${profile.width}`));
    placements.push(await buildSelectedStop(page,sites.crossing,'road',['road','rail'],`crossing-road-${profile.width}`));
    placements.push(await buildSelectedStop(page,sites.crossing,'rail',['road','rail'],`crossing-rail-${profile.width}`));
    results.push({...profile,controls,finance,placements});await context.close();
  }
  assert.deepEqual(errors,[],'the toolbar, contextual stop actions and Gallery raise no browser errors');
  await writeFile(`${output}/results.json`,JSON.stringify({results,errors},null,2));
  console.log(JSON.stringify({profiles:results.map(({width,density,placements})=>({width,density,placements:placements.length})),checks:'direct tools, keyboard state, Gallery focus, selected-network quotes, immediate placement, current-stop inspector, route handoff, crossings, Undo and save validity',errors},null,2));
} finally { await browser.close(); }
