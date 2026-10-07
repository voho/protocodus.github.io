import { registerAtlas, drawAtlas, atlasAvailable, worldArtRevision } from './atlas-runtime.js';
import { drawDirectionalVehicle, vehicleHeadingIndex, vehicleFrameAngle, VEHICLE_HEADINGS } from './vehicle-directions.js';
import { projectedGroundBasis } from './isometric.js';
import { createSpriteCache } from './sprite-cache.js';
import { drawRailSurface, drawRailPortrait } from './rail-surface-art.js';
import { drawRoadSurface, drawRoadPortrait } from './road-surface-art.js';
import { drawIsometricInfrastructure } from './isometric-infrastructure.js';

registerAtlas({id:'vehicles',path:'./assets/world/vehicles-regenerated-v3/atlas',maxCell:256,entries:['bus','truck','locomotive','coach','wagon','express-bus','ferry','cargo-ship','tanker'].map(id=>'vehicle:'+id)});
registerAtlas({id:'cargo',path:'./assets/world/cargo-regenerated-v3/atlas',entries:['coal','ore','timber','grain','crates','steel','barrels','glass','fish'].map(id=>'cargo:'+id)});
export const hasRasterTransport=kind=>atlasAvailable(kind);
export const hasRasterNetwork=kind=>['road','road-bridge','rail','rail-bridge'].includes(kind);
export const drawRasterInfrastructure=(c,kind,x,y,w,h,pixelScale=1)=>kind==='rail'||kind==='rail-bridge'?drawRailPortrait(c,kind,x,y,w,h):kind==='road'||kind==='road-bridge'?drawRoadPortrait(c,kind,x,y,w,h):drawIsometricInfrastructure(c,kind,x,y,w,h,pixelScale);
export function drawRasterZone(c,zone,x,y,size){
  const colors={residential:'#91a77a',commercial:'#769493',industrial:'#c2a269'};
  if(!colors[zone])return false;c.save();c.translate(x,y);c.scale(size/32,size/32);
  c.strokeStyle=colors[zone];c.lineWidth=1.4;
  // Corner survey marks leave the underlying climate texture completely clear.
  c.beginPath();for(const [u,v,sx,sy]of [[3,3,1,1],[29,3,-1,1],[29,29,-1,-1],[3,29,1,-1]]){c.moveTo(u+sx*5,v);c.lineTo(u,v);c.lineTo(u,v+sy*5);}c.stroke();c.restore();return true;
}

// Connected surfaces are authored in the terrain plane and projected exactly
// once by the renderer. All curves, bridges and junctions share the same scale.
export function drawRasterNetwork(c,kind,cx,cy,arms,pixelScale=1,detailLevel='town'){
  if(!arms.length)return false;
  // Network geometry and its material palette are independent of raster
  // availability, including prepared ground and bridge decks.
  if(kind==='rail'||kind==='rail-bridge')return drawRailSurface(c,cx,cy,arms,{detailLevel});
  if(kind==='road'||kind==='road-bridge')return drawRoadSurface(c,cx,cy,arms,{bridge:kind==='road-bridge',detailLevel:typeof detailLevel==='string'?detailLevel:detailLevel.detailLevel});
  return false;
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
  const scale=ship?1.7:1;c.save();c.scale(scale,scale);
  const material=timber?'timber':['oil','fuel','milk'].includes(cargo)?'barrels':cargo==='coal'?'coal':['iron','copper','stone','sand','cement'].includes(cargo)?'ore':cargo==='grain'?'grain':['steel','wire','machinery'].includes(cargo)?'steel':cargo==='glass'?'glass':cargo==='fish'?'fish':'crates';
  if(drawAtlas(c,'cargo:'+material,-5.5,-2.7,3.5+count*1.5,5,{pixelScale:pixelScale*scale})){c.restore();return;}
  // Fresh recovery artwork is authored in the same deck plane as the PNGs.
  // The caller supplies projection once; these marks never turn a second time.
  const palette={coal:'#48534e',ore:'#a68f70',grain:'#d0b57b',steel:'#81968e',glass:'#8eb3ab',fish:'#b4c5b8',barrels:'#909b83',crates:'#b6956b'};
  const oval=(x,y,rx,ry,color)=>{c.fillStyle=color;c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fill();};
  for(let n=0;n<count;n++){
    const x=-4.4+n*2.8,color=palette[material];
    if(timber){
      const y=-2.3+n*1.6;c.fillStyle='#66716080';c.fillRect(-4.8,y+.4,8.2,1.2);
      c.fillStyle='#9e805c';c.fillRect(-5,y,8,1.1);oval(3,y+.55,.45,.55,'#d4bc88');
      c.fillStyle='#c3a477';c.fillRect(-4.8,y,7.6,.28);
    }else if(bulk){
      oval(x+.25,.45,1.7,2.15,'#56625760');oval(x,0,1.6,2.1,color);
      oval(x-.35,-.55,.75,1.15,material==='coal'?'#627064':material==='grain'?'#e0c997':'#c0ab87');
    }else if(material==='barrels'){
      oval(x+.3,.3,1.12,2.15,'#465b5060');oval(x,0,1.1,2.1,color);
      c.strokeStyle='#c8c9aa';c.lineWidth=.35;c.beginPath();c.ellipse(x,0,.8,1.7,0,0,Math.PI*2);c.stroke();
      oval(x-.25,-.8,.22,.3,'#52665b');
    }else{
      c.fillStyle='#495e5260';c.fillRect(x-.85,-1.85,2.4,4.3);
      c.fillStyle=color;c.fillRect(x-1.1,-2.15,2.25,4.15);
      c.fillStyle='#e0d7b080';c.fillRect(x-.9,-1.95,1.85,.45);
      c.fillStyle='#637465';c.fillRect(x-.15,-2.15,.35,4.15);
    }
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
