import { drawNativeRailStop } from './native-transport-art.js';

// One 16m plot occupies the same 72px frame as the generated station. The
// platform, hall and shelter use fixed metre dimensions and a fixed camera.
export function drawRailStationFallback(c,x,y,size=72){
  c.save();c.translate(x+size/2,y+size*.75);c.scale(size/72,size/72);
  drawNativeRailStop(c);c.restore();return true;
}
