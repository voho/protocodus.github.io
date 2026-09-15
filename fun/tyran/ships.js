/* Original Tyran spacecraft. Coordinates and effects use logical canvas pixels. */

export const ENEMY_TYPES = Object.freeze([
  { name: 'Needle', hp: 15, radius: 12, speed: 115, score: 45, fireRate: 2.5, pattern: 'aim' },
  { name: 'Mantis', hp: 27, radius: 17, speed: 101, score: 70, fireRate: 2.2, pattern: 'aim' },
  { name: 'Corsair', hp: 48, radius: 22, speed: 78, score: 110, fireRate: 1.9, pattern: 'spread' },
  { name: 'Stingray', hp: 72, radius: 27, speed: 70, score: 145, fireRate: 1.7, pattern: 'spread' },
  { name: 'Bulwark', hp: 104, radius: 32, speed: 54, score: 220, fireRate: 1.8, pattern: 'burst' },
  { name: 'Lancer', hp: 145, radius: 36, speed: 42, score: 320, fireRate: 1.6, pattern: 'aim' },
  { name: 'Harbinger', hp: 205, radius: 41, speed: 43, score: 420, fireRate: 1.5, pattern: 'spiral' },
  { name: 'Reaper', hp: 290, radius: 46, speed: 57, score: 570, fireRate: 1.3, pattern: 'spread' },
  { name: 'Dreadnought', hp: 450, radius: 54, speed: 30, score: 900, fireRate: 1.2, pattern: 'burst' },
  { name: 'Sovereign', hp: 2600, radius: 110, speed: 21, score: 6200, fireRate: 0.8, pattern: 'boss' },
].map(Object.freeze));

// These ten neon flight palettes belong to the fleet layer only. Terrain and
// scenery use their own illustrated material palettes, so a ship always reads
// as a luminous, high-contrast silhouette even over a similarly colored world.
export const SHIP_PALETTES = Object.freeze([
  { id: 'canopy-sunfire', primary: '#f05245', rim: '#ffe35f', core: '#fff6c8', engine: '#ff9a4b', glow: '#ff6f58' },
  { id: 'polar-magenta', primary: '#ff3f9e', rim: '#ffd5ef', core: '#fffaff', engine: '#ff96d7', glow: '#ff69c8' },
  { id: 'dune-electric', primary: '#39e8ff', rim: '#d7ffff', core: '#efffff', engine: '#5ccfff', glow: '#4de5ff' },
  { id: 'reef-tangerine', primary: '#ff6338', rim: '#ffe98a', core: '#fff8d6', engine: '#ffc05a', glow: '#ff8e58' },
  { id: 'asteroid-acid', primary: '#74ed63', rim: '#f6ef55', core: '#f4ffd0', engine: '#b8e94c', glow: '#8cff62' },
  { id: 'mars-mint', primary: '#45f0cf', rim: '#e7ff9c', core: '#edfff8', engine: '#56e6c8', glow: '#4de5d4' },
  { id: 'forge-ice', primary: '#69cfff', rim: '#e7fff8', core: '#e7ffff', engine: '#9b8dff', glow: '#71d9ff' },
  { id: 'metro-lime', primary: '#f4ff52', rim: '#8affdf', core: '#fffed6', engine: '#ff9be9', glow: '#d8ff5c' },
  { id: 'mycelium-chartreuse', primary: '#c7ff57', rim: '#ffb4eb', core: '#f8ffd9', engine: '#c785ff', glow: '#cfff65' },
  { id: 'void-gold', primary: '#ffc94f', rim: '#ffefff', core: '#fff4c0', engine: '#7d8dff', glow: '#ffc75e' },
].map(Object.freeze));

export function shipPalette(world = 0, fallback = '#ff7866') {
  const palette = SHIP_PALETTES[Math.abs(Math.floor(world || 0)) % SHIP_PALETTES.length];
  return palette || { id: 'custom', primary: fallback, rim: '#d9f5ff', core: '#ffffff', engine: '#ff9a4b', glow: fallback };
}

const hulls = new Map();
const flames = new Map();
const glows = new Map();
const silhouettes = new Map();
const lights = new Map();
const styles = new Map();
const TAU = Math.PI * 2;

// Every design is drawn nose-up; enemy ships are turned toward the player.
const SHAPES = [
  { outline: [[0,-100],[17,-58],[18,-15],[45,36],[41,68],[15,43],[10,79],[-10,79],[-15,43],[-41,68],[-45,36],[-18,-15],[-17,-58]], engines: [[0,74,11]], core: [0,-19,9] },
  { outline: [[0,-81],[17,-42],[28,-30],[55,-74],[62,-67],[55,21],[42,73],[25,62],[25,9],[14,30],[10,66],[-10,66],[-14,30],[-25,9],[-25,62],[-42,73],[-55,21],[-62,-67],[-55,-74],[-28,-30],[-17,-42]], engines: [[-38,63,10],[38,63,10]], core: [0,-18,11] },
  { outline: [[0,-83],[21,-41],[24,-8],[82,28],[99,69],[87,76],[41,46],[20,37],[15,66],[-15,66],[-20,37],[-41,46],[-87,76],[-99,69],[-82,28],[-24,-8],[-21,-41]], engines: [[-21,50,11],[21,50,11]], core: [0,-17,10] },
  { outline: [[0,-77],[27,-48],[60,-42],[103,-10],[88,15],[72,17],[52,56],[31,46],[20,76],[0,60],[-20,76],[-31,46],[-52,56],[-72,17],[-88,15],[-103,-10],[-60,-42],[-27,-48]], engines: [[-30,47,12],[30,47,12]], core: [0,-5,14] },
  { outline: [[-20,-71],[20,-71],[30,-47],[72,-63],[87,-36],[87,35],[72,68],[47,68],[35,47],[21,78],[-21,78],[-35,47],[-47,68],[-72,68],[-87,35],[-87,-36],[-72,-63],[-30,-47]], engines: [[-61,60,13],[61,60,13],[0,72,13]], core: [0,-15,13] },
  { outline: [[-8,-109],[8,-109],[13,-39],[32,-49],[36,-90],[47,-90],[51,-22],[76,15],[72,73],[44,77],[24,56],[13,89],[-13,89],[-24,56],[-44,77],[-72,73],[-76,15],[-51,-22],[-47,-90],[-36,-90],[-32,-49],[-13,-39]], engines: [[-51,71,13],[51,71,13]], core: [0,4,15] },
  { outline: [[0,-82],[31,-66],[36,-40],[68,-60],[98,-28],[98,59],[83,77],[53,67],[40,32],[27,47],[17,78],[-17,78],[-27,47],[-40,32],[-53,67],[-83,77],[-98,59],[-98,-28],[-68,-60],[-36,-40],[-31,-66]], engines: [[-78,66,13],[78,66,13],[0,73,14]], core: [0,-7,17] },
  { outline: [[0,-85],[22,-56],[26,-26],[43,-34],[68,-73],[89,-102],[101,-94],[91,-37],[74,22],[53,54],[30,39],[18,75],[0,55],[-18,75],[-30,39],[-53,54],[-74,22],[-91,-37],[-101,-94],[-89,-102],[-68,-73],[-43,-34],[-26,-26],[-22,-56]], engines: [[-39,39,12],[39,39,12],[0,58,10]], core: [0,-17,13] },
  { outline: [[-23,-96],[23,-96],[39,-75],[40,-45],[55,-44],[58,-74],[84,-74],[102,-48],[102,55],[81,82],[50,77],[35,60],[20,96],[-20,96],[-35,60],[-50,77],[-81,82],[-102,55],[-102,-48],[-84,-74],[-58,-74],[-55,-44],[-40,-45],[-39,-75]], engines: [[-76,73,15],[76,73,15],[-14,86,11],[14,86,11]], core: [0,-9,20] },
  { outline: [[0,-109],[26,-88],[34,-63],[49,-57],[73,-98],[94,-98],[113,-67],[121,-17],[116,61],[99,103],[75,94],[65,61],[44,36],[31,56],[23,88],[-23,88],[-31,56],[-44,36],[-65,61],[-75,94],[-99,103],[-116,61],[-121,-17],[-113,-67],[-94,-98],[-73,-98],[-49,-57],[-34,-63],[-26,-88]], engines: [[-91,88,17],[91,88,17],[-16,77,12],[16,77,12]], core: [0,-13,25] },
];

const PLAYER = {
  outline: [[0,-105],[12,-74],[18,-28],[27,-8],[59,5],[65,-24],[75,-29],[84,45],[71,66],[37,42],[23,48],[17,79],[6,68],[0,78],[-6,68],[-17,79],[-23,48],[-37,42],[-71,66],[-84,45],[-75,-29],[-65,-24],[-59,5],[-27,-8],[-18,-28],[-12,-74]],
  engines: [[-14,65,10],[14,65,10]], core: [0,-32,10],
};

function surface(size) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(size, size);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  return canvas;
}

function rgb(color) {
  if (typeof color !== 'string') return [107,232,255];
  const hex = color.replace('#','');
  if (/^[\da-f]{3}$/i.test(hex)) return [...hex].map(n => parseInt(n+n,16));
  if (/^[\da-f]{6}$/i.test(hex)) return [0,2,4].map(i => parseInt(hex.slice(i,i+2),16));
  const parts = color.match(/[\d.]+/g);
  return parts?.length >= 3 ? parts.slice(0,3).map(Number) : [107,232,255];
}

function tint(color, amount = 0, alpha = 1) {
  const values = rgb(color).map(value => Math.round(amount >= 0 ? value + (255-value)*amount : value*(1+amount)));
  return `rgba(${values.join(',')},${alpha})`;
}

function path(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0][0],points[0][1]);
  for (let i=1;i<points.length;i++) ctx.lineTo(points[i][0],points[i][1]);
  ctx.closePath();
}

function polygon(ctx, points, fill, stroke = null, width = 1) {
  path(ctx,points);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle=stroke; ctx.lineWidth=width; ctx.stroke(); }
}

function line(ctx, points, color, width = 1) {
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (let i=1;i<points.length;i++) ctx.lineTo(...points[i]);
  ctx.strokeStyle=color;
  ctx.lineWidth=width;
  ctx.stroke();
}

function metal(ctx, light = '#879cb0', dark = '#1b263a', x = -65, y = -100) {
  const gradient=ctx.createLinearGradient(x,y,80,90);
  gradient.addColorStop(0,light);
  gradient.addColorStop(0.24,'#64778b');
  gradient.addColorStop(0.48,dark);
  gradient.addColorStop(0.65,'#405469');
  gradient.addColorStop(1,'#111b2a');
  return gradient;
}

function ivoryArmor(ctx) {
  const gradient = ctx.createLinearGradient(-65, -100, 80, 90);
  gradient.addColorStop(0, '#fff9dd'); gradient.addColorStop(.24, '#d9e1da');
  gradient.addColorStop(.48, '#83999d'); gradient.addColorStop(.66, '#e1e7dc'); gradient.addColorStop(1, '#485c69');
  return gradient;
}

function alloyArmor(ctx) {
  const gradient = ctx.createLinearGradient(-85, -115, 85, 100);
  gradient.addColorStop(0, '#e0e9ed'); gradient.addColorStop(.24, '#a8bcc7');
  gradient.addColorStop(.47, '#526b80'); gradient.addColorStop(.66, '#a1b9c5'); gradient.addColorStop(1, '#304253');
  return gradient;
}

function plate(ctx, points, fill) {
  polygon(ctx,points,fill,'#0c1420',2.2);
  line(ctx,points.slice(0,Math.min(4,points.length)),'rgba(219,239,248,.48)',0.9);
}

function mirrored(ctx, fn) {
  for (const direction of [-1,1]) {
    ctx.save();ctx.scale(direction,1);fn(direction);ctx.restore();
  }
}

function rivet(ctx,x,y,r=1.4) {
  ctx.fillStyle='#070d16';ctx.beginPath();ctx.arc(x,y,r+0.8,0,TAU);ctx.fill();
  ctx.fillStyle='#889ba9';ctx.beginPath();ctx.arc(x-.3,y-.4,r,0,TAU);ctx.fill();
}

function vent(ctx,x,y,w,h,color,vertical = false) {
  ctx.fillStyle='#070f1d';ctx.fillRect(x-w/2,y-h/2,w,h);
  ctx.strokeStyle='rgba(187,219,231,.25)';ctx.lineWidth=.7;ctx.strokeRect(x-w/2,y-h/2,w,h);
  const count=Math.floor((vertical?w:h)/3.6);
  for(let i=1;i<count;i++) {
    ctx.fillStyle=i%3===0?tint(color,-.26,.9):'#647385';
    if(vertical)ctx.fillRect(x-w/2+i*3.6,y-h/2+1,1.1,h-2);
    else ctx.fillRect(x-w/2+1,y-h/2+i*3.6,w-2,1.1);
  }
}

function gun(ctx,x,y,length=25,width=7,color='#ff7760') {
  ctx.fillStyle='#050b12';ctx.fillRect(x-width/2-2,y-3,width+4,length+7);
  const gradient=ctx.createLinearGradient(x-width/2,y,x+width/2,y);
  gradient.addColorStop(0,'#9badb8');gradient.addColorStop(.36,'#45586b');gradient.addColorStop(.75,'#202a39');gradient.addColorStop(1,'#667c8e');
  ctx.fillStyle=gradient;ctx.fillRect(x-width/2,y,width,length);
  ctx.fillStyle='#0a101b';ctx.fillRect(x-width/2-1,y-1,width+2,4);
  ctx.fillStyle=tint(color,.2);ctx.fillRect(x-width/2+1,y,width-2,1.5);
  for(let p=7;p<length;p+=6){ctx.fillStyle='#142434';ctx.fillRect(x-width/2,y+p,width,1.5);}
}

function core(ctx,x,y,r,color,player=false) {
  ctx.fillStyle='#060c15';ctx.beginPath();ctx.ellipse(x,y,r+5,r*1.2+5,0,0,TAU);ctx.fill();
  ctx.strokeStyle='#819aaa';ctx.lineWidth=2;ctx.stroke();
  if(player) {
    const glass=ctx.createLinearGradient(x-r,y-r*2,x+r,y+r);
    glass.addColorStop(0,'#f2ffff');glass.addColorStop(.24,tint(color,.2));glass.addColorStop(.48,'#307989');glass.addColorStop(1,'#061b2c');
    polygon(ctx,[[x,y-r*2],[x+r*.85,y-r*.7],[x+r*.72,y+r],[x,y+r*1.45],[x-r*.72,y+r],[x-r*.85,y-r*.7]],glass,'#b3d9dd',1.1);
    line(ctx,[[x-r*.43,y-r],[x-r*.38,y+r*.6]],'rgba(255,255,255,.7)',1.3);
  } else {
    const glow=ctx.createRadialGradient(x-r*.2,y-r*.25,0,x,y,r);
    glow.addColorStop(0,'#f4ffff');glow.addColorStop(.22,tint(color,.65));glow.addColorStop(.6,tint(color,-.12));glow.addColorStop(1,'#092330');
    ctx.fillStyle=glow;ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fill();
    ctx.strokeStyle=tint(color,.45,.7);ctx.lineWidth=.9;ctx.beginPath();ctx.arc(x,y,r+2.5,0,TAU);ctx.stroke();
    ctx.strokeStyle='#142b3d';ctx.lineWidth=2;
    for(let i=0;i<4;i++){const a=i*Math.PI/2;line(ctx,[[x+Math.cos(a)*r*.76,y+Math.sin(a)*r*.76],[x+Math.cos(a)*(r+5),y+Math.sin(a)*(r+5)]],'#142b3d',3);}
  }
}

function insignia(ctx,x,y,color,world) {
  ctx.save();ctx.translate(x,y);
  const sides=3+(world%4),radius=4.5;
  const vertices=Array.from({length:sides},(_,i)=>[Math.sin(i/sides*TAU)*radius,-Math.cos(i/sides*TAU)*radius]);
  polygon(ctx,vertices,tint(color,.52,.9));
  ctx.fillStyle='#132237';ctx.fillRect(-.8,-2,1.6,4);
  ctx.restore();
}

function shipDetails(ctx,kind,color,world,player) {
  const armor=player?ivoryArmor(ctx):alloyArmor(ctx);
  const accent=metal(ctx,tint(color,.42),tint(color,-.52));
  if(player) {
    mirrored(ctx,()=>{
      plate(ctx,[[17,-25],[28,6],[65,23],[74,48],[39,33],[24,39]],armor);
      plate(ctx,[[35,15],[59,24],[66,45],[41,31]],accent);
      plate(ctx,[[65,-22],[73,-25],[81,44],[71,59],[62,23]],armor);
      line(ctx,[[71,-9],[75,36],[69,44]],tint(color,.33),3.4);
      gun(ctx,65,-27,30,6,color);
      plate(ctx,[[8,17],[20,29],[20,59],[9,67]],'#435265');
      vent(ctx,13,39,7,23,color);
      rivet(ctx,29,19);rivet(ctx,69,39);rivet(ctx,22,34);
      ctx.fillStyle=tint(color,.7);ctx.fillRect(77,42,3,7);
    });
    plate(ctx,[[0,-101],[9,-70],[12,-41],[0,-32],[-12,-41],[-9,-70]],armor);
    line(ctx,[[0,-91],[0,-58]],'#f1fbff',1.5);
    plate(ctx,[[-12,-8],[12,-8],[16,17],[0,29],[-16,17]],armor);
    insignia(ctx,0,10,color,world);
    return;
  }

  switch(kind) {
    case 0:
      mirrored(ctx,()=>{
        plate(ctx,[[5,-74],[13,-46],[13,1],[32,37],[34,52],[13,29],[6,46]],armor);
        polygon(ctx,[[17,18],[36,43],[37,56],[19,32]],accent);
        gun(ctx,13,-38,21,4,color);rivet(ctx,21,33,1);
      });
      vent(ctx,0,34,12,24,color);break;
    case 1:
      mirrored(ctx,()=>{
        plate(ctx,[[30,-25],[54,-62],[48,18],[40,62],[30,54],[34,11]],armor);
        polygon(ctx,[[44,-38],[53,-54],[47,9],[42,31],[38,28]],accent);
        plate(ctx,[[5,-56],[13,-36],[18,12],[7,42]],armor);
        gun(ctx,39,-19,32,6,color);vent(ctx,38,40,10,17,color);
        rivet(ctx,35,8);rivet(ctx,44,-28);
      });break;
    case 2:
      mirrored(ctx,()=>{
        plate(ctx,[[21,2],[72,31],[89,61],[70,52],[32,27],[22,28]],armor);
        polygon(ctx,[[34,15],[70,34],[83,54],[37,28]],accent);
        line(ctx,[[46,27],[68,41],[73,49]],tint(color,.45),1.2);
        plate(ctx,[[6,-62],[16,-34],[19,11],[7,24]],armor);
        gun(ctx,37,6,21,6,color);vent(ctx,23,35,10,17,color);
        rivet(ctx,81,59);rivet(ctx,39,28);
      });break;
    case 3:
      mirrored(ctx,()=>{
        plate(ctx,[[21,-38],[57,-34],[89,-10],[63,9],[45,44],[33,33],[39,-4]],armor);
        polygon(ctx,[[35,-31],[58,-28],[75,-14],[48,-8]],accent);
        plate(ctx,[[7,-53],[25,-35],[23,24],[13,51],[7,39]],armor);
        gun(ctx,57,-23,25,8,color);vent(ctx,45,12,11,22,color);
        line(ctx,[[68,-11],[62,-5]],tint(color,.6),3);
        rivet(ctx,36,-26);rivet(ctx,48,31);
      });break;
    case 4:
      mirrored(ctx,()=>{
        plate(ctx,[[36,-35],[68,-51],[77,-31],[77,29],[65,55],[49,55],[39,29]],armor);
        plate(ctx,[[43,-23],[68,-35],[69,21],[59,33],[46,23]],accent);
        gun(ctx,58,-60,28,12,color);vent(ctx,59,12,18,22,color);
        for(let j=0;j<3;j++)line(ctx,[[45,33+j*5],[68,33+j*5]],'#798c9e',1.4);
        rivet(ctx,44,-24);rivet(ctx,72,28);rivet(ctx,49,48);
      });
      plate(ctx,[[-15,-61],[15,-61],[25,-35],[20,29],[10,57],[-10,57],[-20,29],[-25,-35]],armor);
      vent(ctx,0,37,22,18,color);break;
    case 5:
      mirrored(ctx,()=>{
        plate(ctx,[[26,-28],[42,-31],[65,17],[63,60],[46,65],[28,44]],armor);
        polygon(ctx,[[36,-14],[47,-7],[57,19],[56,46],[45,46]],accent);
        gun(ctx,41,-91,69,9,color);vent(ctx,49,32,11,22,color);
        plate(ctx,[[17,-26],[28,-21],[24,36],[15,42]],'#788794');
        rivet(ctx,58,55);rivet(ctx,32,-10);
      });
      gun(ctx,0,-107,86,12,color);
      plate(ctx,[[-16,28],[16,28],[9,74],[-9,74]],armor);vent(ctx,0,51,12,27,color);break;
    case 6:
      mirrored(ctx,()=>{
        plate(ctx,[[50,-31],[68,-49],[88,-21],[88,52],[78,64],[61,56],[49,17]],armor);
        plate(ctx,[[58,-20],[70,-34],[79,-18],[79,28],[67,33],[57,14]],accent);
        gun(ctx,65,-44,39,7,color);gun(ctx,81,-29,33,7,color);
        vent(ctx,71,43,23,13,color,true);rivet(ctx,55,3);rivet(ctx,82,53);
        core(ctx,68,10,7,color);
        plate(ctx,[[21,-50],[29,-39],[37,8],[23,26],[14,16]],armor);
      });
      plate(ctx,[[-19,-63],[0,-74],[19,-63],[16,-37],[-16,-37]],accent);
      vent(ctx,0,46,22,24,color);break;
    case 7:
      mirrored(ctx,()=>{
        plate(ctx,[[34,-19],[55,-42],[90,-85],[81,-32],[65,14],[48,39],[35,25]],armor);
        polygon(ctx,[[53,-23],[84,-68],[73,-22],[60,7],[49,18]],accent);
        line(ctx,[[62,-25],[78,-50]],tint(color,.45),2.2);
        gun(ctx,49,-34,36,7,color);vent(ctx,41,22,12,18,color);
        plate(ctx,[[5,-66],[16,-46],[20,-20],[11,-1]],armor);
        rivet(ctx,76,-32);rivet(ctx,55,20);
      });
      plate(ctx,[[-19,7],[0,19],[19,7],[14,32],[0,45],[-14,32]],armor);break;
    case 8:
      mirrored(ctx,()=>{
        plate(ctx,[[55,-34],[65,-64],[80,-64],[92,-42],[92,43],[75,68],[57,63],[44,37]],armor);
        plate(ctx,[[62,-25],[79,-37],[82,22],[71,41],[58,34]],accent);
        gun(ctx,68,-72,45,11,color);gun(ctx,87,-46,44,8,color);
        vent(ctx,73,11,20,22,color);vent(ctx,73,50,24,11,color,true);
        for(let j=0;j<4;j++)rivet(ctx,92,7+j*9,1.5);
        plate(ctx,[[10,-78],[26,-71],[29,-37],[13,-34]],armor);
        gun(ctx,21,-93,29,10,color);
        plate(ctx,[[10,20],[29,32],[24,58],[14,76],[7,68]],armor);
      });
      vent(ctx,0,-53,18,20,color);vent(ctx,0,46,20,27,color);break;
    case 9:
      mirrored(ctx,()=>{
        plate(ctx,[[51,-41],[79,-86],[91,-88],[103,-59],[111,-15],[107,49],[95,87],[81,79],[74,51],[54,24],[38,7]],armor);
        plate(ctx,[[62,-36],[84,-70],[93,-53],[99,-9],[91,30],[81,31],[62,4]],accent);
        plate(ctx,[[87,-53],[101,-41],[105,-2],[99,15],[94,-5]],'#a8a9ad');
        gun(ctx,82,-94,49,11,color);gun(ctx,102,-52,45,10,color);
        gun(ctx,66,-43,39,10,color);gun(ctx,91,4,32,12,color);
        core(ctx,86,-18,13,color);vent(ctx,93,57,24,17,color,true);
        for(let j=0;j<5;j++)line(ctx,[[108,8+j*7],[101,11+j*7]],'#78909f',1.6);
        for(const point of [[78,-77],[104,-17],[77,29],[98,74],[53,-9]])rivet(ctx,...point,1.8);
        plate(ctx,[[9,-81],[22,-73],[30,-41],[19,-30],[9,-44]],armor);
        plate(ctx,[[8,23],[30,27],[23,58],[12,72],[5,52]],armor);
        vent(ctx,17,45,13,22,color);
      });
      plate(ctx,[[0,-99],[16,-83],[13,-60],[0,-51],[-13,-60],[-16,-83]],accent);
      core(ctx,0,-75,7,color);break;
  }

  // Sector-specific fittings change both the livery and small armor details.
  const wingX=kind<2?24:kind<5?37:48;
  mirrored(ctx,()=>{
    if(world%3===0) {
      line(ctx,[[wingX,23],[wingX+7,29],[wingX+9,37]],tint(color,.5,.85),2);
    } else if(world%3===1) {
      for(let i=0;i<3;i++)polygon(ctx,[[wingX+i*3,26],[wingX+2+i*3,28],[wingX+i*3,33],[wingX-2+i*3,31]],tint(color,.35));
    } else {
      polygon(ctx,[[wingX-3,22],[wingX+7,27],[wingX+6,34],[wingX-4,29]],'#b9bac0');
      line(ctx,[[wingX,26],[wingX+3,28]],tint(color),2);
    }
  });
  insignia(ctx,0,kind===0?8:kind===5?34:25,color,world);
}

function hullSprite(kind,color,world,player,palette=shipPalette(world,color)) {
  const key=`${player?'p':kind}:${color}:${world}:${palette.id||palette.primary}`;
  if(hulls.has(key))return hulls.get(key);
  const shape=player?PLAYER:SHAPES[kind];
  const canvas=surface(kind===9?640:384);
  const ctx=canvas.getContext('2d');
  const scale=canvas.width/280;
  ctx.translate(canvas.width/2,canvas.height/2);ctx.scale(scale,scale);
  ctx.lineJoin='round';ctx.lineCap='round';
  const flightColor=palette.primary||color;
  // A dark undercarriage plus a silver rim preserves shape over both snow and foliage.
  // The cast shadow is a separate cached sprite so its sunlight direction stays fixed.
  ctx.save();ctx.translate(0,3);polygon(ctx,shape.outline,'#050910','#02070d',7);ctx.restore();
  polygon(ctx,shape.outline,player?ivoryArmor(ctx):alloyArmor(ctx),'#04101b',4.6);
  if(!player) { ctx.save();ctx.globalAlpha=.2;polygon(ctx,shape.outline,flightColor);ctx.restore(); }
  path(ctx,shape.outline);ctx.strokeStyle=player?'#eaf4ec':(palette.rim||'#b8d8e8');ctx.lineWidth=1.75;ctx.stroke();
  // Fine inset armor edge, a little wider on larger capital ships.
  ctx.save();ctx.scale(.946,.955);path(ctx,shape.outline);ctx.strokeStyle='rgba(4,12,23,.58)';ctx.lineWidth=1.4;ctx.stroke();ctx.restore();
  shipDetails(ctx,kind,flightColor,world,player);
  // Cached sector livery marks make otherwise similar silhouettes instantly
  // distinguishable: chevrons, lane stripes, signal rings and hazard bars.
  if(!player) {
    ctx.save();ctx.globalCompositeOperation='screen';ctx.globalAlpha=.62;ctx.strokeStyle=palette.rim||flightColor;ctx.fillStyle=palette.rim||flightColor;ctx.lineWidth=2;
    if(world%4===0) { ctx.beginPath();ctx.moveTo(-18,-52);ctx.lineTo(0,-39);ctx.lineTo(18,-52);ctx.stroke(); }
    else if(world%4===1) { for(let i=-1;i<=1;i++){ctx.beginPath();ctx.moveTo(-13+i*8,-33);ctx.lineTo(13+i*8,18);ctx.stroke();} }
    else if(world%4===2) { ctx.beginPath();ctx.arc(0,-13,18,Math.PI*.15,Math.PI*.85);ctx.stroke();ctx.beginPath();ctx.arc(0,-13,13,Math.PI*1.15,Math.PI*1.85);ctx.stroke(); }
    else { for(let i=-1;i<=1;i++)ctx.fillRect(-21+i*14,25,7,3); }
    ctx.restore();
  }
  for(const [x,y,r] of shape.engines) {
    plate(ctx,[[x-r*.8,y-10],[x+r*.8,y-10],[x+r,y+2],[x-r,y+2]],'#334354');
    ctx.fillStyle='#030b14';ctx.fillRect(x-r*.8,y-2,r*1.6,4);
    ctx.fillStyle=tint(palette.engine||flightColor,.6);ctx.fillRect(x-r*.65,y,r*1.3,2.3);
    line(ctx,[[x-r*.8,y-7],[x+r*.8,y-7]],palette.rim||'#a6bac6',1.2);
  }
  core(ctx,...shape.core,flightColor,player);
  // Discrete running lights retain the silhouettes in dark asteroid fields.
  const outline=shape.outline;
  for(let i=2;i<outline.length;i+=Math.max(3,Math.floor(outline.length/5))) {
    const [x,y]=outline[i];
    ctx.fillStyle=tint(palette.rim||flightColor,.7);ctx.beginPath();ctx.arc(x*.9,y*.9,player?1.4:1.25,0,TAU);ctx.fill();
  }
  hulls.set(key,canvas);
  if(hulls.size>56)hulls.delete(hulls.keys().next().value);
  return canvas;
}

function silhouetteSprites(kind,player) {
  const key=player?'player':kind;
  if(silhouettes.has(key))return silhouettes.get(key);
  const shape=player?PLAYER:SHAPES[kind];
  const shadow=surface(320),flash=surface(320);
  for(const [canvas,isShadow] of [[shadow,true],[flash,false]]) {
    const ctx=canvas.getContext('2d');
    ctx.translate(160,160);
    ctx.lineJoin='round';
    if(isShadow) {
      // Blur only happens once per silhouette, never during a gameplay frame.
      ctx.shadowColor='rgba(0,4,13,.8)';ctx.shadowBlur=13;
      polygon(ctx,shape.outline,'rgba(0,4,13,.79)','rgba(0,4,13,.17)',8);
    } else polygon(ctx,shape.outline,'#efffff');
  }
  const result={shadow,flash};silhouettes.set(key,result);return result;
}

function glowSprite(color) {
  if(glows.has(color))return glows.get(color);
  const canvas=surface(96),ctx=canvas.getContext('2d');
  const glow=ctx.createRadialGradient(48,48,0,48,48,48);
  glow.addColorStop(0,tint(color,.4,.7));glow.addColorStop(.18,tint(color,0,.35));glow.addColorStop(.6,tint(color,0,.075));glow.addColorStop(1,tint(color,0,0));
  ctx.fillStyle=glow;ctx.fillRect(0,0,96,96);glows.set(color,canvas);
  return canvas;
}

function flameSprite(color) {
  if(flames.has(color))return flames.get(color);
  const canvas=surface(192),ctx=canvas.getContext('2d');
  const glow=ctx.createRadialGradient(96,28,0,96,58,87);
  glow.addColorStop(0,'rgba(255,231,170,.8)');glow.addColorStop(.21,'rgba(255,170,70,.48)');
  glow.addColorStop(.55,'rgba(255,104,31,.12)');glow.addColorStop(1,'rgba(255,76,20,0)');
  ctx.fillStyle=glow;ctx.fillRect(0,0,192,192);
  const outer=ctx.createLinearGradient(0,15,0,180);
  outer.addColorStop(0,'#fff6c7');outer.addColorStop(.22,'#ffcd72');outer.addColorStop(.48,'rgba(255,139,48,.91)');
  outer.addColorStop(.77,'rgba(255,68,27,.4)');outer.addColorStop(1,'rgba(255,54,15,0)');
  ctx.fillStyle=outer;ctx.beginPath();ctx.moveTo(69,19);ctx.bezierCurveTo(63,68,87,120,96,181);ctx.bezierCurveTo(105,120,129,68,123,19);ctx.closePath();ctx.fill();
  const inner=ctx.createLinearGradient(0,17,0,126);
  inner.addColorStop(0,'#fff');inner.addColorStop(.18,tint(color,.88));inner.addColorStop(.47,'#ffffed');
  inner.addColorStop(.75,'rgba(255,239,191,.91)');inner.addColorStop(1,'rgba(255,185,91,0)');
  ctx.fillStyle=inner;ctx.beginPath();ctx.moveTo(81,18);ctx.bezierCurveTo(78,49,91,87,96,140);ctx.bezierCurveTo(101,87,114,49,111,18);ctx.closePath();ctx.fill();
  // Shock diamonds make the tiny white-hot core read as moving thrust, not a soft blob.
  for(let i=0;i<3;i++)polygon(ctx,[[96,35+i*24],[102-i,42+i*24],[96,51+i*24],[90+i,42+i*24]],`rgba(255,255,245,${.64-i*.15})`);
  flames.set(color,canvas);return canvas;
}

function lightsSprite(kind,color,player,palette=shipPalette(0,color)) {
  const key=`${player?'p':kind}:${color}:${palette.id||palette.primary}`;
  if(lights.has(key))return lights.get(key);
  const canvas=surface(320),ctx=canvas.getContext('2d'),shape=player?PLAYER:SHAPES[kind];
  ctx.translate(160,160);
  const warm=glowSprite(palette.engine||'#ff9a4b');
  for(const [x,y,r] of shape.engines) {
    const diameter=r*6.4;
    ctx.globalAlpha=.72;ctx.drawImage(warm,x-diameter/2,y+4-diameter/2,diameter,diameter);
    // A cool nozzle rim anchors the hot orange exhaust to the engine hardware.
    const diameterCool=r*2.9;
    ctx.globalAlpha=.7;ctx.drawImage(glowSprite(palette.glow||color),x-diameterCool/2,y-diameterCool/2,diameterCool,diameterCool);
  }
  const [x,y,r]=shape.core,diameter=r*(player?3.8:4.7);
  ctx.globalAlpha=.48;ctx.drawImage(glowSprite(color),x-diameter/2,y-diameter/2,diameter,diameter);
  lights.set(key,canvas);
  if(lights.size>56)lights.delete(lights.keys().next().value);
  return canvas;
}

function lightStyles(color) {
  if(styles.has(color))return styles.get(color);
  const result={capital:tint(color,.35,.6),shield:tint(color,.45),shieldGlint:tint(color,.75)};
  styles.set(color,result);return result;
}

/** Prepare cached artwork between stages, keeping vector rasterization out of combat. */
export function warmShipSprites(color,world=0,player=false) {
  const palette=typeof color==='object'&&color ? color : player ? {id:`player-${color||'default'}`,primary:color||'#71ecff',rim:'#f2ffff',core:'#ffffff',engine:'#ff9a4b',glow:color||'#71ecff'} : shipPalette(world,color||'#ff7866');
  color=palette.primary;
  world=Math.abs(Math.floor(world||0))%10;
  flameSprite(palette.engine||color);lightStyles(palette.glow||color);
  for(let kind=0;kind<(player?1:SHAPES.length);kind++) {
    silhouetteSprites(kind,player);
    hullSprite(kind,color,world,player,palette);
    lightsSprite(kind,palette.glow||color,player,palette);
  }
}

/**
 * Draw an original spacecraft with animated exhaust, core light and optional shield.
 * size: collision radius; kind: 0–9, -1, or 'player'; time: elapsed seconds.
 * options: { bank, hit, shield, player, phase, world, thrust, opacity, quality }.
 * bank is a gentle banking angle in radians; hit is a white flash from 0 to 1;
 * shield is opacity/strength from 0 to 1; world is the zero-based sector number.
 */
export function drawShip(ctx,x,y,size,kind,color,time=0,options={}) {
  const player=kind===-1||kind==='player'||options.player===true;
  kind=player?0:Math.max(0,Math.min(9,Math.floor(Number(kind)||0)));
  color=color||(player?'#71ecff':'#ff7866');
  const world=Math.abs(Math.floor(options.world||0))%10;
  const palette=options.palette || (player ? {id:`player-${color}`,primary:color,rim:'#f2ffff',core:'#ffffff',engine:'#ff9a4b',glow:color} : shipPalette(world,color));
  const flightColor=palette.primary||color;
  const shape=player?PLAYER:SHAPES[kind];
  const phase=Number(options.phase)||0;
  const pulse=.8+Math.sin(time*5+phase)*.2;
  const bank=Math.max(-.45,Math.min(.45,Number(options.bank)||0));
  const thrust=Math.max(0,Math.min(2,Number(options.thrust??1)||0));
  const detailed=options.quality!=='low';
  const scale=size/82,bankScale=1-Math.abs(bank)*.22;
  const silhouettes=silhouetteSprites(kind,player);
  // Keep the sun direction in world space when enemies face down or fighters bank.
  ctx.save();
  ctx.translate(x+5+size*.17,y+9+size*.24);
  ctx.rotate((player?0:Math.PI)+bank);ctx.scale(scale*bankScale*.97,scale*.97);
  ctx.globalAlpha*=(options.opacity??1)*.74;
  ctx.drawImage(silhouettes.shadow,-160,-160,320,320);ctx.restore();

  ctx.save();ctx.translate(x,y);ctx.rotate((player?0:Math.PI)+bank);
  ctx.scale(scale*bankScale,scale);
  if(options.opacity!=null)ctx.globalAlpha*=options.opacity;

  const flame=flameSprite(palette.engine||flightColor);
  ctx.save();ctx.globalCompositeOperation='screen';
  const exhaustAlpha=ctx.globalAlpha;
  for(let i=0;i<shape.engines.length;i++) {
    const [ex,ey,er]=shape.engines[i];
    const shimmer=1+Math.sin(time*31+i*2.7+phase)*.1;
    const length=(player?70:51)*(.48+thrust*.55)*shimmer;
    const width=er*(4.6+thrust*.2);
    ctx.globalAlpha=exhaustAlpha*(.79+thrust*.08);
    ctx.drawImage(flame,ex-width/2,ey-8,width,length+14);
  }
  ctx.restore();

  const sprite=hullSprite(kind,flightColor,world,player,palette);
  ctx.drawImage(sprite,-140,-140,280,280);

  ctx.save();ctx.globalCompositeOperation='screen';
  const [cx,cy,cr]=shape.core;
  if(detailed) {
    ctx.globalAlpha*=(.7+thrust*.14)*pulse;
    ctx.drawImage(lightsSprite(kind,palette.glow||flightColor,player,palette),-160,-160,320,320);
  }
  if(detailed&&kind>=6&&!player) {
    const rotation=time*.65+phase;
    ctx.strokeStyle=lightStyles(palette.glow||flightColor).capital;ctx.lineWidth=1.2;
    for(let i=0;i<3;i++) {
      ctx.beginPath();ctx.arc(cx,cy,cr+7,rotation+i*TAU/3,rotation+i*TAU/3+.9);ctx.stroke();
    }
  }
  ctx.restore();

  const hit=Math.max(0,Math.min(1,options.hit||0));
  if(hit>0) {
    ctx.save();ctx.globalCompositeOperation='screen';ctx.globalAlpha*=hit*.76;
    ctx.drawImage(silhouettes.flash,-160,-160,320,320);ctx.restore();
  }
  const shield=Math.max(0,Math.min(1,options.shield||0));
  if(shield>0) {
    ctx.save();ctx.globalCompositeOperation='screen';
    const lightStyle=lightStyles(palette.glow||flightColor),shieldAlpha=ctx.globalAlpha;
    ctx.globalAlpha=shieldAlpha*shield*(.18+pulse*.12);
    ctx.strokeStyle=lightStyle.shield;ctx.lineWidth=1.4;
    ctx.beginPath();ctx.ellipse(0,-3,112,127,0,0,TAU);ctx.stroke();
    ctx.globalAlpha=shieldAlpha*shield*.32;
    ctx.strokeStyle=lightStyle.shieldGlint;ctx.lineWidth=3;
    const angle=-Math.PI/2+Math.sin(time*.8)*.1;
    ctx.beginPath();ctx.ellipse(0,-3,112,127,0,angle-.48,angle+.48);ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}
