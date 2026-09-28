// Screen overlays that belong to fixed places (town labels, stop signs, industry markers) are placed together in
// projected display pixels, so a pan never moves one. A uniform grid answers which stored boxes a candidate meets;
// the renderer gives each overlay its first candidate that meets nothing it must avoid.
export function createOverlayGrid(cell=64) {
  const cells=new Map();let items=0;
  function visit(r,each){for(let y=Math.floor(r.y/cell),y1=Math.floor((r.y+r.h)/cell);y<=y1;y++)for(let x=Math.floor(r.x/cell),x1=Math.floor((r.x+r.w)/cell);x<=x1;x++)if(each((y+32768)*65536+x+32768))return;}
  return {
    add(item){visit(item,key=>{const list=cells.get(key);if(list)list.push(item);else cells.set(key,[item]);});items++;return item;},
    // The first stored box that overlaps r and passes test. Touching edges do not overlap.
    find(r,test=null){let found=null;visit(r,key=>{for(const item of cells.get(key)||[])if(item.x<r.x+r.w&&item.x+item.w>r.x&&item.y<r.y+r.h&&item.y+item.h>r.y&&(!test||test(item))){found=item;return true;}return false;});return found;},
    get items(){return items;},
    get cells(){return cells.size;}
  };
}
// A site's upright outline: its footprint diamond centred at cx,cy (half width and half depth), raised as a block
// until its roof peaks top pixels above the centre. The outline is a hexagon; its box leaves the open corners out.
export function siteShape(cx,cy,half,depth,top,owner=null){return{kind:'site',owner,cx,cy,half,depth,top,x:cx-half,y:cy-top,w:half*2,h:top+depth};}
export function insideShape(shape,x,y,margin=0){const dx=Math.abs(x-shape.cx),dy=y-shape.cy;return dx<=shape.half+margin&&dy<=shape.depth-dx/2+margin&&dy>=dx/2-shape.top-margin;}
