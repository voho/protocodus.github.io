#!/usr/bin/env node
// Route line stress view (DESIGN.md 8 and 16.2): twenty routes of every buildable mode on seed 1847, screenshotted around
// the opening town at Region, Town and Detail, plus a sheet of every bullet shape in every line colour on paper and on moss.
// Look at every picture. If the lines read as candy, make the Region core 0.5 px thinner rather than changing hues.
//   TRANSPORT_URL=http://127.0.0.1:8765/fun/transport/ TRANSPORT_PLAYWRIGHT=…/playwright/index.mjs node fun/transport/tools/route-stress.mjs [--out DIR]
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu } from '../tests/browser-start.mjs';

const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const args = process.argv.slice(2), out = args.includes('--out') ? args[args.indexOf('--out') + 1] : process.env.TRANSPORT_OUTPUT || '/tmp/transport-route-stress';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/');
  await createWorldFromMenu(page, { seed: 1847 });
  // Towns near the first one, and the sites near it that can ship to a buyer, joined by the first-route planner.
  const built = await page.evaluate(async () => {
    const [{ build, addRoute, tick }, { buildPlan }, { planConnection }, { INDUSTRIES, TOWN_CARGO }] = await Promise.all([import('./model.js'), import('./construction-plan.js'), import('./network-router.js'), import('./data.js')]);
    const g = transport.game, home = g.cities[0], far = (a, b) => Math.hypot(a.x - b.x, a.y - b.y), failed = [];
    g.money = 1e9;
    const connect = (source, target, mode, cargo) => {
      if (g.routes.length >= 20) return;
      const plan = planConnection(g, source, target, mode);
      if (!plan.ok) return failed.push(`${source.name} to ${target.name} by ${mode}: ${plan.reason}`);
      if (!buildPlan(g, mode, plan.path, { preferredMode: mode }).ok) return failed.push(`${source.name} to ${target.name}: build`);
      const stops = plan.ends.slice();
      for (const stop of plan.stops) { const made = build(g, mode === 'rail' ? 'train-stop' : 'bus-stop', stop.x, stop.y); if (!made.ok) return failed.push(made.message); stops[stop.end] = made.station; }
      const launched = addRoute(g, { mode, stops: stops.map(stop => stop.id), cargo });
      if (!launched.ok) failed.push(launched.message);
    };
    const ports = g.cities.slice(0, 2).map(town => build(g, 'port', town.x, town.y + 5));
    if (ports.every(port => port.ok)) { addRoute(g, { mode: 'water', stops: ports.map(port => port.station.id), cargo: 'passengers' }); addRoute(g, { mode: 'water', stops: ports.map(port => port.station.id), cargo: 'passengers' }); }
    const towns = g.cities.filter(town => town !== home).sort((a, b) => far(a, home) - far(b, home));
    for (const town of towns.slice(1, 5)) connect(home, town, 'road', 'passengers');
    connect(towns[1], towns[2], 'road', 'passengers');
    const sites = g.industries.filter(site => Object.keys(INDUSTRIES[site.kind].outputs).length).sort((a, b) => far(a, home) - far(b, home));
    for (const [n, site] of sites.slice(0, 16).entries()) {
      const cargo = Object.keys(INDUSTRIES[site.kind].outputs)[0], buyers = g.industries.filter(other => other !== site && INDUSTRIES[other.kind].inputs[cargo]);
      const buyer = TOWN_CARGO.includes(cargo) ? g.cities.slice().sort((a, b) => far(a, site) - far(b, site))[0] : buyers.sort((a, b) => far(a, site) - far(b, site))[0];
      if (buyer) connect(site, buyer, n % 3 === 2 ? 'rail' : 'road', cargo);
    }
    for (const town of towns.slice(5, 9)) connect(home, town, 'rail', 'passengers');
    tick(g, 1.5);
    const modes = {};for (const route of g.routes) modes[route.mode] = (modes[route.mode] || 0) + 1;
    return { routes: g.routes.map(route => `${route.number} ${route.mode} ${route.cargo} ${route.color} ${route.name}`), modes, failed: failed.slice(0, 8), home: { x: home.x, y: home.y } };
  });
  console.log(`${built.routes.length} routes: ${JSON.stringify(built.modes)}\n  ${built.routes.join('\n  ')}`);
  if (built.failed.length) console.log(`Skipped: ${built.failed.join('; ')}`);
  for (const [view, zoom] of [['region', .5], ['town', 1], ['detail', 2]]) {
    await page.evaluate(({ zoom, home }) => { transport.renderer.setZoom(zoom); transport.renderer.focus(home.x + (zoom < 1 ? 12 : 3), home.y + (zoom < 1 ? 6 : 1)); }, { zoom, home: built.home });
    await page.waitForTimeout(700);
    await page.locator('#world').screenshot({ path: `${out}/stress-${view}.png` });
  }
  // Every mode's bullet in every line colour, with one, two and three digits, on paper and on moss.
  await page.evaluate(async () => {
    const { LINE_COLORS, COLORS } = await import('./design-tokens.js'), canvas = document.createElement('canvas'), dpr = devicePixelRatio;
    canvas.id = 'bullet-sheet'; canvas.style.cssText = 'position:fixed;left:0;top:0;width:880px;height:420px;z-index:9999'; canvas.width = 880 * dpr; canvas.height = 420 * dpr; document.body.append(canvas);
    const c = canvas.getContext('2d'); c.scale(dpr, dpr); c.fillStyle = COLORS.paper; c.fillRect(0, 0, 440, 420); c.fillStyle = '#5f7a45'; c.fillRect(440, 0, 440, 420);
    for (const [side, left] of [[0, 12], [1, 452]]) ['road', 'rail', 'water', 'air'].forEach((mode, row) => LINE_COLORS.forEach((line, n) => {
      const number = [n + 1, 10 + n * 7, 100 + n * 97][Math.floor(n / 3)], x = left + n % 3 * 140, y = 24 + row * 100 + Math.floor(n / 3) * 26;
      const w = transport.renderer.drawBullet(c, x, y, { mode, color: line.fill, number }, 20); transport.renderer.drawBullet(c, x + w + 8, y, { mode, color: line.fill, number }, 16);
    }));
  });
  await page.locator('#bullet-sheet').screenshot({ path: `${out}/stress-bullets.png` });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`Route stress screenshots: ${out}`);
} finally {
  await browser.close();
}
