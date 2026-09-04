/* Off-screen extension of the world-fixed terrain horizon cache. */

import { heightAt } from './terrain.js';
import { buildShadowTiles } from './shadow-cache.js';
import { setWorldSeed } from './noise.js';

self.onmessage = (event) => {
  const { id, tiles, spec } = event.data;
  setWorldSeed(spec.worldSeed);
  const results = buildShadowTiles(spec, tiles, heightAt);
  const transfer = results.flatMap(({ horizon, ground }) =>
    [horizon.buffer, ground.buffer]);
  // One message lets the main thread patch a whole new row/column and perform
  // one atlas upload, rather than uploading the 3.3 MiB resident plate once
  // for every 96 m tile in the batch.
  self.postMessage({ id, results, worldSeed: spec.worldSeed }, transfer);
};
