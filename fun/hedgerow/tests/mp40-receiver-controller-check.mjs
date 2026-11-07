// Paired real P.update inputs: visual candidate vs original static weapon.
import './three-hooks.mjs';
import {parseUntexturedGLB} from './rig-fixture.mjs';
import assert from 'node:assert/strict';
const THREE=await import('three'),{readSet}=await import('../js/assets.js'),{createPlayer}=await import('../js/player.js'),{createWorld}=await import('../js/world.js'),{createCameraRig}=await import('../js/camera.js'),{DEFAULT_SETTINGS}=await import('../js/config.js');
const {prepareMP40ReceiverDetail}=await import('../js/mp40-receiver-detail.js');
const originals=new Map();readSet(await parseUntexturedGLB('weapons'),'weapons',originals);const soldier=await parseUntexturedGLB('soldier'),noop=()=>{},services=new Proxy({},{get:()=>noop});
function game(candidate){
  const models=new Map(originals);if(candidate)models.set('mp40',prepareMP40ReceiverDetail(models.get('mp40')));
  const terrain={height:()=>0,normal:()=>[0,1,0],surfaceAt:()=> 'mud',raycast:()=>Infinity},bounds={minX:-30,maxX:30,minZ:-30,maxZ:30},world=createWorld({...bounds,terrain}),camera=new THREE.PerspectiveCamera(68,1.5,.05,200),events=[];
  const audio=new Proxy({},{get:(_,kind)=>(...args)=>{events.push({kind,time:G.time});}}),effects=new Proxy({},{get:(_,kind)=>(...args)=>events.push({kind,time:G.time})});
  const G={scene:new THREE.Scene(),camera,world,terrain,level:{playBounds:bounds,loadout:['mp40','kar98k'],playerOutfit:'axis'},soldier,models,matlib:{resolve:m=>m,get:()=>new THREE.MeshBasicMaterial()},rig:createCameraRig(camera,world),time:0,audio,effects,lights:services,hud:services,debris:{drop(o){o.parent?.remove(o);}},explosives:services,events:{emit:noop},shared:{wet:{value:.28}},enemies:[],stats:{shots:0,hits:0,damageTaken:0,grenades:0}};
  const P=createPlayer(G);G.player=P;P.reset([0,0,0]);
  let previousMouseL=false,pulled=false;
  const keys=new Set(),input={consumeMouse:()=>[0,0],consumeWheel:()=>0,held:()=>false,pressed:k=>keys.has(k),fired:()=>pulled,mouseR:false,mouseL:false};
  return{G,P,input,events,tick(key=null){if(key)keys.add(key);pulled=input.mouseL&&!previousMouseL;G.time+=1/120;P.update(1/120,input,DEFAULT_SETTINGS);previousMouseL=input.mouseL;keys.clear();},reset(saved=null){P.reset([0,0,0],saved);previousMouseL=false;}};
}
const previousRandom=Math.random;Math.random=()=>.5;
const pair=[game(false),game(true)],cases=[];let ticks=0;
const snapshot=g=>({weapon:g.P.weapon,ammo:g.P.ammo,reloading:g.P.reloading,cooldown:g.P.cooldown,shots:g.G.stats.shots,firedAt:g.P.firedAt,alive:g.P.alive,camera:g.G.camera.position.toArray(),cameraQuaternion:g.G.camera.quaternion.toArray(),muzzle:g.P.char.muzzleWorld(new THREE.Vector3()).toArray(),leftSocket:g.P.char.socketL.getWorldPosition(new THREE.Vector3()).toArray(),rightSocket:g.P.char.root.getObjectByName('socket_weapon').getWorldPosition(new THREE.Vector3()).toArray(),arms:g.P.arms,events:g.events});
function tick(key=null){for(const g of pair)g.tick(key);ticks++;assert.deepEqual(snapshot(pair[1]),snapshot(pair[0]),'geometry-only model retains every actual controller/camera/rig/event sample');}
function frames(n){for(let i=0;i<n;i++)tick();}
function record(name){cases.push({name,ticks,ammo:{...pair[1].P.ammo.mp40},reload:pair[1].P.reloading,shots:pair[1].G.stats.shots});}
try{
frames(90);record('ordinary ready');for(const g of pair)g.input.mouseR=true;frames(90);record('settled ADS');for(const g of pair)g.input.mouseL=true;frames(32);for(const g of pair){g.input.mouseL=false;g.input.mouseR=false;}frames(35);record('accepted shots and release');
tick('KeyR');frames(320);record('partial reload full lifecycle');for(const g of pair){g.P.ammo.mp40.mag=1;g.input.mouseL=true;}tick();frames(18);for(const g of pair)g.input.mouseL=false;frames(320);record('empty automatic reload full lifecycle');
tick('Digit2');frames(70);record('switch away');tick('Digit1');frames(70);record('switch back');tick('KeyC');frames(70);record('crouch');for(const g of pair)g.P.damage(200,null);tick();record('death');for(const g of pair)g.reset();frames(90);record('retry');
console.log(JSON.stringify({ticks,cases:cases.length,allExact:true}));
}finally{Math.random=previousRandom;for(const g of pair)g.P.char.dispose();}
