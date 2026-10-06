import assert from 'node:assert/strict';
import test from 'node:test';
import { createFrameScheduler } from '../frame-scheduler.js';

function clock(){
 let time=0,serial=0;const frames=new Map(),timers=new Map();
 return{
  options:{now:()=>time,requestFrame:fn=>{const id=++serial;frames.set(id,fn);return id;},cancelFrame:id=>frames.delete(id),setTimer:(fn,delay)=>{const id=++serial;timers.set(id,{fn,at:time+delay});return id;},clearTimer:id=>timers.delete(id)},
  advance(next){time=next;for(const [id,{fn,at}]of [...timers])if(at<=time){timers.delete(id);fn();}},
  display(next){this.advance(next);const pending=[...frames.values()];frames.clear();for(const fn of pending)fn(time);},
  pending:()=>({frames:frames.size,timers:timers.size}),
 };
}

test('paused housekeeping sleeps until its deadline and input wakes the next display frame',()=>{
 const c=clock(),seen=[],s=createFrameScheduler(now=>seen.push(now),c.options);
 s.wake();s.wake();assert.deepEqual(c.pending(),{frames:1,timers:0});c.display(0);
 s.schedule(250,0);c.display(16);c.display(100);assert.deepEqual(seen,[0]);
 c.advance(180);s.wake();c.display(184);assert.deepEqual(seen,[0,184]);assert.deepEqual(c.pending(),{frames:0,timers:0});
});

test('30 Hz work uses display timestamps without extra simulation callbacks before the deadline',()=>{
 const c=clock(),seen=[];let s;s=createFrameScheduler(now=>{seen.push(now);s.schedule(1000/30,now);},c.options);
 s.wake();c.display(0);c.display(16);c.display(25);assert.deepEqual(seen,[0]);c.display(1000/30);c.display(50);c.display(2000/30);
 assert.deepEqual(seen,[0,1000/30,2000/30]);
});

test('input requested while rendering wins over an idle deadline and hidden cancellation stops both paths',()=>{
 const c=clock(),seen=[];let s;s=createFrameScheduler(now=>{seen.push(now);s.wake();s.schedule(250,now);},c.options);
 s.wake();c.display(0);assert.deepEqual(c.pending(),{frames:1,timers:0});s.cancel();c.display(300);assert.deepEqual(seen,[0]);
 s.schedule(250,300);assert.deepEqual(c.pending(),{frames:0,timers:1});s.cancel();c.display(1000);assert.deepEqual(seen,[0]);
 s.wake();c.display(1016);assert.deepEqual(seen,[0,1016]);
});
