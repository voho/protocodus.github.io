import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS } from '../buildings.js';
import { SPRITE_SCALE, BUILDING_PALETTES, featureWorldPixels } from '../sprite-art-direction.js';
import { PLOT_BUILDING_ATLASES } from '../plot-building-catalog.js';

// Record the real sprite factory's prepared coordinates, source draws and
// native facade geometry. Image arrivals are controlled independently.
const requests=[];
globalThis.Image=class {
  set src(url){
    this.url=url;
    const cell=Number(url.match(/-(\d+)\.png$/)?.[1]||256),atlas=PLOT_BUILDING_ATLASES.find(atlas=>url.includes(`/${atlas.id}/`));
    this.naturalWidth=(atlas?.columns||3)*cell;this.naturalHeight=(atlas?.rows||3)*cell;requests.push(this);
  }
  get src(){return this.url;}
  decode(){return Promise.resolve();}
};
class DrawingContext {
  constructor(){this.matrix=[1,1,0,0];this.saved=[];this.fills=[];this.images=[];this.path=[];}
  point(x,y){const [sx,sy,tx,ty]=this.matrix;return[x*sx+tx,y*sy+ty];}
  save(){this.saved.push({matrix:[...this.matrix],fillStyle:this.fillStyle});}
  restore(){const state=this.saved.pop();this.matrix=state.matrix;this.fillStyle=state.fillStyle;}
  translate(x,y){this.matrix[2]+=x*this.matrix[0];this.matrix[3]+=y*this.matrix[1];}
  scale(x,y){this.matrix[0]*=x;this.matrix[1]*=y;}
  beginPath(){this.path=[];}
  moveTo(x,y){this.path.push(this.point(x,y));}
  lineTo(x,y){this.path.push(this.point(x,y));}
  closePath(){}
  stroke(){}
  ellipse(x,y,rx,ry){this.path.push(this.point(x-rx,y-ry),this.point(x+rx,y+ry));}
  arc(x,y,r){this.ellipse(x,y,r,r);}
  fill(){this.fills.push({color:this.fillStyle,points:this.path});}
  fillRect(x,y,w,h){this.fills.push({color:this.fillStyle,points:[this.point(x,y),this.point(x+w,y),this.point(x+w,y+h),this.point(x,y+h)]});}
  drawImage(image,...args){this.images.push({image,args});}
}
globalThis.document={createElement:()=>{const c=new DrawingContext();return{width:0,height:0,getContext:()=>c};}};
const {createSprites,TILE}=await import('../sprites.js');
const worldScale=SPRITE_SCALE.billboardPixelsPerTile/TILE,expectedDoor=featureWorldPixels(SPRITE_SCALE.doorHeightMetres);
const ordinary=`rgb(${[1,3,5].map(i=>Math.round(parseInt(BUILDING_PALETTES.taiga.timber.slice(i,i+2),16)*.72)).join(',')})`;
const doors=image=>image.getContext('2d').fills.filter(shape=>shape.color===ordinary&&shape.points.length===4&&Math.abs(shape.points[1][0]-shape.points[2][0])<1e-9&&Math.abs(shape.points[0][0]-shape.points[3][0])<1e-9);
const height=shape=>Math.abs(shape.points[1][1]-shape.points[2][1]);
const same=(actual,expected,label)=>assert.ok(Math.abs(actual-expected)<1e-9,`${label}: ${actual} versus ${expected}`);
const entries=['school','church','town-hall','house-expensive-1','house-expensive-2'];
const finish=async()=>{
  for(const image of requests.filter(image=>!image.done)){
    image.done=true;
    if(image.url.includes('/plot-buildings-v2/'))image.onload();else image.onerror();
  }
  for(let turn=0;turn<4;turn++)await new Promise(resolve=>setImmediate(resolve));
};

test('loading compact town sites preserve native door scale and cannot reuse resized thumbnail cache entries',()=>{
  const sprite=createSprites('taiga',{pixelScale:worldScale,gardenGround:'terrain'});
  for(const kind of entries){
    const nominal=BUILDINGS[kind].footprint,thumbnail=sprite(kind),compact=sprite(kind,0,1,'',1),full=sprite(kind,0,1,'',nominal);
    assert.notEqual(compact,thumbnail,`${kind}: different physical extents have separate fallback cache entries`);
    assert.equal(compact,sprite(kind,0,1,'',1),`${kind}: a saved world extent still reuses its prepared canvas`);
    assert.equal(thumbnail.width,compact.width,'omitted footprint keeps the existing normalized portrait size');
    assert.equal(compact.getContext('2d').images.length,0,'compact sites use native geometry while art loads');
    for(const [image,expected]of [[thumbnail,expectedDoor/nominal],[compact,expectedDoor],[full,expectedDoor]]){
      const entrances=doors(image);assert.ok(entrances.length,`${kind} exposes a measurable personnel door`);
      for(const door of entrances)same(height(door),expected,`${kind}: door height in its logical parcel`);
    }
  }
});

test('loaded catalog art cannot replace compact saved-site native architecture, while ordinary portraits retain raster art',async()=>{
  const sprite=createSprites('taiga',{pixelScale:worldScale,gardenGround:'terrain'});
  await finish();
  for(const kind of entries){
    const nominal=BUILDINGS[kind].footprint,compact=sprite(kind,0,1,'',1),full=sprite(kind,0,1,'',nominal),thumbnail=sprite(kind);
    assert.equal(compact.getContext('2d').images.length,0,`${kind}: available larger-parcel art is declined`);
    assert.ok(compact.getContext('2d').fills.length>0,`${kind}: native architecture remains visible`);
    for(const door of doors(compact))same(height(door),expectedDoor,`${kind}: late artwork preserves compact world door height`);
    assert.equal(full.getContext('2d').images.length,1,`${kind}: a matching world parcel uses generated art`);
    assert.equal(thumbnail.getContext('2d').images.length,1,`${kind}: normalized UI portraits may resize the correct logical parcel`);
    assert.notEqual(compact,thumbnail);
  }
  const workshop=sprite('factory',0,1,'',1),fullWorkshop=sprite('factory',0,1,'',2);
  assert.equal(workshop.getContext('2d').images.length,0,'the compact legacy town workshop retains native physical scale');
  assert.equal(fullWorkshop.getContext('2d').images.length,1,'the two-tile workshop keeps its registered city cutout');
});
