import { INDUSTRIES } from './data.js';
import { localEnvironment, randomAt, weatherAt } from './environment.js';
import { industrySize } from './industry-sites.js';
const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,value));
const MAX_INVENTORY=900;

export function industryConditions(game,industry){
  const e=localEnvironment(game,industry.x,industry.y,4,industrySize(industry)),weather=weatherAt(game,industry.x,industry.y,Math.floor(game.day));
  const positive=[],negative=[],kind=industry.kind;
  let workers=clamp(e.housing/12),partners=0;
  for(const city of game.cities){const d=Math.hypot(city.x-industry.x,city.y-industry.y);if(d<12)workers=Math.max(workers,clamp(city.population/900)*(1-d/14));}
  const definition=INDUSTRIES[kind];
  for(const other of game.industries){
    if(other===industry||Math.hypot(other.x-industry.x,other.y-industry.y)>8)continue;
    const neighbor=INDUSTRIES[other.kind];
    if(Object.keys(definition.inputs).some(c=>neighbor.outputs[c])||Object.keys(definition.outputs).some(c=>neighbor.inputs[c]))partners++;
  }
  let resource=1,climate=.94+weather.growth*.06;
  if(kind==='logging-camp'){
    resource=clamp(.25+e.forest/24,.25,1.25);climate=.72+weather.growth*.28;
    (e.forest>=10?positive:negative).push(e.forest>=10?'Nearby forest':'Sparse forest');
  }else if(kind==='farm'){
    resource=clamp(.52+e.moisture*.8-e.pollution*.35,.25,1.25);climate=weather.growth;
    (e.moisture>.45?positive:negative).push(e.moisture>.45?'Moist ground':'Dry ground');
  }else if(kind==='fishery'){
    resource=clamp(.32+e.water/20-e.pollution*.4,.25,1.2);climate=1-weather.cold*.25;
    (e.water>8?positive:negative).push(e.water>8?'Fishing waters':'Limited water');
  }else if(/mine|quarry/.test(kind)){
    resource=clamp(.55+e.rocks/35,.55,1.2);climate=1-weather.cold*.12-weather.wetness*.06;
    if(e.rocks>9)positive.push('Rich geology');
  }else if(kind==='sand-pit'){
    const tile=game.tiles[industry.y*game.width+industry.x];resource=tile.terrain==='sand'?1.15:.6;
    climate=1-weather.wetness*.16;if(resource>1)positive.push('Sandy ground');
  }else if(kind==='oil-well'){
    resource=.8+randomAt(game,0,`${industry.x},${industry.y}`,410)*.35;climate=1-weather.cold*.1;
  }
  const access=.7+e.access*.22+e.transport*.14;
  const support=.82+workers*.2+e.amenity*.1+Math.min(partners,3)*.04;
  const productivity=clamp(resource*access*support*climate,.12,1.5);
  if(e.access>.2)positive.push(e.railAccess?'Rail access':'Road access');else negative.push('Poor access');
  if(workers>.25)positive.push('Nearby workers');else if(Object.keys(definition.inputs).length)negative.push('Few workers');
  if(e.amenity>.18)positive.push('Local services');
  if(partners)positive.push('Nearby partners');
  if(e.transport>.1)positive.push('Transport service');
  if(e.pollution>.25&&['farm','fishery'].includes(kind))negative.push('Pollution');
  if(weather.cold>.65)negative.push('Cold weather');
  if(weather.heat>.7&&weather.wetness<.3)negative.push('Dry weather');
  return {score:clamp(productivity/1.25),productivity,positive,negative,environment:e};
}

export function initializeIndustry(game,industry){
  const day=Math.floor(game.day);
  industry.lastProductionDay??=game.day;
  industry.nextProductionDay??=day+1+Math.floor(randomAt(game,day,industry.id,421)*3);
  industry.nextReviewDay??=day+21+Math.floor(randomAt(game,day,industry.id,422)*25);
}

// Independent work cycles retain exact recipe ratios: randomness affects the
// batch size and interval, never which inputs are needed or cargo conservation.
export function stepIndustries(game,notify=()=>{}){
  const day=Math.floor(game.day);
  for(const industry of game.industries){
    initializeIndustry(game,industry);
    const conditions=industryConditions(game,industry),e=conditions.environment;
    industry.activity=Math.max(0,(industry.activity||0)*(1-(.006+randomAt(game,day,industry.id,430)*.008)/(1+e.transport*.3)));
    if(day>=industry.nextProductionDay){
      const elapsed=Math.max(0,day-industry.lastProductionDay),definition=INDUSTRIES[industry.kind];
      let batches=elapsed*industry.capacity*conditions.productivity*(.78+randomAt(game,day,industry.id,431)*.44);
      for(const [cargo,amount]of Object.entries(definition.inputs))batches=Math.min(batches,(industry.inventory[cargo]||0)/amount);
      for(const [cargo,amount]of Object.entries(definition.outputs))batches=Math.min(batches,Math.max(0,(MAX_INVENTORY*industry.capacity-(industry.inventory[cargo]||0))/amount));
      batches=Math.max(0,batches);let produced=0;
      for(const [cargo,amount]of Object.entries(definition.inputs))industry.inventory[cargo]=Math.max(0,(industry.inventory[cargo]||0)-amount*batches);
      for(const [cargo,amount]of Object.entries(definition.outputs)){const amountProduced=amount*batches;industry.inventory[cargo]=(industry.inventory[cargo]||0)+amountProduced;produced+=amountProduced;}
      industry.production=produced/Math.max(elapsed,1e-6);
      industry.totalProduced=(industry.totalProduced||0)+produced;
      industry.idleDays=batches<.1?(industry.idleDays||0)+elapsed:0;
      industry.lastProductionDay=day;
      const rhythm=randomAt(game,day,industry.id,432)+(1-e.access)*.18;
      industry.nextProductionDay=day+1+Math.min(2,Math.floor(rhythm*3));
    }
    if(day>=industry.nextReviewDay){
      const old=industry.capacity,activity=industry.activity||0;
      if(activity>25&&industry.totalProduced>0&&industry.idleDays<18){
        industry.capacity=clamp(old+(.035+randomAt(game,day,industry.id,433)*.09)*( .5+conditions.productivity)*Math.min(1.6,.7+activity/250),.5,3);
      }else if(industry.idleDays>18){
        const stock=Object.values(industry.inventory||{}).reduce((max,n)=>Math.max(max,n),0);
        // Full stores hold capacity until the stock can fit: no cargo disappears
        // just because an asynchronous capacity review reduced warehouse space.
        const stockFloor=stock/MAX_INVENTORY;
        industry.capacity=clamp(Math.max(stockFloor,old-(.025+randomAt(game,day,industry.id,434)*.045)*(1.3-e.access*.3)),.5,3);
      }
      industry.nextReviewDay=day+21+Math.floor(randomAt(game,day,industry.id,435)*25);
      if(Math.floor(old*2)<Math.floor(industry.capacity*2))notify(game,`${industry.name} expanded to ${Math.round(industry.capacity*100)}% capacity.`,'success');
    }
  }
}
