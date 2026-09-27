// Generated elevations are exact multiples of1/1024. Keep the numbers in a
// tagged array (the first null prevents a double-only backing store), so V8 can
// share their immutable numeric representation rather than boxing4m copies.
// Tiles remain ordinary mutable objects with the same own keys and JSON.
const elevations=[null];
for(let i=0;i<=2048;i++)elevations.push(i/1024);

export function generatedElevation(value){
  const index=value*1024;
  return Number.isInteger(index)&&index>=0&&index<=2048&&!Object.is(value,-0)?elevations[index+1]:value;
}

export function createTerrainTile(terrain,elevation,detail,variant){
  // Starting this field as tagged prevents per-instance mutable double boxes.
  // Assigning a new height later still behaves like a normal numeric property.
  const tile={terrain,elevation:null,detail,variant,road:false,rail:false,bridge:false,tunnel:false,building:null,zone:null};
  tile.elevation=generatedElevation(elevation);
  return tile;
}
