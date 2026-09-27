// Optional UI QA: set ASHLINE_PLAYWRIGHT, ASHLINE_URL and ASHLINE_SCREENSHOTS.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser=await chromium.launch({channel:process.env.ASHLINE_BROWSER || 'chrome',headless:true});
const output=process.env.ASHLINE_SCREENSHOTS || '/tmp/ashline-stance-qa';
await mkdir(output,{recursive:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:900},hasTouch:true}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(process.env.ASHLINE_URL || 'http://127.0.0.1:8140/fun/ashline/');
  await page.waitForFunction(()=>window.ashline?.booted);await page.evaluate(async()=>(await import('./assets.js')).startAssets());
  await page.locator('#seed').fill('STANCE-BROWSER');await page.locator('#deploy').click();
  await page.waitForFunction(()=>ashline.state&&!ashline.loading&&!ashline.paused,null,{timeout:120000});
  await page.evaluate(()=>{window.stanceFixture={raf:requestAnimationFrame};requestAnimationFrame=frame=>{stanceFixture.frame=frame;return 0;};});
  await page.waitForFunction(()=>Boolean(stanceFixture.frame));
  const ids=await page.evaluate(async()=>{
    const {UNITS,updateGame,unitStats}=await import('./sim.js'),s=ashline.state,r=ashline.renderer,v=ashline.view;
    const template=structuredClone(s.entities.find(e=>e.kind==='unit'));
    s.ai.nextThink=1e12;s.entities=s.entities.filter(e=>e.kind==='building');s.terrain.fill(0);s.minerals.fill(0);s.effects=[];s.navVersion++;
    const add=(type,x,y,team=0)=>{
      const d=UNITS[type],u={...structuredClone(template),id:s.nextId++,type,team,x,y,angle:0,size:d.size,hp:d.hp,maxHp:d.hp,order:{type:'idle'},path:[],targetId:null,moving:false,tech:[]};
      for(const key of ['pathGoal','yieldPoint','yieldReturn','yieldFor','yieldWaiting','passUntil','passTargetId','moveSpeed','turnVelocity','trafficWait','trafficBlockedAt','avoidUntil','stance','defendAnchor','retaliationTargetId','defendReturning'])delete u[key];
      if(d.damage>0)u.stance='guard';
      s.entities.push(u);return u;
    };
    const rifle=add('rifle',94,74),tank=add('tank',98,76),engineer=add('engineer',94,79),enemy=add('tank',120,70,1);
    Object.assign(v,{x:96,y:75.5,zoom:38});v.selected.clear();s.visible[0].fill(1);s.explored[0].fill(1);
    document.querySelector('#command-console').hidden=true;r.createTerrain(s);
    stanceFixture.add=add;stanceFixture.units=[rifle,tank,engineer];
    stanceFixture.advance=seconds=>{for(let i=0;i<Math.round(seconds*20);i++)updateGame(s,.05);r.draw(s,v);};
    stanceFixture.rangeSample=()=>{
      const circles=[],arc=r.ctx.arc;
      r.ctx.arc=function(x,y,radius,...args){
        const unit=s.entities.find(u=>u.kind==='unit'&&Math.abs(u.x*32-x)<1e-8&&Math.abs(u.y*32-y)<1e-8&&radius>80);
        if(unit){const m=this.getTransform();circles.push({id:unit.id,radius,screenRadius:radius*Math.hypot(m.a,m.b)/r.dpr,screenRadiusY:radius*Math.hypot(m.c,m.d)/r.dpr,expected:unitStats(unit).range*v.zoom});}
        return arc.call(this,x,y,radius,...args);
      };
      try{r.draw(s,v);}finally{r.ctx.arc=arc;}
      return circles;
    };
    stanceFixture.advance(0);
    return {rifle:rifle.id,tank:tank.id,engineer:engineer.id,enemy:enemy.id,building:s.entities.find(e=>e.kind==='building'&&e.team===0).id};
  });
  const select=async selected=>{
    await page.evaluate(async selected=>(await import('./control-groups.js')).assignControlGroup(ashline.state,selected,1),selected);
    await page.keyboard.press('1');await page.evaluate(()=>stanceFixture.advance(0));
  };
  const state=()=>page.evaluate(()=>stanceFixture.units.map(u=>({id:u.id,stance:u.stance,order:u.order.type})));
  const clickWorld=async(x,y,touch=false)=>{
    const p=await page.evaluate(({x,y})=>{const p=ashline.renderer.worldToScreen(x,y,ashline.view),r=document.querySelector('#world').getBoundingClientRect();return{x:p.x+r.left,y:p.y+r.top};},{x,y});
    if(touch){await page.locator('#move-order').tap();await page.touchscreen.tap(p.x,p.y);}else await page.mouse.click(p.x,p.y,{button:'right'});
  };
  const checkRanges=async expected=>{
    const circles=await page.evaluate(()=>stanceFixture.rangeSample());
    assert.deepEqual(circles.map(c=>c.id).sort((a,b)=>a-b),[...expected].sort((a,b)=>a-b),'Only selected friendly armed units show range circles');
    for(const c of circles)assert(Math.abs(c.screenRadius-c.expected)<.0001&&Math.abs(c.screenRadiusY-c.expected)<.0001,`Firing range matches world distance on both axes (${c.screenRadius} vs ${c.expected} pixels)`);
  };
  const setZoom=async index=>page.evaluate(async index=>{
    const {zoomLevels}=await import('./camera.js'),{spriteNativeZoom}=await import('./assets.js');
    ashline.view.zoom=zoomLevels(spriteNativeZoom(ashline.renderer.dpr))[index];
    stanceFixture.advance(0);
  },index);

  await select([ids.rifle]);
  assert(await page.locator('#unit-stance').isVisible());
  assert.equal(await page.locator('#stance-guard').getAttribute('aria-pressed'),'true');
  assert.match(await page.locator('#stance-status').textContent(),/^Guard/);
  await checkRanges([ids.rifle]);
  await page.screenshot({path:`${output}/guard-desktop.png`});
  await page.locator('#stance-defend').click();
  assert.equal((await state()).find(u=>u.id===ids.rifle).stance,'defend');
  assert.match(await page.locator('#stance-status').textContent(),/^Defend/);
  await page.evaluate(()=>stanceFixture.advance(0));await page.screenshot({path:`${output}/defend-desktop.png`});
  await clickWorld(101,73);
  assert.equal(await page.locator('#stance-status').textContent(),'Guard now · Defend when idle');
  assert.equal(await page.locator('#stance-defend').getAttribute('aria-pressed'),'true','The selected button still shows the persistent idle preference');
  await page.evaluate(()=>stanceFixture.advance(0));await page.screenshot({path:`${output}/defend-command-desktop.png`});
  await page.evaluate(()=>stanceFixture.advance(20));await select([ids.rifle]);
  assert.equal((await state()).find(u=>u.id===ids.rifle).order,'idle');
  assert.match(await page.locator('#stance-status').textContent(),/^Defend/,'Defend becomes effective when the movement command finishes');

  await select([ids.rifle,ids.tank]);
  for(const stance of ['guard','defend'])assert.equal(await page.locator(`#stance-${stance}`).getAttribute('aria-pressed'),'mixed','Mixed preferences remain visible in a mixed selection');
  assert.equal(await page.locator('#stance-status').textContent(),'1 Defend · 1 Guard');
  await checkRanges([ids.rifle,ids.tank]);await page.screenshot({path:`${output}/stances-mixed-desktop.png`});
  await page.locator('#stance-guard').click();assert((await state()).filter(u=>u.id!==ids.engineer).every(u=>u.stance==='guard'));
  await page.locator('#stance-defend').click();assert((await state()).filter(u=>u.id!==ids.engineer).every(u=>u.stance==='defend'));
  await clickWorld(104,77);assert.equal(await page.locator('#stance-status').textContent(),'Guard now · Defend when idle');
  await page.keyboard.press('h');assert.match(await page.locator('#stance-status').textContent(),/^Defend/,'Stop restores the chosen idle preference');

  for(const id of [ids.engineer,ids.building]){await select([id]);assert(await page.locator('#unit-stance').isHidden(),'Unarmed units and structures do not expose military stances');await checkRanges([]);}
  await select([ids.rifle,ids.engineer]);await page.locator('#stance-defend').click();
  assert.equal((await state()).find(u=>u.id===ids.engineer).stance,undefined,'Applying a stance to a mixed group leaves support units alone');
  await checkRanges([ids.rifle]);
  await page.locator('#pause').click();
  for(const stance of ['guard','defend'])assert(await page.locator(`#stance-${stance}`).isDisabled(),'Paused stance controls are disabled');
  await page.locator('#resume').click();
  await select([ids.rifle]);
  await setZoom(0);await checkRanges([ids.rifle]);await page.screenshot({path:`${output}/range-minimum-desktop.png`});
  await setZoom(4);await checkRanges([ids.rifle]);
  await page.evaluate(id=>{ashline.view.selected=new Set([id]);ashline.state.visible[0].fill(0);},ids.enemy);
  await checkRanges([]);

  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>new Promise(resolve=>stanceFixture.raf.call(window,()=>stanceFixture.raf.call(window,resolve))));
  await page.evaluate(()=>{Object.assign(ashline.view,{x:99,y:75,zoom:24});ashline.state.visible[0].fill(1);});
  await select([ids.rifle]);await setZoom(2);await checkRanges([ids.rifle]);await page.screenshot({path:`${output}/defend-unit-mobile.png`});
  await setZoom(0);await checkRanges([ids.rifle]);await page.screenshot({path:`${output}/range-minimum-mobile.png`});
  await page.evaluate(()=>{ashline.view.zoom=24;});
  await select([ids.rifle,ids.tank]);
  await page.locator('#stance-guard').tap();assert.equal(await page.locator('#stance-guard').getAttribute('aria-pressed'),'true');
  await page.locator('#stance-defend').tap();assert.equal(await page.locator('#stance-defend').getAttribute('aria-pressed'),'true');
  await checkRanges([ids.rifle,ids.tank]);await page.screenshot({path:`${output}/defend-mobile.png`});
  await clickWorld(100,73,true);
  assert.equal(await page.locator('#stance-status').textContent(),'Guard now · Defend when idle');
  await page.evaluate(()=>stanceFixture.advance(0));await page.screenshot({path:`${output}/defend-command-mobile.png`});
  const layout=await page.evaluate(()=>{
    const rect=id=>{const r=document.querySelector(id).getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    return {guard:rect('#stance-guard'),defend:rect('#stance-defend'),panel:rect('#selection-panel'),army:rect('#select-army'),scroll:document.documentElement.scrollWidth,width:innerWidth,height:innerHeight};
  });
  for(const button of [layout.guard,layout.defend])assert(button.width>=40&&button.height>=40&&button.x>=0&&button.right<=layout.width&&button.bottom<=layout.height,'Stance buttons stay visible and usable on touch screens');
  assert(layout.army.bottom<=layout.panel.y,'The Army button stays above the expanded selection panel');
  assert(layout.scroll<=layout.width,'The mobile controls do not cause horizontal overflow');

  await page.setViewportSize({width:1440,height:900});
  await page.evaluate(()=>new Promise(resolve=>stanceFixture.raf.call(window,()=>stanceFixture.raf.call(window,resolve))));
  const army=await page.evaluate(()=>{
    const s=ashline.state,v=ashline.view;
    const units=Array.from({length:36},(_,i)=>stanceFixture.add(i%2?'rifle':'tank',91+i%6*1.5,70+Math.floor(i/6)*1.5));
    Object.assign(v,{x:96,y:74.5,zoom:38});s.visible[0].fill(1);return units.map(u=>u.id);
  });
  await select(army);await checkRanges(army);await page.screenshot({path:`${output}/army-ranges-desktop.png`});
  assert.deepEqual(errors,[]);
  console.log(`Stance browser check passed: Guard/Defend preferences, active-command override, mixed/support selections, paused controls, exact range circles, fog privacy and mobile layout. Screenshots: ${output}`);
}finally{await browser.close();}
