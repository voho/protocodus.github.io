import assert from 'node:assert/strict';

// Records the observable WebGL command stream. No DOM, browser or GPU required.
export function mockCanvas(width=1920,height=1080){
  let id=0,lost=false,unit=0,program=null,target=null,epoch=0,memory=null,ranges=[],stride=0,viewport=[],blend=[],blendEnabled=true;
  const resources=new Set(),handlers=new Map(),bindings=[],attachments=new Map(),textureSources=new Map(),pixelStore=new Map(),uniforms=new Map();
  const draws=[],uploads=[],allocations=[],events=[],calls={bindTexture:0,useProgram:0,uniform2f:0,getError:0};
  const gl=new Proxy({}, {get(_,name){
    if(name==='NO_ERROR')return 0;if(name==='TEXTURE0')return 1000;
    if(name==='getError')return()=>{calls.getError++;return 0;};if(name==='isContextLost')return()=>lost;
    if(name==='getShaderParameter'||name==='getProgramParameter')return()=>true;
    if(name==='getParameter')return key=>key==='MAX_TEXTURE_SIZE'?16384:8;
    if(name==='getUniformLocation')return(p,key)=>`${p.id}:${key}`;
    if(name==='checkFramebufferStatus')return()=>'FRAMEBUFFER_COMPLETE';
    if(name.startsWith('create'))return()=>{const handle={kind:name,id:++id};resources.add(handle);return handle;};
    if(name.startsWith('delete'))return handle=>resources.delete(handle);
    if(name==='useProgram')return value=>{program=value;calls.useProgram++;};
    if(name==='activeTexture')return value=>{unit=value-1000;};
    if(name==='bindTexture')return(_target,value)=>{bindings[unit]=value;calls.bindTexture++;};
    if(name==='bindFramebuffer')return(_type,value)=>{target=value;};
    if(name==='framebufferTexture2D')return(_a,_b,_c,texture)=>{assert(!bindings.includes(texture),'FBO texture is not bound as a sampler');attachments.set(target,texture);};
    if(name==='viewport')return(...value)=>{viewport=value;};
    if(name==='blendFuncSeparate')return(...value)=>{blend=value;};
    if(name==='enable'||name==='disable')return capability=>{if(capability==='BLEND')blendEnabled=name==='enable';};
    if(name.startsWith('uniform'))return(location,...value)=>{if(name==='uniform2f')calls.uniform2f++;uniforms.set(location,value.map(v=>ArrayBuffer.isView(v)?[...v]:v));};
    if(name==='vertexAttribPointer')return(_index,_size,_type,_normalized,bytes)=>{stride=bytes/4;};
    if(name==='bufferData')return(_type,bytes)=>{memory=new Float32Array(bytes/4);ranges=[];allocations.push({epoch:++epoch,bytes});};
    if(name==='bufferSubData')return(_type,offset,data,sourceOffset,length)=>{
      const from=offset/4,to=from+length;assert(to<=memory.length,'Upload stays inside allocation');
      for(const [a,b]of ranges)assert(to<=a||from>=b,'Submitted vertex ranges are never overwritten');
      ranges.push([from,to]);memory.set(data.subarray(sourceOffset,sourceOffset+length),from);uploads.push({epoch,offset,vertices:length/stride});
    };
    if(name==='pixelStorei')return(key,value)=>pixelStore.set(key,value);
    if(name==='texImage2D'||name==='texSubImage2D')return(...args)=>{
      assert(!lost,'No upload into a lost context');
      const source=args.at(-1),version=source?._tyranTextureVersion||0,record={source,version};textureSources.set(bindings[unit],record);
      events.push({kind:'texture',method:name,source,version,args:args.slice(0,-1),skip:[pixelStore.get('UNPACK_SKIP_PIXELS')||0,pixelStore.get('UNPACK_SKIP_ROWS')||0]});
    };
    if(name==='drawArrays')return(mode,first,count)=>{
      const from=first*stride,to=(first+count)*stride;assert(ranges.some(([a,b])=>from>=a&&to<=b),'Draw uses uploaded vertices');
      if(target)assert(!bindings.includes(attachments.get(target)),'No framebuffer feedback');
      const vertices=memory.slice(from,to),images=[];
      for(let at=0;at<vertices.length;at+=stride){const mode=vertices[at+8];images.push(mode>=3&&mode<=10?textureSources.get(bindings[mode-3]):null);}
      const draw={mode,first,count,stride,vertices,images,program:program.id,target:target?.id||0,viewport:viewport.slice(),blend:blendEnabled?blend.slice():['copy'],uniforms:new Map(uniforms)};
      draws.push(draw);events.push({kind:'draw',draw});
    };
    if(/^[A-Z_0-9]+$/.test(name))return name;
    return()=>{};
  }});
  return {width,height,handlers,resources,draws,uploads,allocations,events,calls,get stride(){return stride;},getContext:()=>gl,addEventListener:(name,fn)=>handlers.set(name,fn),lose(){lost=true;resources.clear();uniforms.clear();textureSources.clear();attachments.clear();bindings.length=0;handlers.get('webglcontextlost')({preventDefault(){}});},restore(){lost=false;return handlers.get('webglcontextrestored')();}};
}
