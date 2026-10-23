// Run from fun/alpen: node tests/terrain-worker-check.mjs
/* THE RE-ANCHORS ARE BUILT IN A WORKER, AND THEY ARE THE SAME BITS.

   A deterministic sixty-second ride streams the real terrain module — a flow
   burst, a run of snapped builds, a restart where the rider stands, a new
   seed somewhere else and a checkpoint back uphill — and hashes every mesh
   buffer each time it is uploaded: once with every build on the main thread
   and once with every build in js/terrain-worker.js, on the desktop grid and
   on the phone grid. Each pair must agree upload for upload.

   Then the worker is made late on purpose: its answers held back for a few
   frames, every sixth for three quarters of a second, and one never given at
   all. Every surface shown is re-derived from scratch with a fresh lattice
   and must match; the builds the worker could not deliver in time are
   finished on the main thread; and the silent worker is retired.

   Node has no web Worker, so this file is one: worker_threads runs it with
   the globals the worker module uses. Both threads' clocks are frame-stepped
   and still within a frame, so the main-thread build finishes each stage in
   the frame it reaches, and an answer due in a frame is waited for. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  Worker as Thread, MessageChannel, receiveMessageOnPort, isMainThread, workerData,
} from 'node:worker_threads';

const still = (now) => Object.defineProperty(globalThis, 'performance', {
  value: { now }, configurable: true, writable: true,
});

if (!isMainThread) {
  const { url, port, signal } = workerData;
  const posted = new Int32Array(signal);
  still(() => 0);
  globalThis.self = globalThis;
  self.postMessage = (data, transfer) => {
    port.postMessage(data, transfer);
    Atomics.add(posted, 0, 1);
    Atomics.notify(posted, 0);
  };
  await import(url);
  port.on('message', (data) => self.onmessage({ data }));
} else if (process.argv[2]) {
  console.log(JSON.stringify(await ride(...process.argv.slice(2))));
  process.exit(0);
} else {
  const runs = [['desktop', 'main'], ['desktop', 'worker'], ['mobile', 'main'],
    ['mobile', 'worker'], ['desktop', 'late']];
  const results = await Promise.all(runs.map((args) => new Promise((done, fail) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args]);
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => (code === 0 ? done(JSON.parse(out))
      : fail(new Error(`${args.join(' ')}: ${err || out}`))));
  })));
  const run = (profile, mode) => results.find((r) => r.profile === profile && r.mode === mode);
  for (const profile of ['desktop', 'mobile']) {
    const main = run(profile, 'main');
    const worker = run(profile, 'worker');
    assert.ok(main.commits > 150 && main.morphs > 120, `${profile}: the ride streams`);
    assert.equal(main.workerJobs, 0, `${profile}: no worker, no jobs`);
    assert.ok(worker.workerJobs >= worker.commits - 4,
      `${profile}: the worker builds every re-anchor (${worker.workerJobs} of ${worker.commits})`);
    assert.equal(worker.lateBuilds, 0, `${profile}: an answer in its own frame is never late`);
    assert.equal(worker.uploads, main.uploads, `${profile}: the same uploads`);
    assert.equal(worker.fingerprint, main.fingerprint,
      `${profile}: every mesh buffer hashes the same from the worker as from the main thread`);
  }
  assert.ok(run('mobile', 'main').vertices < run('desktop', 'main').vertices,
    'the phone grid is its own, and the worker built it from the page\'s layout');
  const late = run('desktop', 'late');
  assert.deepEqual(late.mismatches, [], 'every surface shown matches a fresh build of its transition');
  assert.ok(late.verified > 150, 'and they were checked');
  assert.ok(late.lateBuilds > 0, 'a late worker\'s builds are finished on the main thread');
  assert.equal(late.running, false, 'a silent worker is retired');
  assert.ok(late.commits > 150, 'and the ride carries on streaming without it');
  console.log(`Terrain worker checks passed: ${run('desktop', 'main').uploads} uploads over a 60 s ride `
    + `hash identically from the worker and the main thread on the desktop `
    + `(${run('desktop', 'main').vertices}) and phone (${run('mobile', 'main').vertices}) grids; `
    + `with the worker late and then silent, ${late.lateBuilds} builds were finished here, it was `
    + `retired, and all ${late.verified} surfaces shown matched fresh builds.`);
}

async function ride(profile, mode) {
  if (profile === 'mobile') {
    globalThis.window = {
      innerWidth: 390, innerHeight: 844, devicePixelRatio: 3,
      matchMedia: (query) => ({ matches: { '(pointer: coarse)': true, '(hover: none)': true }[query] ?? false }),
    };
  }
  let clock = 0;
  still(() => clock);
  // In frames after it was asked for, when each answer is handed over, in
  // order: at once, or held back, or (job 50) never.
  const gate = {
    frame: 0,
    lag: mode === 'late' ? (n) => (n === 50 ? Infinity : n % 6 === 0 ? 45 : 2) : () => 0,
    workers: [],
    jobs: 0,
    pump() { for (const w of this.workers) w.pump(); },
  };
  if (mode !== 'main') globalThis.Worker = webWorker(gate);

  const THREE = await import('../../../assets/vendor/three/three.module.min.js');
  const { MOBILE_RENDER } = await import('../js/config.js');
  const { createTerrain, createLattice, terrainLayout, SNOWPACK, guideAt } = await import('../js/terrain.js');
  const { setWorldSeed, getWorldSeed } = await import('../js/noise.js');
  assert.equal(MOBILE_RENDER, profile === 'mobile');
  const headlessTHREE = { ...THREE, TextureLoader: class {
    load(src, ready, progress, fail) { fail?.(); return new THREE.Texture(); }
  } };
  const shading = { apply: (m) => m, uniforms: {
    uShadeMap: { value: null }, uShadeHeightMap: { value: null },
    uShadeLevel: { value: 0 }, uShadeSlice: { value: 0 },
  } };
  const terrain = createTerrain(headlessTHREE, shading);

  const { attributes } = terrain.mesh.geometry;
  const surfaceNames = ['position', 'aSmoothNormal', 'color', 'aSurface', 'aGroomFrame'];
  const morphNames = ['aMorphDY', 'aMorphDN', 'aMorphDC', 'aMorphDS'];
  const names = [...surfaceNames, ...morphNames];
  const versions = Object.fromEntries(names.map((n) => [n, attributes[n].version]));
  const sha1 = (a) => createHash('sha1')
    .update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest('hex');
  const events = [];
  let uploads = 0;
  let live = null;
  function record(frame, kind) {
    const changed = names.filter((n) => attributes[n].version !== versions[n]);
    for (const n of changed) versions[n] = attributes[n].version;
    uploads += changed.length;
    const d = terrain.debug();
    const anchor = [d.anchorX, d.anchorZ, d.anchorY];
    const hashes = (list) => list.map((n) => sha1(attributes[n].array));
    if (changed.includes('position')) {
      events.push({ frame, kind: kind ?? 'commit', seed: getWorldSeed(), from: live, to: anchor,
        morph: d.morphPhase === 2, surface: hashes(surfaceNames), deltas: hashes(morphNames) });
    } else if (changed.length) {
      events.push({ frame, kind: kind ? 'settle' : 'lead', seed: getWorldSeed(), deltas: hashes(morphNames) });
    }
    live = anchor;
  }

  const dt = 1 / 60;
  const speedAt = (t) => (t < 8 ? 6 + t * 3 : t < 18 ? 30 + (t - 8) * 3 : t < 30 ? 60
    : t < 34 ? 60 + (t - 30) * 15 : t < 37 ? 120 : t < 40 ? 120 - (t - 37) * 25 : 45);
  let z = -300;
  let x = guideAt(z);
  setWorldSeed('alpen-ride');
  terrain.reset(x, z);
  record(-1, 'reset');
  for (let frame = 0; frame < 3600; frame++) {
    const t = frame * dt;
    clock += dt * 1000;
    gate.frame = frame;
    gate.pump();
    if (frame === 1200) {
      terrain.reset(x, z);
      record(frame, 'reset');
    } else if (frame === 2520) {
      setWorldSeed('alpen-ride-2');
      z = -6000;
      x = guideAt(z);
      terrain.reset(x, z);
      record(frame, 'reset');
    } else if (frame === 3000) {
      z += 240;
      x = guideAt(z);
      terrain.reset(x, z);
      record(frame, 'reset');
    }
    terrain.probe.snapMorph = t >= 25 && t < 27;
    z -= speedAt(t) * dt;
    x = guideAt(z) + 28 * Math.sin(t * 0.4) + 6 * Math.sin(t * 1.7);
    terrain.update(x, z, dt);
    record(frame);
  }
  const { worker } = terrain.debug();
  for (const w of gate.workers) w.terminate();

  const result = {
    profile, mode, vertices: terrain.vertexCount, uploads,
    commits: events.filter((e) => e.kind === 'commit').length,
    morphs: events.filter((e) => e.kind === 'commit' && e.morph).length,
    fingerprint: createHash('sha1').update(JSON.stringify(events)).digest('hex'),
    workerJobs: gate.jobs, lateBuilds: worker.lateBuilds, running: worker.running,
  };
  if (mode !== 'late') return result;

  /* Every transition the ride showed, built again from nothing: a fresh
     lattice laid down cold where the live surface stood, then the stages a
     re-anchor runs, wherever it ran. */
  const rgb = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
  const P = SNOWPACK;
  const palette = {
    cDeep: rgb(P.deep), cGroom: rgb(P.groom), cIce: rgb(P.ice), cShade: rgb(P.shade),
    cSlate: [rgb(P.slate[0]), rgb(P.slate[1])], cIron: [rgb(P.iron[0]), rgb(P.iron[1])],
  };
  const layout = terrainLayout();
  const count = layout.xs.length * layout.zs.length;
  const zeros = [new Float32Array(count), new Int8Array(count * 3), new Int8Array(count * 3),
    new Int8Array(count * 4)].map(sha1);
  const surfaceOf = (L) => [L.positions, L.normals, L.colors, L.surface, L.groomFrame].map(sha1);
  const deltasOf = (L) => [L.morphDY, L.morphDN, L.morphDC, L.morphDS].map(sha1);
  const mismatches = [];
  const same = (what, expected, shown, e) => expected.forEach((h, i) => {
    if (h !== shown[i]) mismatches.push(`frame ${e.frame} ${e.kind}: ${what} ${i}`);
  });
  let lead = null;
  let verified = 0;
  for (const e of events) {
    setWorldSeed(e.seed);
    if (e.kind === 'lead') {
      lead = e;
      continue;
    }
    if (e.kind === 'settle') {
      same('deltas', zeros, e.deltas, e);
    } else {
      const L = createLattice(layout, palette);
      if (e.kind === 'reset') {
        L.fill(e.to[0], e.to[1], e.to[2], true);
        same('deltas', zeros, e.deltas, e);
      } else {
        L.fill(e.from[0], e.from[1], e.from[2], true);
        L.prepareHeightReuse(e.to[0], e.to[1], e.from[0], e.from[1], getWorldSeed());
        const stage = (n) => L.buildRows(n, e.to[0], e.to[1], e.to[2], 0, layout.zs.length);
        stage(0);
        stage(1);
        if (e.morph) {
          stage(2);
          if (lead) same('lead', deltasOf(L), lead.deltas, e);
          else mismatches.push(`frame ${e.frame}: a geomorph with no lead before it`);
          stage(5);
          stage(6);
          same('follow', deltasOf(L), e.deltas, e);
        } else {
          same('deltas', zeros, e.deltas, e);
        }
        L.commitSurface();
      }
      same('surface', surfaceOf(L), e.surface, e);
    }
    verified++;
    lead = null;
  }
  return { ...result, mismatches: mismatches.slice(0, 5), verified };
}

// The web Worker the terrain asks for, over worker_threads, handing each
// answer over in the frame `gate.lag` says.
function webWorker(gate) {
  return class Worker {
    constructor(url) {
      if (!String(url).endsWith('/terrain-worker.js')) throw new Error(`no worker for ${url}`);
      const { port1, port2 } = new MessageChannel();
      this.port = port1;
      this.posted = new Int32Array(new SharedArrayBuffer(4));
      this.thread = new Thread(new URL(import.meta.url), {
        workerData: { url: String(url), port: port2, signal: this.posted.buffer },
        transferList: [port2],
      });
      this.thread.on('error', (error) => this.onerror?.(error));
      this.asked = [];
      this.answers = new Map();
      this.given = 0;
      this.last = 0;
      gate.workers.push(this);
    }

    postMessage(data, transfer) {
      this.port.postMessage(data, transfer);
      if (data.layout) return;
      gate.jobs++;
      this.asked.push({ id: data.id, frame: gate.frame, n: this.asked.length + 1 });
      this.pump();
    }

    pump() {
      while (!this.closed && this.given < this.asked.length) {
        const job = this.asked[this.given];
        const due = Math.max(job.frame + gate.lag(job.n), this.last);
        if (due > gate.frame) return;
        this.given++;
        this.last = due;
        this.onmessage?.({ data: this.answer(job.id) });
      }
    }

    answer(id) {
      for (;;) {
        const seen = Atomics.load(this.posted, 0);
        for (let m; (m = receiveMessageOnPort(this.port));) this.answers.set(m.message.id, m.message);
        if (this.answers.has(id)) {
          const data = this.answers.get(id);
          this.answers.delete(id);
          return data;
        }
        if (Atomics.wait(this.posted, 0, seen, 60000) === 'timed-out') {
          throw new Error('the terrain worker did not answer');
        }
      }
    }

    terminate() {
      this.closed = true;
      this.thread.terminate();
      this.port.close();
    }
  };
}
