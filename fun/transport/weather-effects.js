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
    const weather = weatherPresentation(game, x, y, day), { rain, snow, cloud } = weather;
    const amount = rain + snow, still = reducedMotion();
    const count = still || amount < .015 ? 0 : Math.min(MAX_WEATHER_PARTICLES, Math.round((width * height / 16000 + 16) * amount));
    stats = { enabled: true, rain, snow, cloud, particles: count, particleLimit: MAX_WEATHER_PARTICLES, bytes: particles.byteLength };
    if (cloud < .01 && !count) return;
    c.save();
    c.globalCompositeOperation = 'saturation';
    c.globalAlpha = cloud * .20 + amount * .16;
    c.fillStyle = '#808080'; c.fillRect(0, 0, width, height);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = cloud * .065 + rain * .065 + snow * .13;
    c.fillStyle = snow > rain ? '#d6e6ec' : '#6b8196'; c.fillRect(0, 0, width, height);

    // Time belongs to the company, so pause, loading, tab suspension, save/load
    // and simulation speed all have the same effect on weather as on vehicles.
    const rainCount = amount ? Math.round(count * rain / amount) : 0, snowCount = count - rainCount;
    if (rainCount) {
      c.strokeStyle = '#d6e5ed'; c.globalAlpha = .16 + rain * .21; c.lineWidth = .75;
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
