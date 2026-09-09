import * as THREE from 'three';
import { createChaseCamera } from './camera.js';
import { createRallyCar } from './car-model.js';
import { loadRoadTextures } from './textures.js';
import { loadSceneryModels } from './scenery-models.js';
import { PHYSICS } from './simulation.js';

// The renderer owns only presentation. Every transform below is derived from the
// immutable generated course or the current simulation snapshot.
const PALETTES = {
  desert: { ground: '#c6a16c', groundLight: '#e4c58f', rock: '#ad7954', rockLight: '#d2aa78', tree: '#7b8850', leaf: '#6b8249', sky: '#e7ddd0', asphalt: '#434d51', accent: '#efbb4b', water: '#75b8b0' },
  jungle: { ground: '#687b47', groundLight: '#a0a05c', rock: '#76806a', rockLight: '#9d9c81', tree: '#254e37', leaf: '#477449', sky: '#d4dfcb', asphalt: '#454e4b', accent: '#d9bd52', water: '#4d9387' },
  beach: { ground: '#d6c194', groundLight: '#f1dfb4', rock: '#a39777', rockLight: '#c5b793', tree: '#608251', leaf: '#6d9552', sky: '#dcebe5', asphalt: '#515957', accent: '#ecbc48', water: '#4aa9a5' },
  mountains: { ground: '#8a967e', groundLight: '#b0b39a', rock: '#6b7778', rockLight: '#a0a7a0', tree: '#355d4a', leaf: '#527661', sky: '#d8e1dd', asphalt: '#4b5255', accent: '#ecc55a', water: '#80adb0' },
};
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const yieldFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
function rng(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h += 0x6D2B79F5; let t = Math.imul(h ^ h >>> 15, 1 | h); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function canvasTexture(size, paint) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  paint(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
function textTexture(text, foreground = '#f8edca', background = '#222e30', width = 1024, height = 256) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = foreground; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `900 italic ${Math.floor(height * .69)}px Arial, sans-serif`; ctx.fillText(text, width / 2, height * .52);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}
function customGeometry(vertices, indices, uvs) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  if (uvs) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}
function roofGeometry() {
  return customGeometry([-1,0,-1, 1,0,-1, 0,.65,-1, -1,0,1, 1,0,1, 0,.65,1], [0,2,1,3,4,5,0,3,5,0,5,2,1,2,5,1,5,4,0,1,4,0,4,3]);
}
function palmLeafGeometry() {
  const vertices = [], indices = [];
  for (let i = 0; i < 8; i++) {
    const t = i / 7, width = Math.sin(t * Math.PI) * .36;
    vertices.push(-width, Math.sin(t * Math.PI) * .55 - t * t * .7, t * 3.1, width, Math.sin(t * Math.PI) * .55 - t * t * .7, t * 3.1);
    if (i < 7) { const n = i * 2; indices.push(n,n+1,n+2,n+1,n+3,n+2); }
  }
  return customGeometry(vertices, indices);
}
function weatheredRockGeometry() {
  const g=new THREE.IcosahedronGeometry(1,2),a=g.attributes.position;
  for(let i=0;i<a.count;i++){
    const x=a.getX(i),y=a.getY(i),z=a.getZ(i);
    const noise=Math.sin(x*8+z*3)*Math.cos(y*7-z*5)*.11+Math.sin(z*12+y*4)*.045;
    a.setXYZ(i,x*(1+noise),y*(1+noise)*.83,z*(1+noise));
  }
  g.computeVertexNormals();return g;
}

// Alpha-tested foliage casts baked leaf-shaped shadows, with no transparent sorting.
function leafClusterTexture(random, pine=false) {
  return canvasTexture(256,(ctx,size)=>{
    const drawBranch=(x,y,angle,length,width,level)=>{
      const endX=x+Math.cos(angle)*length,endY=y+Math.sin(angle)*length;
      ctx.strokeStyle='#64543b';ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(endX,endY);ctx.stroke();
      if(level>0){for(let i=0;i<3;i++)drawBranch(x+(endX-x)*(.4+i*.27),y+(endY-y)*(.4+i*.27),angle+(i%2?1:-1)*(.4+random()*.6),length*(.46+random()*.16),width*.57,level-1);}
      else for(let j=0;j<(pine?28:20);j++){
        const t=random(),spread=pine?9:17,xx=x+(endX-x)*t+(random()-.5)*spread,yy=y+(endY-y)*t+(random()-.5)*spread;
        ctx.fillStyle=['#54714b','#658455','#769362','#405e3a','#8b9e68'][Math.floor(random()*5)];
        ctx.beginPath();ctx.ellipse(xx,yy,pine?1.4:2.6+random()*2,pine?5:1.8+random()*2,angle+random()*2,0,Math.PI*2);ctx.fill();
      }
    };
    if(pine){for(let i=0;i<8;i++){const y=30+i*25,span=10+i*12;drawBranch(128,y,-2.65,span,1.5,2);drawBranch(128,y,-.5,span,1.5,2);}}
    else for(let i=0;i<9;i++)drawBranch(128,145,i*Math.PI*2/9,55+random()*30,2.7,3);
  });
}

function cloudSkybox(random) {
  const grid=Float32Array.from({length:4096},()=>random());
  const noise=(x,z)=>{
    const ix=Math.floor(x),iz=Math.floor(z),tx=x-ix,tz=z-iz,sx=tx*tx*(3-2*tx),sz=tz*tz*(3-2*tz);
    const at=(a,b)=>grid[((b%64+64)%64)*64+(a%64+64)%64];
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(at(ix,iz),at(ix+1,iz),sx),THREE.MathUtils.lerp(at(ix,iz+1),at(ix+1,iz+1),sx),sz);
  };
  const faces=[];
  for(let face=0;face<6;face++){
    const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
    const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(256,256);
    for(let y=0;y<256;y++)for(let x=0;x<256;x++){
      const u=x/255*2-1,v=y/255*2-1;
      const direction=face===0?[1,-v,-u]:face===1?[-1,-v,u]:face===2?[u,1,v]:face===3?[u,-1,-v]:face===4?[u,-v,1]:[-u,-v,-1];
      const length=Math.hypot(...direction),altitude=direction[1]/length;
      const t=Math.pow(clamp(altitude,0,1),.48),ground=altitude<0?clamp(-altitude*4,0,1):0;
      let r=THREE.MathUtils.lerp(218,104,t),g=THREE.MathUtils.lerp(219,145,t),b=THREE.MathUtils.lerp(206,174,t);
      r=THREE.MathUtils.lerp(r,97,ground);g=THREE.MathUtils.lerp(g,109,ground);b=THREE.MathUtils.lerp(b,85,ground);
      if(altitude>.035){
        const cx=direction[0]/(direction[1]+length*.18)*3.8+19,cz=direction[2]/(direction[1]+length*.18)*3.8+34;
        const field=noise(cx,cz)*.54+noise(cx*2.1,cz*2.1)*.28+noise(cx*4.4,cz*4.4)*.12+noise(cx*9,cz*9)*.06;
        const density=THREE.MathUtils.smoothstep(field,.50,.69)*THREE.MathUtils.smoothstep(altitude,.035,.16);
        const shade=clamp((field-.50)*125,0,22);
        r=THREE.MathUtils.lerp(r,239+shade*.35,density*.91);g=THREE.MathUtils.lerp(g,239+shade*.25,density*.91);b=THREE.MathUtils.lerp(b,228+shade*.3,density*.91);
      }
      const i=(y*256+x)*4;pixels.data[i]=r;pixels.data[i+1]=g;pixels.data[i+2]=b;pixels.data[i+3]=255;
    }
    ctx.putImageData(pixels,0,0);faces.push(canvas);
  }
  const texture=new THREE.CubeTexture(faces);texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;return texture;
}

function grassClumpGeometry(random) {
  const vertices=[],indices=[],colors=[];
  for(let blade=0;blade<7;blade++){
    const angle=blade*2.399,dx=Math.sin(angle),dz=Math.cos(angle),length=.65+random()*.55;
    const x=dx*random()*.24,z=dz*random()*.24;
    for(let j=0;j<4;j++){
      const t=j/3,width=.045*(1-t)+.002,bend=t*t*.29;
      for(const side of [-1,1]){
        vertices.push(x+dx*bend+dz*width*side,t*length,z+dz*bend-dx*width*side);
        const shade=.56+t*.44;colors.push(shade,shade,shade);
      }
      if(j<3){const i=blade*8+j*2;indices.push(i,i+2,i+1,i+1,i+2,i+3);}
    }
  }
  const g=customGeometry(vertices,indices);g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));return g;
}

export async function createRenderer(canvas, track, onProgress = () => {}) {
  const random = rng(`${track.seed}:art`), palette = PALETTES[track.environment] || PALETTES.desert;
  let disposed = false, width = 1, height = 1, renderedFrames = 0, lastMode = '', elapsed = 0;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(palette.sky);
  scene.fog = new THREE.Fog(palette.sky, 230, 1350);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false;
  const camera = new THREE.PerspectiveCamera(55, 1, .7, 2400);
  const staticRoot = new THREE.Group(); scene.add(staticRoot);
  const geometries = new Set(), materials = new Set(), textures = new Set();
  const geometry = g => (geometries.add(g), g);
  const material = (color, extra = {}) => { const m = new THREE.MeshStandardMaterial({ color, roughness: .92, metalness: 0, ...extra }); materials.add(m); return m; };
  const keepTexture = t => (textures.add(t), t);
  const mesh = (g, m, parent = staticRoot, cast = true) => { const o = new THREE.Mesh(g,m); o.castShadow = cast; o.receiveShadow = true; parent.add(o); return o; };
  const b = track.bounds;
  // Excavate only beneath the ribbons; the exposed ground meets their shoulder.
  const terrainCutAt=distance=>.04+.62*(1-THREE.MathUtils.smoothstep(distance,track.width*.5-.35,track.width*.5+2.25));
  const groundSkinAt=distance=>THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(.095,.035,THREE.MathUtils.smoothstep(distance,track.width*.5,track.width*.5+.4)),
    -.04,THREE.MathUtils.smoothstep(distance,track.width*.5+1.85,track.width*.5+2.35));
  const carSkinAt=distance=>.05-.04*THREE.MathUtils.smoothstep(distance,track.width*.5+1.7,track.width*.5+2.35);
  const center = new THREE.Vector3((b.minX+b.maxX)/2,0,(b.minZ+b.maxZ)/2);
  const worldWidth = b.maxX-b.minX, worldDepth = b.maxZ-b.minZ, worldSpan = Math.max(worldWidth,worldDepth);
  center.y = track.heightAt(center.x, center.z);
  const hemisphere = new THREE.HemisphereLight('#fff2d4', '#434b3f', .9); scene.add(hemisphere);
  const sun = new THREE.DirectionalLight('#ffdaa5', 2.65);
  sun.position.set(center.x - 230, center.y + 230, center.z + 160); sun.target.position.copy(center);
  const shadowSize=Math.min(renderer.capabilities.maxTextureSize,window.innerWidth<760?2048:4096);
  sun.castShadow = true; sun.shadow.autoUpdate=false;sun.shadow.needsUpdate=true; sun.shadow.mapSize.set(shadowSize,shadowSize); sun.shadow.normalBias = .1; sun.shadow.bias = -.00006;
  const shadowHalf = worldSpan * .72;
  Object.assign(sun.shadow.camera,{left:-shadowHalf,right:shadowHalf,top:shadowHalf,bottom:-shadowHalf,near:30,far:1000});
  sun.shadow.camera.updateProjectionMatrix(); scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight('#c6d5ec', .22); fill.position.set(100,150,-250); scene.add(fill);

  const skyTexture=keepTexture(canvasTexture(512,(ctx,size)=>{
    const gradient=ctx.createLinearGradient(0,0,0,size);
    gradient.addColorStop(0,'#7f96af');gradient.addColorStop(.38,palette.sky);gradient.addColorStop(.51,'#edd4b3');gradient.addColorStop(.53,'#827967');gradient.addColorStop(1,'#3e4634');
    ctx.fillStyle=gradient;ctx.fillRect(0,0,size,size);
    for(let i=0;i<26;i++){const x=random()*size,y=45+random()*145;const glow=ctx.createRadialGradient(x,y,0,x,y,36);glow.addColorStop(0,'rgba(255,250,229,.25)');glow.addColorStop(1,'rgba(255,250,229,0)');ctx.fillStyle=glow;ctx.fillRect(x-36,y-36,72,72);}
  }));
  skyTexture.mapping=THREE.EquirectangularReflectionMapping;
  scene.environment=skyTexture;scene.environmentIntensity=.62;scene.background=keepTexture(cloudSkybox(random));scene.backgroundBlurriness=0;scene.backgroundIntensity=.98;
  onProgress(.08, 'Mixing asphalt, earth & tire rubber');
  const asphaltTexture = keepTexture(canvasTexture(512, (ctx,s) => {
    ctx.fillStyle = '#969994'; ctx.fillRect(0,0,s,s);
    for(let i=0;i<47000;i++){const v=90+Math.floor(random()*100);ctx.fillStyle=`rgba(${v},${v},${v},${.1+random()*.2})`;const r=random()*1.8;ctx.fillRect(random()*s,random()*s,r,r);}
    for(let i=0;i<70;i++){ctx.strokeStyle=`rgba(30,33,32,${random()*.045})`;ctx.lineWidth=.5+random();ctx.beginPath();ctx.moveTo(random()*s,0);ctx.lineTo(random()*s,s);ctx.stroke();}
  }));
  asphaltTexture.wrapS = asphaltTexture.wrapT = THREE.RepeatWrapping; asphaltTexture.anisotropy = Math.min(8,renderer.capabilities.getMaxAnisotropy());
  const groundTexture = keepTexture(canvasTexture(512, (ctx,s) => {
    ctx.fillStyle = '#b5b5a7'; ctx.fillRect(0,0,s,s);
    for(let i=0;i<15000;i++){ctx.fillStyle=random()<.5?'rgba(50,49,36,.065)':'rgba(255,250,204,.13)';ctx.beginPath();ctx.ellipse(random()*s,random()*s,random()*4+.3,random()*2+.3,random()*6.3,0,Math.PI*2);ctx.fill();}
    for(let i=0;i<150;i++){ctx.fillStyle=`rgba(240,232,188,${random()*.07})`;ctx.beginPath();ctx.ellipse(random()*s,random()*s,random()*24+5,random()*15+4,random()*6.3,0,Math.PI*2);ctx.fill();}
  }));
  groundTexture.wrapS = groundTexture.wrapT = THREE.RepeatWrapping; groundTexture.repeat.set(1,1); groundTexture.anisotropy = 4;
  const softTexture = keepTexture(canvasTexture(128,(ctx,s)=>{const gradient=ctx.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);gradient.addColorStop(0,'rgba(255,255,255,.8)');gradient.addColorStop(.3,'rgba(255,255,255,.58)');gradient.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,s,s);}));
  await yieldFrame();

  onProgress(.20, 'Sculpting the landscape');
  const resolution = 256, terrainVertices = [], terrainColors = [], terrainUV = [], terrainIndices = [];
  const groundColor = new THREE.Color(palette.ground), lightColor = new THREE.Color(palette.groundLight);
  for(let iz=0;iz<=resolution;iz++) for(let ix=0;ix<=resolution;ix++){
    const x=b.minX+worldWidth*ix/resolution,z=b.minZ+worldDepth*iz/resolution,y=track.heightAt(x,z);
    // The coarse terrain grid is excavated beneath the precise road ribbons.
    // This prevents interpolation at bends and hills from piercing the asphalt.
    const roadDistance=track.nearest(x,z).distance;
    const excavation=terrainCutAt(roadDistance);
    terrainVertices.push(x,y-excavation,z); terrainUV.push(x/18,z/18);
    const variation=clamp(.18 + .16*Math.sin(x*.047+Math.cos(z*.051)*2) + .12*Math.cos(z*.061) + random()*.075 + y*.002,0,.62);
    const region=track.terrainAt?.(x,z);
    const base=region?.surface==='rock' ? new THREE.Color(palette.rock) : region?.surface==='sand' ? new THREE.Color(track.environment==='desert'?'#c6a377':'#cfbd92') : region?.surface==='dirt' ? new THREE.Color('#89724f') : groundColor.clone();
    const c=base.lerp(lightColor,variation*.68); if(region?.forest>.6)c.multiplyScalar(.87); terrainColors.push(c.r,c.g,c.b);
    if(ix<resolution&&iz<resolution){const a=iz*(resolution+1)+ix,c1=a+resolution+1;terrainIndices.push(a,c1,a+1,a+1,c1,c1+1);}
  }
  const terrainGeometry=geometry(customGeometry(terrainVertices,terrainIndices,terrainUV));
  terrainGeometry.setAttribute('color',new THREE.Float32BufferAttribute(terrainColors,3));
  const terrainAtlasUV=[];for(let i=0;i<terrainVertices.length;i+=3)terrainAtlasUV.push((terrainVertices[i]-b.minX)/worldWidth,1-(terrainVertices[i+2]-b.minZ)/worldDepth);
  terrainGeometry.setAttribute('uv1',new THREE.Float32BufferAttribute(terrainAtlasUV,2));
  const terrain=mesh(terrainGeometry,material('#ffffff',{map:groundTexture,bumpMap:groundTexture,bumpScale:.13,vertexColors:true}),staticRoot,false);
  // An unbroken terrain apron continues the exact perimeter of the detailed grid.
  // Continuous rolling ridges replace isolated polygon peaks and visible floor edges.
  const horizonVertices=[],horizonColors=[],horizonUV=[],horizonIndices=[],perimeter=[];
  for(let i=0;i<resolution;i++)perimeter.push({x:b.minX+worldWidth*i/resolution,z:b.minZ});
  for(let i=0;i<resolution;i++)perimeter.push({x:b.maxX,z:b.minZ+worldDepth*i/resolution});
  for(let i=0;i<resolution;i++)perimeter.push({x:b.maxX-worldWidth*i/resolution,z:b.maxZ});
  for(let i=0;i<resolution;i++)perimeter.push({x:b.minX,z:b.maxZ-worldDepth*i/resolution});
  const ringCount=15,perimeterCount=perimeter.length;
  for(let ring=0;ring<=ringCount;ring++)for(let i=0;i<perimeterCount;i++){
    const edge=perimeter[i],expand=1+Math.pow(ring/ringCount,1.6)*4.8;
    const x=center.x+(edge.x-center.x)*expand,z=center.z+(edge.z-center.z)*expand;
    const rolling=Math.sin(x*.007+1.4)*Math.cos(z*.009)*.5+Math.sin(z*.014+x*.004)*.3+Math.sin(x*.023)*Math.cos(z*.019)*.2;
    const rise=track.environment==='mountains'?100:track.environment==='jungle'?46:track.environment==='desert'?31:8;
    const blend=THREE.MathUtils.smoothstep(ring,0,4);
    const y=track.heightAt(x,z)-.04+Math.max(0,rolling+.26)*rise*blend;
    horizonVertices.push(x,y,z);horizonUV.push(x/18,z/18);
    const c=groundColor.clone().lerp(lightColor,.15+rolling*.12);if(track.environment==='mountains')c.lerp(new THREE.Color(palette.rock),blend*.55);
    horizonColors.push(c.r,c.g,c.b);
    if(ring<ringCount){const a=ring*perimeterCount+i,b1=ring*perimeterCount+(i+1)%perimeterCount,c1=a+perimeterCount,d=b1+perimeterCount;horizonIndices.push(a,b1,c1,b1,d,c1);}
  }
  const horizonGeometry=geometry(customGeometry(horizonVertices,horizonIndices,horizonUV));
  horizonGeometry.setAttribute('color',new THREE.Float32BufferAttribute(horizonColors,3));
  const horizonAtlasUV=[];for(let i=0;i<horizonVertices.length;i+=3)horizonAtlasUV.push((horizonVertices[i]-b.minX)/worldWidth,1-(horizonVertices[i+2]-b.minZ)/worldDepth);
  horizonGeometry.setAttribute('uv1',new THREE.Float32BufferAttribute(horizonAtlasUV,2));
  mesh(horizonGeometry,terrain.material,staticRoot,false);

  const soilTextures={};
  for(const kind of ['gravel','dirt','sand']){
    const tex=keepTexture(canvasTexture(512,(ctx,size)=>{
      ctx.fillStyle=kind==='gravel'?'#a6a299':kind==='dirt'?'#b0a18a':'#c8bfaa';ctx.fillRect(0,0,size,size);
      for(let i=0;i<18500;i++){
        const shade=65+random()*170,rad=kind==='gravel'?.4+random()*2.3:.3+random()*1.1;
        ctx.fillStyle=`rgba(${shade},${shade},${shade},${kind==='gravel'?.22+random()*.35:.07+random()*.13})`;
        ctx.beginPath();ctx.ellipse(random()*size,random()*size,rad,rad*.65,random()*6.3,0,6.3);ctx.fill();
      }
      // A pair of worn wheel lines reads as loose road at chase-camera height.
      for(const x of [.34,.65]){
        const gradient=ctx.createLinearGradient((x-.085)*size,0,(x+.085)*size,0);
        gradient.addColorStop(0,'rgba(60,48,31,0)');gradient.addColorStop(.35,'rgba(60,48,31,.11)');gradient.addColorStop(.58,'rgba(60,48,31,.17)');gradient.addColorStop(1,'rgba(60,48,31,0)');
        ctx.fillStyle=gradient;ctx.fillRect((x-.085)*size,0,.17*size,size);
      }
      if(kind==='sand')for(let i=0;i<38;i++){ctx.strokeStyle='rgba(250,234,199,.16)';ctx.lineWidth=.8;ctx.beginPath();const y=i*size/38;for(let x=0;x<=size;x+=8){const yy=y+Math.sin(x*.037+i*.7)*2;x?ctx.lineTo(x,yy):ctx.moveTo(x,yy);}ctx.stroke();}
    }));tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.anisotropy=8;soilTextures[kind]=tex;
  }

  onProgress(.26,'Preparing surface textures & normal maps');
  const roadTextures=await loadRoadTextures(THREE,{keepTexture,renderer,fallbackTextures:{asphalt:asphaltTexture,...soilTextures},onProgress:(value,message)=>onProgress(.26+value*.05,message)});
  const normalStrength={asphalt:.15,gravel:.5,dirt:.3,sand:.18},roadMaterials={};
  for(const kind of ['asphalt','gravel','dirt','sand']){
    const tint=roadTextures.sources?.[kind]==='generated'?'#ffffff':kind==='asphalt'?palette.asphalt:kind==='gravel'?'#a29b86':kind==='dirt'?'#94714c':'#d1b78a';
    roadMaterials[kind]=material(tint,{...roadTextures.materials[kind],normalScale:new THREE.Vector2(normalStrength[kind],normalStrength[kind]),roughness:1,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2});
  }
  terrain.material.normalMap=roadTextures.materials.dirt.normalMap;
  terrain.material.normalScale=new THREE.Vector2(.23,.23);
  terrain.material.roughnessMap=roadTextures.materials.dirt.roughnessMap;
  terrain.material.bumpMap=null;terrain.material.needsUpdate=true;
  onProgress(.315,'Baking terrain creases & contact shadows');
  const terrainAOSize=1024;
  const terrainAO=keepTexture(canvasTexture(terrainAOSize,(ctx,size)=>{
    const coarse=document.createElement('canvas');coarse.width=coarse.height=resolution+1;
    const coarseContext=coarse.getContext('2d'),pixels=coarseContext.createImageData(resolution+1,resolution+1);
    const side=resolution+1;
    const h=(x,z)=>terrainVertices[(clamp(z,0,resolution)*side+clamp(x,0,resolution))*3+1];
    for(let z=0;z<=resolution;z++)for(let x=0;x<=resolution;x++){
      const height=h(x,z);let cavity=0;
      for(const radius of [1,2,4]){
        const neighbours=(h(x-radius,z)+h(x+radius,z)+h(x,z-radius)+h(x,z+radius))*.25;
        cavity+=Math.max(0,neighbours-height)/(radius*1.6);
      }
      const shade=Math.round(255*(1-Math.min(.20,cavity*.14))),i=(z*side+x)*4;
      pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=shade;pixels.data[i+3]=255;
    }
    coarseContext.putImageData(pixels,0,0);ctx.drawImage(coarse,0,0,size,size);
    for(const d of track.decorations){
      const x=(d.x-b.minX)/worldWidth*size,z=(d.z-b.minZ)/worldDepth*size;
      const radius=(d.type==='building'?6.2:d.type==='rock'?2.2:d.type==='tree'?2.0:d.type==='shrub'?1.05:1.15)*(d.scale||1);
      const r=radius/worldWidth*size,opacity=d.type==='rock'?.22:d.type==='building'?.18:.13;
      const gradient=ctx.createRadialGradient(x,z,0,x,z,r);gradient.addColorStop(0,`rgba(12,15,10,${opacity})`);gradient.addColorStop(.42,`rgba(12,15,10,${opacity*.78})`);gradient.addColorStop(1,'rgba(12,15,10,0)');
      ctx.fillStyle=gradient;ctx.fillRect(x-r,z-r,r*2,r*2);
    }
  }));
  terrainAO.colorSpace=THREE.NoColorSpace;terrainAO.channel=1;
  terrainAO.wrapS=terrainAO.wrapT=THREE.ClampToEdgeWrapping;
  terrain.material.aoMap=terrainAO;terrain.material.aoMapIntensity=.72;terrain.material.needsUpdate=true;
  const roadMaterial=roadMaterials.asphalt;
  const shoulderMaterial=material(palette.groundLight,{map:groundTexture});
  const curbWhite=material('#e4daca',{polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-4}),curbRed=material('#c66343',{polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-4});
  const lineMaterial=material('#e3dfb8',{polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-6});
  function ribbon(points, closed, inner, outer, m, lift=.07, segmentFilter=null) {
    const positions=[],indices=[],uvs=[];let distance=0;
    const count=closed?points.length+1:points.length;
    for(let i=0;i<count;i++){
      const p=points[i%points.length],previous=points[(i-1+points.length)%points.length],next=points[(i+1)%points.length];
      const tangent=(!closed&&i===0)?{x:next.x-p.x,z:next.z-p.z}:(!closed&&i===count-1)?{x:p.x-previous.x,z:p.z-previous.z}:{x:next.x-previous.x,z:next.z-previous.z};
      const n=Math.hypot(tangent.x,tangent.z)||1,nx=tangent.z/n,nz=-tangent.x/n;
      if(i>0)distance+=Math.hypot(p.x-previous.x,p.z-previous.z);
      for(const side of [Math.min(inner,outer),Math.max(inner,outer)]){const x=p.x+nx*side,z=p.z+nz*side;positions.push(x,p.y+lift,z);uvs.push((side+track.width*.5)/track.width,distance/14);}
      if(i<count-1&&(!segmentFilter||segmentFilter(distance,i))){const v=i*2;indices.push(v,v+2,v+1,v+1,v+2,v+3);}
    }
    return mesh(geometry(customGeometry(positions,indices,uvs)),m,staticRoot,false);
  }
  const roadSets=[{id:'main',points:track.points,closed:true},...track.routes.map(route=>({...route,closed:false}))];
  // Junction openings are computed once, against the other routes only. Testing
  // both endpoints and the middle of each edge prevents a curb quad from bridging
  // a branch even when its centerline samples straddle the intersection.
  const junctionRadius=track.width*.5+.8,junctionRadiusSquared=junctionRadius*junctionRadius;
  const junctionSegments=roadSets.flatMap(road=>{
    const segments=[];
    for(let i=0;i<road.points.length-(road.closed?0:1);i++){
      const a=road.points[i],b=road.points[(i+1)%road.points.length],dx=b.x-a.x,dz=b.z-a.z;
      segments.push({id:road.id,a,dx,dz,lengthSquared:dx*dx+dz*dz,
        minX:Math.min(a.x,b.x)-junctionRadius,maxX:Math.max(a.x,b.x)+junctionRadius,
        minZ:Math.min(a.z,b.z)-junctionRadius,maxZ:Math.max(a.z,b.z)+junctionRadius});
    }
    return segments;
  });
  function coveredByAnotherRoad(x,z,ownId){
    for(const segment of junctionSegments){
      if(segment.id===ownId||x<segment.minX||x>segment.maxX||z<segment.minZ||z>segment.maxZ)continue;
      const t=clamp(((x-segment.a.x)*segment.dx+(z-segment.a.z)*segment.dz)/(segment.lengthSquared||1),0,1);
      const dx=x-segment.a.x-segment.dx*t,dz=z-segment.a.z-segment.dz*t;
      if(dx*dx+dz*dz<junctionRadiusSquared)return true;
    }
    return false;
  }
  function openSideSegments(road,side){
    const points=road.points;
    const edge=points.map((point,i)=>{
      const previous=points[i===0?(road.closed?points.length-1:0):i-1];
      const next=points[i===points.length-1?(road.closed?0:i):i+1];
      const dx=next.x-previous.x,dz=next.z-previous.z,length=Math.hypot(dx,dz)||1;
      return {x:point.x+dz/length*side*track.width*.5,z:point.z-dx/length*side*track.width*.5};
    });
    return edge.slice(0,edge.length-(road.closed?0:1)).map((a,i)=>{
      const b=edge[(i+1)%edge.length];
      return !coveredByAnotherRoad(a.x,a.z,road.id)
        &&!coveredByAnotherRoad((a.x+b.x)*.5,(a.z+b.z)*.5,road.id)
        &&!coveredByAnotherRoad(b.x,b.z,road.id);
    });
  }
  for(const road of roadSets){
    const surface=(_distance,i)=>track.surfaceAt?.(road.points[i].progress,road.id)||'asphalt';
    for(const [kind,m] of Object.entries(roadMaterials))ribbon(road.points,road.closed,-track.width*.5,track.width*.5,m,.095,(d,i)=>surface(d,i)===kind);
    for(const side of [-1,1]){
      const openSegments=openSideSegments(road,side),open=(_distance,i)=>openSegments[i],paved=(_distance,i)=>openSegments[i]&&surface(_distance,i)==='asphalt';
      // Exterior strips cannot intersect the asphalt when consecutive road
      // cross-sections change slope: no shoulder triangles run beneath it.
      ribbon(road.points,road.closed,side*(track.width*.5+.03),side*(track.width*.5+2.35),shoulderMaterial,.035,open);
      ribbon(road.points,road.closed,side*(track.width*.5-.06),side*(track.width*.5+.72),curbWhite,.12,(distance,i)=>paved(distance,i)&&Math.floor(distance/5)%2===0);
      ribbon(road.points,road.closed,side*(track.width*.5-.06),side*(track.width*.5+.72),curbRed,.121,(distance,i)=>paved(distance,i)&&Math.floor(distance/5)%2===1);
      ribbon(road.points,road.closed,side*(track.width*.5-.42),side*(track.width*.5-.29),lineMaterial,.125,paved);
    }
    ribbon(road.points,road.closed,-.105,.105,lineMaterial,.13,(distance,i)=>surface(distance,i)==='asphalt'&&distance%15<5.5);
  }
  await yieldFrame();

  onProgress(.34,'Preparing scanned rocks & fallen timber');
  const scenery=await loadSceneryModels(THREE,{geometry,material,keepTexture,renderer,onProgress:(value,message)=>onProgress(.34+value*.02,message)});
  const boulderPlacements=[],deadwoodPlacements=[];
  onProgress(.36, 'Planting the world, one detail at a time');
  const box=geometry(new THREE.BoxGeometry(1,1,1)),cylinder=geometry(new THREE.CylinderGeometry(1,1,1,10)),cone=geometry(new THREE.ConeGeometry(1,1,8)),rock=geometry(weatheredRockGeometry()),crown=geometry(new THREE.IcosahedronGeometry(1,2)),roof=geometry(roofGeometry()),palmLeaf=geometry(palmLeafGeometry()),foliagePlane=geometry(new THREE.PlaneGeometry(1,1)),grass=geometry(grassClumpGeometry(random));
  const barkTexture=keepTexture(canvasTexture(256,(ctx,size)=>{
    ctx.fillStyle='#a19680';ctx.fillRect(0,0,size,size);
    for(let i=0;i<480;i++){ctx.strokeStyle=random()<.4?'rgba(42,33,22,.22)':'rgba(231,220,183,.15)';ctx.lineWidth=.5+random()*2;ctx.beginPath();const x=random()*size,y=random()*size;ctx.moveTo(x,y);ctx.lineTo(x+(random()-.5)*8,y+10+random()*100);ctx.stroke();}
  }));barkTexture.wrapS=barkTexture.wrapT=THREE.RepeatWrapping;
  const rockTexture=keepTexture(canvasTexture(256,(ctx,size)=>{
    ctx.fillStyle='#aba99a';ctx.fillRect(0,0,size,size);
    for(let i=0;i<16000;i++){const v=60+random()*170;ctx.fillStyle=`rgba(${v},${v},${v},.2)`;ctx.fillRect(random()*size,random()*size,.5+random()*3,.3+random()*1.5);}
    for(let i=0;i<22;i++){ctx.strokeStyle='rgba(39,42,34,.15)';ctx.lineWidth=random()*1.3;ctx.beginPath();const y=random()*size;ctx.moveTo(0,y);ctx.bezierCurveTo(80,y+random()*15,150,y-random()*15,256,y+10);ctx.stroke();}
  }));rockTexture.wrapS=rockTexture.wrapT=THREE.RepeatWrapping;
  const leavesTexture=keepTexture(leafClusterTexture(random)),pineTexture=keepTexture(leafClusterTexture(random,true));
  const bark=material('#81715c',{map:barkTexture,bumpMap:barkTexture,bumpScale:.12});
  const leaf=material(palette.tree),leafLight=material(palette.leaf),leafPalm=material(palette.leaf,{side:THREE.DoubleSide});
  const foliage=material(track.environment==='jungle'?'#7e9e6b':'#a3ae87',{map:leavesTexture,alphaTest:.48,side:THREE.DoubleSide,roughness:1});
  const foliageDark=material('#7d926b',{map:leavesTexture,alphaTest:.48,side:THREE.DoubleSide,roughness:1});
  const grassFresh=material('#66734b',{side:THREE.DoubleSide,vertexColors:true}),grassDry=material('#a79a6d',{side:THREE.DoubleSide,vertexColors:true}),grassReed=material('#8b945d',{side:THREE.DoubleSide,vertexColors:true});
  const pineFoliage=material('#879c83',{map:pineTexture,alphaTest:.48,side:THREE.DoubleSide,roughness:1});
  const stone=material(palette.rock,{map:rockTexture,bumpMap:rockTexture,bumpScale:.18}),stoneLight=material(palette.rockLight,{map:rockTexture,bumpMap:rockTexture,bumpScale:.16});
  const wallTexture=keepTexture(canvasTexture(256,(ctx,size)=>{
    ctx.fillStyle='#c8c2af';ctx.fillRect(0,0,size,size);
    for(let i=0;i<9000;i++){ctx.fillStyle=random()<.4?'rgba(50,47,34,.08)':'rgba(255,250,223,.16)';ctx.fillRect(random()*size,random()*size,1+random()*2,1+random()*3);}
    const dirt=ctx.createLinearGradient(0,size*.64,0,size);dirt.addColorStop(0,'rgba(63,58,39,0)');dirt.addColorStop(1,'rgba(63,58,39,.3)');ctx.fillStyle=dirt;ctx.fillRect(0,0,size,size);
  }));
  const roofing=keepTexture(canvasTexture(256,(ctx,size)=>{ctx.fillStyle='#b1aaa0';ctx.fillRect(0,0,size,size);for(let i=0;i<32;i++){ctx.fillStyle=i%2?'rgba(225,220,205,.32)':'rgba(34,31,27,.2)';ctx.fillRect(i*8,0,2,size);}for(let i=0;i<1000;i++){ctx.fillStyle='rgba(93,46,26,.13)';ctx.fillRect(random()*size,random()*size,1+random()*3,random()*8);}}));
  const wall=material('#cbb68f',{map:wallTexture,bumpMap:wallTexture,bumpScale:.04}),wallCream=material('#dad6c2',{map:wallTexture,bumpMap:wallTexture,bumpScale:.04}),roofMat=material(track.environment==='mountains'?'#485956':'#8c624c',{map:roofing,metalness:.12,roughness:.83}),trim=material('#c8c1ac'),glass=material('#466263',{roughness:.19,metalness:.45});
  const dark=material('#35403d'),rubber=material('#232c2c'),metal=material('#7b8580',{metalness:.65,roughness:.5}),accent=material(palette.accent);
  const batches=new Map(),transform=new THREE.Object3D(),baseMatrix=new THREE.Matrix4(),partMatrix=new THREE.Matrix4();
  function instance(g,m,x,y,z,sx=1,sy=1,sz=1,rx=0,ry=0,rz=0,parentMatrix=null){
    transform.position.set(x,y,z);transform.scale.set(sx,sy,sz);transform.rotation.set(rx,ry,rz);transform.updateMatrix();partMatrix.copy(transform.matrix);if(parentMatrix)partMatrix.premultiply(parentMatrix);
    const key=`${g.id}/${m.id}`;let batch=batches.get(key);if(!batch){batch={geometry:g,material:m,matrices:[]};batches.set(key,batch);}batch.matrices.push(partMatrix.clone());
  }
  for(const d of track.decorations){
    const decorationRoad=track.nearest(d.x,d.z),foundationCut=terrainCutAt(decorationRoad.distance);
    if(d.type==='rock'){
      const forest=track.terrainAt?.(d.x,d.z)?.forest||0;
      if(scenery.models.deadwood&&forest>.5&&d.scale<.9&&random()<.25){deadwoodPlacements.push({x:d.x,y:d.y-foundationCut-.03,z:d.z,scale:d.scale*4.1,rotation:d.rotation});continue;}
      if(scenery.models.boulder&&d.scale>1.0&&(decorationRoad.distance<45||(decorationRoad.distance<85&&random()<.45))){boulderPlacements.push({x:d.x,y:d.y-foundationCut-d.scale*.12,z:d.z,scale:d.scale*4.1,rotation:d.rotation});continue;}
    }
    transform.position.set(d.x,d.y-foundationCut,d.z);transform.rotation.set(0,d.rotation||0,0);const s=Number(d.scale)||1;transform.scale.setScalar(s);transform.updateMatrix();baseMatrix.copy(transform.matrix);
    const part=(g,m,x,y,z,sx,sy,sz,rx=0,ry=0,rz=0)=>instance(g,m,x,y,z,sx,sy,sz,rx,ry,rz,baseMatrix);
    switch(d.type){
      case 'tree':{
        const tall=track.environment==='mountains',trunkHeight=tall?8.2:6.5;
        part(cylinder,bark,0,trunkHeight*.5,0,.23,trunkHeight,.26,0,0,.025);
        if(tall){
          // Layered, needle-edged branches replace solid conical crowns.
          for(let j=0;j<4;j++)part(foliagePlane,pineFoliage,0,5.6,0,6.4,9.8,1,0,j*Math.PI/4,0);
          for(let j=0;j<4;j++){
            const a=j*2.39;part(cylinder,bark,Math.sin(a)*.65,3.3+j*.75,Math.cos(a)*.65,.07,2.2,.07,Math.cos(a)*1.05,0,-Math.sin(a)*1.05);
          }
        }else{
          for(let j=0;j<7;j++){
            const a=j*2.4,r=j===0?0:1.2+random()*1.1,cx=Math.cos(a)*r,cz=Math.sin(a)*r,cy=5.1+random()*2.1;
            if(j>0)part(cylinder,bark,cx*.48,4.4,cz*.48,.12,3.5,.12,Math.cos(a)*.62,0,-Math.sin(a)*.62);
            for(let k=0;k<3;k++)part(foliagePlane,j%3?foliage:foliageDark,cx,cy,cz,4.7,4.5,1,k===2?Math.PI/2:0,a+k*Math.PI/2,0);
          }
        }break;
      }
      case 'palm':{
        part(cylinder,bark,0,2.4,0,.27,4.8,.27,0,0,-.10);
        part(cylinder,bark,.32,5.3,0,.22,2.3,.22,0,0,-.22);
        part(crown,leaf,.7,6.45,0,.8,.45,.8);
        for(let j=0;j<8;j++)part(palmLeaf,j%2?leafPalm:leaf,.7,6.45,0,1.2+(j%3)*.1,1.1,1.2,0,j*Math.PI/4,0);
        for(let j=0;j<3;j++)part(rock,bark,.7+Math.cos(j*2)*.35,6.12,Math.sin(j*2)*.35,.22,.26,.22);
        break;
      }
      case 'cactus':{
        part(cylinder,leafLight,0,2.25,0,.46,4.5,.46);part(crown,leafLight,0,4.48,0,.46,.46,.46);
        for(const side of [-1,1]){const h=side<0?2.6:1.6;part(cylinder,leafLight,side*.62,h,0,.29,1.25,.29,0,0,Math.PI/2);part(cylinder,leafLight,side*1.18,h+.55,0,.3,1.4,.3);part(crown,leafLight,side*1.18,h+1.25,0,.3,.3,.3);}
        break;
      }
      case 'building':{
        const height=4.4+random()*1.4;
        part(box,random()<.45?wallCream:wall,0,height/2,0,8,height,6);
        part(roof,roofMat,0,height,0,4.55,2.25,3.6);
        part(box,trim,0,.18,0,8.5,.35,6.5);
        for(const side of [-1,1])for(const x of [-2.25,2.25]){part(box,trim,x,2.9,side*3.035,1.68,1.6,.12);part(box,glass,x,2.9,side*3.105,1.34,1.32,.03);part(box,trim,x,2.9,side*3.14,.08,1.35,.035);}
        part(box,dark,0,1.3,3.06,1.4,2.55,.1);
        part(box,metal,-2.5,height+1.1,-.65,.55,2,.65);
        part(box,wall,-2.5,height+2.12,-.65,.8,.2,.9);
        part(box,roofMat,0,3.02,4.1,4.4,.18,2.2,0,0,.02);
        for(const x of [-2,2])part(cylinder,bark,x,1.5,5.02,.1,3,.1);
        // Local variations: timber shutters, service crates and slatted boundary fencing.
        if(random()<.58)for(const x of [-2.25,2.25])for(const side of [-1,1])part(box,bark,x+side*.98,2.9,3.08,.4,1.5,.09,0,side*.14,0);
        for(let j=0;j<3;j++){part(box,bark,5.8+j*1.8,.7,4.3,.15,1.4,.15);if(j<2)for(const y of [.44,.99])part(box,bark,6.7+j*1.8,y,4.3,1.8,.12,.1);}
        part(box,bark,-4.8,.45,-2.3,.92,.9,.92);part(box,metal,-4.8,.9,-2.3,.96,.05,.97);
        break;
      }
      case 'shrub':{
        for(let j=0;j<3;j++)part(foliagePlane,j%2?foliage:foliageDark,0,.9,0,2.8,2.3,1,j===2?.9:0,j*Math.PI/3,0);break;
      }
      case 'rock':default:{
        part(rock,random()<.4?stoneLight:stone,0,.8,0,2.1,1.45+random(),1.6,random()*.5,random()*6.28,random()*.45);
        if(random()<.6)part(rock,stoneLight,1.8,.4,.8,.75,.75,.8,.3,1,.2);break;
      }
    }
  }
  // Little roadside stones and dried grass break up the large terrain triangles.
  const scatterCount=track.environment==='jungle'?900:600;
  for(let i=0;i<scatterCount;i++){
    const x=b.minX+random()*worldWidth,z=b.minZ+random()*worldDepth;
    const n=track.nearest(x,z);if(n.distance<track.width*.5+2.5)continue;
    const y=track.heightAt(x,z)-terrainCutAt(n.distance),s=.12+random()*.45;
    const water=track.riverAt?.(x,z);if((track.environment==='beach'&&y<-.1)||(water&&y<water.y+.12))continue;
    if(random()<.67)instance(rock,stoneLight,x,y+s*.23,z,s,s*.48,s*.8,random(),random()*6.3,0);
    else {instance(foliagePlane,foliageDark,x,y+s*.6,z,s*2,s*1.4,1,0,random()*6.3,0);instance(foliagePlane,foliage,x,y+s*.6,z,s*2,s*1.4,1,0,random()*6.3,0);}
  }

  // Individual bent blades supply close-range detail without alpha overdraw.
  let grassClumps=0;
  const grassAttempts=track.environment==='desert'?800:3400;
  for(let i=0;i<grassAttempts;i++){
    let x,z;
    if(i<1100&&track.environment!=='desert'){
      const p=track.points[Math.floor(random()*track.points.length)],n=track.sample(p.progress),side=random()<.5?-1:1,offset=track.width*.5+2.2+random()*12;
      x=p.x+n.tangent.z*offset*side;z=p.z-n.tangent.x*offset*side;
    }else{x=b.minX+random()*worldWidth;z=b.minZ+random()*worldDepth;}
    const nearby=track.nearest(x,z),region=track.terrainAt?.(x,z),water=track.riverAt?.(x,z);
    if(nearby.distance<track.width*.5+1.6||region?.surface==='rock'||(region?.surface==='sand'&&random()<.82))continue;
    const y=track.heightAt(x,z)-terrainCutAt(nearby.distance);
    if((track.environment==='beach'&&y<0)||(water&&y<water.y+.12))continue;
    const reed=region?.moisture>.5,scale=.35+random()*.6;
    instance(grass,reed?grassReed:region?.surface==='dirt'||track.environment==='desert'?grassDry:grassFresh,x,y,z,scale,reed?scale*1.65:scale*.65,scale,0,random()*6.3,0);grassClumps++;
  }

  // Roadside drainage stones, guide posts and timber fence runs follow the terrain.
  for(let i=6;i<track.points.length;i+=7){
    const p=track.points[i],next=track.points[(i+1)%track.points.length],dx=next.x-p.x,dz=next.z-p.z,n=Math.hypot(dx,dz)||1;
    for(const side of [-1,1]){
      const offset=track.width*.5+2.65,x=p.x+dz/n*offset*side,z=p.z-dx/n*offset*side;
      if(track.nearest(x,z).distance<track.width*.5+1.6)continue;
      const y=track.heightAt(x,z)-.12;
      if(i%14===6){instance(box,trim,x,y+.68,z,.17,1.38,.17,0,Math.atan2(dx,dz),0);instance(box,dark,x,y+1.06,z,.19,.31,.19,0,Math.atan2(dx,dz),0);}
      for(let j=0;j<3;j++)instance(rock,stoneLight,x+(random()-.5)*2,y+.08,z+(random()-.5)*2,.14+random()*.25,.09+random()*.15,.18+random()*.23,0,random()*6,0);
    }
  }

  const movingWater=[],waterClock={value:0};
  if(track.river?.points?.length>1){
    const waterNormal=keepTexture(canvasTexture(256,(ctx,size)=>{
      const image=ctx.createImageData(size,size);
      for(let y=0;y<size;y++)for(let x=0;x<size;x++){
        const a=x/size*Math.PI*2,b=y/size*Math.PI*2;
        const dx=Math.cos(a*7+b*2)*.075+Math.cos(a*13-b*9)*.026+Math.sin(a*23+b*17)*.018,dy=Math.cos(a*7+b*2)*.032-Math.cos(a*13-b*9)*.025+Math.sin(a*19+b*13)*.014;
        const i=(y*size+x)*4;image.data[i]=128+dx*127;image.data[i+1]=128+dy*127;image.data[i+2]=250;image.data[i+3]=255;
      }ctx.putImageData(image,0,0);
    }));waterNormal.colorSpace=THREE.NoColorSpace;waterNormal.wrapS=waterNormal.wrapT=THREE.RepeatWrapping;waterNormal.repeat.set(2.4,4.2);
    const waterMaterial=material(track.environment==='desert'?'#668b81':'#477f7c',{normalMap:waterNormal,normalScale:new THREE.Vector2(.38,.38),roughness:.19,metalness:.42,envMapIntensity:1.45,transparent:true,opacity:.91});
    waterMaterial.onBeforeCompile=shader=>{
      shader.uniforms.uRiverTime=waterClock;
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform float uRiverTime;').replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed.y += sin(position.x * 0.27 + position.z * 0.19 - uRiverTime * 1.35) * 0.032 + sin(position.x * 0.12 - position.z * 0.23 + uRiverTime * 0.8) * 0.019;');
    };
    waterMaterial.customProgramCacheKey=()=> 'razer-river-waves-v1';
    const positions=[],indices=[],uvs=[],foamPositions=[],foamIndices=[],foamUV=[],riverPoints=track.river.points;let along=0;
    for(let i=0;i<riverPoints.length;i++){
      const p=riverPoints[i],before=riverPoints[Math.max(0,i-1)],after=riverPoints[Math.min(riverPoints.length-1,i+1)],dx=after.x-before.x,dz=after.z-before.z,n=Math.hypot(dx,dz)||1;
      if(i)along+=Math.hypot(p.x-before.x,p.z-before.z);
      const half=(p.width||track.river.width||15)*.5;
      for(let side=0;side<=6;side++){
        const offset=(side/6*2-1)*half;positions.push(p.x+dz/n*offset,p.y+.035,p.z-dx/n*offset);uvs.push(side/6*half/4,along/10);
        if(i<riverPoints.length-1&&side<6){const a=i*7+side;indices.push(a,a+7,a+1,a+1,a+7,a+8);}
      }
      for(const side of [-1,1]){
        const width=.32+Math.sin(i*.73)*.13;
        for(const edge of [half-width,half+.03]){foamPositions.push(p.x+dz/n*edge*side,p.y+.074,p.z-dx/n*edge*side);foamUV.push(edge===half-width?0:1,along/5);}
        if(i<riverPoints.length-1){const a=i*4+(side===-1?0:2);foamIndices.push(a,a+4,a+1,a+1,a+4,a+5);}
      }
      if(i%3===0)for(const side of [-1,1]){
        const x=p.x+dz/n*half*side*1.12,z=p.z-dx/n*half*side*1.12,y=track.heightAt(x,z);
        if(track.nearest(x,z).distance>track.width*.5+1.5){
          instance(rock,stoneLight,x,y+.08,z,.6+random(),.3+random()*.55,.5+random(),0,random()*6.3,0);
          if(track.environment!=='desert')for(let j=0;j<2;j++)instance(foliagePlane,foliageDark,x+(random()-.5)*2,y+.7,z+(random()-.5)*2,1.4,1.8,1,0,j*Math.PI/2,0);
        }
      }
    }
    mesh(geometry(customGeometry(positions,indices,uvs)),waterMaterial,staticRoot,false);movingWater.push(waterNormal);
    const foamTexture=keepTexture(canvasTexture(256,(ctx,size)=>{
      for(let i=0;i<410;i++){const x=random()*size,y=random()*size;ctx.strokeStyle=`rgba(233,240,221,${.12+random()*.48})`;ctx.lineWidth=.4+random()*1.8;ctx.beginPath();ctx.ellipse(x,y,1+random()*5,1+random()*2,random()*6.3,0,6.3);ctx.stroke();}
    }));foamTexture.wrapS=foamTexture.wrapT=THREE.RepeatWrapping;
    const foamMaterial=new THREE.MeshBasicMaterial({map:foamTexture,color:'#e1e9d8',transparent:true,opacity:.40,depthWrite:false,side:THREE.DoubleSide});materials.add(foamMaterial);
    mesh(geometry(customGeometry(foamPositions,foamIndices,foamUV)),foamMaterial,staticRoot,false);movingWater.push(foamTexture);
    if(track.environment==='beach'){
      const oceanGeometry=geometry(new THREE.PlaneGeometry(worldSpan*9,worldSpan*9));
      const oceanUV=oceanGeometry.attributes.uv;for(let i=0;i<oceanUV.count;i++)oceanUV.setXY(i,oceanUV.getX(i)*worldSpan*.8,oceanUV.getY(i)*worldSpan*.8);
      const ocean=mesh(oceanGeometry,waterMaterial,staticRoot,false);ocean.rotation.x=-Math.PI/2;ocean.position.set(center.x,-.46,center.z);
    }
  }
  // The starting village and rally infrastructure are anchored to the circuit.
  const start=track.sample(0),startYaw=Math.atan2(start.tangent.x,start.tangent.z);
  transform.position.set(start.x,start.y,start.z);transform.rotation.set(0,startYaw,0);transform.scale.setScalar(1);transform.updateMatrix();baseMatrix.copy(transform.matrix);
  const startPart=(g,m,x,y,z,sx,sy,sz,rx=0,ry=0,rz=0)=>instance(g,m,x,y,z,sx,sy,sz,rx,ry,rz,baseMatrix);
  for(const side of [-1,1]){
    startPart(box,dark,side*(track.width/2+2),3.5,0,.36,7,.36);
    startPart(box,accent,side*(track.width/2+2),.3,0,.95,1.9,.95);
    startPart(box,metal,side*(track.width/2+2),3.5,1.1,.16,7,.16);
    for(let j=0;j<5;j++)startPart(box,metal,side*(track.width/2+2),.8+j*1.3,.55,.13,1.65,.13,.65,0,0);
    for(let row=0;row<9;row++){
      const z=-8-row*3.3;
      startPart(cylinder,rubber,side*(track.width/2+2.25),.38,z,.66,.76,.66);
      startPart(cylinder,row%3===0?trim:rubber,side*(track.width/2+2.25),1.02,z,.66,.55,.66);
      if(row%3===0)startPart(box,trim,side*(track.width/2+3.3),1.25,z,.16,2.5,.16);
    }
    startPart(box,dark,side*(track.width/2+3.3),1.6,-21,.12,.16,27);
    startPart(box,trim,side*(track.width/2+3.3),.8,-21,.12,.12,27);
  }
  startPart(box,metal,0,7.05,.55,track.width+4.4,.22,1.5);
  const bannerTex=keepTexture(textTexture('R A Z E R','#f1eee3','#222b29',2048,256));
  const banner=mesh(geometry(new THREE.PlaneGeometry(track.width+3.5,1.65)),material('#ffffff',{map:bannerTex,roughness:.9,side:THREE.FrontSide}));
  banner.position.set(start.x,start.y+5.95,start.z);banner.rotation.y=startYaw;banner.translateZ(.12);
  const bannerBack=mesh(banner.geometry,banner.material);bannerBack.position.copy(banner.position);bannerBack.rotation.y=startYaw+Math.PI;bannerBack.translateZ(.24);
  for(let row=0;row<2;row++)for(let col=0;col<12;col++)startPart(box,(row+col)%2?dark:trim,-track.width/2+(col+.5)*track.width/12,.18,(row-.5)*.85,track.width/12,.025,.85);
  for(let row=0;row<3;row++)for(let side=-1;side<=1;side+=2){
    const distance=9+row*6.6,p=track.sample(1-distance/track.length),yaw=Math.atan2(p.tangent.x,p.tangent.z),right={x:p.tangent.z,z:-p.tangent.x};
    instance(box,lineMaterial,p.x+right.x*side*2.15,p.y+.18,p.z+right.z*side*2.15,2.5,.026,.14,0,yaw,0);
  }
  scenery.instantiate('boulder',boulderPlacements,staticRoot);
  scenery.instantiate('deadwood',deadwoodPlacements,staticRoot);
  for(const batch of batches.values()){
    const instanced=new THREE.InstancedMesh(batch.geometry,batch.material,batch.matrices.length);
    batch.matrices.forEach((matrix,index)=>instanced.setMatrixAt(index,matrix));instanced.instanceMatrix.needsUpdate=true;instanced.castShadow=true;instanced.receiveShadow=true;instanced.computeBoundingSphere();staticRoot.add(instanced);
  }
  await yieldFrame();

  onProgress(.57, 'Detailing the rally cars & turbo pads');
  const boosts=[];
  const boostTexture=keepTexture(canvasTexture(256,(ctx,s)=>{
    ctx.fillStyle='#283d36';ctx.fillRect(0,0,s,s);ctx.fillStyle='#f5d762';ctx.fillRect(0,0,9,s);ctx.fillRect(s-9,0,9,s);
    ctx.strokeStyle='#f5da65';ctx.lineWidth=18;ctx.lineJoin='miter';
    for(let y=45;y<240;y+=70){ctx.beginPath();ctx.moveTo(51,y+28);ctx.lineTo(128,y-18);ctx.lineTo(205,y+28);ctx.stroke();}
  }));
  const padMaterial=material('#ffffff',{map:boostTexture,emissive:'#d5b840',emissiveMap:boostTexture,emissiveIntensity:.38,roughness:.7});
  const glowMaterial=new THREE.MeshBasicMaterial({map:softTexture,color:'#ffdc4e',transparent:true,opacity:.28,depthWrite:false,blending:THREE.AdditiveBlending});materials.add(glowMaterial);
  const plane=geometry(new THREE.PlaneGeometry(1,1));
  const groundShadowRotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2);
  const padTurn=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI);
  for(const boost of track.boosts){
    const n=track.sample(boost.progress,boost.routeId),yaw=Math.atan2(n.tangent.x,n.tangent.z);
    const slope=Math.atan2(track.heightAt(boost.x+n.tangent.x*2,boost.z+n.tangent.z*2)-track.heightAt(boost.x-n.tangent.x*2,boost.z-n.tangent.z*2),4);
    const roadOrientation=new THREE.Quaternion().setFromEuler(new THREE.Euler(-slope,yaw,0,'YXZ'));
    const individualPadMaterial=padMaterial.clone();materials.add(individualPadMaterial);
    const pad=mesh(geometry(new THREE.PlaneGeometry(3.6,6.5)),individualPadMaterial,staticRoot,false);pad.quaternion.copy(roadOrientation).multiply(groundShadowRotation).multiply(padTurn);pad.position.set(boost.x,boost.y+.21,boost.z);
    const glow=mesh(plane,glowMaterial,scene,false);glow.quaternion.copy(roadOrientation).multiply(groundShadowRotation);glow.scale.set(8,10,1);glow.position.set(boost.x,boost.y+.23,boost.z);boosts.push({glow,pad,active:true,phase:random()*6.3});
    const pylons=new THREE.Group();pylons.position.set(boost.x,boost.y,boost.z);pylons.rotation.y=yaw;
    for(const side of [-1,1]){const post=mesh(cylinder,accent,pylons,false);post.position.set(side*2.1,.38,0);post.scale.set(.12,.65,.12);}
    scene.add(pylons);
  }
  const carRoot=new THREE.Group();scene.add(carRoot);
  const carViews=[],wheelLocalPoint=new THREE.Vector3(),wheelAxle=new THREE.Vector3(),bodyOriginOffset=new THREE.Vector3(),inverseCarOrientation=new THREE.Quaternion();
  function createCar(index){
    const {root,body,wheels,paint,brakeMaterial}=createRallyCar(THREE,{index,geometry,material,keepTexture});
    carRoot.add(root);
    const shadowMaterial=new THREE.MeshBasicMaterial({map:softTexture,color:'#162328',transparent:true,opacity:.63,depthWrite:false});materials.add(shadowMaterial);
    const shadow=mesh(plane,shadowMaterial,scene,false);shadow.rotation.x=-Math.PI/2;shadow.scale.set(3.8,6.4,1);
    const markerMaterial=new THREE.MeshBasicMaterial({color:'#f9e1a2',transparent:true,opacity:.84,depthWrite:false});materials.add(markerMaterial);
    const marker=mesh(geometry(customGeometry([-.6,0,-.4,.6,0,-.4,0,0,.65],[0,2,1])),markerMaterial,root,false);marker.position.set(0,.06,3.6);marker.visible=index===0;
    const turboGlow=mesh(plane,glowMaterial,root,false);turboGlow.rotation.x=-Math.PI/2;turboGlow.position.set(0,.15,-3);turboGlow.scale.set(3.8,6.2,1);turboGlow.visible=false;
    carViews.push({root,body,wheels,paint,brakeMaterial,shadow,marker,turboGlow,lastX:NaN,lastZ:NaN,lastYaw:0,color:null,dustClock:0});
  }
  for(let i=0;i<6;i++)createCar(i);

  // All generated worlds currently use daylight. Vehicle lamps do not add
  // light or shadow passes; brake lenses and turbo feedback remain emissive.
  // Recycled skid geometry and instanced dust keep costs fixed for long races.
  const skidCapacity=420,skidPositions=new Float32Array(skidCapacity*18),skidGeometry=geometry(new THREE.BufferGeometry());
  skidGeometry.setAttribute('position',new THREE.BufferAttribute(skidPositions,3).setUsage(THREE.DynamicDrawUsage));skidGeometry.setDrawRange(0,0);
  const skidMaterial=new THREE.MeshBasicMaterial({color:'#182024',transparent:true,opacity:.28,depthWrite:false,side:THREE.DoubleSide});materials.add(skidMaterial);
  const skidMesh=mesh(skidGeometry,skidMaterial,scene,false);skidMesh.frustumCulled=false;
  let skidCursor=0,skidCount=0;
  function skid(x1,z1,x2,z2,side,y){
    const dx=x2-x1,dz=z2-z1,length=Math.hypot(dx,dz);if(length<.02||length>7)return;
    const nx=dz/length,nz=-dx/length,offset=side*.87,half=.17;
    const a=[x1+nx*(offset-half),y,z1+nz*(offset-half)],bb=[x1+nx*(offset+half),y,z1+nz*(offset+half)],c=[x2+nx*(offset-half),y,z2+nz*(offset-half)],d=[x2+nx*(offset+half),y,z2+nz*(offset+half)];
    skidPositions.set([...a,...c,...bb,...bb,...c,...d],skidCursor*18);skidCursor=(skidCursor+1)%skidCapacity;skidCount=Math.min(skidCapacity,skidCount+1);
    skidGeometry.setDrawRange(0,skidCount*6);skidGeometry.attributes.position.needsUpdate=true;
  }
  const particleCapacity=140,particleState=Array.from({length:particleCapacity},()=>({life:0,x:0,y:0,z:0,vx:0,vz:0,size:1,total:1}));let particleCursor=0;
  const particleOpacity=new THREE.InstancedBufferAttribute(new Float32Array(particleCapacity),1).setUsage(THREE.DynamicDrawUsage);
  const particleGeometry=geometry(new THREE.PlaneGeometry(1,1));particleGeometry.setAttribute('instanceOpacity',particleOpacity);
  const particleMaterial=new THREE.MeshBasicMaterial({map:softTexture,color:palette.groundLight,transparent:true,opacity:.38,depthWrite:false});materials.add(particleMaterial);
  particleMaterial.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float instanceOpacity;\nvarying float vParticleOpacity;').replace('#include <begin_vertex>','#include <begin_vertex>\nvParticleOpacity = instanceOpacity;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float vParticleOpacity;').replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.a *= vParticleOpacity;');
  };
  const particles=new THREE.InstancedMesh(particleGeometry,particleMaterial,particleCapacity);particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);particles.frustumCulled=false;scene.add(particles);
  for(let i=0;i<particleCapacity;i++){transform.position.set(0,-100,0);transform.scale.setScalar(0);transform.updateMatrix();particles.setMatrixAt(i,transform.matrix);}
  function emitDust(car){const p=particleState[particleCursor];particleCursor=(particleCursor+1)%particleCapacity;Object.assign(p,{life:.7+random()*.5,total:1.2,x:car.x-Math.sin(car.yaw)*1.8+(random()-.5),y:car.y+.4,z:car.z-Math.cos(car.yaw)*1.8+(random()-.5),vx:-car.vx*.09+(random()-.5)*2,vz:-car.vz*.09+(random()-.5)*2,size:.6+random()*.8});}
  const visibleRoadPoints=roadSets.flatMap(road=>road.points);
  const circuitX=Math.max(...visibleRoadPoints.map(p=>p.x))-Math.min(...visibleRoadPoints.map(p=>p.x));
  const circuitZ=Math.max(...visibleRoadPoints.map(p=>p.z))-Math.min(...visibleRoadPoints.map(p=>p.z));
  const cameraTarget=center.clone(),desiredTarget=center.clone(),cameraPosition=new THREE.Vector3(),desiredPosition=new THREE.Vector3(),tempVector=new THREE.Vector3();
  const chaseCamera=createChaseCamera(track);let chaseInitialized=false;
  function resize(){
    width=Math.max(1,canvas.clientWidth||window.innerWidth);height=Math.max(1,canvas.clientHeight||window.innerHeight);
    renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();lastMode='';
  }
  resize();
  function updateCamera(dt,sim,mode,style){
    const preview=mode==='preview';
    if(preview){
      const start=track.sample(0),forward=start.tangent,right={x:forward.z,z:-forward.x};
      desiredTarget.set(start.x+forward.x*10,start.y+1.5,start.z+forward.z*10);
      desiredPosition.set(start.x-forward.x*56+right.x*23,start.y+24,start.z-forward.z*56+right.z*23);
      desiredPosition.y=Math.max(desiredPosition.y,track.heightAt(desiredPosition.x,desiredPosition.z)+9);
    }else if(sim?.player){
      if(!chaseInitialized||lastMode==='preview'){chaseCamera.reset(sim.player,style==='wide');chaseInitialized=true;}
      const state=chaseCamera.step(dt,sim.player,style==='wide');
      desiredTarget.set(state.target.x,state.target.y,state.target.z);
      desiredPosition.set(state.position.x,state.position.y,state.position.z);
    }else{desiredTarget.copy(center);desiredPosition.copy(center).add(tempVector.set(20,110,80));}
    if(lastMode!==mode){cameraTarget.copy(desiredTarget);cameraPosition.copy(desiredPosition);if(preview&&width>820)camera.setViewOffset(width,height,-width*.12,0,width,height);else camera.clearViewOffset();lastMode=mode;}
    else if(preview){const smoothing=1-Math.exp(-dt*1.5);cameraTarget.lerp(desiredTarget,smoothing);cameraPosition.lerp(desiredPosition,smoothing);}
    else{cameraTarget.copy(desiredTarget);cameraPosition.copy(desiredPosition);}
    camera.position.copy(cameraPosition);camera.lookAt(cameraTarget);
  }
  function render(dt,sim,{mode='race',time=0,camera:cameraStyle='follow'}={}){
    if(disposed)return;dt=clamp(dt||0,0,.1);elapsed+=dt;renderedFrames++;
    waterClock.value=elapsed;
    for(const texture of movingWater){texture.offset.y=-elapsed*.035;texture.offset.x=elapsed*.009;}
    updateCamera(dt,sim,mode,cameraStyle);
    const active=mode==='race',states=sim?.cars;
    for(let i=0;i<carViews.length;i++){
      const view=carViews[i],car=states?.[i];if(!car){view.root.visible=false;view.shadow.visible=false;continue;}
      const nearestRoad=track.nearest(car.x,car.z),onRoad=nearestRoad.distance<track.width/2+1.7,onPavement=onRoad&&(track.surfaceAt?.(nearestRoad.progress,nearestRoad.routeId)||'asphalt')==='asphalt';
      const groundSkin=groundSkinAt(nearestRoad.distance),carSkin=carSkinAt(nearestRoad.distance);
      view.root.visible=view.shadow.visible=true;
      if(car.color&&car.color!==view.color){view.paint.color.set(car.color);view.color=car.color;}
      const sx=Math.sin(car.yaw)*1.25,sz=Math.cos(car.yaw)*1.25;
      const groundPitch=clamp(Math.atan2(track.heightAt(car.x+sx,car.z+sz)-track.heightAt(car.x-sx,car.z-sz),2.5),-.42,.42);
      const pitch=Number.isFinite(car.pitch)?car.pitch:groundPitch;
      view.root.rotation.set(-pitch,car.yaw,Number.isFinite(car.roll)?car.roll:0,'YXZ');
      // The model's ground origin is offset from Rapier's chassis origin in
      // LOCAL up, so banking cannot slide the visible shell off its collider.
      bodyOriginOffset.set(0,PHYSICS.rideHeight,0).applyQuaternion(view.root.quaternion);
      view.root.position.set(car.x-bodyOriginOffset.x,car.y+PHYSICS.rideHeight-bodyOriginOffset.y+carSkin,car.z-bodyOriginOffset.z);
      // Rapier owns chassis pitch, banking and heave. A second cosmetic lean
      // would counteract the actual tire loads and make a planted car look loose.
      view.body.rotation.set(0,0,0);view.body.position.y=0;
      inverseCarOrientation.copy(view.root.quaternion).invert();
      for(const wheel of view.wheels){
        const side=wheel.pivot.position.x<0?'left':'right',wheelState=car.wheels?.find(state=>state.id===`${wheel.front?'front':'rear'}-${side}`);
        wheel.pivot.rotation.y=wheelState?.steer??(wheel.front?(car.steer||0)*.42:0);
        if(wheelState){
          let wheelY=.25;
          if(wheelState.contact){
            // Model and suspension wheelbases differ slightly. Ground the visible
            // tire at its own current X/Z instead of an older physics sample.
            wheelLocalPoint.copy(wheel.pivot.position).applyQuaternion(view.root.quaternion).add(view.root.position);
            const wheelRoad=track.nearest(wheelLocalPoint.x,wheelLocalPoint.z);
            wheelAxle.set(1,0,0).applyQuaternion(wheel.pivot.quaternion).applyQuaternion(view.root.quaternion);
            const radiusY=(wheel.radius||.37)*Math.sqrt(Math.max(0,1-wheelAxle.y*wheelAxle.y));
            wheelLocalPoint.y=track.heightAt(wheelLocalPoint.x,wheelLocalPoint.z)+groundSkinAt(wheelRoad.distance)+radiusY;
            wheelLocalPoint.sub(view.root.position).applyQuaternion(inverseCarOrientation);wheelY=clamp(wheelLocalPoint.y,.10,.72);
          }
          wheel.pivot.position.y=THREE.MathUtils.lerp(wheel.pivot.position.y,wheelY,1-Math.exp(-dt*28));
        }
        wheel.tire.rotation.x+=car.speed*dt/(wheel.radius||.37);wheel.rim.rotation.x=wheel.tire.rotation.x;
      }
      const groundY=track.heightAt(car.x,car.z),jumpHeight=Math.max(0,car.y-groundY);
      view.shadow.position.set(car.x,groundY+groundSkin+.035,car.z);
      view.shadow.quaternion.setFromEuler(new THREE.Euler(-groundPitch,car.yaw,0,'YXZ')).multiply(groundShadowRotation);
      view.shadow.scale.set(3.8+jumpHeight*.4,6.4+jumpHeight*.4,1);view.shadow.material.opacity=.63/(1+jumpHeight*.22);
      view.marker.visible=false;
      if(view.brakeMaterial)view.brakeMaterial.emissiveIntensity=(car._lastInput?.brake||0)>.1?2.4:.3;
      view.turboGlow.visible=car.boost>0;view.turboGlow.scale.y=5.5+Math.sin(elapsed*32)*.7;
      const moved=Math.hypot(car.x-view.lastX,car.z-view.lastZ),slipping=car.drift||Math.abs(car.steer||0)>.65&&Math.abs(car.speed)>18;
      if(active&&moved>.5){
        if(car.wheels){
          for(let j=0;j<car.wheels.length;j++){const wheel=car.wheels[j],previous=view.previousWheels?.[j];if(previous&&wheel.contact&&wheel.surface==='asphalt'&&(car.drift||Math.abs(wheel.slip)>2.4))skid(previous.x,previous.z,wheel.x,wheel.z,0,wheel.y+.16);}
        }else if(slipping&&onPavement&&!car.airborne){skid(view.lastX,view.lastZ,car.x,car.z,-1,car.y+.16);skid(view.lastX,view.lastZ,car.x,car.z,1,car.y+.16);}
        view.previousWheels=car.wheels?.map(w=>({x:w.x,z:w.z}));view.lastX=car.x;view.lastZ=car.z;
      }
      if(!Number.isFinite(view.lastX)||!active||moved>8){view.lastX=car.x;view.lastZ=car.z;view.previousWheels=car.wheels?.map(w=>({x:w.x,z:w.z}));}
      if(active&&view.wasAirborne&&!car.airborne){emitDust(car);emitDust(car);}
      view.wasAirborne=!!car.airborne;
      view.dustClock+=dt;
      if(active&&!car.airborne&&Math.abs(car.speed)>8&&view.dustClock>.065&&(slipping||car.boost>0||!onPavement)){emitDust(car);view.dustClock=0;}
    }
    for(let i=0;i<boosts.length;i++){const boost=boosts[i],available=sim?.pickups?.[i]?.active!==false;const pulse=.88+Math.sin(elapsed*3+boost.phase)*.12;boost.glow.scale.set(8*pulse,10*pulse,1);boost.glow.visible=available;if(boost.active!==available){boost.pad.material.emissiveIntensity=available ? .38 : .02;boost.pad.material.color.set(available?'#ffffff':'#687565');boost.active=available;}}
    for(let i=0;i<particleCapacity;i++){
      const p=particleState[i];p.life=Math.max(0,p.life-dt);
      if(p.life>0){p.x+=p.vx*dt;p.z+=p.vz*dt;p.y+=dt*.8;const growth=p.size+(1.2-p.life)*2.4;transform.position.set(p.x,p.y,p.z);transform.quaternion.copy(camera.quaternion);transform.scale.set(growth,growth,1);particleOpacity.array[i]=Math.min(1,p.life*2);}
      else{transform.position.set(0,-100,0);transform.scale.setScalar(0);particleOpacity.array[i]=0;}
      transform.updateMatrix();particles.setMatrixAt(i,transform.matrix);
    }
    particleOpacity.needsUpdate=true;particles.instanceMatrix.needsUpdate=true;
    renderer.render(scene,camera);
  }
  onProgress(.76,'Baking sunlight & soft shadows');
  updateCamera(0,null,'preview','wide');
  renderer.shadowMap.needsUpdate=true;
  renderer.render(scene,camera);renderer.shadowMap.needsUpdate=false;
  await yieldFrame();
  onProgress(.88,'Warming the GPU — ready at the green light');
  if(typeof renderer.compileAsync==='function')await renderer.compileAsync(scene,camera);else renderer.compile(scene,camera);
  renderer.render(scene,camera);
  onProgress(1,'World ready');
  const diagnostics={staticBatches:batches.size,decorations:track.decorations.length,terrainVertices:(resolution+1)**2,shadowMap:shadowSize,particleLimit:particleCapacity,skidLimit:skidCapacity,staticShadowsBaked:true,surfaceMaterials:Object.keys(roadMaterials),river:!!track.river,continuousHorizon:true,foliage:'alpha-tested branches',camera:'delayed chase',normalMaps:roadTextures.normalMaps,terrainNormalMap:true,scenery:scenery.diagnostics,scannedBoulders:boulderPlacements.length,scannedDeadwood:deadwoodPlacements.length,skybox:'six-face cloud sky',waterSurface:'flowing waves/ripples/shore foam',grassClumps,terrainShadowMap:terrainAOSize,bakedTerrainAO:true,terrainAORebakes:0,generatedAlbedos:roadTextures.loadedAlbedos,textureSources:roadTextures.sources,daylight:true,perWheelSuspension:true,continuousRoadEdgePose:true,rigidBodyOriginAligned:true,realtimeLights:0,headlightShadowMap:0,headlightShadowCadence:0,headlightShadowFrames:0};
  renderer.razerDiagnostics=diagnostics;
  return {renderer,scene,camera,diagnostics,textureAssets:roadTextures.materials,terrainShadowTexture:terrainAO,render,resize,dispose(){
    if(disposed)return;disposed=true;scenery.dispose();
    for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();
    sun.shadow.dispose();renderer.dispose();scene.clear();
  }};
}
