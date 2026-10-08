import test from 'node:test';
import assert from 'node:assert/strict';
import {isEngineeredTunnel,isTunnelTile,isUndergroundAt,TUNNEL_PORTAL_OFFSET} from '../structure-visibility.js';

function fixture(mode='road',axis='x',engineered=false){
  const width=32,height=32,game={width,height,revision:1,cities:[],industries:[],stations:[],tiles:Array.from({length:width*height},()=>({terrain:'grass',elevation:2/7,road:false,rail:false,bridge:false,tunnel:false}))};
  const at=(along,across=16)=>axis==='x'?{x:along,y:across}:{x:across,y:along};
  for(let along=10;along<=22;along++){
    const {x,y}=at(along),tile=game.tiles[y*width+x];tile[mode]=true;
    if(along>=14&&along<=18)Object.assign(tile,{terrain:'mountain',elevation:5/7,tunnel:true,...engineered?{structureAxis:axis,structureLevel:5}:{}});
  }
  return {game,at,tile:along=>{const {x,y}=at(along);return game.tiles[y*width+x];}};
}

test('automatic and engineered tunnels conceal carriers at the same portal mouth',()=>{
  for(const mode of ['road','rail'])for(const axis of ['x','y'])for(const engineered of [false,true]){
    const {game,at,tile}=fixture(mode,axis,engineered),before=structuredClone(game);
    assert.equal(isEngineeredTunnel(tile(16)),engineered);assert.equal(isTunnelTile(tile(16)),true);
    const samples=[[13.49,false],[13.5,false],[13.7,false],[14-TUNNEL_PORTAL_OFFSET,true],[13.9,true],[14,true],[16,true],[18,true],[18+TUNNEL_PORTAL_OFFSET,true],[18.25,false],[18.49,false],[18.5,false]];
    for(const [along,expected]of samples){const p=at(along);assert.equal(isUndergroundAt(game,p.x,p.y,mode),expected,`${mode}/${axis}/${engineered} at ${along}`);}
    assert.deepEqual(game,before,'concealing a saved crossing does not migrate or mutate it');
  }
});

test('only a connected exterior of the same mode opens a portal',()=>{
  for(const mode of ['road','rail']){
    const {game,at,tile}=fixture(mode,'x',true),p=at(13.7);
    assert.equal(isUndergroundAt(game,p.x,p.y,mode),false);
    tile(13)[mode]=false;tile(13)[mode==='road'?'rail':'road']=true;
    assert.equal(isUndergroundAt(game,p.x,p.y,mode),true,'another transport mode does not expose the bore');
    tile(13)[mode]=true;for(const x of [13,14])for(const y of [16,17])game.tiles[y*game.width+x].elevation=1/7;game.revision++;
    assert.equal(isUndergroundAt(game,p.x,p.y,mode),true,'a disconnected height does not create a visible portal');
    assert.equal(isUndergroundAt(game,14,16.3,mode),true,'an engineered tunnel has no perpendicular mouth');
  }
});

test('bridges, surface networks, ships and planes remain visible',()=>{
  const {game,tile}=fixture();
  assert.equal(isUndergroundAt(game,12,16,'road'),false);
  for(const mode of ['rail','water','air'])assert.equal(isUndergroundAt(game,16,16,mode),false);
  tile(16).bridge=true;assert.equal(isTunnelTile(tile(16)),false);assert.equal(isUndergroundAt(game,16,16,'road'),false);
  for(const [x,y]of [[-1,16],[100,16],[16,-1],[16,100],[NaN,16],[Infinity,16]])assert.equal(isUndergroundAt(game,x,y),false);
});
