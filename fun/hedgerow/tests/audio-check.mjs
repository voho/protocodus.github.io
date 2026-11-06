// Run: node fun/hedgerow/tests/audio-check.mjs
// Decode and render real Web Audio, including a missing-file fallback and
// the delayed arrival of distant gunfire. No speakers or game boot required.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const audioRoot = resolve(root, 'fun/hedgerow/assets/audio');
const manifest = JSON.parse(await readFile(resolve(audioRoot, 'manifest.json'), 'utf8'));
assert.equal(manifest.license, 'CC0-1.0');
assert.equal(manifest.assets.length, 21);
let bytes = 0;
for (const asset of manifest.assets) {
  const data = await readFile(resolve(audioRoot, asset.file));
  assert.equal(data.length, asset.bytes, `${asset.file}: exact vendored size`);
  assert.equal(createHash('sha256').update(data).digest('hex'), asset.sha256, `${asset.file}: exact vendored payload`);
  bytes += data.length;
}
assert.ok(bytes < 250_000, 'the whole optional audio layer stays below 250 kB');
const retained = manifest.retainedAssets || [], receipts = new Map(manifest.assets.map(asset => [asset.file, asset]));
for (const asset of retained) {
  assert.ok(!receipts.has(asset.file), 'retained and runtime receipts are distinct');
  assert.equal(asset.license, 'CC0-1.0');
  assert.match(asset.download, /\/([a-f\d]{40})\//, 'preserved source downloads remain pinned');
  assert.match(await readFile(resolve(audioRoot, asset.licenseFile), 'utf8'), /CC0/);
  const data = await readFile(resolve(audioRoot, asset.file));
  assert.equal(data.length, asset.bytes); assert.equal(createHash('sha256').update(data).digest('hex'), asset.sha256);
  receipts.set(asset.file, asset);
}
// The previous sample-bank module is preserved without activating a second
// runtime/voice pool. Its complete source coverage must remain intact.
const { SOUND_SAMPLES } = await import('../js/audio-samples.js');
for (const file of new Set(Object.values(SOUND_SAMPLES).flat())) assert.ok(receipts.has(file), `preserved sample-bank receipt for ${file}`);

let missingAudio = false, transientAudio = false;
const server = createServer(async (req, res) => {
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Audio check</title>'); return; }
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (transientAudio && pathname.endsWith('/rifle-01.ogg')) { transientAudio = false; res.writeHead(503).end(); return; }
    const file = resolve(root, '.' + pathname);
    if (!file.startsWith(root + sep)) throw new Error('path');
    if (missingAudio && pathname.includes('/assets/audio/')) throw new Error('missing audio');
    const data = await readFile(file);
    res.setHeader('Content-Type', extname(file) === '.js' ? 'text/javascript' : 'audio/ogg');
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const render = async (mode) => page.evaluate(async mode => {
    const { createAudio } = await import('/fun/hedgerow/js/audio.js');
    const controlled = mode !== 'mute' && mode !== 'pause-volume' && mode !== 'pause-effects';
    const seconds = mode === 'ambience' || mode === 'frogs' ? 20 : mode.startsWith('shelter-') ? 10 : mode.startsWith('fire-weather-') ? 5 : mode.includes('reload') ? 6 : 3;
    const ctx = new OfflineAudioContext(2, 44100 * seconds, 44100);
    const panners = [], makePanner = ctx.createStereoPanner.bind(ctx);
    ctx.createStereoPanner = () => { const panner = makePanner(); panners.push(panner); return panner; };
    let clock = 0;
    if (controlled) {
      // Drive the scheduler ahead on a deterministic clock, then render its
      // actual AudioNodes/automation. This does not replace Web Audio DSP.
      Object.defineProperty(ctx, 'currentTime', { get: () => clock });
      Object.defineProperty(ctx, 'state', { get: () => 'running' });
    }
    const realContext = window.AudioContext;
    window.AudioContext = function () { return ctx; };
    const audio = createAudio();
    const frogPaths = [];
    if (mode === 'ambience' || mode.startsWith('war-') || mode.startsWith('fire-weather-')) audio.setAmbience({ rain: 0, wind: [0, 0], birds: mode === 'ambience' });
    if (mode === 'frogs') audio.setAmbience({ rain: 0, wind: [0, 0], frogs: 120, frogsHeight: .7 });
    if (mode === 'mix-effects-muted') audio.setMix({ effects: 0, ambience: 0 });
    if (mode === 'mix-ambience-only') audio.setMix({ effects: 0, ambience: 1 });
    if (mode === 'mix-ambience-muted' || mode === 'mix-combat') audio.setMix({ effects: 1, ambience: 0 });
    if (mode === 'mix-master-muted') { audio.setVolume(0); audio.setMix({ effects: 1, ambience: 1 }); }
    audio.prepare();
    window.AudioContext = realContext;
    const preloaded = mode.startsWith('mix-') ? await audio.preloadSamples() : await audio.loadSamples();
    audio.setListener(0, 1.6, 0, 0);
    if (mode === 'blocked') audio.setOcclusionProbe(() => ({ surface: 'stone', t: 8 }));
    if (mode === 'turn-shot' || mode === 'spatial-budget') {
      audio.setOcclusionProbe(() => null);
      for (let i = 0; i < (mode === 'spatial-budget' ? 60 : 1); i++) audio.gunshot('kar98k', 0, 1.6, -343);
      clock = .2; audio.setListener(0, 1.6, 0, Math.PI / 2);
      if (mode === 'spatial-budget') {
        clock = .3; audio.setListener(0, 1.6, 0, Math.PI / 2 + .1);
        clock = .4; audio.setListener(0, 1.6, 0, Math.PI / 2 + .2);
      }
    } else if (mode.startsWith('shelter-')) {
      audio.setOutdoors(true); audio.setSpace(mode === 'shelter-canopy' ? 0 : 1, 4);
      for (clock = 0; clock < 10; clock += .25) {
        if (clock === 3 && mode !== 'shelter-open') audio.setShelter(1);
        if (clock === 6 && mode === 'shelter-reopen') audio.setShelter(0);
        audio.tick();
      }
    } else if (mode.startsWith('fire-weather-')) {
      audio.setFireSources([{ x: 0, y: 1.6, z: -5, size: 1, on: true }]);
      audio.setOutdoors(true); audio.setSpace(1, 4);
      for (clock = 0; clock < 5; clock += .25) {
        if (clock === 2 && mode === 'fire-weather-roof') audio.setShelter(1);
        audio.tick();
      }
    } else if (mode === 'frogs') {
      audio.setListener(0, 3.7, 120, 0);
      audio.setOcclusionProbe((lx, ly, lz, sx, sy, sz) => { frogPaths.push({ listenerY: ly, sourceY: sy }); return null; });
      audio.setOutdoors(true);
      for (clock = 0; clock < 20; clock += .25) {
        if (clock === 10) audio.setListener(0, 9.7, 120, 0);
        if (clock === 16) audio.setOutdoors(false);
        audio.tick();
      }
    } else if (mode === 'ambience') {
      audio.setOutdoors(true);
      for (clock = 0; clock < 20; clock += .25) {
        if (clock === 10) audio.setOutdoors(false);
        audio.tick();
      }
    } else if (mode.startsWith('war-')) {
      audio.setOutdoors(true);
      if (mode === 'war-turned') audio.setListener(0, 1.6, 0, Math.PI);
      audio.distant('artillery', { azimuth: mode === 'war-right' ? -Math.PI / 2 : Math.PI / 2 });
    } else if (mode.startsWith('mix-')) {
      audio.setOutdoors(true);
      if (['mix-effects-muted', 'mix-master-muted', 'mix-combat'].includes(mode)) {
        audio.gunshot('garand', 0, 1.6, 0, { player: true }); audio.gunshot('mp40', 8, 1.6, 0);
        audio.footstep(-3, 0, 2, 'wood'); audio.impact(8, 1.6, 0, 'metal'); audio.explosion(6, 1, -8, .5);
        audio.reload('kar98k'); audio.daze(mode === 'mix-combat' ? 0 : 1);
      }
    } else if (mode === 'mute' || mode === 'pause-volume' || mode === 'pause-effects') {
      audio.daze(1);
      // Let the tinnitus become audible, then mute without another daze()
      // call. Cached concussion state must not leave its bypass bus audible.
      ctx.suspend(.4).then(() => {
        if (mode === 'pause-volume' || mode === 'pause-effects') {
          // Model a slider ramp started immediately before a pause. The
          // paused-menu mute must cancel that still-scheduled target.
          Object.defineProperty(ctx, 'state', { value: 'running', configurable: true });
          if (mode === 'pause-effects') audio.setMix({ effects: .3 });
          else audio.setVolume(.3);
          Object.defineProperty(ctx, 'state', { value: 'suspended', configurable: true });
        }
        if (mode === 'pause-effects') audio.setMix({ effects: 0 });
        else audio.setVolume(0);
        if (mode === 'pause-volume' || mode === 'pause-effects') delete ctx.state;
        ctx.resume();
      });
    } else if (mode.startsWith('world-reload-')) {
      audio.reload(mode.slice(13), { x: 0, y: .4, z: 3 });
    } else if (mode.startsWith('reload')) {
      audio.reload(mode === 'reload-cancel' ? 'kar98k' : mode.slice(7));
    } else if (mode === 'priority' || mode === 'world-priority') {
      for (let i = 0; i < 36; i++) audio.gunshot('kar98k', i * 2, 1.6, 343);
      audio.gunshot('garand', 0, 1.6, mode === 'priority' ? 0 : -12, { player: mode === 'priority' });
    } else if (mode === 'battle') {
      audio.setSpace(.9, 5);
      audio.gunshot('garand', 0, 0, 0, { player: true });
      for (let i = 0; i < 8; i++) audio.gunshot(i % 2 ? 'mp40' : 'kar98k', (i - 4) * 3, 1.6, 12 + i * 4);
      audio.explosion(6, 1, -8, 2);
      for (let i = 0; i < 6; i++) audio.footstep(i, 0, -i, 'stone', 1, i === 0);
    } else if (mode === 'distant') audio.gunshot('kar98k', 0, 1.6, 343);
    else if (mode === 'unblocked' || mode === 'blocked' || mode === 'head-front' || mode === 'head-rear') audio.gunshot('kar98k', 0, 1.6, mode === 'head-front' ? 16 : -16);
    else if (mode === 'voices') {
      for (let i = 0; i < 60; i++) audio.footstep(0, 0, 0, 'wood', 1, true);
      audio.gunshot('garand', 0, 0, 0, { player: true });
    } else audio.gunshot('garand', 0, 0, 0, { player: true });
    if (controlled && audio.actionStatus.pending) {
      let cancelled = false;
      for (clock = .01; clock < seconds; clock += .01) {
        if (mode === 'reload-cancel' && !cancelled && clock >= .4 - 1e-9) { audio.switchWeapon(); cancelled = true; }
        audio.advanceActions(.01);
      }
    }
    const status = audio.sampleStatus, voiceStatus = audio.voiceStatus;
    const buffer = await ctx.startRendering();
    const data = buffer.getChannelData(0);
    const channelRms = [0, 1].map(channel => { const samples=buffer.getChannelData(channel); let sum=0; for(const sample of samples)sum+=sample*sample; return Math.sqrt(sum/samples.length); });
    const energy = (from, to) => {
      let sum = 0, peak = 0, difference = 0;
      for (let i = Math.floor(from * 44100); i < Math.floor(to * 44100); i++) {
        sum += data[i] ** 2; peak = Math.max(peak, Math.abs(data[i]));
        if (i > 0) difference += (data[i] - data[i - 1]) ** 2;
      }
      return { rms: Math.sqrt(sum / ((to - from) * 44100)), peak, detail: Math.sqrt(difference / Math.max(1e-20, sum)) };
    };
    return { status, voiceStatus, preloaded, loadDetails: audio.sampleLoadDetails, acoustics: audio.acousticStatus, spatial: audio.spatialStatus, frogPaths, pannerLast: panners.at(-1)?.pan.value ?? 0, channelRms, early: energy(0, .85), attack: energy(0, .1), late: energy(1, 1.3), whole: energy(0, seconds), beforeMute: energy(.15, .35), afterMute: energy(.5, .8), afterCancel: energy(.8, 2.9), magSeat: energy(.76, 1.02), rifleClose: energy(1.8, 2.05), boltClose: energy(2.5, 2.95), beltClose: mode.startsWith('reload') ? energy(4.1, 5.05) : null, wildlife: mode === 'ambience' || mode === 'frogs' ? energy(4, 9) : null, afterAmbience: mode === 'ambience' || mode === 'frogs' ? energy(17, 19.5) : null, weather: mode.startsWith('shelter-') ? { before: energy(1, 2.5), covered: energy(4.5, 5.8), restored: energy(8, 9.5) } : null, actions: audio.actionStatus, nodes: audio.nodeStatus, after: audio.sampleStatus };
  }, mode);

  const close = await render('close');
  assert.deepEqual(close.status, { ready: 21, failed: 0, total: 21, active: 1 });
  assert.ok(close.attack.rms > .025, 'a decoded field recording has an immediate audible attack');
  assert.ok(close.whole.peak <= 1 && Number.isFinite(close.whole.rms), 'the mix has a finite, bounded output');
  assert.equal(close.after.active, 0, 'finished sample voices release their nodes');
  assert.equal(close.nodes.oneShotBuses, 0, 'finished gunshots release their panner/filter/send buses');

  const far = await render('distant');
  assert.ok(far.early.peak < 1e-8, 'a muzzle blast 343 m away does not arrive before one second');
  assert.ok(far.late.rms > .00005, 'the distant shot arrives and remains audible');
  assert.ok(far.whole.rms < close.whole.rms * .1, 'distant fire is substantially attenuated');
  const turnedShot = await render('turn-shot'), spatialBudget = await render('spatial-budget');
  assert.ok(turnedShot.channelRms[0] > turnedShot.channelRms[1] * 10, 'turning before a distant report arrives changes the heard world bearing');
  assert.equal(turnedShot.acoustics.probes, 1, 'turning a playing source performs no extra world traces');
  assert.equal(spatialBudget.spatial.peak, 32, 'listener-motion updates obey the 32-bus budget');
  assert.ok(spatialBudget.pannerLast < -.8, 'round-robin updates reach later voices while the listener keeps turning');
  assert.equal(spatialBudget.nodes.oneShotBuses, 0);
  const headFront = await render('head-front'), headRear = await render('head-rear');
  assert.ok(headFront.whole.rms > headRear.whole.rms * 1.08, 'camera-forward +Z sound is clearer than a rear sound at the same distance');
  assert.ok(headFront.attack.detail > headRear.attack.detail * 1.02, 'head shadow removes more high-frequency detail behind the camera');

  const unblocked = await render('unblocked'), blocked = await render('blocked');
  assert.equal(blocked.acoustics.probes, 1, 'one world probe resolves a shot at its source');
  assert.ok(blocked.whole.rms < unblocked.whole.rms * .65, 'a wall reduces transmitted energy');
  assert.ok(blocked.whole.rms > unblocked.whole.rms * .08, 'occluded gunfire remains an audible danger cue');
  assert.ok(blocked.attack.detail < unblocked.attack.detail * .55, 'real PCM loses high-frequency detail through a masonry wall');

  const garandReload = await render('reload-garand'), thompsonReload = await render('reload-thompson');
  const karReload = await render('reload-kar98k'), mpReload = await render('reload-mp40'), mgReload = await render('reload-mg42');
  const worldReload = await render('world-reload-kar98k');
  assert.ok(garandReload.rifleClose.rms > .003, 'the Garand locks its bolt late in its clip reload');
  assert.ok(thompsonReload.magSeat.rms > .003, 'the Thompson magazine seats on its simulation timeline');
  assert.ok(karReload.boltClose.rms > .003, 'a bolt rifle locks its bolt near the end of its 3.2 s reload');
  assert.ok(mpReload.magSeat.rms > .003, 'the MP40 magazine seats during its SMG reload');
  assert.ok(mgReload.beltClose.rms > .003, 'the MG42 belt/cover/charging sequence reaches its late actions');
  for (const reload of [garandReload, thompsonReload, karReload, mpReload, mgReload]) assert.equal(reload.actions.active + reload.actions.sources + reload.actions.pending, 0, 'finished weapon actions release their sources and descriptors');
  assert.ok(worldReload.boltClose.rms > .001, 'an enemy reload retains its positioned audio timeline without player simulation advancement');
  assert.equal(worldReload.nodes.oneShotBuses, 0);
  const cancelled = await render('reload-cancel');
  assert.ok(cancelled.beforeMute.rms > .001, 'the interrupted reload had begun');
  assert.ok(cancelled.afterCancel.peak < 1e-8, 'weapon switching cancels later scheduled reload parts');
  assert.equal(cancelled.actions.active, 0);
  const battle = await render('battle');
  assert.ok(battle.whole.peak < 1 && Number.isFinite(battle.whole.rms), `gunfire, a near explosion, footsteps and street echoes retain mix headroom (peak ${battle.whole.peak.toFixed(3)})`);
  assert.equal(battle.nodes.oneShotBuses, 0, 'all battle one-shot buses release after the last attached sources end');

  const voices = await render('voices');
  assert.equal(voices.status.active, 36, 'the optional sample layer has a bounded voice count');
  assert.equal(voices.after.active, 0, 'culled/finished voices are released');

  const priority = await render('priority'), worldPriority = await render('world-priority');
  assert.equal(priority.voiceStatus.player, 1, 'a player shot replaces a distant weapon tail when all 36 sample slots are occupied');
  assert.equal(priority.voiceStatus.stolen, 1);
  assert.ok(priority.attack.rms > .025, 'the player attack is audible before delayed distant recordings arrive');
  assert.equal(worldPriority.voiceStatus.stolen, 1, 'a nearby enemy attack also replaces a much quieter distant tail');
  assert.equal(priority.after.active + worldPriority.after.active, 0);

  const ambience = await render('ambience');
  assert.equal(ambience.early.peak, 0, 'a calm dry mission starts without an unrelated default wind/rain bed');
  assert.ok(ambience.wildlife.rms > .00001, 'calm daytime wildlife produces audible, spatial calls');
  assert.ok(ambience.afterAmbience.peak < 1e-8, 'wildlife fades with the ambience bus when leaving the mission');
  assert.equal(ambience.nodes.oneShotBuses, 0, 'scheduled wildlife releases its spatial buses');
  const frogs = await render('frogs');
  assert.ok(frogs.wildlife.rms > .00001, 'bank calls remain audible in the quiet canal profile');
  assert.ok(frogs.frogPaths.length >= 5);
  assert.ok(frogs.frogPaths.every(path => path.sourceY === .7), 'frog sources stay at the configured water-bank height');
  assert.deepEqual([...new Set(frogs.frogPaths.map(path => path.listenerY))], [3.7, 9.7], 'new calls do not follow the listener up a bridge or hill');
  assert.equal(frogs.afterAmbience.peak, 0); assert.equal(frogs.nodes.oneShotBuses, 0);

  const weatherOpen = await render('shelter-open'), weatherRoof = await render('shelter-roof'), weatherCanopy = await render('shelter-canopy'), weatherReopen = await render('shelter-reopen');
  assert.ok(weatherRoof.weather.covered.rms < weatherOpen.weather.covered.rms * .45, 'a roof in an enclosed passage reduces the outside weather bed');
  assert.ok(weatherRoof.weather.covered.detail < weatherOpen.weather.covered.detail * .7, 'roof transmission softens high rain/helmet detail');
  assert.ok(weatherCanopy.weather.covered.rms > weatherRoof.weather.covered.rms * 1.5, 'an open-sided canopy admits more weather than an enclosed passage');
  assert.ok(Math.abs(weatherReopen.weather.restored.rms / weatherOpen.weather.restored.rms - 1) < .05, 'stepping back outside restores the same evolving weather bed');
  const fireWeatherOpen = await render('fire-weather-open'), fireWeatherRoof = await render('fire-weather-roof');
  assert.ok(Math.abs(fireWeatherOpen.whole.rms - fireWeatherRoof.whole.rms) < 1e-10, 'weather shelter leaves a local fire on its independent world path');

  const warLeft = await render('war-left'), warRight = await render('war-right'), warTurned = await render('war-turned');
  assert.ok(warLeft.channelRms[0] > warLeft.channelRms[1] * 2, 'a left horizon report retains its broad bearing');
  assert.ok(warRight.channelRms[1] > warRight.channelRms[0] * 2, 'a right horizon report reverses its stereo energy');
  assert.ok(warTurned.channelRms[1] > warTurned.channelRms[0] * 2, 'turning the listener reverses a fixed world bearing');
  assert.ok(warLeft.channelRms[1] > .0001, 'artillery retains energy in both ears for a broad low-frequency image');

  const muted = await render('mute');
  assert.ok(muted.beforeMute.rms > .005, 'tinnitus is audible before the volume changes');
  assert.ok(muted.afterMute.peak < 1e-8, 'volume zero silences an already ringing concussion bus without another daze update');
  const pausedVolume = await render('pause-volume');
  assert.ok(pausedVolume.afterMute.peak < 1e-8, 'a paused-menu mute cancels an older volume ramp before audio resumes');
  const pausedEffects = await render('pause-effects');
  assert.equal(pausedEffects.afterMute.peak, 0, 'paused effects mute cancels its old gain ramp and silences tinnitus');
  const mixCombat = await render('mix-combat'), mixEffectsMuted = await render('mix-effects-muted'), mixMasterMuted = await render('mix-master-muted');
  const mixAmbience = await render('mix-ambience-only'), mixAmbienceMuted = await render('mix-ambience-muted');
  assert.ok(mixCombat.whole.rms > .001 && mixAmbience.whole.rms > .001);
  for (const result of [mixEffectsMuted, mixMasterMuted, mixAmbienceMuted]) assert.equal(result.whole.peak, 0, 'master/effects/ambience controls silence their complete buses, echoes and ringing included');
  assert.deepEqual(mixCombat.preloaded, { loaded: 21, failed: 0, total: 21 }, 'the legacy preload API truthfully reports the active runtime manifest');

  transientAudio = true;
  const retried = await render('retry');
  assert.equal(retried.loadDetails.retries, 1, 'one transient local asset response is retried in the background');
  assert.equal(retried.status.ready, 21);
  assert.equal(retried.status.failed, 0);

  missingAudio = true;
  const fallback = await render('fallback');
  assert.deepEqual(fallback.status, { ready: 0, failed: 21, total: 21, active: 0 });
  assert.equal(fallback.loadDetails.failures.length, 21);
  assert.ok(fallback.attack.rms > .025, 'gunfire remains audible when every sample request fails');
  const reportFlag = process.argv.indexOf('--report');
  if (reportFlag >= 0) await writeFile(process.argv[reportFlag + 1], JSON.stringify({
    assets: { count: manifest.assets.length, bytes, license: manifest.license, retained: retained.length },
    close: close.whole, distant: { early: far.early, arrival: far.late, whole: far.whole },
    cover: { clear: unblocked.whole, masonry: blocked.whole, clearAttack: unblocked.attack, masonryAttack: blocked.attack },
    weaponPriority: { player: priority.voiceStatus, nearbyEnemy: worldPriority.voiceStatus },
    reloads: { garandBolt: garandReload.rifleClose, thompsonMagazine: thompsonReload.magSeat, kar98kBolt: karReload.boltClose, mp40Magazine: mpReload.magSeat, mg42Cover: mgReload.beltClose, enemyKar98k: worldReload.boltClose, cancelled: cancelled.afterCancel },
    ambience: { dryStart: ambience.early, wildlife: ambience.wildlife, afterExit: ambience.afterAmbience, bankCalls: frogs.wildlife, bankPaths: frogs.frogPaths },
    shelter: { open: weatherOpen.weather, enclosed: weatherRoof.weather, canopy: weatherCanopy.weather, reopened: weatherReopen.weather, fireOpen: fireWeatherOpen.whole, fireCovered: fireWeatherRoof.whole },
    horizon: { left: warLeft.channelRms, right: warRight.channelRms, turned: warTurned.channelRms },
    listenerMotion: { arrivalChannels: turnedShot.channelRms, probes: turnedShot.acoustics.probes, workBudget: spatialBudget.spatial, lastPanner: spatialBudget.pannerLast },
    headShadow: { front: headFront.whole, rear: headRear.whole, frontAttack: headFront.attack, rearAttack: headRear.attack },
    mix: { battle: battle.whole, remainingBuses: battle.nodes.oneShotBuses, muted: muted.afterMute, pausedMute: pausedVolume.afterMute, pausedEffects: pausedEffects.afterMute,
      controls: { combat: mixCombat.whole, effectsMuted: mixEffectsMuted.whole, masterMuted: mixMasterMuted.whole, ambience: mixAmbience.whole, ambienceMuted: mixAmbienceMuted.whole } },
    loading: { recovered: retried.status, retries: retried.loadDetails.retries, missingFiles: fallback.status, fallbackAttack: fallback.attack },
  }, null, 2));
  console.log(`audio-check: ${manifest.assets.length} CC0 files (${bytes} bytes); real PCM delay/cover/bearing, weapon priority/reloads/cancellation, ambience/mute/pause, mix headroom/cleanup and asset retry/fallback pass`);
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
