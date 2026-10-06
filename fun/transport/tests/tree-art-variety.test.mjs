import test from 'node:test';
import assert from 'node:assert/strict';
import { TREE_KINDS, ORIGINAL_TREE_KINDS, EXTRA_TREE_ART, HOLLOW_TREE_ART, CACTUS_ART, TREE_ART_SCALE, CACTUS_ART_SCALE } from '../tree-art-catalog.js';
import { BIOME_NATURE } from '../terrain-sprites.js';
import { forestComposition } from '../tree-sprites.js';
import { rasterForestComposition, rasterTreeIdentity, rasterTreeShadowRecord, rasterCactusIdentity, nativeNatureDetail, drawNativeHollowTree, drawRasterNature, drawRasterNatureObject } from '../raster-nature.js';
import { preloadWorldArt, worldArtStats } from '../atlas-runtime.js';
import { treeShadowGeometry } from '../tree-shadows.js';

for (const biome of Object.keys(TREE_KINDS)) {
  test(`${biome} woodland reaches all authored species with stable geometry and seed selection`, () => {
    assert.equal(ORIGINAL_TREE_KINDS[biome].length+EXTRA_TREE_ART[biome].length, ORIGINAL_TREE_KINDS[biome].length * 3);
    assert.equal(TREE_KINDS[biome].length,ORIGINAL_TREE_KINDS[biome].length*3+(biome==='tundra'?HOLLOW_TREE_ART.length:0));
    const all = new Set(TREE_KINDS[biome].map(kind=>`nature-trees-${biome}:${kind}`));
    const added = new Set(EXTRA_TREE_ART[biome].map(tree=>`nature-trees-${biome}:${tree.id}`));
    for (const options of [{},{density:3},{footprint:2},{footprint:3}]) {
      const seen = new Set(); let mature=0, expanded=0;
      for (const detail of BIOME_NATURE[biome].trees) for (let variant=0;variant<64;variant++) {
        const trees=rasterForestComposition(biome,detail,variant,options),before=structuredClone(trees);
        const identities=trees.map(tree=>rasterTreeIdentity(tree,biome));
        assert.deepEqual(identities,rasterForestComposition(biome,detail,variant+64,options).map(tree=>rasterTreeIdentity(tree,biome)));
        assert.deepEqual(identities,rasterForestComposition(biome,detail,variant-64,options).map(tree=>rasterTreeIdentity(tree,biome)));
        assert.deepEqual(trees,before,'choosing art does not rewrite native fallback or shadow records');
        if (!options.density&&!options.footprint) assert.deepEqual(trees,forestComposition(biome,detail,variant),'published single-tile placements and sizes remain exact');
        identities.forEach((id,i)=>{
          assert.ok(all.has(id),id);seen.add(id);
          if (id.includes(':hollow-')) assert.equal(trees[i].bare,true,'hollow trees occur only among existing bare woodland');
          if (!trees[i].bare&&trees[i].size>=12) { mature++; if(added.has(id))expanded++; }
        });
      }
      for (const id of added) assert.ok(seen.has(id),`${id} is reachable in ${JSON.stringify(options)}`);
      if (!options.density&&!options.footprint) assert.deepEqual(seen,all,'ordinary woodland retains every original stage as well as new species');
      assert.ok(expanded/mature>.55&&expanded/mature<.8,'expanded species are prominent while original mature trees remain visible');
    }
  });

  test(`${biome} bare trunks and juvenile stages keep their established identities`, () => {
    const young=biome==='desert'?{palm:'small-palm',joshua:'small-joshua'}:{pine:'sapling',spruce:'sapling',fir:'sapling',larch:'sapling'};
    for (const species of ORIGINAL_TREE_KINDS[biome]) for (let seed=0;seed<64;seed++) {
      const tree={species,seed,size:10,bare:false,x:16,y:27};
      assert.equal(rasterTreeIdentity(tree,biome),`nature-trees-${biome}:${young[species]||species}`);
      const bare=seed%3===0?'deadwood':biome==='desert'?'bare-acacia':'bare-birch';
      assert.equal(rasterTreeIdentity({...tree,bare:true},biome),`nature-trees-${biome}:${bare}`,'juvenile bare trees retain their old stages');
      const mature=rasterTreeIdentity({...tree,size:24,bare:true},biome);
      if (mature.includes(':hollow-')) assert.equal(biome,'tundra');
      else assert.equal(mature,`nature-trees-${biome}:${bare}`);
    }
  });
}

test('hollow trunks are sparse additions to mature bare tundra woodland', () => {
  const seen=new Set();let hollows=0,bare=0;
  for (const detail of BIOME_NATURE.tundra.trees) for (let variant=0;variant<64;variant++) for (const tree of rasterForestComposition('tundra',detail,variant)) {
    const id=rasterTreeIdentity(tree,'tundra');
    if (id.includes(':hollow-')) { assert.ok(tree.bare&&tree.size>=12);hollows++;seen.add(id); }
    if (tree.bare&&tree.size>=12)bare++;
  }
  assert.ok(hollows/bare>.15&&hollows/bare<.35,'most established bare woodland retains its original silhouettes');
  assert.deepEqual(seen,new Set(HOLLOW_TREE_ART.map(tree=>`nature-trees-tundra:${tree.id}`)));
});

test('named hollow tree fallback retains bare branches, its calibrated root and a visible cavity', () => {
  for (const tree of HOLLOW_TREE_ART) {
    const fills=[],strokes=[],roots=[],ellipses=[];
    const c={save(){},restore(){},translate(x,y){roots.push([x,y]);},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){strokes.push(this.strokeStyle);},fill(){fills.push(this.fillStyle);},fillRect(){fills.push(this.fillStyle);},ellipse(...args){ellipses.push(args);}};
    assert.equal(drawNativeHollowTree(c,tree.id,'tundra',6),true);
    assert.deepEqual(roots,[[16,27]],'the native and authored individual tree use the same root anchor');
    assert.ok(strokes.length>10,'the fallback retains its exposed branch skeleton');
    assert.ok(fills.includes('#334039'),'a simple dark opening makes the hollow recognizable');
    const cavity=ellipses.at(-1);
    assert.equal(cavity[0],16);assert.ok(cavity[1]<27&&cavity[1]>20&&cavity[2]>0&&cavity[3]>cavity[2]);
    assert.ok(fills.every(color=>['#283e302b','#a7986580','#b9bba5','#827961','#334039'].includes(color)),'bare fallback never adds a leafy crown');
    assert.equal(drawNativeHollowTree(c,'pine','tundra',6),false,'ordinary tree fallbacks remain with the existing renderer');
  }
});

test('existing desert cactus parcels select all new cacti stably while named previews stay exact', () => {
  const all=new Set(CACTUS_ART.map(plant=>`nature-ground-desert:${plant.id}`));
  for (const detail of ['cactus','prickly-pear']) {
    const seen=new Set();
    for (let variant=0;variant<64;variant++) {
      const id=rasterCactusIdentity(detail,variant);seen.add(id);
      assert.equal(id,rasterCactusIdentity(detail,variant+64));assert.equal(id,rasterCactusIdentity(detail,variant-64));
      assert.equal(nativeNatureDetail(detail),detail,'native saved vegetation keeps its original detail');
    }
    assert.deepEqual(seen,new Set([...all,`nature-ground-desert:${detail}`]));
  }
  for (const plant of CACTUS_ART) for (let variant=0;variant<64;variant++) {
    assert.equal(rasterCactusIdentity(plant.id,variant),`nature-ground-desert:${plant.id}`);
    assert.equal(nativeNatureDetail(plant.id),'cactus','new cactus names have a recognizable existing native fallback');
  }
  assert.equal(rasterCactusIdentity('agave',4),null);assert.equal(nativeNatureDetail('agave'),'agave');
});

test('exact tree previews, partial-download fallback and calibrated shadows use the selected identity', async () => {
  const previousImage=globalThis.Image;let missingVarieties=true;
  globalThis.Image=class {
    set src(value) {
      this._src=value;
      queueMicrotask(()=>{
        if (missingVarieties&&/\/(variety-\d+|hollow|cacti)\//.test(value)) { this.onerror?.();return; }
        const cell=Number(value.match(/atlas-(\d+)\.png$/)[1]);
        this.naturalWidth=3*cell;this.naturalHeight=(value.includes('/hollow/')?1:3)*cell;this.onload?.();
      });
    }
    get src() { return this._src; }
    async decode() {}
  };
  const calls=[],context={save(){},restore(){},beginPath(){},rect(){},clip(){},drawImage(...args){calls.push(args);}};
  try {
    await preloadWorldArt({biome:'taiga',cells:[16]});
    const sample=rasterForestComposition('taiga','pine',0,{footprint:2}).find(tree=>!ORIGINAL_TREE_KINDS.taiga.includes(rasterTreeIdentity(tree,'taiga').split(':')[1]));
    assert.ok(sample,'the fallback case includes added tree artwork');
    assert.equal(rasterTreeShadowRecord(sample,'taiga'),sample,'unavailable new artwork retains the native height and crown profile');
    assert.equal(drawRasterNatureObject(context,'forest','taiga','pine',0,2),false);
    assert.equal(calls.length,0,'an incomplete grove draws wholly through the native fallback without partial authored trees');
    const firstAdded=EXTRA_TREE_ART.taiga[0].id;
    assert.equal(drawRasterNature(context,'tree','taiga',firstAdded,0),false,'missing individual art also reports a native fallback');
    await preloadWorldArt({biome:'desert',cells:[16]});
    const cactusVariant=Array.from({length:64},(_,v)=>v).find(v=>rasterCactusIdentity('cactus',v)!=='nature-ground-desert:cactus');
    assert.equal(drawRasterNature(context,'terrain-detail','desert','cactus',cactusVariant),false,'a missing new cactus sheet reports the original native patch fallback');
    assert.equal(drawRasterNature(context,'terrain-detail','desert',CACTUS_ART[0].id,0),false,'named cactus previews have the same missing-art fallback');
    missingVarieties=false;
    await preloadWorldArt({cells:[16,32,64,128,256],retry:true});
    assert.deepEqual(worldArtStats().errors,[],'retry replaces failed new sheets without affecting existing atlases');
    for (const biome of Object.keys(TREE_KINDS)) for (const [index,species] of TREE_KINDS[biome].entries()) for (const variant of [0,1,16,63]) {
      calls.length=0;
      assert.equal(drawRasterNature(context,'tree',biome,species,variant),true);
      assert.equal(rasterTreeIdentity({species,seed:variant,size:22,bare:false},biome,true),`nature-trees-${biome}:${species}`);
      const [image,sx,sy,cell]=calls[0],slot=index>=27?index-27:index%9;
      const path=index<9?`/nature-trees-${biome}/atlas-`:index>=27?`/nature-trees-${biome}/hollow/atlas-`:`/nature-trees-${biome}/variety-${1+Math.floor((index-9)/9)}/atlas-`;
      assert.ok(image.src.includes(path),`${species} previews its requested sheet`);
      assert.equal(sx,slot%3*cell);assert.equal(sy,Math.floor(slot/3)*cell,'requested species previews its exact slot at every seed');
    }
    for (const biome of Object.keys(TREE_KINDS)) {
      const added=[...EXTRA_TREE_ART[biome],...(biome==='tundra'?HOLLOW_TREE_ART:[])];
      const byKind=new Map(added.map(tree=>[tree.id,tree]));
      const seen=new Set();
      for (const detail of BIOME_NATURE[biome].trees) for (let variant=0;variant<64;variant++) for (const tree of rasterForestComposition(biome,detail,variant)) {
        const art=byKind.get(rasterTreeIdentity(tree,biome).split(':')[1]);
        const shadow=rasterTreeShadowRecord(tree,biome);
        if (!art) { assert.equal(shadow,tree);continue; }
        seen.add(art.id);
        assert.equal(shadow.species,art.id);assert.equal(shadow.size,tree.size*art.heightMetres/TREE_ART_SCALE.nominalReferenceHeightMetres);
        assert.deepEqual([shadow.x,shadow.y,shadow.seed,shadow.bare],[tree.x,tree.y,tree.seed,tree.bare]);
        assert.ok(treeShadowGeometry(shadow,biome).lobes[0].rx<treeShadowGeometry(tree,biome).lobes[0].rx,'shorter calibrated trees cast proportionate shadows');
      }
      assert.equal(seen.size,added.length,'every added crown or hollow trunk can receive its calibrated shadow');
    }
    for (const [slot,plant] of CACTUS_ART.entries()) for (const variant of [0,1,16,63]) {
      calls.length=0;
      assert.equal(drawRasterNature(context,'terrain-detail','desert',plant.id,variant),true);
      assert.equal(calls.length,1+variant%3);
      for (const [image,sx,sy,cell,,x,y,width,height] of calls) {
        assert.ok(image.src.includes('/nature-ground-desert/cacti/atlas-'));
        assert.equal(sx,slot%3*cell);assert.equal(sy,Math.floor(slot/3)*cell);
        assert.equal(width,CACTUS_ART_SCALE.nominalSpriteSize);assert.equal(height,CACTUS_ART_SCALE.nominalSpriteSize,'short and tall cacti use the same calibrated envelope');
        assert.ok(x>=.5&&y>=.5&&x+width<=31.5&&y+height<=31.5,'the full calibrated cactus remains inside its ground tile');
      }
    }
  } finally {
    if(previousImage===undefined)delete globalThis.Image;else globalThis.Image=previousImage;
  }
});
