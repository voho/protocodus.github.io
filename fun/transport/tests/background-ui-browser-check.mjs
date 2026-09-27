import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createWorldFromMenu,openGameAction} from './browser-start.mjs';
const {chromium}=await import(process.env.TRANSPORT_PLAYWRIGHT||'playwright');
const base=process.env.TRANSPORT_URL||'http://127.0.0.1:8765/fun/transport/';
const out=process.env.TRANSPORT_OUTPUT||'/tmp/transport-background-ui';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:process.env.TRANSPORT_BROWSER||'chrome',headless:true});
const errors=[],checks=[];
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',error=>errors.push(error.message));
 // Delay delivery of encode results, exercising real worker snapshots while
 // deterministically keeping an old save in flight across later user actions.
 await page.addInitScript(()=>{
  const NativeWorker=Worker;window.jobQA={delay:0,received:0};
  window.Worker=class extends NativeWorker{
   constructor(...args){super(...args);super.addEventListener('message',event=>{
    if(this.operation==='encode'&&event.data.result){jobQA.received++;setTimeout(()=>this.handler?.(event),jobQA.delay);}
    else this.handler?.(event);
   });}
   set onmessage(handler){this.handler=handler;}
   get onmessage(){return this.handler;}
   postMessage(data,...args){this.operation=data.operation;return super.postMessage(data,...args);}
  };
 });
 await page.goto(base);await createWorldFromMenu(page,{size:process.env.TRANSPORT_WORLD_SIZE||'square512'});
 await page.evaluate(async()=>{transport.game.money=345678;transport.game.revision++;await transport.persist();});
 const original=await page.evaluate(()=>({seed:transport.game.seed,raw:localStorage.getItem('transport-save-v1')}));
 await openGameAction(page,'world-button');await page.locator('[name=size]').selectOption('square2048');
 await page.locator('#start-create').click();await page.locator('#loading-cancel').waitFor();
 await page.screenshot({path:`${out}/cancellable-generation.png`});await page.locator('#loading-cancel').click();
 await page.waitForFunction(()=>document.querySelector('#start-message')?.textContent.includes('Cancelled'));
 assert.equal(await page.evaluate(()=>localStorage.getItem('transport-save-v1')),original.raw);
 assert.equal(await page.evaluate(()=>transport.game.seed),original.seed);
 await page.locator('#start-create').click();await page.locator('#loading-cancel').waitFor();await page.keyboard.press('Escape');
 await page.waitForFunction(()=>document.querySelector('#start-message')?.textContent.includes('Cancelled'));
 await page.locator('#start-resume').click();checks.push('Button and Escape cancel generation without replacing the world or autosave');
 const before=await page.evaluate(()=>{jobQA.delay=600;transport.game.money=111111;transport.game.revision++;window.firstSave=transport.persist();return jobQA.received;});
 await page.waitForFunction(before=>jobQA.received>before,before);
 await page.evaluate(async()=>{transport.game.money=222222;transport.game.revision++;await transport.persist();await firstSave;});
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('transport-save-v1')).state.money),222222);
 checks.push('Overlapping autosaves commit the latest snapshot');
 // A final page-leave flush must beat an already encoded, delayed old save.
 const received=await page.evaluate(()=>{transport.game.money=333333;transport.game.revision++;window.leavingSave=transport.persist();return jobQA.received;});
 await page.waitForFunction(value=>jobQA.received>value,received);
 await page.evaluate(()=>{transport.game.money=444444;transport.game.revision++;window.dispatchEvent(new Event('pagehide'));});
 await page.waitForTimeout(750);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('transport-save-v1')).state.money),444444);
 checks.push('Page-leave flush cancels stale worker writes');
 // During encoding the simulation must be running again, even with a delayed
 // result. Storage failure must preserve the complete previous checkpoint.
 const liveReceived=await page.evaluate(()=>{jobQA.delay=1200;transport.game.revision++;transport.setSpeed(1);window.liveSave=transport.persist();return jobQA.received;});
 await page.waitForFunction(value=>jobQA.received>value,liveReceived);
 const day=await page.evaluate(()=>transport.game.day);await page.waitForTimeout(400);
 assert.ok(await page.evaluate(day=>transport.game.day>day,day));await page.evaluate(async()=>{await liveSave;transport.setSpeed(0);});
 checks.push('Simulation resumes while the worker encodes the captured save');
 const storage=await page.evaluate(()=>localStorage.getItem('transport-save-v1'));
 const failed=await page.evaluate(async()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='transport-save-v1')throw new DOMException('Quota','QuotaExceededError');return original.call(this,key,value);};transport.game.money=555555;transport.game.revision++;const result=await transport.persist();Storage.prototype.setItem=original;return result;});
 assert.equal(failed,false);assert.equal(await page.evaluate(()=>localStorage.getItem('transport-save-v1')),storage);
 checks.push('A worker save quota failure preserves the old checkpoint');
 await page.screenshot({path:`${out}/game-after-background-work.png`});assert.deepEqual(errors,[]);
 console.log(JSON.stringify({checks,errors,out},null,2));
}finally{await browser.close();}
