// Drawn once during preflight. Runtime selectors only return atlas rectangles;
// no asset fetches, global randomness, per-piece canvases or repainting.
const TAU = Math.PI * 2, FRAGMENT_SIZE = 96, WRECK_SIZE = 256, COLUMNS = 4;
const sources = [];
const records = size => Array.from({ length: 12 }, (_, index) => ({
  source: null, sx: index % COLUMNS * size, sy: Math.floor(index / COLUMNS) * size, sw: size, sh: size,
}));
const fragments = records(FRAGMENT_SIZE), wrecks = records(WRECK_SIZE);
const STEEL = ['#7c9296', '#3c5159', '#17272f'];
const BLUE = ['#9fbabc', '#557880', '#243c48'];
const COPPER = ['#bb9874', '#775541', '#342c29'];
const STONE = ['#b3aaa0', '#716f6c', '#343b3e'];
const CHAR = ['#596164', '#303a3e', '#141e23'];

function random(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
function surface(width, height) {
  const canvas = typeof OffscreenCanvas === 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(width, height);
  canvas.width = width; canvas.height = height;
  return canvas;
}
function path(c, points) {
  c.beginPath(); c.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) c.lineTo(points[i][0], points[i][1]);
  c.closePath();
}
function line(c, points, color = '#121f26', width = 1.4) {
  c.beginPath(); c.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) c.lineTo(points[i][0], points[i][1]);
  c.strokeStyle = color; c.lineWidth = width; c.stroke();
}
function place(c, x, y, angle, scale, draw) {
  c.save(); c.translate(x, y); c.rotate(angle); c.scale(scale, scale); draw(); c.restore();
}
function shadow(c, x, y, rx, ry, alpha = .48) {
  c.save(); c.translate(x, y); c.scale(rx, ry);
  const g = c.createRadialGradient(0, 0, .15, 0, 0, 1);
  g.addColorStop(0, `rgba(5,10,14,${alpha})`); g.addColorStop(.5, `rgba(9,15,18,${alpha * .6})`); g.addColorStop(1, 'rgba(9,15,18,0)');
  c.fillStyle = g; c.fillRect(-1, -1, 2, 2); c.restore();
}
function plate(c, points, palette = STEEL, rand = null) {
  const g = c.createLinearGradient(-35, -45, 38, 48);
  g.addColorStop(0, palette[0]); g.addColorStop(.34, palette[1]); g.addColorStop(1, palette[2]);
  path(c, points); c.fillStyle = g; c.fill(); c.strokeStyle = '#0c171eee'; c.lineWidth = 2.2; c.stroke();
  // Different edge tones create raised, chipped plates without a uniform halo.
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    line(c, [a, b], b[0] > a[0] ? `${palette[0]}b0` : '#111c2699', b[0] > a[0] ? 1 : .7);
  }
  if (rand) {
    c.save(); path(c, points); c.clip();
    for (let i = 0; i < 17; i++) {
      const x = rand() * 90 - 45, y = rand() * 90 - 45;
      line(c, [[x, y], [x + 1 + rand() * 7, y - rand() * 2]], i % 3 ? '#101b253d' : '#d9dfca30', .65);
    }
    c.restore();
  }
}
function rivets(c, points, color = '#acbabb') {
  for (const [x, y] of points) {
    c.fillStyle = '#111f28'; c.beginPath(); c.arc(x + .4, y + .6, 1.8, 0, TAU); c.fill();
    c.fillStyle = color; c.beginPath(); c.arc(x - .2, y - .3, .8, 0, TAU); c.fill();
  }
}
function vents(c, x, y, count, length, spacing = 4, vertical = false) {
  c.save(); c.translate(x, y); if (vertical) c.rotate(Math.PI / 2);
  for (let i = 0; i < count; i++) {
    line(c, [[0, i * spacing], [length, i * spacing]], '#0c1921', 2.5);
    line(c, [[.5, i * spacing + 1.5], [length, i * spacing + 1.5]], '#a8b7b663', .8);
  }
  c.restore();
}
function scorch(c, x, y, rx, ry) {
  shadow(c, x, y, rx, ry, .85);
  c.save(); c.translate(x, y); c.scale(rx, ry);
  path(c, [[-.7, -.2], [-.2, -.62], [.35, -.4], [.72, .1], [.4, .55], [-.4, .38]]);
  c.fillStyle = '#111b2199'; c.fill(); c.restore();
}
function ember(c, x, y, radius = 1) {
  const g = c.createRadialGradient(x, y, 0, x, y, radius * 4);
  g.addColorStop(0, '#df9c5b96'); g.addColorStop(1, '#ca511900');
  c.fillStyle = g; c.fillRect(x - radius * 4, y - radius * 4, radius * 8, radius * 8);
  c.fillStyle = '#d8a76a'; c.fillRect(x, y, radius * 1.5, radius * .7);
}
function cable(c, points, width = 3, color = '#806751') {
  line(c, points, '#101c25', width + 2); line(c, points, color, width);
  line(c, points.map(([x, y]) => [x - .6, y - .6]), '#bdad8377', .65);
}
function turbine(c, x, y, radius, broken = false) {
  place(c, x, y, 0, radius / 24, () => {
    c.fillStyle = '#111c22'; c.beginPath(); c.arc(0, 0, 24, 0, TAU); c.fill();
    c.strokeStyle = '#647982'; c.lineWidth = 4;
    c.beginPath(); c.arc(0, 0, 21, broken ? .55 : 0, broken ? 5.5 : TAU); c.stroke();
    c.strokeStyle = '#c1b18a'; c.lineWidth = 1;
    c.beginPath(); c.arc(-.7, -.7, 23, broken ? .8 : .15, 4.6); c.stroke();
    for (let i = 0; i < 11; i++) {
      const a = i * TAU / 11;
      plate(c, [[Math.cos(a) * 6, Math.sin(a) * 6], [Math.cos(a + .18) * 18, Math.sin(a + .18) * 18], [Math.cos(a + .4) * 17, Math.sin(a + .4) * 17]], i % 3 ? CHAR : STEEL);
    }
    c.fillStyle = '#64777b'; c.beginPath(); c.arc(0, 0, 5, 0, TAU); c.fill();
    c.fillStyle = '#141e24'; c.beginPath(); c.arc(0, 0, 2, 0, TAU); c.fill();
  });
}

function fragment(c, variant, rand) {
  switch (variant) {
    case 0: // Bent armor with its torn lower skin exposed.
      plate(c, [[-32,-25],[19,-32],[33,-11],[23,15],[30,24],[4,31],[-8,22],[-29,27]], STEEL, rand);
      plate(c, [[-29,17],[-8,13],[7,23],[27,19],[30,25],[4,32],[-10,25]], COPPER);
      line(c, [[-19,-21],[-14,8],[16,11],[23,-10]], '#14232a', 2);
      line(c, [[-10,-20],[11,-23],[17,-15]], '#bdd3cf99', 1.2);
      rivets(c, [[-23,-18],[19,-19],[-19,14],[19,11]]); scorch(c, 7, 11, 17, 14); break;
    case 1: // Swept wing, not a square panel.
      plate(c, [[-35,27],[-22,-27],[33,-36],[20,-9],[9,-6],[15,3],[-2,11]], BLUE, rand);
      plate(c, [[-35,27],[-19,14],[4,-10],[27,-29],[19,-9]], CHAR);
      for (let i = 0; i < 5; i++) line(c, [[-19+i*6,-20-i*2],[-25+i*6,7-i*5]], '#bbd0c17b', 1.5);
      line(c, [[-23,10],[-9,-11],[14,-23]], '#15232a', 2.4); rivets(c, [[-24,-15],[-13,-20],[12,-27]]); break;
    case 2: // Engine casing with a real hollow nozzle.
      plate(c, [[-24,-28],[17,-29],[29,-12],[23,23],[10,32],[-22,24],[-30,2]], STEEL, rand);
      plate(c, [[-23,-24],[-8,-30],[-6,27],[-21,24]], COPPER);
      vents(c, -19, -15, 7, 10, 5); turbine(c, 8, 6, 20, true);
      cable(c, [[-13,22],[-8,35],[2,33],[7,26]], 2); break;
    case 3: // Twisted open girder.
      plate(c, [[-35,-27],[-25,-32],[31,18],[35,28],[22,31],[-31,-18]], CHAR, rand);
      plate(c, [[-30,-24],[-22,-25],[30,23],[22,25]], COPPER);
      for (let i = 0; i < 4; i++) {
        const x = -21+i*13, y = -17+i*11;
        line(c, [[x-4,y+5],[x+7,y-6]], '#111c24', 4); line(c, [[x-4,y+3],[x+6,y-7]], '#82928e', 1.4);
      }
      rivets(c, [[-28,-22],[24,24]]); break;
    case 4: // Exposed circuit board and broken connectors.
      plate(c, [[-30,-26],[25,-27],[32,-10],[24,0],[31,12],[20,30],[-25,24],[-33,8]], CHAR, rand);
      plate(c, [[-24,-20],[19,-21],[23,16],[-20,19]], ['#5a7770','#314e47','#1c302e']);
      for (let i = 0; i < 5; i++) line(c, [[-21,-15+i*6],[-9+i*2,-15+i*6],[-4+i*2,-10+i*6],[21,-10+i*6]], '#aa92628c', 1);
      plate(c, [[-10,-9],[5,-9],[5,7],[-10,7]], CHAR); rivets(c, [[-26,-20],[25,-15],[-21,20]]);
      for (let i = 0; i < 5; i++) line(c, [[-16+i*7,24],[-14+i*7,31+(i%2)*4]], '#af936c', 2);
      c.fillStyle = '#a1c6be'; c.fillRect(10,-15,4,7); scorch(c, -5, 9, 14, 11); break;
    case 5: // A fractured coupling, with an empty center.
      c.strokeStyle = '#14222b'; c.lineWidth = 13; c.beginPath(); c.arc(0, 0, 27, .4, 5.4); c.stroke();
      c.strokeStyle = '#536a72'; c.lineWidth = 8; c.beginPath(); c.arc(0, 0, 27, .4, 5.4); c.stroke();
      c.strokeStyle = '#acb8ae'; c.lineWidth = 1.3; c.beginPath(); c.arc(-1,-1,30,.4,5.4); c.stroke();
      for (let i = 1; i < 8; i++) {
        const a = i * .63; line(c, [[Math.cos(a)*23,Math.sin(a)*23],[Math.cos(a)*31,Math.sin(a)*31]], '#17242b', 2);
      }
      plate(c, [[21,9],[35,9],[31,18],[23,18]], COPPER); plate(c, [[14,-28],[25,-22],[20,-17]], BLUE); break;
    case 6: // Cut cable loom, separated strands and a ceramic plug.
      for (let i = 0; i < 5; i++) cable(c, [[-22+i*3,-31],[-15+i*2,-17],[-20+i*2,-1],[-6+i*3,11],[8+i*4,14],[14+i*4,31]], 2, i%2 ? '#596f76' : '#927456');
      plate(c, [[-28,-32],[-7,-35],[-2,-19],[-25,-16]], BLUE, rand); vents(c,-23,-28,3,13,4);
      plate(c, [[-17,-1],[-3,-6],[4,8],[-11,12]], CHAR); rivets(c, [[-20,-23],[-9,-25]]); break;
    case 7: // Forked load-bearing strut.
      plate(c, [[-34,-28],[-21,-33],[1,-9],[23,-31],[33,-21],[12,2],[14,30],[-1,35],[-9,6]], STEEL, rand);
      line(c, [[-27,-24],[-2,3],[4,28]], '#101d25', 4);
      line(c, [[25,-22],[3,0]], '#afbbab99', 2); turbine(c, -1, 2, 10, true);
      rivets(c, [[-27,-26],[26,-24],[6,25]]); break;
    case 8: // Concrete fracture with an illuminated aggregate face.
      plate(c, [[-31,-17],[-13,-31],[17,-28],[34,-9],[24,24],[0,33],[-28,18]], STONE, rand);
      plate(c, [[-31,-17],[-12,-9],[0,15],[-2,32],[-28,18]], ['#c1b29b','#8b8173','#444747']);
      line(c, [[-11,-24],[-4,-12],[10,-8],[5,4],[20,18]], '#333c3d', 1.7);
      for(let i=0;i<16;i++){c.fillStyle=i%2?'#252f354d':'#d5c8aa6b';c.fillRect(rand()*43-20,rand()*35-17,1.5,1.2);} break;
    case 9: // Broken brickwork and mortar.
      plate(c,[[-33,-14],[-15,-29],[29,-20],[34,15],[9,32],[-30,23]],CHAR);
      plate(c,[[-28,-18],[-7,-23],[-4,-3],[-29,2]],COPPER,rand);
      plate(c,[[-2,-24],[25,-19],[26,-2],[1,-3]],STONE,rand);
      plate(c,[[-29,7],[8,3],[10,24],[-24,22]],STONE,rand);
      plate(c,[[13,4],[31,2],[25,18],[13,29]],COPPER,rand); break;
    case 10: // Reinforced slab with exposed rebar.
      for(let i=0;i<3;i++)cable(c,[[-30+i*16,-33],[-23+i*16,-8],[-17+i*15,24],[-24+i*17,36]],2,'#7c6652');
      plate(c,[[-32,-17],[-8,-29],[25,-20],[31,5],[13,22],[-8,14],[-25,24]],STONE,rand);
      plate(c,[[-25,12],[-8,3],[13,12],[20,20],[6,29],[-9,18]],CHAR);
      line(c,[[-17,-17],[-7,-1],[8,-5],[21,4]],'#36383a',2); break;
    case 11: // Shattered cladding/glass, several separate silhouettes.
      plate(c,[[-34,-13],[-7,-30],[-11,3]],BLUE,rand);
      plate(c,[[0,-28],[32,-16],[11,1],[-3,-2]],STONE,rand);
      plate(c,[[-29,6],[-8,8],[0,30],[-23,24]],CHAR,rand);
      plate(c,[[4,7],[32,-1],[23,29]],['#aac5c4','#526f72','#273d48'],rand);
      line(c,[[10,10],[24,5],[21,20]],'#d1d7c278',1); break;
  }
}

function scatter(c, rand, ground, count, rx, ry) {
  for (let i = 0; i < count; i++) {
    const angle = rand() * TAU, distance = .65 + rand() * .3;
    const x = Math.cos(angle) * rx * distance, y = Math.sin(angle) * ry * distance;
    const scale = .08 + rand() * .13, variant = ground ? 8 + i % 4 : i % 8;
    shadow(c, x + 1, y + 2, scale * 39, scale * 30, .4);
    place(c, x, y, angle, scale, () => fragment(c, variant, rand));
  }
}
function wreck(c, variant, rand) {
  const shard = (id,x,y,a=0,s=1) => place(c,x,y,a,s,()=>fragment(c,id,rand));
  // Compositions are authored individually; no common central hull is pasted
  // underneath them. Contact shadows follow the separate pieces' footprints.
  switch(variant) {
    case 0: // Split interceptor: nose, open center spine, detached starboard wing.
      shadow(c,-5,8,88,70); shadow(c,63,37,34,27);
      plate(c,[[-17,-87],[11,-74],[26,-21],[12,-5],[-26,-19]],BLUE,rand);
      plate(c,[[-13,-60],[5,-58],[12,-20],[-7,-15]],CHAR);
      plate(c,[[-24,-10],[2,-2],[18,19],[8,47],[-28,32],[-35,8]],STEEL,rand);
      shard(1,-51,8,-.35,1.3); shard(1,63,31,2.5,1.12);
      for(let i=0;i<4;i++)cable(c,[[-17+i*7,-17],[-12+i*5,3],[-20+i*8,24]],2);
      turbine(c,-13,40,19,true); vents(c,-14,-49,6,17,5); scorch(c,-4,8,28,25); ember(c,-5,11); break;
    case 1: // Large parallel engine nacelles and a fractured cross-mount.
      shadow(c,-23,3,45,83); shadow(c,30,9,40,72);
      place(c,-27,-8,-.15,1,()=>{
        plate(c,[[-21,-64],[18,-67],[26,-39],[20,57],[-22,63],[-28,17]],STEEL,rand);
        vents(c,-14,-48,11,25,6); turbine(c,0,43,24,true);
        plate(c,[[-20,-64],[10,-70],[18,-50],[-14,-47]],COPPER); scorch(c,4,-3,21,32);
      });
      place(c,34,17,.26,.88,()=>{plate(c,[[-23,-62],[22,-60],[18,48],[-18,55],[-28,19]],BLUE,rand);vents(c,-13,-45,8,24,6);turbine(c,0,38,22,true);});
      shard(3,1,-5,1.7,1.05); cable(c,[[-10,-53],[10,-47],[24,-21],[18,-4]],3); ember(c,-21,16); break;
    case 2: // Torn crescent wing with a blackened center and a loose tip.
      shadow(c,-1,10,104,60);
      plate(c,[[-98,14],[-68,-33],[-19,-49],[34,-40],[81,-8],[63,14],[21,-11],[-17,-18],[-55,-4],[-71,35]],BLUE,rand);
      plate(c,[[-62,-25],[-19,-39],[23,-31],[49,-10],[15,-7],[-14,-16],[-49,-1]],STEEL,rand);
      for(let i=0;i<7;i++)line(c,[[-57+i*17,-23+Math.abs(3-i)*3],[-57+i*17,6+Math.abs(3-i)*4]],'#17272e',3);
      plate(c,[[-30,-7],[3,-12],[30,16],[18,42],[-11,35],[-37,17]],CHAR);
      shard(1,74,41,2.35,.82); shard(5,-43,35,.4,.62); scorch(c,-4,9,38,30); ember(c,5,12); break;
    case 3: // Bulky armored hull on its side, exposed machinery in the breach.
      shadow(c,-4,7,80,99);
      plate(c,[[-38,-87],[28,-79],[46,-52],[41,-17],[20,-11],[28,12],[42,23],[28,73],[-19,88],[-45,54],[-51,-31]],STEEL,rand);
      plate(c,[[-35,-78],[-8,-76],[-9,60],[-25,72],[-37,39]],BLUE,rand);
      plate(c,[[3,-67],[31,-56],[30,-25],[13,-18],[-1,-34]],COPPER,rand);
      vents(c,-29,-60,10,15,8); turbine(c,8,47,25,true);
      shard(4,13,-4,.12,.9); cable(c,[[19,-27],[39,-6],[31,18],[44,33]],2.5);
      shard(0,69,-16,.7,.65); scorch(c,3,8,35,25); rivets(c,[[-38,-52],[-36,18],[-26,61],[28,39]]); break;
    case 4: // Angular skeletal truss and loose ammunition/containment pods.
      shadow(c,-7,6,94,69);
      shard(3,-27,-31,-.56,1.45); shard(3,27,16,-.56,1.3); shard(7,-16,21,.4,1.1);
      for(let i=0;i<3;i++)place(c,26+i*13,-38+i*5,.4,.8,()=>{
        plate(c,[[-8,-26],[7,-29],[11,20],[2,26],[-10,20]],i%2?BLUE:COPPER,rand);vents(c,-5,-18,5,10,6);
      });
      shard(4,-49,44,-.6,.65); shard(0,60,48,.2,.73); cable(c,[[-58,-13],[-37,7],[-9,3],[15,38],[38,42]],3); scorch(c,-9,6,32,26); break;
    case 5: // Shattered circular drone/reactor with a displaced core.
      shadow(c,0,3,89,87);
      place(c,-10,-8,.4,2.15,()=>fragment(c,5,rand));
      turbine(c,-14,-12,28,true); shard(4,38,35,.45,.91);
      shard(1,-64,26,-1.1,.74); shard(2,29,-64,1.4,.58);
      cable(c,[[-16,15],[-27,43],[-3,56],[19,39]],3); cable(c,[[8,-6],[34,-2],[42,14]],2);
      scorch(c,-2,-7,32,28); ember(c,2,-4,1.3); break;
    case 6: // One long broken bomber wing, separated tail and actuator.
      shadow(c,-2,3,112,49); shadow(c,23,48,45,33);
      plate(c,[[-106,-14],[-54,-37],[-7,-27],[21,-11],[54,-19],[97,2],[68,23],[29,13],[2,26],[-39,12],[-85,19]],STEEL,rand);
      plate(c,[[-92,-8],[-52,-23],[-15,-15],[-2,-1],[-45,0],[-75,12]],BLUE);
      for(let i=0;i<6;i++)line(c,[[-70+i*24,-20],[-69+i*24,12]],'#12242f',3);
      vents(c,-62,-14,4,45,5); shard(7,25,52,-1.2,.9); shard(2,63,-39,.8,.64);
      plate(c,[[-12,-17],[12,-10],[5,24],[-18,16]],CHAR); cable(c,[[-8,11],[6,36],[24,37],[40,48]],2); scorch(c,2,2,27,23); break;
    case 7: // Compact cockpit/cabin, split canopy and severed rear assembly.
      shadow(c,-17,-1,64,89); shadow(c,43,50,39,42);
      plate(c,[[-29,-79],[4,-86],[27,-54],[22,0],[8,30],[-40,22],[-49,-26]],BLUE,rand);
      plate(c,[[-22,-61],[1,-65],[13,-42],[4,-10],[-27,-7],[-34,-32]],CHAR);
      plate(c,[[-21,-58],[-5,-61],[-6,-34],[-26,-25]],['#b7cbd0','#4e717b','#263944']);
      plate(c,[[0,-54],[9,-42],[2,-23],[-1,-35]],STEEL);
      line(c,[[-30,-3],[-10,12],[12,1]],'#b3a780',2); rivets(c,[[-37,-25],[-29,13],[15,-11]]);
      shard(2,40,52,.55,1.13); shard(6,-28,55,.7,.77); shard(1,55,-25,1.2,.64); scorch(c,-5,12,25,22); break;
    case 8: // Fine armor fragments around an exposed chassis and wiring loom.
      shadow(c,-4,6,99,84);
      for(let i=0;i<6;i++)cable(c,[[-74+i*24,-50],[-64+i*22,3],[-76+i*24,58]],2,'#716154');
      for(let i=0;i<3;i++)cable(c,[[-75,-33+i*32],[3,-22+i*30],[74,-34+i*33]],2,'#675a50');
      shard(0,-42,-25,-.18,1.22); shard(4,35,-37,.28,1.15); shard(1,-28,43,-.57,1.17); shard(7,47,35,.65,1.04);
      scorch(c,1,4,39,35); shard(2,3,-2,.1,.53); break;
    case 9: // Severed cargo frame, jagged L footprint and detached thin skins.
      shadow(c,-17,3,82,95); shadow(c,37,57,60,30);
      plate(c,[[-70,-78],[-34,-82],[-27,-29],[-38,3],[-16,22],[-21,46],[66,38],[88,59],[64,78],[-61,76],[-75,24]],STEEL,rand);
      for(let i=0;i<5;i++)line(c,[[-66,-61+i*25],[-33,-61+i*25]],'#343a3a',3);
      for(let i=0;i<4;i++)line(c,[[-43+i*30,46],[-42+i*30,72]],'#384044',2.5);
      shard(1,-4,-24,.55,1.22); shard(4,28,21,-.2,1.2); shard(0,-36,10,.7,.73);
      cable(c,[[-45,-74],[-19,-70],[-16,-48],[10,-37]],2.5); scorch(c,-13,16,44,38); break;
    case 10: // Shattered engine auxiliaries, heat exchanger and bent coolant pipes.
      shadow(c,-1,7,97,86);
      plate(c,[[-52,-69],[0,-74],[13,-46],[-1,18],[-52,9],[-63,-27]],BLUE,rand);
      vents(c,-47,-58,10,36,6); plate(c,[[-50,12],[-1,19],[-13,36],[-59,26]],COPPER);
      for(let i=0;i<3;i++)cable(c,[[13+i*15,-59],[5+i*15,-18],[20+i*15,0],[9+i*15,39]],8,i%2?'#526a70':'#8a725a');
      shard(7,43,51,.5,1.12); shard(5,-33,59,-.22,1.09); shard(4,32,-19,.3,.69);
      turbine(c,42,-52,18,true); scorch(c,-4,11,37,38); ember(c,-7,5); break;
    case 11: // Folded corrugated hull skin, snapped spars and charred components.
      shadow(c,-5,5,106,82);
      place(c,-12,-7,-.55,1,()=>{
        plate(c,[[-75,-33],[45,-38],[78,-14],[67,19],[25,36],[-68,23]],CHAR,rand);
        for(let i=0;i<10;i++)line(c,[[-62+i*13,-28],[-63+i*13,20]],i%3?'#748587':'#b0b5a0',2.5);
        line(c,[[-72,20],[29,31],[64,15]],'#ad9770',2);
      });
      shard(3,11,33,1.1,1.8); shard(0,-66,28,.4,1.08); shard(7,60,-32,-.4,.94); shard(2,50,54,.2,.91);
      scorch(c,-1,0,33,29); break;
  }
  scatter(c,rand,false,variant>=8?13:10,108,102);
}

export function warmDebrisSprites() {
  if (sources.length) return;
  const atlases = [surface(FRAGMENT_SIZE*COLUMNS,FRAGMENT_SIZE*3),surface(WRECK_SIZE*COLUMNS,WRECK_SIZE*3)];
  for(let atlas=0;atlas<2;atlas++) {
    const c=atlases[atlas].getContext('2d'), size=atlas?WRECK_SIZE:FRAGMENT_SIZE;
    c.lineJoin='round'; c.lineCap='round';
    for(let i=0;i<12;i++) {
      c.save(); c.translate(i%COLUMNS*size,Math.floor(i/COLUMNS)*size);
      // Transparent gutter prevents atlas neighbors leaking through bilinear sampling.
      c.beginPath(); c.rect(4,4,size-8,size-8); c.clip(); c.translate(size/2,size/2);
      const rand=random(0xd3b715 ^ Math.imul(i+1,0x9e3779b1) ^ atlas*0x51e2d3);
      if(atlas) wreck(c,i,rand); else fragment(c,i,rand);
      c.restore();
    }
  }
  for(let i=0;i<12;i++) {
    fragments[i].source=atlases[0]; wrecks[i].source=atlases[1];
    Object.freeze(fragments[i]); Object.freeze(wrecks[i]);
  }
  sources.push(...atlases); Object.freeze(sources);
}

const variantIndex = (value, count) => typeof value === 'number' && Number.isFinite(value) ? ((Math.trunc(value)%count)+count)%count : 0;
// Call warmDebrisSprites during preflight before consuming a record's source.
export function debrisFragment(variant=0,ground=false) { return fragments[(ground?8:0)+variantIndex(variant,ground?4:8)]; }
export function debrisWreck(variant=0) { return wrecks[variantIndex(variant,12)]; }
export function debrisTextureSources() { return sources; }
export function debrisTextureStats() {
  return { count:sources.length, bytes:sources.length?(FRAGMENT_SIZE**2+WRECK_SIZE**2)*12*4:0, fragments:12, wrecks:12 };
}
