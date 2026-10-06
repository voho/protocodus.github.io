// Exercise real startup and local-world replacement in an isolated browser.
// Request gates and quota injection never touch the player's browser storage.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const {chromium}=await import(process.env.TRANSPORT_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.TRANSPORT_BROWSER||'chrome',headless:true});
const url=process.env.TRANSPORT_URL||'http://127.0.0.1:8765/fun/transport/';
const output=process.env.TRANSPORT_SCREENSHOTS||'/tmp/transport-loading-screen';
await mkdir(output,{recursive:true});
const errors=[],results=[];

async function observe(page){
  await page.addInitScript(()=>{
    window.loadingQA={paints:[],states:[]};
    const read=()=>{
      const screen=document.querySelector('#loading-screen'),progress=document.querySelector('#loading-progress');
      if(!screen)return null;
      return{visible:!screen.hidden&&screen.getClientRects().length>0,title:document.querySelector('#loading-title')?.textContent,status:document.querySelector('#loading-status')?.textContent,inert:document.querySelector('#app')?.inert,progress:progress?.value,max:progress?.max};
    };
    document.addEventListener('DOMContentLoaded',()=>{
      new MutationObserver(()=>{const state=read();if(state)loadingQA.states.push(state);}).observe(document.body,{attributes:true,childList:true,subtree:true,characterData:true});
      function painted(){const state=read();if(state?.visible)loadingQA.paints.push(state);requestAnimationFrame(painted);}
      requestAnimationFrame(painted);
    });
  });
}
async function ready(page){
  await page.waitForFunction(()=>window.transport?.renderer&&document.querySelector('#loading-screen')?.hidden,{},{timeout:60000});
  assert.equal(await page.locator('#app').evaluate(el=>el.inert),false);
  await page.evaluate(()=>transport.setSpeed(0));
}
async function reset(page){await page.evaluate(()=>{loadingQA.states=[];loadingQA.paints=[];});}
async function completedOperation(page,label){
  const state=await page.evaluate(()=>loadingQA);
  assert.ok(state.paints.some(p=>p.visible&&p.inert),`${label} has a painted blocking loading frame`);
  assert.ok(state.states.some(p=>p.visible&&p.status?.trim()),`${label} announces its status`);
  assert.ok(state.states.filter(p=>p.visible).every(p=>p.progress>=0&&p.progress<=p.max),`${label} has valid progress`);
  results.push({label,paintedFrames:state.paints.length,statuses:[...new Set(state.states.filter(p=>p.visible).map(p=>p.status))]});
}

try{
  const context=await browser.newContext({viewport:{width:1280,height:900},deviceScaleFactor:1});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await observe(page);
  let releaseImport;const importGate=new Promise(resolve=>releaseImport=resolve);
  await page.route('**/app.js',async route=>{await importGate;await route.continue();});
  await page.goto(url,{waitUntil:'commit'});
  await page.locator('#start-menu').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>Boolean(window.transport)),false,'opening the menu does not start a company');
  await reset(page);await page.locator('#start-create').click();
  await page.locator('#loading-screen').waitFor({state:'visible'});
  assert.equal(await page.locator('#app').evaluate(el=>el.inert),true,'the loading screen blocks the app before app.js is available');
  assert.ok((await page.locator('#loading-title').innerText()).trim());
  assert.ok((await page.locator('#loading-status').innerText()).trim());
  assert.equal(await page.evaluate(()=>Boolean(window.transport)),false);
  await page.screenshot({path:`${output}/initial-loading.png`});
  releaseImport();await ready(page);await completedOperation(page,'initial startup');
  await page.screenshot({path:`${output}/ready.png`});

  // Actual named-save loading must show the overlay before decode/restore,
  // including when the underlying save manager is itself a modal dialog.
  await page.locator('#game-menu-button').click();await page.locator('#save-button').click();await page.locator('#save-new-name').fill('Loading check');await page.locator('#save-new-button').click();
  const card=page.locator('.save-card').filter({has:page.getByRole('heading',{name:'Loading check',exact:true})});
  await card.waitFor();await card.locator('[data-save-action="load"]').click();await reset(page);
  await card.locator('[data-save-confirm="load"]').click();await ready(page);
  await page.locator('#modal').waitFor({state:'hidden'});await completedOperation(page,'named save');

  // A failed autosave commit leaves the active company and existing save intact.
  await page.locator('#game-menu-button').click();await page.locator('#world-button').click();
  await page.locator('#start-world-form [name="size"]').selectOption('square512');
  await page.locator('.start-advanced summary').click();await page.locator('#start-world-form [name="seed"]').fill('581234');
  const before=await page.evaluate(()=>{
    window.loadingOriginalSetItem=Storage.prototype.setItem;
    window.loadingOriginalGame=transport.game;
    Storage.prototype.setItem=function(key,value){if(key==='transport-save-v1')throw new DOMException('Injected quota failure','QuotaExceededError');return loadingOriginalSetItem.call(this,key,value);};
    return{seed:transport.game.seed,autosave:localStorage.getItem('transport-save-v1')};
  });
  await reset(page);await page.locator('#start-create').click();
  await page.waitForFunction(()=>document.querySelector('#start-message')?.textContent.includes('Could not save'),{},{timeout:60000});
  await page.locator('#loading-screen').waitFor({state:'hidden'});await completedOperation(page,'recoverable storage failure');
  assert.equal(await page.locator('#app').evaluate(el=>el.inert),true,'the recoverable menu keeps the old game blocked');
  assert.equal(await page.locator('#start-menu').isVisible(),true);
  assert.equal(await page.evaluate(()=>transport.game===loadingOriginalGame),true);
  assert.equal(await page.evaluate(()=>localStorage.getItem('transport-save-v1')),before.autosave);
  assert.equal(await page.locator('#start-create').isEnabled(),true,'failed generation remains retryable');
  await page.screenshot({path:`${output}/recoverable-failure.png`});

  await page.evaluate(()=>{Storage.prototype.setItem=loadingOriginalSetItem;});await reset(page);
  await page.locator('#start-create').click();
  await page.waitForFunction(()=>window.transport?.game.seed===581234,{},{timeout:60000});await ready(page);
  await completedOperation(page,'new world retry');assert.equal(await page.locator('#start-menu').count(),0);
  assert.notEqual(await page.evaluate(()=>localStorage.getItem('transport-save-v1')),before.autosave);
  await context.close();

  const retryContext=await browser.newContext({viewport:{width:1280,height:900},deviceScaleFactor:2,reducedMotion:'reduce'});
  const retryPage=await retryContext.newPage();retryPage.on('pageerror',error=>errors.push(error.message));
  let releaseRetry,failImport=true;const retryGate=new Promise(resolve=>releaseRetry=resolve);
  await retryPage.route('**/app.js',async route=>{await retryGate;if(failImport){failImport=false;await route.abort();}else await route.continue();});
  await retryPage.goto(url,{waitUntil:'commit'});await retryPage.locator('#start-menu').waitFor({state:'visible'});
  const retrySeed=Number(await retryPage.locator('#start-world-form [name="seed"]').inputValue());
  await retryPage.locator('#start-create').click();await retryPage.locator('#loading-screen').waitFor({state:'visible'});
  const retryLayout=await retryPage.evaluate(()=>{
    const screen=document.querySelector('#loading-screen'),box=screen.getBoundingClientRect();
    const title=document.querySelector('#loading-title').getBoundingClientRect(),status=document.querySelector('#loading-status').getBoundingClientRect();
    return{width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,box:{x:box.x,y:box.y,width:box.width,height:box.height},title:{left:title.left,right:title.right,top:title.top,bottom:title.bottom},status:{left:status.left,right:status.right,top:status.top,bottom:status.bottom},animations:screen.getAnimations({subtree:true}).filter(a=>a.playState==='running').length};
  });
  assert.equal(retryLayout.scroll,retryLayout.width);assert.ok(retryLayout.box.width>=retryLayout.width&&retryLayout.box.height>=retryLayout.height);
  for(const rect of [retryLayout.title,retryLayout.status])assert.ok(rect.left>=0&&rect.right<=retryLayout.width&&rect.top>=0&&rect.bottom<=retryLayout.height);
  assert.equal(retryLayout.animations,0,'reduced motion disables the loading animation');
  await retryPage.screenshot({path:`${output}/desktop-reduced-motion.png`});releaseRetry();
  await retryPage.locator('#loading-retry').waitFor({state:'visible'});assert.match(await retryPage.locator('#loading-title').innerText(),/couldn.t start/i);
  assert.equal(await retryPage.locator('#app').evaluate(el=>el.inert),true);
  await retryPage.screenshot({path:`${output}/desktop-startup-failure.png`});await retryPage.locator('#loading-retry').click();
  await retryPage.locator('#start-menu').waitFor({state:'visible'});await retryPage.locator('#start-load').click();
  await retryPage.locator('#start-saves .start-save').first().click();await ready(retryPage);
  assert.equal(await retryPage.evaluate(()=>transport.game.seed),retrySeed,'retry can load the company created before its module failed');
  await retryContext.close();
  assert.deepEqual(errors,[]);console.log(JSON.stringify({results,retryLayout,output},null,2));
}finally{await browser.close();}
