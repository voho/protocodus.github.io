import { registerAtlas, drawAtlas, atlasAvailable, worldArtRevision } from './atlas-runtime.js';
import { drawDirectionalVehicle, vehicleHeadingIndex, vehicleFrameAngle, VEHICLE_HEADINGS } from './vehicle-directions.js';
import { projectedGroundBasis } from './isometric.js';
import { createSpriteCache } from './sprite-cache.js';

registerAtlas({id:'vehicles',path:'./assets/world/vehicles-dimetric-v2/atlas',entries:['bus','truck','locomotive','coach','wagon','express-bus','ferry','cargo-ship','tanker'].map(id=>'vehicle:'+id)});
registerAtlas({id:'infrastructure',path:'./assets/world/infrastructure/atlas',entries:['bus-stop','train-stop','port','road','rail','road-bridge','rail-bridge','road-tunnel','rail-tunnel'].map(id=>'infra:'+id)});
registerAtlas({id:'cargo',path:'./assets/world/cargo/atlas',entries:['coal','ore','timber','grain','crates','steel','barrels','glass','fish'].map(id=>'cargo:'+id)});
export const hasRasterTransport=kind=>atlasAvailable(kind);
export const drawRasterInfrastructure=(c,kind,x,y,w,h,pixelScale=1)=>drawAtlas(c,'infra:'+kind,x,y,w,h,{pixelScale});

// The authored network tiles run north/south. Compose their textured arms for
// bends and junctions too, retaining the renderer's connected bed beneath the
// transparent edges. Wedges meet at the tile center without painting a road
// into a direction that is not connected.
export function drawRasterNetwork(c,kind,cx,cy,arms,pixelScale=1){
  const bridge=kind.endsWith('-bridge'),width=bridge?32:kind==='rail'?22:44;
  const straight=arms.length<=2&&arms.every(([dx,dy])=>arms[0][0]===0?dx===0:dy===0);
  c.save();c.beginPath();c.rect(cx-16,cy-16,32,32);c.clip();c.translate(cx,cy);
  let painted=false;
  if(straight){
    if(arms[0][0]!==0)c.rotate(Math.PI/2);
    painted=drawRasterInfrastructure(c,kind,-width/2,-18,width,36,pixelScale);
  }else for(const [dx,dy]of arms){
    c.save();c.rotate(Math.atan2(dy,dx)+Math.PI/2);
    c.beginPath();c.moveTo(0,0);c.lineTo(-16,-16);c.lineTo(16,-16);c.closePath();c.clip();
    painted=drawRasterInfrastructure(c,kind,-width/2,-18,width,36,pixelScale)||painted;
    c.restore();
  }
  c.restore();return painted;
}

function upright(c,heading){
  c.rotate(-heading);
  // Inverse rotations can leave microscopic skew, selecting a different Canvas
  // resampling path at small sizes. Keep the fixed camera matrix exact.
  const m=c.getTransform(),clean=n=>Math.round(n*1e10)/1e10;
  c.setTransform(clean(m.a),clean(m.b),clean(m.c),clean(m.d),m.e,m.f);
}

function payload(c,cargo,fraction,ship=false,pixelScale=1){
  if(!fraction)return;
  const count=Math.min(3,Math.ceil(fraction*3)),timber=['timber','lumber'].includes(cargo),bulk=['coal','iron','copper','stone','sand','grain','cement'].includes(cargo);
  const colors={coal:'#424845',iron:'#b47857',copper:'#b27b4d',stone:'#aaa79b',sand:'#d8bc7f',grain:'#ddc177',steel:'#95abb0',glass:'#8bbbb7',food:'#86a25b',fish:'#81a8af',goods:'#aa8199',wire:'#bc8b5d',cement:'#c7c3ab'};
  const scale=ship?1.7:1;c.save();c.scale(scale,scale);
  const material=timber?'timber':['oil','fuel'].includes(cargo)?'barrels':cargo==='coal'?'coal':['iron','copper','stone','sand','cement'].includes(cargo)?'ore':cargo==='grain'?'grain':['steel','wire','machinery'].includes(cargo)?'steel':cargo==='glass'?'glass':cargo==='fish'?'fish':'crates';
  if(drawAtlas(c,'cargo:'+material,-5.5,-2.7,3.5+count*1.5,5,{pixelScale:pixelScale*scale})){c.restore();return;}
  for(let n=0;n<count;n++){
    const x=-5+n*2.4;c.fillStyle=colors[cargo]||'#b18f61';
    if(timber){c.fillStyle='#926e43';c.fillRect(-5,-2.8+n*1.7,7,1.3);c.fillStyle='#dfbd86';c.fillRect(1,-2.8+n*1.7,.8,1.3);}
    else if(bulk){c.beginPath();c.moveTo(x-1,2);c.lineTo(x-1.1,-1);c.lineTo(x+.8,-2.3);c.lineTo(x+2,1.4);c.closePath();c.fill();}
    else if(cargo==='oil'||cargo==='fuel'){c.fillStyle=cargo==='oil'?'#7e8988':'#c2b079';c.fillRect(x,-2,1.7,4);c.fillStyle='#d8d7b9';c.fillRect(x,-2,1.7,.7);}
    else{c.fillRect(x,-2.3,2,4.6);c.fillStyle='#eee0bb70';c.fillRect(x,-2.3,2,.7);c.fillStyle='#534e474a';c.fillRect(x+1.6,-1.6,.4,3.9);}
  }
  c.restore();
}
// Context is centered on the vehicle and rotated toward its travel direction.
export function drawRasterVehicle(c,vehicle,route,{engine=true,pixelScale=1,heading=vehicle.angle||0}={}){
  const passengers=route?.cargo==='passengers',train=route?.mode==='rail',ship=route?.mode==='water';
  const kind=ship?(passengers?'ferry':['oil','fuel'].includes(route.cargo)?'tanker':'cargo-ship'):train?(engine?'locomotive':passengers?'coach':'wagon'):passengers?((vehicle.level||1)>1?'express-bus':'bus'):'truck';
  const size=ship?43:train?20:20;
  c.save();upright(c,heading);
  const directional=drawDirectionalVehicle(c,kind,heading,size,pixelScale);
  const painted=directional||drawAtlas(c,'vehicle:'+kind,-size/2,-size/2,size,size,{pixelScale});
  c.restore();
  if(!painted)return false;
  c.save();
  {
    // Cargo sheets are overhead material patches. Project their bed plane once
    // rather than rotating them flat on screen; the body remains upright.
    upright(c,heading);c.translate(0,ship?-.65:-.7);
    const plane=projectedGroundBasis(directional?vehicleFrameAngle(heading):Math.atan(.5));
    c.transform(plane.a,plane.b,plane.c,plane.d,0,0);
    if(ship)c.translate(3.5,0);else if(!train)c.translate(-1.8,0);
  }
  const fraction=Math.max(0,Math.min(1,(vehicle.load||0)/Math.max(1,vehicle.capacity||1)));
  if(!passengers&&(!train||!engine)&&kind!=='tanker')payload(c,route?.cargo||'goods',fraction,ship,pixelScale);
  // Small company-color markings preserve route identity without recoloring art.
  if(route?.color){c.fillStyle=route.color;c.globalAlpha=.9;c.fillRect(ship?-13:-5,ship?4.3:2.5,ship?6:5,ship?1.1:.7);c.globalAlpha=1;}
  c.restore();return true;
}

// Prepare each visible heading/load/company combination at its final physical
// size. Runtime callers translate an upright context and copy native pixels;
// atlas scaling, cargo projection and marker painting happen only on a miss.
export function createVehicleSprites({pixelScale=1,cache:sharedCache=null}={}){
  const scale=Math.max(.25,Number(pixelScale)||1),cache=sharedCache||createSpriteCache({limit:32*1024*1024}),prefix=`vehicle:${scale}:`;
  let revision=worldArtRevision(),created=0,hits=0;
  cache.syncRevision(revision);
  return {
    draw(c,vehicle,route,{engine=true,heading=vehicle.angle||0}={}){
      const next=worldArtRevision();if(next!==revision){revision=next;cache.syncRevision(revision);}
      const passengers=route?.cargo==='passengers',train=route?.mode==='rail',ship=route?.mode==='water';
      const kind=ship?(passengers?'ferry':['oil','fuel'].includes(route.cargo)?'tanker':'cargo-ship'):train?(engine?'locomotive':passengers?'coach':'wagon'):passengers?((vehicle.level||1)>1?'express-bus':'bus'):'truck';
      const index=vehicleHeadingIndex(heading),angle=index*Math.PI/4;
      const carries=!passengers&&(!train||!engine)&&kind!=='tanker',fraction=Math.max(0,Math.min(1,(vehicle.load||0)/Math.max(1,vehicle.capacity||1))),band=carries&&fraction?Math.ceil(fraction*3):0;
      const key=`${prefix}${kind}:${index}:${band?route?.cargo||'goods':''}:${band}:${route?.color||''}`;
      let image=cache.get(key);
      if(image)hits++;
      else{
        const size=ship?64:24;image=document.createElement('canvas');image.width=image.height=Math.ceil(size*scale);
        const context=image.getContext('2d');context.scale(scale,scale);context.translate(size/2,size/2);context.rotate(angle);
        if(!drawRasterVehicle(context,vehicle,route,{engine,pixelScale:scale,heading:angle}))return false;
        // Also available to diagnostic image inspectors without rereading pixels.
        image.vehicleFrame={kind,heading:VEHICLE_HEADINGS[index],pixelScale:scale,size};
        cache.set(key,image);created++;
      }
      const size=image.vehicleFrame.size;c.drawImage(image,-size/2,-size/2,image.width/scale,image.height/scale);return true;
    },
    getStats:()=>({...cache.getStats(),pixelScale:scale,created,hits,shared:Boolean(sharedCache)}),
  };
}
