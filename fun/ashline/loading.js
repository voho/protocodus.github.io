const schedulePaint = globalThis.requestAnimationFrame?.bind(globalThis);

// A timer after animation-frame callbacks lets the browser paint before the next CPU slice.
export function nextPaint() {
  return new Promise(resolve => schedulePaint(() => setTimeout(resolve, 0)));
}

export function generateOperation(seed, difficulty, options) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./world-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (data.error) reject(new Error(data.error));
      else resolve(data.game);
    };
    worker.onerror = event => { event.preventDefault(); worker.terminate(); reject(new Error('The sector could not be generated. Please try again.')); };
    worker.postMessage({ seed, difficulty, options });
  });
}
