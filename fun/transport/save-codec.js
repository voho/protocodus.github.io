import { MAX_WORLD_TILES, NEW_WORLD_SIZES, generateWorld, seedNumber, supportsGenerationVersion } from './world.js';

// Four bytes per tile preserve every gameplay field. Vast worlds store 15 bits
// per safe UTF-16 character instead of base64's six: localStorage charges for
// UTF-16 code units, so this leaves room for named saves without lossy terrain.
// Numeric elevation palettes are lossless: no rounding occurs when saving a company.
const TERRAINS = ['grass','water','forest','mountain','rock','sand','snow'];
const CORE_KEYS = new Set(['terrain','variant','detail','elevation','road','rail','bridge','tunnel']);
const FORMAT = 'transport-compact-v1';
const PROCEDURAL_FORMAT = 'transport-procedural-v1';
const baselines = new WeakMap();
const UNPACKED = 0xffffffff;

// Exact, four-byte snapshots keep a pristine 2048² world in 16 MiB. Sparse
// extras preserve buildings and future fields without retaining a second world.
function baselineCode(tile, details, register = false) {
  const terrain = TERRAINS.indexOf(tile.terrain), elevation = tile.elevation * 1024;
  if (terrain < 0 || !Number.isInteger(elevation) || elevation < 0 || elevation > 2047 || !Number.isInteger(tile.variant) || tile.variant < 0 || tile.variant > 15) return UNPACKED;
  let detail = 0;
  if (tile.detail !== undefined) {
    if (typeof tile.detail !== 'string') return UNPACKED;
    detail = details.get(tile.detail);
    if (detail === undefined && register && details.size < 63) { detail = details.size + 1; details.set(tile.detail, detail); }
    if (detail === undefined) return UNPACKED;
  }
  if (typeof tile.road !== 'boolean' || typeof tile.rail !== 'boolean' || typeof tile.bridge !== 'boolean' || typeof tile.tunnel !== 'boolean') return UNPACKED;
  const publicRoad = tile.publicRoad === undefined ? 0 : tile.publicRoad === false ? 1 : tile.publicRoad === true ? 2 : -1;
  if (publicRoad < 0) return UNPACKED;
  return (terrain | tile.variant << 3 | detail << 7 | elevation << 13 | Number(tile.road) << 24 | Number(tile.rail) << 25 | Number(tile.bridge) << 26 | Number(tile.tunnel) << 27 | publicRoad << 28) >>> 0;
}
function tileExtras(tile) {
  let extra;
  for (const key in tile) {
    // Known terrain fields dominate a multi-million-cell scan. A switch avoids
    // repeated Set lookups while still preserving arbitrary future properties.
    switch (key) {
      case 'terrain': case 'variant': case 'detail': case 'elevation':
      case 'road': case 'rail': case 'bridge': case 'tunnel': case 'publicRoad': continue;
      case 'building': case 'zone': if (tile[key] === null) continue;
    }
    if (Object.hasOwn(tile,key)) (extra ??= {})[key] = tile[key];
  }
  return extra ? JSON.stringify(extra) : undefined;
}
export function rememberGeneratedWorld(game) {
  if (!supportsGenerationVersion(game.generationVersion) || !Object.hasOwn(NEW_WORLD_SIZES,game.size) || baselines.has(game.tiles)) return;
  const config = NEW_WORLD_SIZES[game.size];
  if (config.width !== game.width || config.height !== game.height || game.tiles.length !== game.width * game.height) throw new Error('Invalid generated world.');
  const codes = new Uint32Array(game.tiles.length), details = new Map(), extras = new Map(), unpacked = new Map();
  for (let i = 0; i < game.tiles.length; i++) {
    const tile = game.tiles[i];
    codes[i] = baselineCode(tile,details,true);
    if (codes[i] === UNPACKED) unpacked.set(i,JSON.stringify(tile));
    else { const extra = tileExtras(tile); if (extra !== undefined) extras.set(i,extra); }
  }
  baselines.set(game.tiles,{codes,details,extras,unpacked,generation:{version:game.generationVersion,biome:game.biome,seed:seedNumber(game.seed),size:game.size,width:game.width,height:game.height}});
}
function encodeIndices(indices) {
  const bytes = new Uint8Array(indices.length * 4); let cursor = 0, previous = 0;
  for (const index of indices) {
    let delta = index - previous; previous = index;
    do { const byte = delta & 127; delta >>>= 7; bytes[cursor++] = byte | (delta ? 128 : 0); } while (delta);
  }
  return encodeBytes(bytes.subarray(0,cursor),'utf16-15');
}
function decodeIndices(packed, length) {
  if (!Number.isInteger(packed.count) || packed.count < 0 || packed.count > length) throw new Error('Invalid changed tile count.');
  const bytes = decodeBytes(packed.indices,'utf16-15');
  if (bytes.length < packed.count || bytes.length > packed.count * 4) throw new Error('Invalid changed tile indices.');
  const indices = new Uint32Array(packed.count); let cursor = 0, previous = 0;
  for (let i = 0; i < indices.length; i++) {
    let delta = 0, shift = 0, byte;
    do {
      if (cursor >= bytes.length || shift > 21) throw new Error('Invalid changed tile index.');
      byte = bytes[cursor++]; delta += (byte & 127) * 2 ** shift; shift += 7;
    } while (byte & 128);
    const index = previous + delta;
    if (index >= length || (i > 0 && index <= previous)) throw new Error('Invalid changed tile order.');
    indices[i] = previous = index;
  }
  if (cursor !== bytes.length) throw new Error('Invalid changed tile data.');
  return indices;
}
function validateDimensions(state) {
  if (!state || !Number.isInteger(state.width) || !Number.isInteger(state.height) || state.width < 1 || state.height < 1 || state.width * state.height > MAX_WORLD_TILES) throw new Error('Invalid world dimensions.');
  return state.width * state.height;
}
function validateGeneration(saved) {
  const g = saved.generation, state = saved.state, config = NEW_WORLD_SIZES[g?.size];
  if (!g || !supportsGenerationVersion(g.version) || !config || !['taiga','tundra','desert'].includes(g.biome) || !Number.isInteger(g.seed) || g.seed < 0 || g.seed > 0xffffffff || g.width !== config.width || g.height !== config.height || state.width !== g.width || state.height !== g.height || state.size !== g.size || state.generationVersion !== g.version) throw new Error('Unsupported world generation version.');
}
export function savedTileCount(saved) {
  const length = validateDimensions(saved?.state);
  if (saved.format === PROCEDURAL_FORMAT) { validateGeneration(saved); if (!Number.isInteger(saved.tiles?.count) || saved.tiles.count < 0 || saved.tiles.count > length) throw new Error('Invalid changed tile count.'); return saved.tiles.count; }
  if (saved.format !== FORMAT) throw new Error('Unsupported save format.');
  return length;
}

function toBase64(bytes) {
  const pieces=[];
  for(let i=0;i<bytes.length;i+=8192)pieces.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
  return btoa(pieces.join(''));
}
function fromBase64(text, length) {
  if(typeof text!=='string'||(length!==undefined&&text.length!==Math.ceil(length/3)*4))throw new Error('Invalid tile data.');
  const binary=atob(text);if(length!==undefined&&binary.length!==length)throw new Error('Invalid tile data.');
  const bytes=new Uint8Array(binary.length);for(let i=0;i<bytes.length;i++)bytes[i]=binary.charCodeAt(i);return bytes;
}
export function encodeBytes(bytes, encoding = 'base64') {
  if(encoding==='base64')return toBase64(bytes);
  if(encoding!=='utf16-15')throw new Error('Unknown byte encoding.');
  const padding=(15-(bytes.length*8)%15)%15, chars=[String.fromCharCode(256+padding)];
  let bits=0,buffer=0,batch=[];
  for(const byte of bytes) {
    buffer|=byte<<bits;bits+=8;
    if(bits>=15){batch.push(256+(buffer&32767));buffer>>>=15;bits-=15;}
    if(batch.length===8192){chars.push(String.fromCharCode(...batch));batch=[];}
  }
  if(bits)batch.push(256+buffer);
  if(batch.length)chars.push(String.fromCharCode(...batch));
  return chars.join('');
}
export function decodeBytes(text, encoding = 'base64', length) {
  if(encoding==='base64')return fromBase64(text,length);
  if(encoding!=='utf16-15'||typeof text!=='string'||!text.length)throw new Error('Unknown byte encoding.');
  const padding=text.charCodeAt(0)-256, bitLength=(text.length-1)*15-padding;
  if(padding<0||padding>14||bitLength<0||bitLength%8||(length!==undefined&&bitLength!==length*8))throw new Error('Invalid byte length.');
  const bytes=new Uint8Array(bitLength/8);
  let bits=0,buffer=0,index=0;
  for(let i=1;i<text.length;i++) {
    const code=text.charCodeAt(i)-256;
    if(code<0||code>32767)throw new Error('Invalid byte character.');
    buffer|=code<<bits;bits+=15;
    while(bits>=8&&index<bytes.length){bytes[index++]=buffer&255;buffer>>>=8;bits-=8;}
  }
  if(buffer!==0||index!==bytes.length)throw new Error('Invalid byte padding.');
  return bytes;
}
function encodeTiles(tiles, indices, encoding) {
  const count = indices ? indices.length : tiles.length;
  const bytes=new Uint8Array(count*4), elevations=[], elevationIds=new Map(), details=[null], detailIds=new Map();
  const extras=[];
  for(let i=0;i<count;i++) {
    const t=tiles[indices ? indices[i] : i];let extra=null;
    let elevation=elevationIds.get(t.elevation);
    if(elevation===undefined) {
      if(elevations.length<65535) {elevation=elevations.length;elevationIds.set(t.elevation,elevation);elevations.push(t.elevation);}
      else {elevation=0;(extra??={}).elevation=t.elevation;}
    }
    let detail=0;
    if(typeof t.detail==='string') {
      detail=detailIds.get(t.detail);
      if(detail===undefined) {
        if(details.length<32) {detail=details.length;detailIds.set(t.detail,detail);details.push(t.detail);}
        else {detail=0;(extra??={}).detail=t.detail;}
      }
    }
    let variant=t.variant;
    if(variant<0||variant>15) {(extra??={}).variant=variant;variant=0;}
    const flags=Number(t.road)|(Number(t.rail)<<1)|(Number(t.bridge)<<2)|(Number(t.tunnel)<<3);
    const packed=TERRAINS.indexOf(t.terrain)|(variant<<3)|(detail<<7)|(flags<<12);
    bytes[i*4]=packed&255;bytes[i*4+1]=packed>>>8;bytes[i*4+2]=elevation&255;bytes[i*4+3]=elevation>>>8;
    // Most terrain has no extras. Avoid allocating an object and a dozen entry
    // arrays per tile during the synchronous autosave on a 442,368-cell world.
    for(const key in t) {
      if(CORE_KEYS.has(key)||((key==='building'||key==='zone')&&t[key]===null)||!Object.hasOwn(t,key))continue;
      (extra??={})[key]=t[key];
    }
    if(extra)extras.push([i,extra]);
  }
  return {data:encodeBytes(bytes,encoding),...(encoding==='base64'?{}:{encoding}),elevations,details,extras};
}
export function encodeGame(game) {
  const {tiles,...state}=game, baseline=baselines.get(tiles);
  if (baseline && game.generationVersion === baseline.generation.version && game.size === baseline.generation.size && game.width === baseline.generation.width && game.height === baseline.generation.height) {
    const indices=[];
    for (let i=0;i<tiles.length;i++) {
      const tile=tiles[i], code=baselineCode(tile,baseline.details);
      if (code !== baseline.codes[i] || (code === UNPACKED ? JSON.stringify(tile) !== baseline.unpacked.get(i) : tileExtras(tile) !== baseline.extras.get(i))) indices.push(i);
    }
    return {format:PROCEDURAL_FORMAT,state,generation:{...baseline.generation},tiles:{count:indices.length,indices:encodeIndices(indices),...encodeTiles(tiles,indices,'utf16-15')}};
  }
  return {format:FORMAT,state,tiles:encodeTiles(tiles,null,tiles.length>512*384?'utf16-15':'base64')};
}
function decodeTiles(packed,length,validateOnly=false) {
  if(!packed||!Array.isArray(packed.elevations)||(!packed.elevations.length&&length>0)||packed.elevations.length>65535||!Array.isArray(packed.details)||packed.details.length>32||packed.details[0]!==null||!Array.isArray(packed.extras)||packed.extras.length>length)throw new Error('Invalid tile palette.');
  if(!packed.elevations.every(e=>typeof e==='number'&&Number.isFinite(e))||!packed.details.slice(1).every(d=>typeof d==='string'))throw new Error('Invalid tile values.');
  const bytes=decodeBytes(packed.data,packed.encoding??'base64',length*4), tiles=validateOnly?null:new Array(length);
  for(let i=0;i<length;i++) {
    const p=bytes[i*4]|bytes[i*4+1]<<8,elevationId=bytes[i*4+2]|bytes[i*4+3]<<8,detailId=(p>>>7)&31;
    if((p&7)>=TERRAINS.length||elevationId>=packed.elevations.length||detailId>=packed.details.length)throw new Error('Invalid tile index.');
    if(validateOnly)continue;
    const tile={terrain:TERRAINS[p&7],elevation:packed.elevations[elevationId],variant:(p>>>3)&15,road:Boolean(p&4096),rail:Boolean(p&8192),bridge:Boolean(p&16384),tunnel:Boolean(p&32768),building:null,zone:null};
    if(detailId)tile.detail=packed.details[detailId];
    tiles[i]=tile;
  }
  const seen=new Set();
  for(const entry of packed.extras) {
    if(!Array.isArray(entry)||entry.length!==2||!Number.isInteger(entry[0])||entry[0]<0||entry[0]>=length||seen.has(entry[0])||!entry[1]||typeof entry[1]!=='object'||Array.isArray(entry[1]))throw new Error('Invalid tile extras.');
    seen.add(entry[0]);if(!validateOnly)tiles[entry[0]]={...tiles[entry[0]],...entry[1]};
  }
  return tiles;
}
// Metadata inspection validates packed data but never regenerates millions of
// terrain objects just to open the save dialog.
export function inspectSavedGame(saved) {
  if (saved?.format !== FORMAT && saved?.format !== PROCEDURAL_FORMAT) return null;
  const count = savedTileCount(saved);
  if (saved.format === PROCEDURAL_FORMAT) decodeIndices(saved.tiles, saved.state.width * saved.state.height);
  decodeTiles(saved.tiles,count,true);
  return saved.state;
}
export function decodeGame(saved) {
  if (saved?.format !== FORMAT && saved?.format !== PROCEDURAL_FORMAT) return saved;
  const count = savedTileCount(saved), patches = decodeTiles(saved.tiles,count);
  if (saved.format === FORMAT) return {...saved.state,tiles:patches};
  const indices = decodeIndices(saved.tiles,saved.state.width * saved.state.height), g = saved.generation;
  const generated = {...generateWorld(g.biome,g.seed,g.size,g.version),biome:g.biome,seed:g.seed};
  rememberGeneratedWorld(generated);
  for (let i=0;i<indices.length;i++) generated.tiles[indices[i]]=patches[i];
  return {...saved.state,tiles:generated.tiles};
}
