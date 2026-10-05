// Ground-plane shadows share the tree layout and a fixed northwest light. A grove's
// shadows are one silhouette with a short soft rim, laid down once at its opacity,
// so they read as firm shapes and overlaps never darken into forest carpets.
const TAU=Math.PI*2,ANGLE=Math.atan2(.48,1);
const COLORS={taiga:'30,44,34',tundra:'52,62,62',desert:'78,60,38'};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function treeShadowGeometry(tree,biome='taiga',{opacity=1,contact=true}={}){
  const size=clamp(Number(tree.size)||12,4,100),bare=tree.bare||/bare|deadwood/.test(tree.species||'');
  const broad=/oak|birch|aspen|acacia|tamarisk|willow/.test(tree.species||''),palm=/palm/.test(tree.species||'');
  // Long enough to reach past the crown, so the shadow shows beside the tree and not only under it.
  const length=size*(bare?.5:palm?.7:.68),width=size*(bare?.05:broad?.2:palm?.16:.13);
  const alpha=(biome==='tundra'?.28:biome==='desert'?.32:.36)*opacity*(bare?.58:1),seed=(tree.seed>>>0)%997;
  const lobes=[];
  for(let n=0;n<(bare?2:3);n++){
    const along=length*(.32+n*.21),side=((seed*(n+3)%19)/18-.5)*width*.7;
    lobes.push({x:tree.x+along-side*.48,y:tree.y+along*.48+side,rx:length*(bare?.36:.43),ry:width*(.82+(seed+n*7)%5*.065),angle:ANGLE,alpha});
  }
  const base=contact?{x:tree.x+.25,y:tree.y+.2,rx:size*(bare?.105:.14),ry:Math.max(.6,size*.05),angle:0,alpha:(biome==='tundra'?.32:.4)*opacity}:null;
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

// An ellipse filled solid to 80% of its radius, then fading: firm, but never a stair-stepped edge.
function stamp(context,p,color,alpha){
  context.save();context.translate(p.x,p.y);context.rotate(p.angle);context.scale(p.rx,p.ry);
  const gradient=context.createRadialGradient(0,0,0,0,0,1);
  gradient.addColorStop(0,`rgba(${color},${alpha})`);gradient.addColorStop(.8,`rgba(${color},${alpha})`);gradient.addColorStop(1,`rgba(${color},0)`);
  context.fillStyle=gradient;context.beginPath();context.arc(0,0,1,0,TAU);context.fill();context.restore();
}
export function drawTreeShadows(context,shadows){
  if(!shadows.length)return;
  const lobes=shadows.flatMap(shadow=>shadow.lobes),strongest=Math.max(...lobes.map(p=>p.alpha)),color=shadows[0].color;
  if(lobes.length&&strongest>0){
    // The silhouette goes on a canvas of its own at full strength (lighter lobes stay lighter), then onto the stamp once.
    const {width,height}=context.canvas,layer=typeof OffscreenCanvas==='function'?new OffscreenCanvas(width,height):Object.assign(document.createElement('canvas'),{width,height}),c=layer.getContext('2d');
    c.setTransform(context.getTransform());
    for(const p of lobes)stamp(c,p,color,p.alpha/strongest);
    context.save();context.setTransform(1,0,0,1,0,0);context.globalAlpha=strongest;context.drawImage(layer,0,0);context.restore();
  }
  for(const shadow of shadows)if(shadow.contact)stamp(context,shadow.contact,shadow.color,shadow.contact.alpha);
}
