// CHROMIUM_PATH=/usr/bin/chromium node tests/oregana/benchmark.mjs [--javascript] [baseline-git-ref]
// Compare production worklets on the same Chromium build. Timing is informational.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const fallback = process.argv.includes('--javascript');
const baseline = process.argv.slice(2).find(arg => arg !== '--javascript');
const root = fileURLToPath(new URL('../../', import.meta.url));
const originalCommit = 'd45f174eb7e0c0d8ee0caab4b1582b9b1f3ab3bd';
const revision = execFileSync('git', ['rev-parse', '--verify', (baseline || originalCommit) + '^{commit}'], {
  cwd: root, encoding: 'utf8',
}).trim();
const temp = await mkdtemp(join(tmpdir(), 'oregana-benchmark-'));
const roots = { original: join(temp, 'fun/oregana'), updated: join(root, 'fun/oregana') };
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html' }).end('<title>Oregana benchmark</title>');
      return;
    }
    if (pathname === '/configure-worklet.js') {
      // Configure the production callback before its first offline quantum.
      // Posting notes from the main thread would race the offline renderer.
      response.writeHead(200, { 'content-type': 'text/javascript' }).end(`
        const register = globalThis.registerProcessor.bind(globalThis);
        globalThis.registerProcessor = (name, Processor) => register(name, class extends Processor {
          constructor(options) {
            super(options);
            this.handle(options.processorOptions.configure);
          }
        });`);
      return;
    }
    const [, version, ...rest] = pathname.split('/');
    if (!Object.hasOwn(roots, version)) throw Error('Unknown version');
    const path = resolve(roots[version], ...rest);
    if (!path.startsWith(roots[version] + sep)) throw Error('Invalid path');
    const type = path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript';
    const body = await readFile(path);
    response.writeHead(200, { 'content-type': type }).end(body);
  } catch {
    response.writeHead(404).end();
  }
});

const profiles = [
  { name: 'Idle', preset: 0, notes: [] },
  { name: 'Principal 8 chord', preset: 0, notes: [48, 60, 64, 67] },
  { name: 'Tutti chord', preset: 16, notes: [48, 60, 64, 67] },
];
const rate = 48000;
const warmup = 2;
const sustained = 3;
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function measure({ version, preset, notes, rate, warmup, sustained, fallback }) {
  const context = new OfflineAudioContext(2, (warmup + sustained) * rate, rate);
  const base = '/' + version + '/';
  const accelerated = version === 'updated' && !fallback;
  await context.audioWorklet.addModule('/configure-worklet.js');
  await context.audioWorklet.addModule(base + (accelerated ? 'processor-simd.js' : 'processor.js'));
  const configure = {
    type: 'configure', preset, edits: [], wheel: 0, expression: 1, bend: 0,
    notes: notes.map(note => ({ type: 'noteOn', note, velocity: 90, delayMs: 0 })),
  };
  const processorOptions = { configure };
  if (accelerated) {
    processorOptions.module = await WebAssembly.compileStreaming(fetch(base + 'dsp/organ-simd.wasm'));
  }
  const node = new AudioWorkletNode(context, accelerated ? 'oregana-simd' : 'oregana', {
    numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions,
  });
  let error;
  node.onprocessorerror = () => { error = 'Oregana AudioWorklet failed'; };
  node.connect(context.destination);
  const warmed = context.suspend(warmup);
  const start = performance.now();
  const rendering = context.startRendering();
  await warmed;
  const warmMs = performance.now() - start;
  const resume = performance.now();
  await context.resume();
  const buffer = await rendering;
  const sustainedMs = (performance.now() - resume) / sustained;
  if (error) throw Error(error);
  // Hash the float bits of each stereo channel, including the attack. This
  // comparison is outside the timing window.
  const hashes = [];
  let peak = 0;
  for (let channel = 0; channel < 2; channel++) {
    const samples = buffer.getChannelData(channel);
    for (const value of samples) peak = Math.max(peak, Math.abs(value));
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', samples));
    hashes.push(Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join(''));
  }
  if (!Number.isFinite(peak) || (notes.length && peak < 1e-4)) throw Error('Invalid audio render');
  return { warmMs, sustainedMs, hashes };
}

let browser;
try {
  const archive = execFileSync('git', ['archive', revision, 'fun/oregana'], {
    cwd: root, maxBuffer: 16 * 1024 * 1024,
  });
  execFileSync('tar', ['-x', '-C', temp], { input: archive });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:' + server.address().port);
  console.log('Chromium ' + browser.version() + ', baseline ' + revision + ', ' + rate + ' Hz stereo, original JavaScript vs updated ' + (fallback ? 'JavaScript.' : 'SIMD.'));
  console.log('Median of 3 runs. Warmup covers ' + warmup + ' audio seconds, sustained covers ' + sustained + '.');
  for (const profile of profiles) {
    const runs = { original: [], updated: [] };
    for (let round = 0; round < 3; round++) {
      for (const version of round % 2 ? ['updated', 'original'] : ['original', 'updated']) {
        const result = await page.evaluate(measure, { ...profile, version, rate, warmup, sustained, fallback });
        if (runs[version].length) assert.deepEqual(result.hashes, runs[version][0].hashes, profile.name + ': nondeterministic ' + version + ' PCM');
        runs[version].push(result);
      }
    }
    // A historical timing baseline may use different pipe models and voicing.
    // Check today's two renderers against one another on the entire score.
    const other = await page.evaluate(measure, { ...profile, version: 'updated', rate, warmup, sustained, fallback: !fallback });
    assert.deepEqual(other.hashes, runs.updated[0].hashes, profile.name + ': current renderers differ');
    const timings = Object.entries(runs).map(([version, data]) => {
      const warm = median(data.map(run => run.warmMs));
      const steady = median(data.map(run => run.sustainedMs));
      return version + ' ' + warm.toFixed(0) + ' ms warmup, ' + steady.toFixed(1) + ' ms/audio s';
    });
    console.log(profile.name + ' — ' + timings.join(' | ') + ' | current renderers have identical stereo PCM');
  }
} finally {
  await browser?.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
