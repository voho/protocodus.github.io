// Run with: node tests/analytics-check.mjs
// These browser-free checks exercise outbound analytics without contacting Google.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/js/analytics.js', root), 'utf8');

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, callback, options) {
    const listeners = this.listeners.get(name) || [];
    listeners.push({ callback, once: !!options?.once });
    this.listeners.set(name, listeners);
  }
  removeEventListener(name, callback) {
    this.listeners.set(name, (this.listeners.get(name) || []).filter((entry) => entry.callback !== callback));
  }
  dispatchEvent(event) {
    if (!event.target) event.target = this;
    event.currentTarget = this;
    event.preventDefault ||= () => { event.defaultPrevented = true; };
    for (const entry of [...(this.listeners.get(event.type) || [])]) {
      entry.callback.call(this, event);
      if (entry.once) this.removeEventListener(event.type, entry.callback);
    }
    return !event.defaultPrevented;
  }
}

function browser(href = 'https://protocodus.cz/product/maremba/', config, options = {}) {
  const location = new URL(href);
  const scripts = [];
  const document = new Events();
  class Element extends Events {
    constructor(tagName, attrs = {}) {
      super();
      this.tagName = tagName.toUpperCase();
      this.nodeType = 1;
      this.attributes = new Map();
      this.dataset = {};
      this.children = [];
      this.style = {};
      this.textContent = '';
      this.hidden = false;
      this.classList = {
        contains: (name) => (this.getAttribute('class') || '').split(/\s+/).includes(name),
        add: (...names) => this.setAttribute('class', [...new Set([...(this.getAttribute('class') || '').split(/\s+/), ...names])].join(' ')),
        remove: (...names) => this.setAttribute('class', (this.getAttribute('class') || '').split(/\s+/).filter((name) => !names.includes(name)).join(' ')),
      };
      for (const [name, value] of Object.entries(attrs)) this.setAttribute(name, value);
    }
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
      if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
    }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    get className() { return this.getAttribute('class') || ''; }
    set className(value) { this.setAttribute('class', value); }
    get id() { return this.getAttribute('id') || ''; }
    set id(value) { this.setAttribute('id', value); }
    get src() { return this.getAttribute('src') ? new URL(this.getAttribute('src'), location).href : ''; }
    set src(value) { this.setAttribute('src', value); }
    get href() { return this.getAttribute('href') ? new URL(this.getAttribute('href'), location).href : ''; }
    set href(value) { this.setAttribute('href', value); }
    appendChild(child) {
      child.parentElement = this;
      child.parentNode = this;
      this.children.push(child);
      if (child.tagName === 'SCRIPT') scripts.push(child);
      return child;
    }
    append(...children) { children.forEach((child) => this.appendChild(child)); }
    insertBefore(child) { return this.appendChild(child); }
    remove() { this.parentElement.children = this.parentElement.children.filter((child) => child !== this); }
    matches(selector) {
      return selector.split(',').some((piece) => {
        const part = piece.trim();
        const tag = part.match(/^[a-z][a-z0-9-]*/i)?.[0];
        if (tag && this.tagName !== tag.toUpperCase()) return false;
        const id = part.match(/#([\w-]+)/)?.[1];
        if (id && this.id !== id) return false;
        for (const [, cls] of part.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(cls)) return false;
        for (const [, name, , value] of part.matchAll(/\[([\w-]+)(?:([*^$]?=)["']?([^\]"']*)["']?)?\]/g)) {
          if (!this.hasAttribute(name)) return false;
          if (value && this.getAttribute(name) !== value) return false;
        }
        return !!part;
      });
    }
    closest(selector) {
      for (let node = this; node; node = node.parentElement) if (node.matches?.(selector)) return node;
      return null;
    }
    querySelectorAll(selector) {
      return this.children.flatMap((child) => [...(child.matches?.(selector) ? [child] : []), ...(child.querySelectorAll?.(selector) || [])]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    getBoundingClientRect() { return { top: 0, bottom: 100, left: 0, right: 100, width: 100, height: 100 }; }
  }
  document.documentElement = new Element('html');
  document.head = document.documentElement.appendChild(new Element('head'));
  document.body = document.documentElement.appendChild(new Element('body'));
  document.createElement = (tagName) => new Element(tagName);
  document.querySelectorAll = (selector) => document.documentElement.querySelectorAll(selector);
  document.querySelector = (selector) => document.querySelectorAll(selector)[0] || null;
  document.getElementById = (id) => document.querySelector(`#${id}`);
  document.getElementsByTagName = (tagName) => document.querySelectorAll(tagName);
  document.referrer = options.referrer || '';
  document.title = options.title || 'Maremba | Protocodus';
  document.visibilityState = 'visible';
  document.hidden = false;
  document.readyState = 'complete';
  document.documentElement.scrollHeight = 3000;
  const stored = new Map();
  const storage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, String(value)),
    removeItem: (key) => stored.delete(key),
  };
  const timers = [];
  const observers = [];
  class IntersectionObserver {
    constructor(callback) { this.callback = callback; this.targets = []; observers.push(this); }
    observe(target) { this.targets.push(target); }
    unobserve(target) { this.targets = this.targets.filter((entry) => entry !== target); }
    disconnect() { this.targets = []; }
  }
  class PerformanceObserver {
    static supportedEntryTypes = [];
    observe() {}
    disconnect() {}
  }
  const performance = { now: () => 2000, getEntriesByType: () => [] };
  const window = Object.assign(new Events(), {
    document, location, navigator: { language: 'en', userAgent: 'Analytics test browser', doNotTrack: null },
    localStorage: storage, sessionStorage: storage, performance,
    innerWidth: 1440, innerHeight: 900, scrollY: 0, pageYOffset: 0,
    IntersectionObserver, PerformanceObserver,
    setTimeout: (callback) => { timers.push(callback); return timers.length; },
    clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    requestAnimationFrame: (callback) => { timers.push(callback); return timers.length; },
    cancelAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    ...options.window,
  });
  window.window = window;
  window.self = window;
  if (config !== undefined) window.protocodusAnalyticsConfig = config;
  const context = {
    window, document, location, navigator: window.navigator,
    localStorage: storage, sessionStorage: storage, performance,
    URL, URLSearchParams, IntersectionObserver, PerformanceObserver,
    setTimeout: window.setTimeout, clearTimeout: window.clearTimeout,
    setInterval: window.setInterval, clearInterval: window.clearInterval,
    requestAnimationFrame: window.requestAnimationFrame,
    console, Date, Map, Set, WeakMap, WeakSet,
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; Object.assign(this, init); } },
  };
  options.setup?.({ document, Element });
  const run = () => runInNewContext(source, context, { timeout: 2000 });
  run();
  const commands = () => (window.dataLayer || []).filter((entry) => entry?.[0]).map((entry) => Array.from(entry));
  const gaEvents = (name) => commands().filter((entry) => entry[0] === 'event' && (!name || entry[1] === name));
  const customEvents = (name) => (window.dataLayer || []).filter((entry) => entry?.event && (!name || entry.event === `protocodus.${name}`));
  const click = (target, type = 'click', button = 0) => {
    const event = { type, target, button, defaultPrevented: false };
    document.dispatchEvent(event);
    return event;
  };
  return { window, document, scripts, commands, gaEvents, customEvents, run, click, Element, observers, timers };
}

// Source coverage is part of the behavior: opening any site page directly must work.
function htmlFiles(directory = root) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') || ['assets', 'tests', 'docs', 'tools', 'node_modules'].includes(entry.name)) return [];
    const url = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory);
    return entry.isDirectory() ? htmlFiles(url) : entry.name.endsWith('.html') ? [url] : [];
  });
}
function checkPageCoverage() {
const files = htmlFiles();
assert.equal(files.length, 18, 'All existing public HTML entry points remain covered');
for (const file of files) {
  const html = readFileSync(file, 'utf8');
  const includes = [...html.matchAll(/<script\b[^>]*src=["'][^"']*\/assets\/js\/analytics\.js(?:\?[^"']*)?["'][^>]*>/gi)];
  assert.equal(includes.length, 1, `${file.pathname}: load shared analytics exactly once`);
  assert.match(includes[0][0], /\bdefer\b/, `${file.pathname}: analytics must not block document parsing`);
  assert.doesNotMatch(html, /googletagmanager\.com\/gtag\/js/, `${file.pathname}: avoid an independent duplicate Google loader`);
}
}

const defaultSite = browser();
assert.ok(defaultSite.window.protocodusAnalytics, 'Expose the shared event API');
assert.equal(defaultSite.scripts.filter((script) => script.src.includes('googletagmanager.com/gtag/js')).length, 1, 'Load GA4 once');
assert.equal(defaultSite.scripts.filter((script) => script.src.includes('googletagmanager.com/gtm.js') && script.src.includes('GTM-TZZVDH4B')).length, 1, 'Load the newly created GTM container');
assert.equal(defaultSite.commands().filter(([command, id]) => command === 'config' && id === 'G-0TEFG3XSN5').length, 1, 'Initialize the existing GA property once');
const config = defaultSite.commands().find(([command]) => command === 'config')[2];
assert.equal(config.send_page_view, false, 'Manual page views must disable automatic page views');
assert.equal(defaultSite.gaEvents('page_view').length, 1, 'Send exactly one page view');
assert.equal(defaultSite.gaEvents('page_view')[0][2].page_referrer, '', 'Direct visits retain an empty referrer rather than referring to themselves');
assert.equal(defaultSite.customEvents('page_view').length, 1, 'Expose page views for GTM consumers');
defaultSite.run();
assert.equal(defaultSite.scripts.filter((script) => script.src.includes('googletagmanager.com/gtag/js')).length, 1, 'Including the script twice must not add loaders');
assert.equal(defaultSite.gaEvents('page_view').length, 1, 'Including the script twice must not add page views');

const unsafe = browser('https://protocodus.cz/product/maremba/?email=private%40example.com&token=secret&utm_source=newsletter&utm_medium=email#private-board', undefined, {
  referrer: 'https://search.example/results?q=private%40example.com&utm_campaign=launch#private-fragment',
});
const view = unsafe.gaEvents('page_view')[0][2];
assert.equal(view.page_location, 'https://protocodus.cz/product/maremba/?utm_source=newsletter&utm_medium=email');
assert.equal(view.page_referrer, 'https://search.example/results', 'Referrers omit all query strings');
assert.equal(view.page_type, 'product');
assert.equal(view.product_id, 'maremba');
const serialized = JSON.stringify(unsafe.window.dataLayer);
assert.doesNotMatch(serialized, /private|secret|token=|email=/, 'Payloads must not retain query secrets or arbitrary hashes');

const gtmSite = browser('https://protocodus.cz/', { tagManagerId: 'GTM-ABC123', transport: 'gtm' });
assert.equal(gtmSite.scripts.filter((script) => script.src.includes('googletagmanager.com/gtm.js')).length, 1, 'GTM mode loads the configured container');
assert.equal(gtmSite.scripts.filter((script) => script.src.includes('/gtag/js')).length, 0, 'GTM mode avoids a second GA transport');
assert.equal(gtmSite.gaEvents().length, 0, 'GTM mode must not also dispatch direct GA events');
assert.equal(gtmSite.customEvents('page_view').length, 1, 'GTM receives the same semantic page view');

const local = browser('http://localhost:8000/');
assert.equal(local.scripts.length, 0, 'Local QA must not pollute production GA');
assert.equal(local.gaEvents().length, 0);
const debugLocal = browser('http://localhost:8000/', { debug: true });
assert.equal(debugLocal.gaEvents('page_view').length, 1, 'Explicit debug mode enables local diagnostics');

// The collector must observe intent without intercepting the site's controls.
const links = browser();
function link(href, className = '') {
  const anchor = links.document.body.appendChild(new links.Element('a', { href, class: className }));
  anchor.textContent = 'Open resource';
  return anchor;
}
const shop = link('https://www.reasonstudios.com/shop/rack-extension/maremba/');
const nested = shop.appendChild(new links.Element('span'));
const shopClick = links.click(nested);
assert.equal(links.gaEvents('shop_click').length, 1, 'Nested shop-link content emits shop intent');
assert.equal(links.gaEvents('outbound_click').length, 0, 'Shop intent must not also emit generic outbound intent');
assert.equal(shopClick.defaultPrevented, false, 'Tracking must preserve native navigation');
links.click(shop, 'auxclick', 1);
assert.equal(links.gaEvents('shop_click').length, 2, 'Middle-click navigation is tracked');
links.click(shop, 'auxclick', 2);
assert.equal(links.gaEvents('shop_click').length, 2, 'Context-menu clicks do not imply navigation');
links.click(link('Maremba_User_Guide.pdf?v=20261016-f7&email=privateaddress%40example.com'));
assert.equal(links.gaEvents('file_download').length, 1, 'Guide links are classified as downloads');
links.click(link('mailto:privateaddress@example.com?subject=private-subject'));
assert.equal(links.gaEvents('contact_click').length, 1, 'Mail links are classified as contact intent');
assert.doesNotMatch(JSON.stringify(links.window.dataLayer), /privateaddress|private-subject/, 'Contact and download tracking strips private URL components');
links.click(link('Maremba_Front.png?v=20261016-f7', 'screenshot-link'));
assert.equal(links.gaEvents('screenshot_open').length, 1, 'Full-size product panels are classified as screenshot opens');
links.click(link('https://soundcloud.com/protocodus/sets/maremba-sound-demos-v1'));
assert.equal(links.gaEvents('social_click').length, 1, 'SoundCloud destination is tracked as social engagement');
links.click(link('#rack'));
assert.equal(links.gaEvents('navigation_click').length, 1, 'Section navigation is tracked');
links.click(link('/product/maremba/index.html#rack'));
assert.equal(links.gaEvents('navigation_click').length, 2, 'Index aliases on the current product do not imply a new product selection');
assert.equal(links.gaEvents('select_item').length, 0, 'Same-product section links do not inflate product interest');
const homepage = browser('https://protocodus.cz/');
const productLink = homepage.document.body.appendChild(new homepage.Element('a', { href: '/product/maremba/' }));
homepage.click(productLink);
assert.equal(homepage.gaEvents('select_item').length, 1, 'Navigating from the homepage to a product records product selection');
links.click(link('https://another.example/product/maremba/'));
assert.equal(links.gaEvents('outbound_click').length, 1, 'External routes resembling product pages remain outbound clicks');

const api = links.window.protocodusAnalytics;
const before = links.gaEvents().length;
assert.doesNotThrow(() => api.track('unapproved_event', { email: 'private@example.com' }));
assert.equal(links.gaEvents().length, before, 'Unknown event names are ignored');
assert.doesNotThrow(() => api.track('game_start', {
  game_name: 'zipper', difficulty: 'hard', email: 'private@example.com',
  private_payload: { secret: 'private-value' },
}));
const gameStart = links.gaEvents('game_start').at(-1)?.[2];
assert.ok(gameStart, 'Allowed semantic game events reach GA');
assert.equal(gameStart.difficulty, 'hard');
assert.equal(gameStart.email, undefined, 'Sensitive fields are not accepted');
assert.equal(gameStart.private_payload, undefined, 'Unknown structured fields are not accepted');
assert.doesNotMatch(JSON.stringify(links.window.dataLayer), /private@example.com|private-value/);
const gameLayer = links.customEvents('game_start').at(-1);
assert.equal(gameLayer.analytics.difficulty, 'hard', 'GTM gets the same sanitized semantic payload');
api.track('game_action', { action: 'hint' });
assert.equal(links.customEvents('game_action').at(-1).analytics.difficulty, undefined, 'Each event replaces nested analytics rather than leaking prior event fields');

api.setEnabled(false);
const disabledCount = links.gaEvents().length;
const disabledLayerCount = links.customEvents().length;
api.track('game_start', { game_name: 'zipper' });
links.click(shop);
assert.equal(links.gaEvents().length, disabledCount, 'Disabling analytics suppresses both API and interaction events');
assert.equal(links.customEvents().length, disabledLayerCount, 'Disabled analytics does not send GTM events either');
api.setEnabled(true);
api.track('game_start', { game_name: 'zipper' });
assert.equal(links.gaEvents('game_start').length, 2, 'Tracking can be re-enabled');

const optedOut = browser('https://protocodus.cz/', undefined, { window: { protocodusAnalyticsEnabled: false } });
assert.equal(optedOut.scripts.length, 0, 'An existing analytics opt-out prevents loading Google scripts');
assert.equal(optedOut.customEvents().length, 0, 'An existing analytics opt-out prevents data-layer events');
optedOut.window.protocodusAnalytics.setEnabled(true);
assert.equal(optedOut.window.protocodusAnalytics.isEnabled(), true, 'The public setter overrides an initial disabled state');
assert.equal(optedOut.gaEvents('page_view').length, 1, 'Enabling after startup sends the initial page view once');
assert.equal(optedOut.scripts.filter((script) => script.src.includes('/gtag/js')).length, 1, 'Enabling after startup loads GA');
optedOut.window.protocodusAnalytics.setEnabled(true);
assert.equal(optedOut.gaEvents('page_view').length, 1, 'Repeated enable calls do not duplicate page views');

let unlinkedProduct;
const impressions = browser('https://protocodus.cz/', undefined, {
  setup({ document, Element }) {
    unlinkedProduct = document.body.appendChild(new Element('article', { class: 'product-card p-podcare' }));
  },
});
const cards = impressions.observers.find((observer) => observer.targets.includes(unlinkedProduct));
assert.ok(cards, 'Observe cards without a product-page link');
cards.callback([{ target: unlinkedProduct, isIntersecting: true }]);
assert.equal(impressions.gaEvents('view_item_list').length, 1, 'An unlinked product card still records its impression');
assert.equal(impressions.gaEvents('view_item_list')[0][2].product_id, 'podcare');
cards.callback([{ target: unlinkedProduct, isIntersecting: true }]);
assert.equal(impressions.gaEvents('view_item_list').length, 1, 'Repeated visibility notifications do not duplicate impressions');

const errors = browser();
for (let i = 0; i < 8; i++) errors.window.dispatchEvent({
  type: 'error', filename: 'https://protocodus.cz/assets/js/main.js?token=private-token',
  error: { name: 'TypeError', message: 'Private error message: private@example.com' },
});
assert.equal(errors.gaEvents('exception').length, 5, 'Error reporting has a per-page volume cap');
assert.doesNotMatch(JSON.stringify(errors.window.dataLayer), /private-token|private@example.com|Private error message/, 'Error reports omit messages, stacks, and source query strings');

const broken = browser();
broken.window.dataLayer.push = () => { throw new Error('Analytics transport failed'); };
assert.doesNotThrow(() => broken.window.protocodusAnalytics.track('game_start', { game_name: 'zipper' }), 'Analytics transport failures must not break gameplay');

checkPageCoverage();

console.log('Analytics checks passed: page coverage, initialization, GA/GTM routing, URL privacy, link intent, event isolation, and disabled/failing transports.');
