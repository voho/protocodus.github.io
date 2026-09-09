import { createInput } from './input.js';
import { createAudio } from './audio.js';

const $ = id => document.getElementById(id);
const audio = createAudio();
let mode = 'loading', track, sim, view, modules, environment = 'auto', camera = 'follow';
let accumulator = 0, lastFrame = performance.now(), worldTime = 0, countdownTime = 0, lastCount = 0, goTime = 0;
let returnMode = 'race', toastUntil = 0, mapBackground, mapTransform, lastHud = 0, generation = 0, bestSaved = false, checkpointWarning = false;
const params = new URLSearchParams(location.hash.slice(1));
$('seed').value = (params.get('seed') || 'RAZER').slice(0, 64);
if (['auto', 'desert', 'jungle', 'beach', 'mountains'].includes(params.get('env'))) environment = params.get('env');
const debug = new URLSearchParams(location.search).has('debug');
const input = createInput(action => {
  if (action === 'pause') togglePause();
  if (action === 'gamepadMenu') {
    if (mode === 'preview' || mode === 'finished') startRace();
    else togglePause();
  }
  if (action === 'start' && mode === 'preview') startRace();
  if (action === 'recover' && mode === 'race') sim.recover();
  if (action === 'sound') toggleSound();
  if (action === 'camera') toggleCamera();
});
function setMode(next) {
  mode = next; document.body.dataset.mode = next;
  $('hud').hidden = ['loading', 'preview', 'error'].includes(next);
  $('pause-screen').hidden = next !== 'paused';
  $('results').hidden = next !== 'finished';
  if (next !== 'countdown') $('countdown').hidden = true;
}
function progress(value, label) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  $('loading-label').textContent = label; $('loading-percent').textContent = `${percent}%`;
  $('loading-bar').setAttribute('aria-valuenow', percent);
  $('loading-bar').firstElementChild.style.width = `${percent}%`;
}
function showToast(text, duration = 2600) {
  $('toast').textContent = text; $('toast').classList.add('visible'); toastUntil = performance.now() + duration;
}
function error(error) {
  console.error('Razer:', error); setMode('error'); audio.update(null, false);
  $('error-message').textContent = /webgl|context/i.test(String(error))
    ? 'Razer needs WebGL 2. Try enabling hardware acceleration in your browser, then reload.'
    : 'The circuit could not be prepared. Reload to give the engine another try.';
  $('error-screen').hidden = false;
}
function syncEnvironment() {
  $('auto-environment').setAttribute('aria-pressed', environment === 'auto');
  document.querySelectorAll('[data-environment]').forEach(button => {
    button.setAttribute('aria-pressed', environment === button.dataset.environment);
  });
}
const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
async function generate() {
  if (mode === 'loading' && modules && generation > 0) return;
  const ticket = ++generation;
  setMode('loading'); input.clear(); audio.update(null, false);
  $('start').disabled = true; $('start-label').textContent = 'Preparing circuit'; $('loading').classList.remove('ready');
  document.querySelectorAll('#track-form button, #track-form input').forEach(el => el.disabled = true);
  $('share').disabled = true;
  progress(.02, 'Loading');
  try {
    modules ||= await Promise.all([import('./track.js'), import('./simulation.js'), import('./render.js')]);
    view?.dispose(); sim?.dispose(); view = null; sim = null;
    const seed = $('seed').value.trim() || 'RAZER'; $('seed').value = seed;
    history.replaceState(null, '', `${location.pathname}${location.search}#${new URLSearchParams({ seed, env: environment })}`);
    syncEnvironment();
    progress(.07, 'Generating circuit'); await paint();
    track = modules[0].generateTrack(seed, environment);
    $('track-length').textContent = `${(track.length / 1000).toFixed(2)} KM`;
    $('track-routes').textContent = track.routes.length;
    $('track-climb').textContent = `${Math.round(track.elevationGain || 0)} m`;
    $('biome-label').textContent = `${modules[0].ENVIRONMENTS[track.environment]?.label || track.environment}`;
    $('track-name').textContent = track.name;
    $('track-hash').textContent = String(track.hash).toUpperCase();
    $('map-label').textContent = track.name.toUpperCase();
    progress(.15, 'Building terrain and routes'); await paint();
    view = await modules[2].createRenderer($('stage'), track, (value, label) => progress(.2 + value * .68, label));
    progress(.9, 'Preparing vehicles'); await paint();
    sim = await modules[1].createSimulation(track);
    if (ticket !== generation) return;
    makeMinimap();
    view.render(0, sim, { mode: 'preview', time: worldTime, camera });
    progress(1, 'Ready'); $('loading').classList.add('ready');
    $('start-label').textContent = 'Start race'; $('start').disabled = false;
    document.querySelectorAll('#track-form button, #track-form input').forEach(el => el.disabled = false);
    $('share').disabled = false;
    setMode('preview');
  } catch (cause) { error(cause); }
}
async function startRace() {
  if (!sim || !view || !['preview', 'finished', 'paused'].includes(mode)) return;
  audio.start();
  if (mode === 'preview' && ($('seed').value.trim() || 'RAZER') !== track.seed) {
    await generate();
    if (mode !== 'preview') return;
  }
  audio.start(); input.clear(); sim.reset(); accumulator = 0; bestSaved = false; checkpointWarning = false;
  countdownTime = 3.4; lastCount = 0; goTime = 0;
  setMode('countdown'); $('countdown').hidden = false; $('countdown').classList.remove('go');
  $('countdown').textContent = '3'; $('toast').classList.remove('visible'); $('toast').textContent = ''; toastUntil = 0;
  $('start').blur(); $('resume').blur(); $('race-again').blur();
  updateHud();
}
function togglePause() {
  if (mode === 'paused') {
    audio.start(); setMode(returnMode); input.clear(); lastFrame = performance.now();
    if (mode === 'countdown') $('countdown').hidden = false;
    return;
  }
  if (!['race', 'countdown'].includes(mode)) return;
  returnMode = mode; setMode('paused'); input.clear(); audio.update(sim.player, false); $('resume').focus();
}
function returnToMenu() { input.clear(); setMode('preview'); audio.update(sim.player, false); $('start').focus(); }
function toggleSound() {
  audio.toggle(); updateSound(); showToast(audio.muted ? 'Sound off' : 'Sound on', 1300);
}
function updateSound() {
  $('sound').setAttribute('aria-pressed', audio.muted);
  $('sound').setAttribute('aria-label', audio.muted ? 'Unmute sound' : 'Mute sound');
  $('sound').textContent = audio.muted ? 'Muted' : 'Audio';
}
function toggleCamera() { camera = camera === 'follow' ? 'wide' : 'follow'; showToast(camera === 'follow' ? 'Chase camera' : 'Chase camera · wide', 1500); }
function timeLabel(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const milliseconds = Math.max(0, Math.floor(seconds * 1000));
  return `${String(Math.floor(milliseconds / 60000)).padStart(2, '0')}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')}.${String(milliseconds % 1000).padStart(3, '0')}`;
}
function updateHud() {
  const player = sim.player;
  const speed = Math.round(Math.abs(player.speed) * 3.6);
  $('position').textContent = sim.position;
  $('lap').innerHTML = `${Math.min(3, player.lap)} <small>/ 3</small>`;
  $('race-time').textContent = timeLabel(sim.time);
  const best = player.lapTimes?.length ? Math.min(...player.lapTimes) : null;
  $('best-lap').textContent = best ? `BEST ${timeLabel(best)}` : 'BEST —';
  $('speed').textContent = String(speed);
  $('surface-label').textContent = player.inWater ? 'WATER' : (player.surface || track.surfaceAt?.(player.progress, player.routeId) || 'asphalt').toUpperCase();
  $('gear').textContent = audio.telemetry.gear < 0 ? 'R' : audio.telemetry.gear || 'N';
  $('rev-fill').style.width = `${Math.min(100, audio.telemetry.rpm / 7400 * 100)}%`;
  $('boost-fill').style.width = `${Math.max(0, player.boost / 5 * 100)}%`;
  $('boost-time').textContent = player.boost > 0 ? `${player.boost.toFixed(1)}s` : '—';
  $('boost-status').classList.toggle('active', player.boost > 0);
  $('driving-hint').textContent = player.checkpointMissed ? 'Checkpoint missed · Reset / R' : player.offRoad ? 'Off road · Reset / R' : sim.time < 12 ? 'W / ↑ accelerate · Space handbrake' : '';
  drawMinimap();
}
function makeMinimap() {
  mapBackground = document.createElement('canvas'); mapBackground.width = 360; mapBackground.height = 300;
  const ctx = mapBackground.getContext('2d');
  const roads = [...track.points, ...track.routes.flatMap(route => route.points)];
  const minX = Math.min(...roads.map(p => p.x)) - 10, maxX = Math.max(...roads.map(p => p.x)) + 10;
  const minZ = Math.min(...roads.map(p => p.z)) - 10, maxZ = Math.max(...roads.map(p => p.z)) + 10;
  const scale = Math.min(302 / (maxX - minX), 242 / (maxZ - minZ));
  mapTransform = point => ({ x: 180 + (point.x - (maxX + minX) / 2) * scale, y: 150 + (point.z - (maxZ + minZ) / 2) * scale });
  function path(points, closed) {
    ctx.beginPath(); points.forEach((point, i) => { const p = mapTransform(point); if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    if (closed) ctx.closePath();
  }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  path(track.points, true); ctx.strokeStyle = '#14231bcc'; ctx.lineWidth = 14; ctx.stroke(); ctx.strokeStyle = '#f0eed3b8'; ctx.lineWidth = 5; ctx.stroke();
  for (const route of track.routes) { path(route.points, false); ctx.strokeStyle = '#ffad7490'; ctx.lineWidth = 3; ctx.stroke(); }
  const start = mapTransform(track.points[0]); ctx.fillStyle = '#ffffff'; ctx.fillRect(start.x - 5, start.y - 5, 10, 10);
}
function drawMinimap() {
  if (!mapBackground) return;
  const ctx = $('map').getContext('2d'); ctx.clearRect(0, 0, 360, 300); ctx.drawImage(mapBackground, 0, 0);
  for (const car of [...sim.cars].reverse()) {
    const p = mapTransform(car); ctx.beginPath(); ctx.arc(p.x, p.y, car.id === sim.player.id ? 6 : 4, 0, Math.PI * 2);
    ctx.fillStyle = car.id === sim.player.id ? '#ff743e' : typeof car.color === 'number' ? `#${car.color.toString(16).padStart(6, '0')}` : car.color;
    ctx.strokeStyle = '#13211b'; ctx.lineWidth = 2; ctx.fill(); ctx.stroke();
    if (car.id === sim.player.id) { ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2); ctx.strokeStyle = '#fff6'; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
}
function finishRace() {
  setMode('finished'); input.clear(); audio.cue('finish');
  $('toast').classList.remove('visible'); $('toast').textContent = ''; toastUntil = 0;
  const player = sim.player;
  const finish = player.finishTime ?? sim.time;
  $('result-title').textContent = sim.position === 1 ? 'Race won' : sim.position <= 3 ? 'Podium finish' : 'Race complete';
  $('result-subtitle').textContent = `P${sim.position} / 6 · ${track.name}`;
  $('result-time').textContent = timeLabel(finish);
  $('result-lap').textContent = timeLabel(Math.min(...player.lapTimes));
  const drivers = [...sim.cars].sort((a, b) => (a.finished && b.finished) ? a.finishTime - b.finishTime : a.finished ? -1 : b.finished ? 1 : b.totalProgress - a.totalProgress);
  $('leaderboard').replaceChildren(...drivers.map(car => {
    const row = document.createElement('li'); row.classList.toggle('you', car === player);
    const dot = document.createElement('i'); dot.style.backgroundColor = typeof car.color === 'number' ? `#${car.color.toString(16).padStart(6, '0')}` : car.color;
    const name = document.createElement('span'); name.textContent = car === player ? 'You' : car.name;
    const time = document.createElement('span'); time.textContent = car.finished ? timeLabel(car.finishTime) : `Lap ${Math.min(3, car.lap)}`;
    row.append(dot, name, time); return row;
  }));
  if (!bestSaved) {
    try {
      const key = `razer-best-v2:${track.seed}:${track.environment}`;
      const previous = Number(localStorage.getItem(key)) || Infinity;
      if (finish < previous) { localStorage.setItem(key, String(finish)); $('personal-best').textContent = previous < Infinity ? `New personal best. ${(previous - finish).toFixed(2)}s quicker.` : 'Best time saved.'; }
      else $('personal-best').textContent = `Personal best ${timeLabel(previous)} · +${(finish - previous).toFixed(2)}s`;
    } catch { $('personal-best').textContent = 'Race complete.'; }
    bestSaved = true;
  }
  $('race-again').focus();
}
function processEvents() {
  for (const event of sim.events.splice(0)) {
    const isPlayer = event.carId == null || event.carId === sim.player.id;
    if (!isPlayer) continue;
    if (event.type === 'boost') { showToast('Boost · 5 seconds', 2000); audio.cue('boost'); }
    if (event.type === 'lap') { showToast(sim.player.lap === 3 ? 'Final lap' : `LAP ${sim.player.lap}`, 2300); audio.cue('lap'); }
    if (event.type === 'recover') { showToast(event.reason === 'offtrack' ? 'Beyond circuit limits · car reset' : 'Car recovered', 1500); audio.cue('recover'); }
    if (event.type === 'collision') audio.cue('collision', event.intensity);
    if (event.type === 'land' && event.intensity > .15) audio.cue('land', event.intensity);
  }
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(.08, Math.max(0, (now - lastFrame) / 1000)); lastFrame = now;
  if (toastUntil && now > toastUntil) { $('toast').classList.remove('visible'); $('toast').textContent = ''; toastUntil = 0; }
  if (!view || !sim || mode === 'error' || mode === 'loading') return;
  if (mode !== 'paused') worldTime += dt;
  if (mode === 'countdown') {
    countdownTime -= dt;
    const count = Math.max(1, Math.ceil(countdownTime));
    if (count <= 3 && count !== lastCount) { lastCount = count; $('countdown').textContent = count; audio.cue('count'); }
    if (countdownTime <= 0) { setMode('race'); goTime = 1; $('countdown').hidden = false; $('countdown').textContent = 'GO!'; $('countdown').classList.add('go'); audio.cue('go'); }
  }
  const rawControls = input.read();
  const controls = mode === 'race' ? rawControls : { throttle: 0, brake: 0, steer: 0, drift: false };
  if (mode === 'race') {
    accumulator += dt;
    while (accumulator >= 1 / 60) { sim.step(1 / 60, controls); accumulator -= 1 / 60; if (sim.finished || sim.player.finished) break; }
    processEvents();
    if (sim.player.checkpointMissed && !checkpointWarning) showToast('Checkpoint missed. Reset or press R.', 4200);
    checkpointWarning = sim.player.checkpointMissed;
    if (goTime > 0) { goTime -= dt; if (goTime <= 0) $('countdown').hidden = true; }
    if (sim.finished || sim.player.finished) finishRace();
  }
  audio.update(sim.player, mode === 'race' || mode === 'countdown', controls.throttle, dt);
  view.render(mode === 'paused' ? 0 : dt, sim, { mode: mode === 'countdown' ? 'race' : mode, time: worldTime, camera });
  if (now - lastHud > 70 && !['preview', 'loading'].includes(mode)) { updateHud(); lastHud = now; }
}

$('track-form').addEventListener('submit', event => { event.preventDefault(); if (mode === 'preview') generate(); });
$('seed').addEventListener('input', () => {
  if (mode === 'preview') $('start-label').textContent = ($('seed').value.trim() || 'RAZER') !== track.seed ? 'Generate & race' : 'Start race';
});
$('shuffle').addEventListener('click', () => {
  const value = crypto.getRandomValues(new Uint32Array(1))[0].toString(36).toUpperCase(); $('seed').value = `RZ-${value}`; generate();
});
document.querySelectorAll('[data-environment]').forEach(button => button.addEventListener('click', () => {
  if (environment === button.dataset.environment) return;
  environment = button.dataset.environment; generate();
}));
$('auto-environment').addEventListener('click', () => { if (environment !== 'auto') { environment = 'auto'; generate(); } });
$('share').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.href); showToast('Circuit link copied.'); }
  catch { showToast('Copy the address bar to share this circuit.', 4000); }
});
$('start').addEventListener('click', startRace); $('pause').addEventListener('click', togglePause); $('resume').addEventListener('click', togglePause);
$('restart').addEventListener('click', startRace); $('race-again').addEventListener('click', startRace);
$('back-to-menu').addEventListener('click', returnToMenu); $('new-circuit').addEventListener('click', returnToMenu);
$('sound').addEventListener('click', toggleSound); $('camera').addEventListener('click', toggleCamera);
$('recover').addEventListener('click', () => { if (mode === 'race') sim.recover(); });
$('retry').addEventListener('click', () => location.reload());
window.addEventListener('resize', () => view?.resize());
window.addEventListener('blur', () => { if (['race', 'countdown'].includes(mode)) togglePause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && ['race', 'countdown'].includes(mode)) togglePause(); });
$('stage').addEventListener('webglcontextlost', event => { event.preventDefault(); error(new Error('WebGL context lost')); });
// Keep keyboard focus inside active modal surfaces.
document.addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const dialog = document.querySelector('.overlay:not([hidden])'); if (!dialog) return;
  const items = [...dialog.querySelectorAll('button:not(:disabled),a[href]')];
  if (!items.length) return;
  if (event.shiftKey && (document.activeElement === items[0] || !dialog.contains(document.activeElement))) { event.preventDefault(); items.at(-1).focus(); }
  else if (!event.shiftKey && (document.activeElement === items.at(-1) || !dialog.contains(document.activeElement))) { event.preventDefault(); items[0].focus(); }
});
if (debug) window.razerDebug = {
  get track() { return track; }, get simulation() { return sim; }, get view() { return view; },
  snapshot: () => ({ mode, seed: track?.seed, environment: track?.environment, time: sim?.time, position: sim?.position,
    player: sim ? { x: sim.player.x, z: sim.player.z, speed: sim.player.speed, boost: sim.player.boost, lap: sim.player.lap, progress: sim.player.progress } : null,
    render: view?.renderer?.info.render, memory: view?.renderer?.info.memory }),
};
updateSound(); syncEnvironment(); requestAnimationFrame(frame); generate();
