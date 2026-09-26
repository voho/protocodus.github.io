// Local, seeded water detail painted inside the coastline clip. These washes
// live in terrain chunks; only a handful of restrained glints animate each frame.
const TONES={
  taiga:{deep:'#235f73',shelf:'#86b1a0',sand:'#c4c391',reflection:'#244d43'},
  tundra:{deep:'#365d82',shelf:'#a0c6bf',sand:'#d9dec5',reflection:'#3c6063'},
  desert:{deep:'#286d7b',shelf:'#92bea5',sand:'#dfc795',reflection:'#536d4c'},
};
function noise(x,y,seed){let n=Math.imul(x+37,374761393)^Math.imul(y+113,668265263)^seed;n=Math.imul(n^(n>>>13),1274126177);return((n^(n>>>16))>>>0)/4294967296;}
function stroke(c,points,color,width){c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.strokeStyle=color;c.lineWidth=width;c.stroke();}
function wash(c,x,y,r,color,alpha){const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,color+alpha);g.addColorStop(1,color+'00');c.fillStyle=g;c.fillRect(x-r,y-r,r*2,r*2);}

export function paintWaterRelief(c,b,tile,biome,seed,profile,layers){
  const tone=TONES[biome]||TONES.taiga;
  const land=(x,y)=>{const t=tile(x,y);return t&&t.terrain!=='water';};
  c.save();c.lineCap='round';
  for(let y=b.y0;y<b.y1;y++)for(let x=b.x0;x<b.x1;x++){
    const t=tile(x,y);if(t?.terrain!=='water')continue;
    const px=x*32,py=y*32,n=noise(x,y,seed),n2=noise(x+731,y-251,seed);
    let depth=4;
    for(let d=1;d<=3;d++)if(land(x-d,y)||land(x+d,y)||land(x,y-d)||land(x,y+d)||land(x-d,y-d)||land(x+d,y+d)){depth=d;break;}
    if(depth<4)wash(c,px+9+n*14,py+10+n2*12,25+n*10,tone.shelf,depth===1?'42':depth===2?'24':'10');
    else if(n>.3)wash(c,px+16,py+16,28+n2*12,tone.deep,'1b');
    // Submerged sand and stones trace shallow banks. Their world-anchored marks
    // meet seamlessly where cached chunks overlap, including fractional DPRs.
    if(depth===1){
      for(const [dx,dy]of [[0,-1],[-1,0],[1,0],[0,1]])if(land(x+dx,y+dy)){
        const bank=tile(x+dx,y+dy),bx=px+16+dx*13,by=py+16+dy*13;
        wash(c,bx,by,13,tone.sand,'35');
        if(dx<0||dy<0){
          const points=dy?[[px+3,py+4],[px+15,py+5.5],[px+29,py+4]]:[[px+4,py+3],[px+5.5,py+15],[px+4,py+29]];
          stroke(c,points,tone.deep+'29',4.5);
        }
        if(profile!=='region')for(let j=0;j<3;j++){
          const along=6+noise(x*7+j,y*3,seed)*20,xx=dx?bx:px+along,yy=dy?by:py+along;
          stroke(c,[[xx,yy],[xx+1.1+n,yy-.3]],tone.sand+'58',.65);
        }
        if(dy===-1&&((layers.trees&&bank.terrain==='forest')||(layers.buildings&&bank.building))){
          const reflectedTree=bank.terrain==='forest',color=reflectedTree?tone.reflection+'1c':'#d3cab124';
          for(let j=0;j<(n>.5?3:2);j++){const xx=px+5+j*9+n2*4,h=4+noise(x+j,y+19,seed)*7;stroke(c,[[xx,py+4],[xx-1,py+7],[xx+1,py+h]],color,reflectedTree?2.5:4);}
        }
      }
    }
    // Broken, gently curved ripples instead of identical horizontal dashes.
    const count=profile==='region'?1:2;
    for(let k=0;k<count;k++){
      const a=noise(x*3+k,y*5+13,seed),xx=px+4+a*21,yy=py+5+noise(x+37,y*2+k,seed)*22,w=3+n2*6;
      stroke(c,[[xx,yy],[xx+w*.45,yy-.5],[xx+w,yy]],tone.shelf+(k?'32':'28'),profile==='region'?.7:.6);
      if(profile==='detail'&&n>.68)stroke(c,[[xx+1,yy+2.1],[xx+w*.7,yy+2.3]],tone.deep+'25',.45);
    }
  }
  c.restore();
}

export function drawWaterMotion(c,x,y,river,vertical,day,biome){
  const tone=TONES[biome]||TONES.taiga,n=noise(x,y,9281),phase=(day%30)/30*Math.PI*2,offset=x*.71+y*.43;
  const drift=Math.sin(phase+offset)*2.5,length=river?5+n*4:3+n*6,xx=x*32+10+n*9,yy=y*32+12+Math.sin(phase+offset*.37)*2;
  c.save();c.globalAlpha=.35+(Math.sin(phase+offset*.55)+1)*.2;c.lineCap='round';
  stroke(c,vertical?[[xx,yy+drift],[xx+.6,yy+length*.45+drift],[xx,yy+length+drift]]:[[xx+drift,yy],[xx+length*.45+drift,yy-.5],[xx+length+drift,yy]],tone.shelf+'78',.7);
  if(!river&&n>.68)stroke(c,[[xx+1+drift,yy+2.8],[xx+length*.65+drift,yy+2.8]],tone.sand+'55',.5);
  c.restore();
}
