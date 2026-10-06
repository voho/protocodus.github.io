import { featureWorldPixels, SPRITE_SCALE } from './sprite-art-direction.js';

// Loaded and unavailable artwork share a small hall, canopy and platform.
// Coordinates describe a 48px one-tile parcel, inside the same padded 64px
// frame as authored art, with identical metre scale and 2:1 ground axes.
export function drawRailStationFallback(c,x,y,size=64){
  const door=featureWorldPixels(SPRITE_SCALE.doorHeightMetres),wall=featureWorldPixels(SPRITE_SCALE.storeyHeightMetres);
  const face=(points,color)=>{c.beginPath();points.forEach(([px,py],i)=>i?c.lineTo(px,py):c.moveTo(px,py));c.closePath();c.fillStyle=color;c.fill();};
  c.save();c.translate(x,y);c.scale(size/64,size/64);c.translate(8,16.75);
  face([[6,29],[36,44],[44.5,39.75],[14.5,24.75]],'#bcb8a8');
  face([[6,29],[36,44],[36,45.75],[6,30.75]],'#938b7b');
  face([[36,44],[44.5,39.75],[44.5,41.5],[36,45.75]],'#7d7a70');
  face([[9,28.5],[21,34.5],[21,34.5-wall],[9,28.5-wall]],'#ded5bb');
  face([[21,34.5],[27.5,31.25],[27.5,31.25-wall],[21,34.5-wall]],'#afa995');
  face([[14,31],[15.9,31.95],[15.9,31.95-door],[14,31-door]],'#48664e');
  face([[10.3,27.55],[12.2,28.5],[12.2,26.1],[10.3,25.15]],'#6c9298');
  face([[17.4,31.1],[19.3,32.05],[19.3,29.65],[17.4,28.7]],'#6c9298');
  face([[8.4,22.3],[21.4,28.8],[24.4,25.1],[11.4,18.6]],'#697e79');
  face([[11.4,18.6],[24.4,25.1],[28.1,25.7],[15.1,19.2]],'#4c6460');
  // A broad bench and two canopy supports remain legible without fine rails.
  face([[30,36.6],[36,39.6],[34.9,40.15],[28.9,37.15]],'#906d49');
  face([[30,35.3],[36,38.3],[36,39.1],[30,36.1]],'#765a3f');
  face([[25.4,34.9],[26.2,35.3],[26.2,29.3],[25.4,28.9]],'#695742');
  face([[38.1,41.25],[38.9,41.65],[38.9,35.65],[38.1,35.25]],'#695742');
  face([[20.6,27.25],[37.6,35.75],[42.8,33.15],[25.8,24.65]],'#607b73');
  face([[20.6,27.25],[37.6,35.75],[37.6,36.35],[20.6,27.85]],'#425b55');
  c.fillStyle='#4c4f44';c.fillRect(42.1,31.1,.6,9.1);
  c.fillStyle='#b65d48';c.fillRect(42.4,31.8,3.1,.8);
  c.restore();return true;
}
