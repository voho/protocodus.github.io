// Run with: node tests/navigation-check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function element(attributes = {}) {
  const attrs = new Map(Object.entries(attributes));
  const classes = new Set();
  return Object.assign(new EventTarget(), {
    style: {},
    classList: {
      add: (name) => classes.add(name),
      contains: (name) => classes.has(name),
      toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
    },
    getAttribute: (name) => attrs.get(name) ?? null,
    setAttribute: (name, value) => attrs.set(name, value),
    hasAttribute: (name) => attrs.has(name),
    removeAttribute: (name) => attrs.delete(name),
    focus() { document.activeElement = this; },
  });
}

const ids = ['top', 'products', 'fun', 'company', 'contact'];
const sections = new Map(ids.map((id) => [id, element()]));
const desktopLinks = ids.map((id) => element({ href: `#${id}` }));
const mobileLinks = [...ids.map((id) => element({ href: `#${id}` })), element({ href: 'mailto:studio@example.com' })];
const toggle = element();
const menu = Object.assign(element(), {
  hidden: true,
  contains: (node) => mobileLinks.includes(node),
  querySelectorAll: () => mobileLinks,
});
const document = Object.assign(new EventTarget(), {
  documentElement: element(),
  body: { style: {} },
  activeElement: null,
  getElementById: (id) => id === 'mobile-menu' ? menu : sections.get(id) ?? null,
  querySelector: (selector) => selector === '.menu-toggle' ? toggle
    : selector === '.nav-link' ? desktopLinks[0] : sections.get(selector.slice(1)) ?? null,
  querySelectorAll: (selector) => selector === '.reveal' ? [] : [...desktopLinks, ...mobileLinks.slice(0, -1)],
});
const observers = [];
class IntersectionObserver {
  constructor(callback, options) {
    Object.assign(this, { callback, options, targets: [], disconnected: false });
    observers.push(this);
  }
  observe(target) { this.targets.push(target); }
  disconnect() { this.disconnected = true; }
}
const mobileViewport = Object.assign(new EventTarget(), { matches: true });
const window = Object.assign(new EventTarget(), {
  innerWidth: 390,
  innerHeight: 844,
  IntersectionObserver,
  matchMedia: (query) => query === '(max-width: 880px)' ? mobileViewport : { matches: true },
});
runInNewContext(readFileSync(new URL('../assets/js/main.js', import.meta.url), 'utf8'), {
  document, window, IntersectionObserver, requestAnimationFrame: (callback) => callback(),
});

function key(key, shiftKey = false) {
  const event = Object.assign(new Event('keydown', { cancelable: true }), { key, shiftKey });
  document.dispatchEvent(event);
  return event;
}
function checkObserverBand() {
  const observer = observers.at(-1);
  const margins = observer.options.rootMargin.split(' ').map((value) =>
    parseFloat(value) * (value.endsWith('%') ? window.innerWidth / 100 : 1));
  assert.ok(-margins[0] < window.innerHeight + margins[2],
    `Navigation observation band must have height at ${window.innerWidth}×${window.innerHeight}`);
  assert.equal(observer.targets.length, sections.size, 'Observe each section once');
}
function resize(width, height) {
  const previousObserver = observers.at(-1);
  Object.assign(window, { innerWidth: width, innerHeight: height });
  mobileViewport.matches = width <= 880;
  mobileViewport.dispatchEvent(Object.assign(new Event('change'), { matches: mobileViewport.matches }));
  window.dispatchEvent(new Event('resize'));
  assert.ok(previousObserver.disconnected, 'Resize replaces the old observer');
  checkObserverBand();
}

checkObserverBand();
toggle.dispatchEvent(new Event('click'));
assert.equal(menu.hidden, false);
assert.equal(document.documentElement.style.overflow, 'hidden');
assert.equal(toggle.getAttribute('aria-expanded'), 'true');
assert.equal(document.activeElement, mobileLinks[0]);
assert.equal(key('Tab', true).defaultPrevented, true);
assert.equal(document.activeElement, toggle);
key('Tab', true);
assert.equal(document.activeElement, mobileLinks.at(-1));
key('Tab');
assert.equal(document.activeElement, toggle);
key('Tab');
assert.equal(document.activeElement, mobileLinks[0]);
key('Escape');
assert.equal(menu.hidden, true);
assert.equal(document.activeElement, toggle);
assert.equal(document.documentElement.style.overflow, '');
assert.equal(toggle.getAttribute('aria-expanded'), 'false');
assert.equal(key('Tab').defaultPrevented, false, 'Closed menu leaves native Tab navigation alone');

toggle.dispatchEvent(new Event('click'));
mobileLinks[1].dispatchEvent(new Event('click'));
assert.equal(menu.hidden, true);
assert.equal(document.activeElement, sections.get('products'));
assert.equal(sections.get('products').getAttribute('tabindex'), '-1');

toggle.dispatchEvent(new Event('click'));
resize(1440, 900);
assert.equal(menu.hidden, true, 'Desktop resize closes the mobile menu');
assert.equal(document.documentElement.style.overflow, '');
assert.equal(document.activeElement, desktopLinks[0]);
resize(390, 844);
assert.equal(menu.hidden, true, 'Returning to mobile keeps the menu closed');
observers.at(-1).callback([...sections.values()].map((target) => ({
  target, isIntersecting: target === sections.get('products'),
})));
for (const links of [desktopLinks, mobileLinks.slice(0, -1)]) {
  assert.deepEqual(links.map((link) => link.classList.contains('current')), [false, true, false, false, false]);
  assert.equal(links[1].getAttribute('aria-current'), 'location');
}

console.log('Navigation checks passed: keyboard focus, menu resize, and desktop/mobile observation bands.');
