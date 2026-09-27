// Exact physical-pixel preparation for every zoom, heading and load state.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.TRANSPORT_PLAYWRIGHT||'playwright');
const base=process.env.TRANSPORT_URL||'http://127.0.0.1:8765/fun/transport/';
const browser=await chromium.launch({channel:process.env.TRANSPORT_BROWSER||'chrome',headless:true});
try{
  const results=[];
  for(const dpr of [1,2]){
    const page=await browser.newPage({deviceScaleFactor:dpr});
    await page.route('**/prepared-sprites-qa',r=>r.fulfill({contentType:'text/html',body:'<canvas></canvas>'}));
    await page.goto(new URL('prepared-sprites-qa',base).href);
    const result=await page.evaluate(async()=>{
      const [{createVehicleSprites,drawRasterVehicle},{createMarineSprites},{createSpriteCache},{preloadWorldArt,registerAtlas,worldArtRevision},{vehicleFrameAngle},infra]=await Promise.all([import('./raster-transport.js'),import('./marine-sprites.js'),import('./sprite-cache.js'),import('./atlas-runtime.js'),import('./vehicle-directions.js'),import('./isometric-infrastructure.js')]);
      await preloadWorldArt({waitMs:20000});
      const cache=createSpriteCache({limit:32*1024*1024}),factories=new Map(),cases=[],canvas=document.querySelector('canvas');
      const kinds=['bus','express-bus','truck','locomotive','coach','wagon','ferry','cargo-ship','tanker'];
      const make=(scale,size=96)=>{const image=document.createElement('canvas');image.width=image.height=size*scale;return image;};
      const difference=(a,b)=>{const aa=a.getContext('2d').getImageData(0,0,a.width,a.height).data,bb=b.getContext('2d').getImageData(0,0,b.width,b.height).data;let max=0,changed=0,total=0;for(let i=0;i<aa.length;i++){const alpha=i-i%4+3,background=[145,167,122][i%4]||0,pa=i%4===3?aa[i]:aa[i]*aa[alpha]/255+background*(1-aa[alpha]/255),pb=i%4===3?bb[i]:bb[i]*bb[alpha]/255+background*(1-bb[alpha]/255),d=Math.abs(pa-pb);max=Math.max(max,d);changed+=Boolean(d);total+=d;}return{max,changed,total,bytes:aa.length};};
      for(const zoom of [.5,1,2]){
        const scale=zoom*devicePixelRatio,factory=createVehicleSprites({pixelScale:scale,cache}),waterValidation=createVehicleSprites({pixelScale:scale}),marine=createMarineSprites({pixelScale:scale,cache});factories.set(zoom,{factory,marine});
        for(const kind of kinds)for(let n=0;n<8;n++)for(const load of [0,37,100]){
          const vehicle={angle:vehicleFrameAngle(n*Math.PI/4),capacity:100,load,level:kind==='express-bus'?2:1};
          const route={mode:['ferry','cargo-ship','tanker'].includes(kind)?'water':['locomotive','coach','wagon'].includes(kind)?'rail':'road',cargo:['bus','express-bus','coach','ferry'].includes(kind)?'passengers':kind==='tanker'?'oil':'coal',color:'#71909d'},engine=!['coach','wagon'].includes(kind);
          const direct=make(scale),prepared=make(scale),a=direct.getContext('2d'),b=prepared.getContext('2d');
          for(const c of [a,b]){c.scale(scale,scale);c.translate(48,48);}
          a.rotate(vehicle.angle);const source=drawRasterVehicle(a,vehicle,route,{engine,pixelScale:scale,heading:vehicle.angle});
          let native=true,frame;const draw=b.drawImage.bind(b);b.drawImage=(image,x,y,w,h)=>{const m=b.getTransform();native&&=Math.abs(image.width-w*m.a)<1e-7&&Math.abs(image.height-h*m.d)<1e-7&&m.b===0&&m.c===0;frame=image.vehicleFrame;draw(image,x,y,w,h);};
          const painted=(route.mode==='water'?waterValidation:factory).draw(b,vehicle,route,{engine,heading:vehicle.angle});
          cases.push({kind,zoom,n,load,source,painted,native,frame,difference:difference(direct,prepared)});
          if(route.mode==='water')marine.ship(vehicle,route);
        }
      }
      const infrastructure=[];
      for(const zoom of [.5,1,2]){
        const scale=zoom*devicePixelRatio,factory=infra.createIsometricInfrastructureSprites({pixelScale:scale,cache}),specs=[];
        for(const mode of ['road','rail'])specs.push({type:'stop',args:[mode],bounds:infra.isometricStationBounds(mode),direct:infra.drawIsometricStop});
        for(const [dx,dy]of [[1,0],[0,1],[-1,0],[0,-1]]){specs.push({type:'port',args:[dx,dy],bounds:infra.isometricStationBounds('water'),direct:infra.drawIsometricPort});for(const mode of ['road','rail'])specs.push({type:'portal',args:[mode,dx,dy],bounds:{left:-22,top:-35,size:44},direct:infra.drawIsometricPortal});}
        for(const spec of specs){
          const direct=make(scale,160),prepared=make(scale,160),a=direct.getContext('2d'),b=prepared.getContext('2d');
          for(const c of [a,b]){c.scale(scale,scale);c.translate(40-spec.bounds.left,40-spec.bounds.top);}
          let native=true;const draw=b.drawImage.bind(b);b.drawImage=(image,x,y,w,h)=>{const m=b.getTransform();native&&=Math.abs(image.width-w*m.a)<1e-7&&Math.abs(image.height-h*m.d)<1e-7&&m.b===0&&m.c===0;draw(image,x,y,w,h);};
          const source=spec.direct(a,...spec.args,0,0,scale),painted=factory[spec.type](b,...spec.args,0,0);
          infrastructure.push({zoom,type:spec.type,args:spec.args,source,painted,native,difference:difference(direct,prepared)});
        }
        const before=factory.getStats().created;for(const spec of specs)factory[spec.type](canvas.getContext('2d'),...spec.args,0,0);infrastructure.push({zoom,reused:factory.getStats().created===before});
      }
      const colors=[];
      for(const zoom of [.5,1,2]){
        const scale=zoom*devicePixelRatio,{factory}=factories.get(zoom),hashes=[];
        for(const color of ['#71909d','#b87752','#7a9b57']){
          const image=make(scale),c=image.getContext('2d');c.scale(scale,scale);c.translate(48,48);factory.draw(c,{angle:0,load:37,capacity:100,level:1},{mode:'road',cargo:'coal',color});let hash=2166136261;for(const byte of c.getImageData(0,0,image.width,image.height).data)hash=Math.imul(hash^byte,16777619);hashes.push(hash>>>0);
        }
        colors.push({zoom,distinct:new Set(hashes).size});
      }
      const warm=[];
      // Revisit a zoom after other zooms have prepared their own pixels.
      for(const zoom of [2,.5,1]){
        const {factory,marine}=factories.get(zoom),before=factory.getStats().created,shipBefore=marine.getStats().created,scale=zoom*devicePixelRatio;
        canvas.width=canvas.height=96*scale;const c=canvas.getContext('2d');c.scale(scale,scale);c.translate(48,48);
        for(const row of cases.filter(row=>row.zoom===zoom)){
          const kind=row.kind,vehicle={angle:vehicleFrameAngle(row.n*Math.PI/4),capacity:100,load:row.load,level:kind==='express-bus'?2:1};
          const route={mode:['ferry','cargo-ship','tanker'].includes(kind)?'water':['locomotive','coach','wagon'].includes(kind)?'rail':'road',cargo:['bus','express-bus','coach','ferry'].includes(kind)?'passengers':kind==='tanker'?'oil':'coal',color:'#71909d'};
          if(route.mode==='water')marine.ship(vehicle,route);else factory.draw(c,vehicle,route,{engine:!['coach','wagon'].includes(kind),heading:vehicle.angle});
        }
        warm.push({zoom,created:factory.getStats().created-before,marineCreated:marine.getStats().created-shipBefore});
      }
      const stats=cache.getStats(),before=factories.get(1).factory.getStats().created;cache.clear();const{factory}=factories.get(1),drawBus=()=>factory.draw(canvas.getContext('2d'),{angle:0,capacity:100,load:0,level:1},{mode:'road',cargo:'passengers',color:'#71909d'});drawBus();const clearedRebuild=factory.getStats().created-before;
      const revisionBefore=worldArtRevision(),createdBefore=factory.getStats().created;
      registerAtlas({id:'prepared-qa-late-art',path:'./assets/world/vehicles-dimetric-v2/atlas',entries:['prepared-qa-late-art:probe']});await preloadWorldArt({waitMs:20000});drawBus();const assetRebuild=factory.getStats().created-createdBefore;drawBus();
      return {dpr:devicePixelRatio,cases,infrastructure,colors,warm,stats,clearedRebuild,assetRebuild,artChanged:worldArtRevision()>revisionBefore,assetStable:factory.getStats().created-createdBefore===assetRebuild};
    });
    for(const row of result.cases){const label=`${row.kind} zoom${row.zoom} direction${row.n} load${row.load} DPR${dpr}`;assert.ok(row.source&&row.painted,label);assert.equal(row.native,true,`${label} copies at native physical resolution`);assert.equal(row.frame.kind,row.kind,label);assert.ok(row.difference.max<=3&&row.difference.total<=row.difference.bytes*.04,`${label} preserves authored pixels: ${JSON.stringify(row.difference)}`);}
    for(const row of result.warm){assert.equal(row.created,0,`zoom${row.zoom} reuses land preparations`);assert.equal(row.marineCreated,0,`zoom${row.zoom} reuses marine preparations`);}
    for(const row of result.infrastructure){if('reused'in row){assert.equal(row.reused,true);continue;}assert.ok(row.source&&row.painted&&row.native,`${row.type} ${row.args} zoom${row.zoom} DPR${dpr}`);assert.ok(row.difference.max<=3&&row.difference.total<=row.difference.bytes*.04,`infrastructure preserves authored pixels: ${JSON.stringify(row)}`);}
    for(const row of result.colors)assert.equal(row.distinct,3,`company markings stay distinct at zoom${row.zoom}`);
    assert.ok(result.stats.bytes<=result.stats.limit);assert.equal(result.clearedRebuild,1);assert.equal(result.artChanged,true);assert.equal(result.assetRebuild,1);assert.equal(result.assetStable,true);
    results.push({dpr,profiles:result.cases.length,infrastructureProfiles:result.infrastructure.filter(row=>row.type).length,warm:result.warm,cache:result.stats,maxChannelDifference:Math.max(...result.cases.map(row=>row.difference.max))});await page.close();
  }
  console.log(JSON.stringify({results},null,2));
}finally{await browser.close();}
