// Decorative ground cover must not change the identities used by saved damage.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.TYRAN_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.TYRAN_BROWSER||'chrome',headless:true});
const output=process.env.TYRAN_SCENERY_OUTPUT||'/tmp/tyran-living-scenery';
const compatibility=[2914485099,1824658041,114980688,2275891951,258405471,3319895568,3226430529,530718848,1987529917,2614114120];
try {
  const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(new URL('worlds.js',process.env.TYRAN_URL||'http://127.0.0.1:8773/fun/tyran/').href);
  await page.setContent('<canvas id="scene" width="1200" height="900"></canvas>');
  const result=await page.evaluate(async()=>{
    const {WorldRenderer,WORLDS}=await import('./worlds.js'),canvas=document.querySelector('canvas'),c=canvas.getContext('2d');
    const world=new WorldRenderer();await world.ready;world.warmEpoch++;world.warmJobs=[];world.queueWarm=()=>{};
    const contact=document.createElement('canvas');contact.width=2400;contact.height=768;const cc=contact.getContext('2d');
    const signatures=[],decorations=[];
    for(let index=0;index<10;index++){
      world.setWorld(index,'scenery-compatibility');let hash=2166136261,count=0;
      for(let row=-4;row<3;row++){
        const props=world.getBand(row),before=props.length,damage=world.damage.size;
        const details=world.getGroundDetails(row),again=world.getGroundDetails(row);
        if(JSON.stringify(details)!==JSON.stringify(again))throw new Error('Ground details must be deterministic');
        count+=details.reduce((n,cluster)=>n+cluster.items.length,0);
        if(props.length!==before||world.damage.size!==damage)throw new Error('Decorations changed colliders or damage');
        for(const prop of props){
          const text=JSON.stringify([prop.id,prop.x,prop.y,prop.type,prop.size,prop.variant,prop.maxHp]);
          for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619)>>>0;
        }
      }
      signatures.push(hash);decorations.push(count);
      world.draw(c,1200,900,3200,1,'high',600,false);
      const x=(index%5)*480,y=Math.floor(index/5)*384;cc.drawImage(canvas,x,y,480,360);
      cc.fillStyle='#07121b';cc.fillRect(x,y+360,480,24);cc.fillStyle='#cfddd7';cc.font='14px sans-serif';cc.fillText(WORLDS[index].name,x+10,y+378);
    }
    world.setWorld(1,'living-machinery');world.draw(c,1200,900,0,1,'high');
    const prop={id:'activity-fixture',x:600,y:400,type:'radar',size:80,variant:2,hp:100,maxHp:100};
    const pixels=(time,motion=true)=>{c.clearRect(0,0,1200,900);world.drawStructureActivity(c,prop,time,'high',motion);const a=c.getImageData(540,340,120,120).data;let hash=2166136261,alpha=0;for(let i=0;i<a.length;i++){hash=Math.imul(hash^a[i],16777619)>>>0;if(i%4===3)alpha+=a[i];}return {hash,alpha};};
    const first=pixels(0),later=pixels(2),still=pixels(0,false),stillLater=pixels(2,false);
    prop.hp=55;const light=pixels(0);prop.hp=20;const heavy=pixels(0);prop.hp=0;const crater=pixels(0);
    world.draw(c,1200,900,0,1,'high');const caches=[...world.sceneryLayers[0]],spriteCount=world.sprites.size;
    const before=canvas.toDataURL();world.draw(c,1200,900,0,3,'high',600,false);const frozen=canvas.toDataURL();
    world.draw(c,1200,900,0,9,'high',600,false);const frozenLater=canvas.toDataURL();
    const stableCaches=caches.every(([row,cache])=>world.sceneryLayers[0].get(row)===cache)&&spriteCount===world.sprites.size;
    return {signatures,decorations,activity:{first,later,still,stillLater,light,heavy,crater},stableCaches,frozen:frozen===frozenLater,active:before!==frozen,contact:contact.toDataURL()};
  });
  assert.deepEqual(result.signatures,compatibility,'saved scenery IDs, positions, classes, sizes and durability remain compatible');
  assert(result.decorations.every(count=>count>80&&count<1800),'all ten worlds have bounded clustered ground details');
  const a=result.activity;
  assert.notEqual(a.first.hash,a.later.hash,'working machinery has subtle animation');
  assert.equal(a.still.hash,a.stillLater.hash,'reduced motion freezes machinery');
  assert(a.first.alpha>a.light.alpha&&a.light.alpha>a.heavy.alpha&&a.heavy.alpha>0,'damaged machinery becomes quieter');
  assert.equal(a.crater.alpha,0,'destroyed structures have no operational glow or movement');
  assert(result.stableCaches,'animation reuses body strips and sprites');
  assert(result.frozen,'reduced motion also freezes atmospheric ambient animation');
  assert(result.active,'normal scenery has visible ambient movement');
  assert.deepEqual(errors,[]);
  await mkdir(output,{recursive:true});await writeFile(`${output}/worlds.png`,Buffer.from(result.contact.split(',')[1],'base64'));delete result.contact;
  await writeFile(`${output}/results.json`,JSON.stringify(result,null,2));
  console.log('PASS saved scenery identity, seeded ground cover, subtle damage-aware structure activity, reduced motion and cache reuse.');
  console.log(JSON.stringify(result,null,2));
} finally {await browser.close();}
