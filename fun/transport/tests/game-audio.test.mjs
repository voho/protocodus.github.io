import assert from 'node:assert/strict';
import test from 'node:test';
import {createGameAudio} from '../game-audio.js';

class Parameter {
 events = [];
 setValueAtTime(value,time) { this.events.push({kind:'set',value,time}); }
 exponentialRampToValueAtTime(value,time) { this.events.push({kind:'ramp',value,time}); }
 cancelScheduledValues(time) { this.events.push({kind:'cancel',time}); }
}
class Node {
 connected = false;disconnected = false;
 connect(target) { this.connected = true;this.target = target; }
 disconnect() { this.connected = false;this.disconnected = true; }
}
class Oscillator extends Node {
 frequency = new Parameter();stops = [];
 start(time) { this.started = time; }
 stop(time) { this.stops.push(time); }
 finish() { this.onended?.(); }
}
class Context {
 currentTime = 5;state = 'running';destination = {};gains = [];oscillators = [];resumeCount = 0;
 createGain() { const node = new Node();node.gain = new Parameter();this.gains.push(node);return node; }
 createOscillator() { const node = new Oscillator();this.oscillators.push(node);return node; }
 resume() { this.resumeCount++;this.state = 'running';return Promise.resolve(); }
}
function rig(context = new Context()) {
 let time = 0,visible = true,created = 0;
 const audio = createGameAudio({createContext:() => {created++;return context;},now:() => time,isVisible:() => visible});
 return {audio,context,created:() => created,advance:ms => {time += ms;},show:value => {visible = value;},
  finish:() => context.oscillators.forEach(node => node.finish())};
}
const settled = async () => { await Promise.resolve();await Promise.resolve(); };

test('sound is opt-in and ambient events cannot create or resume audio',async () => {
 const r = rig();
 for (const kind of ['construction','delivery','headline']) assert.equal(r.audio.play(kind),false);
 assert.equal(await r.audio.unlock(),false);
 r.audio.setEnabled(true);
 assert.equal(r.audio.play('delivery'),false);assert.equal(r.audio.play('headline'),false);
 assert.equal(r.created(),0);
 assert.equal(await r.audio.unlock(),true);assert.equal(r.created(),1);
 r.context.state = 'suspended';
 assert.equal(r.audio.play('delivery'),false);assert.equal(r.audio.play('headline'),false);
 assert.equal(r.context.resumeCount,0);
});

test('the enable confirmation waits for async gesture unlock, while ambient cues are not queued',async () => {
 const r = rig();let resolve;
 r.context.state = 'suspended';r.context.resume = () => new Promise(done => {resolve = () => {r.context.state = 'running';done();};});
 r.audio.setEnabled(true);
 assert.equal(r.audio.play('confirm',{gesture:true}),true);
 assert.equal(r.audio.play('delivery'),false);assert.equal(r.audio.play('headline'),false);
 assert.equal(r.context.oscillators.length,0);
 resolve();await settled();
 assert.equal(r.context.oscillators.length,2);
 assert.equal(r.context.oscillators[0].frequency.events[0].value,523.25);
});

test('each cue is short and quiet and releases every oscillator and envelope after ending',async () => {
 const r = rig();r.audio.setEnabled(true);await r.audio.unlock();
 const signatures = [];
 for (const kind of ['confirm','construction','demolition','undo','launch','error','delivery','milestone','headline']) {
  const before = r.context.oscillators.length;
  assert.equal(r.audio.play(kind),true,kind);
  const nodes = r.context.oscillators.slice(before);
  signatures.push(JSON.stringify(nodes.map(node => [node.type,node.frequency.events,node.started,node.stops[0]])));
  for (const node of nodes) {
   assert.ok(node.stops[0] - r.context.currentTime < .6,kind);
   assert.ok(node.target.gain.events.filter(event => event.kind === 'ramp').every(event => event.value <= .035));
  }
  r.finish();assert.equal(r.audio.getStats().activeVoices,0);
  for (const node of nodes) {assert.equal(node.disconnected,true);assert.equal(node.target.disconnected,true);}
  r.advance(2000);
 }
 assert.equal(new Set(signatures).size,signatures.length);
 assert.equal(r.context.gains[0].gain.events.at(-1).value,.6);
});

test('repeated deliveries and work are throttled and mixed cues have a hard voice budget',async () => {
 const r = rig();r.audio.setEnabled(true);await r.audio.unlock();
 assert.equal(r.audio.play('delivery'),true);
 r.finish();r.advance(699);assert.equal(r.audio.play('delivery'),false);
 r.advance(1);assert.equal(r.audio.play('delivery'),true);
 assert.equal(r.audio.play('construction'),true);
 assert.equal(r.audio.play('demolition'),false);
 assert.equal(r.audio.play('launch'),true);
 assert.equal(r.audio.getStats().activeVoices,7);
 assert.equal(r.audio.play('error'),false);
 assert.ok(r.audio.getStats().activeVoices <= r.audio.getStats().maxVoices);
 r.finish();assert.equal(r.audio.play('error'),true);
});

test('mute and hidden-page suspension cancel active and scheduled notes immediately',async () => {
 for (const action of [audio => audio.setEnabled(false),audio => audio.suspend()]) {
  const r = rig();r.audio.setEnabled(true);await r.audio.unlock();r.audio.play('milestone');
  action(r.audio);
  assert.equal(r.audio.getStats().activeVoices,0);
  assert.equal(r.context.gains[0].gain.events.at(-1).value,0);
  for (const node of r.context.oscillators) {
   assert.equal(node.stops.at(-1),undefined);assert.equal(node.disconnected,true);assert.equal(node.target.disconnected,true);
  }
  assert.equal(r.audio.play('delivery'),false);
 }
});

test('visibility gate preserves the preference and never creates or resumes a context',async () => {
 const r = rig();r.audio.setEnabled(true);r.show(false);
 assert.equal(r.audio.play('confirm',{gesture:true}),false);assert.equal(await r.audio.unlock(),false);
 assert.equal(r.created(),0);
 r.show(true);r.audio.suspend();r.audio.resume();assert.equal(r.created(),0);
 await r.audio.unlock();r.audio.suspend();r.audio.resume();
 assert.equal(r.audio.getStats().enabled,true);assert.equal(r.context.resumeCount,0);
 assert.equal(r.audio.play('delivery'),true);
});

test('a late unlock cannot replay a muted, hidden or stale interaction',async () => {
 for (const invalidate of [r => r.audio.setEnabled(false),r => r.audio.suspend(),r => r.show(false),r => r.advance(251)]) {
  const r = rig();let resolve;
  r.context.state = 'suspended';r.context.resume = () => new Promise(done => {resolve = () => {r.context.state = 'running';done();};});
  r.audio.setEnabled(true);r.audio.play('launch',{gesture:true});invalidate(r);
  resolve();await settled();assert.equal(r.context.oscillators.length,0);
 }
});

test('gesture unlocks coalesce and only the latest pending gesture can sound',async () => {
 const r = rig();let resolve;
 r.context.state = 'suspended';r.context.resume = () => {r.context.resumeCount++;return new Promise(done => {resolve = () => {r.context.state = 'running';done();};});};
 r.audio.setEnabled(true);r.audio.play('construction',{gesture:true});r.audio.play('error',{gesture:true});
 assert.equal(r.context.resumeCount,1);
 resolve();await settled();
 assert.equal(r.context.oscillators.length,2);assert.equal(r.context.oscillators[0].frequency.events[0].value,246.94);
});

test('missing audio, throwing factories and rejected resumes remain silent without unhandled rejections',async () => {
 for (const createContext of [() => null,() => {throw new Error('unavailable');}]) {
  const audio = createGameAudio({createContext});audio.setEnabled(true);
  assert.equal(await audio.unlock(),false);assert.equal(audio.play('confirm',{gesture:true}),false);
 }
 const r = rig();r.context.state = 'suspended';r.context.resume = () => Promise.reject(new Error('autoplay blocked'));
 r.audio.setEnabled(true);assert.equal(await r.audio.unlock(),false);
 r.audio.play('confirm',{gesture:true});await settled();assert.equal(r.context.oscillators.length,0);
 r.context.resume = Context.prototype.resume;
 assert.equal(await r.audio.unlock(),true);assert.equal(r.audio.play('confirm'),true);
 assert.equal(r.audio.play('toString'),false);assert.equal(r.audio.play('unknown'),false);
});

test('partial node allocation failures stop and disconnect the whole cue',async () => {
 const r = rig();r.audio.setEnabled(true);await r.audio.unlock();
 const allocate = r.context.createGain.bind(r.context);
 r.context.createGain = () => {if (r.context.gains.length === 2) throw new Error('device lost');return allocate();};
 assert.equal(r.audio.play('launch'),false);assert.equal(r.audio.getStats().activeVoices,0);
 for (const node of r.context.oscillators) {assert.equal(node.disconnected,true);assert.equal(node.stops.at(-1),undefined);}
 assert.equal(r.context.gains[1].disconnected,true);
});
