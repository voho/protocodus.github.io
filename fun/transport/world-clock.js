import { tick } from './model.js';
import { createVehicleMotion } from './vehicle-motion.js';

// World state commits once per active second. Presentation reads recorded
// movement one active second behind, including bends, stops and turnarounds.
export function createWorldClock({game,advanceWorld=tick,motion=createVehicleMotion(),beforeCommit=()=>{},intervalMs=1000}={}) {
  let world=game,initialDay=game.day,committedDay=game.day,lastNow=null,speed=0,active=false,activeMs=0,commitAt=0,pendingDays=0,commits=0,forceFlush=false;
  let pending=[],history=[];
  motion.captureFinal(world);
  function reset(next,now=null){world=next;initialDay=committedDay=next.day;lastNow=now;activeMs=commitAt=pendingDays=commits=0;forceFlush=false;pending=[];history=[];motion.reset();motion.captureFinal(world);}
  function collect(now){
    // Diagnostics and compatibility callers may advance the model directly.
    // Their new committed state starts a fresh presentation timeline.
    if(world.day!==committedDay)reset(world,now);
    if(lastNow!==null&&active&&speed>0){
      const elapsed=Math.max(0,now-lastNow),from=activeMs;activeMs+=elapsed;pendingDays+=elapsed*speed/1000;
      if(elapsed){const previous=pending.at(-1);if(previous?.speed===speed)previous.toMs=activeMs;else pending.push({fromMs:from,toMs:activeMs,speed});}
    }
    lastNow=now;
  }
  function presentationDay(){
    const target=Math.max(0,activeMs-intervalMs);
    for(const part of history)if(target<=part.toMs)return part.fromDay+(part.toDay-part.fromDay)*Math.max(0,Math.min(1,(target-part.fromMs)/(part.toMs-part.fromMs)));
    return history.length?history.at(-1).toDay:initialDay;
  }
  function commit({blocked=false,reserved=[]}={}){
    if(blocked||pendingDays<=1e-8)return false;
    beforeCommit();const fromDay=world.day;advanceWorld(world,pendingDays,{reserved,motion});
    let left=world.day-fromDay,day=fromDay;
    if(left<=1e-8)return false;
    const remaining=[];
    for(const part of pending){
      const days=(part.toMs-part.fromMs)*part.speed/1000,used=Math.min(left,days),end=part.fromMs+used/part.speed*1000;
      if(used>0){history.push({fromMs:part.fromMs,toMs:end,fromDay:day,toDay:day+used});day+=used;left=Math.max(0,left-used);}
      if(used<days-1e-8)remaining.push({...part,fromMs:end});
    }
    committedDay=world.day;pending=remaining;pendingDays=Math.max(0,pendingDays-(world.day-fromDay));commitAt=activeMs;forceFlush=pendingDays>1e-8;commits++;
    motion.captureFinal(world);
    const target=Math.max(0,activeMs-intervalMs);
    while(history.length>1&&history[0].toMs<target)history.shift();
    motion.trim(presentationDay());return true;
  }
  return{
    motion,
    advance(now,options={}){collect(now);if(forceFlush||activeMs-commitAt>=intervalMs)commit(options);return presentationDay();},
    flush(now,options={}){collect(now);forceFlush=pendingDays>1e-8;commit(options);return presentationDay();},
    setSpeed(next,now,options={}){if(next===speed){collect(now);return;}collect(now);forceFlush=pendingDays>1e-8;commit(options);speed=next;},
    setActive(next,now,options={}){collect(now);if(active&&!next){forceFlush=pendingDays>1e-8;commit(options);}active=next;},
    reset,
    getPresentationDay:presentationDay,
    getStats:()=>({commits,pendingDays,activeMs,presentationDay:presentationDay(),intervalMs,speed,active}),
  };
}
