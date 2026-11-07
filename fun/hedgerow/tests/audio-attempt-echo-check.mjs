// Delay nodes can retain energy after every foreground source/path has ended.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const output=resolve(process.env.HEDGEROW_QA_OUTPUT||resolve(root,'work/qa'));
const sampleTotal=JSON.parse(await readFile(resolve(root,'fun/hedgerow/assets/audio/manifest.json'),'utf8')).assets.length;
const server=createServer(async(request,response)=>{
  if(request.url==='/'){response.end('<!doctype html>');return;}
  try{
    const pathname=new URL(request.url,'http://localhost').pathname;
    const file=resolve(root,'.'+pathname);
    assert.ok(file.startsWith(root+sep));
    response.setHeader('Content-Type',file.endsWith('.ogg')?'audio/ogg':'text/javascript');response.end(await readFile(file));
  }catch{response.writeHead(404).end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));let browser;
try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const report={};
  for(const mode of ['echo']){
    report[mode]={};
    for(const candidate of [false,true]){
      report[mode][candidate?'candidate':'baseline']=await page.evaluate(async({mode,candidate})=>{
        const {createAudio}=await import('/fun/hedgerow/js/audio.js');
        const sampleRate=16000,duration=mode==='ambient'?75:8,ctx=new OfflineAudioContext(2,sampleRate*duration,sampleRate);
        let clock=0,state='running',capture=false;
        Object.defineProperty(ctx,'currentTime',{get:()=>clock});Object.defineProperty(ctx,'state',{get:()=>state});
        const sources=new Set();
        for(const method of ['createBufferSource','createOscillator']){
          const make=ctx[method].bind(ctx);ctx[method]=(...args)=>{
            const source=make(...args);if(capture){sources.add(source);source.addEventListener('ended',()=>sources.delete(source),{once:true});}return source;
          };
        }
        const Native=window.AudioContext;window.AudioContext=function(){return ctx;};
        const audio=createAudio();audio.setAmbience(mode==='ambient'?{rain:.5,wind:[1,0],birds:true,aircraft:true,frogs:20}:{rain:0,wind:[0,0]});
        audio.prepare();await audio.loadSamples();window.AudioContext=Native;
        audio.setMix({ambience:mode==='ambient'?1:0});audio.setOutdoors(true);audio.setListener(0,1.6,0,0);audio.setSpace(1,6,.9);
        capture=true;clock=1;
        let before=null,after=null,retryAt=null;
        if(mode==='shot'){audio.gunshot('garand',0,1.6,3);audio.gunshot('mp40',2,1.6,4);}
        if(mode==='blast')audio.explosion(0,.1,3);
        if(mode==='foley'){audio.gear('stand');audio.dryFire();audio.garandPing();audio.footstep(0,0,0,'wood',1,true);audio.reload('thompson');audio.advanceActions(3);}
        if(mode==='echo'){
          audio.setSpace(1,30,1);audio.gunshot('garand',0,1.6,3,{player:true});audio.cancelActions();
          retryAt=Math.max(1.3,...[...sources].filter(s=>s.buffer).map(s=>1.001+(s.buffer.duration-.025)/s.playbackRate.value))+.02;
          ctx.suspend(retryAt).then(()=>{
            clock=retryAt;
            before={sources:sources.size,nodes:audio.nodeStatus,attempt:audio.attemptStatus};
            if(candidate)audio.cancelAttempt();audio.setSpace(0,30,1);
            after={sources:sources.size,nodes:audio.nodeStatus,attempt:audio.attemptStatus};
            ctx.resume();
          });
        }
        if(mode==='ambient'){
          audio.setFireSources([{x:2,y:0,z:5,size:1,on:true}]);
          audio.setRadioSources([{x:-2,y:1,z:4,active:()=>true}]);
          clock=30;audio.tick();
          const snapshot=()=>({sources:sources.size,attempt:audio.attemptStatus,aircraft:audio.aircraftStatus,fire:audio.fireStatus,radio:audio.radioStatus,nodes:audio.nodeStatus});
          before=snapshot();clock=30.05;state='suspended';if(candidate)audio.cancelAttempt();state='running';after=snapshot();
          ctx.suspend(72).then(()=>{clock=72;audio.setOutdoors(false);ctx.resume();});
        }
        const rendered=await ctx.startRendering();
        let peak=0,energy=0,hash=2166136261;
        for(let channel=0;channel<2;channel++){
          const samples=rendered.getChannelData(channel),words=new Uint32Array(samples.buffer);
          for(let i=0;i<samples.length;i++){
            const x=samples[i];if(!Number.isFinite(x))throw Error('non-finite PCM');peak=Math.max(peak,Math.abs(x));energy+=x*x;
            hash=Math.imul(hash^words[i],16777619)>>>0;
          }
        }
        let echoWindow=null;
        if(mode==='echo'){
          let echoPeak=0,echoEnergy=0;
          for(let c=0;c<2;c++){
            const samples=rendered.getChannelData(c);
            for(let i=Math.ceil((retryAt+.06)*sampleRate);i<Math.floor((retryAt+.5)*sampleRate);i++){echoPeak=Math.max(echoPeak,Math.abs(samples[i]));echoEnergy+=samples[i]*samples[i];}
          }
          echoWindow={retryAt,peak:echoPeak,energy:echoEnergy};
        }
        let maxDifference=0,errorEnergy=0;
        if(candidate){for(let c=0;c<2;c++){const samples=rendered.getChannelData(c),previous=window.__baselinePCM[c];for(let i=0;i<samples.length;i++){const error=samples[i]-previous[i];maxDifference=Math.max(maxDifference,Math.abs(error));errorEnergy+=error*error;}}}
        else window.__baselinePCM=[Float32Array.from(rendered.getChannelData(0)),Float32Array.from(rendered.getChannelData(1))];
        return {peak,energy,hash,maxDifference,errorEnergy,before,after,echoWindow,final:{sources:sources.size,nodes:audio.nodeStatus,attempt:audio.attemptStatus,actions:audio.actionStatus,fire:audio.fireStatus,radio:audio.radioStatus,aircraft:audio.aircraftStatus,samples:audio.sampleStatus}};
      },{mode,candidate});
    }
    const {baseline,candidate}=report[mode];
    await mkdir(output,{recursive:true});
    await writeFile(resolve(output,'audio-attempt-echo-report.json'),JSON.stringify(report,null,2));
    assert.equal(baseline.before.sources+baseline.before.nodes.oneShotBuses,0,'all foreground sources and paths ended before retry');
    assert.equal(candidate.before.sources+candidate.before.nodes.oneShotBuses,0);
    assert.ok(baseline.echoWindow.peak>1e-6 && baseline.echoWindow.energy>1e-10,'stored room energy remains after all sources end');
    assert.equal(candidate.echoWindow.peak,0,'retry flushes stored room energy independently of source cancellation');assert.equal(candidate.final.sources+candidate.final.nodes.oneShotBuses+candidate.final.actions.active,0);
    assert.equal(candidate.final.attempt.sources+candidate.final.attempt.retiringEchoes,0);
    assert.equal(candidate.final.samples.ready,sampleTotal);assert.equal(candidate.final.samples.failed,0);
    if(mode==='ambient'){
      assert.equal(candidate.before.attempt.sources,0,'wildlife, aircraft, fire and radio are outside foreground cancellation');
      for(const key of ['sources','aircraft','fire','radio','nodes'])assert.deepEqual(candidate.before[key],candidate.after[key]);
      assert.equal(candidate.final.fire.active+candidate.final.radio.active+candidate.final.aircraft.active,0);
    }
    console.log(`${mode}: stored echo flushed; ${candidate.hash}; ${candidate.final.sources} sources / ${candidate.final.nodes.oneShotBuses} paths remain`);
  }
  await mkdir(output,{recursive:true});
    await writeFile(resolve(output,'audio-attempt-echo-report.json'),JSON.stringify(report,null,2));
}finally{await browser?.close();await new Promise(done=>server.close(done));}
