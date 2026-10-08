import { networkEdgeAllowed } from './terrain-engineering.js';

// Engineering metadata describes the bore; automatic and saved mountain
// crossings also have tunnel:true and share the same underground presentation.
export function isEngineeredTunnel(tile) {
  return Boolean(tile?.tunnel && Number.isFinite(tile.structureLevel) && tile.structureLevel >= 1 && ['x', 'y'].includes(tile.structureAxis));
}
export const TUNNEL_PORTAL_OFFSET = .18;
export function isTunnelTile(tile) { return Boolean(tile?.tunnel&&!tile.bridge); }

// Vehicle positions use tile centers (integer coordinates), rather than corners.
export function isUndergroundAt(game, x, y, mode = null) {
  if(mode&&!['road','rail'].includes(mode))return false;
  const tx = Math.floor(x + .5), ty = Math.floor(y + .5);
  if(tx<0||ty<0||tx>=game.width||ty>=game.height)return false;
  const tile=game.tiles[ty*game.width+tx];if(!isTunnelTile(tile)||mode&&!tile[mode])return false;
  const modes=mode?[mode]:['road','rail'].filter(key=>tile[key]);
  // The outer part of a portal tile is exposed road/track. Hide the body at
  // the mouth itself, not at the earlier boundary of the containing tile.
  for(const [dx,dy]of [[-1,0],[1,0],[0,-1],[0,1]]){
    if(tile.structureAxis&&(tile.structureAxis==='x'?dy:dx))continue;
    const nx=tx+dx,ny=ty+dy;if(nx<0||ny<0||nx>=game.width||ny>=game.height)continue;
    const neighbor=game.tiles[ny*game.width+nx];
    if(!isTunnelTile(neighbor)&&(neighbor.terrain!=='mountain'||neighbor.bridge)&&modes.some(key=>neighbor?.[key]&&networkEdgeAllowed(tile,neighbor,dx,dy,key,game,tx,ty))&&(x-tx)*dx+(y-ty)*dy>TUNNEL_PORTAL_OFFSET+1e-9)return false;
  }
  return true;
}
