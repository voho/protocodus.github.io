// Same deterministic flight on before/after servers. No synthetic frame-time assertions.
import {writeFile, mkdir} from 'node:fs/promises';
const {chromium} = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const url = process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/';
const out = process.env.TYRAN_PERF_OUTPUT || '/tmp/tyran-performance';
await mkdir(out,{recursive:true});
const browser = await chromium.launch({channel:'chrome',headless:true});
const page = await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:Number(process.env.TYRAN_DPR || 1)});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{let seed=7481;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};localStorage.setItem('tyran-muted','true');});
const cdp = await page.context().newCDPSession(page);
await cdp.send('Performance.enable');
const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
try {
  await page.goto(url);await page.waitForFunction(()=>window.tyran);
  await page.evaluate(async()=>{await tyran.world.art?.promise;});
  // JS time spent while a static title completely covers the game.
  const idleBefore=await metrics();await page.waitForTimeout(1500);const idleAfter=await metrics();
  await page.evaluate(async()=>{
    tyran.launch(6,{mode:2,upgrades:{weapon:6,shield:4,hull:4,recharge:4}});await tyran.world.art?.promise;
    const {spawnEnemy}=await import('./sim.js'),s=tyran.state;
    s.time=115;s.scroll=440;
    for(const p of s.players){p.hurt=1e8;}
    for(let i=0;i<18;i++){const e=spawnEnemy(s,i%9,80+(i%9)*(s.width-160)/8,150+Math.floor(i/9)*220);e.hp=e.maxHp=1e8;e.speed=0;}
    const boss=spawnEnemy(s,9,s.width/2,155);boss.hp=boss.maxHp=1e8;boss.age=4;
  });
  await page.keyboard.down('ControlLeft');await page.keyboard.down('ControlRight');
  await page.waitForTimeout(1200);
  await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:200});await cdp.send('Profiler.start');
  const before=await metrics();
  const frames=await page.evaluate(()=>new Promise(resolve=>{
    const samples=[];let previous=performance.now();
    function sample(t){samples.push(t-previous);previous=t;if(samples.length<180)requestAnimationFrame(sample);else resolve({samples,enemies:tyran.state.enemies.length,bullets:tyran.state.bullets.length,time:tyran.state.time,performance:tyran.performance??null});}requestAnimationFrame(sample);
  }));
  const after=await metrics();const {profile}=await cdp.send('Profiler.stop');
  frames.samples.shift();frames.samples.sort((a,b)=>a-b);
  const counts=new Map();for(const id of profile.samples||[])counts.set(id,(counts.get(id)||0)+1);
  const hot=profile.nodes.map(n=>({name:n.callFrame.functionName,url:n.callFrame.url.split('/').at(-1),samples:counts.get(n.id)||0})).filter(n=>n.url?.endsWith('.js')).sort((a,b)=>b.samples-a.samples).slice(0,14);
  const result={url,dpr:Number(process.env.TYRAN_DPR||1),frames:frames.samples.length,medianMs:frames.samples[89],p95Ms:frames.samples[170],over25ms:frames.samples.filter(n=>n>25).length,scriptMsPerFrame:(after.ScriptDuration-before.ScriptDuration)*1000/180,taskMsPerFrame:(after.TaskDuration-before.TaskDuration)*1000/180,layoutMs:(after.LayoutDuration-before.LayoutDuration)*1000,idleScriptMs:(idleAfter.ScriptDuration-idleBefore.ScriptDuration)*1000,enemies:frames.enemies,bullets:frames.bullets,performance:frames.performance,hot,errors};
  await page.screenshot({path:`${out}/busy-flight.png`});
  await writeFile(`${out}/profile.json`,JSON.stringify(profile));await writeFile(`${out}/results.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} finally {await browser.close();}
