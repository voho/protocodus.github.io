import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorldClock} from '../world-clock.js';

function fixture(){
 const game={day:20},calls=[],trimmed=[],motion={captureFinal(){},reset(){},trim(day){trimmed.push(day);}};
 const clock=createWorldClock({game,motion,advanceWorld:(world,days,options)=>{calls.push({days,reserved:options.reserved});world.day+=days;}});
 clock.setSpeed(1,0);clock.setActive(true,0);return{game,clock,calls,trimmed};
}
test('world commits once per second while presentation advances inside the next stable interval',()=>{
 const {game,clock,calls}=fixture();
 for(let at=100;at<1000;at+=100)clock.advance(at);
 assert.equal(calls.length,0);assert.equal(game.day,20);
 clock.advance(1000);assert.equal(calls.length,1);assert.equal(game.day,21);assert.equal(clock.getPresentationDay(),20);
 clock.advance(1500);assert.equal(game.day,21);assert.equal(clock.getPresentationDay(),20.5);
 clock.advance(2000);assert.equal(calls.length,2);assert.equal(game.day,22);assert.equal(clock.getPresentationDay(),21);
});
test('short speed changes retain their original rates and presentation is continuous across rate boundaries',()=>{
 const {game,clock}=fixture();
 clock.setSpeed(3,400);assert.equal(game.day,20.4);
 clock.setSpeed(8,800);assert.ok(Math.abs(game.day-21.6)<1e-9);
 clock.setSpeed(0,1200);assert.ok(Math.abs(game.day-24.8)<1e-9);
 assert.ok(Math.abs(clock.getPresentationDay()-20.2)<1e-9);
 const paused=clock.getStats();clock.advance(5000);assert.equal(clock.getStats().activeMs,paused.activeMs);assert.equal(clock.getPresentationDay(),paused.presentationDay);
 clock.setSpeed(1,5000);clock.advance(5600);assert.ok(Math.abs(clock.getPresentationDay()-21.6)<1e-9);
});
test('hidden time is excluded and a save capture retains pending updates until it releases',()=>{
 const {game,clock,calls}=fixture();
 clock.advance(1300,{blocked:true});assert.equal(game.day,20);assert.equal(calls.length,0);
 clock.setSpeed(0,1500,{blocked:true});assert.equal(clock.getStats().pendingDays,1.5);
 clock.advance(1800);assert.equal(game.day,21.5);assert.equal(clock.getStats().pendingDays,0);
 clock.setSpeed(3,2000);clock.setActive(false,2200);assert.ok(Math.abs(game.day-22.1)<1e-9);
 clock.advance(10000);assert.ok(Math.abs(game.day-22.1)<1e-9);
 clock.setActive(true,10000);clock.flush(10300);assert.ok(Math.abs(game.day-23)<1e-9);
});
test('replacement releases the old timeline and reserved construction tiles reach the world commit',()=>{
 const {clock,calls}=fixture(),reserved=[{x:4,y:7}];clock.advance(1000,{reserved});assert.equal(calls[0].reserved,reserved);
 const next={day:90};clock.reset(next,2000);assert.equal(clock.getPresentationDay(),90);assert.equal(clock.getStats().commits,0);
 clock.advance(3000);assert.equal(next.day,91);assert.equal(clock.getPresentationDay(),90);
});
test('direct compatibility advances replace stale presentation without adding elapsed time twice',()=>{
 const {game,clock}=fixture();clock.advance(1000);game.day=200;clock.advance(1500);
 assert.equal(clock.getPresentationDay(),200);assert.equal(clock.getStats().pendingDays,0);
 clock.advance(2500);assert.equal(game.day,201);
});
test('a busy world spreads one second of 8× across frames at day boundaries, and flushes still commit everything',()=>{
 let cpu=0;const game={day:20},calls=[],motion={captureFinal(){},reset(){},trim(){}};
 // Each simulated day costs 10 ms of a fake CPU clock.
 const clock=createWorldClock({game,motion,cpuNow:()=>cpu,advanceWorld:(world,days)=>{calls.push(days);world.day+=days;cpu+=10*days;}});
 clock.setSpeed(8,0);clock.setActive(true,0);
 clock.advance(1000);assert.deepEqual(calls,[1,1],'stops at a day boundary once the frame budget is spent');assert.equal(game.day,22);
 clock.advance(1033);assert.ok(game.day>22&&game.day<=24.3,'the next frame continues without waiting for the interval');
 for(const at of [1066,1099,1132])clock.advance(at);
 assert.equal(clock.getStats().pendingDays,0,'caught up within a few frames');assert.equal(clock.getStats().commits,1,'continuations finish the same commit');assert.ok(Math.abs(game.day-(20+1.132*8))<1e-9);
 clock.advance(1500);assert.ok(Math.abs(game.day-(20+1.132*8))<1e-9,'then the usual one-second cadence resumes');
 calls.length=0;clock.setSpeed(0,1700);assert.equal(calls.length,1,'a speed change flushes in one advance');assert.ok(Math.abs(game.day-(20+1.7*8))<1e-9);
 // More than two intervals behind (a long hitch), a frame commits everything rather than falling further behind.
 clock.setSpeed(8,1700);calls.length=0;clock.advance(4700);assert.equal(calls.length,1);assert.ok(Math.abs(game.day-(20+4.7*8))<1e-9);
});
