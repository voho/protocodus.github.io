// Actual entrypoint retry/recovery lifecycle with real, silently recorded WebAudio.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const output = resolve(process.env.HEDGEROW_QA_OUTPUT || resolve(root, 'work/qa'));
const sampleTotal = JSON.parse(await readFile(resolve(root, 'fun/hedgerow/assets/audio/manifest.json'), 'utf8')).assets.length;
const paths = ['main', 'audio', 'audio-space'].map(name => `fun/hedgerow/js/${name}.js`);
const seal = {};
for (const path of paths) seal[path] = createHash('sha256').update(await readFile(path)).digest('hex');
const main = await readFile(resolve(root, paths[0]), 'utf8');
const names = ['retryCheckpoint', 'cancelCompletionPresentation', 'resume', 'pause', 'resetAcoustics', 'installGraphicsRecovery'];
const functions = names.map(name => {
  const start = main.indexOf(`function ${name}(`), end = main.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start);
  return main.slice(start, end + 2);
}).join('\n');
const server = createServer(async (request, response) => {
  if (request.url === '/') { response.end('<!doctype html><button>Audit attempt tails</button>'); return; }
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = resolve(root, '.' + pathname);
    assert.ok(file.startsWith(root + sep));
    response.setHeader('Content-Type', file.endsWith('.ogg') ? 'audio/ogg' : 'text/javascript');
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(({ functions, selectedModes }) => {
    document.querySelector('button').onclick = () => {
      window.__audit = (async () => {
        const { createAudio } = await import('/fun/hedgerow/js/audio.js');
        const results = {};
        for (const mode of selectedModes) {
          const runningRetry = mode === 'running-retry' || mode === 'rapid-running-retry';
          const Native = window.AudioContext;
          const ctx = new Native({ sampleRate: 16000 });
          await ctx.resume();
          // The recorder receives the normal final mix; its output stays zero.
          const recorder = ctx.createScriptProcessor(256, 2, 2), pcm = [];
          const gainNodes = [], makeGain = ctx.createGain.bind(ctx);
          ctx.createGain = () => { const node = makeGain(); gainNodes.push(node); return node; };
          recorder.onaudioprocess = event => {
            const left = event.inputBuffer.getChannelData(0), right = event.inputBuffer.getChannelData(1);
            pcm.push({ time: event.playbackTime, left: Array.from(left), right: Array.from(right) });
            event.outputBuffer.getChannelData(0).fill(0); event.outputBuffer.getChannelData(1).fill(0);
          };
          recorder.connect(ctx.destination);
          const connect = AudioNode.prototype.connect;
          AudioNode.prototype.connect = function (destination, ...args) {
            return connect.call(this, destination === ctx.destination ? recorder : destination, ...args);
          };
          const sources = new Set(), history = []; let capture = false;
          for (const method of ['createBufferSource', 'createOscillator']) {
            const make = ctx[method].bind(ctx);
            ctx[method] = (...args) => {
              const source = make(...args);
              if (capture) {
                const entry = { type: method, created: ctx.currentTime, start: null, stopped: null, ended: null };
                const start = source.start.bind(source), stop = source.stop.bind(source);
                source.start = (...params) => { entry.control = source.loop && source.buffer?.length === 1; entry.start = params[0] ?? ctx.currentTime; return start(...params); };
                source.stop = (...params) => { entry.stopped = params[0] ?? ctx.currentTime; return stop(...params); };
                sources.add(source); history.push(entry);
                source.addEventListener('ended', () => { entry.ended = ctx.currentTime; sources.delete(source); }, { once: true });
              }
              return source;
            };
          }
          window.AudioContext = function () { return ctx; };
          const audio = createAudio();
          audio.setAmbience({ rain: mode === 'ambient-retry' ? 1 : 0, wind: mode === 'ambient-retry' ? [1.6,.7] : [0,0] }); audio.prepare(); await audio.loadSamples();
          window.AudioContext = Native; AudioNode.prototype.connect = connect;
          audio.setVolume(mode === 'volume-retry' ? .37 : 1);
          audio.setMix({ effects: mode === 'muted-retry' ? 0 : mode === 'volume-retry' ? .43 : 1, ambience: mode === 'ambient-retry' ? .6 : 0 }); audio.setOutdoors(true); audio.setListener(0, 1.6, 0, 0); audio.setSpace(1, 5, 1);
          const lifecycle = new Function('audio', `
            let graphicsLost = false, state = 'playing', completionPresentation = null, completionRecorded = false;
            let deathSequence = 0, missionTime = 30, screenStack = [], echoRay = 0, echoTimer = 0;
            const calls = [], record = name => (...args) => calls.push({name,args});
            const ECHO_RAYS = 8, ECHO_REACH = 30, echoHits = new Float32Array(8).fill(5), echoReflections = new Float32Array(8).fill(1);
            const canvas = new EventTarget(), nodes = new Map();
            const $ = selector => { if (!nodes.has(selector)) nodes.set(selector, { textContent:'', innerHTML:'', hidden:true, append(){} }); return nodes.get(selector); };
            const LEVEL = { title:'Audio fixture', objectives:[] }, formatTime = () => '0:30';
            const player = { alive:true, pos:[0,0,0], char:{ragdoll:{cancelImpact:record('cancelPlayerImpact')}},
              releaseGraphicsResources:record('releasePlayerGraphics'), reset(at){ this.alive = true; this.pos = [...at]; record('resetPlayer')(at); } };
            const clear = name => ({clear:record(name)});
            const G = { enemies:[], debris:clear('debris'), casings:clear('casings'), chunks:clear('chunks'), steam:clear('steam'), daylight:true };
            const mission = {done:false, restoreCheckpoint(){return {spawn:[20,0,70],inventory:{}};}};
            const enemies = {resetLiving:record('resetEnemies')}, explosives = clear('explosives');
            const fade = {classList:{remove:record('fadeRemove')}};
            const hud = {hideCrosshair(){}, show(){}}, show = record('show');
            const input = {enable:record('inputEnable'),exitLock(){},requestLock(){}};
            const screenEls = {pause:{scrollTop:0,querySelector:()=>({scrollTop:0})}};
            const trackAttemptStart = record('attemptStart');
            const scene = {traverse(){}, environment:null}, camera = {};
            const environmentMaps = {clear:record('environmentClear'),bake:()=>({day:{texture:{}},night:{texture:{}}}),releaseTemporary(){}};
            const renderer = {setRenderTarget(){},setSize(){},shadowMap:{},render:record('render')};
            const adapt = null, taa = null, blur = null, applyGraphics = record('applyGraphics');
            ${functions}
            installGraphicsRecovery(environmentMaps);
            return {pause,resume,retryCheckpoint,lose(){const e = new Event('webglcontextlost',{cancelable:true});canvas.dispatchEvent(e);},restore(){canvas.dispatchEvent(new Event('webglcontextrestored'));},snapshot(){return {state,graphicsLost,deathSequence,pos:player.pos,calls:[...calls]};}};
          `)(audio);
          const snapshot = () => ({ time:ctx.currentTime, context:ctx.state, sources:sources.size,
            pending:history.filter(entry => entry.ended === null && entry.start > ctx.currentTime && (entry.stopped === null || entry.stopped > ctx.currentTime)).length,
            attempt:audio.attemptStatus, actions:audio.actionStatus, actors:audio.actorActionStatus,
            mix:{master:gainNodes[0].gain.value,effects:gainNodes[4].gain.value,ambience:gainNodes[5].gain.value,ring:gainNodes[2].gain.value},
            samples:audio.sampleStatus, nodes:audio.nodeStatus, environment:audio.environmentStatus, lifecycle:lifecycle.snapshot() });
          capture = true; const bornTime = ctx.currentTime; let actor = null;
          const mixed = ['overlapping-retry','fresh-retry','muted-retry','volume-retry','rapid-paused-retry','running-retry','rapid-running-retry'].includes(mode);
          if (mixed) {
            audio.gunshot('garand',0,1.6,3,{player:true}); audio.gunshot('kar98k',0,1.6,343);
            audio.explosion(0,1.6,3); audio.garandPing(); audio.reload('thompson');
            audio.distant('artillery',{delay:2,azimuth:.5}); audio.thunder({delay:2,power:.4});
            audio.advanceActions(.6); audio.gear('crouch'); audio.pin('grenade_de');
            actor = audio.reloadActor('mp40',()=>({x:3,y:.6,z:0}),{duration:2,heightOffset:0}); actor.advance(.6);
          }
          if (mode.startsWith('shot')) audio.gunshot('kar98k', 0, 1.6, 343);
          else if (mode.startsWith('blast')) audio.explosion(0, 1.6, 343);
          else if (mode.startsWith('close')) audio.gunshot('kar98k', 0, 1.6, 3);
          const born = snapshot();
          while (ctx.currentTime < bornTime + (mode.startsWith('close') ? .18 : .05)) await new Promise(done => setTimeout(done, 5));
          if (mode.endsWith('recovery')) lifecycle.lose(); else if (!runningRetry) lifecycle.pause();
          while (!runningRetry && ctx.state !== 'suspended') await new Promise(done => setTimeout(done, 5));
          const heldBefore = snapshot();
          if (!runningRetry) await new Promise(done => setTimeout(done,220));
          const heldAfter = snapshot();
          const beforeRapid = history.length; let rapid = null;
          if (mode === 'rapid-paused-retry') {
            for (let i=0;i<30;i++) audio.cancelAttempt();
            rapid = { extraSources:history.length-beforeRapid,status:audio.attemptStatus };
          }
          if (mode === 'rapid-running-retry') {
            let peakControls = 0, peakRetiring = 0;
            const controls = () => history.filter(entry => entry.control && entry.ended === null && (entry.stopped === null || entry.stopped > ctx.currentTime)).length;
            for (let round = 0; round < 3; round++) {
              for (let i = 0; i < 20; i++) {
                audio.cancelAttempt();
                peakControls = Math.max(peakControls, controls());
                peakRetiring = Math.max(peakRetiring, audio.attemptStatus.retiringEchoes);
              }
              // Simulate one busy frame: audio reaches the cleanup deadline
              // while its old ended callback cannot yet run on the main thread.
              const until = performance.now() + 35;
              while (performance.now() < until) { /* bounded 35 ms deadline race */ }
            }
            audio.cancelAttempt();
            // Freeze the new clock before processing old ended callbacks;
            // scheduler load cannot let its legitimate deadline expire first.
            await ctx.suspend();
            await new Promise(done => setTimeout(done, 0));
            rapid = { extraSources: history.length - beforeRapid, peakControls, peakRetiring,
              afterOldEnded: { liveControls: controls(), ...audio.attemptStatus } };
          }
          let restored = null;
          if (mode.endsWith('recovery')) {
            lifecycle.restore(); restored = snapshot(); await new Promise(done => setTimeout(done, 100)); lifecycle.resume();
          } else {
            lifecycle.retryCheckpoint(); audio.setListener(20, 1.6, 70, 0);
          }
          while (ctx.state !== 'running') await new Promise(done => setTimeout(done, 5));
          const resumed = snapshot();
          let fresh = false, afterTransition = null, previousTime = ctx.currentTime;
          while (ctx.currentTime < bornTime + 4) {
            if (ctx.currentTime > resumed.time + .12 && !afterTransition) afterTransition = snapshot();
            if (['fresh-retry','volume-retry'].includes(mode) && !fresh && ctx.currentTime > bornTime+1.2) { audio.gunshot('kar98k',20,1.6,73,{player:true}); fresh=true; }
            const dt=ctx.currentTime-previousTime; audio.advanceActions(dt); actor?.advance(dt); previousTime=ctx.currentTime;
            audio.tick(); await new Promise(done => setTimeout(done,20));
          }
          const final = snapshot();
          const ranges = [[0,.5],[.5,1],[1,1.6],[1.6,2.5],[2.5,4]].map(([a,b]) => {
            let peak = 0, energy = 0, count = 0;
            for (const block of pcm) for (let i = 0; i < block.left.length; i++) {
              const time = block.time + i / ctx.sampleRate - bornTime;
              if (time < a || time >= b) continue;
              const l = block.left[i], r = block.right[i];
              if (!Number.isFinite(l) || !Number.isFinite(r)) throw Error('non-finite PCM');
              peak = Math.max(peak,Math.abs(l),Math.abs(r)); energy += l*l+r*r; count++;
            }
            return {range:[a,b],peak,energy,count};
          });
          recorder.disconnect(); await ctx.close();
          results[mode] = {bornTime,born,heldBefore,heldAfter,restored,resumed,afterTransition,rapid,final,history,ranges};
        }
        return results;
      })();
    };
  }, { functions, selectedModes: ['silent-retry', 'shot-retry', 'blast-retry', 'close-reflection-retry', 'overlapping-retry', 'fresh-retry', 'muted-retry', 'volume-retry', 'ambient-retry', 'rapid-paused-retry', 'running-retry', 'rapid-running-retry', 'shot-recovery', 'blast-recovery'] });
  await page.getByRole('button').click();
  const results = await page.evaluate(() => window.__audit);
  await mkdir(output, { recursive:true });
  await writeFile(resolve(output, 'audio-attempt-lifecycle-report.json'), JSON.stringify({seal,results},null,2));
  for (const [mode,r] of Object.entries(results)) {
    const runningRetry = mode === 'running-retry' || mode === 'rapid-running-retry';
    if (!runningRetry) assert.equal(r.heldBefore.time,r.heldAfter.time);
    if (!runningRetry) assert.equal(r.heldBefore.sources,r.heldAfter.sources);
    assert.equal(r.final.sources+r.final.nodes.oneShotBuses,0);
    assert.equal(r.final.attempt.sources+r.final.attempt.retiringEchoes+r.final.actions.active+r.final.actors.active,0);
    assert.equal(r.final.samples.ready,sampleTotal); assert.equal(r.final.samples.failed,0);
    if (mode.endsWith('recovery')) {
      assert.equal(r.restored.context,'suspended'); assert.equal(r.restored.lifecycle.state,'paused'); assert.equal(r.restored.lifecycle.graphicsLost,false);
    }
    if (!mode.endsWith('recovery')) {
      assert.equal(r.afterTransition.sources,0,'all old foreground/control sources end within the transition');
      assert.equal(r.afterTransition.attempt.retiringEchoes,0,'retired echo network is released');
      assert.deepEqual(r.heldAfter.mix,r.resumed.mix,'retry preserves effects/ambience/master/ring values');
    }
    if (['silent-retry','shot-retry','blast-retry','close-reflection-retry','overlapping-retry','muted-retry','rapid-paused-retry','running-retry','rapid-running-retry'].includes(mode)) {
      assert.ok(r.ranges.slice(1).every(x=>x.peak===0),'no old source or stored echo is heard after the short transition');
    }
    if (['fresh-retry','volume-retry'].includes(mode)) assert.ok(r.ranges[2].peak>.02,'new-attempt shot remains audible');
    if (mode==='ambient-retry') assert.ok(r.ranges[0].energy>0 && r.ranges[4].energy>0,'ambient bed remains connected across retry');
    if (mode==='rapid-paused-retry') { assert.equal(r.rapid.extraSources,0); assert.equal(r.rapid.status.retiringEchoes,0); }
    if (mode === 'rapid-running-retry') {
      assert.ok(r.rapid.peakControls <= 1 && r.rapid.peakRetiring <= 1, 'running retries keep one cleanup source/network');
      assert.equal(r.rapid.afterOldEnded.retiringEchoes, 1, 'stale ended callbacks cannot release a new echo generation');
      assert.equal(r.rapid.afterOldEnded.liveControls, 1);
    }
    console.log(mode,JSON.stringify({pendingBefore:r.heldBefore.pending,pendingAfter:r.resumed.pending,oldSourcesAfter:r.resumed.sources,late:r.ranges.slice(2).map(x=>({range:x.range,peak:x.peak,energy:x.energy})),finalSources:r.final.sources,finalPaths:r.final.nodes.oneShotBuses}));
  }
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
