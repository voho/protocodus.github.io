// Deterministic fixtures shared by CPU benchmarks and simulation regression checks.
export function performanceScene(sim, name, count = 600) {
  const {createGame,UNITS,BUILDINGS,raceUnit,raceBuilding}=sim;
  const s=createGame(`performance-${name}`,'normal',{width:224,height:168,races:['organics','aiUnity'],aiTeams:[]});
  const unitTemplate=structuredClone(s.entities.find(e=>e.kind==='unit'));
  const buildingTemplate=structuredClone(s.entities.find(e=>e.kind==='building'));
  s.entities=s.entities.filter(e=>e.kind==='building');s.terrain.fill(0);s.minerals.fill(0);s.mineralTypes.fill(0);s.navVersion++;
  s.visible.forEach(v=>v.fill(1));s.explored.forEach(v=>v.fill(1));
  // Match actual expanded-base capacity, rather than exceeding one nexus's slots.
  for(let team=0;team<2;team++)for(let n=1;n<Math.ceil(count/2/200);n++){
    const type=raceBuilding(s,team,'core'),d=BUILDINGS[type];
    s.entities.push({...structuredClone(buildingTemplate),id:s.nextId++,team,type,x:8+team*112+n*10,y:154,
      size:d.size,hp:d.hp,maxHp:d.hp,queue:[],progress:1});
  }
  const addUnit=(team,role,x,y,order)=>{
    const type=raceUnit(s,team,role),d=UNITS[type];
    const u={...structuredClone(unitTemplate),id:s.nextId++,team,type,x,y,size:d.size,hp:d.hp,maxHp:d.hp,angle:team?Math.PI:0,
      path:[],order,cooldown:1+(s.nextId%17)*.13,kills:0,tech:[],targetId:null};
    if(role==='harvester')Object.assign(u,{cargo:0,cargoType:0,unload:0,unloadDepotId:null,harvestPhase:'gather'});
    s.entities.push(u);return u;
  };
  if(name==='harvesting'){
    // Ten independent depots, each with a busy mineral field and outbound/return traffic.
    for(let group=0;group<10;group++){
      const team=group%2,x=15+Math.floor(group/2)*40,y=team?100:30,type=raceBuilding(s,team,'refinery'),d=BUILDINGS[type];
      s.entities.push({...structuredClone(buildingTemplate),id:s.nextId++,team,type,x,y,size:d.size,hp:d.hp,maxHp:d.hp,queue:[],progress:1});
      for(let yy=y-3;yy<y+5;yy++)for(let xx=x+13;xx<x+16;xx++){s.minerals[yy*s.width+xx]=8000;s.mineralTypes[yy*s.width+xx]=group%3+1;}
      for(let i=group;i<count;i+=10){const n=Math.floor(i/10),u=addUnit(team,'harvester',x+5+(n%7)*1.05,y-4+Math.floor(n/7)*1.05,{type:'harvest',x:x+14,y:y+1});
        if(n%2)Object.assign(u,{cargo:200,cargoType:group%3+1,harvestPhase:'return'});
      }
    }
  }else{
    const roles=['rifle','rocket','scout','tank','artillery','striker'];
    for(let i=0;i<count;i++){
      const team=i%2,n=Math.floor(i/2),row=Math.floor(n/12),column=n%12,y=35+row*1.2;
      const x=name==='battle'?(team?84+column*1.1:76-column*1.1):(team?53:35)+column*1.1;
      addUnit(team,roles[i%roles.length],x,y,{type:name==='battle'?'attackMove':'move',x:name==='battle'?(team?70:90):170+column*.5,y});
    }
    if(name==='obstructed')for(let y=12;y<150;y++)if(y<73||y>87)s.terrain[y*s.width+110]=1;
  }
  return s;
}

export function simulationDigest(s) {
  return JSON.stringify({time:s.time,rng:s.rng,status:s.status,entities:s.entities,teams:s.teams,effects:s.effects,events:s.events,
    minerals:[...s.minerals],visible:s.visible.map(v=>[...v]),explored:s.explored.map(v=>[...v])});
}
