// Focused browser regressions: deterministic scenery, chunk continuity and warm-frame work.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.TYRAN_PLAYWRIGHT||'playwright');
const output=process.env.TYRAN_WORLD_OUTPUT||'/tmp/tyran-world-qa';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(new URL('worlds.js',process.env.TYRAN_URL||'http://127.0.0.1:8773/fun/tyran/').href);
  await page.setContent('<body style="margin:0;background:#09131c"><canvas id="world"></canvas></body>');
  const results=await page.evaluate(async()=>{
    const {WorldRenderer,WORLDS}=await import('./worlds.js');
    const canvas=document.querySelector('canvas'),c=canvas.getContext('2d');canvas.width=1200;canvas.height=960;
    const result=[];
    for(let worldIndex=0;worldIndex<10;worldIndex++) {
      const w=new WorldRenderer();w.setWorld(worldIndex);await w.art.promise;
      const warm=[],cold=[];
      // Let the same idle preparation used by the menu finish before the flight starts.
      for(let attempt=0;attempt<50&&(w.warmJobs.length||w.warmPending);attempt++)await new Promise(resolve=>setTimeout(resolve,20));
      for(const width of [430,1200,1900]) {
        canvas.width=width;canvas.height=960;
        const start=performance.now();w.draw(c,width,960,440,2,'high');cold.push(performance.now()-start);
        for(let i=0;i<50;i++){const start=performance.now();w.draw(c,width,960,440+i*.6,2+i/60,'high');warm.push(performance.now()-start);}
      }
      canvas.width=1200;canvas.height=960;w.draw(c,1200,960,440,2,'high');
      const p=w.visibleProps.find(p=>p.screenY>40&&p.screenY<900),identity=p.id,original={x:p.x,y:p.y};
      const partial=w.hit(p.x,p.y+440,0,1,440);const hp=p.hp;
      w.draw(c,430,960,100000,2,'low');w.draw(c,1900,960,440,2,'high');
      const retained=w.getBand(p.row).find(p=>p.id===identity);
      const damagePersistent=retained===p&&retained.hp===hp&&retained.x===original.x&&retained.y===original.y;
      const destroyed=w.hit(p.x*w.scale,(p.y+440)*w.scale,0,100000,440);
      w.draw(c,1200,960,150000,2,'low');w.draw(c,1200,960,440,2,'high');
      const paidTwice=w.hit(p.x,p.y+440,0,100000,440).some(e=>e.x===p.x&&e.y===p.y+440);
      // Tile edges must be as continuous as neighboring source pixels, not a new picture seam.
      let seamRatio=0;
      for(let row=-2;row<=1;row++) {
        const a=w.getArtTile(row).getContext('2d'),b=w.getArtTile(row+1).getContext('2d');
        const previous=a.getImageData(0,1022,1200,2).data,next=b.getImageData(0,0,1200,2).data;
        let seam=0,local=0;
        for(let x=0;x<1200;x+=4)for(let channel=0;channel<3;channel++) {
          const i=x*4+channel;
          seam+=Math.abs(previous[i+4800]-next[i]);
          local+=(Math.abs(previous[i]-previous[i+4800])+Math.abs(next[i]-next[i+4800]))*.5;
        }
        seamRatio=Math.max(seamRatio,seam/Math.max(1,local));
      }
      // A warm draw should issue zero gradients or per-prop object copies.
      let gradients=0;const proto=CanvasRenderingContext2D.prototype,radial=proto.createRadialGradient,linear=proto.createLinearGradient;
      proto.createRadialGradient=function(...args){gradients++;return radial.apply(this,args);};
      proto.createLinearGradient=function(...args){gradients++;return linear.apply(this,args);};
      w.draw(c,1200,960,440,2,'high');proto.createRadialGradient=radial;proto.createLinearGradient=linear;
      // Damage and position remain valid if art arrives after the initial fallback is shown.
      const delayed=new WorldRenderer();delayed.setWorld(worldIndex);const art=delayed.art;delayed.art={ready:false};
      delayed.draw(c,1200,960,400,0,'low');const before=delayed.visibleProps[0];
      delayed.hit(before.x,before.y+400,0,1,400);const beforeHp=before.hp;
      delayed.art=art;delayed.draw(c,1200,960,400,0,'low');
      const loadStable=delayed.getBand(before.row).includes(before)&&before.hp===beforeHp;
      warm.sort((a,b)=>a-b);
      result.push({world:WORLDS[worldIndex].id,coldMaxMs:Math.max(...cold),seamRatio,medianMs:warm[Math.floor(warm.length*.5)],p95Ms:warm[Math.floor(warm.length*.95)],damagePersistent,destroyed:destroyed.length,paidTwice,loadStable,gradients,props:w.visibleProps.length,tiles:w.tiles.size,layers:w.sceneryLayers.size});
      if(worldIndex===0||worldIndex===3||worldIndex===5||worldIndex===7) {
        const montage=document.createElement('canvas');montage.width=1600;montage.height=850;const mc=montage.getContext('2d');
        const surface=document.createElement('canvas');surface.width=1200;surface.height=2400;const sc=surface.getContext('2d');
        for(let n=0;n<4;n++){w.draw(sc,1200,2400,n*1900+330,4,'high');mc.drawImage(surface,n*400,40,400,800);mc.fillStyle='#ecf4f8';mc.font='16px sans-serif';mc.fillText(`${WORLDS[worldIndex].id.toUpperCase()} / ${n+1}`,n*400+12,26);}
        window[`montage${worldIndex}`]=montage.toDataURL('image/png');
      }
      // The game reuses one renderer; cancel test-only renderers before the next biome.
      w.warmEpoch++;w.warmJobs.length=0;delayed.warmEpoch++;delayed.warmJobs.length=0;
    }
    return result;
  });
  for(const r of results){assert(r.seamRatio<2.5,`${r.world}: no discontinuous artwork chunk edges`);assert(r.damagePersistent,`${r.world}: partial damage survives viewport changes/cache eviction`);assert(r.destroyed>0,`${r.world}: destructible scenery`);assert.equal(r.paidTwice,false,`${r.world}: no duplicate salvage`);assert(r.loadStable,`${r.world}: late image load keeps scenery identity/damage`);assert.equal(r.gradients,0,`${r.world}: cached warm rendering has no gradients`);}
  assert.deepEqual(errors,[]);
  for(const index of [0,3,5,7]){const data=await page.evaluate(i=>window[`montage${i}`],index);await writeFile(`${output}/world-${index}-districts.png`,Buffer.from(data.split(',')[1],'base64'));}
  await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));console.log('World QA passed: all ten biomes, three viewport widths, persistent scenery/damage, cached warm effects.');
} finally {await browser.close();}
