/* Meteora — summaries for the in-game benchmark (?bench).

   Samples are kept per metric (frame interval, JavaScript time, GPU time,
   draw calls, triangles). A metric nobody could measure — GPU time where the
   browser offers no timer queries — is reported as missing, never as zero.
   Percentiles are nearest-rank. */

export function createFrameStats() {
  const series = new Map();
  return {
    add(name, value) {
      if (value == null || !Number.isFinite(value)) return;
      let list = series.get(name);
      if (!list) series.set(name, list = []);
      list.push(value);
    },
    summary() {
      const out = {};
      for (const [name, list] of series) {
        const s = [...list].sort((a, b) => a - b);
        const rank = q => s[Math.max(0, Math.ceil(q * s.length) - 1)];
        out[name] = { mean: s.reduce((a, v) => a + v, 0) / s.length, p50: rank(0.5), p95: rank(0.95), count: s.length };
      }
      return out;
    },
  };
}
