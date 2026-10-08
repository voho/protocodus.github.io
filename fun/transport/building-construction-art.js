import { BUILDINGS } from './buildings.js';
import { INDUSTRIES } from './data.js';
import { SPRITE_SCALE, BUILDING_PALETTES } from './sprite-art-direction.js';

// Construction belongs to the same metre scale and fixed 2:1 camera as the
// finished architecture. These temporary works deliberately expose excavated
// earth; there is no generic ground card around the reserved parcel.
const M = SPRITE_SCALE.worldPixelsPerMetre;
const FRAME = SPRITE_SCALE.billboardPixelsPerTile;
const GUTTER = 8 * FRAME / 32;
const LANDSCAPING = new Set(['park', 'park-village', 'park-formal', 'park-woodland', 'playground', 'sports-field', 'tennis-courts', 'ballpark', 'stadium']);

export function constructionArtLayout(kind, footprint = 1, level = 1) {
  const span = Math.max(1, footprint), edge = span * SPRITE_SCALE.tileMetres;
  const industry = Object.hasOwn(INDUSTRIES, kind), farm = industry && (INDUSTRIES[kind].farming || kind === 'farm');
  const landscaping = LANDSCAPING.has(kind);
  let structures;
  if (landscaping) structures = [];
  else if (farm && span >= 5) structures = [{ x: -edge / 2 + 19, y: -edge / 2 + 19, w: 26, d: 22, h: 6 }];
  else if (industry) structures = [
    { x: -edge * .35, y: -edge * .35, w: edge * .36, d: edge * .6, h: 6 },
    { x: edge * .1, y: -edge * .35, w: edge * .25, d: edge * .43, h: 6 },
  ];
  else {
    const homes = BUILDINGS[kind]?.group === 'homes' || ['house', 'apartment'].includes(kind);
    const storeys = homes ? Math.min(3, Math.max(1, level + (kind.includes('expensive') ? 1 : 0))) : ['hospital', 'service-hotel'].includes(kind) ? 3 : 2;
    structures = [{ x: -edge * .32, y: -edge * .31, w: edge * .64, d: edge * .6, h: storeys * SPRITE_SCALE.storeyHeightMetres }];
  }
  return { span, edge, industry, farm, landscaping, structures, width: FRAME * span, height: FRAME * span + GUTTER,
    anchorX: FRAME * span / 2, anchorY: FRAME * span * .75 + GUTTER };
}

/** Paint into an upright, ground-centred billboard at its native view density. */
export function paintBuildingConstruction(ctx, { kind, footprint = 1, level = 1, stage = 'excavation', biome = 'taiga' }) {
  const layout = constructionArtLayout(kind, footprint, level), p = BUILDING_PALETTES[biome] || BUILDING_PALETTES.taiga;
  const { edge, structures, industry, landscaping } = layout;
  const point = (x, y, z = 0) => [layout.anchorX + (x - y) * M, layout.anchorY + (x + y) * M / 2 - z * M];
  const polygon = (vertices, fill, stroke = null, width = .5) => {
    ctx.beginPath(); vertices.forEach((v, i) => { const q = point(...v); i ? ctx.lineTo(...q) : ctx.moveTo(...q); }); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
  };
  const segment = (a, b, color, width = .65) => { ctx.beginPath(); ctx.moveTo(...point(...a)); ctx.lineTo(...point(...b)); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); };
  const rect = (x, y, w, d, z = 0, fill, stroke) => polygon([[x,y,z],[x+w,y,z],[x+w,y+d,z],[x,y+d,z]], fill, stroke);
  const box = (x, y, w, d, h, color = p.stone) => {
    polygon([[x,y+d,0],[x+w,y+d,0],[x+w,y+d,h],[x,y+d,h]], color, p.ink, .35);
    polygon([[x+w,y,0],[x+w,y+d,0],[x+w,y+d,h],[x+w,y,h]], p.timber, p.ink, .35);
    rect(x,y,w,d,h,p.cream,p.ink);
  };
  const perimeter = edge / 2 - .7;
  const tape = (a, b) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]), pieces = Math.max(2, Math.ceil(length / 1.6)), posts = Math.max(1, Math.ceil(length / 6));
    for (let i = 0; i <= posts; i++) {
      const t = i / posts, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      segment([x,y,0],[x,y,1.3],p.timber,.8);
    }
    for (let i = 0; i < pieces; i++) {
      const t = i / pieces, u = (i+1) / pieces;
      polygon([[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,1.12],
        [a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u,1.12],
        [a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u,.68],
        [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,.68]], i % 2 ? '#f3ede0' : '#b54e45');
    }
  };
  ctx.save(); ctx.lineJoin='round'; ctx.lineCap='round';
  tape([-perimeter,-perimeter],[perimeter,-perimeter]); tape([-perimeter,-perimeter],[-perimeter,perimeter]);
  const work = structures.length ? structures : [{ x:-edge*.34,y:-edge*.34,w:edge*.68,d:edge*.68,h:0 }];
  for (const { x,y,w,d,h } of work) {
    const dig = stage === 'excavation', depth = landscaping ? .55 : 1.25;
    // Broad excavation walls explain the hole even at the Region view.
    rect(x-.5,y-.5,w+1,d+1,0,'#ac936f');
    rect(x,y,w,d,-depth,'#675642');
    polygon([[x,y,0],[x+w,y,0],[x+w,y,-depth],[x,y,-depth]],'#7d6247');
    polygon([[x,y,0],[x,y+d,0],[x,y+d,-depth],[x,y,-depth]],'#947b57');
    if (dig) {
      // One spoil heap and a broad access ramp; no noisy tiny props.
      polygon([[x+w*.7,y+d,0],[x+w*.98,y+d,0],[x+w*.98,y+d*.57,-depth],[x+w*.7,y+d*.57,-depth]],'#ab8c60');
      polygon([[x-1,y+d*.25,0],[x-3,y+d*.25+2,0],[x-1,y+d*.25+5,0],[x-.8,y+d*.25+2.2,1.15]],'#b79a6e');
      continue;
    }
    rect(x,y,w,d,0,p.stone,p.ink);
    if (landscaping) {
      rect(x+w*.4,y,w*.2,d,.05,p.path);
      rect(x,y+d*.44,w,d*.14,.06,p.path);
      if (stage==='finishing') { rect(x+1,y+1,w*.3,d*.29,.05,p.foliage); rect(x+w*.67,y+d*.64,w*.28,d*.3,.05,p.foliage); }
      continue;
    }
    const finished = stage==='finishing', columns = Math.max(2,Math.ceil(w/8)), bays = Math.max(2,Math.ceil(d/8)), scaffoldHeight=h+.8;
    if (finished) {
      // An unfinished shell and roof underlay precede the actual authored
      // building. Windows, gardens and the finished facade arrive on opening.
      polygon([[x,y+d,0],[x+w,y+d,0],[x+w,y+d,h],[x,y+d,h]],p.stone);
      polygon([[x+w,y,0],[x+w,y+d,0],[x+w,y+d,h],[x+w,y,h]],p.brick);
      rect(x,y,w,d,h,p.slate,p.ink);
      for(let i=1;i<columns;i++)rect(x+w*i/columns-.6,y+.5,1.2,d-1,h+.06,p.metal);
    }
    for(let i=0;i<=columns;i++) {
      const u=x+w*i/columns;
      segment([u,y,0],[u,y,h],p.metal,.9); segment([u,y+d,0],[u,y+d,h],p.metal,.9);
      segment([u,y,h],[u,y+d,h],industry?p.ochre:p.timber,1.1);
    }
    for(let j=0;j<=bays;j++) {
      const v=y+d*j/bays;
      segment([x,v,0],[x,v,h],p.metal,.9); segment([x+w,v,0],[x+w,v,h],p.metal,.9);
      segment([x,v,h],[x+w,v,h],p.timber,1);
    }
    // Scaffolding stays outside the shell, in metre-spaced bays and storeys.
    for(let i=0;i<=columns;i++) {
      const u=x+w*i/columns;
      segment([u,y+d+.6,0],[u,y+d+.6,scaffoldHeight],p.metal,.55);
      if(i<columns)segment([u,y+d+.6,.2],[u+w/columns,y+d+.6,Math.min(3,scaffoldHeight)],p.timber,.45);
    }
    for(let z=3;z<scaffoldHeight;z+=3)segment([x,y+d+.6,z],[x+w,y+d+.6,z],p.ochre,1.3);
    segment([x,y+d+.6,scaffoldHeight],[x+w,y+d+.6,scaffoldHeight],p.metal,.55);
  }
  // Material stacks sit within the working parcel and retain the same size
  // for a cottage and a five-tile factory.
  const stackX = -perimeter + 1.4, stackY = perimeter - 3.6;
  box(stackX,stackY,Math.min(3.5,edge*.18),1.8,.7,p.brick);
  if(industry)box(stackX+5,stackY,4,1.4,.9,p.timber);
  tape([-perimeter,perimeter],[perimeter,perimeter]); tape([perimeter,-perimeter],[perimeter,perimeter]);
  ctx.restore();
  return layout;
}
