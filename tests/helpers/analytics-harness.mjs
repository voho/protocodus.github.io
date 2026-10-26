// Shared browser-free DOM harness for analytics behavior tests.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const root = new URL('../../', import.meta.url);
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
    if (typeof this[`on${event.type}`] === 'function') this[`on${event.type}`](event);
    return !event.defaultPrevented;
  }
}

export function browser(href = 'https://protocodus.cz/product/maremba/', config, options = {}) {
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
  document.currentScript = new Element('script', { src: options.scriptSrc || 'https://protocodus.cz/assets/js/analytics.js' });
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

