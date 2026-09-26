/** Hangar product previews composed once from the already decoded flight artwork. */
import { spriteCell } from './sprite-assets.js';
import { projectileTexture } from './projectile-sprites.js';

const WIDTH=640,HEIGHT=280,TAU=Math.PI*2,images=new Map(),decoded=new Map();
let ready;
const ITEMS=Object.freeze({
  'upgrade:weapon':'#91efe0','upgrade:shield':'#8ecfff','upgrade:hull':'#d8d4b5','upgrade:recharge':'#ffce8f',
  'upgrade:fireRate':'#82ddff','upgrade:firePower':'#ffb577',
  'weapon:pulse':'#9cfff0','weapon:scatter':'#ffd37a','weapon:lance':'#c9b2ff','weapon:plasma':'#ff9e7d',
  'supply:drone':'#ffc46b','supply:bomb':'#d8bcff','supply:life':'#9cfff0',
});
function path(c,points){c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();}
function glow(c,x,y,r,color,alpha=.3){
  const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,color);g.addColorStop(1,`${color}00`);
  c.save();c.globalAlpha=alpha;c.fillStyle=g;c.fillRect(x-r,y-r,r*2,r*2);c.restore();
}
function asset(c,name,index,x,y,width,height,alpha=1){
  const source=spriteCell(name,index);if(!source)return;
  const scale=Math.min(width/source.width,height/source.height),w=source.width*scale,h=source.height*scale;
  c.save();c.globalAlpha*=alpha;c.drawImage(source,x-w*.5,y-h*.5,w,h);c.restore();
}
function stage(c,color){
  const g=c.createLinearGradient(0,0,320,140);g.addColorStop(0,'#0b1c21');g.addColorStop(.55,'#142827');g.addColorStop(1,'#071517');
  c.fillStyle=g;c.fillRect(0,0,320,140);glow(c,160,76,98,color,.12);
  c.strokeStyle='#8fb9aa';c.globalAlpha=.065;c.lineWidth=.6;
  for(let x=-80;x<400;x+=24){c.beginPath();c.moveTo(160+(x-160)*.3,24);c.lineTo(x,140);c.stroke();}
  for(const y of [42,59,79,104,135]){c.beginPath();c.moveTo(0,y);c.lineTo(320,y);c.stroke();}
  c.globalAlpha=.19;c.strokeStyle=color;c.beginPath();c.ellipse(160,106,88,16,0,0,TAU);c.stroke();
  c.globalAlpha=.32;c.lineWidth=1;
  for(const x of [24,296]){const d=x<160?1:-1;c.beginPath();c.moveTo(x+d*15,20);c.lineTo(x,20);c.lineTo(x,34);c.stroke();c.beginPath();c.moveTo(x,106);c.lineTo(x,120);c.lineTo(x+d*15,120);c.stroke();}
  c.globalAlpha=1;
}
function fighter(c,x,y,w=107,h=112,alpha=1){
  c.save();c.globalAlpha=alpha*.22;c.filter='brightness(0)';asset(c,'fleet',0,x+6,y+10,w,h);c.restore();
  asset(c,'fleet',0,x,y,w,h,alpha);
}
function bolt(c,kind,color,x,y,w,h,angle=0){
  const texture=projectileTexture({team:0,kind,color});c.save();c.translate(x,y);c.rotate(angle);c.drawImage(texture,-w*.5,-h*.5,w,h);c.restore();
}
function firing(c,kind,color){
  fighter(c,160,112,78,93);
  if(kind==='pulse')for(const x of [150,170])for(const y of [19,44])bolt(c,kind,color,x,y,26,46);
  else if(kind==='scatter')for(const angle of [-.42,-.21,0,.21,.42]){
    const x=160+Math.sin(angle)*98,y=24+(1-Math.cos(angle))*64;
    bolt(c,kind,color,x,y,37,37,angle);
    c.strokeStyle=`${color}42`;c.lineWidth=1;c.beginPath();c.moveTo(160+Math.sin(angle)*22,68);c.lineTo(x,y+9);c.stroke();
  }else if(kind==='lance'){
    c.strokeStyle=`${color}32`;c.lineWidth=7;c.beginPath();c.moveTo(160,0);c.lineTo(160,72);c.stroke();bolt(c,kind,color,160,33,30,87);
  }else{glow(c,160,34,41,color,.32);bolt(c,kind,color,160,34,94,94);}
}
function armor(c){
  const plates=[[[111,52],[127,38],[135,83],[109,101],[97,91]],[[209,52],[193,38],[185,83],[211,101],[223,91]]];
  for(const points of plates){
    const g=c.createLinearGradient(100,42,218,103);g.addColorStop(0,'#a2b3b0');g.addColorStop(.32,'#e0ddd0');g.addColorStop(.46,'#677775');g.addColorStop(1,'#283a3e');
    path(c,points);c.fillStyle=g;c.fill();c.strokeStyle='#d1e3d8';c.lineWidth=.8;c.stroke();
    c.fillStyle='#15282b';for(const [x,y]of points){c.beginPath();c.arc(x+(160-x)*.04,y+(76-y)*.08,1.2,0,TAU);c.fill();}
  }
}
function fireRate(c,color){
  fighter(c,160,106,87,99);
  // Separate, evenly spaced pairs read as rapid volleys at card-thumbnail size.
  for(const [i,y]of [17,39,61].entries()){
    c.save();c.globalAlpha=.62+i*.18;
    for(const x of [145,175]){glow(c,x,y,12,color,.2);bolt(c,'pulse',color,x,y,17,26);}
    c.restore();
  }
  for(const side of [-1,1]){
    const x=160+side*57;
    c.strokeStyle=`${color}62`;c.lineWidth=1;c.beginPath();c.moveTo(x,23);c.lineTo(x,73);c.lineTo(x-side*10,82);c.stroke();
    for(let n=0;n<5;n++){c.fillStyle=n<3?'#bdf5ff':'#538896';c.fillRect(x-3,26+n*10,6,3);}
  }
}
function firePower(c,color){
  fighter(c,160,101,102,110);
  // A reinforced central emitter and one dense bolt distinguish power from cadence.
  const casing=c.createLinearGradient(138,55,182,101);casing.addColorStop(0,'#d3d9be');casing.addColorStop(.3,'#778f88');casing.addColorStop(1,'#293e3e');
  path(c,[[141,62],[147,52],[173,52],[179,62],[174,104],[146,104]]);c.fillStyle=casing;c.fill();c.strokeStyle='#cadcc5';c.lineWidth=.8;c.stroke();
  c.fillStyle='#172a2a';c.fillRect(150,68,20,30);
  for(const x of [146,171]){c.fillStyle='#e6c18f';c.fillRect(x,70,3,22);c.fillStyle='#556c64';c.fillRect(x,80,3,2);}
  glow(c,160,55,37,color,.43);c.fillStyle='#162c2a';c.beginPath();c.ellipse(160,60,16,10,0,0,TAU);c.fill();
  c.strokeStyle='#ffd6a0';c.lineWidth=2;c.stroke();
  bolt(c,'lance',color,160,30,48,77);
  glow(c,160,54,19,'#fff2cb',.64);
  c.strokeStyle=`${color}6b`;c.lineWidth=1;
  for(const side of [-1,1]){c.beginPath();c.moveTo(160+side*27,28);c.lineTo(160+side*35,47);c.lineTo(160+side*27,62);c.stroke();}
}
function build(key,color){
  const out=document.createElement('canvas');out.width=WIDTH;out.height=HEIGHT;
  const c=out.getContext('2d');c.scale(2,2);c.imageSmoothingQuality='high';stage(c,color);
  if(key.startsWith('weapon:'))firing(c,key.slice(7),color);
  else if(key==='upgrade:weapon'){
    fighter(c,160,83,104,116);for(const x of [127,193]){bolt(c,'pulse',color,x,47,27,77);c.fillStyle='#798d8b';c.fillRect(x-3,62,6,27);c.fillStyle='#c3d9ce';c.fillRect(x-1,60,2,23);}
    glow(c,160,74,42,color,.12);
  }else if(key==='upgrade:fireRate')fireRate(c,color);
  else if(key==='upgrade:firePower')firePower(c,color);
  else if(key==='upgrade:shield'){
    fighter(c,160,79);const g=c.createRadialGradient(155,69,18,160,76,66);g.addColorStop(0,'#7cdbff00');g.addColorStop(.85,'#7cdbff12');g.addColorStop(1,'#b6ecff5c');
    c.fillStyle=g;c.beginPath();c.ellipse(160,75,66,58,0,0,TAU);c.fill();
    for(let n=0;n<6;n++){c.strokeStyle=n%2?'#bcecffb8':'#6dceff52';c.lineWidth=n%2?1.1:2;c.beginPath();c.ellipse(160,75,68,60,0,n*TAU/6+.08,(n+1)*TAU/6-.06);c.stroke();}
  }else if(key==='upgrade:hull'){armor(c);fighter(c,160,78,103,113);}
  else if(key==='upgrade:recharge'){
    asset(c,'structures',3,160,77,130,121);
    for(const x of [132,187]){c.fillStyle='#899b8b';c.fillRect(x,52,3,49);c.fillStyle='#edcf92';c.fillRect(x+1,60,1,32);}
    glow(c,160,69,39,color,.43);c.strokeStyle='#ffc979';c.lineWidth=1.6;c.beginPath();c.ellipse(160,69,24,19,0,0,TAU);c.stroke();
    asset(c,'effects',1,160,69,47,44,.64);
  }else if(key==='supply:drone'){
    fighter(c,161,78,79,97,.55);fighter(c,111,75,60,73);fighter(c,211,75,60,73);
    for(const x of [111,211]){glow(c,x,103,20,color,.22);bolt(c,'pulse',color,x,27,19,29);}
  }else if(key==='supply:life'){
    fighter(c,199,73,86,98,.22);fighter(c,130,80,106,120);glow(c,130,100,31,color,.1);
  }else{
    asset(c,'projectiles',11,160,75,103,103);glow(c,160,75,47,color,.34);
    for(const radius of [37,48,61]){c.strokeStyle=radius===48?'#d3c2ffa8':'#ad91ec38';c.lineWidth=radius===48?1.4:.7;c.beginPath();c.ellipse(160,75,radius,radius*.72,-.3,.3,5.7);c.stroke();}
  }
  return out.toDataURL('image/png');
}
export function warmShopArt(){
  if(ready)return ready;
  for(const [key,color]of Object.entries(ITEMS))if(!images.has(key))images.set(key,build(key,color));
  // Keep decoded previews resident as well as the PNG data: opening the shop
  // never starts an asset request or a new drawing/compositing pass.
  ready=Promise.all([...images].map(async([key,src])=>{const preview=new Image();preview.src=src;await preview.decode();decoded.set(key,preview);}));
  return ready;
}
export function shopArtMarkup(key){
  const src=images.get(key);if(!src)return '';
  return `<span class="shop-art" aria-hidden="true"><img src="${src}" alt="" width="${WIDTH}" height="${HEIGHT}" draggable="false"></span>`;
}
export function shopArtStats(){return {count:images.size,decoded:decoded.size,keys:[...images.keys()],estimatedBytes:images.size*WIDTH*HEIGHT*4};}
