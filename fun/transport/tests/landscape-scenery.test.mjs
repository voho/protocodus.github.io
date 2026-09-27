import test from 'node:test';
import assert from 'node:assert/strict';
import { landscapeScenery } from '../landscape-scenery.js';
import { BIOME_NATURE } from '../terrain-sprites.js';

test('natural decoration favors varied local plants over sparse stones in every climate',()=>{
  for(const biome of ['taiga','tundra','desert']){
    const tile={terrain:biome==='desert'?'sand':'grass',detail:'glacial'},before=JSON.stringify(tile),types=new Set();let plants=0,stones=0;
    for(let y=0;y<96;y++)for(let x=0;x<96;x++){
      const item=landscapeScenery(biome,1847,x,y,tile);if(!item)continue;
      assert.deepEqual(item,landscapeScenery(biome,1847,x,y,tile));
      if(item.kind==='plant'){plants++;types.add(item.detail);assert.ok(BIOME_NATURE[biome].plants.includes(item.detail));}else stones++;
      assert.ok(item.alpha>0&&item.alpha<.5);
    }
    assert.ok(stones>0&&stones<96*96*.04);assert.ok(plants>stones*3);assert.ok(plants<96*96*.25);assert.ok(types.size>=5);
    assert.equal(JSON.stringify(tile),before);
  }
});

test('snow and dunes remain materials rather than repeated boulder sprites',()=>{
  for(const [biome,terrain,detail]of [['tundra','snow','snow'],['desert','sand','dunes']])for(let n=0;n<400;n++)assert.notEqual(landscapeScenery(biome,418,n%20,Math.floor(n/20),{terrain,detail})?.kind,'stone');
  for(const terrain of ['water','mountain','forest','rock'])assert.equal(landscapeScenery('taiga',418,10,10,{terrain,detail:'wildflowers'}),null);
  assert.equal(landscapeScenery('tundra',418,10,10,{terrain:'snow',detail:'glacier'}),null);
  for(let n=0;n<400;n++)assert.equal(landscapeScenery('taiga',1847,n%20,Math.floor(n/20),{terrain:'grass',detail:''}),null,'cleared tiles must stay bare');
});

test('lichen habitats have open ground and a varied mix of flowers and grasses',()=>{
  const counts=new Map();let covered=0;
  for(let y=0;y<96;y++)for(let x=0;x<96;x++){
    const item=landscapeScenery('tundra',1847,x,y,{terrain:'snow',detail:'lichen'});
    if(item){covered++;counts.set(item.detail,(counts.get(item.detail)||0)+1);}
  }
  assert.ok(covered<96*96*.3&&covered>96*96*.12);
  assert.ok(counts.size>=5);
  assert.ok(counts.get('lichen')<covered*.2);
  assert.ok(counts.get('arctic-poppies')+counts.get('cotton-grass')>covered*.4);
});
