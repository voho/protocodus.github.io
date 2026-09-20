// Biome fleets must keep their own silhouettes in every attitude and preserve
// the generated aspect ratios instead of being stretched into the old hulls.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium }=await import(process.env.TYRAN_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.TYRAN_BROWSER||'chrome',headless:true});
const output=process.env.TYRAN_SCREENSHOTS||'/tmp/tyran-qa';
await mkdir(output,{recursive:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1700}});
  await page.goto(process.env.TYRAN_URL||'http://127.0.0.1:8773/fun/tyran/');
  const result=await page.evaluate(async()=>{
    const {spritesReady,spriteStatus,spriteCell}=await import('./sprite-assets.js');await spritesReady;
    const {drawShip,warmShipSprites,SHIP_PALETTES}=await import('./ships.js?family-qa');
    const names=['Jungle','Snow','Desert','Paradise','Asteroid','Mars','Volcanic','Neon','Alien','Void'];
    const sources=new Map(),used=new Set(),foreign=new Set();
    for(const name of names)for(let index=1;index<=10;index++){const cell=spriteCell(`fleet${name}`,index);if(cell)sources.set(cell,`${name}:${index}`);}
    for(const atlas of ['fleetLeft','fleetRight'])for(let index=1;index<=10;index++){const cell=spriteCell(atlas,index);if(cell)foreign.add(cell);}
    const prototype=OffscreenCanvasRenderingContext2D.prototype,original=prototype.drawImage;
    let wrongBank=0;
    prototype.drawImage=function(...args){if(sources.has(args[0]))used.add(sources.get(args[0]));if(foreign.has(args[0]))wrongBank++;return original.apply(this,args);};
    const canvas=document.createElement('canvas');canvas.width=canvas.height=384;
    const c=canvas.getContext('2d'),draw=c.drawImage.bind(c);let hull;
    c.drawImage=(...args)=>{if(args.length===5&&args[1]===-140&&args[3]===280)hull=args[0];return draw(...args);};
    const bounds=canvas=>{
      const {width:w,height:h}=canvas,p=canvas.getContext('2d').getImageData(0,0,w,h).data;
      let left=w,top=h,right=-1,bottom=-1,hash=2166136261;
      for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(p[(y*w+x)*4+3]>=180){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);hash=Math.imul(hash^(y*w+x),16777619)>>>0;}
      const rowWidth=fraction=>{const y=Math.min(h-1,top+Math.round((bottom-top)*fraction));let pixels=0;for(let x=0;x<w;x++)if(p[(y*w+x)*4+3]>=180)pixels++;return pixels;};
      return{width:right-left+1,height:bottom-top+1,hash,front:rowWidth(.2),rear:rowWidth(.7)};
    };
    const proportions=[],identities=[];
    for(let world=0;world<10;world++){
      warmShipSprites(SHIP_PALETTES[world],world);
      for(let kind=0;kind<10;kind++){
        const source=spriteCell(`fleet${names[world]}`,kind+1);if(!source)continue;
        const expected=bounds(source);
        drawShip(c,192,192,45,kind,null,0,{world,bank:0,quality:'low'});
        const level=bounds(hull);
        if((world===1||world===8)&&kind===5&&level.front>=level.rear*.5)throw new Error(`${names[world]} artillery cannon must point forward in its canonical sprite`);
        proportions.push(Math.abs(level.width/level.height-expected.width/expected.height));
        if(kind===4)identities.push(level.hash);
        for(const bank of [-.3,.3]){drawShip(c,192,192,45,kind,null,0,{world,bank,quality:'low'});const rolled=bounds(hull);if(rolled.width>=level.width)throw new Error(`${names[world]} ${kind}: bank did not foreshorten its own hull`);}
      }
    }
    prototype.drawImage=original;
    document.body.innerHTML='<canvas id="family-qa" width="1440" height="1700" style="position:fixed;inset:0;width:1440px;height:1700px"></canvas>';
    const board=document.querySelector('#family-qa').getContext('2d');
    const ground=['#274537','#b6c6ce','#b18a53','#178b98','#343335','#8a4434','#392d2a','#33283e','#574469','#252330'];
    for(let world=0;world<10;world++){
      board.fillStyle=ground[world];board.fillRect(0,world*170,1440,170);
      board.fillStyle='#091016';board.fillRect(0,world*170,1440,24);board.fillStyle='#fff';board.font='14px monospace';board.fillText(names[world],12,world*170+17);
      for(let kind=-1;kind<10;kind++)drawShip(board,64+(kind+1)*130,world*170+102,kind===9?41:34,kind<0?'player':kind,null,0,{world,bank:kind%3===0?.3:0,thrust:.2});
    }
    return{status:spriteStatus(),used:used.size,wrongBank,proportions,identities:new Set(identities).size};
  });
  for(const name of ['Jungle','Snow','Desert','Paradise','Asteroid','Mars','Volcanic','Neon','Alien','Void'])assert.equal(result.status[`fleet${name}`]?.state,'ready',`${name} fleet is available`);
  assert.equal(result.used,100,'All ten classes use each of the ten biome fleets');
  assert.equal(result.wrongBank,0,'Banking never replaces a family ship with generic art');
  assert.ok(result.proportions.every(error=>error<.06),'Fleet silhouettes retain source aspect ratios');
  assert.equal(result.identities,10,'Each environment has a distinct heavy-fighter silhouette');
  await page.screenshot({path:`${output}/fleet-families.png`});
  console.log('Family QA passed: 100 family hulls, stable identities through banking, preserved aspect ratios and ten distinct fleets.');
}finally{await browser.close();}
