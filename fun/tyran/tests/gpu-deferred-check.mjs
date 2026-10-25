// Background preparation must not wait for the driver: its texture allocation checks are deferred to a fence-guarded
// query at the next frame, while uploads made in a frame, on request or at launch are still checked at once.
import assert from 'node:assert/strict';
let id = 0;
function mockGL() {
  const live = new Set(), fences = [], calls = { getError: 0, fenceSync: 0, getSyncParameter: 0 };
  let lost = false, nextError = 0, uploadError = 0, fenceless = false;
  const gl = new Proxy({}, { get(_, name) {
    if (name === 'NO_ERROR') return 0;
    if (name === 'TEXTURE0') return 1000;
    if (name === 'isContextLost') return () => lost;
    if (name === 'getError') return () => { calls.getError++; const result = nextError; nextError = 0; return result; };
    if (name === 'getShaderParameter' || name === 'getProgramParameter') return () => true;
    if (name === 'getParameter') return key => key === 'MAX_TEXTURE_SIZE' ? 16384 : 8;
    if (name === 'getUniformLocation') return (_program, uniform) => uniform;
    if (name === 'checkFramebufferStatus') return () => 'FRAMEBUFFER_COMPLETE';
    if (name === 'fenceSync') return () => { calls.fenceSync++; if (fenceless) return null; const sync = { kind: 'sync', id: ++id, signaled: false }; live.add(sync); fences.push(sync); return sync; };
    if (name === 'getSyncParameter') return sync => { calls.getSyncParameter++; return sync.signaled ? 'SIGNALED' : 'UNSIGNALED'; };
    if (name.startsWith('create')) return () => { const handle = { kind: name, id: ++id }; live.add(handle); return handle; };
    if (name.startsWith('delete')) return handle => { live.delete(handle); };
    if (name === 'texImage2D') return () => { if (uploadError) { nextError = uploadError; uploadError = 0; } };
    if (/^[A-Z_0-9]+$/.test(name)) return name;
    return () => {};
  } });
  return { gl, live, calls, fences, signal() { for (const sync of fences) sync.signaled = true; }, setUploadError(value) { uploadError = value; }, set fenceless(value) { fenceless = value; }, lose() { lost = true; } };
}
globalThis.OffscreenCanvas = class { constructor(width, height) { this.width = width; this.height = height; this.handlers = new Map(); this.mock = mockGL(); } getContext() { return this.mock.gl; } addEventListener(name, fn) { this.handlers.set(name, fn); } };
const { GPUCanvas2D } = await import('../gpu-canvas.js');
const source = name => ({ name, width: 32, height: 32, _tyranTextureVersion: 1 });
const make = () => { const c = new GPUCanvas2D(800, 600); return { c, mock: c.canvas.mock, calls: c.canvas.mock.calls }; };
let cases = 0;
{
  // Default and in-frame uploads are checked on the spot, as before.
  const { c, calls } = make();
  c.prewarm(source('strict'));
  assert.equal(calls.getError, 1, 'A request outside background preparation queries at once');
  assert.equal(c._unchecked, 0);
  c.dispose(); cases++;
}
{
  // Deferred uploads make no query; the frame loop fences them, waits for the fence, then queries once.
  const { c, mock, calls } = make();
  c.deferChecks = true;
  c.prewarm([source('a'), source('b'), source('c')]);
  c.deferChecks = false;
  assert.equal(calls.getError, 0, 'Background uploads never wait for the driver');
  assert.equal(c._unchecked, 3);
  assert.equal(c.beginFrame(), true);
  assert.equal(calls.fenceSync, 1, 'The first frame fences the uploads');
  assert.equal(calls.getError, 0, 'and does not query while the driver may still be busy');
  assert.equal(c.beginFrame(), true);
  assert.equal(calls.fenceSync, 1, 'A pending fence is not replaced');
  assert.equal(calls.getError, 0);
  mock.signal();
  assert.equal(c.beginFrame(), true);
  assert.equal(calls.getError, 1, 'Once the fence has signalled a single query settles every upload');
  assert.equal(c._unchecked, 0);
  assert.equal(c._fence, null);
  assert.equal(mock.fences.filter(sync => mock.live.has(sync)).length, 0, 'The fence is deleted');
  c.beginFrame(); c.beginFrame();
  assert.equal(calls.getError, 1, 'A checked renderer asks nothing further');
  c.dispose(); cases++;
}
{
  // An upload made after the fence is not covered by it, so the frame loop fences again before querying.
  const { c, mock, calls } = make();
  c.deferChecks = true; c.prewarm(source('first')); c.deferChecks = false;
  c.beginFrame(); mock.signal();
  c.deferChecks = true; c.prewarm(source('late')); c.deferChecks = false;
  c.beginFrame();
  assert.equal(calls.getError, 0, 'A signalled fence that predates an upload does not vouch for it');
  assert.equal(calls.fenceSync, 2);
  mock.signal(); c.beginFrame();
  assert.equal(calls.getError, 1);
  c.dispose(); cases++;
}
{
  // A failed allocation is found before anything can draw with it, and falls back like an immediate failure.
  const { c, mock } = make();
  mock.setUploadError(1285);
  c.deferChecks = true; c.prewarm(source('too big')); c.deferChecks = false;
  assert(c.usable, 'The failure is not known yet');
  c.beginFrame(); mock.signal();
  assert.equal(c.beginFrame(), false);
  assert(!c.usable);
  assert.match(c.failure, /Texture upload failed \(1285\)/);
  assert.deepEqual(c.stats.errors, [1285]);
  assert.equal(c._unchecked, 0);
  c.dispose(); cases++;
}
{
  // Launch and instrumentation settle the check immediately, without waiting for a frame.
  const { c, calls } = make();
  c.deferChecks = true; c.prewarm(source('launch')); c.deferChecks = false;
  assert.equal(c.verifyUploads(), true);
  assert.equal(calls.getError, 1);
  assert.equal(c._unchecked, 0);
  c.deferChecks = true; c.prewarm(source('stats')); c.deferChecks = false;
  void c.stats;
  assert.equal(c._unchecked, 0, 'Reading the statistics checks pending uploads first');
  c.dispose(); cases++;
}
{
  // A driver that cannot make a fence is simply asked at the frame boundary.
  const { c, mock, calls } = make();
  mock.fenceless = true;
  c.deferChecks = true; c.prewarm(source('no fence')); c.deferChecks = false;
  assert.equal(c.beginFrame(), true);
  assert.equal(calls.getError, 1);
  assert.equal(c._unchecked, 0);
  c.dispose(); cases++;
}
{
  // Context loss forgets pending checks: nothing is left to query on a dead context.
  const { c, mock, calls } = make();
  c.deferChecks = true; c.prewarm(source('doomed')); c.deferChecks = false;
  c.beginFrame();
  mock.lose();
  assert.equal(c.beginFrame(), false, 'A lost context draws nothing');
  const queried = calls.getError;
  c.canvas.handlers.get('webglcontextlost')({ preventDefault() {} });
  assert.equal(c._unchecked, 0);
  assert.equal(calls.getError, queried);
  c.dispose(); cases++;
}
console.log(`GPU deferred upload checks passed (${cases} groups).`);
