#!/usr/bin/env node
// One reproducible identity-preserving manifest for plot-sized RGBA architecture.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILDINGS } from '../buildings.js';
import { INDUSTRIES } from '../data.js';
import { HOUSE_KINDS } from '../raster-houses.js';
import { BUILDING_REGISTRATION, SPRITE_SCALE, buildingGenerationPrompt, featureMasterPixels } from '../sprite-art-direction.js';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLIMATES = ['taiga', 'tundra', 'desert'];
const asset = relative => resolve(ROOT, 'assets', relative);
const families = {
  'city-civic': ['school', 'hospital', 'police-station', 'fire-station', 'stadium', 'church', 'pub', 'shop-grocery', 'shop-bakery'],
  'city-commerce': ['shop-butcher', 'shop-hardware', 'shop-florist', 'service-post-office', 'service-bank', 'service-hotel', 'service-garage', 'service-barber', 'factory'],
  'city-town-features': ['park', 'playground', 'swimming-pool', 'sports-field', 'tennis-courts', 'ballpark', 'sports-hall', 'town-hall', 'shop-cafe', 'shop-pharmacy', 'shop-bookshop', null],
};
const cityStyles = {
  school:'A broad two-storey plaster school with paired classroom wings and a central entrance, slate roofs, playground paths.',
  hospital:'A three-storey pale hospital with broad connected wards, muted blue-grey flat roofs and one clear emergency canopy.',
  'police-station':'A two-storey pale stone police station, slate hipped roof, low side vehicle shelter and a broad understated blue accent.',
  'fire-station':'A long brick fire station with three 4.2m-high vehicle bays and a modest two-storey office wing.',
  stadium:'An open sports stadium with a large green playing pitch, low enclosing stands and two broad covered spectator wings.',
  church:'A long pale stone church, slate pitched nave roof, broad aisles, a slender upright bell tower and a modest entry portico.',
  pub:'An old plaster village pub with a broad terracotta roof, two storeys and an outdoor terrace beneath one restrained awning.',
  'shop-grocery':'A traditional grocer with a broad green storefront awning, glazed shopfront and a two-storey cream facade.',
  'shop-bakery':'A warm brick bakery with a terracotta roof, cream awning, large plain shop windows and a modest rear baking wing.',
  'shop-butcher':'A pale stone butcher shop with a muted burgundy awning, glazed storefront and a broad slate roof.',
  'shop-hardware':'A brick hardware store with a muted ochre awning, broad slate roof and one large covered loading annex.',
  'shop-florist':'A cream florist with a broad green awning, a few large planted groups and a glass greenhouse annex.',
  'service-post-office':'A broad brick post office with a slate hipped roof, an ordinary central entrance and a covered sorting annex.',
  'service-bank':'A substantial two-storey pale stone bank with broad symmetrical wings, a slate roof and a short modest-column entrance.',
  'service-hotel':'A three-storey plaster hotel with a broad terracotta roof, repeated human-scale windows and a low side courtyard wing.',
  'service-garage':'A wide low repair garage with three 4.2m-high vehicle doors, a small office and a muted blue-grey roof.',
  'service-barber':'A two-storey cream neighbourhood barber with a burgundy storefront canopy and a broad slate roof.',
  factory:'A town workshop with several connected low brick production wings, four loading bays and a broad slate sawtooth roof.',
  'park-village':'A village green with crossing pale gravel paths, broad tree groups, a low fence and a simple stone monument. Bare lawn transparent.',
  'park-formal':'A formal garden with symmetrical clipped hedge groups, crossing gravel paths and one large stone fountain. Bare lawn transparent.',
  'park-woodland':'A woodland park with several broad deciduous and conifer groups, a winding broad path and simple timber benches. Bare ground transparent.',
  'mall-neighborhood':'A low neighbourhood shopping centre with four connected shop units, green canopies and broad quiet roof masses.',
  'mall-shopping':'A shopping mall with several broad connected retail halls, a covered entrance court, repeated storefront bays and a slate roof.',
  'mall-modern':'A modern shopping mall with broad pale concrete halls, one glazed atrium, blue-grey flat roofs and a substantial covered entry.',
};
const houseDescriptions = [
  ['Traditional pale-plaster workers cottage, warm pitched terracotta roof.', 'Classic timber cabin, slate pitched roof and a small timber porch.', 'Joined cream terraced cottage with broad terracotta roof.', 'Classic gabled family home, two plaster storeys and a slate roof.', 'Two-storey brick villa with a broad terracotta roof.', 'Modern stone garden bungalow, one storey, blue-grey flat roof.', 'Country manor with a two-storey central block and low stone side wings.', 'Grand classic brick townhouse with two storeys and a slate hipped roof.', 'Courtyard plaster villa with two low side wings and a terracotta roof.'],
  ['Old stone workers cottage with a low slate roof.', 'Old wooden log cabin with a broad terracotta roof.', 'Classic brick terraced cottage with a slate roof.', 'Modern ecological timber family house with two storeys and a broad green roof.', 'Classic cream-plaster villa with two storeys and a slate roof.', 'Wooden ecological bungalow with a broad green roof and a modest glass garden room.', 'Stony country manor with low wings and a slate roof.', 'Modern pale-stone townhouse with two storeys and broad flat slate roofs.', 'Classic brick courtyard villa with low connected wings and terracotta roofs.'],
  ['Modern ecological wooden cottage with a broad green roof.', 'Classic stony cabin with a slate pitched roof.', 'Old wooden terraced cottage with a terracotta roof.', 'Old red-brick family home with two storeys and a terracotta gable roof.', 'Modern ecological timber villa, two storeys and a slate roof with broad dark solar panels.', 'Classic pale-plaster bungalow with a terracotta roof.', 'Modern ecological timber country manor with wide low wings and broad slate roofs.', 'Old warm-stone grand townhouse with two storeys and a slate roof.', 'Modern stone courtyard villa with connected low wings and broad flat green roofs.'],
];
function cityEntry(kind, design=0, description='') {
  if (!kind) return null;
  const footprint=BUILDINGS[kind]?.footprint || 2;
  return { id:`civic:${kind}:taiga${design ? `:design-${design}` : ''}`, kind, runtimeIds:CLIMATES.map(climate=>`civic:${kind}:${climate}${design ? `:design-${design}` : ''}`), eligibleBiomes:CLIMATES, name:BUILDINGS[kind]?.name || 'Town workshop', footprint, design, description:description || cityStyles[kind] || `Distinctive ${BUILDINGS[kind]?.name || kind} with broad recognizable architectural masses.` };
}
function job(id,type,columns,rows,entries,reference,direction='') {
  return { id,type,columns,rows,biome:'taiga',cellPixels:256,transparent_background:true,reference,destination:asset(`world/plot-buildings-v2/${id}`),entries,scale:SPRITE_SCALE,registration:BUILDING_REGISTRATION,direction:`Neutral all-climate architectural cutouts: use canonical taiga MATERIAL colours without painting grass, snow, sand or generic bare earth. Every unbuilt ground gap is genuine zero-alpha transparency. Spread the complete layout to within a narrow setback of the 15m per tile envelope. Keep all full-cell registration and calibrated metre proportions exactly. ${direction}` };
}
export async function plotBuildingJobs() {
  const jobs=[];
  for(let design=0;design<3;design++)for(let rotation=0;rotation<2;rotation++) {
    const entries=HOUSE_KINDS.map((kind,index)=>({id:kind,kind,name:BUILDINGS[kind].name,footprint:BUILDINGS[kind].footprint,design,rotation,eligibleBiomes:CLIMATES,runtimeIds:CLIMATES.map(climate=>`house:${kind}:${climate}:design-${design}:rotation-${rotation}`),description:`${houseDescriptions[design][index]} Extend the house with more rooms or a low wing where useful, retain a usable garden, several broad planted groups, a path and a low 1.2m fence across nearly the whole ${15*BUILDINGS[kind].footprint}m square envelope. All bare garden lawn is transparent; ordinary doors, windows and storeys retain the calibrated human scale.`}));
    const folder=`houses/taiga/${design?`design-${design}/`:''}${rotation?'rotation-1/':''}`;
    jobs.push(job(`houses-design-${design}-rotation-${rotation}`,'house',3,3,entries,asset(`${folder}house-atlas.png`),`Entrance orientation ${rotation}: ${rotation?'swap the east/north axes of the facade and roof; maintain exact ground slopes +/-0.5':'front entrance on the first canonical grid facade'}. Preserve every identity and design in the specified row-major order.`));
  }
  for(const [id,kinds] of Object.entries(families)) {
    let entries=kinds.map(kind=>cityEntry(kind));
    if(id==='city-town-features') {
      const old=JSON.parse(await readFile(asset('world/buildings-town-features/taiga/job-2026-10-07.json'),'utf8'));
      entries=entries.map((entry,index)=>entry && {...entry,description:old.entries[index].description.replace(/A (10|20|30)m by \1m inset/g,`A ${entry.footprint*15}m by ${entry.footprint*15}m full-envelope`).replace(/Quiet lawn masses/g,'Transparent bare lawn')+` Expand equipment spacing, paths and planted groups across the ${entry.footprint*15}m envelope; add architectural wings where appropriate without changing any human-feature height.`});
    }
    const ref=id==='city-civic'?'buildings-civic':id==='city-commerce'?'buildings-commerce-camera-v2':'buildings-town-features';
    jobs.push(job(id,'city',id==='city-town-features'?4:3,3,entries,asset(`world/${ref}/taiga/atlas.png`)));
  }
  const variety=[...['park-village','park-formal','park-woodland','mall-neighborhood','mall-shopping','mall-modern'].map(kind=>cityEntry(kind)),...['shop-grocery','shop-bakery','shop-butcher'].map(kind=>cityEntry(kind,1,`${cityStyles[kind]} Alternate exterior 1: classic warm-stone facade, broad terracotta roof and a low side extension.`))];
  jobs.push(job('city-retail-variety','city',3,3,variety,asset('world/town-variety-v1/civic-retail/taiga/atlas.png')));
  const alternates=[...['shop-hardware','shop-florist'].map(kind=>cityEntry(kind,1,`${cityStyles[kind]} Alternate exterior 1: classic warm-stone facade, broad terracotta roof and a low side extension.`)),...['shop-grocery','shop-bakery','shop-butcher','shop-hardware','shop-florist'].map(kind=>cityEntry(kind,2,`${cityStyles[kind]} Alternate exterior 2: modern pale-plaster and timber facade, broad flat blue-grey roof and a low side extension.`)),null,null];
  jobs.push(job('city-shop-alternates','city',3,3,alternates,asset('world/town-variety-v1/shop-alternates/taiga/atlas.png')));
  const sourceJobs=await Promise.all(['industries-taiga','industries-taiga-extra','industries-tundra','industries-tundra-extra','industries-desert','industries-desert-extra','food-industry-v1/taiga'].map(async folder=>({folder,...JSON.parse(await readFile(asset(`world/${folder}/generation-job.json`),'utf8'))})));
  const industryEntry=(kind,footprint=5)=>{
    const prior=sourceJobs.flatMap(source=>source.entries.filter(Boolean).map(entry=>({...entry,sourceFolder:source.folder}))).find(entry=>entry.id.split(':')[1]===kind);
    return {id:`${footprint===2?'farm-core':'industry'}:${kind}:taiga`,kind,name:INDUSTRIES[kind].name,footprint,eligibleBiomes:INDUSTRIES[kind].biomes,runtimeIds:INDUSTRIES[kind].biomes.map(climate=>`${footprint===2?'farm-core':'industry'}:${kind}:${climate}`),reference:prior?asset(`world/${prior.sourceFolder}/atlas.png`):null,description:(prior?.description||`Distinctive ${INDUSTRIES[kind].name} compound.`)+` This slot is ONLY a ${footprint*16}m square ${footprint===2?'farm building core with compact broad barn wings, equipment and isolated planted groups; NO fields or perimeter fence (terrain renders those separately)':'full industry plot; use repeated wings, loading sheds, process equipment and storage groups almost to the 75m envelope'}. All generic yard ground is zero-alpha; keep paths, paved working surfaces, useful equipment, contact shadows and material heaps.`};
  };
  const kinds=Object.keys(INDUSTRIES);
  for(let group=0;group<4;group++) {
    const entries=kinds.slice(group*9,group*9+9).map(kind=>industryEntry(kind));
    const single=entries.length===1;
    if(!single)while(entries.length<9)entries.push(null);
    jobs.push(job(`industries-${group+1}`,'industry',single?1:3,single?1:3,entries,entries.find(Boolean).reference));
  }
  const coreKinds=kinds.filter(kind=>INDUSTRIES[kind].farming);
  jobs.push(job('farm-cores','farm-core',3,2,[...coreKinds.map(kind=>industryEntry(kind,2)),null],asset('world/farm-cores-v1/taiga/atlas.png')));
  return jobs.map(item=>({...item,calibration:item.entries.map(entry=>entry&&({id:entry.id,footprint:entry.footprint,doorHeightMasterPixels:featureMasterPixels(SPRITE_SCALE.doorHeightMetres,entry.footprint),storeyHeightMasterPixels:featureMasterPixels(SPRITE_SCALE.storeyHeightMetres,entry.footprint),envelopeMetres:BUILDING_REGISTRATION.architecturalEnvelopeMetresPerTile*entry.footprint})),prompt:buildingGenerationPrompt(item)}));
}
export async function writePlotBuildingJobs(output='/tmp/transport-wide-art') {
  const jobs=await plotBuildingJobs();await mkdir(output,{recursive:true});
  await writeFile(resolve(output,'jobs.json'),JSON.stringify(jobs,null,2)+'\n');
  for(const item of jobs) {
    await writeFile(resolve(output,`${item.id}.json`),JSON.stringify(item,null,2)+'\n');
    await writeFile(resolve(output,`${item.id}.prompt.txt`),item.prompt+'\n');
  }
  return jobs;
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const jobs=await writePlotBuildingJobs(process.argv[2]);
  process.stdout.write(JSON.stringify({jobs:jobs.length,entries:jobs.reduce((sum,item)=>sum+item.entries.filter(Boolean).length,0),output:resolve(process.argv[2]||'/tmp/transport-wide-art')})+'\n');
}
