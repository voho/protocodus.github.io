// Support edges are actual steps, while the body must still clear every beam.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const {createWorld}=await import('../js/world.js');
const {createNav}=await import('../js/nav.js');

function bodyBlock(world,from,path,height=1.7) {
  let y=world.groundAt(from.x,from.z,0,.45);
  for(const to of path) {
    const n=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.z-from.z)/.01));
    for(let i=1;i<=n;i++) {
      const x=from.x+(to.x-from.x)*i/n,z=from.z+(to.z-from.z)*i/n,p={x,z};
      const floor=world.groundAt(x,z,y,.45);
      if(Math.abs(floor-y)>.451)return {x,z,reason:'step'};
      y=floor;world.pushOut(p,.35,y,height,.45);
      if(Math.hypot(p.x-x,p.z-z)>.02001)return {x,z,reason:'body'};
    }
    from=to;
  }
  return null;
}

for(const yaw of [0,.35,.8])for(const blocked of [false,true]) {
  const bounds={minX:-10,maxX:10,minZ:-8,maxZ:8};
  const grid={minX:-10,minZ:-8,res:.5,nx:41,nz:33,H:new Float32Array(41*33)};
  const world=createWorld({...bounds,terrain:{grid,height:()=>0,raycast:()=>Infinity}});
  const point=(x,z)=>({x:x*Math.cos(yaw)+z*Math.sin(yaw),z:-x*Math.sin(yaw)+z*Math.cos(yaw)});
  const box=(x,z,y,hx,hy,hz)=>world.add({type:'box',...point(x,z),y,hx,hy,hz,yaw});
  box(0,0,.6,3,.2,1);
  for(const x of [-3.5,3.5])box(x,0,.2,.5,.2,1);
  box(blocked?-3.15:-3.6,0,2.42,.03,.2,1);
  // A high second deck cannot become footing merely because it overlaps
  // this route in XZ. A separate low support shares one ramp's footprint.
  box(-3.5,0,3.2,.4,.1,.8);box(-3.65,.2,.1,.15,.1,.3);
  const from=point(-4.75,0),goal=point(-2.5,0),nav=createNav(world,bounds,{cell:1});
  assert.equal(!!bodyBlock(world,from,[goal]),blocked,'independent fine probes classify the real support/beam encounter');
  if(!yaw)assert.equal(nav.lineClear(from.x,from.z,goal.x,goal.z),!blocked,'the discrete support change is neither a ramp nor a license to enter the beam');
  const path=nav.findPath(from.x,from.z,goal.x,goal.z);
  assert.ok(path?.length,'the support encounter has a route');
  assert.ok(Math.hypot(path.at(-1).x-goal.x,path.at(-1).z-goal.z)<.05,'the returned route reaches the actual goal');
  assert.equal(bodyBlock(world,from,path),null,'all route legs preserve actual support eligibility and full body clearance');
  console.log(`ok    rotated support ${yaw}, beam ${blocked?'blocked':'clear'}: actual goal reached without contact`);
}

for(const bottom of [1.8,1.68]) {
  const bounds={minX:-8,maxX:8,minZ:-4,maxZ:4},world=createWorld({...bounds,terrain:{height:()=>0,raycast:()=>Infinity}});
  world.add({type:'box',x:0,y:bottom+.1,z:0,hx:3,hy:.1,hz:1});
  const from={x:-4.5,z:0},goal={x:4.5,z:0},nav=createNav(world,bounds,{cell:1});
  assert.equal(!!bodyBlock(world,from,[goal]),bottom<1.7,'the underside controls are physically distinct');
  if(bottom>1.7)assert.equal(nav.lineClear(from.x,from.z,goal.x,goal.z),true,'the upper deck must not replace the actor floor');
  const path=nav.findPath(from.x,from.z,goal.x,goal.z);
  assert.ok(path?.length);
  assert.ok(Math.hypot(path.at(-1).x-goal.x,path.at(-1).z-goal.z)<.05);
  assert.equal(bodyBlock(world,from,path),null);
  console.log(`ok    bridge underside ${bottom}: actual lower floor retained with a clear body route`);
}

for(const blocked of [false,true]) {
  const bounds={minX:-6,maxX:6,minZ:-4,maxZ:4};
  const grid={minX:-6,minZ:-4,res:.5,nx:25,nz:17,H:new Float32Array(25*17)};
  const world=createWorld({...bounds,terrain:{grid,height:()=>0,raycast:()=>Infinity}});
  world.add({type:'cyl',x:0,y:0,z:0,r:1,h:.4});
  world.add({type:'box',x:blocked?-1.4:-1.6,y:2,z:0,hx:.03,hy:.2,hz:.5});
  const from={x:-3,z:0},goal={x:0,z:0},nav=createNav(world,bounds,{cell:1});
  assert.equal(!!bodyBlock(world,from,[goal]),blocked,'the circular support has a distinct real beam clearance');
  assert.equal(nav.lineClear(from.x,from.z,goal.x,goal.z),!blocked,'a circular support changes footing at its actual rounded edge');
  const path=nav.findPath(from.x,from.z,goal.x,goal.z);
  assert.ok(path?.length);
  assert.ok(Math.hypot(path.at(-1).x-goal.x,path.at(-1).z-goal.z)<.05);
  assert.equal(bodyBlock(world,from,path),null);
  console.log(`ok    circular support, beam ${blocked?'blocked':'clear'}: actual goal reached with a clear body`);
}
