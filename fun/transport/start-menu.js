import { BIOMES } from './model.js';
import { createGameAsync } from './background-jobs.js';
import { savePreparedGame } from './autosave-storage.js';
import { DEFAULT_WORLD_SIZE, NEW_WORLD_SIZES, worldGenerationOptions } from './world.js';
import { listSaveSlots, readSaveSlot } from './save-slots.js';
import { hideLoading, showLoading, paintLoading, loadingJobProgress } from './loading-screen.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let initialGame=null;
export function takeStartupGame(){const game=initialGame;initialGame=null;return game;}
export async function chooseStartupGame(){initialGame=await openStartMenu();return initialGame;}

// Opening the menu reads save metadata only. No terrain is generated and no
// storage is written until the player chooses a world to create or load.
export function openStartMenu({canResume=false,biome='taiga',notice=''}={}){
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.id='start-menu';dialog.setAttribute('aria-labelledby','start-title');
  dialog.innerHTML=`<div class="start-shell"><aside class="start-intro"><div class="start-wordmark"><i>t</i>transport<span>.</span></div><div class="start-art" aria-hidden="true"><div class="start-land"></div><div class="start-rail"></div><img src="./assets/world/vehicle-locomotive-dimetric-v2/sources/vehicle_locomotive_SE.png" alt="" width="256" height="256"></div><span class="start-kicker">A world worth connecting</span><h1 id="start-title">Small beginnings.<br>Endless possibilities.</h1><p>Lay your first line. Bring towns to life. Build a world of your own.</p></aside><section class="start-content"><nav class="start-tabs" aria-label="Start game"><button id="start-new" aria-pressed="true">New game</button><button id="start-load" aria-pressed="false">Load game</button>${canResume?'<button id="start-resume">Resume</button>':''}</nav><div id="start-new-panel"><h2>Your next adventure</h2><form id="start-world-form"><fieldset class="start-biomes"><legend>Landscape</legend>${Object.entries(BIOMES).map(([key,b])=>`<label class="start-biome ${key}"><input type="radio" name="biome" value="${key}" ${key===biome?'checked':''}><span><strong>${escape(b.name)}</strong><small>${key==='taiga'?'Forests & rivers':key==='tundra'?'Snow & mountains':'Dunes & oases'}</small></span></label>`).join('')}</fieldset><label class="start-field">Map size<select name="size">${Object.entries(NEW_WORLD_SIZES).map(([key,size])=>`<option value="${key}" ${key===DEFAULT_WORLD_SIZE?'selected':''}>${size.label}</option>`).join('')}</select></label><div class="start-population"><label class="start-field">Towns<input name="townCount" type="number" required></label><label class="start-field">Industry districts<input name="industryDistricts" type="number" required></label></div><p class="start-count-note" id="start-industry-summary"></p><details class="start-advanced"><summary>World seed</summary><label class="start-field"><span class="sr-only">World seed</span><input name="seed" type="number" min="1" max="999999999" required value="${Math.floor(100000+Math.random()*900000)}"></label></details><button class="start-primary" type="submit" id="start-create">Create world <span aria-hidden="true">↗</span></button><p class="start-save-note">Named saves stay safe. Creating a world replaces the autosave.</p></form></div><div id="start-load-panel" hidden><h2>Your worlds</h2><p class="start-load-note">Saved in this browser.</p><div id="start-saves"></div></div><p id="start-message" role="status" aria-live="polite" hidden></p></section></div>`;
  document.body.append(dialog);hideLoading();dialog.showModal();document.querySelector('#app').inert=true;
  let busy=false;
  const $=selector=>dialog.querySelector(selector),form=$('#start-world-form');
  function message(text){$('#start-message').hidden=!text;$('#start-message').textContent=text;}
  message(notice);
  function options(reset=true){
   const size=form.elements.size.value,climate=form.elements.biome.value,limits=worldGenerationOptions(size,climate);
   const towns=form.elements.townCount,districts=form.elements.industryDistricts;
   towns.min=limits.minTowns;towns.max=limits.maxTowns;districts.min=limits.minIndustryDistricts;districts.max=limits.maxIndustryDistricts;
   if(reset){towns.value=limits.townCount;districts.value=limits.industryDistricts;}
   $('#start-industry-summary').textContent=`${(Number(districts.value)||0)*limits.industriesPerDistrict} industries · complete production chains in every district`;
  }
  options();form.elements.size.addEventListener('change',()=>options());
  for(const radio of form.querySelectorAll('[name=biome]'))radio.addEventListener('change',()=>options(false));
  form.elements.industryDistricts.addEventListener('input',()=>options(false));
  function finish(game){dialog.close();dialog.remove();resolve(game);}
  async function run(label,operation){
   if(busy)return;busy=true;message('');dialog.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);
   const controller=new AbortController();
   showLoading({title:label,status:label==='Creating your world'?'Shaping terrain, rivers and towns…':'Reading your saved company…',stage:1,onCancel:()=>controller.abort()});
   try{await paintLoading();const result=await operation({signal:controller.signal,onProgress:loadingJobProgress});controller.signal.throwIfAborted();if(!result?.ok)throw new Error(result?.message||'This world could not be opened.');showLoading({title:label,status:'Preparing your transport company…',stage:2});finish(result.game);}
   catch(error){hideLoading();document.querySelector('#app').inert=true;message(error.name==='AbortError'?'Cancelled. Your saved worlds are unchanged.':error.message||'Please try again.');}
   finally{busy=false;dialog.querySelectorAll('button,input,select').forEach(el=>el.disabled=el.dataset.unavailable==='true');}
  }
  form.addEventListener('submit',event=>{
   event.preventDefault();if(!form.reportValidity())return;
   const config={biome:form.elements.biome.value,size:form.elements.size.value,seed:Number(form.elements.seed.value),townCount:Number(form.elements.townCount.value),industryDistricts:Number(form.elements.industryDistricts.value)};
   void run('Creating your world',async options=>{
    const game=await createGameAsync(config,options);options.signal.throwIfAborted();const saved=savePreparedGame(game);
    return saved?.ok?{ok:true,game}:{ok:false,message:'Could not save this world. Free some browser storage and try again. Existing saves are unchanged.'};
   });
  });
  function tab(load){$('#start-new-panel').hidden=load;$('#start-load-panel').hidden=!load;$('#start-new').setAttribute('aria-pressed',String(!load));$('#start-load').setAttribute('aria-pressed',String(load));message('');if(load)renderSaves();}
  function renderSaves(){
   const result=listSaveSlots(),slots=result.slots||[];
   $('#start-saves').innerHTML=slots.length?slots.map((slot,i)=>`<button class="start-save" data-slot-index="${i}" ${slot.status!=='ready'?'disabled data-unavailable="true"':''}><span><strong>${escape(slot.name)}</strong><small>${slot.status==='ready'?`${escape(BIOMES[slot.biome]?.name)} · ${slot.width} × ${slot.height} · ${slot.routes} routes`:escape(slot.message||'Unavailable')}</small></span><span aria-hidden="true">↗</span></button>`).join(''):'<div class="start-empty">No saved worlds yet.<br>Start a new game to begin.</div>';
   if(!result.ok)message(result.message||'Saved games could not be read.');
   for(const button of $('#start-saves').querySelectorAll('[data-slot-index]'))button.addEventListener('click',()=>void run('Loading your world',async options=>{
    const slot=slots[Number(button.dataset.slotIndex)],loaded=await readSaveSlot(slot.id,options);options.signal.throwIfAborted();
    if(!loaded.ok)return loaded;
    if(slot.id!=='autosave'){const saved=savePreparedGame(loaded.game);if(!saved?.ok)return{ok:false,message:'Could not activate this save. Free some browser storage and try again.'};}
    return loaded;
   }));
  }
  $('#start-new').onclick=()=>tab(false);$('#start-load').onclick=()=>tab(true);
  $('#start-resume')?.addEventListener('click',()=>{if(!busy){document.querySelector('#app').inert=false;finish(null);}});
  dialog.addEventListener('cancel',event=>{event.preventDefault();if(canResume&&!busy){document.querySelector('#app').inert=false;finish(null);}});
  $('#start-new').focus({preventScroll:true});
 });
}
