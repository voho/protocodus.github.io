import test from 'node:test';
import assert from 'node:assert/strict';
import {routePreviewAlpha} from '../route-preview-motion.js';

test('a paused-world draft pulses gently on display time without disappearing',()=>{
  assert.equal(routePreviewAlpha(0),1);
  assert.ok(Math.abs(routePreviewAlpha(900)-.62)<1e-12);
  assert.equal(routePreviewAlpha(1800),1);
  for(let timestamp=0;timestamp<10000;timestamp+=17){
    const alpha=routePreviewAlpha(timestamp);
    assert.ok(alpha>=.62&&alpha<=1,`visible pulse at ${timestamp} ms`);
    assert.ok(Math.abs(alpha-routePreviewAlpha(timestamp+17))<.012,'no sharp frame-to-frame blink');
  }
});

test('reduced motion holds the preview fully visible at every display timestamp',()=>{
  for(const timestamp of [0,17,900,1800,1234567,Infinity,NaN])assert.equal(routePreviewAlpha(timestamp,true),1);
});

test('a missing initial display timestamp still produces a visible draft',()=>{
  for(const timestamp of [undefined,null,NaN,Infinity])assert.equal(routePreviewAlpha(timestamp),1);
});
