import { MAX_WORLD_TILES, NEW_WORLD_SIZES, generateWorld, seedNumber, supportsGenerationVersion, validGenerationOptions } from './world.js';
import { generatedElevation } from './world-tiles.js';
import { packRoutePaths, readRoutePaths } from './route-save-codec.js';
import { packFleet, readFleet } from './fleet-save-codec.js';

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

// The worker protocol carries the pristine recipe snapshot alongside the live
// terrain. Rebuilding it from edited tiles would silently lose future edits.
export function exportSaveBaseline(game,{copy=true}={}) {
  const baseline=baselines.get(game.tiles);
  return baseline?{...baseline,codes:copy?baseline.codes.slice():baseline.codes}:null;
}
export function importSaveBaseline(game,baseline) {
  if(!baseline)return;
  if(!(baseline.codes instanceof Uint32Array)||baseline.codes.length!==game.tiles.length||!(baseline.details instanceof Map)||!(baseline.extras instanceof Map)||!(baseline.unpacked instanceof Map))throw new Error('Invalid transferred save baseline.');
  baselines.set(game.tiles,baseline);
}

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
  baselines.set(game.tiles,{codes,details,extras,unpacked,generation:{version:game.generationVersion,biome:game.biome,seed:seedNumber(game.seed),size:game.size,width:game.width,height:game.height,...(game.generationOptions?{options:{...game.generationOptions}}:{})}});
}
function encodeIndices(indices,encoding='utf16-15') {
  const bytes = new Uint8Array(indices.length * 4); let cursor = 0, previous = 0;
  for (const index of indices) {
    let delta = index - previous; previous = index;
    do { const byte = delta & 127; delta >>>= 7; bytes[cursor++] = byte | (delta ? 128 : 0); } while (delta);
  }
  return encodeBytes(bytes.subarray(0,cursor),encoding);
}
function decodeIndices(packed, length) {
  if (!Number.isInteger(packed.count) || packed.count < 0 || packed.count > length) throw new Error('Invalid changed tile count.');
  const bytes = decodeBytes(packed.indices,packed.indexEncoding??'utf16-15');
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
  if (state.biome !== g.biome || !validGenerationOptions(g.size,g.options) || (g.options && g.version < 7) || !sameGenerationOptions(g.options,state.generationOptions)) throw new Error('Invalid world generation options.');
}
function sameGenerationOptions(a,b) {
  return a === undefined && b === undefined || Boolean(a && b && Object.keys(a).length === 2 && Object.keys(b).length === 2 && a.townCount === b.townCount && a.industryDistricts === b.industryDistricts);
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
  if(encoding==='utf16-15-rle')return encodeBytes(packByteRuns(bytes),'utf16-15');
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
  if(encoding==='utf16-15-rle')return unpackByteRuns(decodeBytes(text,'utf16-15'),length);
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

// Four-byte runs are particularly effective for terrain deltas: an entire
// road may differ from its generated ground by one identical network flag.
// Literal blocks keep arbitrary edited data bounded when it does not repeat.
function packByteRuns(input){
  const bytes=input.byteOffset%4?input.slice():input;
  const words=new Uint32Array(bytes.buffer,bytes.byteOffset,Math.floor(bytes.length/4));
  const out=new Uint8Array(bytes.length+Math.ceil(words.length/128)+9);
  let cursor=0,length=bytes.length;
  do{const byte=length&127;length>>>=7;out[cursor++]=byte|(length?128:0);}while(length);
  for(let i=0;i<words.length;){
    let end=i+1;while(end<words.length&&end<i+129&&words[end]===words[i])end++;
    if(end-i>=2){out[cursor++]=128+end-i-2;out.set(bytes.subarray(i*4,i*4+4),cursor);cursor+=4;i=end;}
    else{
      const start=i++;
      while(i<words.length&&i<start+128&&(i+1>=words.length||words[i]!==words[i+1]))i++;
      out[cursor++]=i-start-1;out.set(bytes.subarray(start*4,i*4),cursor);cursor+=(i-start)*4;
    }
  }
  const tail=bytes.length%4;if(tail){out.set(bytes.subarray(bytes.length-tail),cursor);cursor+=tail;}
  return out.subarray(0,cursor);
}
function unpackByteRuns(bytes,expectedLength){
  let cursor=0,length=0,shift=0,byte;
  do{if(cursor>=bytes.length||shift>21)throw new Error('Invalid tile run length.');byte=bytes[cursor++];length+=(byte&127)*2**shift;shift+=7;}while(byte&128);
  if(length>MAX_WORLD_TILES*4||(expectedLength!==undefined&&length!==expectedLength))throw new Error('Invalid tile run size.');
  const output=new Uint8Array(length),words=Math.floor(length/4);let word=0;
  while(word<words){
    if(cursor>=bytes.length)throw new Error('Truncated tile run.');
    const token=bytes[cursor++],repeat=token>=128,count=repeat?token-128+2:token+1,needed=repeat?4:count*4;
    if(word+count>words||cursor+needed>bytes.length)throw new Error('Invalid tile run.');
    if(repeat)for(let i=0;i<count;i++)output.set(bytes.subarray(cursor,cursor+4),(word+i)*4);
    else output.set(bytes.subarray(cursor,cursor+needed),word*4);
    cursor+=needed;word+=count;
  }
  const tail=length%4;if(cursor+tail!==bytes.length)throw new Error('Invalid tile run tail.');
  output.set(bytes.subarray(cursor),words*4);return output;
}
// Forest dates are sparse numeric columns, rather than tens of thousands of
// repeated JSON keys. A shared day palette and varint tile/field deltas keep
// continental autosaves within the existing storage budget, losslessly. Older
// saves still carry these fields in ordinary extras and remain readable.
function packTreeDates(packed, length, deltaLayout = false) {
  const days = [], dayIds = new Map(), records = [], extras = [];
  for (const [ordinal, original] of packed.extras) {
    if (!original) { extras.push([ordinal, original]); continue; }
    let extra = original;
    for (const [flag, key] of ['treeBornDay','treeClearedDay'].entries()) {
      const day = original[key]; if (!Number.isInteger(day)) continue;
      if (extra === original) extra = { ...original };
      delete extra[key];
      let id = dayIds.get(day);
      if (id === undefined) { id = days.length; dayIds.set(day, id); days.push(day); }
      records.push([ordinal * 2 + flag, id]);
    }
    if (Object.keys(extra).length) extras.push([ordinal, extra]);
    else if (deltaLayout) extras.push([ordinal, null]);
  }
  if (!records.length) return packed;
  const bytes = new Uint8Array(records.length * 8); let cursor = 0, previous = 0;
  const write = number => { do { const byte = number & 127; number >>>= 7; bytes[cursor++] = byte | (number ? 128 : 0); } while (number); };
  for (const [ordinal, id] of records) { write(ordinal - previous); write(id); previous = ordinal; }
  return { ...packed, extras, treeDates: { count: records.length, days, data: encodeBytes(bytes.subarray(0, cursor), 'utf16-15') } };
}
function readTreeDates(packed, length, write = null) {
  const dates = packed.treeDates; if (dates === undefined) return;
  if (!dates || !Number.isInteger(dates.count) || dates.count < 1 || dates.count > length * 2 || !Array.isArray(dates.days) || !dates.days.length || dates.days.length > dates.count || !dates.days.every(Number.isInteger)) throw new Error('Invalid tree date palette.');
  const bytes = decodeBytes(dates.data, 'utf16-15');
  if (bytes.length < dates.count * 2 || bytes.length > dates.count * 8) throw new Error('Invalid tree date data.');
  let cursor = 0, previous = 0;
  const read = () => {
    let value = 0, shift = 0, byte;
    do { if (cursor >= bytes.length || shift > 21) throw new Error('Invalid tree date index.'); byte = bytes[cursor++]; value += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128);
    return value;
  };
  for (let n = 0; n < dates.count; n++) {
    const ordinal = previous + read(), id = read();
    if (ordinal >= length * 2 || (n && ordinal <= previous) || id >= dates.days.length) throw new Error('Invalid tree date index.');
    previous = ordinal;
    if (write) write(Math.floor(ordinal / 2), ordinal % 2 ? 'treeClearedDay' : 'treeBornDay', dates.days[id]);
  }
  if (cursor !== bytes.length) throw new Error('Invalid tree date tail.');
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
  return packTreeDates({data:encodeBytes(bytes,encoding),...(encoding==='base64'?{}:{encoding}),elevations,details,extras},count);
}

export function encodeGame(game) {
  const {tiles,...rawState}=game, state=packFleet(packRoutePaths(rawState),{encodeBytes}), baseline=baselines.get(tiles);
  if (baseline && game.generationVersion === baseline.generation.version && game.size === baseline.generation.size && game.width === baseline.generation.width && game.height === baseline.generation.height && game.biome === baseline.generation.biome && sameGenerationOptions(game.generationOptions,baseline.generation.options)) {
    // Grow a typed index list only as edits are found. A fully developed4m-cell
    // world needs16MiB here, instead of a large growable array of JS numbers.
    let indexBuffer=new Uint32Array(Math.min(4096,tiles.length)),deltaBuffer=new Uint8Array(indexBuffer.length*4),count=0,packable=true;
    const extras=[];
    for (let i=0;i<tiles.length;i++) {
      const tile=tiles[i], code=baselineCode(tile,baseline.details);
      const extra=code===UNPACKED?undefined:tileExtras(tile),previousExtra=baseline.extras.get(i);
      if (code !== baseline.codes[i] || (code === UNPACKED ? JSON.stringify(tile) !== baseline.unpacked.get(i) : extra !== previousExtra)){
        if(code===UNPACKED||baseline.codes[i]===UNPACKED){packable=false;deltaBuffer=null;}
        if(count===indexBuffer.length){
          const grown=new Uint32Array(Math.min(tiles.length,Math.max(1,indexBuffer.length*2)));grown.set(indexBuffer);indexBuffer=grown;
          if(packable){const deltas=new Uint8Array(indexBuffer.length*4);deltas.set(deltaBuffer);deltaBuffer=deltas;}
        }
        indexBuffer[count]=i;
        if(packable){
          const delta=(code^baseline.codes[i])>>>0,offset=count*4;
          deltaBuffer[offset]=delta&255;deltaBuffer[offset+1]=(delta>>>8)&255;deltaBuffer[offset+2]=(delta>>>16)&255;deltaBuffer[offset+3]=delta>>>24;
          if(extra!==previousExtra)extras.push([count,extra===undefined?null:JSON.parse(extra)]);
        }
        count++;
      }
    }
    const indices=indexBuffer.subarray(0,count),deltaLayout=packable&&count>4096;
    return {format:PROCEDURAL_FORMAT,state,generation:{...baseline.generation},tiles:{count,indices:encodeIndices(indices,deltaLayout?'utf16-15-rle':'utf16-15'),...(deltaLayout?packTreeDates({indexEncoding:'utf16-15-rle',layout:'baseline-xor-v1',data:encodeBytes(deltaBuffer.subarray(0,count*4),'utf16-15-rle'),encoding:'utf16-15-rle',extras},count,true):encodeTiles(tiles,indices,'utf16-15'))}};
  }
  return {format:FORMAT,state,tiles:encodeTiles(tiles,null,tiles.length>512*384?'utf16-15':'base64')};
}
function decodeTiles(packed,length,validateOnly=false) {
  if(!packed||!Array.isArray(packed.elevations)||(!packed.elevations.length&&length>0)||packed.elevations.length>65535||!Array.isArray(packed.details)||packed.details.length>32||packed.details[0]!==null||!Array.isArray(packed.extras)||packed.extras.length>length)throw new Error('Invalid tile palette.');
  if(!packed.elevations.every(e=>typeof e==='number'&&Number.isFinite(e))||!packed.details.slice(1).every(d=>typeof d==='string'))throw new Error('Invalid tile values.');
  const bytes=decodeBytes(packed.data,packed.encoding??'base64',length*4), tiles=validateOnly?null:new Array(length);
  const elevations=validateOnly?null:[null,...packed.elevations];
  for(let i=0;i<length;i++) {
    const p=bytes[i*4]|bytes[i*4+1]<<8,elevationId=bytes[i*4+2]|bytes[i*4+3]<<8,detailId=(p>>>7)&31;
    if((p&7)>=TERRAINS.length||elevationId>=packed.elevations.length||detailId>=packed.details.length)throw new Error('Invalid tile index.');
    if(validateOnly)continue;
    const tile={terrain:TERRAINS[p&7],elevation:null,variant:(p>>>3)&15,road:Boolean(p&4096),rail:Boolean(p&8192),bridge:Boolean(p&16384),tunnel:Boolean(p&32768),building:null,zone:null};
    tile.elevation=elevations[elevationId+1];
    if(detailId)tile.detail=packed.details[detailId];
    tiles[i]=tile;
  }
  const seen=new Set();
  for(const entry of packed.extras) {
    if(!Array.isArray(entry)||entry.length!==2||!Number.isInteger(entry[0])||entry[0]<0||entry[0]>=length||seen.has(entry[0])||!entry[1]||typeof entry[1]!=='object'||Array.isArray(entry[1]))throw new Error('Invalid tile extras.');
    seen.add(entry[0]);if(!validateOnly)tiles[entry[0]]={...tiles[entry[0]],...entry[1]};
  }
  readTreeDates(packed,length,validateOnly?null:(index,key,day)=>{tiles[index][key]=day;});
  return tiles;
}

function decodeDeltaTiles(packed,count,game,indices){
  if(packed.layout!=='baseline-xor-v1'||packed.encoding!=='utf16-15-rle'||!Array.isArray(packed.extras)||packed.extras.length>count)throw new Error('Invalid terrain delta layout.');
  const bytes=decodeBytes(packed.data,packed.encoding,count*4),seen=new Set();
  for(const entry of packed.extras){
    if(!Array.isArray(entry)||entry.length!==2||!Number.isInteger(entry[0])||entry[0]<0||entry[0]>=count||seen.has(entry[0])||(entry[1]!==null&&(typeof entry[1]!=='object'||Array.isArray(entry[1]))))throw new Error('Invalid terrain delta extras.');
    seen.add(entry[0]);
    if(entry[1]&&Object.keys(entry[1]).some(key=>CORE_KEYS.has(key)||key==='publicRoad'))throw new Error('Invalid terrain delta core override.');
  }
  if(!game){readTreeDates(packed,count);return;}
  const baseline=baselines.get(game.tiles),details=[undefined,...baseline.details.keys()];
  for(let i=0;i<count;i++){
    const delta=(bytes[i*4]|bytes[i*4+1]<<8|bytes[i*4+2]<<16|bytes[i*4+3]<<24)>>>0;
    const code=(baseline.codes[indices[i]]^delta)>>>0,detail=(code>>>7)&63,publicRoad=(code>>>28)&3;
    if(code>>>30||(code&7)>=TERRAINS.length||detail>=details.length||publicRoad===3)throw new Error('Invalid terrain delta code.');
    const tile=game.tiles[indices[i]];
    tile.terrain=TERRAINS[code&7];tile.variant=(code>>>3)&15;tile.elevation=generatedElevation(((code>>>13)&2047)/1024);
    if(detail)tile.detail=details[detail];else delete tile.detail;
    tile.road=Boolean(code&(1<<24));tile.rail=Boolean(code&(1<<25));tile.bridge=Boolean(code&(1<<26));tile.tunnel=Boolean(code&(1<<27));
    if(publicRoad)tile.publicRoad=publicRoad===2;else delete tile.publicRoad;
  }
  for(const [ordinal,extra]of packed.extras){
    const tile=game.tiles[indices[ordinal]];
    for(const key in tile)if(!CORE_KEYS.has(key)&&key!=='publicRoad')delete tile[key];
    tile.building=null;tile.zone=null;
    if(extra)for(const key of Object.keys(extra))Object.defineProperty(tile,key,{value:extra[key],writable:true,enumerable:true,configurable:true});
  }
  readTreeDates(packed,count,(ordinal,key,day)=>{game.tiles[indices[ordinal]][key]=day;});
}
// Metadata inspection validates packed data but never regenerates millions of
// terrain objects just to open the save dialog.
export function inspectSavedGame(saved) {
  if (saved?.format !== FORMAT && saved?.format !== PROCEDURAL_FORMAT) return null;
  const count = savedTileCount(saved);
  if (saved.format === PROCEDURAL_FORMAT) decodeIndices(saved.tiles, saved.state.width * saved.state.height);
  if(saved.tiles.layout!==undefined){if(saved.format!==PROCEDURAL_FORMAT)throw new Error('Invalid procedural delta.');decodeDeltaTiles(saved.tiles,count);}
  else decodeTiles(saved.tiles,count,true);
  return readFleet(readRoutePaths(saved.state),{decodeBytes});
}
export function decodeGame(saved) {
  if (saved?.format !== FORMAT && saved?.format !== PROCEDURAL_FORMAT) return saved;
  const count = savedTileCount(saved),deltaLayout=saved.tiles.layout!==undefined;
  readFleet(saved.state,{decodeBytes});
  const state=readFleet(readRoutePaths(saved.state,{expand:true}),{expand:true,decodeBytes});
  if(deltaLayout&&saved.format!==PROCEDURAL_FORMAT)throw new Error('Invalid procedural delta.');
  const patches=deltaLayout?(decodeDeltaTiles(saved.tiles,count),null):decodeTiles(saved.tiles,count);
  if (saved.format === FORMAT) return {...state,tiles:patches};
  const indices = decodeIndices(saved.tiles,saved.state.width * saved.state.height), g = saved.generation;
  const generated = {...generateWorld(g.biome,g.seed,g.size,g.version,g.options),biome:g.biome,seed:g.seed};
  rememberGeneratedWorld(generated);
  if(deltaLayout)decodeDeltaTiles(saved.tiles,count,generated,indices);
  else for (let i=0;i<indices.length;i++) generated.tiles[indices[i]]=patches[i];
  return {...state,tiles:generated.tiles};
}
