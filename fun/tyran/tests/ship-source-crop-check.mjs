// Source crops must retain the original image's pixel grid, glow and animation.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
try {
  await page.goto(process.env.TYRAN_URL || 'http://127.0.0.1:8774/fun/tyran/');
  const result = await page.evaluate(async () => {
    await (await import('./sprite-assets.js')).spritesReady;
    const { drawShip, warmShipSprites, SHIP_PALETTES } = await import('./ships.js');
    const actual = document.createElement('canvas'), reference = document.createElement('canvas');
    actual.width = actual.height = reference.width = reference.height = 384;
    const a = actual.getContext('2d'), b = reference.getContext('2d');
    const isolatedA=document.createElement('canvas'),isolatedB=document.createElement('canvas');
    isolatedA.width=isolatedA.height=isolatedB.width=isolatedB.height=384;
    const ia=isolatedA.getContext('2d'),ib=isolatedB.getContext('2d');
    const original = a.drawImage.bind(a), full = b.drawImage.bind(b), seen = new WeakSet();
    let calls, area = 0, fullArea = 0, outsideAlpha = 0, inspected = 0;
    a.drawImage = (...args) => {
      const m=a.getTransform();args.matrix=[m.a,m.b,m.c,m.d,m.e,m.f];args.alpha=a.globalAlpha;args.composite=a.globalCompositeOperation;
      calls.push(args);return original(...args);
    };
    b.drawImage = (...args) => {
      if (args.length !== 9) return full(...args);
      const [image,sx,sy,sw,sh,dx,dy,dw,dh] = args, scaleX = dw/sw, scaleY = dh/sh;
      return full(image,dx-sx*scaleX,dy-sy*scaleY,image.width*scaleX,image.height*scaleY);
    };
    const inspect = args => {
      if (args.length !== 9) return;
      const [image,x,y,width,height,,,drawWidth,drawHeight] = args;
      const m=args.matrix,determinant=Math.abs(m[0]*m[3]-m[1]*m[2]);
      area += drawWidth*drawHeight*determinant;
      fullArea += image.width*image.height*drawWidth/width*drawHeight/height*determinant;
      if (seen.has(image)) return;
      seen.add(image); inspected++;
      const pixels = image.getContext('2d').getImageData(0,0,image.width,image.height).data;
      for (let row=0;row<image.height;row++) for (let col=0;col<image.width;col++)
        if (col<x||col>=x+width||row<y||row>=y+height) outsideAlpha += pixels[(row*image.width+col)*4+3];
    };
    const cases = [], matrix = [[1,0,0,1,.37,.63],[1.3,.11,-.09,1.17,4.2,-3.7],[.75,-.06,.08,.81,18,17]];
    let maximum = 0, totalDifference = 0, changed = 0, channels = 0, isolatedMaximum=0, isolatedLayers=0;
    for (let world=0;world<10;world++) {
      warmShipSprites(SHIP_PALETTES[world],world);
      warmShipSprites('#a4ffee',world,true); warmShipSprites('#ffd0a0',world,true);
      for (const kind of [0,1,2,3,4,5,6,7,8,9,'player','drone']) for (let sample=0;sample<3;sample++) {
        const color=kind==='drone'?'#ffd0a0':'#a4ffee', player=typeof kind==='string';
        const options={world,quality:sample===1?'low':'high',thrust:.35+sample*.6,phase:world*.7,hit:.37,shield:sample===2?.35:0,motion:sample!==2};
        for (const context of [a,b]) {
          context.resetTransform(); context.globalAlpha=1; context.globalCompositeOperation='source-over';
          context.fillStyle=world===1?'#c5d7df':'#17322f';context.fillRect(0,0,384,384);
          context.save();context.beginPath();context.rect(7.4,8.8,367,365);context.clip();
          context.setTransform(...matrix[sample]);context.globalAlpha=.83;context.globalCompositeOperation='source-over';
        }
        calls=[];
        for (const context of [a,b]) {
          drawShip(context,155.3,157.7,[17,47,80][sample],player?'player':kind,color,2.31+sample*.47,options);
          context.restore();
        }
        calls.forEach(inspect);
        const first=a.getImageData(0,0,384,384).data, second=b.getImageData(0,0,384,384).data;
        let maxDifference=0, differences=0;
        for(let i=0;i<first.length;i++) {
          const difference=Math.abs(first[i]-second[i]);
          maxDifference=Math.max(maxDifference,difference);totalDifference+=difference;differences+=Number(difference>0);
        }
        maximum=Math.max(maximum,maxDifference);changed+=differences;channels+=first.length;
        // A one-byte sampling roundoff can accumulate through overlapping
        // screen layers. Check those outliers one layer at a time as well.
        if(maxDifference>1)for(const args of calls)if(args.length===9){
          for(const context of [ia,ib]){
            context.resetTransform();context.globalAlpha=1;context.globalCompositeOperation='source-over';
            context.fillStyle='#17322f';context.fillRect(0,0,384,384);
            context.setTransform(...args.matrix);context.globalAlpha=args.alpha;context.globalCompositeOperation=args.composite;
          }
          ia.drawImage(...args);
          const [image,sx,sy,sw,sh,dx,dy,dw,dh]=args;
          ib.drawImage(image,dx-sx*dw/sw,dy-sy*dh/sh,image.width*dw/sw,image.height*dh/sh);
          const first=ia.getImageData(0,0,384,384).data,second=ib.getImageData(0,0,384,384).data;
          for(let i=0;i<first.length;i++)isolatedMaximum=Math.max(isolatedMaximum,Math.abs(first[i]-second[i]));
          isolatedLayers++;
        }
        cases.push({world,kind,sample,maxDifference,differences});
      }
    }
    return {cases:cases.length,maximum,meanDifference:totalDifference/channels,changed,areaRatio:area/fullArea,
      inspected,outsideAlpha,isolatedMaximum,isolatedLayers,worst:cases.sort((a,b)=>b.maxDifference-a.maxDifference||b.differences-a.differences).slice(0,8)};
  });
  const output=process.env.TYRAN_ARTIFACT_DIR||'/tmp/tyran-ship-crop-qa';
  await mkdir(output,{recursive:true});await writeFile(`${output}/results.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
  assert.equal(result.cases,360);
  assert.equal(result.outsideAlpha,0,'source crops retain every nontransparent source pixel, including shadow fringes');
  assert(result.maximum<=2&&result.meanDifference<.001,'overlapping ship layers retain appearance within accumulated byte rounding');
  assert(result.isolatedMaximum<=1,'each isolated cropped layer differs by at most one channel rounding step');
  assert(result.areaRatio<.65,'cropped ship layers substantially reduce submitted transparent image area');
  assert.deepEqual(errors,[]);
  console.log('PASS 360 cropped/full-source ship comparisons, intact blur fringes, continuous animation, and reduced image area');
} finally { await browser.close(); }
