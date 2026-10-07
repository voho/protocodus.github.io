import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDING_PALETTES } from '../sprite-art-direction.js';
import { houseTerrainCutout, houseGroundStats } from '../house-ground.js';

class Canvas {
  getContext() {
    const canvas=this;
    return {
      drawImage(image) { canvas.data=new Uint8ClampedArray(image.data); },
      getImageData() { return {data:new Uint8ClampedArray(canvas.data)}; },
      putImageData(image) { canvas.data=new Uint8ClampedArray(image.data); },
    };
  }
}
globalThis.document={createElement:()=>new Canvas()};
const rgb=color=>[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
const pixel=(image,cell,kind,x,y)=>((Math.floor(kind/3)*cell+Math.floor(y*cell/256))*image.naturalWidth+kind%3*cell+Math.floor(x*cell/256))*4;
function paint(image,cell,kind,x0,y0,x1,y1,color,alpha=255){
  for(let y=Math.floor(y0*cell/256);y<Math.ceil(y1*cell/256);y++)for(let x=Math.floor(x0*cell/256);x<Math.ceil(x1*cell/256);x++){
    const n=((Math.floor(kind/3)*cell+y)*image.naturalWidth+kind%3*cell+x)*4;image.data.set([...color,alpha],n);
  }
}
function garden(cell,biome,grain=false){
  const image={naturalWidth:cell*3,naturalHeight:cell*3,data:new Uint8ClampedArray(cell*cell*9*4)},color=rgb(BUILDING_PALETTES[biome].ground);
  for(let kind=0;kind<9;kind++)for(let y=0;y<cell;y++)for(let x=0;x<cell;x++){
    const px=(x+.5)*256/cell,py=(y+.5)*256/cell,dx=Math.abs(px-128),n=((Math.floor(kind/3)*cell+y)*cell*3+kind%3*cell+x)*4;
    if(dx<=102.4&&py>=140.8+dx*.5&&py<=243.2-dx*.5){const tint=grain?(x+y)%3-1:0;image.data.set([...color.map(c=>c+tint),255],n);}
  }
  return image;
}
function assertProtected(source,result,cell,kind,x0,y0,x1,y1,message){
  for(let y=Math.floor(y0*cell/256);y<Math.ceil(y1*cell/256);y++)for(let x=Math.floor(x0*cell/256);x<Math.ceil(x1*cell/256);x++){
    const n=((Math.floor(kind/3)*cell+y)*source.naturalWidth+kind%3*cell+x)*4;
    assert.equal(result.data[n+3],source.data[n+3],message);
  }
}

test('registered canonical lawn clears across climates, densities and all nine identities',()=>{
  for(const biome of ['taiga','tundra','desert'])for(const cell of [64,128,256]){
    const source=garden(cell,biome,true),before=new Uint8ClampedArray(source.data),result=houseTerrainCutout(source,cell,biome);
    for(let kind=0;kind<9;kind++){
      assert.equal(result.data[pixel(source,cell,kind,128,230)+3],0,`${biome}/${cell}/${kind} exposes native terrain in broad foreground lawn`);
      assertProtected(source,result,cell,kind,90,165,166,206,'the architectural contact area stays intact');
    }
    for(let n=0;n<before.length;n+=4){
      assert.deepEqual(result.data.subarray(n,n+3),before.subarray(n,n+3),'cutout never recolours material pixels');
      assert.ok(result.data[n+3]<=before[n+3],'cutout never adds opacity');
    }
    assert.deepEqual(source.data,before,'the shared source atlas stays unchanged');
  }
});

test('garden masking preserves material swatches, antialiased fences and out-of-plane green pixels',()=>{
  for(const biome of ['taiga','tundra','desert']){
    const cell=128,p=BUILDING_PALETTES[biome],colors=Object.entries(p).filter(([name])=>name!=='ground'&&name!=='snow');
    for(let batch=0;batch<colors.length;batch+=9){
      const source=garden(cell,biome);
      for(let kind=0;kind<9;kind++){
        const color=rgb(colors[(batch+kind)%colors.length][1]);
        paint(source,cell,kind,122,223,134,235,color);
        paint(source,cell,kind,60,153,74,166,rgb(p.ground));
        paint(source,cell,kind,118,236,138,240,rgb(p.ground),96);
      }
      const result=houseTerrainCutout(source,cell,biome);
      for(let kind=0;kind<9;kind++){
        assertProtected(source,result,cell,kind,122,223,134,235,`${biome} ${colors[(batch+kind)%colors.length][0]} remains opaque in the candidate plane`);
        assertProtected(source,result,cell,kind,60,153,74,166,'similar green pixels above the garden plane stay intact');
        assertProtected(source,result,cell,kind,118,236,138,240,'antialiased fence/plant pixels retain exact alpha');
      }
    }
  }
});

test('contours protect whole ground-coloured roof and tree interiors, including the foreground seed band',()=>{
  const cell=256,source=garden(cell,'taiga'),lawn=rgb(BUILDING_PALETTES.taiga.ground);
  // A side roof and a low tree crown use the exact lawn colour, with subtle
  // closed painted contours. Neither interior is allowed to become a hole.
  for(const [kind,x0,y0,x1,y1] of [[0,49,184,73,207],[1,189,183,211,205],[2,119,223,137,235]]){
    paint(source,cell,kind,x0,y0,x1,y1,lawn.map(c=>c-10));
    paint(source,cell,kind,x0+2,y0+2,x1-2,y1-2,lawn);
  }
  const result=houseTerrainCutout(source,cell,'taiga');
  for(const [kind,x0,y0,x1,y1] of [[0,49,184,73,207],[1,189,183,211,205],[2,119,223,137,235]])assertProtected(source,result,cell,kind,x0,y0,x1,y1,'enclosed green object keeps its contour and full interior');
  assert.equal(result.data[pixel(source,cell,0,128,230)+3],0,'surrounding connected lawn still clears');
});

test('adaptive painted ground comes from exposed lawn, without borrowing adjacent cells or rebuilding warm cache entries',()=>{
  const cell=128,source=garden(cell,'taiga'),painted=[125,138,76];
  for(let kind=0;kind<9;kind++)for(let y=0;y<cell;y++)for(let x=0;x<cell;x++){
    const n=((Math.floor(kind/3)*cell+y)*source.naturalWidth+kind%3*cell+x)*4;
    if(source.data[n+3])source.data.set(painted.map((channel,index)=>channel+kind*(index===2?1:2)),n);
  }
  const before=houseGroundStats(),result=houseTerrainCutout(source,cell,'taiga'),after=houseGroundStats();
  assert.equal(result.data[pixel(source,cell,0,128,230)+3],0,'quiet painted lawn variation can expose terrain');
  assert.equal(houseTerrainCutout(source,cell,'taiga'),result,'warm draws return the prepared canvas');
  assert.equal(houseGroundStats().prepared,after.prepared,'warm draws do not repeat segmentation');
  assert.equal(after.prepared,before.prepared+1);
  assert.ok(after.bytes<=after.limit,'prepared cutouts respect their cache budget');
  const replacement=garden(cell,'taiga');
  assert.notEqual(houseTerrainCutout(replacement,cell,'taiga'),result,'a replacement atlas has an independent cutout identity');
});

test('authored transparent lawns retain all architecture, planting and original material pixels',()=>{
  const cell=128,source=garden(cell,'taiga');
  for(let kind=0;kind<9;kind++)for(let y=0;y<cell;y++)for(let x=0;x<cell;x++){
    const px=(x+.5)*256/cell,py=(y+.5)*256/cell,dx=Math.abs(px-128),n=((Math.floor(kind/3)*cell+y)*source.naturalWidth+kind%3*cell+x)*4;
    if(dx>72||py>=218-dx*.16)source.data[n+3]=0;
  }
  for(let kind=0;kind<9;kind++)paint(source,cell,kind,122,225,134,231,rgb(BUILDING_PALETTES.taiga.foliage));
  const result=houseTerrainCutout(source,cell,'taiga');
  assert.deepEqual(result.data,source.data,'already transparent gardens remain unchanged, including their opaque shrubs');
});

test('reviewed authored transparency bypasses colour keying and preserves a lawn-coloured shrub interior',()=>{
  const cell=256,source=garden(cell,'taiga');
  for(let n=3;n<source.data.length;n+=4)source.data[n]=0;
  // A large low shrub shares the painted lawn colour and lies in the legacy
  // foreground seed band. Its reviewed source opacity remains authoritative.
  paint(source,cell,0,107,216,149,239,rgb(BUILDING_PALETTES.taiga.ground));
  const legacy=houseTerrainCutout(source,cell,'taiga'),authored=houseTerrainCutout(source,cell,'taiga',{authoredTransparent:true});
  assert.equal(legacy.data[pixel(source,cell,0,128,230)+3],0,'legacy colour segmentation would mistake this shrub for ground');
  assert.deepEqual(authored.data,source.data,'authored mode preserves every source RGBA byte, including the full shrub interior');
  assert.notEqual(authored,legacy,'authored and legacy preparation modes have separate cache entries');
  assert.equal(houseTerrainCutout(source,cell,'taiga',{authoredTransparent:true}),authored,'authored warm draws reuse their unchanged prepared canvas');
});
