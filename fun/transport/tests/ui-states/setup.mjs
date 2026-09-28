// Shared starting points for the UI harness. Every state starts on a fresh page at the start menu,
// so a state never inherits another state's world, storage or open panels.
import { createWorldFromMenu, openGameAction } from '../browser-start.mjs';
export { openGameAction };

// Call before the first navigation. The game pauses the moment it starts, so no state depends on how many
// frames ran before the pause button was reached; a state that wants the clock running starts it itself.
export async function prepare(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    let current;
    Object.defineProperty(window, 'transport', { configurable: true, get: () => current, set(next) { current = next; next?.setSpeed?.(0); } });
  });
}

// Two painted frames and loaded fonts: computed styles and screenshots settle on the same frame.
export async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

// Toasts come and go on timers; the states that are not about notices start with an empty region.
export async function clearToasts(page, { wait = 900 } = {}) {
  await page.waitForTimeout(wait);
  await page.evaluate(() => { for (const toast of document.querySelectorAll('#toast-region .toast')) { clearTimeout(toast.toastTimer); toast.remove(); } });
}

// Keeps the toasts on screen: their timers would otherwise remove them between setup and capture.
export const holdToasts = page => page.evaluate(() => { for (const toast of document.querySelectorAll('#toast-region .toast')) clearTimeout(toast.toastTimer); });

// The seeded taiga world every state shares, paused, with the welcome toast gone.
export async function freshWorld(page) {
  await createWorldFromMenu(page, { seed: 1847 });
  await page.waitForFunction(() => document.querySelector('#toast-region .toast'), undefined, { timeout: 5000 }).catch(() => {});
  await clearToasts(page);
  await settle(page);
}

// The audit's setup: a road from the stone quarry, a stop at its foot and a stone route to station-1, run until
// the first delivery. Returns the route id; the celebration toasts are cleared.
export async function stoneRoute(page) {
  const id = await page.evaluate(async () => {
    const { buildPlan } = await import('./construction-plan.js'), { build, addRoute, tick } = await import('./model.js'), game = transport.game, points = [];
    for (let y = 251; y >= 245; y--) points.push({ x: 219, y });
    if (!buildPlan(game, 'road', points, { preferredMode: 'road' }).ok || !build(game, 'bus-stop', 219, 251).ok) throw new Error('the quarry stop could not be built');
    const stop = game.stations.find(station => station.x === 219 && station.y === 251), result = addRoute(game, { mode: 'road', stops: [stop.id, 'station-1'], cargo: 'stone' });
    if (!result.ok) throw new Error(result.message);
    const route = game.routes.at(-1);
    for (let day = 0; day < 120 && !route.delivered; day++) tick(game, 1);
    if (!route.delivered) throw new Error('the stone route never delivered');
    return route.id;
  });
  await page.waitForTimeout(2600);
  await clearToasts(page, { wait: 0 });
  await settle(page);
  return id;
}

// A client point on the map for a world tile, after centring the camera on it.
export async function tilePoint(page, x, y, { focus = true } = {}) {
  return page.evaluate(({ x, y, focus }) => {
    const renderer = transport.renderer;
    if (focus) { renderer.focus(x, y); renderer.render(performance.now(), {}); }
    const p = renderer.worldToScreen(x, y), box = document.querySelector('#world').getBoundingClientRect();
    return { x: box.left + p.x, y: box.top + p.y };
  }, { x, y, focus });
}

// Parks the pointer over open map, so a click's hover never lands on whatever re-rendered under it.
export async function rest(page) {
  const point = await page.evaluate(() => {
    for (let y = innerHeight - 24; y > 60; y -= 24) for (let x = innerWidth - 24; x > 0; x -= 24) if (document.elementFromPoint(x, y)?.id === 'world') return { x, y };
    return { x: 1, y: innerHeight - 1 };
  });
  await page.mouse.move(point.x, point.y);
}

// Opens a drawer view the way the player does at any width.
export async function openView(page, view) {
  await page.evaluate(view => transport.setView(view), view);
  await settle(page);
}
