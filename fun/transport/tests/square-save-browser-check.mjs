// Run against the repository server. This uses real Chromium localStorage and
// releases each 4-million-cell company before loading the next one.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.TRANSPORT_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.TRANSPORT_BROWSER||'chrome',headless:true,args:['--js-flags=--expose-gc']});
const url=process.env.TRANSPORT_URL||'http://127.0.0.1:8765/fun/transport/';
try {
  const context=await browser.newContext();
  const page=await context.newPage();
  await page.route('**/__transport-save-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Square save fixture</title>'}));
  await page.goto(new URL('/__transport-save-fixture',url).href);
  const result=await page.evaluate(async()=>{
    const model=await import('/fun/transport/model.js');
    const slots=await import('/fun/transport/save-slots.js');
    const codec=await import('/fun/transport/save-codec.js');
    const plans=await import('/fun/transport/construction-plan.js');
    const check=(condition,message)=>{if(!condition)throw Error(message);};
    const hash=text=>{let a=2166136261,b=0;for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b,31)+text.charCodeAt(i)|0;}return `${a>>>0}:${b>>>0}`;};
    const fingerprint=game=>{
      // Hash every field of every cell, preserving nested future/ownership data.
      let a=2166136261,b=0;
      for(const tile of game.tiles){const text=JSON.stringify(Object.keys(tile).sort().map(key=>[key,tile[key]]));for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b,31)+text.charCodeAt(i)|0;}}
      const {tiles,maintenanceRevision,...state}=game;
      state.routes=state.routes.map(({pathRevision,...route})=>route);
      return {tiles:`${a>>>0}:${b>>>0}`,state:hash(JSON.stringify(state))};
    };
    const release=()=>{if(typeof gc==='function')gc();};
    const timings=[],expected=[],ids=[];
    let autosaveBytes;
    for(const [biome,seed] of [['taiga',81392],['desert',29193]]){
      let start=performance.now(),game=model.createGame({biome,seed,size:'square2048'});
      const created=performance.now()-start;
      game.money=50_000_000;
      const town=game.cities[0];
      const construction=plans.buildPlan(game,'rail',Array.from({length:180},(_,n)=>({x:town.x+n,y:town.y+8})));
      check(construction.built>50,'developed world has a real rail corridor');
      model.tick(game,365.25);
      // Stress a century-scale number of distributed nature changes without
      // speeding up actual gameplay or materializing a duplicate whole world.
      let altered=0;
      for(let n=123;altered<100_000&&n<game.tiles.length;n+=29){const t=game.tiles[n];if(t.road||t.rail||t.building||t.terrain==='water')continue;t.detail=t.detail==='deadwood'?'shrubs':'deadwood';altered++;}
      check(altered===100_000,'stress edits span the full continent');
      check(model.validateGame(game),'developed state validates');
      const encoded=codec.encodeGame(game);
      check(encoded.format==='transport-procedural-v1','uses sparse procedural format');
      check(encoded.tiles.count>=100_000,'all distant edits captured');
      expected.push(fingerprint(game));
      if(ids.length===0){start=performance.now();check(model.saveGame(game).ok,'2048 autosave fits native storage');timings.push({operation:'autosave',ms:performance.now()-start});autosaveBytes=localStorage.getItem(model.SAVE_KEY);}
      start=performance.now();const saved=await slots.writeSaveSlot(game,{name:`Developed ${biome} 2048`});
      check(saved.ok,saved.message);ids.push(saved.id);
      timings.push({biome,createMs:created,saveMs:performance.now()-start,changed:encoded.tiles.count,autosaveChars:JSON.stringify(encoded).length,slotChars:localStorage.getItem(slots.SAVE_SLOT_PREFIX+saved.id).length});
      game=null;release();
    }
    check(localStorage.getItem(model.SAVE_KEY)===autosaveBytes,'manual slots preserve autosave');
    const storageBytes=Object.keys(localStorage).reduce((sum,key)=>sum+2*(key.length+localStorage.getItem(key).length),0);
    check(storageBytes<5*1024*1024,'autosave and two developed 2048 worlds fit conservative 5 MiB');
    let start=performance.now();const listing=slots.listSaveSlots();
    timings.push({operation:'list',ms:performance.now()-start});
    check(listing.slots.length===3&&listing.slots.every(s=>s.status==='ready'),'all three worlds listed');
    for(let i=0;i<ids.length;i++){
      start=performance.now();let loaded=await slots.readSaveSlot(ids[i]);
      check(loaded.ok,loaded.message);timings.push({operation:'load',index:i,ms:performance.now()-start});
      check(JSON.stringify(fingerprint(loaded.game))===JSON.stringify(expected[i]),'every tile and company field round-trips');
      model.tick(loaded.game,1.5);check(model.validateGame(loaded.game),'simulation resumes after large restore');
      check(codec.encodeGame(loaded.game).format==='transport-procedural-v1','loaded world keeps sparse baseline');
      loaded=null;release();
    }
    let loaded=model.loadGame();check(loaded&&JSON.stringify(fingerprint(loaded))===JSON.stringify(expected[0]),'autosave restores original developed company');loaded=null;release();
    return {storageBytes,timings};
  });
  assert.ok(result.storageBytes<5*1024*1024);
  console.log(JSON.stringify(result,null,2));
  console.log('Square save browser check passed: native autosave and two developed 2048² slots, all-cell round trips and resumed simulation.');
}finally{await browser.close();}
