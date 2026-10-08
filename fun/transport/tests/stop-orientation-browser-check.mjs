// Live network axes, ground registration and alpha picking share the exact
// prepared station image at Region, Town and Detail, including Retina pixels.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const base=process.env.TRANSPORT_URL||'http://127.0.0.1:8765/fun/transport/',output=process.env.TRANSPORT_OUTPUT||'/tmp/transport-stop-orientation';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:process.env.TRANSPORT_BROWSER||'chrome',headless:true}),results=[],errors=[];
try{
  for(const dpr of [1,2]){
    const page=await browser.newPage({viewport:{width:960,height:640},deviceScaleFactor:dpr});
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/stop-orientation-qa',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0;background:#eef0e6;font:15px sans-serif;color:#284539}canvas{display:block;width:960px;height:580px}h2{margin:12px 20px}</style><h2 id="label"></h2><canvas></canvas>'}));
    await page.goto(new URL('stop-orientation-qa',base).href);
    await page.evaluate(async()=>{
      const [{createRenderer},{preloadWorldArt},infra,{stopOrientation}]=await Promise.all([import('./renderer.js'),import('./atlas-runtime.js'),import('./isometric-infrastructure.js'),import('./stop-orientation.js')]);
      await preloadWorldArt({biome:'taiga',waitMs:20000});
      const width=48,height=48,station={id:'stop',name:'Roadside stop',mode:'road',x:24,y:24},game={width,height,seed:1,biome:'taiga',revision:1,networkRevision:1,day:0,cities:[],industries:[],stations:[station],routes:[],vehicles:[],zones:[],terrainObjects:[],tiles:[]};
      const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d'),calls=[],original=ctx.drawImage.bind(ctx);
      ctx.drawImage=(image,...args)=>{if(image.infrastructureFrame&&args.length===4){const m=ctx.getTransform(),[x,y,w,h]=args;calls.push({image,meta:image.infrastructureFrame,left:(x*m.a+m.e)/devicePixelRatio,top:(y*m.d+m.f)/devicePixelRatio,width:w*m.a/devicePixelRatio,height:h*m.d/devicePixelRatio});}return original(image,...args);};
      game.tiles=Array.from({length:width*height},()=>({terrain:'grass',elevation:2/7,detail:'',cleared:true}));
      const renderer=createRenderer(canvas,game,{sceneryBatching:false,layers:{weather:false,names:false,routes:false,industryIcons:false,trees:false,vehicles:false,vehicleLoads:false}});
      window.qa={game,station,renderer,infra,stopOrientation,calls,canvas};
    });
    const profiles=[['x-forward',[[1,0]],'x'],['x-backward',[[-1,0]],'x'],['y-forward',[[0,1]],'y'],['y-backward',[[0,-1]],'y'],['x-flat',[[-1,0],[1,0]],'x'],['y-flat',[[0,-1],[0,1]],'y'],['x-through',[[-1,0],[1,0]],'x'],['y-through',[[0,-1],[0,1]],'y'],['x-junction',[[-1,0],[1,0],[0,-1]],'x'],['y-junction',[[0,-1],[0,1],[1,0]],'y'],['corner',[[1,0],[0,1]],'x'],['cross',[[-1,0],[1,0],[0,-1],[0,1]],'x']];
    for(const mode of ['road','rail'])for(const [name,arms,axis]of profiles)for(const zoom of [.5,1,2]){
      const result=await page.evaluate(({mode,name,arms,axis,zoom})=>{
        const q=qa,{game,station,renderer,canvas}=q;station.mode=mode;
        // The stop tile is a straight slope for through fixtures. The anchor
        // must use the offset ground point, not a fixed screen-space shift.
        const sloped=name.endsWith('through');
        game.tiles=Array.from({length:game.width*game.height},(_,i)=>{const x=i%game.width,y=Math.floor(i/game.width);return{terrain:'grass',elevation:(sloped?Math.max(1,Math.min(6,(axis==='x'?x:y)-21)):2)/7,detail:'',cleared:true};});
        game.tiles[station.y*game.width+station.x][mode]=true;
        for(const [dx,dy]of arms)for(let n=1;n<=5;n++)game.tiles[(station.y+dy*n)*game.width+station.x+dx*n][mode]=true;
        game.revision++;game.networkRevision++;renderer.setZoom(zoom);renderer.focus(24,24);q.calls.length=0;renderer.render(1000,{settle:true});
        document.querySelector('#label').textContent=`${mode==='road'?'Road shelter':'Rail station'} · ${name} · ${zoom===.5?'Region':zoom===1?'Town':'Detail'} · DPR ${devicePixelRatio}`;
        const frame=q.calls.find(call=>call.meta.id===(mode==='road'?'isometric:bus-stop':'isometric:train-stop'));
        if(!frame)throw new Error('Station artwork missing');
        const layout=q.stopOrientation(game,station),anchor=renderer.worldToScreen(layout.x,layout.y),actual={x:frame.left+frame.width/2,y:frame.top+frame.height*.75};
        const bytes=frame.image.getContext('2d').getImageData(0,0,frame.image.width,frame.image.height).data,rect=canvas.getBoundingClientRect();
        let opaque=0,picked=0,clear=0,ink=0;
        for(let y=0;y<frame.image.height;y++)for(let x=0;x<frame.image.width;x++){
          const alpha=bytes[(y*frame.image.width+x)*4+3],px=frame.left+(x+.5)/frame.image.width*frame.width,py=frame.top+(y+.5)/frame.image.height*frame.height;
          if(alpha>=220)ink++;
          if(renderer.stationAtMarker(px+rect.left,py+rect.top))continue;
          if(alpha<220&&alpha!==0)continue;
          const ground=renderer.screenToTile(px+rect.left,py+rect.top);if(ground.x===station.x&&ground.y===station.y)continue;
          const hit=renderer.screenToInspectTile(px+rect.left,py+rect.top),matches=hit.x===station.x&&hit.y===station.y;
          if(alpha>=220){opaque++;if(matches)picked++;}else if(!matches)clear++;
        }
        return{mode,name,axis:frame.meta.axis,expectedAxis:axis,zoom,dpr:devicePixelRatio,anchorError:Math.hypot(actual.x-anchor.x,actual.y-anchor.y),opaque,picked,clear,ink,layout,sloped};
      },{mode,name,arms,axis,zoom});
      assert.equal(result.axis,axis);assert.ok(result.anchorError<=Math.SQRT2/dpr+.001,`ground registration ${JSON.stringify(result)}`);
      assert.ok(result.ink>0,'station keeps opaque artwork at every view');assert.equal(result.picked,result.opaque,`opaque station picking ${JSON.stringify(result)}`);assert.ok(result.clear>0,'transparent padding does not become station hit area');
      results.push(result);
      if(dpr===1&&['x-flat','y-flat','x-through','y-through','x-junction','y-junction','cross'].includes(name))await page.screenshot({path:`${output}/${mode}-${name}-zoom${zoom}.png`});
    }
    const live=await page.evaluate(()=>{
      const q=qa,{game,station,renderer}=q;station.mode='road';game.tiles=Array.from({length:game.width*game.height},()=>({terrain:'grass',elevation:2/7,cleared:true}));
      const tile=(dx,dy)=>game.tiles[(24+dy)*game.width+24+dx];tile(0,0).road=true;tile(1,0).road=true;game.revision++;game.networkRevision++;
      q.calls.length=0;renderer.render(1000,{settle:true});const first=q.calls.find(c=>c.meta.id==='isometric:bus-stop').meta.axis;
      tile(1,0).road=false;tile(0,1).road=true;game.revision++;game.networkRevision++;q.calls.length=0;renderer.render(1000,{settle:true});
      return{first,second:q.calls.find(c=>c.meta.id==='isometric:bus-stop').meta.axis};
    });assert.deepEqual(live,{first:'x',second:'y'});
    await page.close();
  }
  for(const mode of ['road','rail'])for(const axis of ['x','y'])assert.ok(results.some(r=>r.mode===mode&&r.axis===axis&&r.picked>0),`${mode}/${axis} has a selectable opaque roof beyond its ground tile`);
  assert.deepEqual(errors,[]);await writeFile(`${output}/results.json`,JSON.stringify({results,errors},null,2));
  console.log(JSON.stringify({profiles:results.length,groundAndPickingChecks:results.length,liveAxisUpdates:2,errors}));
}finally{await browser.close();}
