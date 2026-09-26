/* Batched WebGL2 flight renderer. Source artwork is prepared once with Canvas2D. */
import {installGeometry,parseColor} from './geometry.js';
const STRIDE=11, CAPACITY=49152, MAX_BYTES=256*1024*1024, MAX_TEXTURES=256, TEXTURE_UNITS=8;
const MAX_SOFT_LAYER_BYTES=32*1024*1024;
// A fixed guarded annulus keeps large, thin rings off their empty centers.
const ELLIPSE_SEGMENTS=16,ELLIPSE_OUTER_SCALE=1/Math.cos(Math.PI/ELLIPSE_SEGMENTS);
const ELLIPSE_POINTS=new Float64Array((ELLIPSE_SEGMENTS+1)*2);
for(let i=0;i<=ELLIPSE_SEGMENTS;i++){const a=i*Math.PI*2/ELLIPSE_SEGMENTS;ELLIPSE_POINTS[i*2]=Math.cos(a);ELLIPSE_POINTS[i*2+1]=Math.sin(a);}

const VERTEX=`#version 300 es
precision highp float;
layout(location=0) in vec2 aPosition;
layout(location=1) in vec2 aUV;
layout(location=2) in vec4 aColor;
layout(location=3) in float aMode;
layout(location=4) in vec2 aShape;
uniform vec2 uSize;
out vec2 vUV; out vec4 vColor; out vec2 vPosition; flat out int vMode; flat out vec2 vInner;
void main(){gl_Position=vec4(aPosition.x/uSize.x*2.-1.,1.-aPosition.y/uSize.y*2.,0.,1.);vUV=aUV;vColor=aColor;vPosition=aPosition;vMode=int(aMode+.5);vInner=aShape;}`;
const FRAGMENT=`#version 300 es
precision highp float;
uniform sampler2D uTextures[8];
uniform vec4 uGradient;
uniform vec4 uStopColors[4];
uniform float uStops[4];
uniform int uStopCount;
in vec2 vUV;in vec4 vColor;in vec2 vPosition;flat in int vMode; flat in vec2 vInner;
out vec4 outputColor;
// Constant sampler indices keep this legal on WebGL2/GLSL ES 3 drivers.
vec4 sampleImage(int slot){
 switch(slot){
  case 0:return texture(uTextures[0],vUV);
  case 1:return texture(uTextures[1],vUV);
  case 2:return texture(uTextures[2],vUV);
  case 3:return texture(uTextures[3],vUV);
  case 4:return texture(uTextures[4],vUV);
  case 5:return texture(uTextures[5],vUV);
  case 6:return texture(uTextures[6],vUV);
  case 7:return texture(uTextures[7],vUV);
 }
 return vec4(0.);
}
// Signed integral of unit-circle coverage from the origin to an axis-aligned
// corner. Four corners yield exact area within a backing pixel, including tiny
// circles and rings: the AA fringe does not inflate subpixel particles.
float circleIntegral(vec2 p){
 vec2 q=min(abs(p),vec2(1.));float a=q.x*q.y;
 if(dot(q,q)>1.){float cut=sqrt(max(0.,1.-q.y*q.y));a=.5*(q.y*cut+q.x*sqrt(max(0.,1.-q.x*q.x))+asin(q.x)-asin(cut));}
 return sign(p.x)*sign(p.y)*a;
}
float circleArea(vec2 lo,vec2 hi){return circleIntegral(hi)-circleIntegral(vec2(lo.x,hi.y))-circleIntegral(vec2(hi.x,lo.y))+circleIntegral(lo);}
// Exact area of a pixel box cut by the local ellipse tangent. Expressing the
// two projected half-widths directly avoids cancellation of four large circle
// integrals. The middle is linear and either tail is one small quadratic.
float tangentCoverage(vec2 p,vec2 h){
 vec2 widths=abs(p)*h;float major=max(widths.x,widths.y),minor=min(widths.x,widths.y);
 float threshold=.5*(1.-dot(p,p)),total=major+minor;
 if(threshold<=-total)return 0.;if(threshold>=total)return 1.;
 if(abs(threshold)<=major-minor||minor<.000000000001)return clamp(.5+threshold/(2.*major),0.,1.);
 float tail=total-abs(threshold),corner=tail*tail/(8.*major*minor);
 return clamp(threshold<0.?corner:1.-corner,0.,1.);
}
float ellipseCoverage(vec2 p,vec2 h){
 vec2 near=max(abs(p)-h,vec2(0.)),far=abs(p)+h;
 if(dot(near,near)>=1.)return 0.;if(dot(far,far)<=1.)return 1.;
 // At least 32 backing pixels on both axes: curvature within one pixel is
 // small, while the tangent formula remains stable up to the 2048px guard.
 if(max(h.x,h.y)<=.015625&&min(h.x,h.y)/max(h.x,h.y)>=.7)return tangentCoverage(p,h);
 return clamp(circleArea(p-h,p+h)/max(4.*h.x*h.y,.000000001),0.,1.);
}
void main(){
 if(vMode==11||vMode==12){
   vec2 h=.5*fwidth(vUV),near=max(abs(vUV)-h,vec2(0.)),far=abs(vUV)+h;
   vec2 inner=vMode==12?vInner:vec2(0.);
   bool hasInner=all(greaterThan(inner,vec2(0.)));
   if(dot(near,near)>=1.){outputColor=vec4(0.);return;}
   if(hasInner){vec2 inside=far/inner;if(dot(inside,inside)<=1.){outputColor=vec4(0.);return;}}
   if(max(h.x,h.y)>.015625||min(h.x,h.y)/max(h.x,h.y)<.7){
    float a=dot(far,far)<=1.?4.*h.x*h.y:circleArea(vUV-h,vUV+h);
    if(hasInner){vec2 outside=near/inner;if(dot(outside,outside)<1.)a-=circleArea((vUV-h)/inner,(vUV+h)/inner)*inner.x*inner.y;}
    outputColor=vColor*clamp(a/max(4.*h.x*h.y,.000000001),0.,1.);return;
   }
   float a=ellipseCoverage(vUV,h);
   if(hasInner)a-=ellipseCoverage(vUV/inner,h/inner);
   outputColor=vColor*clamp(a,0.,1.);return;
 }
 if(vMode==0){outputColor=sampleImage(0)*vColor;return;}
 if(vMode>=3&&vMode<=10){outputColor=sampleImage(vMode-3)*vColor;return;}
 if(vMode==1){outputColor=vColor;return;}
 // Modes 11 and 12 are reserved for analytic ellipse fill/stroke quads.
 if(vMode!=2){outputColor=vec4(0.);return;}
 vec2 delta=uGradient.zw-uGradient.xy;
 float t=clamp(dot(vPosition-uGradient.xy,delta)/max(dot(delta,delta),.000001),0.,1.);
 vec4 color=uStopColors[0];
 for(int i=1;i<4;i++){if(i>=uStopCount)break;if(t>=uStops[i])color=uStopColors[i];else {float f=clamp((t-uStops[i-1])/max(uStops[i]-uStops[i-1],.000001),0.,1.);color=mix(uStopColors[i-1],uStopColors[i],f);break;}}
 outputColor=color*vColor.a;
}`;
// Keep image fragments out of the more expensive analytic coverage program.
// Uses the same vertex layout/VAO and sampler-slot modes as the geometry program.
const IMAGE_FRAGMENT=`#version 300 es
precision highp float;
uniform sampler2D uTextures[8];
in vec2 vUV;in vec4 vColor;flat in int vMode;
out vec4 outputColor;
vec4 sampleImage(int slot){
 switch(slot){
  case 0:return texture(uTextures[0],vUV);
  case 1:return texture(uTextures[1],vUV);
  case 2:return texture(uTextures[2],vUV);
  case 3:return texture(uTextures[3],vUV);
  case 4:return texture(uTextures[4],vUV);
  case 5:return texture(uTextures[5],vUV);
  case 6:return texture(uTextures[6],vUV);
  case 7:return texture(uTextures[7],vUV);
 }
 return vec4(0.);
}
void main(){outputColor=sampleImage(vMode==0?0:vMode-3)*vColor;}
`;
function state(){return {matrix:[1,0,0,1,0,0],globalAlpha:1,composite:'source-over',fillStyle:'#000000',strokeStyle:'#000000',lineWidth:1,lineCap:'butt',lineJoin:'miter',miterLimit:10,dash:[],lineDashOffset:0,shadowColor:'rgba(0,0,0,0)',shadowBlur:0,shadowOffsetX:0,shadowOffsetY:0,imageSmoothingEnabled:true,imageSmoothingQuality:'low'};}
const DEFAULT_STATE=state(), MAX_POOLED_STATES=64;
function copyState(target,source){
 // Styles (including gradient objects) retain identity; mutable arrays belong
 // to one saved state and are copied into its reusable storage.
 for(const key in source)if(key!=='matrix'&&key!=='dash')target[key]=source[key];
 const matrix=target.matrix,from=source.matrix;for(let i=0;i<6;i++)matrix[i]=from[i];
 const dash=target.dash;dash.length=source.dash.length;for(let i=0;i<dash.length;i++)dash[i]=source.dash[i];
 return target;
}
const finiteTransform=(a,b,c,d,e,f)=>Number.isFinite(a)&&Number.isFinite(b)&&Number.isFinite(c)&&Number.isFinite(d)&&Number.isFinite(e)&&Number.isFinite(f);
const finite=(...v)=>v.every(Number.isFinite);
function sizeOf(source){return [source.naturalWidth||source.videoWidth||source.width||0,source.naturalHeight||source.videoHeight||source.height||0];}
function rectangle(bounds,w,h){if(!bounds)return null;const x=Math.max(0,Math.floor(bounds.x)),y=Math.max(0,Math.floor(bounds.y));return {x,y,width:Math.max(0,Math.min(w,Math.ceil(bounds.x+bounds.width))-x),height:Math.max(0,Math.min(h,Math.ceil(bounds.y+bounds.height))-y)};}
export class GPUCanvas2D {
 constructor(width,height,displayCanvas=null){
  this.direct=!!displayCanvas;this.canvas=displayCanvas||(typeof OffscreenCanvas==='function'?new OffscreenCanvas(Math.max(1,width),Math.max(1,height)):Object.assign(document.createElement('canvas'),{width:Math.max(1,width),height:Math.max(1,height)}));
  this.gl=this.canvas.getContext('webgl2',{alpha:false,antialias:false,depth:false,stencil:false,premultipliedAlpha:true,preserveDrawingBuffer:false,powerPreference:'high-performance'});
  if(!this.gl)throw Error('WebGL2 unavailable');
  this._vertices=new Float32Array(CAPACITY*STRIDE);this._count=0;this._batchStart=0;this._batchTextures=[];this._commands=[];this._commandCount=0;this._gradientSnapshots=new WeakMap();this._cache=new Map();this._textureUse=0;this._dirty=new WeakMap();this._lost=false;this._failure=null;this._restoreEpoch=0;
  this._softLayer=null;this._softLayerScale=0;this._softDrawing=false;this._softState=state();this._softStack=[];
  this._disposed=false;this._contextAvailable=true;this._recoveryActive=false;this._recoverySources=new Map();this._recoveryPending=new Map();this._recoveryBytes=0;this._recoveryPrewarm=null;this._recoveryPromise=null;
  this._errors=[];this._metrics={frames:0,drawCalls:0,frameDrawCalls:0,vertices:0,uploads:0,partialUploads:0,uploadedBytes:0,textureBytes:0,evictions:0,restores:0,vertexUploads:0,vertexUploadBytes:0,frameSegments:0,vertexOrphans:0,vertexOrphanBytes:0,frameVertexOrphans:0};
  try{this._initialize();this.reset();}catch(error){this.fail(error);throw error;}
  this.canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();this._loseContext();});
  this.canvas.addEventListener('webglcontextrestored',()=>{if(this._disposed||this._failure)return;this._contextAvailable=true;return this._recoveryPromise=this._restore();});
 }
 get usable(){return !this._lost&&!this._failure;}
 get contextLost(){return this._lost;}
 get failure(){return this._failure;}
 get stats(){this.checkErrors();return {...this._metrics,errors:this._errors.slice(),textureCount:this._cache.size,maxTextureBytes:MAX_BYTES,maxTextures:MAX_TEXTURES,textureUnits:TEXTURE_UNITS,maxTextureSize:this.maxTextureSize,softLayerBytes:this._softLayer?.bytes||0,maxSoftLayerBytes:MAX_SOFT_LAYER_BYTES,recoverySources:this._recoverySources.size,recoveryPending:this._recoveryPending.size,recoverySourceBytes:this._recoveryBytes,usable:this.usable};}
 checkErrors(){if(this._lost)return this._errors.slice();let error;for(let i=0;i<8&&(error=this.gl.getError())!==this.gl.NO_ERROR;i++)this._errors.push(error);return this._errors.slice();}
 _initialize(){
  const gl=this.gl,compile=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const message=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw Error(message);}return shader;};
  const vertex=compile(gl.VERTEX_SHADER,VERTEX);
  const link=source=>{const fragment=compile(gl.FRAGMENT_SHADER,source),program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);gl.deleteShader(fragment);if(!gl.getProgramParameter(program,gl.LINK_STATUS)){const message=gl.getProgramInfoLog(program);gl.deleteProgram(program);throw Error(message);}return program;};
  let program,imageProgram;
  try{program=link(FRAGMENT);imageProgram=link(IMAGE_FRAGMENT);}catch(error){if(program)gl.deleteProgram(program);throw error;}finally{gl.deleteShader(vertex);}
  this.program=program;this.imageProgram=imageProgram;this._activeProgram=null;this._useProgram(program);this._buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this._buffer);gl.bufferData(gl.ARRAY_BUFFER,this._vertices.byteLength,gl.DYNAMIC_DRAW);
  this._vao=gl.createVertexArray();gl.bindVertexArray(this._vao);
  for(const [index,count,offset]of [[0,2,0],[1,2,2],[2,4,4],[3,1,8],[4,2,9]]){gl.enableVertexAttribArray(index);gl.vertexAttribPointer(index,count,gl.FLOAT,false,STRIDE*4,offset*4);}
  this._uniforms=Object.fromEntries(['uSize','uTextures[0]','uGradient','uStopColors[0]','uStops[0]','uStopCount'].map(name=>[name,gl.getUniformLocation(program,name)]));
  this._imageUniforms=Object.fromEntries(['uSize','uTextures[0]'].map(name=>[name,gl.getUniformLocation(imageProgram,name)]));
  if(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)<TEXTURE_UNITS)throw Error('Eight fragment texture units are required');
  const slots=new Int32Array([0,1,2,3,4,5,6,7]);
  this._useProgram(imageProgram);gl.uniform1iv(this._imageUniforms['uTextures[0]'],slots);
  this._useProgram(program);gl.uniform1iv(this._uniforms['uTextures[0]'],slots);gl.activeTexture(gl.TEXTURE0);this._activeTextureUnit=0;this._boundTextures=new Array(TEXTURE_UNITS).fill(null);gl.enable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.DITHER);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
  this.maxTextureSize=gl.getParameter(gl.MAX_TEXTURE_SIZE);this._batchTexture=null;this._batchKind=null;this._batchComposite=null;this._batchGradient=null;this._batchUsesGradient=false;this._actualTexture=null;this._appliedBlend=null;this._blendEnabled=true;this._appliedGradient=null;this._count=0;this._batchStart=0;this._commandCount=0;this._commands.length=0;this._batchTextures.length=0;this._gpuVertexCursor=0;this._vertexBufferNeedsOrphan=false;
  // Valid sampler binding even when a batch contains only solid triangles.
  this._white=gl.createTexture();this._bindTextureUnit(0,this._white);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]));gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  for(let unit=1;unit<TEXTURE_UNITS;unit++)this._bindTextureUnit(unit,this._white);this._actualTexture=this._white;this._stopColors=new Float32Array(16);this._stops=new Float32Array(4);gl.viewport(0,0,this.canvas.width,this.canvas.height);this._setProgramSizes(this.canvas.width,this.canvas.height);
 }
 _useProgram(program){if(this._activeProgram!==program){this.gl.useProgram(program);this._activeProgram=program;}}
 _setProgramSizes(width,height){
  // Uniform values belong to each program. Initialize/update both, preserving
  // whichever program was active so command replay has an accurate cache.
  const previous=this._activeProgram||this.program;
  this._useProgram(this.program);this.gl.uniform2f(this._uniforms.uSize,width,height);
  this._useProgram(this.imageProgram);this.gl.uniform2f(this._imageUniforms.uSize,width,height);
  this._useProgram(previous);
 }
 setRecoveryPrewarm(callback){this._recoveryPrewarm=typeof callback==='function'?callback:null;}
 fail(error){
  this._failure ||= String(error);this._restoreEpoch++;this._recoveryActive=false;this._count=this._batchStart=this._commandCount=0;this._batchTextures.length=0;
  this._recoverySources.clear();this._recoveryPending.clear();this._recoveryBytes=0;this._releaseResources();
 }
 _releaseResources(){
  const gl=this.gl,valid=this._contextAvailable&&!gl.isContextLost();
  this._releaseSoftLayer();
  if(valid){
   for(const entry of this._cache.values())gl.deleteTexture(entry.texture);
   if(this._white)gl.deleteTexture(this._white);if(this._buffer)gl.deleteBuffer(this._buffer);if(this._vao)gl.deleteVertexArray(this._vao);
   if(this.program)gl.deleteProgram(this.program);if(this.imageProgram)gl.deleteProgram(this.imageProgram);
  }
  this._cache.clear();this._metrics.textureBytes=0;this._commands.length=0;this._batchTextures.length=0;
  this._white=this._buffer=this._vao=this.program=this.imageProgram=this._activeProgram=null;
  this._boundTextures?.fill(null);this._batchTexture=this._actualTexture=null;this._softDrawing=false;this._gpuVertexCursor=0;this._vertexBufferNeedsOrphan=true;
 }
 _queueRecoverySource(source){
  if(!source||this._disposed||this._failure)return;
  const [width,height]=sizeOf(source),bytes=width*height*4;if(!width||!height)return;
  if(bytes>MAX_BYTES){this.fail(`Recovery source ${width}x${height} exceeds the texture budget`);return;}
  const version=source._tyranTextureVersion||0,revision=this._dirty.get(source)?.revision||0,previous=this._recoverySources.get(source);
  const record={source,width,height,bytes,version,revision};
  if(previous){this._recoveryBytes-=previous.bytes;this._recoverySources.delete(source);}
  this._recoverySources.set(source,record);this._recoveryBytes+=bytes;
  const entry=this._cache.get(source);
  if(entry&&entry.width===width&&entry.height===height&&entry.version===version&&entry.revision===revision)this._recoveryPending.delete(source);else this._recoveryPending.set(source,record);
  while(this._recoverySources.size>MAX_TEXTURES||this._recoveryBytes>MAX_BYTES){const oldest=this._recoverySources.keys().next().value;this._recoveryBytes-=this._recoverySources.get(oldest).bytes;this._recoverySources.delete(oldest);this._recoveryPending.delete(oldest);}
 }
 _loseContext(){
  if(this._disposed||!this._contextAvailable)return;
  this._lost=true;this._contextAvailable=false;this._recoveryActive=false;this._restoreEpoch++;this._count=this._batchStart=this._commandCount=0;this._batchTextures.length=0;this._softLayer=null;this._softDrawing=false;this._gpuVertexCursor=0;this._vertexBufferNeedsOrphan=true;
  for(const [source]of [...this._cache].sort((a,b)=>a[1].lastUse-b[1].lastUse))this._queueRecoverySource(source);
 }
 _pruneRecoveryCache(){
  for(const [source,entry]of this._cache)if(!this._recoverySources.has(source)){this._forgetTexture(entry.texture);this.gl.deleteTexture(entry.texture);this._cache.delete(source);this._metrics.textureBytes-=entry.bytes;this._metrics.evictions++;}
 }
 async _restore(reinitialize=true){
  if(this._disposed||this._failure||!this._contextAvailable)return false;
  const epoch=++this._restoreEpoch;this._lost=true;this._recoveryActive=true;
  try{
   if(reinitialize){this._cache.clear();this._metrics.textureBytes=0;this._initialize();this._metrics.restores++;}
   else {this.gl.bindFramebuffer(this.gl.FRAMEBUFFER,null);this.gl.viewport(0,0,this.canvas.width,this.canvas.height);this._setProgramSizes(this.canvas.width,this.canvas.height);}
   for(const record of this._recoverySources.values())this._recoveryPending.set(record.source,record);
   this._recoveryPrewarm?.();let refreshed=false;
   while(epoch===this._restoreEpoch&&!this._disposed&&!this._failure){
    this._pruneRecoveryCache();const started=performance.now();
    while(this._recoveryPending.size&&performance.now()-started<3){
     const [source,record]=this._recoveryPending.entries().next().value;this._recoveryPending.delete(source);
     if(this._recoverySources.get(source)!==record)continue;
     this._texture(source,true);if(epoch!==this._restoreEpoch||this._failure)return false;
     // Capture dimensions/version again after uploading; changes announced in
     // native fallback frames replace pending records before the next slice.
     if(this._recoverySources.has(source))this._queueRecoverySource(source);
    }
    if(this._recoveryPending.size){await new Promise(resolve=>setTimeout(resolve,0));continue;}
    if(!refreshed){refreshed=true;this._recoveryPrewarm?.();continue;}
    if(epoch!==this._restoreEpoch)return false;
    this._lost=false;this._recoveryActive=false;this._recoverySources.clear();this._recoveryPending.clear();this._recoveryBytes=0;
    if(this._softLayerScale)this.prepareSoftLayer(this._softLayerScale);return this.usable;
   }
  }catch(error){if(epoch===this._restoreEpoch&&!this._disposed)this.fail(error);}
  return false;
 }
 reset(){
  this._gpuVertexCursor=0;this._vertexBufferNeedsOrphan=true;
  this._count=0;this._batchStart=0;this._commandCount=0;this._batchKind=null;this._batchTextures.length=0;this._batchUsesGradient=false;
  const pool=this._statePool||(this._statePool=[]),stack=this._stack||(this._stack=[]);
  while(stack.length&&pool.length<MAX_POOLED_STATES)pool.push(stack.pop());stack.length=0;
  // Reset releases retained style references but keeps the reusable arrays.
  for(const saved of pool)copyState(saved,DEFAULT_STATE);
  this._state=copyState(this._state||state(),DEFAULT_STATE);this.beginPath?.();
  if(this._softDrawing&&!this._lost){this.gl.bindFramebuffer(this.gl.FRAMEBUFFER,null);this.gl.viewport(0,0,this.canvas.width,this.canvas.height);}this._softDrawing=false;
 }
 resize(width,height){width=Math.max(1,Math.round(width));height=Math.max(1,Math.round(height));const changed=this.canvas.width!==width||this.canvas.height!==height,recovering=this._recoveryActive;this.reset();if(changed){this._restoreEpoch++;this.canvas.width=width;this.canvas.height=height;}if(this.usable){this.gl.viewport(0,0,width,height);this._setProgramSizes(width,height);if(this._softLayerScale)this.prepareSoftLayer(this._softLayerScale);}else if(changed&&recovering&&this._contextAvailable&&!this._disposed)this._recoveryPromise=this._restore(false);return this;}
 beginFrame(){if(!this.usable)return false;this._gpuVertexCursor=0;this._vertexBufferNeedsOrphan=true;this._count=0;this._batchStart=0;this._commandCount=0;this._batchTextures.length=0;this._batchUsesGradient=false;this._metrics.frames++;this._metrics.frameDrawCalls=0;this._metrics.frameSegments=0;this._metrics.frameVertexOrphans=0;this._batchKind=null;const gl=this.gl;gl.bindVertexArray(this._vao);gl.bindBuffer(gl.ARRAY_BUFFER,this._buffer);gl.viewport(0,0,this.canvas.width,this.canvas.height);this._setProgramSizes(this.canvas.width,this.canvas.height);gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);return true;}
 endFrame(){this.flush();if(this.gl.isContextLost())this._loseContext();return this.usable;}
 present(display){if(!this.usable||!this.endFrame())return false;if(this.direct)return true;display.save();display.setTransform(1,0,0,1,0,0);display.globalAlpha=1;display.globalCompositeOperation='copy';display.drawImage(this.canvas,0,0);display.restore();return true;}
 _releaseSoftLayer(){
  const layer=this._softLayer;this._softLayer=null;if(!layer||!this._contextAvailable||this.gl.isContextLost())return;
  this.gl.bindFramebuffer(this.gl.FRAMEBUFFER,null);this._forgetTexture(layer.texture);this.gl.deleteFramebuffer(layer.framebuffer);this.gl.deleteTexture(layer.texture);
 }
 prepareSoftLayer(scale=.5){
  if(this._softDrawing)return false;
  if(!Number.isFinite(scale)||scale<=0){this._softLayerScale=0;this.flush();this._releaseSoftLayer();return false;}
  this._softLayerScale=Math.min(1,scale);if(!this.usable)return false;
  const sourceWidth=this.canvas.width,sourceHeight=this.canvas.height;
  const boundedScale=Math.min(this._softLayerScale,this.maxTextureSize/sourceWidth,this.maxTextureSize/sourceHeight,Math.sqrt(MAX_SOFT_LAYER_BYTES/(sourceWidth*sourceHeight*4)));
  const width=Math.max(1,Math.floor(sourceWidth*boundedScale)),height=Math.max(1,Math.floor(sourceHeight*boundedScale));
  if(this._softLayer?.width===width&&this._softLayer.height===height&&this._softLayer.sourceWidth===sourceWidth&&this._softLayer.sourceHeight===sourceHeight)return true;
  this.flush();this._releaseSoftLayer();const gl=this.gl,texture=gl.createTexture(),framebuffer=gl.createFramebuffer();
  if(!texture||!framebuffer){if(texture)gl.deleteTexture(texture);if(framebuffer)gl.deleteFramebuffer(framebuffer);return false;}
  this._bindTextureUnit(0,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  // Even inactive sampler uniforms must not retain the current render target.
  this._forgetTexture(texture);gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
  const complete=gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE;gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  if(!complete){gl.deleteFramebuffer(framebuffer);gl.deleteTexture(texture);return false;}
  this._softLayer={texture,framebuffer,width,height,sourceWidth,sourceHeight,bytes:width*height*4};return true;
 }
 _finishSoftState(caller,stack){
  // The dedicated working state never enters the general save/restore pool.
  // Any unbalanced saves in a failed callback release only borrowed states.
  const pool=this._statePool,working=this._softState;
  if(this._state!==working&&pool.length<MAX_POOLED_STATES)pool.push(this._state);
  while(this._softStack.length){const saved=this._softStack.pop();if(saved!==working&&pool.length<MAX_POOLED_STATES)pool.push(saved);}
  this._state=caller;this._stack=stack;
 }
 drawSoftLayer(callback){
  if(typeof callback!=='function')throw new TypeError('A soft-layer drawing callback is required');
  // Nested groups stay within the already bound layer rather than sampling it.
  if(this._softDrawing){this.save();try{return callback(this);}finally{this.restore();}}
  const caller=this._state,stack=this._stack,work=copyState(this._softState,this._state);
  const composite=caller.composite,layer=this._softLayer,prepared=this.usable&&layer&&(composite==='source-over'||composite==='lighter')&&layer.sourceWidth===this.canvas.width&&layer.sourceHeight===this.canvas.height;
  if(prepared)this.flush();this._state=work;this._softStack.length=0;this._stack=this._softStack;
  if(!prepared){try{return callback(this);}finally{this._finishSoftState(caller,stack);}}
  const gl=this.gl;this._forgetTexture(layer.texture);gl.bindFramebuffer(gl.FRAMEBUFFER,layer.framebuffer);gl.viewport(0,0,layer.width,layer.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);this._softDrawing=true;
  let result;
  try{result=callback(this);}finally{
   try{this.flush();}finally{gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clearColor(0,0,0,1);this._softDrawing=false;this._finishSoftState(caller,stack);}
  }
  if(!this.usable)return result;
  // The callback already included its alpha. Composite its premultiplied RGBA
  // result once at alpha one with the captured caller blend. Strictly additive
  // groups accumulate with lighter both in the layer and onto the destination.
  // Framebuffer textures have bottom-up UVs.
  this._state=work;work.composite=composite;work.globalAlpha=1;
  try{
   const mode=3+this._batch(layer.texture),w=this.canvas.width,h=this.canvas.height;
   this._vertex(0,0,0,1,1,1,1,1,mode);this._vertex(w,0,1,1,1,1,1,1,mode);this._vertex(w,h,1,0,1,1,1,1,mode);
   this._vertex(0,0,0,1,1,1,1,1,mode);this._vertex(w,h,1,0,1,1,1,1,mode);this._vertex(0,h,0,0,1,1,1,1,mode);
  }finally{this._state=caller;}
  return result;
 }
 _gradientSnapshot(gradient){
  // Gradient creation coordinates and stop colors are immutable after adding
  // stops in the Canvas API. A later addColorStop gets a new captured version.
  const length=gradient.stops.length;let snapshot=this._gradientSnapshots.get(gradient);
  if(snapshot&&snapshot.sourceLength===length)return snapshot;
  const count=Math.min(4,length),colors=new Float32Array(16),stops=new Float32Array(4);stops.fill(1);
  for(let i=0;i<count;i++){const stop=gradient.stops[i],c=stop.color,a=c[3];stops[i]=stop.offset;colors.set([c[0]*a,c[1]*a,c[2]*a,a],i*4);}
  snapshot={sourceLength:length,count,colors,stops,x0:gradient.x0,y0:gradient.y0,x1:gradient.x1,y1:gradient.y1};this._gradientSnapshots.set(gradient,snapshot);return snapshot;
 }
 _sealBatch(){
  const count=this._count-this._batchStart;if(!count)return;
  const command=this._commands[this._commandCount]||(this._commands[this._commandCount]={});this._commandCount++;
  command.first=this._batchStart;command.count=count;command.kind=this._batchKind;const textures=command.textures||(command.textures=[]);textures.length=this._batchTextures.length;for(let i=0;i<textures.length;i++)textures[i]=this._batchTextures[i];command.composite=this._batchComposite;command.gradient=this._batchUsesGradient?this._batchGradientSnapshot:null;
  this._batchStart=this._count;this._batchTextures.length=0;this._batchUsesGradient=false;
 }
 flush(){
  if(!this._count||!this.usable)return;this._sealBatch();const gl=this.gl;
  // FBO and texture-update barriers split one frame into several segments.
  // Append each segment without overwriting vertices the GPU may still read;
  // orphan once per frame (or on capacity rollover), not once per small pass.
  if(this._vertexBufferNeedsOrphan||this._gpuVertexCursor+this._count>CAPACITY){
    gl.bufferData(gl.ARRAY_BUFFER,this._vertices.byteLength,gl.STREAM_DRAW);
    this._gpuVertexCursor=0;this._vertexBufferNeedsOrphan=false;
    this._metrics.vertexOrphans++;this._metrics.vertexOrphanBytes+=this._vertices.byteLength;this._metrics.frameVertexOrphans++;
  }
  const baseVertex=this._gpuVertexCursor;
  gl.bufferSubData(gl.ARRAY_BUFFER,baseVertex*STRIDE*4,this._vertices,0,this._count*STRIDE);
  this._metrics.vertexUploads++;this._metrics.vertexUploadBytes+=this._count*STRIDE*4;this._metrics.frameSegments++;
  for(let i=0;i<this._commandCount;i++){
    const command=this._commands[i],textures=command.textures,composite=command.composite,g=command.gradient;
    this._useProgram(command.kind==='image'?this.imageProgram:this.program);
    for(let unit=0;unit<textures.length;unit++)if(this._boundTextures[unit]!==textures[unit])this._bindTextureUnit(unit,textures[unit]);
    if(composite!==this._appliedBlend){
      if(composite==='copy'){if(this._blendEnabled){gl.disable(gl.BLEND);this._blendEnabled=false;}}
      else {if(!this._blendEnabled){gl.enable(gl.BLEND);this._blendEnabled=true;}if(composite==='lighter')gl.blendFuncSeparate(gl.ONE,gl.ONE,gl.ONE,gl.ONE);else if(composite==='screen')gl.blendFuncSeparate(gl.ONE,gl.ONE_MINUS_SRC_COLOR,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);else gl.blendFuncSeparate(gl.ONE,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);}
      this._appliedBlend=composite;
    }
    if(g&&g!==this._appliedGradient){gl.uniform4f(this._uniforms.uGradient,g.x0,g.y0,g.x1,g.y1);gl.uniform4fv(this._uniforms['uStopColors[0]'],g.colors);gl.uniform1fv(this._uniforms['uStops[0]'],g.stops);gl.uniform1i(this._uniforms.uStopCount,g.count);this._appliedGradient=g;}
    gl.drawArrays(gl.TRIANGLES,baseVertex+command.first,command.count);this._metrics.drawCalls++;this._metrics.frameDrawCalls++;
  }
  this._gpuVertexCursor+=this._count;this._metrics.vertices+=this._count;this._count=0;this._batchStart=0;this._commandCount=0;this._batchTextures.length=0;this._batchUsesGradient=false;
 }
 _batch(texture=null,gradient=null,composite=this._state.composite){
  const kind=texture?'image':'geometry',snapshot=gradient?this._gradientSnapshot(gradient):null;
  // Never reorder primitives: a program-kind transition seals the preceding
  // command, while adjacent images still share the existing eight-slot batch.
  if(kind!==this._batchKind||composite!==this._batchComposite||(gradient&&this._batchUsesGradient&&snapshot!==this._batchGradientSnapshot))this._sealBatch();
  this._batchKind=kind;this._batchComposite=composite;if(gradient){this._batchGradient=gradient;this._batchGradientSnapshot=snapshot;}
  if(!texture)return -1;
  let unit=this._batchTextures.indexOf(texture);
  if(unit<0){if(this._batchTextures.length===TEXTURE_UNITS)this._sealBatch();unit=this._batchTextures.length;this._batchTextures.push(texture);}
  return unit;
 }
 _bindTextureUnit(unit,texture){
  if(this._activeTextureUnit!==unit){this.gl.activeTexture(this.gl.TEXTURE0+unit);this._activeTextureUnit=unit;}
  if(this._boundTextures[unit]!==texture){this.gl.bindTexture(this.gl.TEXTURE_2D,texture);this._boundTextures[unit]=texture;}
 }
 _forgetTexture(texture){
  // Every declared sampler must remain complete even if a command does not
  // select it. Rebind evicted textures to white on every affected unit.
  for(let unit=0;unit<TEXTURE_UNITS;unit++)if(this._boundTextures[unit]===texture)this._bindTextureUnit(unit,this._white);
  if(this._batchTexture===texture)this._batchTexture=null;
  if(this._actualTexture===texture)this._actualTexture=null;
 }

 _vertex(x,y,u,v,r,g,b,a,mode,innerX=0,innerY=0){if(this._count===CAPACITY)this.flush();if(mode===2)this._batchUsesGradient=true;const at=this._count++*STRIDE,data=this._vertices;data[at]=x;data[at+1]=y;data[at+2]=u;data[at+3]=v;data[at+4]=r;data[at+5]=g;data[at+6]=b;data[at+7]=a;data[at+8]=mode;data[at+9]=innerX;data[at+10]=innerY;}

 _emitEllipse(e,paint,strokeWidth=0){
  if(!this.usable)return true;
  if(paint.gradient)return false;
  const rx=Math.hypot(e.ax,e.bx),ry=Math.hypot(e.ay,e.by),cross=e.ax*e.ay+e.bx*e.by;
  if(rx<=0||ry<=0||Math.abs(cross)>1e-7*rx*ry)return false;
  let outerX=rx,outerY=ry,innerX=0,innerY=0;
  if(strokeWidth){
   // Concentric ellipse shells preserve near-circular rings; narrow tractor
   // ellipses need the general constant-width stroke tessellator.
   if(Math.min(rx,ry)/Math.max(rx,ry)<.75)return false;
   const m=this._state.matrix,sx=Math.hypot(m[0],m[1]),sy=Math.hypot(m[2],m[3]);
   if(Math.abs(sx-sy)>1e-7*sx||Math.abs(m[0]*m[2]+m[1]*m[3])>1e-7*sx*sy)return false;
   // Concentric ellipse shells approximate a constant-width stroke while
   // keeping both boundaries analytically integrated at backing-pixel scale.
   const half=strokeWidth*sx*.5;outerX=rx+half;outerY=ry+half;
   innerX=Math.max(0,rx-half)/outerX;innerY=Math.max(0,ry-half)/outerY;
  }
  // The tangent coverage path has been checked through 2048 backing pixels.
  // New large ellipses must use that stable path on both axes; keep unusually
  // narrow or very thick large shells in the established tessellator.
  const large=outerX>256||outerY>256;
  const innerWidth=outerX*innerX,innerHeight=outerY*innerY;
  if(outerX>2048||outerY>2048||(large&&(Math.min(outerX,outerY)<32||Math.min(outerX,outerY)/Math.max(outerX,outerY)<.75||(strokeWidth&&innerX&&innerY&&(Math.min(innerWidth,innerHeight)<32||Math.min(innerWidth,innerHeight)/Math.max(innerWidth,innerHeight)<.7)))))return false;
  const c=paint.color,a=c[3]*this._state.globalAlpha,r=c[0]*a,g=c[1]*a,b=c[2]*a;
  const annulus=large&&strokeWidth&&innerX>=.75&&innerY>=.75;
  if(this._count+(annulus?ELLIPSE_SEGMENTS*6:6)>CAPACITY)this.flush();this._batch();
  if(annulus){
   // Circumscribe the outer ellipse (+1px AA guard), inscribe the inner ellipse
   // (-1px guard). All covered pixels retain their original affine UVs; only
   // fully transparent corners/center are omitted. No per-ring arrays/trig.
   const ox=(outerX+1)*ELLIPSE_OUTER_SCALE,oy=(outerY+1)*ELLIPSE_OUTER_SCALE;
   const ix=outerX*innerX-1,iy=outerY*innerY-1;
   for(let i=0;i<ELLIPSE_SEGMENTS;i++){
    const c0=ELLIPSE_POINTS[i*2],s0=ELLIPSE_POINTS[i*2+1],c1=ELLIPSE_POINTS[i*2+2],s1=ELLIPSE_POINTS[i*2+3];
    const x0=ox*c0,y0=oy*s0,x1=ox*c1,y1=oy*s1,x2=ix*c0,y2=iy*s0,x3=ix*c1,y3=iy*s1;
    this._vertex(e.cx+x0,e.cy+y0,x0/outerX,y0/outerY,r,g,b,a,12,innerX,innerY);
    this._vertex(e.cx+x1,e.cy+y1,x1/outerX,y1/outerY,r,g,b,a,12,innerX,innerY);
    this._vertex(e.cx+x2,e.cy+y2,x2/outerX,y2/outerY,r,g,b,a,12,innerX,innerY);
    this._vertex(e.cx+x2,e.cy+y2,x2/outerX,y2/outerY,r,g,b,a,12,innerX,innerY);
    this._vertex(e.cx+x1,e.cy+y1,x1/outerX,y1/outerY,r,g,b,a,12,innerX,innerY);
    this._vertex(e.cx+x3,e.cy+y3,x3/outerX,y3/outerY,r,g,b,a,12,innerX,innerY);
   }
   return true;
  }
  const ex=outerX+1,ey=outerY+1,ux=ex/outerX,uy=ey/outerY,mode=strokeWidth?12:11;
  const left=e.cx-ex,right=e.cx+ex,top=e.cy-ey,bottom=e.cy+ey;
  this._vertex(left,top,-ux,-uy,r,g,b,a,mode,innerX,innerY);
  this._vertex(right,top,ux,-uy,r,g,b,a,mode,innerX,innerY);
  this._vertex(left,bottom,-ux,uy,r,g,b,a,mode,innerX,innerY);
  this._vertex(left,bottom,-ux,uy,r,g,b,a,mode,innerX,innerY);
  this._vertex(right,top,ux,-uy,r,g,b,a,mode,innerX,innerY);
  this._vertex(right,bottom,ux,uy,r,g,b,a,mode,innerX,innerY);
  return true;
 }
 _emitTriangles(vertices,paint){if(!this.usable||!vertices.length)return;const gradient=paint.gradient,color=paint.color||[0,0,0,0],alpha=this._state.globalAlpha;this._batch(null,gradient);for(let i=0;i<vertices.length;i+=3){const a=vertices[i+2]*alpha*(gradient?1:color[3]);this._vertex(vertices[i],vertices[i+1],0,0,gradient?0:color[0]*a,gradient?0:color[1]*a,gradient?0:color[2]*a,a,gradient?2:1);}}
 _point(x,y){const m=this._state.matrix;return [m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];}
 save(){const previous=this._state,next=this._statePool.pop()||state();copyState(next,previous);this._stack.push(previous);this._state=next;}
 restore(){if(this._stack.length){const released=this._state;this._state=this._stack.pop();if(this._statePool.length<MAX_POOLED_STATES)this._statePool.push(released);}}
 getTransform(){const [a,b,c,d,e,f]=this._state.matrix;return {a,b,c,d,e,f,is2D:true};}
 setTransform(a,b,c,d,e,f){if(typeof a==='object'){({a,b,c,d,e,f}=a);}if(finiteTransform(a,b,c,d,e,f)){const m=this._state.matrix;m[0]=a;m[1]=b;m[2]=c;m[3]=d;m[4]=e;m[5]=f;}}
 resetTransform(){this.setTransform(1,0,0,1,0,0);}
 transform(a,b,c,d,e,f){if(!finiteTransform(a,b,c,d,e,f))return;const m=this._state.matrix,a0=m[0],b0=m[1],c0=m[2],d0=m[3],e0=m[4],f0=m[5];m[0]=a0*a+c0*b;m[1]=b0*a+d0*b;m[2]=a0*c+c0*d;m[3]=b0*c+d0*d;m[4]=a0*e+c0*f+e0;m[5]=b0*e+d0*f+f0;}
 translate(x,y){this.transform(1,0,0,1,x,y);}
 scale(x,y){this.transform(x,0,0,y,0,0);}
 rotate(angle){this.transform(Math.cos(angle),Math.sin(angle),-Math.sin(angle),Math.cos(angle),0,0);}
 setLineDash(values){const dash=Array.from(values);if(dash.some(n=>!Number.isFinite(n)||n<0))return;const target=this._state.dash;target.length=dash.length*(dash.length%2?2:1);for(let i=0;i<target.length;i++)target[i]=dash[i%dash.length];}
 getLineDash(){return this._state.dash.slice();}
 getContextAttributes(){return {alpha:false,desynchronized:false,colorSpace:'srgb',willReadFrequently:false};}
 fillRect(x,y,w,h){if(!finite(x,y,w,h)||!w||!h)return;const points=[this._point(x,y),this._point(x+w,y),this._point(x+w,y+h),this._point(x,y+h)];const vertices=[];for(const i of[0,1,2,0,2,3])vertices.push(...points[i],1);const style=this._state.fillStyle;this._emitTriangles(vertices,style?.gradient?style:{color:parseColor(style)});}
 clearRect(x,y,w,h){const s=this._state,fill=s.fillStyle,alpha=s.globalAlpha,composite=s.composite;s.fillStyle='#000000';s.globalAlpha=1;s.composite='copy';this.fillRect(x,y,w,h);s.fillStyle=fill;s.globalAlpha=alpha;s.composite=composite;}
 markTextureDirty(source,bounds=null){
  const previous=this._dirty.get(source),entry=this._cache.get(source),pending=previous&&previous.revision!==entry?.revision,revision=(previous?.revision||0)+1;let region=bounds;
  if(pending){if(!previous.bounds||!bounds)region=null;else {const a=previous.bounds,x=Math.min(a.x,bounds.x),y=Math.min(a.y,bounds.y);region={x,y,width:Math.max(a.x+a.width,bounds.x+bounds.width)-x,height:Math.max(a.y+a.height,bounds.y+bounds.height)-y};}}
  this._dirty.set(source,{revision,bounds:region});if(this._lost)this._queueRecoverySource(source);
 }
 _evict(protectedSource){
  while(this._metrics.textureBytes>MAX_BYTES||this._cache.size>MAX_TEXTURES){
   let source=null,entry=null;for(const [candidate,value]of this._cache)if(candidate!==protectedSource&&(!entry||value.lastUse<entry.lastUse)){source=candidate;entry=value;}
   if(!entry)break;
   this.flush();this._forgetTexture(entry.texture);this.gl.deleteTexture(entry.texture);this._cache.delete(source);this._metrics.textureBytes-=entry.bytes;this._metrics.evictions++;if(this._batchTexture===entry.texture)this._batchTexture=null;if(this._actualTexture===entry.texture)this._actualTexture=null;
  }
 }
 _texture(source,restoring=false,width,height){
  if(!source||this._disposed||this._failure||!this._contextAvailable||(!this.usable&&!restoring))return null;if(width===undefined||height===undefined)[width,height]=sizeOf(source);if(!width||!height)return null;if(width>this.maxTextureSize||height>this.maxTextureSize){this.fail(`Source ${width}x${height} exceeds MAX_TEXTURE_SIZE ${this.maxTextureSize}`);return null;}
  const version=source._tyranTextureVersion||0,dirty=this._dirty.get(source),revision=dirty?.revision||0;let entry=this._cache.get(source);
  if(entry&&entry.width===width&&entry.height===height&&entry.version===version&&entry.revision===revision){entry.lastUse=++this._textureUse;return entry;}
  if(width*height*4>MAX_BYTES){this.fail(`Source ${width}x${height} exceeds the texture budget`);return null;}
  this.flush();const gl=this.gl;let bounds=null;
  try{
  if(entry&&entry.width===width&&entry.height===height){
    const localChanged=entry.revision!==revision,sourceChanged=entry.version!==version;
    // A local full invalidation must not inherit old source-side bounds. If
    // both independent channels changed, conservatively refresh the whole image.
    const region=localChanged?(sourceChanged?null:dirty.bounds):entry.version+1===version?source._tyranTextureDirty:null;
    bounds=rectangle(region,width,height);
  }
  const allocated=!entry||entry.width!==width||entry.height!==height;
  if(allocated){if(entry){this._forgetTexture(entry.texture);gl.deleteTexture(entry.texture);this._metrics.textureBytes-=entry.bytes;this._cache.delete(source);}entry={texture:gl.createTexture(),width,height,bytes:width*height*4};if(!entry.texture)throw Error('Texture allocation failed');this._cache.set(source,entry);this._metrics.textureBytes+=entry.bytes;this._bindTextureUnit(0,entry.texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,source);}
  else {this._bindTextureUnit(0,entry.texture);if(bounds&&bounds.width&&bounds.height){gl.pixelStorei(gl.UNPACK_SKIP_PIXELS,bounds.x);gl.pixelStorei(gl.UNPACK_SKIP_ROWS,bounds.y);gl.texSubImage2D(gl.TEXTURE_2D,0,bounds.x,bounds.y,bounds.width,bounds.height,gl.RGBA,gl.UNSIGNED_BYTE,source);gl.pixelStorei(gl.UNPACK_SKIP_PIXELS,0);gl.pixelStorei(gl.UNPACK_SKIP_ROWS,0);this._metrics.partialUploads++;}else gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,source);}
  this._actualTexture=entry.texture;entry.version=version;entry.revision=revision;entry.lastUse=++this._textureUse;if(dirty)this._dirty.set(source,{revision,bounds:null});this._metrics.uploads++;this._metrics.uploadedBytes+=bounds?bounds.width*bounds.height*4:entry.bytes;this._cache.set(source,entry);
  // Validate new storage before displaying it. Existing, dimension-checked
  // subimage updates stay asynchronous: getError would serialize every small
  // scenery patch with the GPU. Exceptions and context loss still fall back.
  if(gl.isContextLost()){this._loseContext();return null;}
  if(allocated){const error=gl.getError();if(error!==gl.NO_ERROR){this._errors.push(error);this.fail(`Texture upload failed (${error})`);return null;}}
  this._evict(source);return entry;
  }catch(error){if(gl.isContextLost())this._loseContext();else this.fail(error);return null;}
 }
 prewarm(source){
  if(this._disposed||this._failure)return false;
  if(Array.isArray(source)){for(const item of source)this.prewarm(item);return this.usable;}
  if(this._lost)this._queueRecoverySource(source);else this._texture(source);return this.usable;
 }
 drawImage(source,...args){
  if(!this.usable)return;const [width,height]=sizeOf(source);let sx=0,sy=0,sw=width,sh=height,dx,dy,dw,dh;
  if(args.length===2){[dx,dy]=args;dw=sw;dh=sh;}else if(args.length===4){[dx,dy,dw,dh]=args;}else if(args.length===8){[sx,sy,sw,sh,dx,dy,dw,dh]=args;}else throw new TypeError('drawImage expects3,5 or9 arguments');
  if(!finite(sx,sy,sw,sh,dx,dy,dw,dh)||!sw||!sh||!dw||!dh)return;if(sw<0){sx+=sw;sw=-sw;}if(sh<0){sy+=sh;sh=-sh;}if(dw<0){dx+=dw;dw=-dw;}if(dh<0){dy+=dh;dh=-dh;}
  const right=Math.min(width,sx+sw),bottom=Math.min(height,sy+sh),left=Math.max(0,sx),top=Math.max(0,sy);if(right<=left||bottom<=top)return;dx+=(left-sx)*dw/sw;dy+=(top-sy)*dh/sh;dw*=(right-left)/sw;dh*=(bottom-top)/sh;sx=left;sy=top;sw=right-left;sh=bottom-top;
  const m=this._state.matrix,ex=dx+dw,ey=dy+dh;
  const x0=m[0]*dx+m[2]*dy+m[4],y0=m[1]*dx+m[3]*dy+m[5],x1=m[0]*ex+m[2]*dy+m[4],y1=m[1]*ex+m[3]*dy+m[5];
  const x2=m[0]*ex+m[2]*ey+m[4],y2=m[1]*ex+m[3]*ey+m[5],x3=m[0]*dx+m[2]*ey+m[4],y3=m[1]*dx+m[3]*ey+m[5];
  if(Math.max(x0,x1,x2,x3)<0||Math.min(x0,x1,x2,x3)>this.canvas.width||Math.max(y0,y1,y2,y3)<0||Math.min(y0,y1,y2,y3)>this.canvas.height)return;
  const entry=this._texture(source,false,width,height);if(!entry)return;
  // Keep a quad within one submitted segment so its sampler slots cannot be
  // reset between its two triangles at the vertex-buffer capacity boundary.
  if(this._count+6>CAPACITY)this.flush();
  // An explicitly opaque source at alpha one replaces every covered fragment.
  // Override this GPU command only: Canvas2D 'copy' also clears outside the
  // shape, so the caller's Canvas state and native path must remain untouched.
  const a=this._state.globalAlpha,composite=this._state.composite;
  const drawComposite=source._tyranOpaque===true&&a===1&&composite==='source-over'?'copy':composite;
  const mode=3+this._batch(entry.texture,null,drawComposite),u=sx/width,v=sy/height,u1=(sx+sw)/width,v1=(sy+sh)/height;
  this._vertex(x0,y0,u,v,a,a,a,a,mode);this._vertex(x1,y1,u1,v,a,a,a,a,mode);this._vertex(x2,y2,u1,v1,a,a,a,a,mode);this._vertex(x0,y0,u,v,a,a,a,a,mode);this._vertex(x2,y2,u1,v1,a,a,a,a,mode);this._vertex(x3,y3,u,v1,a,a,a,a,mode);
 }
 dispose(){if(this._disposed)return;this._disposed=true;this._softLayerScale=0;this._recoveryPrewarm=null;this.fail(this._failure||'disposed');}
}
for(const name of ['fillStyle','strokeStyle','lineCap','lineJoin','miterLimit','lineWidth','lineDashOffset','shadowColor','shadowBlur','shadowOffsetX','shadowOffsetY','imageSmoothingEnabled','imageSmoothingQuality'])Object.defineProperty(GPUCanvas2D.prototype,name,{get(){return this._state[name];},set(value){this._state[name]=value;}});
Object.defineProperty(GPUCanvas2D.prototype,'globalAlpha',{get(){return this._state.globalAlpha;},set(value){if(Number.isFinite(value)&&value>=0&&value<=1)this._state.globalAlpha=value;}});
Object.defineProperty(GPUCanvas2D.prototype,'globalCompositeOperation',{get(){return this._state.composite;},set(value){if(['source-over','screen','lighter','copy'].includes(value))this._state.composite=value;}});
installGeometry(GPUCanvas2D);
export function createGpuCanvas(width,height,displayCanvas=null){try{return new GPUCanvas2D(width,height,displayCanvas);}catch(error){createGpuCanvas.lastError=String(error);return null;}}
