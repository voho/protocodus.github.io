import assert from 'node:assert/strict';
const {chromium}=await import(process.env.ASHLINE_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.ASHLINE_BROWSER||'chrome',headless:true});
try{
  const page=await browser.newPage();
  await page.goto(process.env.ASHLINE_URL||'http://127.0.0.1:8000/fun/ashline/');
  await page.waitForFunction(()=>window.ashline?.booted);await page.locator('#deploy').click();
  const report=await page.evaluate(async()=>{
    const {BUILDINGS,raceBuilding}=await import('./sim.js'),{encodeGame,decodeGame}=await import('./save.js'),s=ashline.state;
    s.ai.nextThink=1e12;s.fogClock=1;s.visible[0].fill(1);s.explored[0].fill(1);
    const create=(role,x)=>{
      const type=raceBuilding(s,1,role);
      const d=BUILDINGS[type],e={id:s.nextId++,team:1,kind:'building',type,x,y:20,size:d.size,hp:d.hp,maxHp:d.hp,progress:1,angle:0,cooldown:0,order:{type:'idle'},path:[],repath:0,queue:[]};
      s.entities.push(e);return e;
    };
    const lab=create('lab',60),cap=create('capacitor',64);
    lab.research={id:'gridEfficiency',progress:.35};lab.upgrade={id:'speed',progress:.25};cap.reserve=333;s.navVersion++;
    ashline.renderer.draw(s,ashline.view);
    const before=[...ashline.renderer.rememberedBuildings.values()];
    const restored=decodeGame(encodeGame(s,{rememberedBuildings:before,knownOre:ashline.renderer.knownOre}));
    // Hide the facilities, then change live jobs and stored power. Memory must retain the observation.
    s.visible[0].fill(0);lab.research.progress=.85;lab.upgrade.progress=.95;cap.reserve=12;
    ashline.renderer.draw(s,ashline.view);
    const remembered=[...ashline.renderer.rememberedBuildings.values()],oldLab=remembered.find(e=>e.id===lab.id),oldCap=remembered.find(e=>e.id===cap.id);
    return{count:restored.rememberedBuildings.length,idleCount:restored.rememberedBuildings.filter(e=>e.research===null&&e.upgrade===null).length,labProgress:oldLab.research.progress,upgradeProgress:oldLab.upgrade.progress,reserve:oldCap.reserve,savedAgain:!!decodeGame(encodeGame(s,{rememberedBuildings:remembered,knownOre:ashline.renderer.knownOre})).game};
  });
  assert(report.count>=5,'Actual renderer records visible enemy structures');
  assert(report.idleCount>=4,'Idle structures carry the renderer’s explicit null project fields');
  assert.equal(report.labProgress,.35);assert.equal(report.upgradeProgress,.25);assert.equal(report.reserve,333);
  assert(report.savedAgain,'Remembered projects and reserve remain saveable after hidden live changes');
  console.log('Fog save browser checks passed: actual idle enemy snapshots, active research/upgrades, reserved power, null projects, and independent memory under fog.');
}finally{await browser.close();}
