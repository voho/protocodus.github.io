import { createGame } from './sim.js';

const schedulePaint = globalThis.requestAnimationFrame?.bind(globalThis);

// A timer after animation-frame callbacks lets the browser paint before the next CPU slice.
export function nextPaint() {
  return new Promise(resolve => schedulePaint(() => setTimeout(resolve, 0)));
}

// Preparation runs in many short steps. Waiting a whole frame after each one made loading take as long
// as the frame count, however fast the device; steps now share a frame until its CPU budget is spent.
let sliceEnd = 0;
export async function paintWhenDue(budget = 12) {
  if (performance.now() < sliceEnd) return;
  await nextPaint();
  sliceEnd = performance.now() + budget;
}

export async function generateOperation(seed, difficulty, options) {
  const generateLocally = async () => {
    // Local previews can load the game modules while disallowing file-origin workers.
    // Let the loading screen paint before generating the same deterministic map here.
    await nextPaint();
    return createGame(seed, difficulty, options);
  };
  if (globalThis.location?.protocol === 'file:' || typeof Worker !== 'function') return generateLocally();
  let worker;
  try { worker = new Worker(new URL('./world-worker.js', import.meta.url), { type: 'module' }); }
  catch (error) {
    if (error.name === 'SecurityError' || error.name === 'NotSupportedError') return generateLocally();
    throw error;
  }
  return new Promise((resolve, reject) => {
    const stop = () => { worker.onmessage = null; worker.onerror = null; worker.terminate(); };
    worker.onmessage = ({ data }) => {
      stop();
      if (data.error) reject(new Error(data.error));
      else resolve(data.game);
    };
    worker.onerror = event => { event.preventDefault(); stop(); generateLocally().then(resolve, reject); };
    try { worker.postMessage({ seed, difficulty, options }); }
    catch (error) { stop(); reject(error); }
  });
}
