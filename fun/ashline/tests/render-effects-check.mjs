// Optional browser QA for render-only effects. Uses ASHLINE_PLAYWRIGHT, ASHLINE_URL, ASHLINE_BROWSER and ASHLINE_SCREENSHOTS.
// Covers tick interpolation (fog-safe, frozen while paused, snapping, no step back on resume), projectiles that
// finish their flight on the drawn clock, shell kills shown on landing, screen shake gating, explosions, wrecks
// (including unfinished structures), structure collapses, hit flashes, burning vehicles, ash-fall, lava embers,
// mission zones and site labels on the battlefield and tactical map, ability visuals, the ability preview and
// live-loop hooks.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.ASHLINE_BROWSER || 'chrome', headless: true });
const output = process.env.ASHLINE_SCREENSHOTS || '/tmp/ashline-qa';
const url = process.env.ASHLINE_URL || 'http://127.0.0.1:8000/fun/ashline/';
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.ashline?.booted); await page.evaluate(async () => (await import('./assets.js')).startAssets());
  const checks = await page.evaluate(async () => {
    const { UNITS, BUILDINGS, createGame, raceUnit } = await import('./sim.js');
    const { Renderer } = await import('./render.js');
    const { MISSIONS } = await import('./campaign.js');
    const { drawSprite } = await import('./assets.js');
    const world = document.createElement('canvas');
    world.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:480px;z-index:99999';
    document.body.append(world);
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    let renderer = new Renderer(world, null);
    const s = createGame('render-effects'); s.ai.nextThink = 1e12;
    s.terrain.fill(0); s.minerals.fill(0); s.entities = []; s.effects = []; s.time = 10;
    s.visible.forEach(grid => grid.fill(1)); s.explored.forEach(grid => grid.fill(1));
    const view = { x: 30, y: 30, zoom: 38, selected: new Set() };
    let nextId = 100;
    const unit = (type, team = 0, x = 30, y = 30, extra = {}) => {
      const d = UNITS[type];
      return { id: nextId++, type, team, kind: 'unit', x, y, size: d.size, hp: d.hp, maxHp: d.hp, angle: 0, cooldown: 0, order: { type: 'idle' }, path: [], ...extra };
    };
    const pixels = () => renderer.ctx.getImageData(0, 0, world.width, world.height).data;
    const render = () => { renderer.draw(s, view); return pixels(); };
    const difference = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++; return n; };
    const region = (data, cx, cy, r) => {
      // Pixels in a screen square around a world point.
      const p = renderer.worldToScreen(cx, cy, view), dpr = renderer.dpr, out = [];
      for (let y = Math.max(0, Math.round((p.y - r) * dpr)); y < Math.min(world.height, Math.round((p.y + r) * dpr)); y++) {
        for (let x = Math.max(0, Math.round((p.x - r) * dpr)); x < Math.min(world.width, Math.round((p.x + r) * dpr)); x++) out.push(...data.slice((y * world.width + x) * 4, (y * world.width + x) * 4 + 3));
      }
      return out;
    };
    const tick = (mutate, pending) => { renderer.snapshot(s); s.time += .05; mutate(); renderer.pendingTime = pending; };
    const result = {};

    // Interpolation: friendly units blend between ticks with a shortest-arc heading.
    const friend = unit('tank', 0, 30, 30, { angle: 3.1 });
    const enemy = unit('tank', 1, 33, 30), hiddenStart = unit('tank', 1, 26, 32), jumper = unit('scout', 0, 30, 34);
    s.entities = [friend, enemy, hiddenStart, jumper];
    for (let x = 24; x < 28; x++) for (let y = 30; y < 34; y++) s.visible[0][y * s.width + x] = 0;
    render();
    tick(() => { friend.x += .4; friend.angle = -3.1; enemy.x += .4; hiddenStart.x += 2; jumper.x += 3; s.visible[0].fill(1); }, .025);
    const frameA = render(), poseFriend = renderer.poseOf(friend), poseEnemy = renderer.poseOf(enemy);
    result.friendBlend = poseFriend.x; result.friendAngle = Math.abs(Math.cos(poseFriend.angle));
    result.enemyBlend = poseEnemy.x; result.hiddenSnap = renderer.poseOf(hiddenStart) === hiddenStart; result.jumpSnap = renderer.poseOf(jumper) === jumper;
    result.frozen = difference(frameA, render());
    // A scheduler remainder that restarts mid-tick (resume, load) never draws an earlier moment.
    renderer.pendingTime = 0; render(); result.resumeHold = renderer.poseOf(friend).x;
    friend.x = 35; result.fixtureSnap = renderer.poseOf(friend) === friend; friend.x = 30.4;
    renderer.pendingTime = .05; render(); result.settled = renderer.poseOf(friend).x;
    // An enemy that leaves vision on the new tick is not blended either.
    s.visible[0][30 * s.width + 33] = 0; render(); result.enemyHiddenNow = renderer.poseOf(enemy) === enemy; s.visible[0].fill(1);
    // A fresh renderer (fixtures, loads) draws exact simulation positions.
    renderer = new Renderer(world, null); render(); result.freshExact = renderer.poseOf(friend) === friend;

    // Shake: only visible explosions near the camera, off for the view setting, capped.
    s.entities = []; s.effects = []; render();
    s.effects.push({ type: 'explosion', x: 31, y: 30, life: .55, maxLife: .6, team: 1, size: 3 });
    render(); s.time += .1; render(); result.shake = Math.hypot(renderer.shakeX, renderer.shakeY); result.particles = renderer.particles.length;
    view.screenShake = false; render(); result.shakeOff = Math.hypot(renderer.shakeX, renderer.shakeY); delete view.screenShake;
    for (let i = 0; i < 40; i++) s.effects.push({ type: 'explosion', x: 30 + i % 5 * .1, y: 30, life: .6, maxLife: .6, team: 1, size: 3 });
    s.time += .02; render(); s.time += .05; render(); result.shakeCap = Math.max(Math.abs(renderer.shakeX), Math.abs(renderer.shakeY));
    s.effects = []; s.time += 2; renderer.particles.length = 0; renderer.shakes.length = 0;
    // A hidden explosion leaves no particles, shake or decal.
    const decalsBefore = renderer.decals.getContext('2d').getImageData(0, 0, renderer.decals.width, renderer.decals.height).data;
    for (let x = 34; x < 38; x++) for (let y = 34; y < 38; y++) s.visible[0][y * s.width + x] = 0;
    s.effects = [{ type: 'explosion', x: 35.5, y: 35.5, life: .55, maxLife: .6, team: 1, size: 3 }];
    render(); s.time += .1; render();
    const decalsAfter = renderer.decals.getContext('2d').getImageData(0, 0, renderer.decals.width, renderer.decals.height).data;
    result.hiddenBlast = { particles: renderer.particles.length, shakes: renderer.shakes.length, decals: difference(decalsBefore, decalsAfter) };
    s.visible[0].fill(1); s.effects = [];

    // Wrecks: a vehicle seen dying leaves a husk on the decal layer; an unseen one leaves nothing.
    const doomed = unit('tank', 1, 28, 28), unseen = unit('tank', 1, 35.5, 35.5), squad = unit('rifle', 1, 24, 28);
    s.entities = [doomed, unseen, squad]; for (let x = 34; x < 38; x++) for (let y = 34; y < 38; y++) s.visible[0][y * s.width + x] = 0;
    s.time += .05; render();
    const decals0 = renderer.decals.getContext('2d').getImageData(0, 0, renderer.decals.width, renderer.decals.height).data;
    doomed.hp = 0; unseen.hp = 0; squad.hp = 0; s.entities = []; s.time += .05;
    s.effects = [{ type: 'explosion', x: 28, y: 28, life: .55, maxLife: .6, team: 1, size: 1 }, { type: 'explosion', x: 35.5, y: 35.5, life: .55, maxLife: .6, team: 1, size: 1 },
      { type: 'explosion', x: 24, y: 28, life: .55, maxLife: .6, team: 1, size: 1 }];
    render();
    const decals1 = renderer.decals.getContext('2d').getImageData(0, 0, renderer.decals.width, renderer.decals.height).data;
    const decalRegion = (data, x, y) => { const k = renderer.terrainScale * 32, w = renderer.decals.width; let n = 0; for (let yy = Math.floor((y - .8) * k); yy < (y + .8) * k; yy++) for (let xx = Math.floor((x - .8) * k); xx < (x + .8) * k; xx++) n += data[(yy * w + xx) * 4 + 3]; return n; };
    result.wreck = { seen: decalRegion(decals1, 28, 28) - decalRegion(decals0, 28, 28), unseen: decalRegion(decals1, 35.5, 35.5) - decalRegion(decals0, 35.5, 35.5),
      infantry: decalRegion(decals1, 24, 28) - decalRegion(decals0, 24, 28) };
    s.effects = []; s.visible[0].fill(1); s.time += 3; render(); renderer.particles.length = 0; renderer.shakes.length = 0;

    // Hit flash: a separate overlay; the baked frame drawn by assets.js keeps its exact pixels.
    const bakedSample = () => { const c = document.createElement('canvas'); c.width = c.height = 96; const g = c.getContext('2d'); g.translate(48, 48); drawSprite(g, unit('tank'), 0); return g.getImageData(0, 0, 96, 96).data; };
    const baked = bakedSample();
    const target = unit('tank', 0, 30, 30); s.entities = [target];
    const calm = render(); target.lastHit = s.time; const flashed = render();
    result.hitFlash = difference(calm, flashed); result.bakedUnchanged = difference(baked, bakedSample()) === 0;
    delete target.lastHit;
    // Burning below 25%: warm flame pixels appear around the hull; a hidden burning enemy draws nothing.
    target.hp = target.maxHp * .28; const smoking = render(); target.hp = target.maxHp * .22; const burning = render();
    let warm = 0; { const a = region(smoking, 30, 30, 26), b = region(burning, 30, 30, 26); for (let i = 0; i < a.length; i += 3) if (b[i] > a[i] + 25 && b[i] > b[i + 2] + 60) warm++; }
    result.burning = warm;
    const hiddenBurning = unit('tank', 1, 35.5, 35.5, { hp: 50 }); s.entities = [hiddenBurning];
    for (let x = 34; x < 38; x++) for (let y = 34; y < 38; y++) s.visible[0][y * s.width + x] = 0;
    const noEnemy = (s.entities = [], render()); s.entities = [hiddenBurning]; const withHidden = render();
    result.hiddenBurning = difference(noEnemy, withHidden);
    s.visible[0].fill(1); s.entities = [];

    // Ash-fall moves over visible ground only, and holds still on the same clock.
    const ashA = render(), ashSame = render(); s.time += 1.3; const ashB = render();
    s.visible[0].fill(0); const fogA = render(); s.time += 1.3; const fogB = render(); s.visible[0].fill(1);
    result.ash = { moving: difference(ashA, ashB), frozen: difference(ashA, ashSame), underFog: difference(fogA, fogB) };

    // Mission zones: a zone shows through fog once a revealed objective uses it, its definition marks it lit or deploys there;
    // a zone only a hidden objective uses, or a bare spawn anchor, appears only once its centre is explored.
    const zoneDiff = mission => { s.mission = mission; const a = render(); delete s.mission; return difference(a, render()); };
    // In the drill, objective 'muster' uses zone 'muster'; the hidden picket's 'range' zone is used by no objective.
    const drill = (zone, revealed = true, state = 'active') => ({ id: 'drill', fired: {}, counters: {}, nextCheck: 0, startedAt: 0,
      objectives: [{ id: 'muster', state, progress: 0, revealed }, { id: 'range', state: 'active', progress: 0, revealed: false }],
      zones: [{ id: zone, x: 30, y: 30, r: 3, label: 'Zone ' + zone }] });
    s.visible[0].fill(0); s.explored[0].fill(0);
    MISSIONS['render-lit'] = { id: 'render-lit', objectives: [], zones: [{ id: 'relay', label: 'Central relay', at: 'center', r: 3, lit: true }] };
    // A deploy zone is the only ground the player's nexus may use, so it shows without an objective.
    MISSIONS['render-deploy'] = { id: 'render-deploy', objectives: [], deployZone: 'gap', zones: [{ id: 'gap', label: 'Claim site', at: 'center', r: 3 }] };
    result.zones = { revealed: zoneDiff(drill('muster')), done: zoneDiff(drill('muster', true, 'done')), hiddenObjective: zoneDiff(drill('muster', false)),
      unreferenced: zoneDiff(drill('range')), lit: zoneDiff({ ...drill('relay'), id: 'render-lit', objectives: [] }), deploy: zoneDiff({ ...drill('gap'), id: 'render-deploy', objectives: [] }) };
    for (let y = 28; y < 33; y++) for (let x = 28; x < 33; x++) s.explored[0][y * s.width + x] = 1;
    result.zones.explored = zoneDiff(drill('range'));
    s.explored[0].fill(0);
    // A lit zone keeps its own reveal alive for both sides (mission.js lightZones). It is no flare: the operation's
    // frame matches one without it, so the zone's ring is its only mark.
    const relay = createGame('render-relay', 'normal', { width: 144, height: 112, mission: 'relay-control' }), relayRenderer = new Renderer(world, null);
    const relayView = { x: relay.mission.zones[0].x, y: relay.mission.zones[0].y, zoom: 38, selected: new Set() };
    const relayFrame = () => { relayRenderer.draw(relay, relayView); return relayRenderer.ctx.getImageData(0, 0, world.width, world.height).data; };
    const zoneReveals = (relay.reveals || []).filter(reveal => reveal.team === 0 && reveal.source === 'zone').length;
    relayFrame(); const relayLit = relayFrame(); relay.reveals = relay.reveals.filter(reveal => !reveal.source);
    result.zones.litReveal = { reveals: zoneReveals, drawn: difference(relayLit, relayFrame()) };
    s.sites = [{ id: 'ridge', kind: 'outpost', x: 31, y: 31, r: 2, name: 'Cinder Ridge' }];
    const unexploredSite = render(); delete s.sites; const noSite = render();
    s.sites = [{ id: 'ridge', kind: 'outpost', x: 31, y: 31, r: 2, name: 'Cinder Ridge' }]; s.explored[0].fill(1);
    const exploredSite = render(); delete s.sites; const exploredNoSite = render();
    result.sites = { unexplored: difference(unexploredSite, noSite), explored: difference(exploredSite, exploredNoSite) };
    s.visible[0].fill(1);

    // Ability visuals: own flare ring (an enemy flare draws nothing), dig in, overdrive, barrage marker, long shot ring.
    s.entities = []; const base = render();
    s.reveals = [{ team: 1, x: 30, y: 30, r: 7, until: s.time + 6 }]; const enemyFlare = render();
    s.reveals = [{ team: 0, x: 30, y: 30, r: 7, until: s.time + 6 }]; const ownFlare = render(); delete s.reveals;
    result.flare = { enemy: difference(base, enemyFlare), own: difference(base, ownFlare) };
    const rifle = unit('rifle', 0, 30, 30); s.entities = [rifle]; const idleRifle = render();
    rifle.abilityUntil = s.time + 5; const dug = render(); delete rifle.abilityUntil;
    const tank = unit('tank', 0, 30, 30, { moving: true }); s.entities = [tank]; const cruising = render();
    tank.abilityUntil = s.time + 3; const overdrive = render(); delete tank.abilityUntil;
    const gun = unit('artillery', 0, 28, 28); s.entities = [gun]; const gunIdle = render();
    gun.barrage = { x: 33, y: 31, shots: 3, next: s.time + .5 }; const barrage = render();
    const salvo = gun.barrage; delete gun.barrage; gun.team = 1; const enemyGun = render(); gun.barrage = salvo; const enemyBarrage = render(); gun.team = 0; delete gun.barrage;
    const rocket = unit('rocket', 0, 30, 30); s.entities = [rocket]; view.selected = new Set([rocket.id]); const ranged = render();
    rocket.abilityUntil = s.time + 4; const longShot = render(); delete rocket.abilityUntil; view.selected = new Set();
    result.abilities = { dig: difference(idleRifle, dug), overdrive: difference(cruising, overdrive), barrage: difference(gunIdle, barrage), enemyBarrage: difference(enemyGun, enemyBarrage), longShot: difference(ranged, longShot) };
    // Field patch and promotion events add one flourish each for seen positions only.
    s.entities = []; renderer.particles.length = 0; render();
    s.events.push({ text: 'Field engineer: Field patch', team: 0, time: s.time, kind: 'ability', ability: 'fieldPatch', x: 30, y: 30 });
    s.events.push({ text: 'Vanguard tank promoted to rank 1', team: 1, time: s.time, kind: 'promotion', rank: 1, x: 35.5, y: 35.5 });
    for (let x = 34; x < 38; x++) for (let y = 34; y < 38; y++) s.visible[0][y * s.width + x] = 0;
    render(); result.events = renderer.particles.map(p => p.kind); s.visible[0].fill(1);
    // The particle pool stays bounded however many blasts are seen.
    for (let i = 0; i < 400; i++) s.effects.push({ type: 'explosion', x: 10 + i % 40, y: 10 + Math.floor(i / 40), life: .55, maxLife: .6, team: 1, size: 3 });
    render(); result.particleBound = renderer.particles.length;
    s.effects = [];
    s.effects = []; s.entities = []; renderer.particles.length = 0; renderer.shakes.length = 0; s.time += 3; render();
    const decals = () => renderer.decals.getContext('2d').getImageData(0, 0, renderer.decals.width, renderer.decals.height).data;
    const decalSum = (data, x, y, r) => { const k = renderer.terrainScale * 32, w = renderer.decals.width; let n = 0; for (let yy = Math.floor((y - r) * k); yy < (y + r) * k; yy++) for (let xx = Math.floor((x - r) * k); xx < (x + r) * k; xx++) n += data[(yy * w + xx) * 4 + 3]; return n; };
    const hide = (x0, y0, x1, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) s.visible[0][y * s.width + x] = 0; };

    // Tactical map: zone rings and objective beacons follow the battlefield rule; sites appear once explored.
    const mapCanvas = document.createElement('canvas'), mapWorld = document.createElement('canvas');
    mapCanvas.style.cssText = 'position:fixed;right:0;bottom:0;width:200px;height:150px;z-index:99999';
    mapWorld.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:240px;z-index:99998';
    document.body.append(mapWorld, mapCanvas);
    const mapped = new Renderer(mapWorld, mapCanvas);
    const mapRender = () => { mapped.lastMinimap = -Infinity; mapped.draw(s, view); return mapCanvas.getContext('2d').getImageData(0, 0, mapCanvas.width, mapCanvas.height).data; };
    const mapDiff = (apply, undo) => { apply(); const a = mapRender(); undo(); return difference(a, mapRender()); };
    s.visible[0].fill(0); s.explored[0].fill(0);
    const withMission = mission => mapDiff(() => { s.mission = mission; }, () => { delete s.mission; });
    const site = [{ id: 'ridge', kind: 'outpost', x: 31, y: 31, r: 2, name: 'Cinder Ridge' }];
    result.minimap = { revealedZone: withMission(drill('muster')), hiddenZone: withMission(drill('muster', false)), unreferenced: withMission(drill('range')),
      lit: withMission({ ...drill('relay'), id: 'render-lit', objectives: [] }),
      unexploredSite: mapDiff(() => { s.sites = site; }, () => { delete s.sites; }) };
    // The active-objective beacon pulses on the overlay: a done objective's zone keeps only its ring.
    const doneMission = drill('muster', true, 'done');
    const centre = data => { const { s: k, ox, oy } = mapped.minimapLayout(s), x = Math.round((ox + 30 * k) * mapped.dpr), y = Math.round((oy + 30 * k) * mapped.dpr); return data[(y * mapCanvas.width + x) * 4]; };
    s.mission = drill('muster'); const activeCentre = centre(mapRender()); s.mission = doneMission; const doneCentre = centre(mapRender()); delete s.mission;
    result.minimap.beacon = { active: activeCentre, done: doneCentre };
    s.explored[0].fill(1);
    result.minimap.exploredSite = mapDiff(() => { s.sites = site; }, () => { delete s.sites; });
    // Site names: crowded names, one over a structure marker, and names at the left and bottom edges.
    const names = [], fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y) {
      if (this.canvas === mapped.minimapBase) names.push({ text, x, y, width: this.measureText(text).width });
      return fillText.apply(this, arguments);
    };
    s.sites = [{ id: 'kiln', kind: 'outpost', x: 40, y: 40, r: 2, name: 'Kiln Knoll' }, { id: 'glass', kind: 'outpost', x: 41, y: 40.5, r: 2, name: 'Glass Commons' },
      { id: 'bench', kind: 'pass', x: 1, y: 70, r: 2, name: 'Clinker Bench' }, { id: 'floor', kind: 'ford', x: 100, y: 143, r: 2, name: 'Scoria Floor' },
      { id: 'yard', kind: 'outpost', x: 151.5, y: 99, r: 2, name: 'Tinder Ledge' }];
    s.entities = [{ id: nextId++, type: 'factory', team: 0, kind: 'building', x: 150, y: 100, size: 3, hp: 1700, maxHp: 1700, progress: 1, queue: [], cooldown: 0 }];
    try { mapRender(); } finally { CanvasRenderingContext2D.prototype.fillText = fillText; }
    const layout = mapped.minimapLayout(s);
    result.minimap.names = names.map(({ text, x, y, width }) => ({ text, left: x - width / 2 - layout.ox,
      right: layout.ox + s.width * layout.s - x - width / 2, bottom: layout.oy + s.height * layout.s - y }));
    delete s.sites; s.entities = [];
    s.visible[0].fill(1);
    delete MISSIONS['render-lit']; delete MISSIONS['render-deploy'];

    // Incoming shells mark their landing only where the target cell is visible, even when the shell itself is seen.
    const shellAt = () => ({ type: 'shell', weapon: 'artillery', x: 25, y: 30, tx: 33.5, ty: 30.5, life: .2, maxLife: .35, team: 1 });
    const landingDiff = fx => { s.effects = []; const a = region(render(), 33.5, 30.5, 14); s.effects = [fx]; const b = region(render(), 33.5, 30.5, 14); s.effects = [];
      let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
    hide(32, 28, 36, 33); result.shells = { hidden: landingDiff(shellAt()) };
    s.visible[0][30 * s.width + 33] = 1; result.shells.visible = landingDiff(shellAt());
    s.visible[0].fill(1); renderer.particles.length = 0; renderer.shakes.length = 0; renderer.impacts.length = 0;

    // Structure deaths: a seen collapse adds staggered bursts and a smoke column, an unseen one nothing, and an
    // unfinished structure collapses (and leaves a husk) only in proportion to what was built.
    const factory = (x, y, progress) => ({ id: nextId++, type: 'factory', team: 1, kind: 'building', x, y, size: 3, hp: 1700, maxHp: 1700, progress, queue: [], cooldown: 0 });
    // Each collapse uses fresh ground, so earlier husks never saturate the decal measurement.
    const collapse = (progress, hidden, x, y) => {
      const body = factory(x, y, progress), cx = x + 1.5, cy = y + 1.5;
      s.effects = []; s.entities = [body]; s.visible[0].fill(1); if (hidden) hide(x - 1, y - 1, x + 4, y + 4);
      renderer.particles.length = 0; renderer.shakes.length = 0; s.time += .05; render();
      renderer.lastDecalFade = s.time; const before = decals();
      body.hp = 0; s.entities = []; s.time += .05;
      s.effects = [{ type: 'explosion', x: cx, y: cy, life: .55, maxLife: .6, team: 1, size: 3 }]; render();
      const kinds = {}; for (const p of renderer.particles) kinds[p.kind] = (kinds[p.kind] || 0) + 1;
      const out = { blast: kinds.blast || 0, smoke: kinds.smoke || 0, particles: renderer.particles.length, decal: decalSum(decals(), cx, cy, 1.6) - decalSum(before, cx, cy, 1.6) };
      s.effects = []; s.visible[0].fill(1); s.time += 4; render(); renderer.particles.length = 0; renderer.shakes.length = 0;
      return out;
    };
    result.collapse = { seen: collapse(1, false, 60, 40), hidden: collapse(1, true, 66, 40), half: collapse(.5, false, 60, 46), foundation: collapse(.08, false, 66, 46) };

    // Shell kills show on landing: the body stays until the shell arrives, then its blast and wreck; a
    // survivor's hit flash waits for the same moment.
    const victim = unit('tank', 1, 32, 30), survivor = unit('tank', 1, 33.3, 31.1);
    s.effects = []; s.entities = [victim, survivor]; s.time += .05; render();
    renderer.lastDecalFade = s.time; const beforeShell = decals();
    const launch = s.time + .05, death = { type: 'explosion', x: 32, y: 30, life: .55, maxLife: .6, team: 1, size: 1 };
    victim.hp = 0; s.entities = [survivor]; survivor.lastHit = launch; s.time = launch;
    s.effects = [{ type: 'shell', weapon: 'artillery', x: 26, y: 30, tx: 32, ty: 30, life: .3, maxLife: .35, team: 0 }, death];
    const launched = render();
    result.shellKill = { dying: renderer.dying.length, held: renderer.held.has(death), wreckEarly: decalSum(decals(), 32, 30, .8) - decalSum(beforeShell, 32, 30, .8),
      blastTime: renderer.blastTime(death) - launch };
    delete survivor.lastHit; result.shellKill.flashEarly = difference(launched, render()); survivor.lastHit = launch;
    s.time = launch + .32; death.life = .23; s.effects = [death];
    const landed = render();
    result.shellKill.dyingAfter = renderer.dying.length;
    result.shellKill.wreckLanded = decalSum(decals(), 32, 30, .8) - decalSum(beforeShell, 32, 30, .8);
    result.shellKill.blast = renderer.particles.some(p => p.kind === 'blast' && Math.abs(p.born - (launch + .3)) < 1e-9);
    delete survivor.lastHit; result.shellKill.flashLanded = difference(landed, render());
    s.effects = []; s.entities = []; s.time += 4; render(); renderer.particles.length = 0; renderer.shakes.length = 0;

    // Projectiles finish their flight on the drawn clock after the simulation drops them; the rocket's blast waits.
    const rocketFx = { type: 'rocket', weapon: 'rocket', x: 28, y: 30, tx: 33, ty: 30, life: .04, maxLife: .25, team: 0 };
    const impact = { type: 'explosion', weapon: 'rocket', x: 33, y: 30, life: .3, maxLife: .35, team: 0, size: .65 };
    s.effects = [rocketFx]; tick(() => {}, .05); render();
    tick(() => { s.effects = [impact]; }, .01); const tail = render();
    result.rocketTail = { landed: renderer.landed.length, held: renderer.held.has(impact),
      blastWaits: renderer.particles.some(p => p.kind === 'blast' && p.born > s.time - .05 + 1e-9 && p.born <= s.time - .01 + 1e-9) };
    const copies = renderer.landed.splice(0); result.rocketTail.drawn = difference(tail, render()); renderer.landed.push(...copies);
    renderer.pendingTime = .05; render(); result.rocketTail.after = renderer.landed.length;
    s.effects = []; s.time += 4; render(); renderer.particles.length = 0; renderer.shakes.length = 0;

    // Embers rise only over visible lava.
    const lavaState = createGame('render-embers'); lavaState.terrain.fill(0); lavaState.minerals.fill(0); lavaState.entities = []; lavaState.effects = [];
    for (let y = 29; y <= 32; y++) for (let x = 28; x <= 33; x++) lavaState.terrain[y * lavaState.width + x] = 3;
    const lavaRenderer = new Renderer(mapWorld, null); lavaRenderer.createTerrain(lavaState);
    const emberPixels = visibleGrid => {
      const c = document.createElement('canvas'); c.width = 40 * 32; c.height = 40 * 32; const g = c.getContext('2d'), saved = lavaRenderer.ctx;
      lavaRenderer.ctx = g; let n = 0;
      for (let k = 0; k < 24; k++) {
        g.clearRect(0, 0, c.width, c.height); lavaRenderer.drawEmbers(lavaState, visibleGrid, k * .37, 20, 20, 40, 40);
        const data = g.getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < data.length; i += 4) if (data[i]) n++;
      }
      lavaRenderer.ctx = saved; c.width = c.height = 0; return n;
    };
    const lavaVisible = new Uint8Array(lavaState.width * lavaState.height).fill(1), lavaHidden = new Uint8Array(lavaState.width * lavaState.height);
    result.embers = { visible: emberPixels(lavaVisible), hidden: emberPixels(lavaHidden) };

    // Ground-targeting preview, as main.js describes it: reach rings, then the target area in amber when valid and
    // warning orange when not.
    s.effects = []; s.entities = []; const noPreview = render();
    view.abilityPreview = { reach: [{ x: 26, y: 30, r: 5 }] }; const reachPreview = render();
    view.abilityPreview = { reach: [], x: 30, y: 30, radius: 7, valid: true }; const validPreview = render();
    view.abilityPreview = { reach: [], x: 30, y: 30, radius: 7, valid: false }; const invalidPreview = render(); delete view.abilityPreview;
    // Warmth (red minus blue) and amber (green minus blue) on the area's right edge, against the same ground without a preview.
    const tone = (data, a, b) => { const pixels = region(data, 30 + 7, 30, 4); let n = 0; for (let i = 0; i < pixels.length; i += 3) n += pixels[i + a] - pixels[i + b]; return n; };
    result.preview = { reach: difference(noPreview, reachPreview), valid: difference(noPreview, validPreview), invalid: difference(noPreview, invalidPreview),
      validWarmth: tone(validPreview, 0, 2) - tone(noPreview, 0, 2), invalidWarmth: tone(invalidPreview, 0, 2) - tone(noPreview, 0, 2),
      validAmber: tone(validPreview, 1, 2) - tone(noPreview, 1, 2), invalidAmber: tone(invalidPreview, 1, 2) - tone(noPreview, 1, 2) };
    mapCanvas.remove(); mapWorld.remove();

    // A review scene with every marker: objective zone, site label, own flare, barrage reticle, dug-in squad and a burning tank.
    world.style.width = '100vw'; world.style.height = '100vh';
    window.markerPreview = zoom => {
      renderer.resize(); Object.assign(view, { x: 30, y: 30, zoom, selected: new Set() });
      s.visible[0].fill(0); s.explored[0].fill(0);
      for (let y = 22; y < 40; y++) for (let x = 20; x < 42; x++) { s.explored[0][y * s.width + x] = 1; if (Math.hypot(x - 29, y - 30) < 9) s.visible[0][y * s.width + x] = 1; }
      s.mission = { id: 'drill', objectives: [{ id: 'muster', state: 'active', progress: 0, revealed: true }], fired: {}, counters: {}, nextCheck: 0, startedAt: 0,
        zones: [{ id: 'muster', x: 33, y: 28, r: 3, label: 'Muster point' }] };
      s.sites = [{ id: 'ridge', kind: 'outpost', x: 25, y: 34, r: 2, name: 'Cinder Ridge' }];
      s.reveals = [{ team: 0, x: 36, y: 33, r: 7, until: s.time + 8 }];
      const squad = [0, 1, 2].map(i => unit('rifle', 0, 26 + i * .8, 29, { abilityUntil: s.time + 6, angle: 0 }));
      const gun = unit('artillery', 0, 24, 31, { barrage: { x: 30, y: 33, shots: 3, next: s.time + .4 } });
      const hulk = unit('tank', 0, 29, 32, { hp: 60, angle: -.6 }), raider = unit('striker', 1, 34, 31, { angle: Math.PI });
      s.entities = [...squad, gun, hulk, raider];
      renderer.draw(s, view); delete s.mission; delete s.sites; delete s.reveals;
    };
    return result;
  });
  assert(Math.abs(checks.friendBlend - 30.2) < 1e-9, `Friendly units blend halfway between ticks (${checks.friendBlend})`);
  assert(checks.friendAngle > .99, 'Headings blend along the shortest arc');
  assert(Math.abs(checks.enemyBlend - 33.2) < 1e-9, 'Enemies seen on both ticks blend');
  assert(checks.hiddenSnap, 'An enemy that was hidden on the previous tick snaps instead of sweeping out of fog');
  assert(checks.enemyHiddenNow, 'An enemy hidden on the current tick is not blended');
  assert(checks.jumpSnap, 'Jumps longer than two tiles snap');
  assert.equal(checks.frozen, 0, 'Repeated frames with the same scheduler time are identical');
  assert(Math.abs(checks.resumeHold - 30.2) < 1e-9, `A restarted scheduler remainder never steps the drawn pose back (${checks.resumeHold})`);
  assert(checks.fixtureSnap, 'A body moved outside the tick snaps to its true position');
  assert(Math.abs(checks.settled - 30.4) < 1e-9, 'A completed blend reaches the simulation pose');
  assert(checks.freshExact, 'Renderers without snapshots draw exact simulation poses');
  assert(checks.shake > 0 && checks.shake <= 4, `Visible blasts shake the battlefield within the cap (${checks.shake})`);
  assert.equal(checks.shakeOff, 0, 'view.screenShake = false disables shake');
  assert(checks.shakeCap <= 4, 'Stacked blasts stay within the shake cap');
  assert(checks.particles >= 3, 'A seen blast throws debris');
  assert.deepEqual(checks.hiddenBlast, { particles: 0, shakes: 0, decals: 0 }, 'An explosion in fog leaves no particles, shake or decals');
  assert(checks.wreck.unseen === 0 && checks.wreck.infantry > 1000 && checks.wreck.seen > checks.wreck.infantry * 1.15,
    `A seen vehicle death leaves a scorch and husk, infantry only a scorch, an unseen death nothing (${JSON.stringify(checks.wreck)})`);
  assert(checks.hitFlash > 30 && checks.bakedUnchanged, 'Hit flashes are overlays that never retint baked frames');
  assert(checks.burning > 4, `Vehicles below 25% health burn visibly (${checks.burning})`);
  assert.equal(checks.hiddenBurning, 0, 'A hidden burning enemy draws nothing');
  assert(checks.ash.moving > 0 && checks.ash.frozen === 0 && checks.ash.underFog === 0, `Ash-fall moves only over visible ground and holds on one clock (${JSON.stringify(checks.ash)})`);
  assert(checks.zones.revealed > 200 && checks.zones.done > 200 && checks.zones.lit > 200 && checks.zones.deploy > 200,
    `Zones of revealed objectives, lit zones and the deploy zone show through fog (${JSON.stringify(checks.zones)})`);
  assert(checks.zones.hiddenObjective === 0 && checks.zones.unreferenced === 0,
    `A zone only a hidden objective uses, or no objective uses, draws nothing over unexplored ground (${JSON.stringify(checks.zones)})`);
  assert(checks.zones.explored > 200, 'An explored zone centre shows its ring');
  assert(checks.zones.litReveal.reveals === 1 && checks.zones.litReveal.drawn === 0,
    `A lit zone's own reveal draws no flare glow or reveal ring (${JSON.stringify(checks.zones.litReveal)})`);
  assert(checks.sites.unexplored === 0 && checks.sites.explored > 50, `Site labels appear only once explored (${JSON.stringify(checks.sites)})`);
  assert(checks.flare.enemy === 0 && checks.flare.own > 200, 'Only the owning team sees its flare');
  assert(checks.abilities.dig > 50 && checks.abilities.overdrive > 20 && checks.abilities.barrage > 50 && checks.abilities.longShot > 50, `Ability visuals draw (${JSON.stringify(checks.abilities)})`);
  assert.equal(checks.abilities.enemyBarrage, 0, 'Enemy barrage targets are never marked');
  assert.deepEqual(checks.events, ['patch'], 'Event flourishes appear only where the player can see');
  assert(checks.particleBound <= 900, 'The particle pool stays bounded');
  const m = checks.minimap;
  assert(m.revealedZone > 4 && m.lit > 4 && m.hiddenZone === 0 && m.unreferenced === 0,
    `Tactical-map zone rings follow the battlefield rule (${JSON.stringify(m)})`);
  assert(m.beacon.active > 180 && m.beacon.done < 120, `Active objectives mark a beacon on the tactical map (${JSON.stringify(m.beacon)})`);
  assert(m.unexploredSite === 0 && m.exploredSite > 4, `Tactical-map sites appear only once explored (${JSON.stringify(m)})`);
  const named = m.names.map(name => name.text);
  assert(named.filter(name => /Kiln Knoll|Glass Commons/.test(name)).length === 1 && !named.includes('Tinder Ledge'),
    `Tactical-map site names never overprint each other or cover a structure (${JSON.stringify(m.names)})`);
  assert(named.includes('Clinker Bench') && named.includes('Scoria Floor') && m.names.every(name => name.left >= 1.9 && name.right >= 1.9 && name.bottom >= 6.9),
    `Tactical-map site names stay inside the map (${JSON.stringify(m.names)})`);
  assert(checks.shells.hidden === 0 && checks.shells.visible > 20, `Incoming-shell rings show only over a visible target cell (${JSON.stringify(checks.shells)})`);
  const c = checks.collapse;
  assert(c.seen.blast >= 4 && c.seen.smoke >= 8 && c.hidden.particles === 0 && c.hidden.decal === 0,
    `A seen structure collapses in bursts and smoke; an unseen one leaves nothing (${JSON.stringify(c)})`);
  assert(c.foundation.blast === 0 && c.foundation.smoke <= 1 && c.half.blast < c.seen.blast && c.half.smoke < c.seen.smoke,
    `An unfinished structure collapses in proportion to what was built (${JSON.stringify(c)})`);
  assert(c.foundation.decal > 200 && c.foundation.decal < c.seen.decal * .3 && c.half.decal > c.foundation.decal && c.half.decal < c.seen.decal * .92,
    `An unfinished structure leaves only the built part of its husk (${JSON.stringify(c)})`);
  const k = checks.shellKill;
  assert(k.dying === 1 && k.held && k.wreckEarly === 0 && k.flashEarly === 0 && Math.abs(k.blastTime - .3) < 1e-9,
    `A shell kill keeps the body and holds its blast, wreck and survivor flashes until landing (${JSON.stringify(k)})`);
  assert(k.dyingAfter === 0 && k.wreckLanded > 1000 && k.blast && k.flashLanded > 30, `The shell's kill shows when it lands (${JSON.stringify(k)})`);
  const t = checks.rocketTail;
  assert(t.landed === 1 && t.held && t.blastWaits && t.drawn > 10 && t.after === 0,
    `A rocket finishes its flight on the drawn clock and its blast waits for it (${JSON.stringify(t)})`);
  assert(checks.embers.visible > 0 && checks.embers.hidden === 0, `Embers rise only over visible lava (${JSON.stringify(checks.embers)})`);
  const pv = checks.preview;
  assert(pv.reach > 100 && pv.valid > 100 && pv.invalid > 100 && pv.validWarmth > 0 && pv.invalidWarmth > 0 && pv.validAmber > pv.invalidAmber * 1.5,
    `The ability preview draws reach rings and its target area, amber when valid and orange when not (${JSON.stringify(pv)})`);

  for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    await page.setViewportSize(viewport);
    for (const zoom of [38, 16]) {
      await page.evaluate(zoom => window.markerPreview(zoom), zoom);
      await page.screenshot({ path: `${output}/render-markers-${name}-${zoom}.png` });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // Live loop: main.js snapshots every tick and passes the scheduler remainder; paused frames hold still.
  await page.reload(); await page.waitForFunction(() => window.ashline?.booted);
  await page.locator('#map-size').selectOption('standard'); await page.locator('#seed').fill('S5-RENDER');
  await page.locator('#deploy').click();
  await page.waitForFunction(() => ashline.state && !ashline.loading && !ashline.paused, null, { timeout: 120000 });
  const live = await page.evaluate(async () => {
    const { addEntity, raceUnit, raceBuilding, issueOrder } = await import('./sim.js');
    const s = ashline.state, view = ashline.view; s.ai.nextThink = 1e12;
    const core = s.entities.find(e => e.team === 0 && e.kind === 'building');
    const cx = core.x + 9, cy = core.y + 2;
    // A staged skirmish beside the base: mixed squads, a damaged tank, an enemy sentry and a flare.
    const spawn = (team, role, x, y) => addEntity(s, team, 'unit', raceUnit(s, team, role), x, y);
    const mine = ['tank', 'rifle', 'rocket', 'striker', 'artillery', 'rifle', 'rifle', 'tank'].map((role, i) => spawn(0, role, cx - 3 + (i % 4) * 1.5, cy + Math.floor(i / 4) * 1.6));
    const foes = ['tank', 'rifle', 'rifle', 'scout', 'tank', 'rocket'].map((role, i) => spawn(1, role, cx + 6 + (i % 3) * 1.4, cy + Math.floor(i / 3) * 1.6));
    const sentry = addEntity(s, 1, 'building', raceBuilding(s, 1, 'turret'), Math.floor(cx + 9), Math.floor(cy - 3));
    for (const f of foes) f.hp = f.maxHp * .4;
    mine[0].hp = mine[0].maxHp * .2; sentry.hp = sentry.maxHp * .3;
    mine[5].abilityUntil = s.time + 10; mine[6].abilityUntil = s.time + 10;
    (s.reveals ??= []).push({ team: 0, x: cx + 8, y: cy + 1, r: 7, until: s.time + 12 });
    s.sites = [{ id: 'ford', kind: 'crossing', x: cx - 4, y: cy + 4, r: 2, name: 'Basalt ford' }];
    const scout = s.entities.find(e => e.team === 0 && e.kind === 'unit' && e.type.toLowerCase().includes('scout')) || mine[3];
    issueOrder(s, [scout.id], { type: 'move', x: scout.x + 6, y: scout.y + 2 });
    issueOrder(s, [mine[0], mine[1], mine[2], mine[3], mine[4], mine[7]].map(u => u.id), { type: 'attackMove', x: cx + 8, y: cy + 1 });
    view.x = cx + 3; view.y = cy + 1; view.selected = new Set(mine.map(u => u.id));
    const samples = [];
    for (let i = 0; i < 40; i++) { await new Promise(requestAnimationFrame); samples.push({ blending: ashline.renderer.blending, lag: ashline.renderer.drawLag, x: ashline.renderer.poseOf(scout).x, time: s.time, poseTime: ashline.renderer.poseTime }); }
    return { samples };
  });
  assert(live.samples.some(sample => sample.blending), 'The live loop records tick poses');
  assert(live.samples.every(sample => !sample.blending || sample.time - sample.poseTime < .26 && sample.lag >= 0 && sample.lag <= .05 + 1e-9), 'Lag stays within one tick');
  const steps = live.samples.map((sample, i) => i ? sample.x - live.samples[i - 1].x : 0).slice(1);
  assert(steps.every(step => step >= -1e-9), 'Drawn positions advance monotonically along the route');
  // Review screenshots of the running skirmish at normal and minimum zoom on desktop and phone.
  for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    await page.setViewportSize(viewport);
    for (const level of ['normal', 'minimum']) {
      await page.evaluate(async level => {
        const { zoomLevels } = await import('./camera.js'); const { spriteNativeZoom } = await import('./assets.js');
        const levels = zoomLevels(spriteNativeZoom(ashline.renderer.dpr));
        ashline.view.zoom = level === 'minimum' ? levels[0] : levels[Math.min(levels.length - 1, 2)];
      }, level);
      await page.waitForTimeout(450);
      await page.screenshot({ path: `${output}/render-effects-${name}-${level}.png` });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.keyboard.press('p');
  await page.waitForFunction(() => ashline.paused);
  const pausedFrames = await page.evaluate(() => {
    const r = ashline.renderer, read = () => r.ctx.getImageData(0, 0, 400, 300).data;
    r.draw(ashline.state, ashline.view); const a = read(); r.draw(ashline.state, ashline.view); const b = read();
    let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
    return n;
  });
  assert.equal(pausedFrames, 0, 'Paused frames are frozen');
  // Resuming restarts the scheduler remainder; the first frames after it never step the drawn pose back.
  await page.keyboard.press('p'); await page.waitForFunction(() => !ashline.paused);
  await page.evaluate(async () => {
    const { issueOrder, unitRole } = await import('./sim.js');
    const s = ashline.state, own = s.entities.filter(e => e.team === 0 && e.kind === 'unit' && e.hp > 0);
    const unit = own.find(e => unitRole(e) === 'scout') || own[0];
    issueOrder(s, [unit.id], { type: 'move', x: Math.min(s.width - 2, unit.x + 12), y: unit.y });
    window.resumeProbe = { unit, samples: [] };
    for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame);
  });
  await page.keyboard.press('p'); await page.waitForFunction(() => ashline.paused);
  const pausedX = await page.evaluate(() => {
    const r = ashline.renderer, probe = window.resumeProbe, draw = Object.getPrototypeOf(r).draw;
    r.draw = function (state, view) { draw.call(this, state, view); probe.samples.push(this.poseOf(probe.unit).x); };
    return r.poseOf(probe.unit).x;
  });
  await page.keyboard.press('p'); await page.waitForFunction(() => !ashline.paused);
  const resumedX = await page.evaluate(async () => {
    for (let i = 0; i < 6; i++) await new Promise(requestAnimationFrame);
    delete ashline.renderer.draw; return window.resumeProbe.samples;
  });
  assert(resumedX.length >= 3 && resumedX[0] >= pausedX - 1e-9 && resumedX.every((x, i) => !i || x >= resumedX[i - 1] - 1e-9),
    `The drawn pose never steps back after resuming (${pausedX} then ${resumedX.join(', ')})`);
  assert.deepEqual(errors, []);
  console.log('Render effects checks passed: fog-safe tick interpolation, frozen pauses, shake gating and cap, fog-safe blasts and wrecks, hit-flash overlays, burning vehicles, ash-fall, mission zones, site labels, ability visuals, event flourishes and bounded particles. Screenshots: ' + output);
} finally { await browser.close(); }
