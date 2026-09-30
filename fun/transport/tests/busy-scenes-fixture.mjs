// Deterministic rendering stress cases; no app saves or production state changed.
// This function is evaluated in the page, so imports resolve next to renderer.js.
export async function installBusyScenes() {
  const [{createGame},{createRenderer},{preloadWorldArt},{preloadHouses},{BUILDINGS},{INDUSTRIES},{weatherPresentation}]=await Promise.all([
    import('./model.js'),import('./renderer.js'),import('./atlas-runtime.js'),import('./raster-houses.js'),import('./buildings.js'),import('./data.js'),import('./weather-effects.js')]);
  await Promise.all([preloadWorldArt({biome:'taiga',waitMs:20000}),preloadHouses({biome:'taiga',waitMs:20000})]);
  const generated=createGame({biome:'taiga',size:'square512',seed:418}), canvas=document.querySelector('canvas');
  let bestForest={x:128,y:128,count:0},bestCity=generated.cities[0];
  for(let y=40;y<472;y+=12)for(let x=40;x<472;x+=12){let count=0;for(let dy=-12;dy<=12;dy+=2)for(let dx=-12;dx<=12;dx+=2)if(generated.tiles[(y+dy)*512+x+dx].terrain==='forest')count++;if(count>bestForest.count)bestForest={x,y,count};}
  for(const city of generated.cities)if((city.population||0)>(bestCity.population||0))bestCity=city;
  const kinds=Object.keys(BUILDINGS),industryKinds=Object.keys(INDUSTRIES).filter(k=>INDUSTRIES[k].biomes.includes('taiga'));
  const flat=(terrain='grass',variant=0)=>({terrain,elevation:4/7,detail:terrain==='forest'?['pine','mixed','birch'][variant%3]:'',variant});
  function makeScene(scene){
    if(scene.startsWith('generated-'))return {game:generated,point:scene==='generated-forest'?bestForest:bestCity};
    const game={...generated,width:256,height:256,tiles:Array.from({length:256*256},(_,i)=>flat(scene==='forest'?'forest':'grass',i%64)),cities:[],industries:[],stations:[],zones:[],routes:[],vehicles:[],revision:1,networkRevision:1};
    const at=(x,y)=>game.tiles[y*256+x];
    if(scene!=='forest'){
      for(let y=0;y<256;y++)for(let x=0;x<256;x++){if(y%4===0)at(x,y).road=true;if(x%12===0)at(x,y).rail=true;else if(x%4===0)at(x,y).road=true;}
      if(scene==='city'||scene==='mixed'){
        game.cities=[{id:1,name:'Metropolis',x:128,y:128,population:55000}];
        let index=0;
        for(let y=9;y<248;y+=4)for(let x=9;x<248;x+=4){
          const n=index++;if(n%23===0){const kind=industryKinds[n%industryKinds.length];game.industries.push({id:n+1,kind,name:INDUSTRIES[kind].name,x,y,footprint:INDUSTRIES[kind].footprint});continue;}
          const kind=kinds[n%kinds.length],span=BUILDINGS[kind].footprint;
          at(x,y).building={kind,footprint:span,level:1+n%3};
          for(let dy=0;dy<3;dy++)for(let dx=0;dx<3;dx++)if(dx>=span||dy>=span){if((n+dx+dy)%5===0){at(x+dx,y+dy).terrain='forest';at(x+dx,y+dy).detail='mixed';}else at(x+dx,y+dy).building={kind:kinds[(n+dx+dy)%6],footprint:1,level:1};}
        }
      }
      if(scene==='vehicles'||scene==='mixed'){
        const cargos=['passengers','coal','timber','food','steel','oil'];let id=0;
        for(let y=64;y<=192;y+=4){const route={id:id++,mode:'road',cargo:cargos[(y/4)%cargos.length],color:['#b87752','#6a9e75','#b49a56'][y%3],path:Array.from({length:160},(_,n)=>({x:48+n,y}))};game.routes.push(route);
          for(let x=70;x<=186;x+=1.35){const n=game.vehicles.length;game.vehicles.push({id:n+1,routeId:route.id,x,y,angle:0,direction:1,progress:x-48,capacity:40,load:n%3*20,level:1+n%4});}}
        for(let x=72;x<=192;x+=12){const route={id:id++,mode:'rail',cargo:x%24?'coal':'passengers',color:'#ba955f',path:Array.from({length:160},(_,n)=>({x,y:48+n}))};game.routes.push(route);
          for(let y=70;y<=186;y+=5){const n=game.vehicles.length;game.vehicles.push({id:n+1,routeId:route.id,x,y,angle:Math.PI/2,direction:1,progress:y-48,capacity:90,load:n%3*45,level:1+n%4});}}
      }
    }
    for(const v of game.vehicles){v.startX=v.x;v.startY=v.y;}
    return {game,point:{x:128,y:128}};
  }
  const scenes=new Map();let current;
  const renderer=createRenderer(canvas,generated,{layers:{names:true,industryIcons:true,routes:true,weather:false}});renderer.resize();
  function select(scene,zoom,condition){if(!scenes.has(scene))scenes.set(scene,makeScene(scene));current=scenes.get(scene);const{game,point}=current;for(const v of game.vehicles){if(!Object.hasOwn(v,'startX')){v.startX=v.x;v.startY=v.y;}v.x=v.startX;v.y=v.startY;}renderer.setGame(game);renderer.setZoom(zoom);renderer.focus(point.x,point.y);game.day=0;renderer.setLayers({weather:condition==='rain'});if(condition==='rain'){let best=0;for(let day=0;day<360;day++){const weather=weatherPresentation(game,point.x,point.y,day);if(weather.rain>best){best=weather.rain;game.day=day;}}}current.startDay=game.day;return{scene,zoom,condition,point,buildings:game.tiles.reduce((n,t)=>n+Boolean(t.building),0),vehicles:game.vehicles.length,industries:game.industries.length,day:game.day};}
  function advance(frame){const{game,startDay}=current;game.day=startDay+frame/600;for(const v of game.vehicles){if(v.angle===0)v.x+=.001;else v.y+=.001;}}
  function hash(){const readback=document.createElement('canvas');readback.width=canvas.width;readback.height=canvas.height;const context=readback.getContext('2d',{willReadFrequently:true});context.drawImage(canvas,0,0);const data=context.getImageData(0,0,canvas.width,canvas.height).data;let h=2166136261;for(let i=0;i<data.length;i++)h=Math.imul(h^data[i],16777619);return h>>>0;}
  window.busyQA={renderer,select,advance,hash,get game(){return current.game;},get point(){return current.point;}};
}
