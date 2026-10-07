import test from 'node:test';
import assert from 'node:assert/strict';
import { TERRAIN_HEIGHT_KEY, loadTerrainHeight, normalizeTerrainHeight, saveTerrainHeight } from '../terrain-view.js';

test('terrain view preferences default safely and tolerate unavailable browser storage',()=>{
  const previous=globalThis.localStorage;
  try{
    const values=new Map();globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
    assert.equal(loadTerrainHeight(),12,'a new browser uses the Normal view');
    assert.ok(saveTerrainHeight(0));assert.equal(loadTerrainHeight(),0,'Flat survives browser storage');
    assert.equal(values.get(TERRAIN_HEIGHT_KEY),'0');
    values.set(TERRAIN_HEIGHT_KEY,'999');assert.equal(loadTerrainHeight(),12,'an invalid stored step cannot fold the terrain');
    values.set(TERRAIN_HEIGHT_KEY,'');assert.equal(loadTerrainHeight(),12);
    for(const invalid of[undefined,null,NaN,Infinity,32,-12,'steep',{},[]])assert.equal(normalizeTerrainHeight(invalid),12);
    globalThis.localStorage={getItem(){throw Error('unavailable');},setItem(){throw Error('unavailable');}};
    assert.equal(loadTerrainHeight(),12);assert.equal(saveTerrainHeight(12),false);
  }finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;}
});


test('older display preferences preserve their named terrain view without changing company saves',()=>{
  const previous=globalThis.localStorage;
  try{
    for(const [oldStep,newStep]of [[0,0],[12,6],[24,12],[28,14]]){
      const values=new Map([['transport-terrain-height-v1',String(oldStep)],['company-save','unchanged']]);
      globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
      assert.equal(loadTerrainHeight(),newStep);assert.equal(values.get(TERRAIN_HEIGHT_KEY),String(newStep));
      assert.equal(loadTerrainHeight(),newStep,'migration happens once even when Gentle used the new Normal value');
      assert.equal(values.get('company-save'),'unchanged');
      assert.ok(saveTerrainHeight(0));assert.equal(loadTerrainHeight(),0,'an explicit new preference takes priority over the old value');
    }
    globalThis.localStorage={getItem:key=>key==='transport-terrain-height-v1'?'28':null,setItem(){throw Error('quota');}};
    assert.equal(loadTerrainHeight(),14,'a failed migration write still preserves the selected view');
    globalThis.localStorage={getItem:key=>key==='transport-terrain-height-v1'?'constructor':null,setItem(){}};
    assert.equal(loadTerrainHeight(),12,'malformed legacy preferences default safely');
  }finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;}
});
