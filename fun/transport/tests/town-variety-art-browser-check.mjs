// Generated parks/malls and all fifteen shop identity/exterior combinations.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-town-variety-qa';
await mkdir(output, { recursive: true });
const errors = [], profiles = [], integrity = [], portraits = [];
const blank = '<!doctype html><style>body{margin:0;background:#8b9b72;font:12px sans-serif}canvas{vertical-align:top}#gallery{display:grid;grid-template-columns:repeat(7,130px);gap:8px;padding:10px}.item{height:150px}.item canvas{width:120px;height:130px}</style><div id="gallery"></div>';
async function open(context) {
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.route('**/town-variety-qa', route => route.fulfill({ contentType: 'text/html', body: blank }));
  await page.goto(new URL('town-variety-qa', base).href); return page;
}
try {
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 980, height: 620 }, deviceScaleFactor: dpr });
    const page = await open(context);
    const result = await page.evaluate(async ({dpr}) => {
      const [art, assets, spritesModule, buildings, ui, native] = await Promise.all([
        import('./raster-buildings.js'), import('./atlas-runtime.js'), import('./sprites.js'),
        import('./buildings.js'), import('./ui-art.js'), import('./building-sprites.js'),
      ]);
      await assets.preloadWorldArt({waitMs:20000});
      const make=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
      const hash=c=>{const p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let h=2166136261;for(const n of p)h=Math.imul(h^n,16777619);return h>>>0;};
      const rows=[], integrity=[], portraits=[], selected=[];
      for(const biome of ['taiga','tundra','desert']) {
        if(dpr===1)for(const family of ['civic-retail','shop-alternates'])for(const size of [16,32,64,128,256]){
          const path=`assets/world/town-variety-v1/${family}/${biome}`, meta=await fetch(`${path}/atlas.json`).then(r=>r.json());
          const image=new Image();image.src=`${path}/atlas-${size}.png`;await image.decode();
          if(image.naturalWidth!==size*3||image.naturalHeight!==size*3)throw Error('Invalid atlas density');
          for(let i=0;i<9;i++){
            const c=make(size,size),x=c.getContext('2d');x.drawImage(image,i%3*size,Math.floor(i/3)*size,size,size,0,0,size,size);
            const pixels=x.getImageData(0,0,size,size).data;let opaque=0,max=0;for(let p=3;p<pixels.length;p+=4){max=Math.max(max,pixels[p]);if(pixels[p]>32)opaque++;}
            const corners=[3,(size-1)*4+3,(size*(size-1))*4+3,(size*size-1)*4+3].map(p=>pixels[p]);
            integrity.push({biome,family,size,id:meta.order[i],opaque,max,corners});
          }
        }
        for(const zoom of [.5,1,2]){
          const s=spritesModule.createSprites(biome,{pixelScale:zoom*dpr,detailLevel:zoom===.5?'region':zoom===1?'town':'detail'});
          for(const [index,kind] of art.SHOP_ART_KINDS.entries()){
            const hashes=[],objects=[];
            for(const design of art.BUILDING_ART_DESIGNS){
              const variant=index+design*5,c=s(kind,variant),alias=s('shop',variant,1),repeat=s(kind,variant+15);
              if(c!==alias||c!==repeat)throw Error(`Shop identity/cache mismatch: ${kind}/${variant}`);
              if(art.buildingArtworkDesign(variant)!==design)throw Error('Shop seed lost its exterior');
              hashes.push(hash(c));objects.push(c);rows.push({biome,zoom,dpr,kind,design,hash:hash(c),ready:art.hasRasterBuilding(kind,biome,design)});
              if(zoom===2&&dpr===1&&biome==='taiga')selected.push({kind,variant,canvas:c});
            }
            if(new Set(hashes).size!==3||new Set(objects).size!==3)throw Error(`${kind} has fewer than three distinct exteriors`);
          }
          for(const kind of art.PARK_MALL_ART_KINDS){
            const span=buildings.BUILDINGS[kind].footprint,c=s(kind,0,1,'',span);rows.push({biome,zoom,dpr,kind,design:0,hash:hash(c),ready:art.hasRasterBuilding(kind,biome)});
            if(zoom===2&&dpr===1&&biome==='taiga')selected.push({kind,variant:0,canvas:c});
          }
        }
        const root=document.createElement('div'),expected=spritesModule.createSprites(biome,{pixelScale:dpr*2,detailLevel:'detail'});
        for(const kind of [...art.SHOP_ART_KINDS,...art.PARK_MALL_ART_KINDS])for(const design of kind.startsWith('shop-')?[0,1,2]:[0]){
          const index=art.SHOP_ART_KINDS.indexOf(kind),variant=Math.max(0,index)+design*5,c=make(96,96);c.dataset.buildingSprite=kind;c.dataset.buildingVariant=variant;root.append(c);
          ui.drawUIArtwork(root,{biome,routes:[],vehicles:[]});
          const want=make(96*dpr,96*dpr),ctx=want.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
          ctx.drawImage(expected(kind,variant,1,'',buildings.BUILDINGS[kind].footprint),16,8,64,80);
          portraits.push({biome,dpr,kind,design,match:hash(c)===hash(want)});
        }
        for(const kind of art.PARK_MALL_ART_KINDS){const c=make(40,40);native.drawTownBuilding(c.getContext('2d'),kind,biome,'detail');if(!c.getContext('2d').getImageData(0,0,40,40).data.some((n,i)=>i%4===3&&n>32))throw Error(`Missing native fallback: ${kind}`);}
      }
      if(dpr===1)for(const item of selected){const el=document.createElement('div');el.className='item';const image=document.createElement('canvas');image.width=item.canvas.width;image.height=item.canvas.height;image.getContext('2d').drawImage(item.canvas,0,0);el.append(image,document.createTextNode(`${item.kind} v${item.variant}`));document.querySelector('#gallery').append(el);}
      return {rows,integrity,portraits,stats:assets.worldArtStats()};
    },{dpr});
    profiles.push(...result.rows);integrity.push(...result.integrity);portraits.push(...result.portraits);
    assert.deepEqual(result.stats.errors,[],'all registered artwork densities decode');
    if(dpr===1)await page.screenshot({path:`${output}/parks-malls-shops.png`,fullPage:true});
    await context.close();
  }
  for(const row of integrity){if(row.id){assert.ok(row.opaque>0&&row.max>100,`${row.id}/${row.size} is populated`);assert.ok(row.corners.every(n=>n<32),`${row.id}/${row.size} has isolated transparent corners`);}else assert.equal(row.max,0,'empty cells remain transparent');}
  assert.equal(integrity.filter(r=>r.id).length,240);assert.equal(profiles.length,378);assert.ok(profiles.every(r=>r.ready));assert.ok(portraits.every(r=>r.match));

  // Base artwork keeps shops usable when new exteriors fail. A retry replaces
  // cached fallbacks and native parks without changing any saved seed.
  const context=await browser.newContext();let missing=true;
  await context.route('**/town-variety-v1/**',route=>missing?route.abort():route.continue());
  const page=await open(context);
  const before=await page.evaluate(async()=>{
    const [art,assets,{createSprites}]=await Promise.all([import('./raster-buildings.js'),import('./atlas-runtime.js'),import('./sprites.js')]);
    await assets.preloadWorldArt({waitMs:15000,biome:'taiga'});
    const hash=c=>{const p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let h=2166136261;for(const n of p)h=Math.imul(h^n,16777619);return h>>>0;};
    const sprite=createSprites('taiga',{pixelScale:2,detailLevel:'detail'}), oldShop=sprite('shop-grocery',5),oldPark=sprite('park-formal',0,1,'',2);
    const make=()=>{const c=document.createElement('canvas');c.width=c.height=64;return c;},base=make(),alternate=make();
    art.drawRasterBuilding(base.getContext('2d'),'shop-grocery','taiga',2);art.drawRasterBuilding(alternate.getContext('2d'),'shop-grocery','taiga',2,{design:1});
    window.variety={art,assets,sprite,hash,oldShop,oldPark,seed:{variant:5},saved:JSON.stringify({variant:5})};
    return {revision:assets.worldArtRevision(),shop:art.hasRasterBuilding('shop-grocery','taiga',1),park:art.hasRasterBuilding('park-formal','taiga'),sameClimateFallback:hash(base)===hash(alternate)};
  });
  assert.equal(before.shop,true);assert.equal(before.park,false);assert.equal(before.sameClimateFallback,true);
  missing=false;
  const after=await page.evaluate(async()=>{const q=variety;await q.assets.preloadWorldArt({waitMs:20000,retry:true,biome:'taiga'});const nextShop=q.sprite('shop-grocery',5),nextPark=q.sprite('park-formal',0,1,'',2);return{revision:q.assets.worldArtRevision(),shopChanged:q.hash(nextShop)!==q.hash(q.oldShop),parkChanged:q.hash(nextPark)!==q.hash(q.oldPark),newShopCanvas:nextShop!==q.oldShop,park:q.art.hasRasterBuilding('park-formal','taiga'),unchanged:q.saved===JSON.stringify(q.seed)};});
  assert.ok(after.revision>before.revision);assert.equal(after.shopChanged,true);assert.equal(after.parkChanged,true);assert.equal(after.newShopCanvas,true);assert.equal(after.park,true);assert.equal(after.unchanged,true);
  await context.close();assert.deepEqual(errors,[]);
  await writeFile(`${output}/results.json`,JSON.stringify({profiles,integrity,portraits,before,after,errors},null,2));
  console.log(JSON.stringify({verifiedSpriteProfiles:profiles.length,generatedCells:integrity.filter(r=>r.id).length,portraitMatches:portraits.length,missingAlternateAndLateRecovery:true,errors},null,2));
} finally {await browser.close();}
