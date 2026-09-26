/** One collectible family: beveled teal cases, mint rims and pale emblems. */
export const BONUS_KINDS=Object.freeze(['repair','credit','rapid','invulnerable','power','drone','bomb']);
export const BONUS_PALETTE=Object.freeze({light:'#d9ffed',rim:'#8aefbd',glow:'#6bf3ac',dark:'#0b211e'});
const badges=new Map(),pickups=new Map();
const points=[[-18,-27],[18,-27],[27,-18],[27,18],[18,27],[-18,27],[-27,18],[-27,-18]];
function surface(size) {
  const out=typeof OffscreenCanvas==='undefined'?document.createElement('canvas'):new OffscreenCanvas(size,size);
  out.width=out.height=size;return out;
}
function path(c,vertices) {
  c.beginPath();vertices.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();
}
function emblem(c,kind) {
  c.fillStyle=BONUS_PALETTE.light;c.strokeStyle=BONUS_PALETTE.light;c.lineWidth=2.8;c.lineJoin='round';c.lineCap='round';
  if(kind==='repair'){
    path(c,[[-4,-14],[4,-14],[4,-4],[14,-4],[14,4],[4,4],[4,14],[-4,14],[-4,4],[-14,4],[-14,-4],[-4,-4]]);c.fill();
  } else if(kind==='credit'){
    c.beginPath();c.moveTo(10,-9);
    c.bezierCurveTo(5,-16,-10,-14,-10,-6);
    c.bezierCurveTo(-10,2,11,-2,11,7);
    c.bezierCurveTo(11,15,-5,16,-11,9);c.stroke();
    c.lineWidth=2.2;c.beginPath();c.moveTo(0,-18);c.lineTo(0,18);c.stroke();
  } else if(kind==='rapid'){
    path(c,[[3,-17],[-12,3],[-2,3],[-4,17],[13,-5],[3,-5]]);c.fill();
  } else if(kind==='invulnerable'){
    c.beginPath();c.moveTo(0,-15);c.lineTo(13,-10);c.lineTo(11,4);c.quadraticCurveTo(8,11,0,16);
    c.quadraticCurveTo(-8,11,-11,4);c.lineTo(-13,-10);c.closePath();c.stroke();
    c.beginPath();c.moveTo(-5,0);c.lineTo(-1,5);c.lineTo(6,-5);c.stroke();
  } else if(kind==='power'){
    // A geometric P stays crisp without depending on a loaded font.
    c.beginPath();c.moveTo(-8,14);c.lineTo(-8,-14);c.lineTo(4,-14);
    c.bezierCurveTo(16,-14,16,3,4,3);c.lineTo(-8,3);c.lineWidth=4;c.stroke();
  } else if(kind==='drone'){
    path(c,[[0,-16],[5,-4],[14,6],[14,13],[4,8],[0,12],[-4,8],[-14,13],[-14,6],[-5,-4]]);c.fill();
    c.fillStyle=BONUS_PALETTE.dark;path(c,[[0,-5],[3,4],[-3,4]]);c.fill();
  } else {
    path(c,Array.from({length:16},(_,i)=>{const angle=i*Math.PI/8-Math.PI/2,r=i%2?7:16;return [Math.cos(angle)*r,Math.sin(angle)*r];}));c.fill();
    c.fillStyle=BONUS_PALETTE.dark;c.beginPath();c.arc(0,0,3.5,0,Math.PI*2);c.fill();
  }
}
export function bonusBadge(kind) {
  const key=BONUS_KINDS.includes(kind)?kind:'credit';
  if(badges.has(key))return badges.get(key);
  const out=surface(64),c=out.getContext('2d');c.translate(32,32);
  c.save();c.translate(0,2);path(c,points);c.fillStyle='#020b10b3';c.fill();c.restore();
  path(c,points);const body=c.createLinearGradient(-22,-27,18,27);
  body.addColorStop(0,'#234f42');body.addColorStop(.5,'#102d26');body.addColorStop(1,BONUS_PALETTE.dark);
  c.fillStyle=body;c.fill();c.lineWidth=2;c.strokeStyle=BONUS_PALETTE.rim;c.stroke();
  path(c,points.map(([x,y])=>[x*.81,y*.81]));c.lineWidth=.8;c.strokeStyle='#8aefbd59';c.stroke();
  c.strokeStyle=BONUS_PALETTE.light;c.lineWidth=1.2;c.beginPath();c.moveTo(-16,-25);c.lineTo(16,-25);c.stroke();
  c.fillStyle=BONUS_PALETTE.rim;for(const x of [-23,23])c.fillRect(x-1,-3,2,6);
  emblem(c,key);badges.set(key,out);return out;
}
export function pickupTexture(kind) {
  const key=BONUS_KINDS.includes(kind)?kind:'credit';
  if(pickups.has(key))return pickups.get(key);
  const out=surface(112),c=out.getContext('2d'),glow=c.createRadialGradient(56,56,18,56,56,54);
  glow.addColorStop(0,`${BONUS_PALETTE.glow}50`);glow.addColorStop(.5,`${BONUS_PALETTE.glow}25`);glow.addColorStop(1,`${BONUS_PALETTE.glow}00`);
  c.fillStyle=glow;c.fillRect(0,0,112,112);c.drawImage(bonusBadge(key),24,24);
  pickups.set(key,out);return out;
}
