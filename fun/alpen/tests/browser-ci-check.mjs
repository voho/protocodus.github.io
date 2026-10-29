// Run from fun/alpen with ALPEN_PLAYWRIGHT, ALPEN_URL and optional ALPEN_SOFTWARE_GPU=1.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.ALPEN_PLAYWRIGHT || 'playwright');
const url = new URL(process.env.ALPEN_URL || 'http://127.0.0.1:8773/fun/alpen/');
url.searchParams.set('seed', '1EE9566');
const software = process.env.ALPEN_SOFTWARE_GPU === '1';
if (software && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
  throw new Error('Software WebGL QA requires a loopback ALPEN_URL.');
}
const output = process.env.ALPEN_QA_OUTPUT || '/tmp/alpen-qa';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.ALPEN_BROWSER || 'chrome', headless: true,
  args: software ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [],
});
const results = [], errors = [];
const frames = (page, count) => page.evaluate(count => new Promise(resolve => {
  let left = count;
  const tick = () => { if (--left <= 0) resolve(); else requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}), count);
async function fixedWeather(page) {
  await page.route('**/fun/alpen/js/weather.js', async route => {
    const response = await route.fetch();
    let body = await response.text();
    const patch = (from, to) => {
      assert.equal(body.split(from).length, 2, 'weather fixture anchor: ' + from);
      body = body.replace(from, to);
    };
    patch('  let dayClock = 0;', '  let testStorm;\n  let dayClock = 0;');
    patch('  function update(dt) {', '  function update(dt) {\n    if (testStorm !== undefined) dt = 0;');
    patch('    const s = state.storm;', '    state.storm = testStorm ?? state.storm;\n    const s = state.storm;');
    patch('    return state;', '    if (testStorm !== undefined) state.flash = 0;\n    return state;');
    patch('return { state, update, pin, release, triggerStorm };',
      'return { state, update, pin, release, triggerStorm, check(tod, storm) { testStorm = storm; frozen = tod; pinnedTod = tod; fogSettled = false; return update(0); } };');
    await route.fulfill({ response, body });
  });
}
async function capture(page, label, z, tod, storm, hit = null) {
  try {
    await page.evaluate(async ({ z, tod, storm, hit }) => {
      const a = __alpen;
      const { guideAt, heightAt } = await import('./js/terrain.js');
      a.game.mode = 'paused';
      a.rider.step = () => {}; // Capture only: actual production visual updates keep running.
      const x = hit?.x ?? guideAt(z);
      a.rider.reset(z, x); a.chase.reset(); a.trail.clear(); a.spray.clear();
      a.wildlife.reset(); a.huts.reset(); a.mountainLife.reset(z);
      a.model.reset(); a.shading.reset(); a.props.reset(z, 1);
      const w = a.weather.check(tod, storm);
      a.sky.update(a.rider.pos, w, 0);
      a.terrain.setSun(a.sky.sunDir.x, a.sky.sunDir.y, a.sky.sunDir.z, a.sky.shadowLevel);
      a.terrain.reset(x, z); a.terrain.snapSnowReady(); a.sky.snapBackdrop();
      a.retro.fade(1); a.flicker.freezeResolution = true; a.game.mode = 'attract';
      if (hit) {
        window.__alpenQAChase = a.chase.update;
        const y = heightAt(hit.x, hit.z);
        a.chase.update = () => {
          a.camera.position.set(hit.x - hit.side * (1.6 * hit.halfWidth + 5),
            y + Math.max(7, hit.face * .5), hit.z + Math.max(10, hit.face * .8));
          a.camera.up.set(0, 1, 0);
          a.camera.lookAt(hit.x, y - .3, hit.z - hit.lee * .25);
          a.camera.updateMatrixWorld();
        };
      }
    }, { z, tod, storm, hit });
    // Settle the production visual update order without repeatedly rasterizing
    // an unchanged scene on a software GPU. One real frame below repairs every
    // cached GPU layer, including the rider's private depth shadow.
    await page.evaluate(() => {
      window.__alpenQARender = __alpen.renderer.render;
      __alpen.renderer.render = () => {};
    });
    try {
      await frames(page, 45);
    } finally {
      await page.evaluate(() => {
        __alpen.renderer.render = window.__alpenQARender;
        delete window.__alpenQARender;
        __alpen.sky.refreshProbe();
        __alpen.flicker.shadowEveryFrame = true;
        __alpen.renderer.shadowMap.needsUpdate = true;
      });
    }
    await frames(page, 1);
    await page.evaluate(() => { __alpen.game.mode = 'paused'; });
    await frames(page, 2);
    const visual = await page.evaluate(async () => {
      const a = __alpen;
      const { chapterNameAt } = await import('./js/terrain.js');
      const finite = [...a.rider.pos.toArray(), ...a.rider.normal.toArray(),
        ...a.camera.position.toArray(), ...a.camera.quaternion.toArray(), a.camera.fov,
        ...a.sky.sunDir.toArray(), a.weather.state.tod, a.weather.state.storm].every(Number.isFinite);
      a.sky.refreshProbe(); a.sky.renderProbe(a.renderer);
      a.retro.render(a.scene, a.camera, true);
      const small = document.createElement('canvas');
      const factor = Math.min(512 / innerWidth, 320 / innerHeight);
      small.width = Math.round(innerWidth * factor); small.height = Math.round(innerHeight * factor);
      const context = small.getContext('2d');
      context.drawImage(a.renderer.domElement, 0, 0, small.width, small.height);
      const pixels = context.getImageData(0, 0, small.width, small.height).data;
      let low = 255, high = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const luma = pixels[i] * .2126 + pixels[i + 1] * .7152 + pixels[i + 2] * .0722;
        low = Math.min(low, luma); high = Math.max(high, luma);
      }
      const debug = a.debug();
      delete debug.performance; // Capture-only settling is not a timing benchmark.
      return { finite, contrast: high - low, glError: a.renderer.getContext().getError(),
        chapter: chapterNameAt(a.rider.pos.z), weather: a.weather.state.conditions,
        phase: a.weather.state.phase, debug,
        data_url: small.toDataURL('image/jpeg', .6) };
    });
    assert(visual.finite, label + ': scene values remain finite');
    assert.equal(visual.glError, 0, label + ': no WebGL error');
    assert(visual.contrast > 15, label + ': rendered image has real scene contrast');
    await page.locator('#stage').screenshot({ path: output + '/' + label + '.png' });
    if (process.env.ALPEN_QA_THUMBNAILS === '1') console.log('ALPEN_VISUAL ' + JSON.stringify({ label, chapter: visual.chapter, phase: visual.phase, data_url: visual.data_url }));
    delete visual.data_url;
    results.push({ label, ...(hit ? { sideHit: hit } : {}), ...visual });
  } finally {
    if (hit) await page.evaluate(() => {
      if (window.__alpenQAChase) __alpen.chase.update = window.__alpenQAChase;
      delete window.__alpenQAChase;
    }).catch(() => {});
  }
}
try {
  const profiles = [
    { name: 'desktop', viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 },
    { name: 'portrait', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    { name: 'landscape', viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  ].filter(profile => !process.env.ALPEN_QA_PROFILE || profile.name === process.env.ALPEN_QA_PROFILE);
  assert(profiles.length, 'valid ALPEN_QA_PROFILE');
  for (const profile of profiles) {
    const { name, ...options } = profile;
    const page = await browser.newPage(options);
    page.setDefaultTimeout(180000);
    let engineRequests = 0;
    page.on('request', request => { if (new URL(request.url()).pathname === '/assets/vendor/three/three.module.min.js') engineRequests++; });
    page.on('pageerror', error => { errors.push(error.message); console.error(profile.name + ': ' + error.message); });
    page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); console.error(profile.name + ': ' + message.text()); } });
    try {
      await fixedWeather(page);
      const started = Date.now();
      await page.goto(url.href);
      await page.waitForFunction(() => window.__alpen && document.body.classList.contains('ready'));
      await page.evaluate(async () => { await Promise.all([__alpen.terrain.surfacesReady, __alpen.sky.backdropReady]); });
      const bootMs = Date.now() - started;
      assert.equal(await page.locator('link[rel="modulepreload"][href="/assets/vendor/three/three.module.min.js"]').count(), 1, 'the engine preload hint is present');
      assert.equal(engineRequests, 1, 'the engine preload is reused by the module graph');
      console.log('Alpen boot ready: ' + profile.name + ' in ' + bootMs + ' ms');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), profile.name + ': no horizontal overflow');
      await page.locator('.drop-in').click();
      await page.waitForFunction(() => __alpen.game.mode === 'playing');
      await page.keyboard.down('KeyD');
      await page.waitForFunction(() => __alpen.input.state.turnIntent > 0);
      await page.keyboard.up('KeyD');
      await page.waitForFunction(() => __alpen.input.state.turnIntent === 0);
      await page.keyboard.down('Space');
      await page.waitForFunction(() => __alpen.rider.charging && __alpen.input.state.jump);
      if (profile.hasTouch) {
        const session = await page.context().newCDPSession(page);
        const button = await page.locator('[data-key=jump]').boundingBox();
        assert(button && button.width >= 44 && button.height >= 44, 'usable Jump target');
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: button.x + button.width / 2, y: button.y + button.height / 2, id: 7 }] });
        await page.keyboard.up('Space'); await frames(page, 3);
        assert(await page.evaluate(() => __alpen.input.state.jump), 'touch preserves a keyboard charge');
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForFunction(() => !__alpen.input.state.jump);
        await session.detach();
      } else {
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));
        assert.equal(await page.evaluate(() => __alpen.rider.charging), false, 'blur cancels stored charge');
        await page.keyboard.up('Space');
        await page.locator('.drop-in').click();
      }
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => __alpen.game.mode === 'paused');
      if (profile.name === 'desktop') {
        const pausedFrames = await page.evaluate(async () => {
          const a = __alpen, original = a.renderer.render;
          let submissions = 0, worlds = 0;
          a.renderer.render = function(scene, camera) {
            submissions++; if (scene === a.scene) worlds++;
            return original.call(this, scene, camera);
          };
          a.retro.crash(.6);
          const samples = [];
          try {
            for (let frame = 0; frame < 5; frame++) {
              submissions = 0; worlds = 0;
              await new Promise(resolve => requestAnimationFrame(resolve));
              samples.push({ submissions, worlds });
            }
          } finally {
            a.renderer.render = original;
            a.retro.updateEffects(5, false);
            a.retro.updateEffects(5, false);
          }
          return samples;
        });
        assert(pausedFrames.slice(1).every(frame => frame.submissions === 1 && frame.worlds === 0),
          'continued paused fades draw only the final composite');
        results.push({ pausedFrames });
        console.log('Alpen paused frame submissions: ' + JSON.stringify(pausedFrames));
      }
      await page.locator('.drop-in').click();
      await page.waitForFunction(() => __alpen.game.mode === 'playing');
      if (profile.name === 'desktop') {
        const rewards = await page.evaluate(async () => {
          const a = __alpen;
          const { RIDER } = await import('./js/config.js');
          const { CLEAN } = await import('./js/rider.js');
          const { scoreTrick } = await import('./js/flow.js');
          a.game.discoveredGrabs.clear(); a.game.recentTricks.length = 0;
          const s = { judged: true, verdict: CLEAN, halfTurns: 1, flipTurns: 0,
            spin: 3, flips: 0, grabKind: 0, grabTime: RIDER.grabHold[0] + .2,
            airTime: 1, switchStance: false, takeoffSpeed: 18, lipPop: false, impact: 0 };
          const base = scoreTrick(s).points, payouts = [];
          for (let index = 0; index < 2; index++) {
            const before = a.game.score, combo = a.game.combo;
            a.rider.emit('land', s);
            payouts.push((a.game.score - before) / combo);
          }
          return { base, payouts, discovered: [...a.game.discoveredGrabs] };
        });
        assert(Math.abs(rewards.payouts[0] - rewards.base * 1.12) < 1e-7, 'first grab premium reaches real landing score');
        assert(Math.abs(rewards.payouts[1] - rewards.base) < 1e-7, 'repeated grab has no discovery premium');
        await page.keyboard.press('KeyR');
        assert.equal(await page.evaluate(() => __alpen.game.discoveredGrabs.size), 0, 'real restart clears grab discoveries');
      }
      results.push({ profile: profile.name, bootMs, engineRequests, gameplay: 'passed' });
      console.log('Alpen gameplay passed: ' + profile.name);
      await page.addStyleTag({ content: '.hud,.curtain,.pad{visibility:hidden!important}' });
      const locations = await page.evaluate(async () => {
        const { chapterNameAt } = await import('./js/terrain.js');
        const found = [], names = new Set();
        for (let block = 0; block < 15 && found.length < 3; block++) {
          const z = -(block * 1700 + 600), name = chapterNameAt(z);
          if (!names.has(name)) { names.add(name); found.push({ z, name }); }
        }
        return found;
      });
      assert.equal(locations.length, 3, 'the fixed seed exposes three distinct terrain chapters');
      await capture(page, profile.name + '-clear', locations[0].z, .48, 0);
      if (profile.name === 'desktop') {
        for (let index = 1; index < locations.length; index++) await capture(page, 'chapter-' + index, locations[index].z, .48, 0);
        const bulges = await page.evaluate(async () => {
          const { sideHitsIn } = await import('./js/terrain.js');
          const hits = sideHitsIn(-8000, -100);
          return ['roller', 'drift', 'windlip'].map(shape => hits.find(hit => hit.shape === shape)).filter(Boolean);
        });
        assert.equal(bulges.length, 3, 'the preview seed exposes three distinct bulge shapes');
        for (const hit of bulges) await capture(page, 'bulge-' + hit.shape,
          hit.z + hit.face + 3, .48, 0, hit);
        await capture(page, 'dusk', locations[0].z, .79, 0);
        await capture(page, 'blizzard', locations[0].z, .48, 1);
        const checks = await page.evaluate(async () => ({
          depth: await (await import('./tests/post-depth-browser-check.mjs')).runPostDepthCheck(),
          hdr: await (await import('./tests/post-hdr-browser-check.mjs')).runPostHdrCheck(),
          paused: await (await import('./tests/paused-composite-browser-check.mjs')).runPausedCompositeCheck(),
        }));
        results.push({ gpuChecks: checks });
        console.log('Alpen GPU checks: ' + JSON.stringify(checks));
      }
      assert.deepEqual(errors, [], 'no runtime, shader or resource errors');
      console.log('Alpen profile passed: ' + profile.name);
    } catch (error) {
      await page.screenshot({ path: output + '/' + profile.name + '-failure.png', timeout: 10000 }).catch(() => {});
      throw error;
    } finally { await page.close(); }
  }
  await writeFile(output + '/results.json', JSON.stringify(results, null, 2));
  console.log('Alpen browser QA passed: ' + profiles.map(profile => profile.name).join(', ') + '; boot, controls and rendered scenes' + (profiles.some(profile => profile.name === 'desktop') ? ', grab rewards, chapters, weather and GPU postprocessing.' : '.'));
} finally { await browser.close(); }
