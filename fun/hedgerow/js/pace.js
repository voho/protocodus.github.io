/* Hedgerow — work in slices.

   Loading builds a lot on the main thread: the models' geometry, the village and its fields, the
   grass and ground maps, the shaders. Done in one go it froze the page for seconds at a time - the
   loading bar stopped, the menu did not answer. Long jobs call breathe() as they go (in their loops,
   between their steps): once a slice of about a frame's worth of work has passed it gives the
   browser its turn (input, the menu, the bar, a paint) before carrying on; otherwise it costs
   nothing. */

const SLICE = 16;            // ms of work between turns

// one turn of the event loop for everything waiting (scheduler.yield where there is one: the job
// comes back first after it; a message otherwise, which unlike a timeout is not held back)
const turn = () => (globalThis.scheduler?.yield
  ? globalThis.scheduler.yield()
  : new Promise((resolve) => { const ch = new MessageChannel(); ch.port1.onmessage = () => resolve(); ch.port2.postMessage(0); }));

let since = typeof performance !== 'undefined' ? performance.now() : 0;

/* a turn for the browser if this slice of work is used up */
export async function breathe() {
  if (performance.now() - since < SLICE) return;
  await turn();
  since = performance.now();
}

/* a step of the loading, marked for a profile ('hedgerow: <name>' in the performance timeline) */
export const mark = (name) => performance.mark('hedgerow: ' + name);

/* a turn for the browser now (before a step that cannot be sliced) */
export async function yieldNow() {
  await turn();
  since = performance.now();
}
