import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const {chromium}=await import(process.env.TRANSPORT_PLAYWRIGHT||'playwright');
const base=process.env.TRANSPORT_URL||'http://127.0.0.1:8765/fun/transport/';
const browser=await chromium.launch({channel:process.env.TRANSPORT_BROWSER||'chrome',headless:true});
try{
  await mkdir('/tmp/transport-native-art',{recursive:true});
  const results=[];
  for(const dpr of [1,2]){
    const page=await browser.newPage({deviceScaleFactor:dpr,viewport:{width:1000,height:1320}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/assets/world/**/*.png',r=>r.abort());
    await page.route('**/native-art-qa',r=>r.fulfill({contentType:'text/html',body:'<canvas width="960" height="1280" style="background:#a0ac8c"></canvas>'}));
    await page.goto(new URL('native-art-qa',base).href);
    const result=await page.evaluate(async()=>{
      const [{drawNativeVehicle},{createMarineSprites},{drawRasterVehicle},{preloadWorldArt},{createIsometricInfrastructureSprites}]=await Promise.all([import('./native-transport-art.js'),import('./marine-sprites.js'),import('./raster-transport.js'),import('./atlas-runtime.js'),import('./isometric-infrastructure.js')]);
      await preloadWorldArt({waitMs:1000});
      const gallery=document.querySelector('canvas').getContext('2d'),cases=[],hashes=[],ports=[],infrastructure=[];
      const kinds=['bus','express-bus','truck','locomotive','coach','wagon','ferry','cargo-ship','tanker'];
      const summarize=image=>{const data=image.getContext('2d').getImageData(0,0,image.width,image.height).data;let opaque=0,border=0,hash=2166136261;for(let i=0;i<data.length;i+=4){const a=data[i+3],p=i/4,x=p%image.width,y=Math.floor(p/image.width);opaque+=a>0;if(x===0||y===0||x===image.width-1||y===image.height-1)border+=a>0;for(let k=0;k<4;k++)hash=Math.imul(hash^data[i+k],16777619);}return {opaque,border,hash};};
      for(const scale of [.5,1,2].map(z=>z*devicePixelRatio)){
        const marine=createMarineSprites({pixelScale:scale});
        for(const [row,kind]of kinds.entries())for(let n=0;n<8;n++){
          const ship=row>=6,route={mode:ship?'water':row>=3?'rail':'road',cargo:['bus','express-bus','coach','ferry'].includes(kind)?'passengers':kind==='tanker'?'oil':'coal'},vehicle={angle:n*Math.PI/4,level:kind==='express-bus'?2:1,load:100,capacity:100};
          const image=document.createElement('canvas');image.width=image.height=Math.ceil(80*scale);const c=image.getContext('2d');c.scale(scale,scale);c.translate(40,40);
          const source=drawRasterVehicle(c,vehicle,route,{heading:vehicle.angle,engine:!['coach','wagon'].includes(kind)});
          if(ship){c.drawImage(marine.ship(vehicle,route),-32,-32,64,64);}else drawNativeVehicle(c,vehicle,route,{heading:vehicle.angle,engine:!['coach','wagon'].includes(kind)});
          const sample=summarize(image);cases.push({kind,scale,n,source,...sample});
          if(scale===devicePixelRatio){gallery.drawImage(image,n*115+20,row*100+20,80,80);if(!n){gallery.fillStyle='#293830';gallery.font='12px sans-serif';gallery.fillText(kind,20,row*100+14);}hashes.push([kind,n,sample.hash]);}
        }
        for(let n=0;n<4;n++){const port=marine.port(n*Math.PI/2);ports.push({scale,n,...summarize(port)});if(scale===devicePixelRatio)gallery.drawImage(port,n*170+30,910,96,96);}
        const infra=createIsometricInfrastructureSprites({pixelScale:scale}),specs=[['stop','road'],['stop','rail']];
        for(const [dx,dy]of [[1,0],[0,1],[-1,0],[0,-1]]){specs.push(['port',dx,dy]);for(const mode of ['road','rail'])specs.push(['portal',mode,dx,dy]);}
        for(const [index,[kind,...args]]of specs.entries()){
          const surface=document.createElement('canvas');surface.width=surface.height=Math.ceil(120*scale);const c=surface.getContext('2d');c.scale(scale,scale);c.translate(60,65);
          let frame;const copy=c.drawImage.bind(c);c.drawImage=(image,...params)=>{frame=image;return copy(image,...params);};
          const painted=infra[kind](c,...args,0,0);infrastructure.push({kind,args,scale,painted,...summarize(frame)});
          if(scale===devicePixelRatio)gallery.drawImage(surface,index%7*130+10,1015+Math.floor(index/7)*125,120,120);
        }
        const before=marine.getStats().created;marine.port(0);ports.push({scale,reused:marine.getStats().created===before});
      }
      return {cases,ports,hashes,infrastructure};
    });
    for(const row of result.cases){assert.equal(row.source,false,`PNG blocked: ${row.kind}`);assert.ok(row.opaque>10,JSON.stringify(row));assert.equal(row.border,0,`unclipped recovery: ${JSON.stringify(row)}`);}
    for(const kind of new Set(result.hashes.map(r=>r[0])))assert.equal(new Set(result.hashes.filter(r=>r[0]===kind).map(r=>r[2])).size,8,`${kind}: eight distinct headings`);
    for(const row of result.ports){if('reused'in row)assert.equal(row.reused,true);else {assert.ok(row.opaque>10);assert.equal(row.border,0,JSON.stringify(row));}}
    for(const row of result.infrastructure){assert.equal(row.painted,true,JSON.stringify(row));assert.ok(row.opaque>10);assert.equal(row.border,0,JSON.stringify(row));}
    assert.deepEqual(errors,[]);await page.screenshot({path:`/tmp/transport-native-art/blocked-dpr${dpr}.png`});results.push({dpr,vehicles:result.cases.length,ports:result.ports.length,infrastructure:result.infrastructure.length});await page.close();
  }
  console.log(JSON.stringify({blockedImageRecovery:results},null,2));
}finally{await browser.close();}
