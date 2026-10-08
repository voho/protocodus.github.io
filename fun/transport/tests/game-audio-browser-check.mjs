// Real desktop entry/toggle/keyboard input; isolated storage never touches player saves.
import assert from 'node:assert/strict';
import {createWorldFromMenu,loadAutosaveFromMenu,openGameAction} from './browser-start.mjs';
const {chromium} = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({channel:process.env.TRANSPORT_BROWSER || 'chrome',headless:true});
const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const errors = [];

try {
 const page = await browser.newPage({viewport:{width:1280,height:900}});
 page.on('pageerror',error => errors.push(error.message));
 await page.addInitScript(() => {
  window.audioContextsCreated = 0;window.audioOscillatorsCreated = 0;
  const Original = window.AudioContext;
  window.AudioContext = class extends Original {
   constructor(...args) {super(...args);window.audioContextsCreated++;}
   createOscillator() {window.audioOscillatorsCreated++;return super.createOscillator();}
  };
 });
 await page.goto(url);
 await createWorldFromMenu(page);
 assert.deepEqual(await page.evaluate(() => ({enabled:transport.audio.enabled,contexts:audioContextsCreated})),
  {enabled:false,contexts:0},'new games stay muted through startup and ordinary clicks');
 assert.equal(await page.locator('#audio-button').getAttribute('aria-pressed'),'false');

 await openGameAction(page,'audio-button');
 await page.waitForFunction(() => transport.audio.contextState === 'running' && audioOscillatorsCreated >= 2);
 assert.equal(await page.locator('#audio-button').getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('#audio-button').getAttribute('aria-label'),'Disable sound');
 assert.equal(await page.evaluate(() => localStorage.getItem('transport-sound-v1')),'on');
 await page.waitForFunction(() => transport.audio.activeVoices === 0);
 assert.equal(await page.evaluate(() => audioContextsCreated),1,'confirmation releases notes and keeps one reusable context');

 await openGameAction(page,'audio-button');
 assert.equal(await page.evaluate(() => transport.audio.enabled),false);
 // One task prevents the short confirmation naturally ending before the mute assertion.
 const muted = await page.evaluate(() => {
  const button = document.querySelector('#audio-button');button.click();
  const during = transport.audio.activeVoices;button.click();
  return {during,after:transport.audio.activeVoices,enabled:transport.audio.enabled,stored:localStorage.getItem('transport-sound-v1')};
 });
 assert.ok(muted.during > 0,'an enabled confirmation is actively sounding before mute');
 assert.equal(muted.after,0);assert.equal(muted.enabled,false);assert.equal(muted.stored,'off');

 await openGameAction(page,'audio-button');
 await page.waitForFunction(() => transport.audio.contextState === 'running');
 const hidden = await page.evaluate(() => {
  Object.defineProperty(document,'hidden',{configurable:true,value:true});
  Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
  document.dispatchEvent(new Event('visibilitychange'));
  const hidden = {...transport.audio};
  delete document.hidden;delete document.visibilityState;
  document.dispatchEvent(new Event('visibilitychange'));
  return {hidden,visible:{...transport.audio}};
 });
 assert.equal(hidden.hidden.suspended,true);assert.equal(hidden.hidden.activeVoices,0);
 assert.equal(hidden.visible.suspended,false);assert.equal(hidden.visible.enabled,true);

 await page.reload();
 await loadAutosaveFromMenu(page,{paused:false});
 await page.evaluate(() => transport.setSpeed(0));
 assert.deepEqual(await page.evaluate(() => ({enabled:transport.audio.enabled,contexts:audioContextsCreated})),
  {enabled:true,contexts:0},'restoring the enabled preference waits for a gesture after the app has loaded');
 // Synthetic input must not bypass the trusted-gesture guard.
 await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Shift',bubbles:true})));
 assert.equal(await page.evaluate(() => audioContextsCreated),0);
 await page.keyboard.press('Shift');
 await page.waitForFunction(() => transport.audio.contextState === 'running');
 assert.equal(await page.evaluate(() => audioContextsCreated),1,'keyboard-only play unlocks a remembered sound choice');
 assert.equal(await page.evaluate(() => transport.audio.activeVoices),0,'unlocking alone plays no unsolicited cue');
 assert.deepEqual(errors,[]);
 console.log('Game audio browser check passed: muted default, quiet confirmation, cleanup, immediate mute, visibility gate, saved preference and trusted keyboard unlock.');
} finally {
 await browser.close();
}
