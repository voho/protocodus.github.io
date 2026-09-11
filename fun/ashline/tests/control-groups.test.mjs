import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,getEntity} from '../sim.js';
import {assignControlGroup,controlGroupMembers} from '../control-groups.js';
import {encodeGame,decodeGame} from '../save.js';

test('assigning a group moves members exclusively and replaces only its own prior selection',()=>{
  const game=createGame('exclusive-control-groups'),[a,b,c,d]=game.entities.filter(e=>e.team===0);
  const enemy=game.entities.find(e=>e.team===1);
  assert.deepEqual(assignControlGroup(game,[a.id,b.id],1),[a.id,b.id]);
  assert.deepEqual(assignControlGroup(game,[c.id,d.id],2),[c.id,d.id]);
  assert.deepEqual(assignControlGroup(game,[b.id,c.id,c.id,enemy.id,-1],3),[b.id,c.id]);
  assert.deepEqual(controlGroupMembers(game,1),[a.id]);assert.deepEqual(controlGroupMembers(game,2),[d.id]);assert.deepEqual(controlGroupMembers(game,3),[b.id,c.id]);
  assert.deepEqual(assignControlGroup(game,[a.id],3),[a.id]);
  assert.deepEqual(controlGroupMembers(game,1),[]);assert.deepEqual(controlGroupMembers(game,2),[d.id]);assert.deepEqual(controlGroupMembers(game,3),[a.id]);
  assert.equal(b.controlGroup,undefined);assert.equal(c.controlGroup,undefined);assert.equal(enemy.controlGroup,undefined);
  assignControlGroup(game,[],3);assert.deepEqual(controlGroupMembers(game,3),[],'Assigning an empty selection clears that group');
  const before=structuredClone(game.entities);
  for(const group of [0,6,1.5,NaN,null,'1']){assert.deepEqual(assignControlGroup(game,[a.id],group),[]);assert.deepEqual(controlGroupMembers(game,group),[]);}
  assert.deepEqual(game.entities,before,'Invalid shortcuts leave all existing assignments intact');
  assignControlGroup(game,[a.id,b.id],4);b.hp=0;
  assert.deepEqual(controlGroupMembers(game,4),[a.id],'Destroyed members cannot be recalled');
});

test('unit and building group assignments persist through saves and validate bounded group numbers',()=>{
  const game=createGame('saved-control-groups'),unit=game.entities.find(e=>e.team===0&&e.kind==='unit'),building=game.entities.find(e=>e.team===0&&e.kind==='building');
  assignControlGroup(game,[unit.id],5);assignControlGroup(game,[building.id],2);
  const raw=encodeGame(game),restored=decodeGame(raw).game;
  assert.deepEqual(controlGroupMembers(restored,5),[unit.id]);assert.deepEqual(controlGroupMembers(restored,2),[building.id]);
  assignControlGroup(restored,[unit.id,building.id],1);
  assert.deepEqual(controlGroupMembers(restored,5),[]);assert.deepEqual(controlGroupMembers(restored,2),[]);assert.deepEqual(new Set(controlGroupMembers(restored,1)),new Set([unit.id,building.id]));
  for(const invalid of [0,6,1.5,null,'2',true]){
    const data=JSON.parse(raw);data.game.entities.find(e=>e.id===unit.id).controlGroup=invalid;
    assert.throws(()=>decodeGame(JSON.stringify(data)),'Malformed group assignments must not enter a restored operation');
  }
  const legacy=JSON.parse(raw);for(const entity of legacy.game.entities)delete entity.controlGroup;
  assert.equal(getEntity(decodeGame(JSON.stringify(legacy)).game,unit.id).controlGroup,undefined,'Older saves remain unassigned and load normally');
});
