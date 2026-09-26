// Canvas path/paint subset used by Tyran's runtime. Preflight art remains native.
const TAU=Math.PI*2,EPS=1e-8,colors=new Map(),MAX_COLORS=128;
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
export function parseColor(value) {
  if(Array.isArray(value))return value;
  if(typeof value!=='string')return [0,0,0,1];
  const cached=colors.get(value);if(cached)return cached;
  let result;
  const s=value.trim().toLowerCase();
  if(s==='transparent')result=[0,0,0,0];
  else if(s==='white')result=[1,1,1,1];
  else if(s==='black')result=[0,0,0,1];
  else if(/^#[\da-f]{3,4}$/.test(s))result=[...s.slice(1)].map(v=>parseInt(v+v,16)/255);
  else if(/^#[\da-f]{6}([\da-f]{2})?$/.test(s))result=[1,3,5,7].filter(i=>i<s.length).map(i=>parseInt(s.slice(i,i+2),16)/255);
  else {
    const m=s.match(/^rgba?\((.+)\)$/);
    if(m){const parts=m[1].split(/[\s,/]+/).filter(Boolean);result=parts.slice(0,3).map(v=>clamp(parseFloat(v)/(v.endsWith('%')?100:255)));if(parts.length>3)result.push(clamp(parseFloat(parts[3])/(parts[3].endsWith('%')?100:1)));}
  }
  result ||= [0,0,0,1];if(result.length===3)result.push(1);
  if(colors.size>=MAX_COLORS)colors.delete(colors.keys().next().value);
  colors.set(value,result);return result;
}
const paint=value=>value?.gradient?value:{color:parseColor(value)};
const area=points=>{let sum=0,n=points.length;for(let i=0,j=n-2;i<n;j=i,i+=2)sum+=points[j]*points[i+1]-points[i]*points[j+1];return sum*.5;};
function point(points,x,y,m){points.push(m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]);}
function data(ctx){return ctx._geometry ||= {paths:[],pool:[],current:null,vertices:[],local:[],indices:[],outline:[],left:[],right:[],run:[],contours:[[],[],[],[]]};}
function newPath(ctx,x,y){const g=data(ctx),path=g.pool.pop()||{points:[],closed:false};path.points.length=0;path.closed=false;path.ellipse=null;path.points.push(x,y);g.paths.push(path);g.current=path;return path;}
function append(ctx,x,y){const g=data(ctx);if(!g.current)return newPath(ctx,x,y);materialize(g.current);const p=g.current.points,n=p.length;if(n<2||Math.abs(p[n-2]-x)>EPS||Math.abs(p[n-1]-y)>EPS)p.push(x,y);return g.current;}
const ellipseUnits=new Map();
function materialize(path){
 const e=path.ellipse;if(!e?.lazy)return;e.lazy=false;
 const key=`${e.count}:${e.start}:${e.delta}`;let unit=ellipseUnits.get(key);
 if(!unit){unit=[];for(let i=0;i<=e.count;i++){const a=e.start+e.delta*i/e.count;unit.push(Math.cos(a),Math.sin(a));}if(ellipseUnits.size>=32)ellipseUnits.delete(ellipseUnits.keys().next().value);ellipseUnits.set(key,unit);}
 const p=path.points;p.length=0;
 for(let i=0;i<unit.length;i+=2){const x=e.cx+e.ax*unit[i]+e.bx*unit[i+1],y=e.cy+e.ay*unit[i]+e.by*unit[i+1],n=p.length;if(n<2||Math.abs(p[n-2]-x)>EPS||Math.abs(p[n-1]-y)>EPS)p.push(x,y);}
}
function triangle(v,ax,ay,ac,bx,by,bc,cx,cy,cc){v.push(ax,ay,ac,bx,by,bc,cx,cy,cc);}
function quad(v,a,b,c,d,inner=1,outer=1){triangle(v,a[0],a[1],inner,b[0],b[1],inner,c[0],c[1],outer);triangle(v,c[0],c[1],outer,b[0],b[1],inner,d[0],d[1],outer);}
function clean(points){const n=points.length;return n>3&&Math.abs(points[0]-points[n-2])<EPS&&Math.abs(points[1]-points[n-1])<EPS?points.slice(0,-2):points;}
function convex(points,sign){const n=points.length;for(let i=0;i<n;i+=2){const j=(i+2)%n,k=(i+4)%n;if(((points[j]-points[i])*(points[k+1]-points[j+1])-(points[j+1]-points[i+1])*(points[k]-points[j]))*sign<-EPS)return false;}return true;}
function fillTriangles(v,p,coverage=1){
  const n=p.length/2;if(n<3)return;const sign=Math.sign(area(p));if(!sign)return;
  if(convex(p,sign)){for(let i=1;i<n-1;i++)triangle(v,p[0],p[1],coverage,p[i*2],p[i*2+1],coverage,p[(i+1)*2],p[(i+1)*2+1],coverage);return;}
  const ids=Array.from({length:n},(_,i)=>i);let budget=n*n;
  while(ids.length>2&&budget-->0){let found=false;for(let i=0;i<ids.length;i++){
    const ia=ids[(i+ids.length-1)%ids.length]*2,ib=ids[i]*2,ic=ids[(i+1)%ids.length]*2;
    const ax=p[ia],ay=p[ia+1],bx=p[ib],by=p[ib+1],cx=p[ic],cy=p[ic+1];
    if(((bx-ax)*(cy-by)-(by-ay)*(cx-bx))*sign<=EPS)continue;
    let inside=false;for(const id of ids){const k=id*2;if(k===ia||k===ib||k===ic)continue;const x=p[k],y=p[k+1];
      if(((bx-ax)*(y-ay)-(by-ay)*(x-ax))*sign>EPS&&((cx-bx)*(y-by)-(cy-by)*(x-bx))*sign>EPS&&((ax-cx)*(y-cy)-(ay-cy)*(x-cx))*sign>EPS){inside=true;break;}}
    if(inside)continue;triangle(v,ax,ay,coverage,bx,by,coverage,cx,cy,coverage);ids.splice(i,1);found=true;break;
  }if(!found)break;}
}
// Offset a contour in backing pixels. Fringes straddle the true edge, so the
// additional AA triangles do not systematically enlarge the visible geometry.
function offsetContour(p,distance){
  const n=p.length,sign=Math.sign(area(p))||1,out=[];
  for(let i=0;i<n;i+=2){const j=(i+n-2)%n,k=(i+2)%n;
    let px=p[i]-p[j],py=p[i+1]-p[j+1],nx=p[k]-p[i],ny=p[k+1]-p[i+1];
    const pl=Math.hypot(px,py)||1,nl=Math.hypot(nx,ny)||1;px/=pl;py/=pl;nx/=nl;ny/=nl;
    const a=sign*py,b=-sign*px,c=sign*ny,d=-sign*nx,denom=Math.max(.25,1+px*nx+py*ny);
    out.push(p[i]+(a+c)/denom*distance,p[i+1]+(b+d)/denom*distance);
  }return out;
}
// Both AA edges share the same contour normals. Preserve the original
// division-then-multiply arithmetic while evaluating those normals only once.
function offsetPair(p,firstDistance,secondDistance,first,second){
  const n=p.length,sign=Math.sign(area(p))||1;first.length=second.length=0;
  for(let i=0;i<n;i+=2){const j=(i+n-2)%n,k=(i+2)%n;
    let px=p[i]-p[j],py=p[i+1]-p[j+1],nx=p[k]-p[i],ny=p[k+1]-p[i+1];
    const pl=Math.hypot(px,py)||1,nl=Math.hypot(nx,ny)||1;px/=pl;py/=pl;nx/=nl;ny/=nl;
    const a=sign*py,b=-sign*px,c=sign*ny,d=-sign*nx,denom=Math.max(.25,1+px*nx+py*ny),ox=(a+c)/denom,oy=(b+d)/denom;
    first.push(p[i]+ox*firstDistance,p[i+1]+oy*firstDistance);
    second.push(p[i]+ox*secondDistance,p[i+1]+oy*secondDistance);
  }
}
function contourBand(v,inner,outer,ic=1,oc=0){for(let i=0,n=inner.length;i<n;i+=2){const j=(i+2)%n;triangle(v,inner[i],inner[i+1],ic,inner[j],inner[j+1],ic,outer[i],outer[i+1],oc);triangle(v,outer[i],outer[i+1],oc,inner[j],inner[j+1],ic,outer[j],outer[j+1],oc);}}
function coverageArea(v){let mass=0;for(let i=0;i<v.length;i+=9)mass+=Math.abs((v[i+3]-v[i])*(v[i+7]-v[i+1])-(v[i+4]-v[i+1])*(v[i+6]-v[i]))*(v[i+2]+v[i+5]+v[i+8])/6;return mass;}
function normalizeCoverage(v,target){const mass=coverageArea(v);if(mass>EPS){const scale=target/mass;for(let i=2;i<v.length;i+=3)v[i]=Math.min(1,v[i]*scale);}}
function emitFilled(ctx,points,style,thinWidth=null){
  const p=clean(points);if(p.length<6)return;const g=data(ctx),v=g.vertices;v.length=0;
  // For subpixel strokes the two edge fringes overlap. Their middle plateau
  // carries width coverage instead of crossing into an inverted opaque core.
  const thin=thinWidth>0&&thinWidth<1,coverage=thin?thinWidth:1;
  const [inner,outer]=g.contours;offsetPair(p,thin?.5-thinWidth:-.5,.5,inner,outer);
  fillTriangles(v,inner,coverage);contourBand(v,inner,outer,coverage);
  if(thin)normalizeCoverage(v,Math.abs(area(p)));
  ctx._emitTriangles(v,style);
}
// Exact circle/ellipse coverage in the few backing pixels touched by a tiny
// dot. Transform each pixel edge into unit-circle space, split at intersections,
// and integrate its triangle or sector area. No raster canvas or pixel reads.
function circleEdgeArea(ax,ay,bx,by){
  const dx=bx-ax,dy=by-ay,a=dx*dx+dy*dy,b=2*(ax*dx+ay*dy),c=ax*ax+ay*ay-1;
  const cuts=[0,1],disc=b*b-4*a*c;
  if(a>EPS&&disc>0){const root=Math.sqrt(disc),t0=(-b-root)/(2*a),t1=(-b+root)/(2*a);if(t0>0&&t0<1)cuts.push(t0);if(t1>0&&t1<1)cuts.push(t1);cuts.sort((x,y)=>x-y);}
  let result=0;
  for(let i=1;i<cuts.length;i++){const t0=cuts[i-1],t1=cuts[i],px=ax+dx*t0,py=ay+dy*t0,qx=ax+dx*t1,qy=ay+dy*t1,mx=(px+qx)*.5,my=(py+qy)*.5,cross=px*qy-py*qx;
    result+=(mx*mx+my*my<1-EPS?cross:Math.atan2(cross,px*qx+py*qy))*.5;
  }return result;
}
function emitTinyEllipse(ctx,e,style){
  const {cx,cy,ax,ay,bx,by}=e,rx=Math.hypot(ax,bx),ry=Math.hypot(ay,by),det=ax*by-ay*bx;
  if(rx>.65||ry>.65||Math.abs(det)<EPS)return false;
  const v=data(ctx).vertices;v.length=0;
  for(let y=Math.floor(cy-ry);y<Math.ceil(cy+ry);y++)for(let x=Math.floor(cx-rx);x<Math.ceil(cx+rx);x++){
    const points=[];for(const [px,py]of [[x,y],[x+1,y],[x+1,y+1],[x,y+1]]){const dx=px-cx,dy=py-cy;points.push((by*dx-bx*dy)/det,(-ay*dx+ax*dy)/det);}
    let mass=0;for(let i=0;i<8;i+=2){const j=(i+2)%8;mass+=circleEdgeArea(points[i],points[i+1],points[j],points[j+1]);}
    const alpha=clamp(Math.abs(mass*det));if(alpha<EPS)continue;
    triangle(v,x,y,alpha,x+1,y,alpha,x,y+1,alpha);triangle(v,x,y+1,alpha,x+1,y,alpha,x+1,y+1,alpha);
  }
  ctx._emitTriangles(v,style);return true;
}
function emitShadow(ctx,points,source){
  const s=ctx._state,color=parseColor(s.shadowColor||'transparent');if(!color[3])return;
  const p=clean(points);if(p.length<6)return;
  const dx=s.shadowOffsetX||0,dy=s.shadowOffsetY||0,shifted=p.map((n,i)=>n+(i%2?dy:dx));
  const rgba=[...color];rgba[3]*=source.color?.[3]??1;
  if(!(s.shadowBlur>0)){emitFilled(ctx,shifted,{color:rgba});return;}
  // The only live blurred shadow is a small warning chevron. A Gaussian edge
  // profile gives its soft halo directly as geometry; no scratch canvas or
  // texture builds occur in a frame. Interior is covered by the source fill.
  const sigma=s.shadowBlur*.5,steps=[0,.5,1,1.5,2,2.5,3],alpha=[.5,.30854,.15866,.06681,.02275,.00621,0];
  const v=data(ctx).vertices;v.length=0;fillTriangles(v,shifted,.5);let previous=shifted;
  for(let i=1;i<steps.length;i++){const next=offsetContour(shifted,steps[i]*sigma);contourBand(v,previous,next,alpha[i-1],alpha[i]);previous=next;}
  ctx._emitTriangles(v,{color:rgba});
}
function toLocal(points,m,out){out.length=0;const det=m[0]*m[3]-m[1]*m[2];if(Math.abs(det)<EPS)return out;
  for(let i=0;i<points.length;i+=2){const x=points[i]-m[4],y=points[i+1]-m[5];out.push((m[3]*x-m[2]*y)/det,(-m[1]*x+m[0]*y)/det);}return out;
}
function transformPoints(points,m){const out=[];for(let i=0;i<points.length;i+=2)point(out,points[i],points[i+1],m);return out;}
function minimumScale(m){const trace=m[0]*m[0]+m[1]*m[1]+m[2]*m[2]+m[3]*m[3],det=m[0]*m[3]-m[1]*m[2];return Math.sqrt(Math.max(0,(trace-Math.sqrt(Math.max(0,trace*trace-4*det*det)))*.5));}
function arcPoints(out,x,y,r,start,delta,scale,includeFirst=true){
  const count=Math.max(2,Math.min(128,Math.ceil(Math.abs(delta)*Math.sqrt(Math.max(1,r*scale)/.6))));
  for(let i=includeFirst?0:1;i<=count;i++){const a=start+delta*i/count;out.push(x+Math.cos(a)*r,y+Math.sin(a)*r);}
}
function strokeSides(p,closed,width,s,scale){
  const n=p.length/2,left=[],right=[],half=width/2;
  for(let i=0;i<n;i++){
    const j=i===0?(closed?n-1:0):i-1,k=i===n-1?(closed?0:n-1):i+1,x=p[i*2],y=p[i*2+1];
    let px=x-p[j*2],py=y-p[j*2+1],nx=p[k*2]-x,ny=p[k*2+1]-y;
    if(i===0&&!closed){px=nx;py=ny;}if(i===n-1&&!closed){nx=px;ny=py;}
    const pl=Math.hypot(px,py)||1,nl=Math.hypot(nx,ny)||1;px/=pl;py/=pl;nx/=nl;ny/=nl;
    const cross=px*ny-py*nx,dot=clamp(px*nx+py*ny,-1,1),denom=Math.max(.001,1+dot);
    for(const side of [1,-1]){const out=side===1?left:right;
      const outer=cross*side<0,join=closed?'miter':s.lineJoin||'miter';
      if(outer&&join==='round'&&Math.abs(cross)>EPS){arcPoints(out,x,y,half,Math.atan2(px*side,-py*side),Math.atan2(cross,dot),scale);continue;}
      const mx=(-py-ny)*side/denom,my=(px+nx)*side/denom;
      if(outer&&(join==='bevel'||Math.hypot(mx,my)>(s.miterLimit||10))){out.push(x-py*side*half,y+px*side*half,x-ny*side*half,y+nx*side*half);}
      else out.push(x+mx*half,y+my*half);
    }
  }return {left,right};
}
function emitStroke(ctx,points,closed,style){
  const s=ctx._state,m=s.matrix,g=data(ctx),p=clean(points);if(p.length<4||!(s.lineWidth>0))return;
  const scale=Math.max(Math.hypot(m[0],m[1]),Math.hypot(m[2],m[3]));
  const {left,right}=strokeSides(p,closed,s.lineWidth,s,scale),half=s.lineWidth/2,n=p.length;
  if(closed&&left.length===right.length){
    const a=transformPoints(left,m),b=transformPoints(right,m),v=g.vertices;v.length=0;
    const orientation=Math.sign(area(p))||1,leftDirection=-orientation,rightDirection=orientation;
    const [ai,ao,bi,bo]=g.contours;
    offsetPair(a,-.5*leftDirection,.5*leftDirection,ai,ao);
    offsetPair(b,-.5*rightDirection,.5*rightDirection,bi,bo);
    if(s.lineWidth*minimumScale(m)>=1){
      for(let i=0;i<a.length;i+=2){const j=(i+2)%a.length;triangle(v,ai[i],ai[i+1],1,bi[i],bi[i+1],1,ai[j],ai[j+1],1);triangle(v,ai[j],ai[j+1],1,bi[i],bi[i+1],1,bi[j],bi[j+1],1);}
      contourBand(v,ai,ao);contourBand(v,bi,bo);ctx._emitTriangles(v,style);return;
    }
    const coverages=[];let thin=false;
    for(let i=0;i<a.length;i+=2){
      const j=(i+2)%a.length,k=(i+a.length-2)%a.length,tx=(a[j]+b[j]-a[k]-b[k])*.5,ty=(a[j+1]+b[j+1]-a[k+1]-b[k+1])*.5;
      const length=Math.hypot(tx,ty),width=length>EPS?Math.abs((b[i]-a[i])*ty-(b[i+1]-a[i+1])*tx)/length:Math.hypot(b[i]-a[i],b[i+1]-a[i+1]);
      const coverage=Math.min(1,width);coverages.push(coverage);
      if(width<1){thin=true;const factor=2*width-1;ai[i]=a[i]+(ai[i]-a[i])*factor;ai[i+1]=a[i+1]+(ai[i+1]-a[i+1])*factor;bi[i]=b[i]+(bi[i]-b[i])*factor;bi[i+1]=b[i+1]+(bi[i+1]-b[i+1])*factor;}
    }
    for(let i=0;i<a.length;i+=2){const j=(i+2)%a.length,c=coverages[i/2],d=coverages[j/2];triangle(v,ai[i],ai[i+1],c,bi[i],bi[i+1],c,ai[j],ai[j+1],d);triangle(v,ai[j],ai[j+1],d,bi[i],bi[i+1],c,bi[j],bi[j+1],d);
      for(const [inner,outer]of [[ai,ao],[bi,bo]]){triangle(v,inner[i],inner[i+1],c,inner[j],inner[j+1],d,outer[i],outer[i+1],0);triangle(v,outer[i],outer[i+1],0,inner[j],inner[j+1],d,outer[j],outer[j+1],0);}
    }
    if(thin)normalizeCoverage(v,Math.abs(Math.abs(area(b))-Math.abs(area(a))));
    ctx._emitTriangles(v,style);return;
  }
  if(s.lineCap==='square'){
    const dx=p[2]-p[0],dy=p[3]-p[1],len=Math.hypot(dx,dy)||1,ex=p[n-2]-p[n-4],ey=p[n-1]-p[n-3],elen=Math.hypot(ex,ey)||1;
    for(const side of [left,right]){side[0]-=dx/len*half;side[1]-=dy/len*half;side[side.length-2]+=ex/elen*half;side[side.length-1]+=ey/elen*half;}
  }
  const outline=[...left];
  if(s.lineCap==='round'){const dx=p[n-2]-p[n-4],dy=p[n-1]-p[n-3];arcPoints(outline,p[n-2],p[n-1],half,Math.atan2(dx,-dy),-Math.PI,scale,false);}
  for(let i=right.length-2;i>=0;i-=2)outline.push(right[i],right[i+1]);
  if(s.lineCap==='round'){const dx=p[2]-p[0],dy=p[3]-p[1];arcPoints(outline,p[0],p[1],half,Math.atan2(-dx,dy),-Math.PI,scale,false);}
  const transformed=transformPoints(outline,m);emitShadow(ctx,transformed,style);
  let thinWidth=null;
  if(p.length===4){const dx=p[2]-p[0],dy=p[3]-p[1],physicalLength=Math.hypot(m[0]*dx+m[2]*dy,m[1]*dx+m[3]*dy);if(physicalLength>EPS)thinWidth=s.lineWidth*Math.abs(m[0]*m[3]-m[1]*m[2])*Math.hypot(dx,dy)/physicalLength;}
  else thinWidth=s.lineWidth*minimumScale(m);
  emitFilled(ctx,transformed,style,thinWidth);
}
function dashedStroke(ctx,p,closed,style){
  const s=ctx._state,pattern=s.dash||[],period=pattern.reduce((a,b)=>a+b,0);
  if(!pattern.length||period<=EPS){emitStroke(ctx,p,closed,style);return;}
  const dash=pattern.length%2?[...pattern,...pattern]:pattern,total=pattern.length%2?period*2:period;
  let index=0,phase=((s.lineDashOffset||0)%total+total)%total;
  while(phase>=dash[index]&&index<dash.length-1){phase-=dash[index];index++;}
  let remaining=dash[index]-phase;const run=data(ctx).run;run.length=0;
  const count=p.length/2,segments=closed?count:count-1;
  for(let i=0;i<segments;i++){
    const j=(i+1)%count,x=p[i*2],y=p[i*2+1],dx=p[j*2]-x,dy=p[j*2+1]-y,length=Math.hypot(dx,dy);if(length<EPS)continue;
    let at=0;while(at<length-EPS){if(remaining<=EPS){if(index%2===0&&run.length>3){emitStroke(ctx,run,false,style);run.length=0;}index=(index+1)%dash.length;remaining=dash[index];continue;}
      const next=Math.min(length,at+remaining);if(index%2===0){if(!run.length)run.push(x+dx*at/length,y+dy*at/length);run.push(x+dx*next/length,y+dy*next/length);}
      remaining-=next-at;at=next;
    }
  }
  if(run.length>3)emitStroke(ctx,run,false,style);
}
export function installGeometry(GPUCanvas2D){
  const proto=GPUCanvas2D.prototype;
  proto.beginPath=function(){const g=data(this);for(const p of g.paths)if(g.pool.length<128)g.pool.push(p);g.paths.length=0;g.current=null;};
  proto.moveTo=function(x,y){if(!Number.isFinite(x+y))return;const m=this._state.matrix;newPath(this,m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]);};
  proto.lineTo=function(x,y){if(!Number.isFinite(x+y))return;const m=this._state.matrix;append(this,m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]).ellipse=null;};
  proto.closePath=function(){const p=data(this).current;if(p)p.closed=true;};
  proto.rect=function(x,y,w,h){this.moveTo(x,y);this.lineTo(x+w,y);this.lineTo(x+w,y+h);this.lineTo(x,y+h);this.closePath();};
  proto.fillRect=function(x,y,w,h){
    if(![x,y,w,h].every(Number.isFinite)||!w||!h)return;
    const s=this._state,m=s.matrix,style=paint(s.fillStyle),p=[];
    point(p,x,y,m);point(p,x+w,y,m);point(p,x+w,y+h,m);point(p,x,y+h,m);
    emitShadow(this,p,style);
    if(Math.abs(m[1])+Math.abs(m[2])>EPS){emitFilled(this,p,style);return;}
    const left=Math.min(p[0],p[4]),right=Math.max(p[0],p[4]),top=Math.min(p[1],p[5]),bottom=Math.max(p[1],p[5]);
    const width=right-left,height=bottom-top,xs=width<1?[left-.5,right-.5,left+.5,right+.5]:[left-.5,left+.5,right-.5,right+.5];
    const ys=height<1?[top-.5,bottom-.5,top+.5,bottom+.5]:[top-.5,top+.5,bottom-.5,bottom+.5];
    const xc=[0,Math.min(1,width),Math.min(1,width),0],yc=[0,Math.min(1,height),Math.min(1,height),0],v=data(this).vertices;v.length=0;
    for(let row=0;row<3;row++)for(let col=0;col<3;col++){
      const a=xc[col]*yc[row],b=xc[col+1]*yc[row],c=xc[col]*yc[row+1],d=xc[col+1]*yc[row+1];
      triangle(v,xs[col],ys[row],a,xs[col+1],ys[row],b,xs[col],ys[row+1],c);
      triangle(v,xs[col],ys[row+1],c,xs[col+1],ys[row],b,xs[col+1],ys[row+1],d);
    }
    this._emitTriangles(v,style);
  };
  proto.arc=function(x,y,r,start,end,ccw=false){this.ellipse(x,y,r,r,0,start,end,ccw);};
  proto.ellipse=function(x,y,rx,ry,rotation,start,end,ccw=false){
    if(![x,y,rx,ry,rotation,start,end].every(Number.isFinite))return;if(rx<0||ry<0)throw new RangeError('Ellipse radius must be nonnegative');
    let delta=end-start;if(!ccw&&delta>=TAU)delta=TAU;else if(ccw&&-delta>=TAU)delta=-TAU;else{delta%=TAU;if(!ccw&&delta<0)delta+=TAU;if(ccw&&delta>0)delta-=TAU;}
    const m=this._state.matrix,cr=Math.cos(rotation),sr=Math.sin(rotation),ax=(m[0]*cr+m[2]*sr)*rx,ay=(m[1]*cr+m[3]*sr)*rx,bx=(-m[0]*sr+m[2]*cr)*ry,by=(-m[1]*sr+m[3]*cr)*ry;
    const cx=m[0]*x+m[2]*y+m[4],cy=m[1]*x+m[3]*y+m[5],radius=Math.max(Math.hypot(ax,ay),Math.hypot(bx,by));
    const count=Math.max(2,Math.min(512,Math.ceil(Math.abs(delta)*Math.sqrt(Math.max(1,radius)/.6))));
    const g=data(this),wasEmpty=!g.current||!g.current.points.length;
    if(wasEmpty&&Math.abs(delta)>=TAU-EPS){
      const cos=Math.cos(start),sin=Math.sin(start),path=newPath(this,cx+ax*cos+bx*sin,cy+ay*cos+by*sin);
      path.closed=true;path.ellipse={cx,cy,ax,ay,bx,by,start,delta,count,lazy:true};return;
    }
    for(let i=0;i<=count;i++){const angle=start+delta*i/count,cos=Math.cos(angle),sin=Math.sin(angle);append(this,cx+ax*cos+bx*sin,cy+ay*cos+by*sin);}
    const current=data(this).current;current.ellipse=null;
    if(wasEmpty&&Math.abs(delta)>=TAU-EPS){current.closed=true;current.ellipse={cx,cy,ax,ay,bx,by};}
  };
  proto.fill=function(){const g=data(this),style=paint(this._state.fillStyle);for(const path of g.paths){
    if(path.ellipse&&!parseColor(this._state.shadowColor)[3]&&this._emitEllipse(path.ellipse,style))continue;
    materialize(path);emitShadow(this,path.points,style);if(!path.ellipse||!emitTinyEllipse(this,path.ellipse,style))emitFilled(this,path.points,style);
  }};
  proto.stroke=function(){const g=data(this),style=paint(this._state.strokeStyle);for(const path of g.paths){
    if(path.ellipse&&!this._state.dash.length&&!parseColor(this._state.shadowColor)[3]&&this._state.lineWidth>0&&this._emitEllipse(path.ellipse,style,this._state.lineWidth))continue;
    materialize(path);const p=toLocal(path.points,this._state.matrix,g.local);dashedStroke(this,p,path.closed,style);
  }};
  proto.createLinearGradient=function(x0,y0,x1,y1){
    if(![x0,y0,x1,y1].every(Number.isFinite))throw new TypeError('Gradient coordinates must be finite');
    const a=this._point(x0,y0),b=this._point(x1,y1),gradient={x0:a[0],y0:a[1],x1:b[0],y1:b[1],stops:[]};
    return {gradient,addColorStop(offset,color){if(offset<0||offset>1||!Number.isFinite(offset))throw new RangeError('Gradient stop must lie between zero and one');gradient.stops.push({offset,color:parseColor(color)});gradient.stops.sort((a,b)=>a.offset-b.offset);}};
  };
}
