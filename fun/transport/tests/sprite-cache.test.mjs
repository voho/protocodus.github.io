import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpriteCache } from '../sprite-cache.js';
const canvas = (width=16,height=16) => ({ width, height });

test('repeated hits preserve LRU order across shared factories and eviction', () => {
  const cache=createSpriteCache({limit:2048}),a=canvas(),b=canvas(),c=canvas(),d=canvas();
  cache.set('town:house',a);cache.set('vehicle:bus',b);
  for(let n=0;n<100;n++)assert.equal(cache.get('vehicle:bus'),b);
  cache.set('town:tree',c);
  assert.equal(cache.get('town:house'),undefined);
  assert.equal(cache.get('vehicle:bus'),b);
  for(let n=0;n<100;n++)assert.equal(cache.get('vehicle:bus'),b);
  cache.set('vehicle:truck',d);
  assert.equal(cache.get('town:tree'),undefined,'touching an older canvas makes it most recent');
  assert.equal(cache.get('vehicle:bus'),b);
  assert.equal(cache.get('vehicle:truck'),d);
  assert.deepEqual(cache.getStats(),{entries:2,bytes:2048,limit:2048});
});

test('replacement, explicit clearing and asset revisions reset resident canvases', () => {
  const cache=createSpriteCache({limit:2048}),a=canvas(),b=canvas(),replacement=canvas(8,16);
  cache.syncRevision('art:1');cache.set('a',a);cache.set('b',b);cache.set('b',replacement);
  assert.equal(cache.get('b'),replacement);
  assert.equal(cache.getStats().bytes,1536);
  cache.syncRevision('art:1');assert.equal(cache.get('a'),a,'the same revision retains prepared pixels');
  cache.syncRevision('art:2');assert.equal(cache.get('a'),undefined);assert.equal(cache.get('b'),undefined);
  cache.set('b',b);cache.clear();cache.set('a',a);cache.set('b',b);cache.set('c',canvas());
  assert.equal(cache.get('a'),undefined);assert.equal(cache.get('b'),b);
  cache.set('too-large',canvas(32,32));
  assert.deepEqual(cache.getStats(),{entries:0,bytes:0,limit:2048});
  assert.equal(cache.get('too-large'),undefined,'over-budget preparations do not remain resident');
});
