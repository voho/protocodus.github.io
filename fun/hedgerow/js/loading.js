/* Fixed work budgets keep parallel downloads and later preparation from
   moving the overall bar backwards. A stage is done only after its work returns. */
export const LOADING_STAGES = [
  { id: 'textures', label: 'Textures', weight: 15 },
  { id: 'models', label: 'Models', weight: 45 },
  { id: 'world', label: 'Saint-Clair battlefield', weight: 29 },
  { id: 'soldiers', label: 'Soldiers and mission', weight: 6 },
  { id: 'shaders', label: 'Graphics preparation', weight: 5 },
];

export function createLoadingProgress(onChange, stages = LOADING_STAGES) {
  const work = stages.map(s => ({ ...s, fraction: 0, started: false, detail: '' }));
  const total = work.reduce((sum, s) => sum + s.weight, 0);
  const snapshot = () => {
    const completed = work.filter(s => s.fraction === 1).length;
    return {
      fraction: work.reduce((sum, s) => sum + s.weight * s.fraction, 0) / total,
      completed, remaining: work.length - completed,
      stages: work.map(s => ({ ...s, state: s.fraction === 1 ? 'done' : s.started ? 'loading' : 'waiting' })),
    };
  };
  return {
    update(id, fraction = 0, detail = '') {
      const s = work.find(s => s.id === id);
      if (!s) throw new Error(`Unknown loading stage: ${id}`);
      if (!Number.isFinite(fraction)) return;
      const next = Math.max(s.fraction, Math.min(1, Math.max(0, fraction)));
      // A late callback cannot reopen a completed stage or replace its status.
      if (s.fraction === 1) return;
      s.fraction = next;
      s.started = true;
      s.detail = detail;
      onChange(snapshot());
    },
    snapshot,
  };
}

/* Each download keeps its own high-water mark. Adding one request's bytes
   to a shared 'done' count loses the other in-flight requests and jumps. */
export function createAssetProgress(names, onChange) {
  const values = new Map(names.map(name => [name, 0]));
  return (name, fraction) => {
    if (!values.has(name) || !Number.isFinite(fraction)) return;
    values.set(name, Math.max(values.get(name), Math.min(1, Math.max(0, fraction))));
    const completed = [...values.values()].filter(f => f === 1).length;
    const active = [...values].filter(([, f]) => f > 0 && f < 1).map(([name]) => name);
    onChange?.([...values.values()].reduce((sum, f) => sum + f, 0) / (values.size || 1), {
      completed, total: values.size, active,
    });
  };
}
