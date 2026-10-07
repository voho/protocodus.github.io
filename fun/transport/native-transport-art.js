// Synchronous recovery art uses the same orthographic camera as the atlas.
// Heading changes the model in its ground plane; verticals and light never rotate.
const TAU=Math.PI*2;
const P={cream:'#e3d7b7',glass:'#587178',slate:'#697780',sage:'#84988a',brick:'#a76f51',burgundy:'#996b63',ochre:'#c2a269',wood:'#997a5b',ink:'#4b5954'};
const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
function tone(hex,t){return '#'+rgb(hex).map(v=>Math.round(Math.min(255,Math.max(0,v*t))).toString(16).padStart(2,'0')).join('');}
function polygon(c,points,color){c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fillStyle=color;c.fill();}
function model(c,heading,groundScale=1){
  const angle=Math.atan2(Math.sin(heading)*2,Math.cos(heading)),cs=Math.cos(angle),sn=Math.sin(angle);
  const project=(x,y,z=0)=>[2*groundScale*(cs*x-sn*y),groundScale*(sn*x+cs*y)-2*z];
  const light=(nx,ny)=>.78+.17*Math.max(-1,Math.min(1,-(cs*nx-sn*ny)*.7-(sn*nx+cs*ny)*.7));
  function block(x0,y0,x1,y1,z,h,color,roof=P.cream){
    const corners=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]],normals=[[0,-1],[1,0],[0,1],[-1,0]];
    for(let i=0;i<4;i++){const [nx,ny]=normals[i];if(sn*nx+cs*ny<-.0001)continue;const a=corners[i],b=corners[(i+1)%4];polygon(c,[project(...a,z),project(...b,z),project(...b,z+h),project(...a,z+h)],tone(color,light(nx,ny)));}
    polygon(c,corners.map(([x,y])=>project(x,y,z+h)),roof);
  }
  function shadow(points,height){polygon(c,points.map(([x,y])=>{const p=project(x,y);return[p[0]+height*.8,p[1]+height*.4];}),'#30413a38');}
  return {project,block,shadow,frontVisible:sn>0,backVisible:sn<0};
}

export function drawNativeVehicle(c,vehicle,route,{engine=true,heading=vehicle.angle||0}={}){
  const ship=route?.mode==='water',train=route?.mode==='rail',passengers=route?.cargo==='passengers',tanker=ship&&['oil','fuel'].includes(route?.cargo),express=(vehicle.level||1)>1;
  const {project,block,shadow,frontVisible,backVisible}=model(c,heading),fraction=Math.max(0,Math.min(1,(vehicle.load||0)/Math.max(1,vehicle.capacity||1)));
  c.save();
  if(ship){
    const hull=[[-9,-2.1],[-7,-2.5],[5.8,-2.5],[9.5,0],[5.8,2.5],[-7,2.5],[-9,2.1]];
    shadow(hull,2.5);polygon(c,hull.map(([x,y])=>project(x,y,-.5)),tone(tanker?P.slate:passengers?P.sage:P.burgundy,.72));
    polygon(c,hull.map(([x,y])=>project(x,y,.45)),tanker?P.slate:passengers?P.sage:P.burgundy);
    if(passengers){block(-6,-1.85,5.8,1.85,.45,1.9,P.cream,P.slate);block(-3.7,-1.3,3.4,1.3,2.35,1.2,P.cream,P.slate);block(-5,-.7,-3,.7,2.35,.5,P.ochre,P.ochre);}
    else {block(-8,-1.7,-4.8,1.7,.45,2.2,P.cream,P.slate);block(-4,-1.65,6,1.65,.45,.3,P.slate,tone(P.slate,.8));
      if(tanker)for(const x of [-2.7,.5,3.7])block(x,-1.25,x+2.2,1.25,.75,1,P.ochre,tone(P.ochre,1.12));
      else if(fraction)for(let i=0;i<Math.ceil(fraction*3);i++)block(-3+i*2.6,-1.1,-1+i*2.6,1.1,.8,.65,route.cargo==='coal'?P.ink:P.wood,route.cargo==='coal'?P.slate:P.ochre);
    }
  }else{
    const length=9,width=train?2.8:2.5,color=train?(engine?P.slate:passengers?P.ochre:P.slate):passengers?(express?P.burgundy:P.sage):P.brick;
    shadow([[-length/2,-width/2],[length/2,-width/2],[length/2,width/2],[-length/2,width/2]],2.5);
    block(-4.5,-width/2,4.5,width/2,.25,.55,train?P.burgundy:P.ink,P.ink);
    // Two axles/bogies are projected as upright wheels, including edge-on views.
    const wheels=[];for(const x of [-2.8,2.9])for(const y of [-width/2,width/2])wheels.push(project(x,y,.3));
    wheels.sort((a,b)=>a[1]-b[1]);for(const [x,y]of wheels){c.fillStyle='#34413d';c.beginPath();c.ellipse(x,y,.95,1.15,0,0,TAU);c.fill();}
    if(passengers||train&&engine){block(-4.4,-width/2,4.4,width/2,.8,1.95,color,P.cream);block(-3.7,-width/2-.01,3.7,width/2+.01,1.65,.8,P.glass,P.cream);if(train&&engine){block(-2.6,-.8,.5,.8,2.75,.35,P.slate,tone(P.slate,1.2));}}
    else {block(-4.3,-width/2,2,width/2,.8,.65,P.wood,tone(P.wood,.73));if(!train)block(2.2,-width/2,4.4,width/2,.8,1.8,color,P.cream);if(!train)block(3.85,-.9,4.42,.9,1.65,.7,P.glass,P.glass);if(fraction)for(let i=0;i<Math.ceil(fraction*3);i++)block(-3.9+i*1.65,-.9,-2.6+i*1.65,.9,1.4,.7,route.cargo==='coal'?P.ink:P.wood,route.cargo==='coal'?P.slate:P.ochre);}
    if((passengers||train&&engine)&&frontVisible)polygon(c,[[4.42,-.9,1.6],[4.42,.9,1.6],[4.42,.9,2.45],[4.42,-.9,2.45]].map(p=>project(...p)),P.glass);
    for(const y of [-.85,.85]){
      if(frontVisible){const p=project(4.46,y,1.08);c.fillStyle=P.cream;c.fillRect(p[0]-.35,p[1]-.25,.7,.5);}
      if(backVisible){const p=project(-4.46,y,1.05);c.fillStyle='#b47b65';c.fillRect(p[0]-.3,p[1]-.25,.6,.5);}
    }
  }
  c.restore();return true;
}

// The recovery pier is an open constructed L, never an opaque water/land card.
export function drawNativePort(c,{heading=0,detail='town'}={}){
  const {project,block,shadow}=model(c,heading);
  shadow([[-10,-7],[-6,-7],[-6,5],[8,5],[8,8],[-10,8]],1.2);
  block(-10,-7,-6,8,0,.7,'#a69a80','#c7bca5');block(-6,5,8,8,0,.7,'#a69a80','#c7bca5');
  block(-9,-5,-6.5,-1,.7,2,P.cream,P.slate);
  block(-8,1,-6,3,.7,.6,P.slate,P.slate);
  const a=project(-7,2,1),b=project(-7,2,6),d=project(-2,2,5.2),hook=project(-2,2,2);
  c.strokeStyle=P.ochre;c.lineWidth=detail==='region'?1.2:.9;c.beginPath();c.moveTo(...a);c.lineTo(...b);c.lineTo(...d);c.stroke();
  c.strokeStyle=P.ink;c.lineWidth=.5;c.beginPath();c.moveTo(...d);c.lineTo(...hook);c.stroke();
  for(const x of [-5,1,6])block(x,6,x+.6,6.6,.7,.45,P.ink,P.slate);
  return true;
}

export function drawNativeBusStop(c){
  const {project,block,shadow}=model(c,Math.atan2(1,2),Math.SQRT2);
  shadow([[-3.8,-1.8],[3.8,-1.8],[3.8,1.8],[-3.8,1.8]],2.8);
  block(-3.8,-1.8,3.8,1.8,0,.2,'#a69a80','#c7bca5');
  block(-3.2,-1.35,2.4,-1.15,.2,2.25,P.sage,P.cream);
  for(const x of [-3.2,2.4])block(x,-1.3,x+.18,1.15,.2,2.45,P.slate,P.slate);
  block(-3.5,-1.6,2.8,1.5,2.65,.23,P.slate,P.sage);
  block(-2.7,-.85,1.7,-.15,.2,.65,P.wood,P.ochre);
  block(3,-.15,3.2,.05,.2,3.3,P.slate,P.slate);
  const a=project(3,-.15,3.5);c.fillStyle=P.cream;c.fillRect(a[0]-1.3,a[1]-1.4,2.6,2.8);c.fillStyle=P.sage;c.fillRect(a[0]-.7,a[1]-.8,1.4,1.6);
  return true;
}

export function drawNativeRailStop(c){
  const {project,block,shadow}=model(c,Math.atan2(1,2),Math.SQRT2);
  shadow([[-7,-3],[7,-3],[7,2],[-7,2]],3.8);
  block(-7,-3,7,2,0,.35,'#aaa38f','#c9bea4');
  block(-6.5,-2.6,-1.2,1.4,.35,3,P.cream,P.sage);
  block(-6.8,-2.9,-.9,1.7,3.35,.3,P.slate,P.sage);
  for(const x of [0,5.5])block(x,-2.25,x+.2,1.1,.35,2.5,P.slate,P.slate);
  block(-.2,-2.55,6,1.5,2.85,.2,P.slate,P.sage);
  block(.5,-1.8,4.7,-1.1,.35,.7,P.wood,P.ochre);
  const windowFace=(x0,x1,z0,z1,color)=>polygon(c,[[x0,1.42,z0],[x1,1.42,z0],[x1,1.42,z1],[x0,1.42,z1]].map(p=>project(...p)),color);
  windowFace(-4.6,-3.55,.35,2.45,P.slate);windowFace(-6,-5.1,1.45,2.45,P.glass);windowFace(-2.9,-1.7,1.45,2.45,P.glass);
  return true;
}

export function drawNativePortal(c,{mode='road',heading=0}={}){
  const {project,block,shadow}=model(c,heading),angle=Math.atan2(Math.sin(heading)*2,Math.cos(heading)),visibleFront=Math.sin(angle)>=0;
  const outer=mode==='rail'?4:4.6,mouth=mode==='rail'?2.4:3.2;
  shadow([[-1.8,-outer],[1.8,-outer],[1.8,outer],[-1.8,outer]],4.6);
  block(-1.8,-outer,1.8,outer,0,4.4,'#a9ada1','#d1d0bb');
  // A recessed front face has broad jambs and a dark opening. Back views keep
  // the filled concrete shell, consistent with the separately authored PNGs.
  if(visibleFront){
    polygon(c,[[1.82,-mouth,0],[1.82,mouth,0],[1.82,mouth,2.6],[1.82,mouth*.72,3.4],[1.82,-mouth*.72,3.4],[1.82,-mouth,2.6]].map(p=>project(...p)),'#394b46');
    polygon(c,[[1.84,-mouth,0],[1.84,mouth,0],[1.84,mouth,.4],[1.84,-mouth,.4]].map(p=>project(...p)),mode==='rail'?'#9ca6a0':'#747e76');
  }
  return true;
}

export function drawStreetLamp(c,x,y){
  // A 5m post, broad opaque head and a compact southeast ground shadow.
  polygon(c,[[x-.5,y],[x+.5,y],[x+5,y+2.25],[x+4,y+2.25]],'#30413a30');
  c.fillStyle='#697780';c.fillRect(x-.4,y-10,.8,10);c.fillStyle='#b8c3b5';c.fillRect(x-.4,y-10,.3,10);
  polygon(c,[[x-1.5,y-10],[x+1,y-11.25],[x+3,y-10.25],[x+.5,y-9]],'#697780');
  polygon(c,[[x-1.5,y-10],[x+.5,y-9],[x+.5,y-8.3],[x-1.5,y-9.3]],'#e3d7b7');
}
export function drawStreetBin(c,x,y){
  polygon(c,[[x-1,y],[x+1.5,y],[x+3,y+.75],[x,y+1]],'#30413a30');
  polygon(c,[[x-1.2,y-2.7],[x,y-2.1],[x,y],[x-1.2,y-.6]],'#84988a');
  polygon(c,[[x,y-2.1],[x+1.2,y-2.7],[x+1.2,y-.6],[x,y]],'#697780');
  polygon(c,[[x-1.3,y-2.7],[x,y-3.35],[x+1.3,y-2.7],[x,y-2.05]],'#b4bfab');
}
