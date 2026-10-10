#!/usr/bin/env node
// Runs every Ashline check with one command. From fun/ashline:
//   node tests/run-checks.mjs              simulation checks and node:test suites in parallel lanes
//   node tests/run-checks.mjs --browser    also every Playwright browser check, against a built-in static server
// Run with --help for filters and options.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism, homedir, tmpdir } from 'node:os';
import { delimiter, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TESTS = dirname(fileURLToPath(import.meta.url)), ASHLINE = dirname(TESTS), ROOT = resolve(ASHLINE, '../..');
// Long-running measurement tools rather than pass/fail checks.
const TOOLS = new Set(['performance-benchmark', 'race-balance']);
const KIND_ORDER = ['node', 'suite', 'browser', 'tool'];
const HELP = `Usage: node tests/run-checks.mjs [options] [filter ...]

Runs every check in tests/: node scripts (node tests/<name>.mjs), node:test suites
(node --test tests/<name>.test.mjs) and, with --browser, every Playwright browser check.
Filters select checks whose name contains any of the given words.

Options
  --browser            Also run browser checks. A static server for the repository root
                       starts on a free local port and sets ASHLINE_URL.
  --browser-only       Run only browser checks.
  --tools              Also run performance-benchmark and race-balance, one at a time, last.
  --jobs N             Parallel node lanes (default: ${defaultJobs()}).
  --browser-jobs N     Parallel browser checks (default: ${defaultBrowserJobs()}).
  --timeout S          Seconds before a check is stopped and failed (default: 900; tools have no limit).
  --retries N          Re-run failed checks up to N times, one at a time (default: 0).
  --logs DIR           Directory for per-check logs and screenshots (default: a new folder in ${tmpdir()}).
  --list               Print the discovered checks and exit.
  --verbose            Print each check's full output when it finishes.

Environment
  ASHLINE_PLAYWRIGHT   Playwright module path; otherwise 'playwright', NODE_PATH and the global npm root are tried.
  ASHLINE_BROWSER      Playwright channel; defaults to 'chrome' when Google Chrome is installed, else 'chromium'.
  ASHLINE_URL          Use an already running server instead of the built-in one.
  ASHLINE_SCREENSHOTS  Root folder for browser screenshots; each check writes to its own subfolder.`;

function defaultJobs() { return Math.max(1, availableParallelism()); }
function defaultBrowserJobs() { return Math.max(1, Math.min(3, Math.floor(availableParallelism() / 2))); }

function parseArguments(argv) {
  const options = { browser: false, node: true, tools: false, jobs: defaultJobs(), browserJobs: defaultBrowserJobs(),
    timeout: null, retries: 0, logs: null, list: false, verbose: false, filters: [] };
  const count = (flag, value, min) => {
    const number = Number(value);
    if (!Number.isInteger(number) || number < min) throw new Error(`${flag} needs an integer of at least ${min}`);
    return number;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i], [flag, inline] = arg.startsWith('--') && arg.includes('=') ? arg.split(/=(.*)/s) : [arg];
    const value = () => { const given = inline ?? argv[++i]; if (given === undefined) throw new Error(`${flag} needs a value`); return given; };
    if (flag === '--help' || flag === '-h') { console.log(HELP); process.exit(0); }
    else if (flag === '--browser') options.browser = true;
    else if (flag === '--browser-only') { options.browser = true; options.node = false; }
    else if (flag === '--tools') options.tools = true;
    else if (flag === '--jobs') options.jobs = count(flag, value(), 1);
    else if (flag === '--browser-jobs') options.browserJobs = count(flag, value(), 1);
    else if (flag === '--timeout') options.timeout = count(flag, value(), 1);
    else if (flag === '--retries') options.retries = count(flag, value(), 0);
    else if (flag === '--logs') options.logs = resolve(value());
    else if (flag === '--list') options.list = true;
    else if (flag === '--verbose') options.verbose = true;
    else if (flag.startsWith('-')) throw new Error(`Unknown option ${flag}; see --help`);
    else options.filters.push(arg.replace(/\.mjs$/, ''));
  }
  return options;
}

function discover() {
  return readdirSync(TESTS).filter(file => file.endsWith('.mjs') && file !== 'run-checks.mjs').sort().flatMap(file => {
    const name = file.slice(0, -4), source = readFileSync(join(TESTS, file), 'utf8');
    // Shared fixtures such as performance-scenes.mjs export helpers and run nothing on their own.
    if (/^export\s/m.test(source)) return [];
    const kind = TOOLS.has(name) ? 'tool' : source.includes('ASHLINE_PLAYWRIGHT') ? 'browser' : file.endsWith('.test.mjs') ? 'suite' : 'node';
    return [{ name, file, kind }];
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };

// Serves the repository root like `python3 -m http.server`: directory index, trailing-slash redirect and
// Last-Modified revalidation, so browser caching behaves as in the documented manual setup.
function startServer() {
  const server = createServer((request, response) => {
    let url, path;
    try { url = new URL(request.url, 'http://localhost'); path = decodeURIComponent(url.pathname); }
    catch { response.writeHead(400).end(); return; }
    let file = resolve(ROOT, `.${path}`), stats;
    if (file !== ROOT && !file.startsWith(ROOT + sep)) { response.writeHead(403).end(); return; }
    try {
      stats = statSync(file);
      if (stats.isDirectory()) {
        if (!url.pathname.endsWith('/')) { response.writeHead(301, { Location: `${url.pathname}/${url.search}` }).end(); return; }
        file = join(file, 'index.html'); stats = statSync(file);
      }
    } catch { response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    const modified = new Date(Math.floor(stats.mtimeMs / 1000) * 1000), since = Date.parse(request.headers['if-modified-since'] ?? '');
    if (since >= modified.getTime()) { response.writeHead(304).end(); return; }
    response.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': stats.size, 'Last-Modified': modified.toUTCString() });
    if (request.method === 'HEAD') { response.end(); return; }
    createReadStream(file).on('error', () => response.destroy()).pipe(response);
  });
  return new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', () => done(server)); });
}

function chromeInstalled() {
  const candidates = process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : process.platform === 'win32' ? [process.env.LOCALAPPDATA, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']]
      .filter(Boolean).map(base => join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    : ['/opt/google/chrome/chrome'];
  return candidates.some(path => existsSync(path));
}

function locatePlaywright() {
  if (process.env.ASHLINE_PLAYWRIGHT) return process.env.ASHLINE_PLAYWRIGHT;
  try { return import.meta.resolve('playwright'); } catch {}
  let globalRoot = null;
  try {
    globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000,
      shell: process.platform === 'win32' }).trim();
  } catch {}
  const folders = [...(process.env.NODE_PATH ?? '').split(delimiter), globalRoot, join(homedir(), '.npm-global', 'lib', 'node_modules'),
    '/usr/local/lib/node_modules', '/opt/homebrew/lib/node_modules', '/usr/lib/node_modules'].filter(Boolean);
  const found = folders.map(folder => join(folder, 'playwright', 'index.mjs')).find(path => existsSync(path));
  return found && pathToFileURL(found).href;
}

// Resolves the environment every browser check reads, or explains what is missing.
async function browserEnvironment() {
  const playwright = locatePlaywright();
  if (!playwright) throw new Error('Playwright was not found. Install it (npm install -g playwright) or set ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs.');
  const channel = process.env.ASHLINE_BROWSER || (chromeInstalled() ? 'chrome' : 'chromium');
  if (channel === 'chromium') {
    const { chromium } = await import(playwright);
    if (!existsSync(chromium.executablePath())) throw new Error(`Google Chrome is not installed and Playwright's Chromium is missing at ${chromium.executablePath()}. Run: npx playwright install chromium`);
  }
  return { ASHLINE_PLAYWRIGHT: playwright, ASHLINE_BROWSER: channel };
}

const running = new Set();
function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGKILL');
  } catch { child.kill('SIGKILL'); }
}

function runCheck(check, { env, timeout, logFile }) {
  const args = check.kind === 'suite' ? ['--test', '--test-reporter=tap', `tests/${check.file}`] : [`tests/${check.file}`];
  return new Promise(done => {
    const started = performance.now(), chunks = [], log = createWriteStream(logFile);
    log.write(`$ node ${args.join(' ')}\n`);
    // Each check gets its own process group so a timeout also stops the browsers it launched.
    const child = spawn(process.execPath, args, { cwd: ASHLINE, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32' });
    running.add(child);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { chunks.push(chunk); log.write(chunk); });
    let timedOut = false;
    const timer = timeout && setTimeout(() => { timedOut = true; killTree(child); }, timeout * 1000);
    const finish = (code, error) => {
      clearTimeout(timer); running.delete(child);
      const ms = performance.now() - started, output = Buffer.concat(chunks).toString('utf8') + (error ? `\n${error.stack}` : '');
      const status = timedOut ? 'timeout' : code === 0 ? 'pass' : 'fail';
      const tally = name => Number(output.match(new RegExp(`^# ${name} (\\d+)$`, 'm'))?.[1]);
      const subtests = check.kind === 'suite' && Number.isFinite(tally('tests')) ? { total: tally('tests'), passed: tally('pass') } : null;
      log.end(`\n[${status}${timedOut ? ` after ${timeout} s` : ` with exit code ${code}`}, ${seconds(ms)}]\n`);
      done({ status, code, ms, output, subtests });
    };
    child.on('error', error => finish(null, error));
    child.on('close', code => finish(code));
  });
}

async function pool(items, limit, work) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await work(items[next++]);
  }));
}

function seconds(ms) {
  const total = ms / 1000;
  return total < 60 ? `${total.toFixed(1)}s` : `${Math.floor(total / 60)}m${String(Math.round(total % 60)).padStart(2, '0')}s`;
}

const tail = (text, lines = 40) => text.trimEnd().split('\n').slice(-lines).join('\n');

// TAP failure blocks (`not ok` through its closing `...`) say more than the tail of a long suite log.
function failureSummary(check, output) {
  if (check.kind !== 'suite') return tail(output);
  const lines = output.split('\n'), blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*not ok /.test(lines[i])) continue;
    const end = lines.findIndex((line, j) => j > i && /^\s*\.\.\.$/.test(line));
    blocks.push(lines.slice(i, end < 0 ? i + 20 : end).filter(line => !/^\s+(duration_ms|type):/.test(line)).join('\n'));
  }
  return blocks.length ? tail(blocks.join('\n'), 80) : tail(output);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const all = discover();
  const selected = all.filter(check => (check.kind === 'browser' ? options.browser : check.kind === 'tool' ? options.tools : options.node)
    && (!options.filters.length || options.filters.some(filter => check.name.includes(filter))));
  if (options.list) {
    for (const kind of KIND_ORDER) {
      const checks = all.filter(check => check.kind === kind);
      console.log(`${kind} (${checks.length}): ${checks.map(check => check.name).join(', ')}`);
    }
    return 0;
  }
  if (!selected.length) { console.error('No checks match. Use --list to see them.'); return 1; }

  const logs = options.logs ?? join(tmpdir(), 'ashline-checks', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(logs, { recursive: true });
  const counts = KIND_ORDER.map(kind => [kind, selected.filter(check => check.kind === kind).length]).filter(([, n]) => n);
  console.log(`Ashline checks: ${counts.map(([kind, n]) => `${n} ${kind}`).join(', ')} · logs in ${logs}`);

  const results = new Map(), started = performance.now(), phases = [];
  const report = (check, result, note = '') => {
    const detail = result.subtests ? ` · ${result.subtests.passed}/${result.subtests.total} subtests` : '';
    console.log(`${result.status.toUpperCase().padEnd(7)} ${check.kind.padEnd(7)} ${check.name.padEnd(36)} ${seconds(result.ms).padStart(7)}${detail}${note}`);
    const text = options.verbose ? result.output.trimEnd() : result.status === 'pass' ? '' : failureSummary(check, result.output);
    if (text) console.log(text.replace(/^/gm, '    │ '));
  };
  const phase = async (label, checks, jobs, { timeout = options.timeout ?? 900, env = () => ({}) } = {}) => {
    if (!checks.length) return;
    const begin = performance.now();
    console.log(`\n${label}: ${checks.length} check${checks.length === 1 ? '' : 's'}, ${Math.min(jobs, checks.length)} at a time`);
    await pool(checks, jobs, async check => {
      const result = await runCheck(check, { env: env(check), timeout, logFile: join(logs, `${check.name}.log`) });
      results.set(check, { ...result, attempts: 1 }); report(check, result);
    });
    // Retries run alone, so a check that failed only under parallel load gets a quiet machine.
    for (let attempt = 1; attempt <= options.retries; attempt++) for (const check of checks) {
      if (results.get(check).status === 'pass') continue;
      const result = await runCheck(check, { env: env(check), timeout, logFile: join(logs, `${check.name}.retry${attempt}.log`) });
      results.set(check, { ...result, attempts: attempt + 1 }); report(check, result, ` (retry ${attempt})`);
    }
    phases.push(`${label} ${seconds(performance.now() - begin)}`);
  };

  const byKind = kinds => selected.filter(check => kinds.includes(check.kind));
  await phase('Node checks', byKind(['node', 'suite']), options.jobs);

  const browserChecks = byKind(['browser']);
  let server = null;
  if (browserChecks.length) {
    let environment;
    try { environment = await browserEnvironment(); }
    catch (error) {
      console.error(`\nBrowser checks cannot run: ${error.message}`);
      for (const check of browserChecks) results.set(check, { status: 'skipped', ms: 0, output: error.message, attempts: 0 });
    }
    if (environment) {
      let url = process.env.ASHLINE_URL;
      if (!url) {
        server = await startServer();
        url = `http://127.0.0.1:${server.address().port}/${relative(ROOT, ASHLINE).split(sep).join('/')}/`;
      }
      const screenshots = process.env.ASHLINE_SCREENSHOTS || join(logs, 'screenshots');
      console.log(`\nBrowser: ${environment.ASHLINE_BROWSER} via ${environment.ASHLINE_PLAYWRIGHT} · ${url} · screenshots in ${screenshots}`);
      const env = check => ({ ...environment, ASHLINE_URL: url, ASHLINE_SCREENSHOTS: join(screenshots, check.name) });
      try { await phase('Browser checks', browserChecks, options.browserJobs, { env }); }
      finally { server?.close(); server?.closeAllConnections(); }
    }
  }
  await phase('Tools', byKind(['tool']), 1, { timeout: options.timeout });

  const rows = selected.map(check => {
    const result = results.get(check);
    return { check, ...result, log: result.attempts ? join(logs, `${check.name}${result.attempts > 1 ? `.retry${result.attempts - 1}` : ''}.log`) : null };
  }).sort((a, b) => KIND_ORDER.indexOf(a.check.kind) - KIND_ORDER.indexOf(b.check.kind) || a.check.name.localeCompare(b.check.name));
  const width = Math.max(5, ...rows.map(row => row.check.name.length));
  console.log(`\n${'Status'.padEnd(8)}${'Kind'.padEnd(8)}${'Check'.padEnd(width + 2)}${'Time'.padStart(7)}  Detail`);
  for (const row of rows) {
    const detail = [row.subtests && `${row.subtests.passed}/${row.subtests.total} subtests`,
      row.attempts > 1 && `${row.status === 'pass' ? 'passed' : 'still failing'} on attempt ${row.attempts}`,
      row.status === 'fail' && `exit ${row.code}`, row.status === 'timeout' && 'timed out', row.status === 'skipped' && 'browser unavailable',
      row.status !== 'pass' && row.log]
      .filter(Boolean).join(' · ');
    console.log(`${row.status.toUpperCase().padEnd(8)}${row.check.kind.padEnd(8)}${row.check.name.padEnd(width + 2)}${seconds(row.ms).padStart(7)}  ${detail}`.trimEnd());
  }
  const failed = rows.filter(row => row.status !== 'pass'), retried = rows.filter(row => row.status === 'pass' && row.attempts > 1);
  const subtests = rows.reduce((sum, row) => sum + (row.subtests?.total ?? 0), 0);
  console.log(`\n${rows.length - failed.length}/${rows.length} checks passed${subtests ? ` (${subtests} node:test subtests)` : ''}`
    + `${retried.length ? `, ${retried.length} only on retry` : ''} in ${seconds(performance.now() - started)} · ${phases.join(' · ')}`);
  if (failed.length) console.log(`Failed: ${failed.map(row => `${row.check.name} (${row.status})`).join(', ')}`);
  // Machine-readable results for scripts that run the suite.
  writeFileSync(join(logs, 'summary.json'), `${JSON.stringify({ passed: rows.length - failed.length, failed: failed.length, ms: Math.round(performance.now() - started),
    checks: rows.map(({ check, status, ms, attempts, subtests, log }) => ({ name: check.name, kind: check.kind, status, ms: Math.round(ms), attempts, subtests, log })) }, null, 2)}\n`);
  return failed.length ? 1 : 0;
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { for (const child of running) killTree(child); process.exit(130); });
try { process.exitCode = await main(); }
catch (error) { console.error(error.message); process.exitCode = 2; }
