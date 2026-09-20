// Irregular tile interiors must retain seamless joins across every variant.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.TYRAN_PLAYWRIGHT||'playwright');
const output=process.env.TYRAN_TERRAIN_OUTPUT||'/tmp/tyran-terrain-qa';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:2000,height:1040}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(new URL('worlds.js',process.env.TYRAN_URL||'http://127.0.0.1:8773/fun/tyran/').href);
  await page.setContent('<body style="margin:0;background:#080d17"><canvas width="2000" height="1040"></canvas></body>');
  const results=await page.evaluate(async()=>{
    const {WorldRenderer,WORLDS}=await import('./worlds.js');
    const {TerrainSprites}=await import('./terrain-sprites.js');
    const board=document.querySelector('canvas').getContext('2d'),results=[];
    const pixels=surface=>surface.getContext('2d').getImageData(0,0,surface.width,surface.height).data;
    const signature=surface=>{let hash=2166136261;for(const byte of pixels(surface))hash=Math.imul(hash^byte,16777619);return hash>>>0;};
    for(let index=0;index<10;index++) {
      const w=new WorldRenderer();w.setWorld(index);await w.ready;
      w.warmEpoch++;w.warmJobs=[];w.queueWarm=()=>{};
      const terrain=w.terrain;
      let edgeRGB=0,edgeAlpha=0,reused=true;
      for(let material=1;material<=3;material++)for(let variant=0;variant<6;variant++) {
        const surface=terrain.getMaterial(material,variant),size=surface.width;
        const a=pixels(surface),b=pixels(terrain.getMaterial(material,(variant+1)%6));
        reused&&=terrain.getMaterial(material,variant)===surface;
        for(let t=0;t<size;t++)for(let channel=0;channel<3;channel++) {
          edgeRGB=Math.max(edgeRGB,
            Math.abs(a[(t*size+size-1)*4+channel]-b[t*size*4+channel]),
            Math.abs(a[((size-1)*size+t)*4+channel]-b[t*4+channel]));
        }
        // Shared top/bottom halves in both axes, including displaced cliff
        // shadows. All variants must meet at exactly the same alpha profile.
        for(const [first,second,vertical]of [[2,1,false],[4,8,false],[4,2,true],[8,1,true]]) {
          const surface=terrain.get(material,variant,first);
          const a=pixels(surface),b=pixels(terrain.get(material,(variant+1)%6,second));
          reused&&=terrain.get(material,variant,first)===surface;
          for(let t=0;t<size;t++)edgeAlpha=Math.max(edgeAlpha,Math.abs(
            a[(vertical?(size-1)*size+t:t*size+size-1)*4+3]-b[(vertical?t:t*size)*4+3]));
        }
      }
      const variants=new Set(Array.from({length:6},(_,variant)=>signature(terrain.get(3,variant,7))));
      const second=new TerrainSprites(index,w.palette);
      const deterministic=signature(terrain.get(3,4,7))===signature(second.get(3,4,7));
      const x=index%5*400,y=Math.floor(index/5)*520;
      board.fillStyle='#eee';board.font='16px monospace';board.fillText(WORLDS[index].id,x+10,y+22);
      board.drawImage(w.getTile(0),150,0,800,800,x,y+30,400,480);
      results.push({world:WORLDS[index].id,edgeRGB,edgeAlpha,reused,deterministic,variants:variants.size});
    }
    return results;
  });
  for(const result of results) {
    assert(result.edgeRGB<=1,`${result.world}: no bright seams between varied material crops`);
    assert.equal(result.edgeAlpha,0,`${result.world}: raised banks and shadows join exactly`);
    assert(result.reused&&result.deterministic,`${result.world}: seeded relief is cached and reproducible`);
    assert.equal(result.variants,6,`${result.world}: all six contours retain distinct interiors`);
  }
  assert.deepEqual(errors,[]);
  await page.screenshot({path:`${output}/terrain-contact.png`});
  await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));
  console.log('Terrain relief QA passed: ten biomes, six deterministic variants, seamless material tones and exact bank/shadow joins.');
} finally {await browser.close();}
