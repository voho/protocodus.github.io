// Four bytes per tile keep a huge world well below localStorage's usual quota.
// Numeric elevation palettes are lossless: no rounding occurs when saving a company.
const TERRAINS = ['grass','water','forest','mountain','rock','sand','snow'];
const CORE_KEYS = new Set(['terrain','variant','detail','elevation','road','rail','bridge','tunnel']);
const FORMAT = 'transport-compact-v1';
function toBase64(bytes) {
  const pieces=[];
  for(let i=0;i<bytes.length;i+=8192)pieces.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
  return btoa(pieces.join(''));
}
function fromBase64(text, length) {
  if(typeof text!=='string'||text.length!==Math.ceil(length/3)*4)throw new Error('Invalid tile data.');
  const binary=atob(text);if(binary.length!==length)throw new Error('Invalid tile data.');
  const bytes=new Uint8Array(length);for(let i=0;i<length;i++)bytes[i]=binary.charCodeAt(i);return bytes;
}
export function encodeGame(game) {
  const {tiles,...state}=game;
  const bytes=new Uint8Array(tiles.length*4), elevations=[], elevationIds=new Map(), details=[null], detailIds=new Map();
  const extras=[];
  for(let i=0;i<tiles.length;i++) {
    const t=tiles[i],extra={};
    let elevation=elevationIds.get(t.elevation);
    if(elevation===undefined) {
      if(elevations.length<65535) {elevation=elevations.length;elevationIds.set(t.elevation,elevation);elevations.push(t.elevation);}
      else {elevation=0;extra.elevation=t.elevation;}
    }
    let detail=0;
    if(typeof t.detail==='string') {
      detail=detailIds.get(t.detail);
      if(detail===undefined) {
        if(details.length<32) {detail=details.length;detailIds.set(t.detail,detail);details.push(t.detail);}
        else {detail=0;extra.detail=t.detail;}
      }
    }
    let variant=t.variant;
    if(variant<0||variant>15) {extra.variant=variant;variant=0;}
    const flags=Number(t.road)|(Number(t.rail)<<1)|(Number(t.bridge)<<2)|(Number(t.tunnel)<<3);
    const packed=TERRAINS.indexOf(t.terrain)|(variant<<3)|(detail<<7)|(flags<<12);
    bytes[i*4]=packed&255;bytes[i*4+1]=packed>>>8;bytes[i*4+2]=elevation&255;bytes[i*4+3]=elevation>>>8;
    for(const [key,value] of Object.entries(t)) {
      if(CORE_KEYS.has(key)||((key==='building'||key==='zone')&&value===null))continue;
      extra[key]=value;
    }
    if(Object.keys(extra).length)extras.push([i,extra]);
  }
  return {format:FORMAT,state,tiles:{data:toBase64(bytes),elevations,details,extras}};
}
export function decodeGame(saved) {
  if(saved?.format!==FORMAT)return saved;
  const state=saved.state, packed=saved.tiles;
  if(!state||!Number.isInteger(state.width)||!Number.isInteger(state.height)||state.width<1||state.height<1||state.width*state.height>512*384)throw new Error('Invalid world dimensions.');
  const length=state.width*state.height;
  if(!packed||!Array.isArray(packed.elevations)||!packed.elevations.length||packed.elevations.length>65535||!Array.isArray(packed.details)||packed.details.length>32||packed.details[0]!==null||!Array.isArray(packed.extras)||packed.extras.length>length)throw new Error('Invalid tile palette.');
  if(!packed.elevations.every(e=>typeof e==='number'&&Number.isFinite(e))||!packed.details.slice(1).every(d=>typeof d==='string'))throw new Error('Invalid tile values.');
  const bytes=fromBase64(packed.data,length*4), tiles=new Array(length);
  for(let i=0;i<length;i++) {
    const p=bytes[i*4]|bytes[i*4+1]<<8,elevationId=bytes[i*4+2]|bytes[i*4+3]<<8,detailId=(p>>>7)&31;
    if((p&7)>=TERRAINS.length||elevationId>=packed.elevations.length||detailId>=packed.details.length)throw new Error('Invalid tile index.');
    const tile={terrain:TERRAINS[p&7],elevation:packed.elevations[elevationId],variant:(p>>>3)&15,road:Boolean(p&4096),rail:Boolean(p&8192),bridge:Boolean(p&16384),tunnel:Boolean(p&32768),building:null,zone:null};
    if(detailId)tile.detail=packed.details[detailId];
    tiles[i]=tile;
  }
  const seen=new Set();
  for(const entry of packed.extras) {
    if(!Array.isArray(entry)||entry.length!==2||!Number.isInteger(entry[0])||entry[0]<0||entry[0]>=length||seen.has(entry[0])||!entry[1]||typeof entry[1]!=='object'||Array.isArray(entry[1]))throw new Error('Invalid tile extras.');
    seen.add(entry[0]);tiles[entry[0]]={...tiles[entry[0]],...entry[1]};
  }
  return {...state,tiles};
}
