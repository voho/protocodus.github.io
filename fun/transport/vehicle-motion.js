// Recorded movement is presentation state only. Sampling a completed tick keeps
// route bends, dwell, cargo changes and airport phases smooth without predicting
// future production or mutating the world between its authoritative updates.
import { placeVehicle } from './model.js';

const FIELDS=['direction','tripSerial','load','capacity','level','fullLoadSince'];
const sameState=(a,b)=>FIELDS.every(key=>a[key]===b[key]);
const lerp=(a,b,t)=>a+(b-a)*t;

export function createVehicleMotion({maxSegments=2048}={}){
  const entries=new Map();
  const limit=Number.isInteger(maxSegments)&&maxSegments>1?maxSegments:2048;
  let routeCache=null,recordCount=0,tracked=null;
  const tracks=vehicle=>tracked===null||tracked.has(vehicle);
  function setTracked(vehicles){tracked=vehicles==null?null:new Set(vehicles);}
  function routes(game){
    if(!routeCache||routeCache.game!==game||routeCache.routes!==game.routes||routeCache.count!==game.routes.length||routeCache.revision!==game.revision){
      routeCache={game,routes:game.routes,count:game.routes.length,revision:game.revision,byId:new Map(game.routes.map(route=>[route.id,route]))};
    }
    return routeCache.byId;
  }
  function entryFor(vehicle){
    let entry=entries.get(vehicle);
    if(!entry){entry={proxy:Object.create(vehicle),records:[],route:null,path:null,mode:null};entries.set(vehicle,entry);}
    return entry;
  }
  function add(vehicle,route,record){
    const entry=entryFor(vehicle),records=entry.records;
    if(entry.route!==route||entry.path!==route.path||entry.mode!==route.mode||records.length&&record.fromDay<records.at(-1).fromDay){
      recordCount-=records.length;records.length=0;
      entry.route=route;entry.path=route.path;entry.mode=route.mode;
    }
    for(const key of FIELDS)record[key]=vehicle[key];
    const previous=records.at(-1);
    // Day-end and arrival checkpoints can share a timestamp; retain the last
    // committed state at that instant rather than accumulating duplicate points.
    if(previous&&previous.fromDay===record.fromDay&&previous.toDay===previous.fromDay){records.pop();recordCount--;}
    records.push(record);recordCount++;
    if(records.length>limit){records.shift();recordCount--;}
  }
  function segment(vehicle,route,fromDay,toDay,fromProgress,toProgress,fromDwell,toDwell,fromDistance,toDistance){
    if(!tracks(vehicle)||!(toDay>fromDay))return;
    const entry=entries.get(vehicle),previous=entry?.records.at(-1);
    const duration=toDay-fromDay;
    // A constant-speed leg may cross multiple path vertices. Sampling progress
    // still follows every bend, so those vertices need no separate record.
    if(entry?.route===route&&entry.path===route.path&&entry.mode===route.mode&&previous&&previous.toDay===fromDay&&previous.toDay>previous.fromDay&&sameState(previous,vehicle)&&previous.toProgress===fromProgress&&previous.toDwell===fromDwell&&previous.toDistance===fromDistance){
      const oldDuration=previous.toDay-previous.fromDay;
      if(Math.abs((previous.toProgress-previous.fromProgress)/oldDuration-(toProgress-fromProgress)/duration)<1e-11&&Math.abs((previous.toDwell-previous.fromDwell)/oldDuration-(toDwell-fromDwell)/duration)<1e-11){
        previous.toDay=toDay;previous.toProgress=toProgress;previous.toDwell=toDwell;previous.toDistance=toDistance;return;
      }
    }
    add(vehicle,route,{fromDay,toDay,fromProgress,toProgress,fromDwell,toDwell,fromDistance,toDistance,x:vehicle.x,y:vehicle.y,angle:vehicle.angle});
  }
  function checkpoint(vehicle,route,day){
    if(!tracks(vehicle))return;
    add(vehicle,route,{fromDay:day,toDay:day,fromProgress:vehicle.progress,toProgress:vehicle.progress,fromDwell:vehicle.dwellRemaining||0,toDwell:vehicle.dwellRemaining||0,fromDistance:vehicle.totalDistance||0,toDistance:vehicle.totalDistance||0,x:vehicle.x,y:vehicle.y,angle:vehicle.angle});
  }
  function live(entry,vehicle){
    const proxy=entry.proxy;
    for(const key of FIELDS)proxy[key]=vehicle[key];
    for(const key of ['progress','dwellRemaining','totalDistance','x','y','angle'])proxy[key]=vehicle[key];
    return proxy;
  }
  function sample(game,vehicle,day){
    // Off-screen fleets need no presentation copies or per-frame scalar writes.
    if(!tracks(vehicle))return vehicle;
    const entry=entryFor(vehicle),route=routes(game).get(vehicle.routeId),records=entry.records;
    if(!Number.isFinite(day)||!records.length||records.at(-1).toDay<day-1e-8||entry.route!==route||entry.path!==route?.path||entry.mode!==route?.mode||route?.active===false)return live(entry,vehicle);
    let lo=0,hi=records.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(records[mid].fromDay<=day)lo=mid+1;else hi=mid;}
    const record=records[Math.max(0,lo-1)],duration=record.toDay-record.fromDay;
    const t=duration>0?Math.max(0,Math.min(1,(day-record.fromDay)/duration)):0,proxy=entry.proxy;
    for(const key of FIELDS)proxy[key]=record[key];
    proxy.progress=lerp(record.fromProgress,record.toProgress,t);
    proxy.dwellRemaining=lerp(record.fromDwell,record.toDwell,t);
    proxy.totalDistance=lerp(record.fromDistance,record.toDistance,t);
    if(route.path?.length>1)placeVehicle(route,proxy);
    else{proxy.x=record.x;proxy.y=record.y;proxy.angle=record.angle;}
    return proxy;
  }
  function trim(beforeDay){
    if(!Number.isFinite(beforeDay))return;
    for(const [vehicle,entry]of entries){
      const records=entry.records;let count=0;
      // Every living routed vehicle receives a checkpoint on each world tick,
      // including stopped vehicles. Older entries therefore belong to a fleet
      // member that has been removed or no longer has a route.
      if(records.length&&records.at(-1).toDay<beforeDay){recordCount-=records.length;entries.delete(vehicle);continue;}
      // Keep the last old point if the vehicle has no new motion (disconnected
      // routes and long full-load waits still have a well-defined held pose).
      while(count<records.length-1&&records[count].toDay<beforeDay)count++;
      if(count){records.splice(0,count);recordCount-=count;}
    }
  }
  function captureFinal(game){
    const current=new Set(game.vehicles),byId=routes(game);
    for(const [vehicle,entry]of entries)if(!current.has(vehicle)){recordCount-=entry.records.length;entries.delete(vehicle);}
    for(const vehicle of game.vehicles){const route=byId.get(vehicle.routeId);if(route)checkpoint(vehicle,route,game.day);}
  }
  function reset(){entries.clear();routeCache=null;recordCount=0;tracked=null;}
  return{segment,checkpoint,sample,trim,reset,captureFinal,setTracked,tracks,getStats:()=>({vehicles:entries.size,records:recordCount,maxSegments:limit,trackedVehicles:tracked?.size??null})};
}
