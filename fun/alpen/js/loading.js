/* WHAT THE MOUNTAIN IS STILL WAITING FOR.

   The models and maps arrive on the network's own clock and are swapped in
   whenever they land, which used to be in the middle of a run: a new forest
   material compiled, a megabyte atlas uploaded and a few pools of geometry
   baked, all inside one frame of riding. Each loader's chain — the fetch,
   the parse and the swap — is handed in here, so the boot can wait for all
   of them before it compiles and draws, and nothing arrives under a rider. */

const waiting = new Set();

export function track(promise) {
  const settled = promise.then(() => {}, () => {});
  waiting.add(settled);
  settled.then(() => waiting.delete(settled));
  return promise;
}

/* And every file three's own loaders fetch through `manager`: each one is
   held from its start to its end, which three reports after the file's own
   callback has run, and after a failure too. */
export function trackManager(manager) {
  const open = new Map();
  const { itemStart, itemEnd } = manager;
  manager.itemStart = (url) => {
    let end;
    track(new Promise((resolve) => { end = resolve; }));
    if (!open.has(url)) open.set(url, []);
    open.get(url).push(end);
    itemStart.call(manager, url);
  };
  manager.itemEnd = (url) => {
    open.get(url)?.shift()?.();
    itemEnd.call(manager, url);
  };
}

/* Settles once every chain handed in so far has, including chains handed in
   while it waits (a parse that starts another load). */
export async function allTracked() {
  while (waiting.size) await Promise.all([...waiting]);
}
