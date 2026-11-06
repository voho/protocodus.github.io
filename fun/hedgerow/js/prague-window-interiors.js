/* Prague's selected upper windows continue the view ray into a dark room
   with prewar linen/roller blinds. The standard opaque pane retains its
   dielectric specular response. Only existing front-face UVs are remapped;
   no geometry, custom attributes, textures, light or per-frame work is added.
   Negative UV metadata is private to the three genuine period frontages;
   all other glass, passages and damaged buildings keep their source UVs. */
import * as THREE from 'three';

const ROOM_DEPTH = 1.481;
const COTTON_DEPTH = .291;
const LINEN_VARIANTS = Object.freeze([
  [.51,.42,1.96,1.77], [.34,.52,1.46,2.00], [.62,.27,1.88,1.65],
  [.30,.32,2.01,1.98], [.47,.56,1.22,1.54], [.60,.40,1.96,1.17],
].map(Object.freeze));
const ROLLER_VARIANTS = Object.freeze([
  [.36,.93,.58], [.70,.18,1.13], [1.26,.64,.22],
  [.14,1.20,.89], [.92,.40,1.34], [.50,1.39,.16],
].map(Object.freeze));
const float = n => Number.isInteger(n) ? n+'.0' : String(n);
const variantsGLSL = (name, values, type) => `
${type} ${name}(float seed) {
  ${values.map((v,i)=>`${i===values.length-1?'':`if(seed < ${i+.5}) `}return ${type}(${v.map(float).join(',')});`).join('\n  ')}
}`;

const GLSL = `
varying vec2 vAmbientPane;
${variantsGLSL('windowLinen',LINEN_VARIANTS,'vec4')}
${variantsGLSL('windowRoller',ROLLER_VARIANTS,'vec3')}
float windowCotton(vec2 p, vec2 extent, float style, float seed) {
  float aa = max(max(fwidth(p.x),fwidth(p.y)) * .65, .00005);
  if (style < .5) {
    float top = extent.y + .015;
    vec4 spec=windowLinen(seed);
    float vl = clamp((top - p.y) / spec.z, 0., 1.);
    float vr = clamp((top - p.y) / spec.w, 0., 1.);
    float left = -extent.x + .025 - .025 * vl * vl;
    float right = extent.x - spec.y - .03 + .025 * vr * vr;
    float ul = (p.x-left)/spec.x, ur = (p.x-right)/spec.y;
    float dl = min(min(p.x-left,left+spec.x-p.x),min(top-p.y,p.y-(top-spec.z+.012*sin(ul*7.+.4+seed*.37))));
    float dr = min(min(p.x-right,right+spec.y-p.x),min(top-p.y,p.y-(top-spec.w+.012*sin(ur*7.+1.9+seed*.61))));
    return smoothstep(-aa,aa,max(dl,dr));
  }
  float width = extent.x * 2. / 3.;
  float bay = clamp(floor((p.x + extent.x) / width), 0., 2.);
  float centre = -extent.x + width * (bay + .5);
  vec3 drops=windowRoller(seed);
  float drop = bay < .5 ? drops.x : bay < 1.5 ? drops.y : drops.z;
  float top = extent.y - .055;
  float blind = min(width*.5-.035-abs(p.x-centre),min(top-p.y,p.y-top+drop));
  float roll = min(width*.5-.0275-abs(p.x-centre),.029-abs(p.y-(extent.y-.025)));
  return smoothstep(-aa,aa,max(blind,roll));
}
vec3 windowAmbient(vec2 uv, vec3 positionView, vec3 towardsEye) {
  float atlasStyle = floor(uv.y * .5 + .00001);
  float style = atlasStyle - WINDOW_STYLE_OFFSET;
  float seed = floor(uv.x * .5 + .00001);
  vec2 st = uv - vec2(seed,atlasStyle)*2.;
  vec3 dx = dFdx(positionView), dy = dFdy(positionView);
  vec2 ux = dFdx(uv), uy = dFdy(uv);
  float det = ux.x * uy.y - ux.y * uy.x;
  if (abs(det) < 1e-12) return vec3(.024);
  vec3 across = (dx * uy.y - dy * ux.y) / det;
  vec3 up = (dy * ux.x - dx * uy.x) / det;
  vec2 size = vec2(length(across), length(up));
  vec3 n = normalize(cross(across, up));
  vec3 ray = -normalize(towardsEye);
  vec3 d = vec3(dot(ray, across) / size.x, dot(ray, up) / size.y, -dot(ray, n));
  // At a grazing view the accepted frame occludes the opening; keep the
  // analytic calculation bounded instead of dividing by a vanishing ray.
  d.z = max(d.z, .001);
  vec2 halfSize = size * .5;
  vec2 o = (st - .5) * size;
  vec2 side = mix(-halfSize, halfSize, step(vec2(0.), d.xy));
  vec2 denominator = mix(vec2(-1.),vec2(1.),step(vec2(0.),d.xy)) * max(abs(d.xy),vec2(.00001));
  vec2 sideTime = (side - o) / denominator;
  sideTime = mix(vec2(100000.), sideTime, step(vec2(.00001), abs(d.xy)));
  float backTime = ${ROOM_DEPTH} / d.z;
  float wallTime = max(0., min(backTime, min(sideTime.x, sideTime.y)));
  vec3 hit = vec3(o + d.xy * wallTime, d.z * wallTime);
  float aperture = size.x * size.y;
  float radius2 = dot(hit.xy, hit.xy);
  float visibility = clamp(aperture / (3.14159 * (hit.z * hit.z + .35 * dot(size,size) + radius2 * .35)), .09, .60);
  // Surface albedo times conservative aperture visibility; all lighting is
  // still the scene's ordinary PBR diffuse/environment light. No radiance
  // is added and the pane keeps the standard dielectric specular response.
  vec3 albedo = vec3(.34, .315, .265) * visibility;
  if (wallTime == sideTime.y && d.y < 0.) albedo *= .58;
  float clothTime = ${COTTON_DEPTH} / d.z;
  vec2 cloth = o + d.xy * clothTime;
  float depthDifference = wallTime-clothTime;
  float depthAA = max(fwidth(depthDifference)*.65,.00005);
  float coverage = windowCotton(cloth,halfSize,style,seed)*smoothstep(-depthAA,depthAA,depthDifference);
  if (coverage > 0.) {
    vec4 spec=windowLinen(seed);
    float u = cloth.x < 0. ? (cloth.x+halfSize.x-.025)/spec.x : (cloth.x-halfSize.x+spec.y+.03)/spec.y;
    float phase = cloth.x < 0. ? .4+seed*.37 : 1.9+seed*.61;
    float fold = style < .5 ? .79 + .065 * cos(u*3.14159*7.+phase+.12*sin(u*3.14159*3.)) : .78;
    float edge = 1. - smoothstep(halfSize.y - .10, halfSize.y + .05, cloth.y);
    vec3 cotton = (style < .5 ? vec3(.54,.515,.45) : vec3(.40,.365,.28)) * fold * mix(.65,1.,edge);
    albedo = mix(albedo,cotton,coverage);
  }
  return albedo;
}`;

function createAmbientMaterial() {
  const material=new THREE.MeshStandardMaterial({name:'prague_ambient_windows',color:0x151b21,vertexColors:true,roughness:.05,metalness:0,envMapIntensity:1.6});
  material.userData.pragueAmbientWindows=true;
  material.defines={WINDOW_STYLE_OFFSET:'1.0'};
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vAmbientPane;').replace('#include <begin_vertex>','#include <begin_vertex>\nvAmbientPane=uv;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+GLSL).replace('#include <color_fragment>','#include <color_fragment>\nif(vAmbientPane.y < -32.0) diffuseColor.rgb=windowAmbient(vAmbientPane+vec2(0.0,64.0),-vViewPosition,vViewPosition);');
  };
  material.customProgramCacheKey=()=> 'prague-ambient-windows-v1';
  return material;
}

const PLANS = Object.freeze({
  prague_old_classical:[[0,-1,2],[-1,3,1]],
  prague_classical_sage:[[1,-1,4,2],[-1,3,-1,0],[2,-1,5,1]],
  prague_interwar:[[0,1,-1],[-1,3,4],[1,-1,-1],[2,5,0],[-1,4,3]],
});

function boxes(geometry) {
  const p=geometry.attributes.position,out=[];
  if(geometry.index||p.count%36)throw new Error('Expected authored closed glass boxes');
  for(let first=0;first<p.count;first+=36){
    const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
    for(let i=first;i<first+36;i++)for(let c=0;c<3;c++){const v=p.array[i*3+c];lo[c]=Math.min(lo[c],v);hi[c]=Math.max(hi[c],v);}
    out.push({first,lo,hi,centre:lo.map((v,i)=>(v+hi[i])/2),size:lo.map((v,i)=>hi[i]-v)});
  }
  return out;
}

export function addPragueWindowInteriors(models) {
  const names=Object.keys(PLANS),done=names.map(name=>models.get(name)?.prims.some(p=>p.key==='glass'&&p.material?.userData?.pragueAmbientWindows===true));
  if(done.every(Boolean))return models;
  if(done.some(Boolean))throw new Error('Prague window catalog is only partially prepared');
  const material=createAmbientMaterial(),prepared=[],geometries=[];
  try {
    for(const[name,plan]of Object.entries(PLANS)){
      const model=models.get(name);if(!model)throw new Error('Missing genuine Prague frontage '+name);
      const flat=plan.flat();
      const prims=model.prims.map(p=>{
        if(p.key!=='glass')return p;
        const geometry=p.geometry.clone();geometries.push(geometry);
        const position=geometry.attributes.position,normal=geometry.attributes.normal,uv=geometry.attributes.uv;
        const panes=boxes(geometry).filter(w=>w.centre[2]>5&&w.centre[1]>3.8&&w.size[0]>1&&w.size[1]>1.3).sort((a,b)=>a.centre[1]-b.centre[1]||a.centre[0]-b.centre[0]);
        if(panes.length!==flat.length)throw new Error('Unexpected upper-window count '+name);
        for(let n=0;n<panes.length;n++){
          const w=panes[n],variant=flat[n],style=name==='prague_interwar'?2:1;let rewritten=0;
          if(variant<0)continue;
          for(let i=w.first;i<w.first+36;i++){
            if(normal.getZ(i)<.9)continue;
            uv.setXY(i,(position.getX(i)-w.lo[0])/w.size[0]+variant*2,(position.getY(i)-w.lo[1])/w.size[1]+style*2-64);rewritten++;
          }
          if(rewritten!==6)throw new Error('Expected two front glass triangles');
        }
        return{...p,geometry,material};
      });
      prepared.push([name,{...model,prims}]);
    }
  } catch(error){for(const geometry of geometries)geometry.dispose();material.dispose();throw error;}
  for(const[name,model]of prepared)models.set(name,model);
  return models;
}
