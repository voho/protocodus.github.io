/* Hedgerow — a tiny event bus between the systems. */

export function createEvents() {
  const map = new Map();
  return {
    on(name, fn) {
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(fn);
      return () => { const l = map.get(name); const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
    },
    emit(name, data) {
      const l = map.get(name);
      if (l) for (const fn of [...l]) fn(data);
    },
    clear() { map.clear(); },
  };
}
