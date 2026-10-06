import test from 'node:test';
import assert from 'node:assert/strict';
import { createToastLifetime } from '../ui-toast-lifetime.js';

function clock() {
  let time = 0, next = 0;
  const timers = new Map();
  return {
    now: () => time,
    schedule(run, delay) { const id = ++next; timers.set(id, { run, at: time + delay }); return id; },
    cancel: id => timers.delete(id),
    advance(duration) {
      const end = time + duration;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); time = due[1].at; due[1].run();
      }
      time = end;
    },
  };
}

test('a toast keeps the full five seconds of reading time across hover and focus', () => {
  const time = clock(), expired = [];
  const lifetime = createToastLifetime(5000, () => expired.push(time.now()), time);
  time.advance(1800); lifetime.pause('pointer');
  time.advance(7000); assert.deepEqual(expired, [], 'hover keeps the action available beyond its normal expiry');
  lifetime.pause('focus'); lifetime.resume('pointer');
  time.advance(9000); assert.deepEqual(expired, [], 'keyboard focus keeps it available after the pointer leaves');
  lifetime.resume('focus'); time.advance(3199);
  assert.deepEqual(expired, [], 'only the unpaused reading time counts');
  time.advance(1); assert.deepEqual(expired, [21000]);
  time.advance(5000); assert.equal(expired.length, 1, 'expiry runs once');
});

test('repeated focus entries and leaving between toast actions do not shorten or restart its life', () => {
  const time = clock(); let expired = false;
  const lifetime = createToastLifetime(8000, () => { expired = true; }, time);
  time.advance(7500); lifetime.pause('focus'); lifetime.pause('focus');
  time.advance(5000); lifetime.resume('focus'); time.advance(499);
  assert.equal(expired, false, 'warning toasts retain their remaining half second');
  time.advance(1); assert.equal(expired, true);
});

test('disposing a replaced or acted-on toast prevents a later expiry callback', () => {
  const time = clock(); let expired = 0;
  const lifetime = createToastLifetime(5000, () => expired++, time);
  time.advance(1000); lifetime.pause('pointer'); lifetime.dispose(); lifetime.resume('pointer');
  time.advance(10000); assert.equal(expired, 0);
});
