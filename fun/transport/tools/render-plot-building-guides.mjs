// Native architectural construction references: physical doors, plot coverage,
// terrain alpha, saved design identity and both grid-aligned orientations.
// PNG loads are blocked so references cannot accidentally copy painted geometry.
import {writeFile,mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
import {plotBuildingJobs} from './plot-building-jobs.mjs';
const output=process.argv[2] || '/tmp/transport-wide-art';
const base=process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const jobs=await plotBuildingJobs();
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();
 await page.route('**/*.png',route=>route.abort());
 await page.route('**/wide-art-qa',route=>route.fulfill({contentType:'text/html',body:'<canvas></canvas>'}));
 await page.goto(new URL('wide-art-qa',base).href);
 for(const job of jobs){
  const result=await page.evaluate(async job=>{
   const {createSprites}=await import('./sprites.js'),{drawNativeFarmCore}=await import('./processing-sprites.js');
   const canvas=document.querySelector('canvas');canvas.width=job.columns*256;canvas.height=job.rows*256;const c=canvas.getContext('2d');c.clearRect(0,0,canvas.width,canvas.height);
   for(const [index,entry]of job.entries.entries()){
    if(!entry)continue;
    const span=entry.footprint,ox=index%job.columns*256,oy=Math.floor(index/job.columns)*256,density=8/span;
    if(job.type==='farm-core'){c.save();c.translate(ox,oy);c.scale(8,8);drawNativeFarmCore(c,entry.kind,()=>0,'taiga','town',2,{gardenGround:'terrain'});c.restore();}
    else{
     const sprite=createSprites('taiga',{pixelScale:density,detailLevel:'town',gardenGround:'terrain'}),nativeVariant=job.type==='house'?(entry.design||0):(entry.design||0)*5,image=sprite(entry.kind,nativeVariant,job.type==='industry'?span:1,'',span);
     c.save();if(job.type==='house'&&entry.rotation){c.translate(ox+256,oy);c.scale(-1,1);c.drawImage(image,0,8*density,256,256,0,0,256,256);}else c.drawImage(image,0,8*density,256,256,ox,oy,256,256);c.restore();
    }
   }
   return canvas.toDataURL('image/png').split(',')[1];
  },job);
  await mkdir(`${output}/${job.id}`,{recursive:true});
  await writeFile(`${output}/${job.id}/guide.png`,Buffer.from(result,'base64'));
  console.log(job.id);
 }
}finally{await browser.close();}
