import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.ASHLINE_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.ASHLINE_BROWSER||'chrome',headless:true});
const url=process.env.ASHLINE_URL||'http://127.0.0.1:4173/fun/ashline/';
const output=process.env.ASHLINE_SCREENSHOTS||'/tmp/ashline-races-qa';await mkdir(output,{recursive:true});
const errors=[];
const advance=(page,seconds)=>page.evaluate(async seconds=>{const {updateGame}=await import('./sim.js');for(let i=0;i<seconds*4;i++)updateGame(ashline.state,.25);},seconds);
try {
  for(const [race,viewport,dpr] of [['organics',{width:1440,height:900},1],['aiUnity',{width:1440,height:900},1],['aiUnity',{width:390,height:844},2]]){
    const mobile=viewport.width<680,page=await browser.newPage({viewport,deviceScaleFactor:dpr,isMobile:mobile,hasTouch:mobile});page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);await page.waitForFunction(()=>window.ashline?.booted);
    await page.locator('#player-race').selectOption(race);await page.locator('#enemy-race').selectOption(race==='aiUnity'?'organics':'aiUnity');
    await page.locator('#deploy').click();
    const roles=await page.evaluate(async()=>{const m=await import('./sim.js'),s=ashline.state;s.ai.nextThink=1e9;s.teams[0].credits=20000;return {name:m.RACES[m.teamRace(s,0)].name,core:m.raceBuilding(s,0,'core'),barracks:m.raceBuilding(s,0,'barracks'),rifle:m.raceUnit(s,0,'rifle'),factory:m.raceBuilding(s,0,'factory'),lab:m.raceBuilding(s,0,'lab'),labName:m.BUILDINGS[m.raceBuilding(s,0,'lab')].name,engineer:m.raceUnit(s,0,'engineer')};});
    assert.equal(await page.evaluate(()=>ashline.state.teams[0].race),race);
    if(await page.locator('#command-console').isHidden())await page.locator('#command-toggle').click();
    assert.equal(await page.locator('#catalog .build-card').count(),9);
    assert(await page.locator(`[data-type=${roles.barracks}]`).count());
    await page.locator('#research-tab').click();assert((await page.locator('#production-target').innerText()).includes(roles.labName.toUpperCase()));await page.locator('#build-tab').click();
    const ids=await page.evaluate(async roles=>{const m=await import('./sim.js'),s=ashline.state,core=s.entities.find(e=>e.team===0&&e.type===roles.core),ids={};
      s.visible[0].fill(1);s.explored[0].fill(1);s.fogClock=1e7;
      for(const type of [roles.barracks,roles.factory,roles.lab,m.raceBuilding(s,0,'reactor')]){
        let result;for(let y=core.y-9;y<core.y+11&&!result;y++)for(let x=core.x-9;x<core.x+12&&!result;x++)if(m.canPlace(s,0,type,x,y).ok)result=m.placeBuilding(s,0,type,x,y);
        if(!result?.ok)throw Error(`Cannot construct${type}`);const e=m.getEntity(s,result.id);e.progress=1;e.hp=e.maxHp;ids[type]=e.id;m.updateGame(s,.05);
      }return ids;},roles);
    await page.locator('#train-tab').click();assert.equal(await page.locator('#catalog .build-card').count(),8);
    await page.locator(`[data-type=${roles.rifle}]`).click();await advance(page,6);
    assert(await page.evaluate(type=>ashline.state.entities.filter(e=>e.team===0&&e.type===type).length>=4,roles.rifle));
    await page.locator(`[data-type=${roles.engineer}]`).click();await advance(page,12);
    assert(await page.evaluate(type=>ashline.state.entities.some(e=>e.team===0&&e.type===type),roles.engineer));
    await page.evaluate(id=>{ashline.view.selected=new Set([id]);},ids[roles.factory]);await page.waitForTimeout(200);await page.locator('#upgrade-building').click();
    assert.equal(await page.locator('[data-upgrade]').count(),3);await page.locator('[data-research=vehicleWeapons]').click();await advance(page,36);await page.waitForTimeout(200);
    assert.equal(await page.evaluate(()=>ashline.state.teams[0].research.vehicleWeapons),true);
    // A legal wall drag previews and purchases an actual contiguous line for either race.
    const line=await page.evaluate(async()=>{const {planWallLine,buildingRole}=await import('./sim.js'),s=ashline.state,c=s.entities.find(e=>e.team===0&&buildingRole(e)==='core');
      for(let y=c.y-6;y<c.y+9;y++)for(let x=c.x-7;x<c.x+9;x++){const p=planWallLine(s,0,x,y,x+3,y);if(!p.ok||p.count!==4)continue;const a=ashline.renderer.worldToScreen(x+.5,y+.5,ashline.view),b=ashline.renderer.worldToScreen(x+3.5,y+.5,ashline.view);if(a.x>25&&a.y>150&&b.x<innerWidth-20&&b.y<innerHeight-260)return {x,y,a,b};}return null;});
    if(line){
      await page.locator('#build-tab').click();await page.locator('[data-type=wall]').click();if(await page.locator('#command-console').isVisible())await page.locator('#command-close').click();
      let touch;
      if(mobile){
        touch=await page.context().newCDPSession(page);await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[line.a]});
        for(let step=1;step<=8;step++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:line.a.x+(line.b.x-line.a.x)*step/8,y:line.a.y+(line.b.y-line.a.y)*step/8}]});
      }else{await page.mouse.move(line.a.x,line.a.y);await page.mouse.down();await page.mouse.move(line.b.x,line.b.y,{steps:8});}
      await page.waitForTimeout(200);assert.match(await page.locator('#order-hint').innerText(),/4 SEGMENTS/);
      await page.screenshot({path:`${output}/wall-preview-${race}-${viewport.width}.png`});
      if(touch)await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.mouse.up();
      assert.equal(await page.evaluate(({x,y})=>ashline.state.entities.filter(e=>e.team===0&&e.type==='wall'&&e.y===y&&e.x>=x&&e.x<x+4).length,line),4);
      if(mobile){
        const credits=await page.evaluate(()=>{const before=ashline.state.teams[0].credits;ashline.state.teams[0].credits=39;return before;});await page.waitForTimeout(200);
        await page.locator('#cancel-order').tap();assert.equal(await page.evaluate(()=>ashline.view.placement),null);assert(await page.locator('#order-hint').isHidden());
        assert.equal(await page.evaluate(()=>ashline.state.entities.filter(e=>e.type==='wall'&&e.team===0).length),4,'Touch cancel spends nothing and adds no segment at an unaffordable balance');
        await page.evaluate(value=>{ashline.state.teams[0].credits=value;},credits);
      }else await page.keyboard.press('Escape');
    }else assert.fail('Desktop and touch fixtures should have a visible wall line');
    await page.evaluate(()=>{ashline.state.fogClock=0;});await page.locator('#pause').click();await page.locator('#save-game').click();assert.match(await page.locator('#save-status').innerText(),/^Operation saved/);await page.locator('#load-game').click();assert.equal(await page.evaluate(()=>ashline.state.teams[0].race),race);await page.locator('#resume').click();
    if(await page.locator('#command-console').isVisible())await page.locator('#command-close').click();await page.keyboard.press('Space');
    await page.screenshot({path:`${output}/${race}-${viewport.width}.png`});await page.close();
  }
  assert.deepEqual(errors,[]);console.log('Race UI passed for both sides and mobile: own catalogs, production, technology, upgrades, wall drags and saved identity.');
}finally{await browser.close();}
