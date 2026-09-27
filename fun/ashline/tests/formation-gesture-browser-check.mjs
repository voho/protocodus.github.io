// Optional real-pointer QA: use ASHLINE_PLAYWRIGHT, ASHLINE_URL and ASHLINE_SCREENSHOTS.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium} = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({channel:process.env.ASHLINE_BROWSER || 'chrome',headless:true});
const output=process.env.ASHLINE_SCREENSHOTS || '/tmp/ashline-formation-gesture-qa';
await mkdir(output,{recursive:true});
const angleDistance=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
try {
  const page=await browser.newPage({viewport:{width:1440,height:900},hasTouch:true}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(process.env.ASHLINE_URL || 'http://127.0.0.1:8000/fun/ashline/');
  await page.waitForFunction(()=>window.ashline?.booted);
  await page.evaluate(async()=>(await import('./assets.js')).startAssets());
  await page.locator('#seed').fill('FORMATION-GESTURES');await page.locator('#deploy').click();
  await page.waitForFunction(()=>ashline.state&&!ashline.loading&&!ashline.paused,null,{timeout:120000});
  await page.evaluate(()=>{window.gestureFixture={raf:requestAnimationFrame};requestAnimationFrame=frame=>{gestureFixture.frame=frame;return 0;};});
  await page.waitForFunction(()=>Boolean(gestureFixture.frame));
  const setup=()=>page.evaluate(async()=>{
    const {UNITS,updateGame}=await import('./sim.js'),s=ashline.state,v=ashline.view,r=ashline.renderer;
    const template=structuredClone(s.entities.find(e=>e.kind==='unit'));
    s.ai.nextThink=1e12;s.terrain.fill(0);s.minerals.fill(0);s.effects=[];s.navVersion++;
    s.entities=s.entities.filter(e=>e.kind==='building');s.visible[0].fill(1);s.explored[0].fill(1);
    const units=[[86,72],[91,72],[86,76],[91,76]].map(([x,y])=>{
      const d=UNITS.tank,u={...structuredClone(template),id:s.nextId++,type:'tank',team:0,x,y,angle:0,size:d.size,hp:d.hp,maxHp:d.hp,order:{type:'idle'},path:[],targetId:null,moving:false};
      for(const key of ['pathGoal','yieldPoint','yieldReturn','yieldFor','yieldWaiting','passUntil','passTargetId','moveSpeed','turnVelocity','trafficWait','trafficBlockedAt','avoidUntil'])delete u[key];
      s.entities.push(u);return u;
    });
    Object.assign(v,{x:95,y:75,zoom:38,formationPreview:null});v.selected=new Set(units.map(u=>u.id));
    document.querySelector('#command-console').hidden=true;r.createTerrain(s);
    gestureFixture.units=units;
    gestureFixture.advance=seconds=>{
      for(let i=0;i<Math.round(seconds*20);i++) {
        updateGame(s,.05);
        for(let a=0;a<units.length;a++)for(let b=0;b<a;b++)if(Math.hypot(units[a].x-units[b].x,units[a].y-units[b].y)<(units[a].size+units[b].size)*.43-.01)throw Error('Formation gesture caused intersecting bodies');
      }
      r.draw(s,v);return units.map(u=>({id:u.id,x:u.x,y:u.y,angle:u.angle,order:u.order}));
    };
    gestureFixture.advance(0);
    return units.map(u=>({id:u.id,x:u.x,y:u.y}));
  });
  const point=(x,y)=>page.evaluate(({x,y})=>{
    const p=ashline.renderer.worldToScreen(x,y,ashline.view),rect=document.querySelector('#world').getBoundingClientRect();return{x:p.x+rect.x,y:p.y+rect.y};
  },{x,y});
  const orders=()=>page.evaluate(()=>gestureFixture.units.map(u=>({id:u.id,...u.order})));
  const start=async()=>{const p=await point(101,75);await page.mouse.move(p.x,p.y);await page.mouse.down({button:'right'});};
  const drag=async heading=>{const p=await point(101+Math.cos(heading)*2.5,75+Math.sin(heading)*2.5);await page.mouse.move(p.x,p.y,{steps:3});};
  const preview=()=>page.evaluate(()=>{ashline.renderer.draw(ashline.state,ashline.view);return ashline.view.formationPreview;});

  await setup();
  const rally=await point(101,75);await page.mouse.click(rally.x,rally.y,{button:'right'});
  assert((await orders()).every(o=>o.formation?.compact),'A quick right-click creates compact rally slots');
  await page.waitForTimeout(220);
  assert.equal(await preview(),null,'A quick right-click leaves no formation preview');

  const sources=await setup();await page.screenshot({path:`${output}/formation-source.png`});
  await start();await page.waitForTimeout(220);
  let p=await preview();assert(p,'Holding right-click reveals the current formation before dragging');
  assert(angleDistance(p.angle,0)<1e-8,'Holding without dragging preserves the source orientation');
  assert((await orders()).every(o=>o.type==='idle'),'Previewing issues no unit orders');
  for(const heading of [0,Math.PI/2,Math.PI,Math.PI*1.5,Math.PI*1.99,Math.PI*2]) {
    await drag(heading);p=await preview();
    assert(angleDistance(p.angle,heading)<.012,`The preview rotates through every quadrant and the 360-degree seam (requested ${heading}, got ${p.angle})`);
    for(let i=0;i<sources.length;i++)for(let j=0;j<i;j++) {
      assert(Math.abs(Math.hypot(p.positions[i].x-p.positions[j].x,p.positions[i].y-p.positions[j].y)-Math.hypot(sources[i].x-sources[j].x,sources[i].y-sources[j].y))<1e-8,'Rotation preserves the source formation and gaps');
    }
    if(heading===Math.PI/2||heading===Math.PI*1.5)await page.screenshot({path:`${output}/formation-preview-${Math.round(heading*180/Math.PI)}.png`});
  }
  await drag(Math.PI/2);p=await preview();
  await page.evaluate(async()=>{
    const {zoomLevels}=await import('./camera.js'),{spriteNativeZoom}=await import('./assets.js');
    gestureFixture.zoom=ashline.view.zoom;ashline.view.zoom=zoomLevels(spriteNativeZoom(ashline.renderer.dpr))[0];ashline.renderer.draw(ashline.state,ashline.view);
  });
  await page.screenshot({path:`${output}/formation-preview-minimum-zoom.png`});
  await page.evaluate(()=>{ashline.view.zoom=gestureFixture.zoom;});
  await page.mouse.up({button:'right'});
  const committed=await orders();
  assert.equal(await preview(),null,'Release removes the preview');
  for(const order of committed) {
    const slot=p.positions.find(u=>u.id===order.id);
    assert(Math.hypot(order.x-slot.x,order.y-slot.y)<1e-8,'Release commits the previewed rotated destination');
    assert.equal(order.formation?.compact,false,'Held drag preserves the formation instead of compacting');
    assert(angleDistance(order.facing,Math.PI/2)<1e-8,'Release stores the selected final facing');
  }
  await page.evaluate(()=>gestureFixture.advance(4));await page.screenshot({path:`${output}/formation-moving.png`});
  const arrived=await page.evaluate(()=>gestureFixture.advance(56));
  for(const unit of arrived) {
    const slot=committed.find(o=>o.id===unit.id);
    assert.equal(unit.order.type,'idle','Rotated formation arrives within60 seconds');
    assert(Math.hypot(unit.x-slot.x,unit.y-slot.y)<=.081,'Each unit reaches its exact previewed slot');
    assert(angleDistance(unit.angle,Math.PI/2)<1e-8,'Each unit finishes facing the selected direction');
  }
  await page.screenshot({path:`${output}/formation-arrived.png`});

  // Source units can keep moving while the player holds a preview. Their
  // destination shape is the snapshot at right-down, not their later positions.
  await setup();await start();await drag(Math.PI);
  const frozen=await preview();
  await page.evaluate(()=>{gestureFixture.units[0].x+=1;gestureFixture.units[1].y+=1;});
  await page.mouse.up({button:'right'});
  for(const order of await orders()) {
    const slot=frozen.positions.find(u=>u.id===order.id);
    assert(Math.hypot(order.x-slot.x,order.y-slot.y)<1e-8,'Release keeps the source snapshot used in the preview');
  }

  await setup();await page.evaluate(()=>gestureFixture.units.forEach(u=>{u.angle=Math.PI/4;}));
  await start();await drag(Math.PI/2);
  assert(angleDistance((await preview()).angle,Math.PI/4)<1e-8,'The drag heading rotates relative to the source army facing');
  await page.mouse.up({button:'right'});

  await setup();await start();await drag(Math.PI/2);
  const casualty=await page.evaluate(()=>{const unit=gestureFixture.units[0];unit.hp=0;return unit.id;});
  await drag(Math.PI/2+.1);
  const survivors=await preview();assert.equal(survivors.positions.length,3,'Dead units disappear from the held preview');
  assert(!survivors.positions.some(u=>u.id===casualty));
  await page.mouse.up({button:'right'});
  for(const order of (await orders()).filter(o=>o.id!==casualty)) {
    const slot=survivors.positions.find(u=>u.id===order.id);
    assert(Math.hypot(order.x-slot.x,order.y-slot.y)<1e-8,'Survivors keep their previewed offsets when a selected unit is lost');
  }

  await setup();await start();await drag(Math.PI/2);
  const obstruction=await page.evaluate(()=>{
    const p=ashline.view.formationPreview.positions[0],s=ashline.state;
    s.terrain[Math.floor(p.y)*s.width+Math.floor(p.x)]=1;s.navVersion++;
    gestureFixture.advance(.05);s.visible[0].fill(1);ashline.renderer.createTerrain(s);ashline.renderer.draw(s,ashline.view);
    return {id:p.id,x:p.x,y:p.y};
  });
  await page.screenshot({path:`${output}/formation-preview-obstructed.png`});
  await page.mouse.up({button:'right'});
  const adjusted=(await orders()).find(o=>o.id===obstruction.id);
  assert(Math.hypot(adjusted.x-obstruction.x,adjusted.y-obstruction.y)>.01,'An obstructed preview slot receives a nearby legal destination');

  // The body can be visibly outside a rock cell while its reserved destination
  // clearance still touches it. Show the same adjustment warning before release.
  await setup();
  const clearanceUnit=await page.evaluate(()=>{
    const s=ashline.state,v=ashline.view,u=gestureFixture.units[0];
    v.selected=new Set([u.id]);Object.assign(v,{x:30,y:25.5});
    s.terrain[25*s.width+31]=1;s.navVersion++;gestureFixture.advance(.05);
    s.visible[0].fill(1);ashline.renderer.createTerrain(s);return u.id;
  });
  const clearancePoint=await point(30.75,25.5);
  await page.mouse.move(clearancePoint.x,clearancePoint.y);await page.mouse.down({button:'right'});await page.waitForTimeout(220);
  const clearancePreview=await preview();assert.equal(clearancePreview.positions.length,1);
  const drawsAdjustmentWarning=()=>page.evaluate(()=>{
    const r=ashline.renderer,labels=[],fillText=r.ctx.fillText;
    r.ctx.fillText=function(text,...args){labels.push(text);return fillText.call(this,text,...args);};
    try {r.draw(ashline.state,ashline.view);} finally {r.ctx.fillText=fillText;}
    return labels.includes('Blocked slots adjust');
  });
  assert(await drawsAdjustmentWarning(),'Preview warns when reserved body clearance reaches a visible adjacent rock');
  await page.screenshot({path:`${output}/formation-preview-clearance.png`});
  await page.evaluate(()=>{ashline.state.visible[0][25*ashline.state.width+31]=0;});
  assert.equal(await drawsAdjustmentWarning(),false,'The preview does not reveal an obstruction in a concealed cell');
  await page.evaluate(()=>{ashline.state.visible[0][25*ashline.state.width+31]=1;});
  await page.mouse.up({button:'right'});
  const clearanceOrder=(await orders()).find(o=>o.id===clearanceUnit),clearanceSlot=clearancePreview.positions[0];
  assert(Math.hypot(clearanceOrder.x-clearanceSlot.x,clearanceOrder.y-clearanceSlot.y)>.01,'The warned adjacent-rock slot is adjusted on release');

  await setup();
  const edge=await page.evaluate(()=>{
    const s=ashline.state,v=ashline.view,u=gestureFixture.units[0];v.selected=new Set([u.id]);
    Object.assign(v,{x:s.width-ashline.renderer.width/v.zoom/2,y:25.5});
    return {x:s.width-.25,y:25.5,id:u.id,width:s.width,margin:u.size*.43+.08};
  });
  const edgePoint=await point(edge.x,edge.y);
  await page.mouse.move(edgePoint.x,edgePoint.y);await page.mouse.down({button:'right'});await page.waitForTimeout(220);
  assert(await drawsAdjustmentWarning(),'The preview warns when a destination footprint crosses the map edge');
  await page.mouse.up({button:'right'});
  const edgeOrder=(await orders()).find(o=>o.id===edge.id);
  assert(edgeOrder.x<edge.width-edge.margin,'Releasing the edge preview reserves a destination with full map clearance');

  for(const reason of ['escape','pointercancel','pause','blur']) {
    await setup();await start();await drag(Math.PI/2);assert(await preview());
    if(reason==='escape')await page.keyboard.press('Escape');
    else if(reason==='pause')await page.keyboard.press('p');
    else if(reason==='pointercancel')await page.evaluate(()=>document.querySelector('#world').dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true})));
    else await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
    await page.mouse.up({button:'right'});
    assert.equal(await preview(),null,`${reason} removes the preview`);
    assert(await page.locator('#order-hint').isHidden(),`${reason} removes the formation hint`);
    assert((await orders()).every(o=>o.type==='idle'),`${reason} cancels without issuing a command`);
    if(reason==='blur'||reason==='pause') { await page.locator('#resume').click(); await page.waitForFunction(()=>!ashline.paused); }
  }

  await setup();
  const enemy=await page.evaluate(()=>{
    const s=ashline.state,u={...structuredClone(gestureFixture.units[0]),id:s.nextId++,team:1,x:101,y:75};s.entities.push(u);return u.id;
  });
  await page.mouse.click(rally.x,rally.y,{button:'right'});
  assert((await orders()).every(o=>o.type==='attack'&&o.targetId===enemy),'Quick right-click on an enemy remains attack');

  await setup();
  const producer=await page.evaluate(()=>{
    const s=ashline.state,b={...structuredClone(s.entities.find(e=>e.kind==='building')),id:s.nextId++,type:'barracks',team:0,x:88,y:72,size:3,progress:1,queue:[]};
    s.entities.push(b);ashline.view.selected=new Set([b.id]);return b.id;
  });
  await page.mouse.click(rally.x,rally.y,{button:'right'});
  const producerRally=await page.evaluate(id=>ashline.state.entities.find(e=>e.id===id).rally,producer);
  assert(Math.hypot(producerRally.x-101,producerRally.y-75)<1e-8,'Producer right-click remains a rally order');

  assert.deepEqual(errors,[]);
  console.log(`Formation gesture browser check passed: compact clicks, held previews, full-circle rotation, exact slots/facing, frozen source snapshot, cancellation, enemy attack and producer rally. Screenshots: ${output}`);
} finally {await browser.close();}
