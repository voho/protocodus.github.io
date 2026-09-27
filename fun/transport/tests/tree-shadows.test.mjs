import test from 'node:test';
import assert from 'node:assert/strict';
import {rasterForestComposition} from '../raster-nature.js';
import {forestComposition} from '../tree-sprites.js';
import {treeShadowGeometry,treeShadowBounds} from '../tree-shadows.js';

test('shadow layouts retain original woodland positions and stable grove/density variants',()=>{
  for(const biome of ['taiga','tundra','desert'])for(let variant=0;variant<64;variant++){
    assert.deepEqual(rasterForestComposition(biome,'mixed',variant),forestComposition(biome,'mixed',variant));
    for(const options of [{density:3},{footprint:2},{footprint:3}]){
      const trees=rasterForestComposition(biome,'mixed',variant,options);
      assert.deepEqual(trees,rasterForestComposition(biome,'mixed',variant+64,options));
      assert.equal(trees.length,options.footprint===3?11+variant%5:options.footprint===2?6+variant%3:5);
      assert.ok(trees.every((tree,i)=>!i||tree.y>=trees[i-1].y));
    }
  }
});

test('each shadow is grounded at its own trunk, casts southeast and preserves input geometry',()=>{
  for(const biome of ['taiga','tundra','desert'])for(const footprint of [1,2,3]){
    const trees=rasterForestComposition(biome,'mixed',6,{footprint}),before=structuredClone(trees);
    const shadows=trees.map(tree=>treeShadowGeometry(tree,biome)),bounds=treeShadowBounds(shadows);
    assert.deepEqual(trees,before);assert.ok(bounds.right>bounds.left&&bounds.bottom>bounds.top);
    shadows.forEach((shadow,i)=>{
      const tree=trees[i];assert.ok(Math.hypot(shadow.contact.x-tree.x,shadow.contact.y-tree.y)<.5);
      assert.ok(shadow.lobes.every(p=>p.x>tree.x&&p.y>tree.y&&p.alpha>0&&p.alpha<=.09));
      assert.ok(shadow.lobes.every(p=>p.x>bounds.left&&p.x<bounds.right&&p.y>bounds.top&&p.y<bounds.bottom));
    });
  }
});

test('sparse branches and snow receive restrained shade while crown shapes remain distinct',()=>{
  const tree={x:16,y:24,size:25,species:'oak',seed:731,bare:false};
  const oak=treeShadowGeometry(tree),pine=treeShadowGeometry({...tree,species:'pine'}),bare=treeShadowGeometry({...tree,bare:true}),snow=treeShadowGeometry(tree,'tundra');
  assert.ok(oak.lobes[0].ry>pine.lobes[0].ry);assert.ok(bare.lobes[0].ry<pine.lobes[0].ry);
  assert.ok(bare.lobes[0].alpha<oak.lobes[0].alpha);assert.ok(snow.lobes[0].alpha<oak.lobes[0].alpha);
  assert.equal(treeShadowGeometry(tree,'taiga',{contact:false}).contact,null,'fallback trees retain their original contact shade');
});
