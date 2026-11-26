import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium, webkit } from 'playwright';
const names=['gain','width','tuning','mute','sustain','sostenuto','soft','mechanics','body','hammer','age','detune','stretch','dynamics','lid','soundboard','sympathetic','duplex','room','felt','micClose','micXY','micLive','micDistant','micTube','invertClose','invertXY','invertLive','invertDistant','invertTube'];
const rows=readFileSync('oracle.tsv','utf8').trim().split('\n').map(line=>{const [name,...values]=line.split('\t');assert.equal(values.length,names.length);return {name,values:Object.fromEntries(names.map((id,i)=>[id,+values[i]]))};});
assert.equal(rows.length,13);
const pos=(id,v)=>id==='mechanics'?Math.pow(v/2,1/(Math.log(.175/2)/Math.log(.4))):v;
const text=(id,v)=>id==='tuning'?Number(v.toFixed(1))+' Hz':Math.round(100*pos(id,v))+'%';
const retained={gain:.43,tuning:444.25,mute:.37,sustain:.24,sostenuto:.36,soft:.52,mechanics:.62};
const base='https://protocodus.cz';
mkdirSync('audit-images',{recursive:true});
for(const [name,type,size] of [['chromium',chromium,{width:1440,height:900}],['webkit',webkit,{width:390,height:844}]]) {
 const browser=await type.launch({headless:true});const page=await browser.newPage({viewport:size,deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>(new URL(route.request().url()).origin===base)?route.continue():route.abort());
 await page.goto(base+'/fun/keyra/',{waitUntil:'networkidle'});
 const nodes=id=>page.locator('#control-'+id);
 for(const [id,value] of Object.entries(retained)){
   await nodes(id).evaluate((el,val)=>{el.value=String(val);el.dispatchEvent(new Event('input',{bubbles:true}));},value);
 }
 for(const id of names.filter(id=>id.startsWith('invert')))await nodes(id).click();
 const read=()=>page.evaluate(ids=>Object.fromEntries(ids.map(id=>{
   const input=document.getElementById('control-'+id);
   if(id==='body')return [id,{v:+input.querySelector('[aria-pressed="true"]').id.split('-').at(-1)}];
   if(id.startsWith('invert'))return [id,{v:+(input.getAttribute('aria-pressed')==='true')}];
   const output=document.querySelector('output[for="control-'+id+'"]');
   return [id,{v:input.valueAsNumber,label:output.innerText,aria:input.getAttribute('aria-valuetext'),width:input.getBoundingClientRect().width,step:input.step}];
 })),names);
 const stamp=async id=>createHash('sha256').update(await nodes(id).screenshot({animations:'disabled'})).digest('hex');
 const frames={};
 for(const [i,row] of rows.entries()){
   await page.locator('#preset-'+i).click();
   assert.equal(await page.locator('#current-preset').innerText(),row.name);
   const actual=await read();
   for(const id of names){const want=pos(id,row.values[id]), found=actual[id];assert.ok(Math.abs(want-found.v)<0.000001,name+' '+row.name+' '+id+' slider '+found.v+' expected '+want);
     if(found.step!==undefined){assert.equal(found.step,'any');assert.ok(found.width>0,id);assert.equal(found.aria,text(id,row.values[id]),name+' '+row.name+' '+id+' aria');assert.equal(found.label,found.aria,name+' '+row.name+' '+id+' visible text');}}
   console.log(name,row.name,'hammer',actual.hammer.label,'practice felt',actual.felt.label,'felt mute',actual.mute.label,'detune',actual.detune.label);
   if([0,5,12].includes(i)) { frames[i]={felt:await stamp('felt'),detune:await stamp('detune')}; }
 }
 assert.notEqual(frames[0].felt,frames[5].felt,name+' practice felt rendered thumb moved');
 assert.notEqual(frames[0].detune,frames[12].detune,name+' detune rendered thumb moved');
 await page.locator('#preset-5').click();
 const before=await read();
 await page.locator('#control-body-4').click();
 const after=await read();
 assert.equal(after.body.v,4);
 for(const id of names.filter(id=>id!=='body')) assert.deepEqual(after[id],before[id],name+' body-only edit '+id);
 assert.equal(await page.locator('#current-preset').innerText(),'Felt Nocturne (edited)');
 await page.locator('#preset-5').click();
 assert.equal((await read()).body.v,0);
 await page.locator('#control-felt').scrollIntoViewIfNeeded();
 await page.screenshot({path:'audit-images/'+name+'-felt-nocturne.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log(name+' passed 390 factory/retained values across 13 programs, displayed range readouts, actual thumb pixels, body-only edit and program re-recall.');
 await browser.close();
}
