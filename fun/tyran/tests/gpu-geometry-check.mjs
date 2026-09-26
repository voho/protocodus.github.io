import assert from 'node:assert/strict';
import {installGeometry,parseColor} from '../geometry.js';
class TestContext{
 _emitEllipse(){return false;}
 constructor(){this._state={matrix:[2,0,0,2,7,9],globalAlpha:.8,composite:'source-over',fillStyle:'#ff9a7a',strokeStyle:'#a8dcff',lineWidth:2,lineCap:'butt',lineJoin:'miter',miterLimit:10,dash:[],lineDashOffset:0,shadowColor:'transparent',shadowBlur:0,shadowOffsetX:0,shadowOffsetY:0};this.batches=[];}
 _point(x,y){const m=this._state.matrix;return [m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];}
 _emitTriangles(v,paint){assert(v.length%9===0);for(let i=0;i<v.length;i++){assert(Number.isFinite(v[i]));if(i%3===2)assert(v[i]>=0&&v[i]<=1);}this.batches.push({vertices:[...v],paint});}
}
installGeometry(TestContext);const c=new TestContext();
assert.deepEqual(parseColor('#abc'),[170/255,187/255,204/255,1]);assert.deepEqual(parseColor('#ff000080'),[1,0,0,128/255]);assert.deepEqual(parseColor('rgba(10, 20, 30, .5)'),[10/255,20/255,30/255,.5]);
for(const radius of [.3,1,26,110,1400])for(const angle of [Math.PI*.2,Math.PI,Math.PI*2]){c.beginPath();c.ellipse(100,100,radius,radius*.77,.3,0,angle);c.fill();c.stroke();}
c.beginPath();c.moveTo(20,20);c.lineTo(5,40);c.lineTo(20,60);c.lineTo(13,40);c.closePath();c._state.shadowColor='#ff5d3a';c._state.shadowBlur=12;c.fill();c._state.shadowColor='transparent';
for(const cap of ['butt','round','square'])for(const join of ['miter','round','bevel']){c._state.lineCap=cap;c._state.lineJoin=join;c.beginPath();c.moveTo(20,20);c.lineTo(70,40);c.lineTo(20,60);c.stroke();}
c._state.dash=[12,9];c._state.lineDashOffset=-73;c.beginPath();c.moveTo(20,30);c.lineTo(2200,600);c.stroke();
const gradient=c.createLinearGradient(20,30,2200,600);gradient.addColorStop(0,'#ff9ad066');gradient.addColorStop(1,'#a8dcff00');assert.deepEqual([gradient.gradient.x0,gradient.gradient.y0],[47,69]);c._state.strokeStyle=gradient;c.stroke();
const path=c._geometry.current.points.slice();c._state.matrix=[.8,.2,-.1,1.3,10,20];c.stroke();assert.deepEqual(c._geometry.current.points,path,'stroke does not rewrite frozen backing path coordinates');
for(let i=0;i<1000;i++){c.beginPath();c.arc(i,4,.7,0,Math.PI*2);c.fill();}assert(c._geometry.pool.length<=128);
console.log(JSON.stringify({batches:c.batches.length,vertices:c.batches.reduce((n,b)=>n+b.vertices.length/3,0),pool:c._geometry.pool.length}));
