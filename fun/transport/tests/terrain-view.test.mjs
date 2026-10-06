import test from 'node:test';
import assert from 'node:assert/strict';
import { TERRAIN_HEIGHT_KEY, loadTerrainHeight, normalizeTerrainHeight, saveTerrainHeight } from '../terrain-view.js';

test('terrain view preferences default safely and tolerate unavailable browser storage',()=>{
  const previous=globalThis.localStorage;
  try{
    const values=new Map();globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
    assert.equal(loadTerrainHeight(),24,'a new browser uses the existing Normal view');
    assert.ok(saveTerrainHeight(0));assert.equal(loadTerrainHeight(),0,'Flat survives browser storage');
    assert.equal(values.get(TERRAIN_HEIGHT_KEY),'0');
    values.set(TERRAIN_HEIGHT_KEY,'999');assert.equal(loadTerrainHeight(),24,'an invalid stored step cannot fold the terrain');
    values.set(TERRAIN_HEIGHT_KEY,'');assert.equal(loadTerrainHeight(),24);
    for(const invalid of[undefined,null,NaN,Infinity,32,-12,'steep',{},[]])assert.equal(normalizeTerrainHeight(invalid),24);
    globalThis.localStorage={getItem(){throw Error('unavailable');},setItem(){throw Error('unavailable');}};
    assert.equal(loadTerrainHeight(),24);assert.equal(saveTerrainHeight(12),false);
  }finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;}
});
