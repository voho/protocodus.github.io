// References and map overlays (refs.css): the edge pointer toward a far town, the back chip after a long jump and the
// inspector's Back line. No surface renders references yet, so each state puts a few in a small paper note over the map.
import { freshWorld, settle } from './setup.mjs';

// A paper note with references built by ui-refs.js from the live game, and the farthest town from the view.
async function note(page) {
  return page.evaluate(async () => {
    const { refFor } = await import('./ui-refs.js'), game = transport.game, c = transport.renderer.getCamera(), x = c.x / 32 - .5, y = c.y / 32 - .5;
    const far = game.cities.slice().sort((a, b) => Math.hypot(b.x - x, b.y - y) - Math.hypot(a.x - x, a.y - y))[0], box = document.createElement('div');
    box.id = 'ref-note';box.style.cssText = 'position:fixed;left:8px;top:132px;z-index:45;max-width:calc(100vw - 16px);padding:8px 12px;background:var(--paper);border-radius:var(--r-3);box-shadow:var(--e2);font-size:var(--fs-body);line-height:var(--lh-body)';
    box.innerHTML = `<p style="margin:0">${refFor(game, `town:${game.cities[0].id}`)} and ${refFor(game, `town:${far.id}`)}</p>`;
    document.body.append(box);
    return far.id;
  });
}

export const states = [
  { name: 'refs-edge-pointer', async setup(page) {
    await freshWorld(page);
    const far = await note(page);
    await page.keyboard.press('Shift'); // keyboard focus links a reference at once
    await page.locator(`#ref-note [data-ref="town:${far}"]`).focus();
    await page.locator('#map-overlays .edge-pointer').waitFor();
    await settle(page);
  } },
  { name: 'refs-back-chip', async setup(page) {
    await freshWorld(page);
    const far = await note(page);
    await page.locator(`#ref-note [data-ref="town:${far}"]`).click();
    await page.locator('#map-overlays .back-chip').waitFor();
    await settle(page);
  } },
  { name: 'refs-inspector-back', async setup(page) {
    await freshWorld(page);
    await note(page);
    await page.evaluate(async () => { const { refFor } = await import('./ui-refs.js'); document.querySelector('#ref-note').insertAdjacentHTML('beforeend', `<p style="margin:0">Stop: ${refFor(transport.game, `stop:${transport.game.stations[0].id}`)}</p>`); });
    await page.locator('#ref-note [data-ref^="stop:"]').click();
    await page.locator('#inspector').waitFor({ state: 'visible' });
    await page.evaluate(async () => { const { refFor } = await import('./ui-refs.js'); document.querySelector('#inspector h3').insertAdjacentHTML('afterend', `<p>Serves ${refFor(transport.game, `town:${transport.game.cities[0].id}`)}</p>`); });
    await page.locator('#inspector .ref').click();
    await page.locator('#inspector [data-inspector-back]').waitFor();
    await settle(page);
  } },
];
