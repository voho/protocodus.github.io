import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS } from '../buildings.js';
import { drawTownBuilding, NATIVE_TOWN_BUILDING_KINDS } from '../building-sprites.js';
import { drawNativeFarmCore, drawProcessingPlant } from '../processing-sprites.js';
import { INDUSTRIES } from '../data.js';
import { drawTownFeature, TOWN_FEATURE_KINDS } from '../town-feature-sprites.js';
import { SPRITE_SCALE, featureWorldPixels, BUILDING_PALETTES } from '../sprite-art-direction.js';

// Record final world coordinates, including the parcel transform applied by sprites.js.
class DrawingContext {
  constructor(footprint) {
    this.matrix = [(SPRITE_SCALE.billboardPixelsPerTile / 32) * footprint, (SPRITE_SCALE.billboardPixelsPerTile / 32) * footprint, 0, 0];
    this.saved = [];
    this.fills = [];
    this.strokes = [];
    this.path = [];
  }
  point(x, y) { const [sx, sy, tx, ty] = this.matrix; return [x * sx + tx, y * sy + ty]; }
  save() { this.saved.push({ matrix: [...this.matrix], fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, lineJoin: this.lineJoin }); }
  restore() { Object.assign(this,this.saved.pop()); }
  translate(x, y) { this.matrix[2] += x * this.matrix[0]; this.matrix[3] += y * this.matrix[1]; }
  scale(x, y) { this.matrix[0] *= x; this.matrix[1] *= y; }
  beginPath() { this.path = []; }
  moveTo(x, y) { this.path.push(this.point(x, y)); }
  lineTo(x, y) { this.path.push(this.point(x, y)); }
  closePath() {}
  stroke() {
    const radius = (this.lineWidth || 1) / 2;
    const rx = Math.abs(this.matrix[0]) * radius, ry = Math.abs(this.matrix[1]) * radius;
    this.strokes.push({color:this.strokeStyle,points:this.path.flatMap(([x,y]) => [[x-rx,y-ry],[x+rx,y+ry]])});
  }
  ellipse(x, y, rx, ry) { this.path.push(this.point(x - rx, y - ry), this.point(x + rx, y + ry)); }
  arc(x, y, r) { this.ellipse(x, y, r, r); }
  fill() { this.fills.push({ color: this.fillStyle, points: this.path }); }
  fillRect(x, y, w, h) {
    this.fills.push({ color: this.fillStyle, rect: true, points: [this.point(x, y), this.point(x + w, y), this.point(x + w, y + h), this.point(x, y + h)] });
  }
}

// Sloping frontage edges change the bounding box; the upright sides retain
// the physical opening height independently of the two ground axes.
const height = shape => Math.abs(shape.points[1][1] - shape.points[2][1]);
const uprightQuad = shape => shape.points.length === 4 && Math.abs(shape.points[1][0] - shape.points[2][0]) < 1e-9 && Math.abs(shape.points[0][0] - shape.points[3][0]) < 1e-9;
const expectedDoor = featureWorldPixels(SPRITE_SCALE.doorHeightMetres);
const shade = (color, factor) => `rgb(${[1, 3, 5].map(i => Math.round(parseInt(color.slice(i, i + 2), 16) * factor)).join(',')})`;
const ordinary = shade(BUILDING_PALETTES.taiga.timber,.72);
const entrances = c => c.fills.filter(shape=>uprightQuad(shape)&&shape.color===ordinary);
const drawTown = (c,kind,biome,detail='town',span=BUILDINGS[kind].footprint,variant=0) => TOWN_FEATURE_KINDS.includes(kind)?drawTownFeature(c,kind,biome,detail,{footprint:span}):drawTownBuilding(c,kind,biome,detail,variant,{footprint:span});

test('regenerated architecture preserves physical doors, windows and vehicle bays across all saved parcel sizes',()=>{
  for(const kind of Object.keys(BUILDINGS).filter(kind=>!kind.startsWith('park')&&!['playground','stadium','sports-field','tennis-courts','ballpark','swimming-pool'].includes(kind)))for(const span of [1,BUILDINGS[kind].footprint]){
    const c=new DrawingContext(span);drawTown(c,kind,'taiga','detail',span);
    const doors=entrances(c);assert.ok(doors.length,`${kind}/${span} has measurable personnel access`);
    for(const door of doors){
      assert.ok(Math.abs(height(door)-expectedDoor)<1e-8,`${kind} retains the 2.1m door height`);
      const width=Math.abs(door.points[1][0]-door.points[0][0]);
      assert.ok([1,2].some(leaves=>Math.abs(width-featureWorldPixels(SPRITE_SCALE.doorWidthMetres)*leaves)<1e-8));
      assert.ok(Math.abs(Math.abs((door.points[1][1]-door.points[0][1])/width)-.5)<1e-8,'frontage follows the isometric grid');
    }
    for(const shape of c.fills.filter(shape=>uprightQuad(shape)&&shape.color===BUILDING_PALETTES.taiga.ink)){
      assert.ok([SPRITE_SCALE.windowHeightMetres,SPRITE_SCALE.loadingBayHeightMetres].some(m=>Math.abs(height(shape)-featureWorldPixels(m))<1e-8),`${kind} windows and bays retain physical height`);
    }
  }
  for(const [kind,count]of [['fire-station',2],['service-garage',1]]){
    const c=new DrawingContext(BUILDINGS[kind].footprint);drawTown(c,kind,'taiga');
    assert.equal(c.fills.filter(shape=>uprightQuad(shape)&&shape.color===BUILDING_PALETTES.taiga.ink&&Math.abs(height(shape)-featureWorldPixels(SPRITE_SCALE.loadingBayHeightMetres))<1e-8).length,count);
  }
});

test('every fresh town fallback is transparent, finite, registered, deterministic and distinct',()=>{
  assert.equal(NATIVE_TOWN_BUILDING_KINDS.length,32);assert.equal(TOWN_FEATURE_KINDS.length,11);
  const signatures=new Set();
  for(const biome of ['taiga','tundra','desert'])for(const kind of Object.keys(BUILDINGS))for(const detail of ['region','detail']){
    const span=BUILDINGS[kind].footprint,c=new DrawingContext(span),matrix=[...c.matrix];drawTown(c,kind,biome,detail);
    assert.ok(c.fills.length>=4,`${kind} keeps broad masses at ${detail}`);
    assert.equal(c.fills.some(shape=>shape.color===BUILDING_PALETTES[biome].ground),false,'bare ground is transparent in both maps and previews');
    for(const shape of [...c.fills,...c.strokes])for(const [x,y]of shape.points){
      assert.ok(Number.isFinite(x)&&Number.isFinite(y));
      assert.ok(x>=0&&x<=72*span&&y>=-18&&y<=72*span,`${kind}/${biome} fits its registered frame (${x},${y})`);
    }
    const repeat=new DrawingContext(span);drawTown(repeat,kind,biome,detail);assert.deepEqual(repeat.fills,c.fills);
    assert.deepEqual(c.matrix,matrix);assert.equal(c.saved.length,0);
    if(biome==='taiga'&&detail==='region')signatures.add(JSON.stringify(c.fills));
  }
  assert.equal(signatures.size,Object.keys(BUILDINGS).length,'every named building has a distinct full design');
});

test('native redraws use broad roof masses with exact 2:1 edges and northwest side shading',()=>{
  for(const kind of ['house-cheap-1','school','service-bank','mall-neighborhood']){
    const c=new DrawingContext(BUILDINGS[kind].footprint);drawTown(c,kind,'taiga');
    const p=BUILDING_PALETTES.taiga,planes=c.fills.filter(shape=>shape.points.length===4&&[p.slate,p.terracotta,p.path].includes(shape.color)&&shape.points.every((a,i)=>{const b=shape.points[(i+1)%4];return Math.abs(Math.abs((b[1]-a[1])/(b[0]-a[0]))-.5)<1e-8;}));
    assert.ok(planes.length,`${kind} uses registered ground/roof planes`);
    assert.ok(c.fills.some(shape=>[shade(p.plaster,.76),shade(p.stone,.76)].includes(shape.color)),`${kind} has a consistently shaded right facade`);
  }
});

test('all rebuilt industries and farm cores expose no generic terrain and retain physical personnel access',()=>{
  for(const footprint of [1,2,3,5])for(const biome of ['taiga','tundra','desert'])for(const kind of Object.keys(INDUSTRIES)){
    const c=new DrawingContext(footprint);assert.equal(drawProcessingPlant(c,kind,()=>.5,biome,'town',footprint),true);
    assert.ok(c.fills.length>3);assert.equal(c.saved.length,0);
    assert.equal(c.fills.some(shape=>shape.color===BUILDING_PALETTES[biome].ground),false);
    const doors=c.fills.filter(shape=>uprightQuad(shape)&&shape.color===shade(BUILDING_PALETTES[biome].timber,.72));
    assert.ok(doors.length,kind);for(const door of doors)assert.ok(Math.abs(height(door)-expectedDoor)<1e-8);
    const gutter=SPRITE_SCALE.billboardPixelsPerTile/4,frame=SPRITE_SCALE.billboardPixelsPerTile*footprint;
    for(const shape of [...c.fills,...c.strokes])for(const [x,y]of shape.points){assert.ok(x>=1.5&&x<=frame-1.5,`${kind}/${footprint} has side gutters`);assert.ok(y+gutter>=1.5&&y+gutter<=frame+gutter-1.5,`${kind}/${footprint} has vertical gutters (${y})`);}
  }
  for(const kind of ['farm','dairy-farm','vegetable-farm','orchard','livestock-farm']){
    const c=new DrawingContext(2);assert.equal(drawNativeFarmCore(c,kind,()=>.5,'taiga'),true);assert.ok(entrances(c).length);assert.equal(c.saved.length,0);
  }
});
