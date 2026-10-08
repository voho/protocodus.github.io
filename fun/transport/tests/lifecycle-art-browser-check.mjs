// Exercise the real scene cache and picking while calendar time replaces
// construction stages and tree crowns. Both art paths must remain read-only.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-lifecycle-art';
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [], profiles = [];
try {
  for (const dpr of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 720 }, deviceScaleFactor: dpr });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/lifecycle-art-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:0}canvas{width:1000px;height:720px;display:block}</style><canvas id="world"></canvas>' }));
    await page.goto(new URL('lifecycle-art-qa', base).href);
    await page.evaluate(async () => {
      const [{ createRenderer }, construction, trees, assets, houses] = await Promise.all([import('./renderer.js'), import('./building-construction.js'), import('./tree-lifecycle.js'), import('./atlas-runtime.js'), import('./raster-houses.js')]);
      await assets.preloadWorldArt({ cells: [16, 32, 64, 128, 256, 512], waitMs: 30000 });
      await houses.preloadHouseArt?.({ waitMs: 30000 });
      const game = { biome: 'taiga', seed: 1847, width: 96, height: 96, tiles: [], revision: 1, networkRevision: 1, day: 0, cities: [], industries: [], stations: [], routes: [], vehicles: [], zones: [], terrainObjects: [] };
      const clear = () => { game.day = 0; game.tiles = Array.from({ length: 96 * 96 }, (_, variant) => ({ terrain: 'grass', elevation: 0, detail: '', variant, cleared: true })); game.industries = []; game.revision++; construction.invalidateConstructionIndex(game); };
      clear(); const canvas = document.querySelector('canvas');
      const renderer = createRenderer(canvas, game, { layers: { grid: true, weather: false, names: false, industryIcons: false, routes: false } });
      const hash = () => { let n = 2166136261; for (const b of canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data) n = Math.imul(n ^ b, 16777619); return n >>> 0; };
      window.qa = { game, renderer, canvas, construction, trees, clear, hash };
    });
    for (const zoom of [.5, 1, 2]) for (const [kind, span, industry] of [['house-cheap-1',1,false], ['hospital',2,false], ['park-formal',2,false], ['equipment-factory',5,true], ['farm',5,true]]) {
      const record = await page.evaluate(({kind,span,industry,zoom}) => {
        const q=qa; q.clear(); q.game.biome='taiga';
        const entity={kind,level:1,footprint:span,owner:'player',id:'project',name:kind,x:35,y:35,stock:{},inputStock:{}};
        if(industry)q.game.industries.push(entity);else q.game.tiles[35*q.game.width+35].building=entity;
        q.construction.startConstruction(q.game,entity,{x:35,y:35});q.game.revision++;
        q.renderer.setZoom(zoom);const centre=35+(span-1)/2;q.renderer.focus(centre,centre);
        const duration=entity.construction.completeDay,stages=[];
        for(const fraction of [0,.4,.9,1]) {
          q.game.day=Math.ceil(duration*fraction);q.construction.stepBuildingConstruction(q.game);
          const before=JSON.stringify(q.game);q.renderer.render(1000,{settle:true});const first=q.hash();q.renderer.render(1000,{settle:true});const repeated=q.hash();
          q.renderer.focus(centre+9,centre-9);q.renderer.render(1000,{settle:true});q.renderer.focus(centre,centre);q.renderer.render(1000,{settle:true});const restored=q.hash();
          const picks=[];for(let y=35;y<35+span;y++)for(let x=35;x<35+span;x++){const p=q.renderer.worldToScreen(x,y),hit=q.renderer.screenToInspectTile(p.x,p.y);picks.push(hit&&hit.x===35&&hit.y===35);}
          stages.push({stage:q.construction.constructionState(q.game,entity)?.stage||'complete',first,repeated,restored,immutable:before===JSON.stringify(q.game),picks,image:q.canvas.toDataURL('image/png').split(',')[1]});
        }
        return {kind,span,industry,zoom,stages};
      },{kind,span,industry,zoom});
      const hashes=new Set();
      for(const stage of record.stages) {
        const label=`${kind}/${stage.stage}/zoom${zoom}/dpr${dpr}`;
        assert.equal(stage.first,stage.repeated,`${label}: paused render stable`);
        assert.equal(stage.first,stage.restored,`${label}: pan returns exact scene`);
        assert.ok(stage.immutable,`${label}: renderer never changes simulation`);
        assert.ok(stage.picks.every(Boolean),`${label}: entire reserved footprint inspects project`);
        hashes.add(stage.first);
        if(kind==='equipment-factory'||zoom===1)await writeFile(`${output}/${kind}-${stage.stage}-zoom${zoom}-dpr${dpr}.png`,Buffer.from(stage.image,'base64'));
        delete stage.image;
      }
      assert.equal(hashes.size,4,`${kind}/${zoom}/${dpr}: four distinct calendar stages`);profiles.push({...record,dpr});
    }
    for(const biome of ['taiga','tundra','desert'])for(const zoom of [.5,1,2]) {
      const record=await page.evaluate(({biome,zoom})=>{
        const q=qa;q.clear();q.game.biome=biome;const tile=q.game.tiles[35*q.game.width+35];Object.assign(tile,{terrain:'forest',detail:biome==='desert'?'acacia':'birch',treeBornDay:0});q.game.revision++;
        q.renderer.setZoom(zoom);q.renderer.focus(35,35);const stages=[];
        // No revision is published here: monthly visible-scene invalidation
        // alone must refresh art while retaining already composed terrain.
        for(const day of [0,400,1000,3000,3500,3650]){q.game.day=day;const before=JSON.stringify(q.game);q.renderer.render(1000,{settle:true});const first=q.hash();q.renderer.render(1000,{settle:true});stages.push({day,stage:q.trees.treeLifecycle(q.game,35,35).stage,first,repeated:q.hash(),immutable:before===JSON.stringify(q.game),chunks:q.renderer.getStats().composedChunks,image:q.canvas.toDataURL('image/png').split(',')[1]});}
        return {biome,zoom,stages};
      },{biome,zoom});
      assert.equal(new Set(record.stages.map(stage=>stage.first)).size,6,`${biome}/${zoom}/${dpr}: growth, maturity, old, fallen and empty are distinct`);
      for(const stage of record.stages){assert.equal(stage.first,stage.repeated);assert.ok(stage.immutable);if(zoom===2)await writeFile(`${output}/tree-${biome}-${stage.stage}-${stage.day}-dpr${dpr}.png`,Buffer.from(stage.image,'base64'));delete stage.image;}
      profiles.push({...record,dpr});
    }
    await page.close();
  }
  assert.deepEqual(errors,[]);
  await writeFile(`${output}/results.json`,JSON.stringify({profiles,errors},null,2)+'\n');
  console.log(JSON.stringify({output,buildingProfiles:profiles.filter(p=>p.kind).length,treeProfiles:profiles.filter(p=>p.biome).length,errors}));
}finally{await browser.close();}
