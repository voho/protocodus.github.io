// Real transparent PNGs, isolated browser contexts, and instrumented Canvas
// transforms verify separate fixed-camera vehicle frames in the real renderer.
import assert from 'node:assert/strict';
import { mkdir, readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const baseURL = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-vehicle-directions-qa';
const kinds = ['bus','express-bus','truck','locomotive','coach','wagon','ferry','cargo-ship','tanker'];
const metadata = {}, missing = [];
for (const kind of kinds) {
  const directory = new URL(`../assets/world/vehicle-${kind}/`, import.meta.url);
  try {
    await access(fileURLToPath(new URL('atlas-128.png',directory)));
    metadata[kind] = JSON.parse(await readFile(new URL('atlas.json',directory),'utf8'));
  } catch { missing.push(kind); }
}
assert.ok(!missing.length || process.env.TRANSPORT_VEHICLE_PARTIAL === '1', `Missing directional atlases: ${missing.join(', ')}`);
await mkdir(output,{recursive:true});
const browser = await chromium.launch({channel:process.env.TRANSPORT_BROWSER || 'chrome',headless:true});
const errors = [], results = [];

async function harness(context) {
  const page = await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/vehicle-directions-qa',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:20px;background:#edf0e3;color:#273d35;font:16px system-ui}h1{font-size:23px}h2{font-size:17px}canvas{display:block}section{padding:16px;margin-bottom:18px;background:#faf9f0;border-radius:10px}#gallery{width:max-content}.world{width:1100px;height:700px}</style><h1>Eight independently drawn vehicle directions</h1><main id="gallery"></main>'}));
  await page.goto(new URL('vehicle-directions-qa',baseURL).href);
  await page.evaluate(async ({metadata,missing})=>{
    const directions=await import('./vehicle-directions.js'),assets=await import('./atlas-runtime.js');
    const {drawRasterVehicle}=await import('./raster-transport.js'),{createMarineSprites}=await import('./marine-sprites.js');
    const {createRenderer}=await import('./renderer.js'),{createGame}=await import('./model.js');
    const activeKinds=directions.VEHICLE_KINDS.filter(kind=>!missing.includes(kind));
    const makeCanvas=(w,h)=>{const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;canvas.getContext('2d',{willReadFrequently:true});return canvas;};
    const hash=canvas=>{let value=2166136261;for(const byte of canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data)value=Math.imul(value^byte,16777619);return value>>>0;};
    const spec=kind=>({
      vehicle:{angle:0,load:0,capacity:100,level:kind==='express-bus'?2:1},
      route:{mode:['ferry','cargo-ship','tanker'].includes(kind)?'water':['locomotive','coach','wagon'].includes(kind)?'rail':'road',cargo:['bus','express-bus','coach','ferry'].includes(kind)?'passengers':kind==='tanker'?'oil':'coal'},
      engine:!['coach','wagon'].includes(kind),size:['ferry','cargo-ship','tanker'].includes(kind)?43:20,
    });
    const sprite=(kind,heading,scale=1,load=0,engineAngle=heading)=>{
      const canvas=makeCanvas(Math.ceil(64*scale),Math.ceil(64*scale)),c=canvas.getContext('2d'),s=spec(kind),draws=[];
      const original=c.drawImage.bind(c);c.drawImage=(image,...args)=>{const m=c.getTransform();draws.push({src:image.src,args,matrix:{a:m.a,b:m.b,c:m.c,d:m.d,e:m.e,f:m.f}});original(image,...args);};
      c.scale(scale,scale);c.translate(32,32);c.rotate(heading);
      const drawn=drawRasterVehicle(c,{...s.vehicle,angle:engineAngle,load},s.route,{engine:s.engine,pixelScale:scale,heading});
      return {canvas,drawn,draws,hash:hash(canvas)};
    };
    const difference=(a,b)=>{const aa=a.getContext('2d').getImageData(0,0,a.width,a.height).data,bb=b.getContext('2d').getImageData(0,0,b.width,b.height).data;let changed=0,total=0,max=0;for(let i=0;i<aa.length;i++){const delta=Math.abs(aa[i]-bb[i]);if(delta)changed++;total+=delta;max=Math.max(max,delta);}return{changed,total,max,bytes:aa.length};};
    const direct=(kind,angle,scale=1)=>{const canvas=makeCanvas(Math.ceil(64*scale),Math.ceil(64*scale)),c=canvas.getContext('2d');c.scale(scale,scale);c.translate(32,32);directions.drawDirectionalVehicle(c,kind,angle,spec(kind).size,scale);return canvas;};
    const load=async url=>{const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error(url));image.src=url;});await image.decode();return image;};
    const section=title=>{const box=document.createElement('section'),h=document.createElement('h2');h.textContent=title;box.append(h);document.querySelector('#gallery').append(box);return box;};
    window.vehicleQA={directions,assets,drawRasterVehicle,createMarineSprites,createRenderer,createGame,activeKinds,metadata,makeCanvas,hash,spec,sprite,direct,difference,load,section};
    await assets.preloadWorldArt({waitMs:12000});
  },{metadata,missing});
  return page;
}
try {
  for (const dpr of [1,2]) {
    const context=await browser.newContext({viewport:{width:1510,height:1000},deviceScaleFactor:dpr});
    const page=await harness(context);
    const checks=await page.evaluate(async()=>{
      const q=vehicleQA,frames=[],selection=[],profiles=[],trailers=[],marine=[];
      const tau=Math.PI*2,step=Math.PI/4,epsilon=1e-8;
      for(let i=0;i<8;i++)for(const wrap of [-3,-1,0,1,3]){
        const angle=i*step+wrap*tau;
        selection.push({actual:q.directions.vehicleHeading(angle),expected:q.directions.VEHICLE_HEADINGS[i]});
        selection.push({actual:q.directions.vehicleHeading(angle+step/2-epsilon),expected:q.directions.VEHICLE_HEADINGS[i]});
        selection.push({actual:q.directions.vehicleHeading(angle+step/2+epsilon),expected:q.directions.VEHICLE_HEADINGS[(i+1)%8]});
      }
      for(const angle of [NaN,Infinity,-Infinity,undefined])selection.push({actual:q.directions.vehicleHeading(angle),expected:'E'});
      for(const kind of q.activeKinds){
        for(const cell of [16,32,64,128]){
          const image=await q.load(`./assets/world/vehicle-${kind}/atlas-${cell}.png`),hashes=[],ink=[];
          const center=q.makeCanvas(cell,cell);center.getContext('2d').drawImage(image,cell,cell,cell,cell,0,0,cell,cell);
          for(let index=0;index<9;index++)if(q.metadata[kind].order[index]){
            const frame=q.makeCanvas(cell,cell);frame.getContext('2d').drawImage(image,index%3*cell,Math.floor(index/3)*cell,cell,cell,0,0,cell,cell);
            hashes.push(q.hash(frame));ink.push(Array.from(frame.getContext('2d').getImageData(0,0,cell,cell).data).filter((value,index)=>index%4===3&&value>32).length);
          }
          frames.push({kind,cell,hashes,ink,blankCenter:Array.from(center.getContext('2d').getImageData(0,0,cell,cell).data).every((v,i)=>i%4!==3||v===0)});
        }
        for(const zoom of [.5,1,2])for(let i=0;i<8;i++){
          const heading=i*step,scale=zoom*devicePixelRatio,empty=q.sprite(kind,heading,scale),loaded=q.sprite(kind,heading,scale,100),partial=q.sprite(kind,heading,scale,20),negative=q.sprite(kind,heading,scale,-2),overfull=q.sprite(kind,heading,scale,120);
          const draw=empty.draws[0],atlas=q.metadata[kind],cell=draw?.args[2],index=draw?draw.args[1]/cell*3+draw.args[0]/cell:-1;
          profiles.push({kind,zoom,heading:q.directions.VEHICLE_HEADINGS[i],drawn:empty.drawn,src:draw?.src,id:atlas.order[index],matrix:draw?.matrix,hash:empty.hash,matchesDirect:empty.hash===q.hash(q.direct(kind,heading,scale)),difference:q.difference(empty.canvas,q.direct(kind,heading,scale)),loadChanges:loaded.hash!==empty.hash,partialChanges:partial.hash!==empty.hash,fullVsPartial:partial.hash!==loaded.hash,negativeClamped:negative.hash===empty.hash,overfullClamped:overfull.hash===loaded.hash,overfullDifference:q.difference(overfull.canvas,loaded.canvas)});
        }
      }
      for(const kind of ['coach','wagon'].filter(k=>q.activeKinds.includes(k)))for(const heading of [0,Math.PI/2,Math.PI,Math.PI*1.5]){
        const actual=q.sprite(kind,heading,devicePixelRatio,0,heading+Math.PI/2),expected=q.direct(kind,heading,devicePixelRatio);
        trailers.push({kind,heading,independent:actual.hash===q.hash(expected),matrix:actual.draws[0]?.matrix});
      }
      for(const kind of ['ferry','cargo-ship','tanker'].filter(k=>q.activeKinds.includes(k)))for(const zoom of [.5,1,2]){
        const s=q.spec(kind),raster=q.createMarineSprites({pixelScale:zoom*devicePixelRatio}),hashes=[];
        for(let i=0;i<8;i++)hashes.push(q.hash(raster.ship({...s.vehicle,angle:i*step},s.route)));
        marine.push({kind,zoom,hashes,cache:raster.getStats()});
      }
      return{frames,selection,profiles,trailers,marine,stats:q.assets.worldArtStats()};
    });
    assert.deepEqual(checks.stats.errors.filter(e=>!missing.some(kind=>e.id===`vehicle-${kind}`)),[]);
    for(const check of checks.selection)assert.equal(check.actual,check.expected,'angle sectors and wrapping select the expected heading');
    for(const frame of checks.frames){assert.equal(new Set(frame.hashes).size,8,`${frame.kind} ${frame.cell}px has 8 unique frames`);assert.ok(frame.ink.every(n=>n>2));assert.equal(frame.blankCenter,true);}
    for(const p of checks.profiles){
      const label=`${p.kind} ${p.heading} zoom${p.zoom} DPR${dpr}`;
      assert.equal(p.drawn,true,label);assert.ok(p.src.includes(`/vehicle-${p.kind}/`),`${label} uses directional art`);assert.equal(p.id,`vehicle:${p.kind}:${p.heading}`,label);
      assert.ok(Math.abs(p.matrix.b)<1e-9&&Math.abs(p.matrix.c)<1e-9&&Math.abs(p.matrix.a-p.matrix.d)<1e-9,`${label} keeps camera upright`);
      // In Chromium, cancelling rotations can move a handful of filtered
      // channel values by one or two units at DPR2; camera geometry must still be exact.
      assert.ok(p.matchesDirect||(p.difference.max<=2&&p.difference.changed<=p.difference.bytes*.001),`${label} body matches the authored frame ${JSON.stringify(p.difference)}`);
      const cargo=['truck','wagon','cargo-ship'].includes(p.kind);
      assert.equal(p.loadChanges,cargo,`${label} cargo overlay`);assert.equal(p.partialChanges,cargo,label);assert.equal(p.fullVsPartial,cargo,label);
      assert.equal(p.negativeClamped,true,`${label} negative load clamp`);assert.equal(p.overfullClamped,true,`${label} overfull load clamp ${JSON.stringify(p.overfullDifference)}`);
    }
    for(const p of checks.trailers)assert.equal(p.independent,true,`${p.kind} follows its own path heading, independent of engine angle`);
    for(const p of checks.marine)assert.equal(new Set(p.hashes).size,8,`${p.kind} marine cache preserves all headings at zoom${p.zoom}`);

    // Labeled physical-size samples show all headings at each supported zoom.
    await page.evaluate(()=>{
      const q=vehicleQA;document.querySelector('#gallery').replaceChildren();
      const cssWidth=1800,rowHeight=98;
      for(const zoom of [.5,1,2]){
        const section=q.section(`Native rendering · zoom ${zoom} · DPR ${devicePixelRatio} · each pair EMPTY / FULL`),canvas=q.makeCanvas(cssWidth*devicePixelRatio,(42+q.activeKinds.length*rowHeight)*devicePixelRatio),c=canvas.getContext('2d');
        canvas.style.width=`${cssWidth}px`;canvas.style.height=`${42+q.activeKinds.length*rowHeight}px`;section.append(canvas);c.scale(devicePixelRatio,devicePixelRatio);c.fillStyle='#afbd98';c.fillRect(0,0,cssWidth,canvas.height/devicePixelRatio);c.fillStyle='#283d37';c.font='13px system-ui';
        q.directions.VEHICLE_HEADINGS.forEach((heading,i)=>c.fillText(heading,208+i*200,23));
        q.activeKinds.forEach((kind,row)=>{const y=42+row*rowHeight;c.fillStyle=q.spec(kind).route.mode==='water'?'#628b92':'#98ad84';c.fillRect(0,y,cssWidth,rowHeight-2);c.fillStyle='#203a31';c.fillText(kind,8,y+45);
          for(let i=0;i<8;i++)for(const [j,load] of [[0,0],[1,100]]){const image=q.sprite(kind,i*Math.PI/4,zoom*devicePixelRatio,load).canvas;c.drawImage(image,126+i*200+j*92,y+46-32*zoom,64*zoom,64*zoom);}
        });
      }
    });
    await page.locator('#gallery').screenshot({path:`${output}/vehicles-native-three-zooms-dpr${dpr}.png`});
    if(dpr===1){
      await page.evaluate(()=>{
        const q=vehicleQA;document.querySelector('#gallery').replaceChildren();const width=1360,height=50+q.activeKinds.length*154,canvas=q.makeCanvas(width,height),c=canvas.getContext('2d');q.section('Enlarged authored frames · actual heading labels · fixed camera').append(canvas);c.fillStyle='#b7c5a2';c.fillRect(0,0,width,height);c.font='15px system-ui';c.fillStyle='#243d32';q.directions.VEHICLE_HEADINGS.forEach((h,i)=>c.fillText(h,187+i*145,28));
        q.activeKinds.forEach((kind,row)=>{const y=50+row*154;c.fillStyle=q.spec(kind).route.mode==='water'?'#71949b':'#97ad80';c.fillRect(0,y,width,152);c.fillStyle='#20372e';c.fillText(kind,8,y+75);for(let i=0;i<8;i++){c.save();c.translate(199+i*145,y+76);q.directions.drawDirectionalVehicle(c,kind,i*Math.PI/4,128,1);c.restore();}});
      });
      await page.locator('#gallery').screenshot({path:`${output}/vehicles-eight-headings-large.png`});
      await page.evaluate(()=>{
        const q=vehicleQA;document.querySelector('#gallery').replaceChildren();const kinds=['truck','wagon','cargo-ship'].filter(kind=>q.activeKinds.includes(kind)),width=1680,height=48+kinds.length*2*160,canvas=q.makeCanvas(width,height),c=canvas.getContext('2d');q.section('Cargo overlays · EMPTY / FULL · 3× logical size').append(canvas);c.fillStyle='#bcc9a7';c.fillRect(0,0,width,height);c.font='14px system-ui';c.fillStyle='#243d32';q.directions.VEHICLE_HEADINGS.forEach((h,i)=>c.fillText(h,220+i*190,27));
        kinds.forEach((kind,row)=>{for(const [state,load] of [[0,0],[1,100]]){const y=48+(row*2+state)*160;c.fillStyle=kind==='cargo-ship'?'#70959c':'#9db286';c.fillRect(0,y,width,158);c.fillStyle='#20372e';c.fillText(kind,8,y+70);c.fillText(load?'FULL':'EMPTY',8,y+90);for(let i=0;i<8;i++)c.drawImage(q.sprite(kind,i*Math.PI/4,3,load).canvas,130+i*190,y-16);}});
      });
      await page.locator('#gallery').screenshot({path:`${output}/cargo-overlays-large.png`});
    }

    // Exercise the real train renderer on a corner: both coaches are still
    // heading east while the engine has already turned south.
    const integrated=await page.evaluate(()=>{
      const q=vehicleQA;document.querySelector('#gallery').replaceChildren();
      const canvas=q.makeCanvas(1100,700);canvas.className='world';q.section('Rail curve · rear coaches east, engine south').append(canvas);
      const game=q.createGame({size:'regional',seed:1847});
      for(const t of game.tiles)Object.assign(t,{terrain:'grass',detail:'',building:null,zone:null,road:false,rail:false,bridge:false,tunnel:false});
      for(const key of ['cities','industries','stations','routes','vehicles','zones'])game[key]=[];game.revision++;
      game.routes=[{id:'curve',mode:'rail',cargo:'passengers',active:true,path:[{x:10,y:10},{x:11,y:10},{x:12,y:10},{x:12,y:11},{x:12,y:12}]}];
      game.vehicles=[{id:'train',routeId:'curve',x:12,y:10.4,progress:2.4,direction:1,angle:Math.PI/2,load:40,capacity:100,level:1}];
      const renderer=q.createRenderer(canvas,game,{layers:{names:false,industryIcons:false,stations:false,buildings:false,roads:false,rails:false,trees:false,routes:false,lighting:false,vehicleLoads:true}});renderer.focus(11,10);
      const runs=[];
      for(const zoom of [.5,1,2]){
        renderer.setZoom(zoom);renderer.focus(11,10);const draw=CanvasRenderingContext2D.prototype.drawImage,observed=[];
        CanvasRenderingContext2D.prototype.drawImage=function(image,...args){if(image.src?.includes('/vehicle-')){const m=this.getTransform(),kind=image.src.match(/vehicle-([^/]+)/)[1],cell=args[2],index=args[1]/cell*3+args[0]/cell;observed.push({kind,id:q.metadata[kind]?.order[index],matrix:{a:m.a,b:m.b,c:m.c,d:m.d}});}return draw.call(this,image,...args);};
        try{renderer.render(0);}finally{CanvasRenderingContext2D.prototype.drawImage=draw;}
        runs.push({zoom,observed,stats:renderer.getStats()});
      }
      return runs;
    });
    for(const run of integrated){
      if(!missing.includes('coach'))assert.deepEqual(run.observed.filter(p=>p.kind==='coach').map(p=>p.id),['vehicle:coach:E','vehicle:coach:E']);
      assert.deepEqual(run.observed.filter(p=>p.kind==='locomotive').map(p=>p.id),['vehicle:locomotive:S']);
      assert.equal(run.stats.rasterScale,run.zoom*dpr);
      for(const draw of run.observed)assert.ok(Math.abs(draw.matrix.b)<1e-9&&Math.abs(draw.matrix.c)<1e-9,'real renderer never rotates the selected body bitmap');
    }
    await page.locator('#gallery').screenshot({path:`${output}/train-corner-dpr${dpr}.png`});
    results.push({dpr,vehicleKinds:Object.keys(metadata).length,authoredFrames:checks.frames.length*8,renderedProfiles:checks.profiles.length,headingChecks:checks.selection.length,trailerChecks:checks.trailers.length,rendererZooms:integrated.length});
    await context.close();
  }
  assert.deepEqual(errors,[],'no browser errors');
  console.log(JSON.stringify({results,missing,screenshots:output},null,2));
}finally{await browser.close();}
