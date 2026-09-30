import { weatherAt } from './environment.js';

const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const wrap = value => value - Math.floor(value);
export const MAX_WEATHER_PARTICLES = 112;

// Presentation reads the same local climate as production and ecology. Blend
// between simulation days so a new weather front never switches on abruptly.
export function weatherPresentation(game, x, y, day = game.day || 0) {
  const whole = Math.floor(day), fraction = day - whole;
  const a = weatherAt(game, x, y, whole), b = fraction ? weatherAt(game, x, y, whole + 1) : a;
  const wetness = mix(a.wetness, b.wetness, fraction), cold = mix(a.cold, b.cold, fraction);
  const threshold = game.biome === 'desert' ? .27 : game.biome === 'tundra' ? .40 : .53;
  const precipitation = smooth((wetness - threshold) / .20);
  const snow = precipitation * smooth((cold - .57) / .17), rain = precipitation - snow;
  return { rain, snow, cloud: smooth((wetness - threshold + .11) / .30), cold, wetness };
}

// A fixed pool is independent of map size and never allocates a second screen
// bitmap. Color compositing grades the finished world; sprite pixels and caches
// are untouched. HUD and map labels are painted afterwards and stay legible.
// The year's light, 0–1 each: a winter chill peaking late January, a fresh spring in May and a golden autumn in
// October. Days count from 1 January 1950; a year of 365.2425 days keeps the peaks in their months for centuries.
// Deserts barely turn; the tundra's autumn is short. Pure presentation: nothing in the simulation reads it.
const SEASON_SCALE = { taiga: { winter: 1, spring: 1, autumn: 1 }, tundra: { winter: 1, spring: .6, autumn: .6 }, desert: { winter: .35, spring: .5, autumn: .25 } };
export function seasonPresentation(game, day = game.day || 0) {
  const at = ((day % 365.2425) + 365.2425) % 365.2425, scale = SEASON_SCALE[game.biome] || SEASON_SCALE.taiga;
  const bump = (centre, width) => { const d = Math.abs(at - centre), wrapped = Math.min(d, 365.2425 - d); return smooth(1 - wrapped / width); };
  return { winter: bump(25, 75) * scale.winter, spring: bump(130, 50) * scale.spring, autumn: bump(285, 48) * scale.autumn };
}

export function createWeatherEffects({ reducedMotion = () => false } = {}) {
  const particles = new Float32Array(MAX_WEATHER_PARTICLES * 4);
  let state = 0x4f2a7b19;
  for (let i = 0; i < particles.length; i++) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    particles[i] = (state >>> 0) / 4294967296;
  }
  let stats = { enabled: false, rain: 0, snow: 0, cloud: 0, particles: 0, particleLimit: MAX_WEATHER_PARTICLES, bytes: particles.byteLength };

  function draw(c, { game, layers, camera, width, height }) {
    if (layers.weather === false) { stats = { ...stats, enabled: false, rain: 0, snow: 0, cloud: 0, particles: 0 }; return; }
    const day = Number(game.day) || 0;
    const x = Math.max(0, Math.min(game.width - 1, camera.x / 32));
    const y = Math.max(0, Math.min(game.height - 1, camera.y / 32));
    const weather = weatherPresentation(game, x, y, day), { rain, snow, cloud } = weather, season = seasonPresentation(game, day);
    const amount = rain + snow, still = reducedMotion();
    const count = still || amount < .015 ? 0 : Math.min(MAX_WEATHER_PARTICLES, Math.round((width * height / 16000 + 16) * amount));
    stats = { enabled: true, rain, snow, cloud, particles: count, particleLimit: MAX_WEATHER_PARTICLES, bytes: particles.byteLength, season };
    c.save();
    // The season first, as soft light: warm gold in autumn, a fresh green in spring, a pale chill in winter.
    if (season.autumn > .01) { c.globalCompositeOperation = 'soft-light'; c.globalAlpha = season.autumn * .2; c.fillStyle = '#e0913f'; c.fillRect(0, 0, width, height); }
    if (season.spring > .01) { c.globalCompositeOperation = 'soft-light'; c.globalAlpha = season.spring * .12; c.fillStyle = '#b8e07a'; c.fillRect(0, 0, width, height); }
    if (season.winter > .01) { c.globalCompositeOperation = 'saturation'; c.globalAlpha = season.winter * .1; c.fillStyle = '#808080'; c.fillRect(0, 0, width, height); c.globalCompositeOperation = 'source-over'; c.globalAlpha = season.winter * .05; c.fillStyle = '#e4ecef'; c.fillRect(0, 0, width, height); }
    if (cloud < .01 && !count) { c.restore(); return; }
    // Clouds and rain soften the palette and cool it, gently enough that the map stays clear.
    c.globalCompositeOperation = 'saturation';
    c.globalAlpha = cloud * .1 + amount * .12;
    c.fillStyle = '#808080'; c.fillRect(0, 0, width, height);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = cloud * .05 + rain * .06 + snow * .12;
    c.fillStyle = snow > rain ? '#d6e6ec' : '#6b8196'; c.fillRect(0, 0, width, height);

    // Time belongs to the company, so pause, loading, tab suspension, save/load
    // and simulation speed all have the same effect on weather as on vehicles.
    const rainCount = amount ? Math.round(count * rain / amount) : 0, snowCount = count - rainCount;
    if (rainCount) {
      c.strokeStyle = '#d6e5ed'; c.globalAlpha = .12 + rain * .18; c.lineWidth = .75;
      c.beginPath();
      for (let i = 0; i < rainCount; i++) {
        const n = i * 4, pace = .7 + particles[n + 2] * .7;
        const px = wrap(particles[n] + day * .025 * pace) * (width + 32) - 16;
        const py = wrap(particles[n + 1] + day * .64 * pace) * (height + 32) - 16;
        const length = 5 + particles[n + 3] * 7;
        c.moveTo(px, py); c.lineTo(px + length * .29, py + length);
      }
      c.stroke();
    }
    if (snowCount) {
      c.fillStyle = '#f1f5f2'; c.globalAlpha = .20 + snow * .40; c.beginPath();
      for (let i = 0; i < snowCount; i++) {
        const n = i * 4, pace = .5 + particles[n + 2] * .8;
        const px = wrap(particles[n] + day * .007 * pace) * (width + 20) - 10 + Math.sin(day * .55 + particles[n + 3] * Math.PI * 2) * 8;
        const py = wrap(particles[n + 1] + day * .06 * pace) * (height + 20) - 10, radius = .65 + particles[n + 3] * 1.1;
        c.moveTo(px + radius, py); c.arc(px, py, radius, 0, Math.PI * 2);
      }
      c.fill();
    }
    c.restore();
  }
  draw.getStats = () => ({ ...stats });
  return draw;
}
