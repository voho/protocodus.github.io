// Ten thousand vehicles repeat the same fourteen property names. A small
// schema catalogue removes that overhead without rounding positions or cargo.
// Each distinct field set keeps its own schema, including optional/future data.
export function packFleet(state,{encodeBytes}={}) {
  if(!Array.isArray(state.vehicles)||state.vehicles.length<64||Object.hasOwn(state,'vehicleSchemas'))return state;
  const schemas=[],schemaIds=new Map(),vehicles=[];
  for(const vehicle of state.vehicles) {
    if(!vehicle||typeof vehicle!=='object'||Array.isArray(vehicle))return state;
    const fields=Object.keys(vehicle);
    if(fields.length>128||fields.some(key=>vehicle[key]===undefined))return state;
    const key=JSON.stringify(fields);let id=schemaIds.get(key);
    if(id===undefined){if(schemas.length>=256)return state;id=schemas.length;schemas.push(fields);schemaIds.set(key,id);}
    vehicles.push([id,...fields.map(field=>vehicle[field])]);
  }
  if(!encodeBytes)return {...state,vehicleSchemas:schemas,vehicles};
  const groups=schemas.map(()=>[]);
  for(const row of vehicles)groups[row[0]].push(row);
  const numeric=schemas.map((fields,id)=>fields.map((_,i)=>i).filter(i=>groups[id].every(row=>typeof row[i+1]==='number'&&Number.isFinite(row[i+1]))&&groups[id].some(row=>!Number.isInteger(row[i+1])||Object.is(row[i+1],-0))));
  const count=vehicles.reduce((sum,row)=>sum+numeric[row[0]].length,0);
  if(!count)return {...state,vehicleSchemas:schemas,vehicles};
  // Fractional coordinates and dwell times are stored as their exact IEEE754
  // bits; short integer values are already smaller in JSON and stay there.
  const bytes=new Uint8Array(count*8),view=new DataView(bytes.buffer),sets=numeric.map(fields=>new Set(fields));let cursor=0;
  const records=vehicles.map(row=>{
    const id=row[0],record=[id];
    for(let i=0;i<schemas[id].length;i++) {
      if(sets[id].has(i)){view.setFloat64(cursor*8,row[i+1],true);cursor++;}
      else record.push(row[i+1]);
    }
    return record;
  });
  return {...state,vehicleSchemas:schemas.map((fields,id)=>({fields,numeric:numeric[id]})),vehicleNumbers:{count,data:encodeBytes(bytes,'utf16-15')},vehicles:records};
}

export function readFleet(state,{expand=false,decodeBytes}={}) {
  if(!Object.hasOwn(state,'vehicleSchemas'))return state;
  const source=state.vehicleSchemas;
  if(!Array.isArray(source)||source.length<1||source.length>256)throw new Error('Invalid saved vehicle fields.');
  const schemas=source.map(schema=>Array.isArray(schema)?schema:schema?.fields),numeric=source.map(schema=>Array.isArray(schema)?[]:schema?.numeric);
  if(schemas.some(fields=>!Array.isArray(fields)||fields.length>128||fields.some(field=>typeof field!=='string')||new Set(fields).size!==fields.length)||numeric.some((fields,id)=>!Array.isArray(fields)||fields.some(i=>!Number.isInteger(i)||i<0||i>=schemas[id].length)||new Set(fields).size!==fields.length))throw new Error('Invalid saved vehicle fields.');
  if(!Array.isArray(state.vehicles)||state.vehicles.length>10000||state.vehicles.some(row=>!Array.isArray(row)||!Number.isInteger(row[0])||row[0]<0||row[0]>=schemas.length||row.length!==schemas[row[0]].length+1-numeric[row[0]].length))throw new Error('Invalid saved vehicle record.');
  const count=state.vehicles.reduce((sum,row)=>sum+numeric[row[0]].length,0);
  let view;
  if(count||Object.hasOwn(state,'vehicleNumbers')) {
    if(!decodeBytes||!state.vehicleNumbers||state.vehicleNumbers.count!==count)throw new Error('Invalid saved vehicle numbers.');
    const bytes=decodeBytes(state.vehicleNumbers.data,'utf16-15',count*8);view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    for(let i=0;i<count;i++)if(!Number.isFinite(view.getFloat64(i*8,true)))throw new Error('Invalid saved vehicle number.');
  }
  if(!expand)return state;
  const {vehicleSchemas,vehicleNumbers,...rest}=state,sets=numeric.map(fields=>new Set(fields));let cursor=0;
  return {...rest,vehicles:state.vehicles.map(row=>{
    const id=row[0];let column=1;
    return Object.fromEntries(schemas[id].map((field,i)=>[field,sets[id].has(i)?view.getFloat64(cursor++*8,true):row[column++]]));
  })};
}
