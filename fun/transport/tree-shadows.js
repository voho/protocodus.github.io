// Ground-plane shadows share the tree layout and a fixed northwest light.
// Soft gradient stamps avoid hard discs at Region zoom and dark forest carpets.
const TAU=Math.PI*2,ANGLE=Math.atan2(.48,1);
const COLORS={taiga:'45,58,40',tundra:'64,73,68',desert:'91,75,49'};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function treeShadowGeometry(tree,biome='taiga',{opacity=1,contact=true}={}){
  const size=clamp(Number(tree.size)||12,4,100),bare=tree.bare||/bare|deadwood/.test(tree.species||'');
  const broad=/oak|birch|aspen|acacia|tamarisk|willow/.test(tree.species||''),palm=/palm/.test(tree.species||'');
  const length=size*(bare?.4:palm?.57:.48),width=size*(bare?.045:broad?.18:palm?.15:.115);
  const alpha=(biome==='tundra'?.07:biome==='desert'?.08:.09)*opacity*(bare?.58:1),seed=(tree.seed>>>0)%997;
  const lobes=[];
  for(let n=0;n<(bare?2:3);n++){
    const along=length*(.32+n*.21),side=((seed*(n+3)%19)/18-.5)*width*.7;
    lobes.push({x:tree.x+along-side*.48,y:tree.y+along*.48+side,rx:length*(bare?.36:.43),ry:width*(.82+(seed+n*7)%5*.065),angle:ANGLE,alpha:alpha*(n===1?1:.72)});
  }
  const base=contact?{x:tree.x+.25,y:tree.y+.2,rx:size*(bare?.105:.14),ry:Math.max(.6,size*.05),angle:0,alpha:(biome==='tundra'?.13:.16)*opacity}:null;
  return {color:COLORS[biome]||COLORS.taiga,lobes,contact:base};
}

export function treeShadowBounds(shadows){
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  for(const shadow of shadows)for(const p of [...shadow.lobes,...(shadow.contact?[shadow.contact]:[])]){
    const rx=Math.hypot(p.rx*Math.cos(p.angle),p.ry*Math.sin(p.angle)),ry=Math.hypot(p.rx*Math.sin(p.angle),p.ry*Math.cos(p.angle));
    left=Math.min(left,p.x-rx);right=Math.max(right,p.x+rx);top=Math.min(top,p.y-ry);bottom=Math.max(bottom,p.y+ry);
  }
  return shadows.length?{left:Math.floor(left)-1,top:Math.floor(top)-1,right:Math.ceil(right)+1,bottom:Math.ceil(bottom)+1}:{left:0,top:0,right:0,bottom:0};
}

export function drawTreeShadows(context,shadows){
  for(const shadow of shadows)for(const p of [...shadow.lobes,...(shadow.contact?[shadow.contact]:[])]){
    context.save();context.translate(p.x,p.y);context.rotate(p.angle);context.scale(p.rx,p.ry);
    const gradient=context.createRadialGradient(0,0,0,0,0,1);
    gradient.addColorStop(0,`rgba(${shadow.color},${p.alpha})`);
    gradient.addColorStop(.48,`rgba(${shadow.color},${p.alpha*.66})`);
    gradient.addColorStop(1,`rgba(${shadow.color},0)`);
    context.fillStyle=gradient;context.beginPath();context.arc(0,0,1,0,TAU);context.fill();context.restore();
  }
}
