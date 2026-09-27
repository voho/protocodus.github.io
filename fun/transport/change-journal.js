// Daily ecology rewrites a few hundred terrain and detail cells, never heights,
// water, structures or sites. View caches may then patch only those cells
// instead of discarding everything. The journal is never saved and never read
// by the simulation: an unjournaled revision, a gap, overflow or a replaced
// tile array answers null, which means "rebuild as before".
const ENTRY_LIMIT=64,INDEX_LIMIT=65536,EMPTY=new Int32Array(0);
const journals=new WeakMap();

export function noteSurfaceChanges(game,from,to,indices){
  if(!(to>from))return;
  let ring=journals.get(game);
  if(!ring||ring.tiles!==game.tiles){ring={tiles:game.tiles,entries:[],size:0};journals.set(game,ring);}
  // Revisions only grow. An entry that cannot precede this one is unreachable.
  if(ring.entries.length&&ring.entries[ring.entries.length-1].to>from){ring.entries.length=0;ring.size=0;}
  const entry={from,to,kind:'surface',indices:Int32Array.from(new Set(indices)).sort()};
  ring.entries.push(entry);ring.size+=entry.indices.length;
  while(ring.entries.length>ENTRY_LIMIT||ring.size>INDEX_LIMIT)ring.size-=ring.entries.shift().indices.length;
}

// The sorted union of every cell changed in (revision, game.revision], or null
// unless surface entries cover that whole span contiguously for these tiles.
export function surfaceChangesSince(game,revision){
  const ring=journals.get(game),target=game.revision||0;revision=revision||0;
  if(ring&&ring.tiles!==game.tiles)return null;
  if(revision===target)return EMPTY;
  if(!ring||!(revision<target))return null;
  const covering=[];let cursor=target;
  for(let i=ring.entries.length-1;i>=0&&cursor>revision;i--){const entry=ring.entries[i];if(entry.to!==cursor||entry.kind!=='surface')return null;covering.push(entry);cursor=entry.from;}
  if(cursor!==revision)return null;
  if(covering.length===1)return covering[0].indices.slice();
  const union=new Set();for(const entry of covering)for(const index of entry.indices)union.add(index);
  return Int32Array.from(union).sort();
}
