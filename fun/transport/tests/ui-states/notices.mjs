// Notices states: the goal card open and folded, three toasts at once and News. Headlines do not exist yet.
import { clearToasts, freshWorld, holdToasts, openGameAction, settle } from './setup.mjs';

// Three notices of each kind, as the model files them; the next HUD refresh shows them as toasts.
const notify = page => page.evaluate(() => {
  const game = transport.game, notices = [['Pinehaven grew to 1,200 residents.', 'info'], ['Stone is piling up at Quarry yard.', 'warning'], ['A road to Alderbrook was cut. One route lost its connection.', 'error']];
  notices.forEach(([message, type], n) => game.notifications.unshift({ id: `ui-state-${n}`, day: game.day, message, text: message, type }));
  game.money += 1;
});

async function goal(page, open) {
  await freshWorld(page);
  await page.locator('#objective-card').waitFor({ state: 'visible' });
  const expanded = () => page.locator('#objective-body').isVisible();
  if (open && !await expanded()) await page.locator('#objective-chip').click();
  if (!open && await expanded()) await page.locator('#dismiss-objective').click();
  await page.mouse.move(1, 1);
  await settle(page);
}

export const states = [
  { name: 'notices-goal-open', setup: page => goal(page, true) },
  { name: 'notices-goal-checklist', async setup(page) {
    await goal(page,true);await page.locator('#objective-checklist > summary').click();await settle(page);
  } },
  { name: 'notices-goal-folded', setup: page => goal(page, false) },
  { name: 'notices-toasts', async setup(page) {
    await freshWorld(page);
    await notify(page);
    await page.waitForFunction(() => document.querySelectorAll('#toast-region .toast').length === 3, undefined, { timeout: 10000 });
    await holdToasts(page);
    await settle(page);
  } },
  { name: 'notices-news', async setup(page) {
    await freshWorld(page);
    await notify(page);
    await page.waitForFunction(() => document.querySelectorAll('#toast-region .toast').length === 3, undefined, { timeout: 10000 });
    await clearToasts(page, { wait: 0 });
    await openGameAction(page, 'news-button');
    await page.locator('.news-list').waitFor();
    await settle(page);
  } },
];
