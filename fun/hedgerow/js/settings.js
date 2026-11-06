/* Saved preferences are untrusted input: keep old saves compatible and keep
   invalid camera or audio values away from WebGL and Web Audio. */
import { DEFAULT_SETTINGS, DIFFICULTY, QUALITY } from './config.js';

const ranges = { sensitivity: [0.2, 3], volume: [0, 1], effectsVolume: [0, 1], ambienceVolume: [0, 1], fov: [55, 90] };
export function normalizeSettings(saved, { reducedMotion = false } = {}) {
  const source = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  const result = { ...DEFAULT_SETTINGS };
  if (reducedMotion) { result.cameraShake = false; result.motionBlur = false; }
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = Math.min(max, Math.max(min, value));
  }
  for (const key of ['invertY', 'motionBlur', 'cameraShake']) {
    if (typeof source[key] === 'boolean') result[key] = source[key];
  }
  for (const [key, values] of [['quality', QUALITY], ['difficulty', DIFFICULTY]]) {
    if (typeof source[key] === 'string' && Object.hasOwn(values, source[key])) result[key] = source[key];
  }
  return result;
}
