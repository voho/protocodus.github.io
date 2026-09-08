import assert from 'node:assert/strict';

const {chromium}=await import(process.env.ASHLINE_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.ASHLINE_BROWSER||'chrome',headless:true});
const url=process.env.ASHLINE_URL||'http://127.0.0.1:4173/fun/ashline/';
const errors=[];
const queue=(page,id)=>page.evaluate(id=>ashline.state.entities.find(e=>e.id===id).queue.map(q=>q.type),id);
const ready=(page,type,disabled,reason='')=>page.waitForFunction(({type,disabled,reason})=>{
  const button=document.querySelector(`[data-type="${type}"]`);
  return button&&button.disabled===disabled&&button.dataset.reason===reason;
},{type,disabled,reason});

try{
  for(const race of ['organics','aiUnity']){
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    page.on('pageerror',e=>errors.push(`${race}: ${e.message}`));
    await page.goto(url);await page.waitForFunction(()=>window.ashline?.booted);
    await page.locator('#player-race').selectOption(race);await page.locator('#deploy').click();
    const fixture=await page.evaluate(async()=>{
      const m=await import('./sim.js'),s=ashline.state;
      s.aiTeams=[];s.teams[0].credits=30000;s.terrain.fill(0);s.minerals.fill(0);s.mineralTypes.fill(0);s.navVersion++;
      s.visible[0].fill(1);s.explored[0].fill(1);s.entities=s.entities.filter(e=>e.kind==='building');
      const core=s.entities.find(e=>e.team===0&&m.buildingRole(e)==='core');
      const build=role=>{
        const type=m.raceBuilding(s,0,role);
        for(let y=core.y-12;y<core.y+13;y++)for(let x=core.x-12;x<core.x+14;x++)if(m.canPlace(s,0,type,x,y).ok){
          const e=m.getEntity(s,m.placeBuilding(s,0,type,x,y).id);e.progress=1;e.hp=e.maxHp;return e;
        }
        throw Error(`No site for ${type}`);
      };
      build('barracks');const first=build('factory'),second=build('factory'),basic=build('factory');build('lab');
      s.teams[0].research={gridEfficiency:true,advancedBallistics:true};
      for(const factory of [first,second]){
        factory.upgrades={advancedProduction:true};
        for(let i=0;i<6;i++){const result=m.trainUnit(s,0,m.raceUnit(s,0,'tank'),factory.id);if(!result.ok)throw Error(result.reason);}
      }
      ashline.view.selected.clear();
      return {first:first.id,second:second.id,basic:basic.id,striker:m.raceUnit(s,0,'striker'),engineer:m.raceUnit(s,0,'engineer'),strikerCost:m.UNITS[m.raceUnit(s,0,'striker')].cost};
    });
    if(await page.locator('#command-console').isHidden())await page.locator('#command-toggle').click();
    await page.locator('#train-tab').click();

    await ready(page,fixture.striker,true,'Production queues full');
    assert.equal((await queue(page,fixture.basic)).length,0,'An idle basic foundry does not make advanced production available');
    assert.match(await page.locator(`[data-type=${fixture.striker}]`).getAttribute('aria-label'),/Production queues full/);

    await page.evaluate(id=>ashline.state.entities.find(e=>e.id===id).queue.pop(),fixture.first);
    await ready(page,fixture.striker,false);
    const credits=await page.evaluate(()=>ashline.state.teams[0].credits);
    await page.locator(`[data-type=${fixture.striker}]`).click();
    assert.equal((await queue(page,fixture.first)).at(-1),fixture.striker,'Freeing one eligible bay routes advanced recruitment there');
    assert.equal((await queue(page,fixture.second)).length,6);
    assert.equal((await queue(page,fixture.basic)).length,0,'Automatic advanced production never uses a basic foundry');
    assert.equal(await page.evaluate(()=>ashline.state.teams[0].credits),credits-fixture.strikerCost);
    await ready(page,fixture.striker,true,'Production queues full');

    await page.evaluate(({first,basic})=>{
      ashline.state.entities.find(e=>e.id===first).queue.pop();ashline.view.selected=new Set([basic]);
    },fixture);
    await ready(page,fixture.striker,true,'Requires Advanced assembly bay');
    assert.match(await page.locator('#production-target').textContent(),new RegExp(`#${fixture.basic}`));
    await ready(page,fixture.engineer,false);
    await page.locator(`[data-type=${fixture.engineer}]`).click();
    assert.deepEqual(await queue(page,fixture.basic),[fixture.engineer],'Selecting a basic foundry still recruits its compatible units');
    assert.equal((await queue(page,fixture.first)).length,5,'Explicit selection does not silently redirect an incompatible unit');

    await page.evaluate(id=>{ashline.view.selected=new Set([id]);},fixture.first);
    await ready(page,fixture.striker,false);
    await page.locator(`[data-type=${fixture.striker}]`).click();
    assert.equal((await queue(page,fixture.first)).at(-1),fixture.striker,'An explicitly selected upgraded foundry accepts advanced recruitment');
    assert.deepEqual(await queue(page,fixture.basic),[fixture.engineer]);
    await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log('Production UI checks passed for Organics and AI Unity: full eligible bays, newly freed slots, correct automatic routing, explicit basic/upgraded selection and exact recruitment charges.');
}finally{await browser.close();}
