import './three-hooks.mjs';
import assert from 'node:assert/strict';
const THREE=await import('three');
const {createPragueFlags,FLAG_COLORS,FLAG_STAFF}=await import('../js/prague-flags.js');
const L=(await import('../js/levels/prague.js')).default;
const originalProps=JSON.stringify(L.props),shared={time:{value:10}};
const build=createPragueFlags(L,L.baseHeight,{shared});
const placements=build.placements;
assert.equal(JSON.stringify(L.props),originalProps,'Decorative flags do not mutate authored placements or routes');
assert.equal(build.flags,2);assert.equal(build.draws,2);assert.equal(build.group.children.length,2);
assert.ok(build.triangles<1400,'Two small flags have a hard modest geometry budget');
assert.ok(build.clearance>3,'Hardware/cloth/wind envelope remains fully above standing or vaulted routes');
const cloth=build.group.children[0],g=cloth.geometry,p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv,color=g.attributes.color,coord=g.attributes.aFlagCoord;
assert.equal(cloth.material.side,THREE.DoubleSide);assert.equal(cloth.material.transparent,false);assert.equal(cloth.material.opacity,1);
assert.equal(cloth.material.map.image.data.byteLength,16384,'Original weave is one shared64×64 RGBA map');
const expected=Object.fromEntries(Object.entries(FLAG_COLORS).map(([k,c])=>[k,new THREE.Color(c)]));
const area={blue:0,white:0,red:0};let rootVertices=0,maxRootError=0;
const mat=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),rayMesh=new THREE.Mesh(g,mat);
for(const mesh of build.group.children){assert.equal(mesh.castShadow,false);assert.equal(mesh.matrixAutoUpdate,false);for(const a of Object.values(mesh.geometry.attributes))assert.ok(a.array.every(Number.isFinite));}
for(let i=0;i<p.count;i++){
 assert.ok(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<1e-5);
 if(coord.getX(i)===0){
  rootVertices++;const which=Math.abs(coord.getZ(i)-.8)<1e-5?0:1,host=placements[which];
  const root=new THREE.Vector3(...FLAG_STAFF.hoistTop).addScaledVector(new THREE.Vector3(...FLAG_STAFF.axis),-coord.getY(i));
  root.applyAxisAngle(new THREE.Vector3(0,1,0),host.yaw*Math.PI/180).add(new THREE.Vector3(...host.wall));
  maxRootError=Math.max(maxRootError,root.distanceTo(new THREE.Vector3().fromBufferAttribute(p,i)));
 }
}
assert.ok(rootVertices>20&&maxRootError<1e-5,'All hoist-edge vertices attach to the real timber staff');
for(let i=0;i<p.count;i+=3){
 const r=new THREE.Color(color.getX(i),color.getY(i),color.getZ(i));
 const key=Object.entries(expected).find(([,c])=>Math.abs(c.r-r.r)+Math.abs(c.g-r.g)+Math.abs(c.b-r.b)<1e-6)?.[0];assert.ok(key);
 for(let k=1;k<3;k++)assert.ok(Math.abs(color.getX(i+k)-r.r)+Math.abs(color.getY(i+k)-r.g)+Math.abs(color.getZ(i+k)-r.b)<1e-6,'Colour boundaries never interpolate into modern gradients');
 const u=[0,1,2].map(k=>uv.getX(i+k)),v=[0,1,2].map(k=>uv.getY(i+k));
 area[key]+=Math.abs((u[1]-u[0])*(v[2]-v[0])-(u[2]-u[0])*(v[1]-v[0]))*.5;
}
assert.ok(Math.abs(area.blue-.5)<1e-6&&Math.abs(area.white-.75)<1e-6&&Math.abs(area.red-.75)<1e-6,'Both flags have the correct quarter-area blue hoist and white/red equal remaining halves');
const rayChecks=[];
for(const [key,test]of Object.entries({white:(u,v)=>u>.7&&v<.3,red:(u,v)=>u>.7&&v>.7,blue:(u,v)=>u<.2&&v>.4&&v<.6})){
 let selected=-1;for(let i=0;i<p.count;i+=3){const u=(uv.getX(i)+uv.getX(i+1)+uv.getX(i+2))/3,v=(uv.getY(i)+uv.getY(i+1)+uv.getY(i+2))/3;if(test(u,v)){selected=i;break;}}
 assert.ok(selected>=0);
 const at=new THREE.Vector3(),normal=new THREE.Vector3();for(let k=0;k<3;k++){at.add(new THREE.Vector3().fromBufferAttribute(p,selected+k));normal.add(new THREE.Vector3().fromBufferAttribute(n,selected+k));}at.divideScalar(3);normal.normalize();
 for(const side of [-1,1]){
  const hit=new THREE.Raycaster(at.clone().addScaledVector(normal,side*.08),normal.clone().multiplyScalar(-side),0,.16).intersectObject(rayMesh)[0];assert.ok(hit,'Actual cotton is visible from both street sides');
  const hitColor=new THREE.Color(color.getX(hit.face.a),color.getY(hit.face.a),color.getZ(hit.face.a));const c=expected[key];assert.ok(Math.abs(hitColor.r-c.r)+Math.abs(hitColor.g-c.g)+Math.abs(hitColor.b-c.b)<1e-6);rayChecks.push({color:key,side});
 }
}
const shader={uniforms:{},vertexShader:'#include <common>\nvoid main(){\n#include <begin_vertex>\n}'};cloth.material.onBeforeCompile(shader);
assert.equal(shader.uniforms.uFlagTime,shared.time,'Flutter shares the engine time uniform with no CPU update callback');
assert.ok(shader.uniforms.uFlagStrength.value<=1);assert.equal(build.windEnabled,true);assert.equal(typeof build.update,'undefined');
assert.equal(createPragueFlags({id:'saint-clair'}),null);assert.equal(createPragueFlags({id:'la-varenne'}),null);assert.equal(createPragueFlags({id:'pont-tournant'}),null);
assert.throws(()=>createPragueFlags(L),/sampled terrain/);
assert.throws(()=>createPragueFlags(L,()=>100),/three metres/);
assert.throws(()=>createPragueFlags({...L,props:L.props.filter(p=>p.x!==-64)},L.baseHeight),/ordinary authored frontage/);
const stationary=createPragueFlags(L,L.baseHeight,{shared,wind:[0,0]});assert.equal(stationary.windEnabled,false);stationary.dispose();
const shifted={...L,props:L.props.map(p=>p.x===-19&&p.z===-32?{...p,y:p.y+1,yaw:0}:p)};
const moved=createPragueFlags(shifted,()=>0,{wind:[0,0]});
assert.deepEqual(moved.placements[0].wall,[-16.8,L.props.find(p=>p.x===-19&&p.z===-32).y+5.2,-27],'Mount transform follows its actual frontage yaw and explicit height');moved.dispose();
const report={flags:build.flags,draws:build.draws,triangles:build.triangles,clearance:build.clearance,rootVertices,maxRootError,uvAreas:area,rayChecks,placements};
console.log('prague-flags-check: '+JSON.stringify(report));
mat.dispose();build.dispose();assert.equal(build.group.children.length,0);
