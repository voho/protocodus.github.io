import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
export function nativeCpuReader() {
  if (process.platform !== 'darwin') throw new Error('Native CPU counters require macOS');
  const child = spawn(process.env.TYRAN_PYTHON || 'python3', ['-u', fileURLToPath(new URL('./native-cpu.py', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] });
  const waiters = [], identities = new Map(); let failure = null, stderr = '', closing = false;
  child.stderr.on('data', data => { stderr += data; });
  const fail = error => { failure = error; for (const waiter of waiters.splice(0)) waiter.reject(error); };
  child.on('error', fail);
  child.stdin.on('error', fail);
  child.on('exit', code => { if (!closing || code || waiters.length) fail(new Error(`Native CPU helper exited ${code}: ${stderr}`)); });
  createInterface({ input: child.stdout }).on('line', line => {
    const waiter = waiters.shift();
    if (!waiter) return fail(new Error('Unexpected native CPU helper output'));
    try {
      const result = JSON.parse(line);
      for (const process of result.processInfo) {
        assert.equal(process.error, undefined, `proc_pid_rusage PID ${process.id}`);
        assert.ok(Number.isFinite(process.cpuTime) && Number.isFinite(process.startTime), 'Native counters must be finite');
        if (identities.has(process.id)) assert.equal(process.startTime, identities.get(process.id), `PID ${process.id} identity changed`);
        else identities.set(process.id, process.startTime);
      }
      waiter.resolve(result);
    } catch (error) { waiter.reject(error); fail(error); }
  });
  return {
    read(processes) {
      if (failure) return Promise.reject(failure);
      if (closing) return Promise.reject(new Error('Native CPU reader is closed'));
      return new Promise((resolve, reject) => {
        waiters.push({ resolve, reject });
        child.stdin.write(JSON.stringify(processes.map(({id,type}) => ({id,type})))+'\n');
      });
    },
    async close() {
      closing = true;
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise(resolve => child.once('close', resolve)); child.stdin.end(); await exited;
    },
  };
}
