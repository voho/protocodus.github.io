// Elevation integration in isolated browser contexts; no user save is touched.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { MAP } from '../design-tokens.js';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const viaductOnly = process.env.TRANSPORT_GEOMETRY_VIADUCT_ONLY === '1';
const output = process.env.TRANSPORT_SCREENSHOTS || `/tmp/transport-terrain-geometry-renderer${viaductOnly ? '-viaduct' : ''}`;
await mkdir(output, { recursive: true });
const errors = [], profiles = [], galleries = [], viaducts = [];let huge;
try {
  for (const dpr of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: dpr });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/terrain-geometry-renderer-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:0;background:#758464}canvas{display:block;width:1100px;height:800px}</style><canvas></canvas>' }));
    await page.goto(new URL('terrain-geometry-renderer-qa', base).href);
    await page.evaluate(async () => {
      const { createGame } = await import('./model.js'), { createRenderer } = await import('./renderer.js'), geometry = await import('./terrain-geometry.js'), { preloadWorldArt } = await import('./atlas-runtime.js');
      await preloadWorldArt({ waitMs: 12000 });
      const game = createGame({ size: 'regional', seed: 1847 }), canvas = document.querySelector('canvas');
      for (const key of ['cities', 'industries', 'stations', 'routes', 'vehicles', 'zones']) game[key] = [];
      for (let y = 0; y < game.height; y++) for (let x = 0; x < game.width; x++) {
        const t = game.tiles[y * game.width + x], hill = Math.max(2.5, 5 - Math.max(Math.abs(x - 56), Math.abs(y - 50)) * .5), valley = Math.max(0, 2.5 - Math.max(Math.abs(x - 69), Math.abs(y - 61)) * .5);
        Object.assign(t, { terrain: hill > 3.2 ? 'mountain' : 'grass', elevation: (hill - valley) / 5, detail: '', variant: 0, building: null, zone: null, road: false, rail: false, bridge: false, tunnel: false, publicRoad: false });
        delete t.terrainObject;delete t.structureAxis;delete t.structureLevel;
        if (x >= 43 && x <= 45) { t.terrain = 'water'; t.elevation = 0; }
      }
      for (let x = 36; x <= 63; x++) { const t = game.tiles[51 * game.width + x]; t.road = true; if (x >= 43 && x <= 45) Object.assign(t, { bridge: true, structureAxis: 'x', structureLevel: 8 }); }
      game.revision++;game.day=0;
      const layers = { trees: false, buildings: false, zones: false, names: false, industryIcons: false, stations: false, vehicles: false, vehicleLoads: false, routes: false, grid: false, roads: true, rails: true };
      const renderer = createRenderer(canvas, game, { layers });
      window.elevationQA = { game, control: game, canvas, renderer, createGame, geometry, layers };
    });
    // Tall decks overlap a different ground tile in projection. Test the
    // visible road/rail strip, then the ground exposed by hiding its layer.
    viaducts.push(...await page.evaluate(dpr => {
      const q=elevationQA,{renderer:r,game:original,geometry:k,canvas}=q,rect=canvas.getBoundingClientRect(),results=[];
      for(const [axis,mode,layer]of[['x','road','roads'],['y','rail','rails']]){
        const g={...original,tiles:original.tiles.map((tile,id)=>{
          const t={...tile},coordinate=axis==='x'?id%original.width:Math.floor(id/original.width),height=Math.min(4,Math.max(0,Math.abs(coordinate-48)-6)*.5);
          Object.assign(t,{terrain:'grass',elevation:height/5,detail:'',building:null,zone:null,road:false,rail:false,bridge:false,tunnel:false,publicRoad:false});delete t.terrainObject;delete t.structureAxis;delete t.structureLevel;return t;
        })};
        for(let n=24;n<=72;n++){
          const x=axis==='x'?n:64,y=axis==='y'?n:64,t=g.tiles[y*g.width+x];t[mode]=true;
          if(n>24&&n<72)Object.assign(t,{bridge:true,structureAxis:axis,structureLevel:13});
        }
        g.revision++;r.setGame(g);
        for(const zoom of [.5,1,2]){
          const x=axis==='x'?48:64,y=axis==='y'?48:64;
          r.setZoom(zoom);r.focus(x,y);r.setLayers({...q.layers,roads:mode==='road',rails:mode==='rail'});r.render(0);
          const deckHeight=k.bridgeDeckHeight(g,x,y,mode),groundHeight=k.surfaceHeight(g,x+.5,y+.5),samples=[];
          for(const offset of[-.35,0,.35]){
            const sx=x+(axis==='x'?offset:0),sy=y+(axis==='y'?offset:0),screen=r.worldToScreen(sx,sy);
            screen.y+=(k.surfaceHeight(g,sx+.5,sy+.5)-deckHeight)*k.HEIGHT_STEP*zoom;
            const deck=k.projectTerrainPoint(sx+.5,sy+.5,deckHeight),ground=k.pickGround(g,deck.x,deck.y);
            samples.push({screen,shown:r.screenToTile(rect.left+screen.x,rect.top+screen.y),expectedDeck:{x,y},expectedGround:{x:Math.floor(ground.x),y:Math.floor(ground.y)}});
          }
          r.setLayers({[layer]:false});r.render(0);
          for(const sample of samples)sample.hidden=r.screenToTile(rect.left+sample.screen.x,rect.top+sample.screen.y);
          r.setLayers({[layer]:true});r.render(0);
          for(const sample of samples)sample.restored=r.screenToTile(rect.left+sample.screen.x,rect.top+sample.screen.y);
          results.push({dpr,zoom,axis,mode,deckHeight,groundHeight,samples});
        }
      }
      r.setGame(original);r.setLayers(q.layers);return results;
    },dpr));
    if(viaductOnly){await page.close();continue;}
    for (const zoom of [.5, 1, 2]) {
      const result = await page.evaluate(({ zoom, dpr, hoverColor }) => {
        const q=elevationQA,{renderer:r,game:g,canvas,geometry:k}=q,rect=canvas.getBoundingClientRect(),c=canvas.getContext('2d'),checks=[],vertexChecks=[];
        r.setZoom(zoom);
        for(const [x,y]of[[56,50],[69,61],[43,51],[46,51],[55.2,49.83],[64,36]]){
          r.focus(x,y);const p=r.worldToScreen(x,y),picked=r.screenToTile(rect.left+p.x,rect.top+p.y);
          checks.push({x,y,picked,expected:{x:Math.floor(x+.5),y:Math.floor(y+.5)},focusError:Math.max(Math.abs(p.x-550),Math.abs(p.y-400))});
        }
        for(const [x,y]of[[56,50],[69,61],[43,51],[46,51],[64,36]]){
          r.focus(x-.5,y-.5);const p=r.gridPointToScreen(x,y);
          vertexChecks.push({expected:{x,y},picked:r.screenToVertex(rect.left+p.x,rect.top+p.y)});
        }
        r.focus(56,50);const panBefore=r.worldToScreen(55,50);r.pan(73,-41);const panAfter=r.worldToScreen(55,50);
        r.focus(56,50);const anchor=r.worldToScreen(58.17,51.36),next=zoom===2?.5:2;r.setZoom(next,rect.left+anchor.x,rect.top+anchor.y);const anchored=r.worldToScreen(58.17,51.36);
        const anchorError=Math.max(Math.abs(anchored.x-anchor.x),Math.abs(anchored.y-anchor.y));r.setZoom(zoom);r.focus(56,50);
        const original={beginPath:c.beginPath,moveTo:c.moveTo,lineTo:c.lineTo,stroke:c.stroke};let path=[];const strokes=[];
        c.beginPath=function(){path=[];return original.beginPath.call(this);};
        for(const name of ['moveTo','lineTo'])c[name]=function(x,y){const m=this.getTransform();path.push({x:(m.a*x+m.c*y+m.e)/dpr,y:(m.b*x+m.d*y+m.f)/dpr});return original[name].call(this,x,y);};
        // The grid is a cached Path2D: record its points while a new revision rebuilds it.
        const recorded=new WeakMap(),path2d={moveTo:Path2D.prototype.moveTo,lineTo:Path2D.prototype.lineTo};
        for(const name of ['moveTo','lineTo'])Path2D.prototype[name]=function(x,y){if(!recorded.has(this))recorded.set(this,[]);recorded.get(this).push([x,y]);return path2d[name].call(this,x,y);};
        c.stroke=function(shape){const m=this.getTransform(),points=shape?(recorded.get(shape)||[]).map(([x,y])=>({x:(m.a*x+m.c*y+m.e)/dpr,y:(m.b*x+m.d*y+m.f)/dpr})):path.slice();strokes.push({style:this.strokeStyle,points});return shape?original.stroke.call(this,shape):original.stroke.call(this);};
        g.revision++;
        try{r.render(0,{tool:'inspect',hover:{x:56,y:50},showGrid:true});}finally{Object.assign(c,original);Object.assign(Path2D.prototype,path2d);}
        const grid=strokes.find(s=>s.points.length>100),highlight=strokes.find(s=>s.style===hoverColor&&s.points.length===4),expectedCorners=[[56,50],[57,50],[57,51],[56,51]].map(([u,v])=>r.worldToScreen(u-.5,v-.5));
        const nearest=(points,p)=>Math.min(...points.map(q=>Math.hypot(q.x-p.x,q.y-p.y)));
        const gridError=grid?Math.max(...expectedCorners.map(p=>nearest(grid.points,p))):Infinity;
        const expectedHighlight=r.gridPointToScreen(56,50),highlightError=highlight?nearest(highlight.points,expectedHighlight):Infinity;
        const chunk=r.getStats().chunkTiles,edit={x:chunk*12,y:chunk*6};g.tiles[edit.y*g.width+edit.x].elevation=3/7;g.revision++;r.focus(edit.x,edit.y);r.render(0);r.render(0);
        const oldComposed=r.getStats().composedChunks,before=c.getImageData(0,0,canvas.width,canvas.height).data,groundBefore=r.worldToScreen(edit.x-.25,edit.y-.25);
        g.tiles[edit.y*g.width+edit.x].elevation=4/7;g.revision++;r.render(0);
        const after=c.getImageData(0,0,canvas.width,canvas.height).data,groundAfter=r.worldToScreen(edit.x-.25,edit.y-.25),rebuilt=r.getStats().composedChunks-oldComposed;let changedPixels=0;
        for(let n=0;n<before.length;n+=4)if(Math.abs(before[n]-after[n])+Math.abs(before[n+1]-after[n+1])+Math.abs(before[n+2]-after[n+2])>6)changedPixels++;
        const warmed=r.getStats().composedChunks;r.render(0);const warmRebuilds=r.getStats().composedChunks-warmed;
        r.focus(0,0);let outside=null;try{outside={picked:r.screenToTile(rect.left+1000,rect.top+20)};}catch(e){outside={error:e.message};}
        r.focus(44,51);r.setLayers({roads:false});r.render(0);const noRoad=c.getImageData(0,0,canvas.width,canvas.height).data;r.setLayers({roads:true});r.render(0);const roadPixels=c.getImageData(0,0,canvas.width,canvas.height).data,bridgeInk=[];
        for(let n=0;n<=44;n++){
          const x=41.8+n*.1,p=r.worldToScreen(x,51);p.y+=(k.surfaceHeight(g,x+.5,51.5)-k.transportHeight(g,x,51))*k.HEIGHT_STEP*zoom;
          const px=Math.round(p.x*dpr),py=Math.round(p.y*dpr);let contrast=0;
          for(let dy=-dpr;dy<=dpr;dy++)for(let dx=-dpr;dx<=dpr;dx++){const i=((py+dy)*canvas.width+px+dx)*4;contrast=Math.max(contrast,Math.abs(roadPixels[i]-noRoad[i])+Math.abs(roadPixels[i+1]-noRoad[i+1])+Math.abs(roadPixels[i+2]-noRoad[i+2]));}
          bridgeInk.push(contrast);
        }
        r.focus(56,50);r.render(0,{showGrid:true});const stats=r.getStats();
        return{zoom,dpr,checks,vertexChecks,pan:{x:panAfter.x-panBefore.x,y:panAfter.y-panBefore.y},anchorError,gridError,highlightError,rebuilt,warmRebuilds,changedPixels,cornerShift:groundAfter.y-groundBefore.y,outside,bridgeInk,stats};
      }, { zoom, dpr, hoverColor: MAP.hover.color.toLowerCase() });
      profiles.push(result);await page.locator('canvas').screenshot({path:`${output}/controlled-hill-valley-zoom${zoom}-dpr${dpr}.png`});
    }
    const foundation = await page.evaluate(async () => {
      const {SPRITE_SCALE}=await import('./sprite-art-direction.js'),frame=SPRITE_SCALE.billboardPixelsPerTile;
      const q=elevationQA,{game:g,renderer:r,canvas,geometry:k}=q,x=72,y=54,span=3,c=canvas.getContext('2d');
      for(let dy=-2;dy<5;dy++)for(let dx=-2;dx<5;dx++){const t=g.tiles[(y+dy)*g.width+x+dx];t.elevation=3/7;t.terrain='grass';}
      g.tiles[y*g.width+x].building={kind:'stadium',level:1,footprint:span};g.tiles[(y+1)*g.width+x+1].elevation=4/7;g.revision++;r.setLayers({buildings:true});r.setZoom(2);r.focus(x+1,y+1);
      const original=c.drawImage;let imageY;
      c.drawImage=function(image,...args){if(args.length===4&&args[2]===frame*span&&args[3]===frame*(span+.25))imageY=args[1];return original.call(this,image,...args);};
      try{r.render(0);}finally{c.drawImage=original;}
      let maximum=0;for(let dy=0;dy<span;dy++)for(let dx=0;dx<span;dx++)for(const p of [...k.tileSurface(g,x+dx,y+dy).corners,k.tileSurface(g,x+dx,y+dy).center])maximum=Math.max(maximum,p.height);
      const expected=(x+y+span)*16-maximum*k.HEIGHT_STEP-frame*(.75*span+.25);
      return{imageY,expected,error:Math.abs(imageY-expected)};
    });
    profiles.push({dpr,foundation});await page.locator('canvas').screenshot({path:`${output}/off-center-foundation-dpr${dpr}.png`});
    const nature=await page.evaluate(()=>{
      const {game:g,renderer:r,canvas,geometry:k}=elevationQA,c=canvas.getContext('2d'),results=[];r.setLayers({trees:true,buildings:false});r.setZoom(1);
      for(const [name,x,y]of[['flat',80,54],['coastal-slope',47,56]]){
        for(let dy=0;dy<3;dy++)for(let dx=0;dx<3;dx++)Object.assign(g.tiles[(y+dy)*g.width+x+dx],{terrain:'forest',elevation:.5,detail:'pine'});
        const anchor=g.tiles[y*g.width+x];anchor.terrainObject={kind:'forest',detail:'pine',variant:7,footprint:3};g.revision++;r.focus(x+1,y+1);
        const before=JSON.stringify(anchor.terrainObject),original=c.drawImage;let large=0,small=0;
        c.drawImage=function(image,...args){if(args.length===4){if(args[2]===192&&args[3]===192)large++;if(args[2]===48&&args[3]===48)small++;}return original.call(this,image,...args);};
        let flatCells=0;for(let dy=0;dy<3;dy++)for(let dx=0;dx<3;dx++){const corners=k.tileSurface(g,x+dx,y+dy).corners;if(corners.every(p=>p.height===corners[0].height))flatCells++;}
        try{r.render(0);}finally{c.drawImage=original;}results.push({name,large,small,flatCells,unchanged:before===JSON.stringify(anchor.terrainObject)});
        delete anchor.terrainObject;for(let dy=0;dy<3;dy++)for(let dx=0;dx<3;dx++)Object.assign(g.tiles[(y+dy)*g.width+x+dx],{terrain:'grass',detail:''});g.revision++;
      }
      r.setLayers({trees:false});return results;
    });profiles.push({dpr,nature});

    if(dpr===1){
      for(const biome of ['taiga','tundra','desert']){
        const scene=await page.evaluate(biome=>{
          const q=elevationQA,g=q.createGame({biome,size:'square512',seed:1847});let best=null;
          for(let y=40;y<g.height-40;y+=4)for(let x=40;x<g.width-40;x+=4){const t=g.tiles[y*g.width+x];if(t.terrain!=='mountain')continue;const ring=[[-12,0],[12,0],[0,-12],[0,12],[-9,-9],[9,9],[-9,9],[9,-9]].map(([dx,dy])=>g.tiles[(y+dy)*g.width+x+dx]);if(ring.some(t=>t.terrain==='water'))continue;const mean=ring.reduce((s,t)=>s+t.elevation,0)/ring.length,low=Math.min(...ring.map(t=>t.elevation)),score=(t.elevation-mean)*3+(t.elevation-low)+t.elevation*.1;if(!best||score>best.score)best={x,y,score,elevation:t.elevation};}
          if(!best)throw new Error('No generated mountain');q.game=g;q.renderer.setGame(g);q.renderer.setLayers({...q.layers,roads:false,rails:false});q.renderer.setZoom(1);q.renderer.focus(best.x,best.y);q.renderer.render(0);return{biome,...best,stats:q.renderer.getStats()};
        },biome);
        galleries.push(scene);await page.locator('canvas').screenshot({path:`${output}/generated-${biome}-mountain.png`});
      }
      huge=await page.evaluate(()=>{
        const q=elevationQA,g=q.createGame({size:'square2048',seed:1847});q.game=g;q.renderer.setGame(g);q.renderer.setZoom(.5);const samples=[];
        for(const[x,y]of[[1024,1024],[2024,24],[24,2024]]){q.renderer.focus(x,y);const initialGeometry=q.geometry.terrainGeometryStats(g).builtChunks;q.renderer.render(0);const before=q.renderer.getStats().composedChunks,coldGeometry=q.geometry.terrainGeometryStats(g).builtChunks;q.renderer.render(0);const geometry=q.geometry.terrainGeometryStats(g);samples.push({...q.renderer.getStats(),warmRebuilds:q.renderer.getStats().composedChunks-before,coldGeometryBuilds:coldGeometry-initialGeometry,warmGeometryBuilds:geometry.builtChunks-coldGeometry,geometry});}
        q.renderer.setLayers(Object.fromEntries(Object.keys(q.renderer.getLayers()).map(key=>[key,true])));q.renderer.focus(1024,1024);
        const initialGeometry=q.geometry.terrainGeometryStats(g).builtChunks;q.renderer.render(0);const before=q.renderer.getStats().composedChunks,coldGeometry=q.geometry.terrainGeometryStats(g).builtChunks;q.renderer.render(0);const geometry=q.geometry.terrainGeometryStats(g);
        samples.push({...q.renderer.getStats(),defaultLayers:true,warmRebuilds:q.renderer.getStats().composedChunks-before,coldGeometryBuilds:coldGeometry-initialGeometry,warmGeometryBuilds:geometry.builtChunks-coldGeometry,geometry});
        return{width:g.width,height:g.height,samples};
      });
    }
    await page.close();
  }
  await writeFile(`${output}/results.json`,JSON.stringify({profiles,galleries,viaducts,huge,errors},null,2));
  for(const profile of viaducts){
    assert.ok(profile.deckHeight>3);assert.equal(profile.groundHeight,0);
    for(const sample of profile.samples){
      const label=`${profile.mode} ${profile.axis} viaduct at ${profile.zoom}× DPR${profile.dpr}`;
      assert.notDeepEqual(sample.expectedGround,sample.expectedDeck,`${label} actually overlaps another ground tile`);
      assert.deepEqual(sample.shown,sample.expectedDeck,`${label} picks visible deck`);
      assert.deepEqual(sample.hidden,sample.expectedGround,`${label} hidden layer exposes ground`);
      assert.deepEqual(sample.restored,sample.expectedDeck,`${label} restored layer picks deck`);
    }
  }
  for(const profile of profiles){
    if(profile.nature){const[flat,slope]=profile.nature;assert.equal(flat.large,1);assert.equal(flat.small,0);assert.equal(slope.large,0);assert.ok(slope.flatCells<9);assert.equal(slope.small,slope.flatCells,'fallback woodland draws only on level constituent cells');assert.ok(profile.nature.every(p=>p.unchanged));continue;}
    if(profile.foundation){assert.ok(profile.foundation.error<1e-6,`foundation contains every interior vertex: ${JSON.stringify(profile)}`);continue;}
    const tolerance=1/profile.dpr+.001;
    for(const p of profile.checks){assert.deepEqual(p.picked,p.expected,`${profile.zoom}× DPR${profile.dpr} projected picking`);assert.ok(p.focusError<=tolerance);}
    for(const p of profile.vertexChecks)assert.deepEqual(p.picked,p.expected,`${profile.zoom}× DPR${profile.dpr} grid vertex picking`);
    assert.ok(Math.abs(profile.pan.x-73)<=tolerance&&Math.abs(profile.pan.y+41)<=tolerance,JSON.stringify(profile.pan));assert.ok(profile.anchorError<=tolerance);
    assert.ok(profile.gridError<1e-6);assert.ok(profile.highlightError<1e-6);assert.ok(profile.rebuilt>=4,'raised seam invalidates its neighboring chunks');assert.equal(profile.warmRebuilds,0);assert.ok(profile.changedPixels>0);assert.ok(profile.cornerShift<0);assert.equal(profile.outside.error,undefined);assert.ok(profile.bridgeInk.every(c=>c>25),`bridge approach centerline stays painted: ${JSON.stringify({zoom:profile.zoom,dpr:profile.dpr,ink:profile.bridgeInk})}`);
    assert.ok(profile.stats.cacheBytes<=profile.stats.cacheLimit);assert.ok(profile.stats.maxSurfaceWidth<=2048);
  }
  if(!viaductOnly){assert.deepEqual([huge.width,huge.height],[2048,2048]);for(const s of huge.samples){assert.equal(s.warmRebuilds,0);assert.ok(s.cacheBytes<=s.cacheLimit);assert.ok(s.geometry.cachedChunks<=s.geometry.cacheLimit);assert.equal(s.warmGeometryBuilds,0,'warm viewport does not touch remote terrain fields');assert.ok(s.coldGeometryBuilds<64,'only nearby geometry chunks are sampled');}}
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passedProfiles:profiles.length,viaductProfiles:viaducts.length,galleries:galleries.map(g=>g.biome),hugeSamples:huge?.samples.length||0,output},null,2));
}finally{await browser.close();}
