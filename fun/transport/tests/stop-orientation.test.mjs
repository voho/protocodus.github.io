import test from 'node:test';
import assert from 'node:assert/strict';
import { stopOrientation } from '../stop-orientation.js';

function fixture(mode, arms) {
  const width=24,height=24,station={x:12,y:12,mode},game={width,height,revision:1,tiles:Array.from({length:width*height},()=>({terrain:'grass',elevation:2/7}))};
  game.tiles[12*width+12][mode]=true;
  for(const [dx,dy]of arms)game.tiles[(12+dy)*width+12+dx][mode]=true;
  return {game,station};
}

test('road and rail shelters follow either end of each connected axis without changing the saved stop',()=>{
  for(const mode of ['road','rail'])for(const [axis,arms]of [['x',[[-1,0]]],['x',[[1,0]]],['x',[[-1,0],[1,0]]],['y',[[0,-1]]],['y',[[0,1]]],['y',[[0,-1],[0,1]]]]){
    const {game,station}=fixture(mode,arms),before=structuredClone(game),saved=structuredClone(station),layout=stopOrientation(game,station);
    assert.equal(layout.axis,axis);assert.deepEqual(game,before);assert.deepEqual(station,saved);
    const distance=axis==='x'?station.y-layout.y:station.x-layout.x;
    assert.ok(distance>.3&&distance<.4,'platform lies alongside its mode’s carriageway/ballast');
    assert.equal(axis==='x'?layout.x:layout.y,12,'sideways offset does not move the stop along its route');
  }
});

test('junctions favor their through axis, corners and full crossings are deterministic',()=>{
  for(const mode of ['road','rail'])for(const [arms,axis,side]of [
    [[[-1,0],[1,0],[0,-1]],'x',1],[[[-1,0],[1,0],[0,1]],'x',-1],
    [[[0,-1],[0,1],[-1,0]],'y',1],[[[0,-1],[0,1],[1,0]],'y',-1],
    [[[1,0],[0,1]],'x',-1],[[[-1,0],[0,-1]],'x',1],
    [[[-1,0],[1,0],[0,-1],[0,1]],'x',-1],
  ]){
    const {game,station}=fixture(mode,arms),layout=stopOrientation(game,station);
    assert.equal(layout.axis,axis);assert.equal(Math.sign((axis==='x'?layout.y:layout.x)-12),side,'use the side without a perpendicular arm');
    if(arms.length===4)assert.ok(layout.x+(mode==='rail'?7:4)/16<12-(mode==='rail'?2.6:4)/16,'platform end clears the perpendicular crossing');
  }
});

test('other modes and disconnected structure sides cannot orient a stop',()=>{
  for(const mode of ['road','rail']){
    const {game,station}=fixture(mode,[[0,1]]),other=mode==='road'?'rail':'road';
    for(const dx of [-1,1])game.tiles[12*game.width+12+dx][other]=true;
    assert.equal(stopOrientation(game,station).axis,'y');
    for(const dx of [-1,1])Object.assign(game.tiles[12*game.width+12+dx],{[mode]:true,bridge:true,structureAxis:'y',structureLevel:5});
    assert.equal(stopOrientation(game,station).axis,'y','an adjacent bridge that runs past the stop is not a connected arm');
  }
});

test('live network edits reorient existing stops and isolated stops retain a stable fallback',()=>{
  const {game,station}=fixture('road',[[1,0]]);
  assert.equal(stopOrientation(game,station).axis,'x');
  game.tiles[12*game.width+13].road=false;game.tiles[13*game.width+12].road=true;game.revision++;
  assert.equal(stopOrientation(game,station).axis,'y');
  game.tiles[13*game.width+12].road=false;
  assert.equal(stopOrientation(game,station).axis,'x');
});
