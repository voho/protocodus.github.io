// Run with: node tests/product-cta-check.mjs
// Exercise the actual product markup and shared analytics without Google calls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { browser } from './helpers/analytics-harness.mjs';

const root = new URL('../', import.meta.url);
const products = ['youknow', 'maremba', 'acustra', 'electry', 'ceres', 'press78', 'lamer'];
const fixedId = /^[a-z][a-z0-9_]*$/;
const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

// A small markup reader builds real parent/child relationships in the shared
// fake DOM, so coverage and click tests use authored links and nested content.
function parseBody(html, { document, Element }) {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html;
  const clean = body.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const stack = [document.body];
  for (const match of clean.matchAll(/<(\/?)([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const [, closing, rawTag, rawAttributes] = match;
    const tag = rawTag.toLowerCase();
    if (closing) {
      const index = stack.findLastIndex(element => element.tagName.toLowerCase() === tag);
      if (index > 0) stack.length = index;
      continue;
    }
    const attributes = {};
    for (const [, name, double, single, unquoted] of rawAttributes.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      attributes[name] = (double ?? single ?? unquoted ?? '').replaceAll('&amp;', '&');
    }
    const element = stack.at(-1).appendChild(new Element(tag, attributes));
    if (!voidTags.has(tag) && !rawAttributes.trim().endsWith('/')) stack.push(element);
  }
}

let covered = 0, chapters = 0;
for (const relative of [...products.map(product => `product/${product}/index.html`), 'product/releases/index.html', 'product/releases/archive-2026-10-12.html', 'index.html']) {
  const html = readFileSync(new URL(relative, root), 'utf8');
  const href = 'https://protocodus.cz/' + relative.replace(/index\.html$/, '');
  const page = browser(href, undefined, { setup: dom => parseBody(html, dom) });
  const main = page.document.querySelector('main');
  assert.ok(main, `${relative}: the public page has main content`);
  const anchors = relative === 'index.html'
    ? page.document.querySelectorAll('.product-card').flatMap(card => card.querySelectorAll('a[href]'))
    : main.querySelectorAll('a[href]').filter(anchor => anchor.href !== 'https://soundcloud.com/protocodus');
  assert.ok(anchors.length > 0, `${relative}: discover important product links`);
  const ids = new Set();
  for (const anchor of anchors) {
    const id = anchor.dataset.analyticsCta;
    assert.match(id || '', fixedId, `${relative}: ${anchor.getAttribute('href')} needs a fixed CTA id`);
    assert.match(anchor.dataset.analyticsAction || '', fixedId, `${relative}: ${id} needs a fixed semantic action`);
    assert.ok(!ids.has(id), `${relative}: ${id} must distinguish this placement`);
    ids.add(id);
    const before = page.gaEvents().length;
    const layerBefore = page.customEvents().length;
    const event = page.click(anchor.children[0] || anchor);
    assert.equal(page.gaEvents().length, before + 1, `${relative}: ${id} produces one primary GA event`);
    assert.equal(page.customEvents().length, layerBefore + 1, `${relative}: ${id} produces one primary GTM event`);
    const payload = page.gaEvents().at(-1)[2];
    assert.equal(payload.cta_id, id);
    assert.equal(payload.action, anchor.dataset.analyticsAction);
    assert.ok(payload.cta_location, `${relative}: ${id} retains its source placement`);
    assert.equal(event.defaultPrevented, false, `${relative}: ${id} preserves native navigation`);
    covered++;
  }
  for (const button of main.querySelectorAll('button[data-start]')) {
    assert.match(button.dataset.analyticsCta || '', fixedId, `${relative}: chapter buttons need fixed ids`);
    assert.equal(button.dataset.analyticsAction, 'play_chapter');
    const before = page.gaEvents().length;
    const event = page.click(button.children[0] || button);
    assert.equal(page.gaEvents().length, before + 1, `${relative}: chapter choice has one event`);
    const command = page.gaEvents().at(-1);
    assert.equal(command[1], 'ui_action');
    assert.equal(command[2].cta_id, button.dataset.analyticsCta);
    assert.equal(command[2].chapter_seconds, Number(button.dataset.start));
    assert.equal(event.defaultPrevented, false);
    chapters++;
  }
  if (products.some(product => relative === `product/${product}/index.html`)) {
    const mobileContact = page.document.querySelector('.mobile-menu')?.querySelector('a.mobile-mail');
    assert.ok(mobileContact, `${relative}: mobile support link exists`);
    assert.equal(mobileContact.dataset.analyticsCta, 'mobile_support');
    assert.equal(mobileContact.dataset.analyticsAction, 'contact_support');
    const before = page.gaEvents().length;
    page.click(mobileContact);
    assert.equal(page.gaEvents().length, before + 1);
    const command = page.gaEvents().at(-1);
    assert.equal(command[1], 'contact_click');
    assert.equal(command[2].cta_location, 'mobile_menu', 'Mobile support retains its source rather than a page section');
    assert.equal(command[2].link_url, undefined, 'Mobile support does not send an email URL');
    covered++;
  }
}
assert.ok(covered >= 90, 'Cover the existing product calls to action across the site');
assert.equal(chapters, 4, 'Cover all four authored Lamer demo chapters');

const page = browser('https://protocodus.cz/product/maremba/');
const add = (tag, attrs = {}, parent = page.document.body) => parent.appendChild(new page.Element(tag, attrs));
const hero = add('section', { id: 'top' });
const demo = add('section', { id: 'listen' });
const support = add('section', { id: 'support' });
const markedLink = (href, cta, action, parent = hero, attrs = {}) => add('a', {
  href, 'data-analytics-cta': cta, 'data-analytics-action': action, ...attrs,
}, parent);
for (const [url, id, action, expected, parent, attrs] of [
  ['https://www.reasonstudios.com/shop/rack-extension/maremba/?email=privateaddress%40example.com', 'hero_shop', 'open_shop', 'shop_click'],
  ['Maremba_User_Guide.pdf?token=private-token', 'player_guide', 'download_guide', 'file_download'],
  ['mailto:privateaddress@example.com?subject=private-topic', 'support_email', 'contact_support', 'contact_click', support],
  ['#listen', 'hero_listen', 'listen_demo', 'navigation_click'],
  ['https://soundcloud.com/protocodus/sets/maremba?email=privateaddress%40example.com', 'listen_playlist', 'listen_demo', 'social_click', demo],
  ['Maremba_Front.png?token=private-token', 'front_panel', 'view_screenshot', 'screenshot_open', hero, { class: 'screenshot-link' }],
  ['https://github.com/protocodus/virtual-instrument-maremba#downloads', 'native_downloads', 'download_native', 'outbound_click'],
]) {
  const anchor = markedLink(url, id, action, parent, attrs);
  const nested = add('strong', {}, anchor);
  const before = page.gaEvents().length;
  const event = page.click(nested);
  const command = page.gaEvents().at(-1);
  assert.equal(page.gaEvents().length, before + 1, `${id} does not create an extra generic CTA event`);
  assert.equal(command[1], expected);
  assert.equal(command[2].cta_id, id);
  assert.equal(command[2].action, action);
  assert.equal(command[2].cta_location, parent?.id || 'top');
  assert.equal(event.defaultPrevented, false);
}
const navigation = page.gaEvents('navigation_click').at(-1)[2];
assert.equal(navigation.section_id, 'listen', 'Section navigation retains its target');
assert.equal(navigation.cta_location, 'top', 'CTA placement retains the source rather than target section');
assert.doesNotMatch(JSON.stringify(page.window.dataLayer), /privateaddress|private-topic|private-token|email=|token=/, 'CTAs never include email addresses, subjects or URL secrets');

const keyboardLink = markedLink('Maremba_User_Guide.pdf', 'keyboard_guide', 'download_guide');
const keyboardBefore = page.gaEvents('file_download').length;
const keyboardEvent = { type: 'click', target: keyboardLink, button: 0, detail: 0, defaultPrevented: false };
page.document.dispatchEvent(keyboardEvent);
assert.equal(page.gaEvents('file_download').length, keyboardBefore + 1, 'Native keyboard-generated clicks are tracked once');
assert.equal(keyboardEvent.defaultPrevented, false);

const homepage = browser('https://protocodus.cz/');
const productCard = homepage.document.body.appendChild(new homepage.Element('article', { class: 'product-card p-maremba' }));
const selection = productCard.appendChild(new homepage.Element('a', {
  href: '/product/maremba/', 'data-analytics-cta': 'product_maremba_details', 'data-analytics-action': 'select_product',
}));
homepage.click(selection);
assert.equal(homepage.gaEvents('select_item').length, 1, 'Marked product cards preserve the select-item semantic event');
assert.equal(homepage.gaEvents('select_item')[0][2].cta_location, 'product_card', 'Cards without an enclosing section have a fixed placement');
for (const [tag, attrs, expected] of [['header', {}, 'header'], ['footer', {}, 'footer'], ['div', {}, 'content']]) {
  const parent = add(tag, attrs);
  const anchor = markedLink('/product/releases/', `location_${expected}`, 'view_details', parent);
  page.click(anchor);
  assert.equal(page.gaEvents().at(-1)[2].cta_location, expected, 'Unsectioned controls use fixed source placements');
}

const unmarked = add('a', { href: '/product/releases/' }, hero);
page.click(unmarked);
assert.equal(page.gaEvents().at(-1)[2].cta_id, undefined, 'Ordinary links remain trackable without invented CTA ids');

const chapterGroup = add('div', { class: 'lamer-chapters' }, demo);
const chapter = add('button', { 'data-analytics-cta': 'chapter_24', 'data-analytics-action': 'play_chapter', 'data-start': '24' }, chapterGroup);
const chapterLabel = add('span', {}, chapter);
const buttonBefore = page.gaEvents('ui_action').length;
page.click(chapterLabel);
assert.equal(page.gaEvents('ui_action').length, buttonBefore + 1);
assert.equal(page.gaEvents('ui_action').at(-1)[2].chapter_seconds, 24);
chapter.disabled = true;
page.click(chapterLabel);
assert.equal(page.gaEvents('ui_action').length, buttonBefore + 1, 'Disabled chapter controls do not report intent');
chapter.disabled = false;
chapterGroup.setAttribute('data-analytics-ignore', '');
page.click(chapterLabel);
assert.equal(page.gaEvents('ui_action').length, buttonBefore + 1, 'Ignored control subtrees do not report intent');
const ignored = add('div', { 'data-analytics-ignore': '' });
page.click(markedLink('https://www.reasonstudios.com/shop/rack-extension/maremba/', 'ignored_shop', 'open_shop', ignored));
assert.equal(page.gaEvents('shop_click').length, 1, 'Ignored links do not report intent');

const invalidChapter = add('button', { 'data-analytics-cta': 'chapter_invalid', 'data-analytics-action': 'play_chapter', 'data-start': '-1' }, add('div', { class: 'lamer-chapters' }, demo));
page.click(invalidChapter);
assert.equal(page.gaEvents('ui_action').at(-1)[2].chapter_seconds, undefined, 'Negative chapter offsets are omitted');
invalidChapter.setAttribute('data-start', 'private text');
page.click(invalidChapter);
assert.equal(page.gaEvents('ui_action').at(-1)[2].chapter_seconds, undefined, 'Non-numeric chapter offsets are omitted');

const beforeDisabled = page.gaEvents().length;
page.window.protocodusAnalytics.setEnabled(false);
page.click(keyboardLink);
page.click(chapter);
assert.equal(page.gaEvents().length, beforeDisabled, 'Disabling analytics suppresses CTA links and buttons');

console.log(`Product CTA checks passed: ${covered} authored links, ${chapters} chapters, one semantic event per action, nested/keyboard clicks, placement, privacy and disabled controls.`);
