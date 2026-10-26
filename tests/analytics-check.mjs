// Run with: node tests/analytics-check.mjs
// These browser-free checks exercise outbound analytics without contacting Google.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { browser } from './helpers/analytics-harness.mjs';

const root = new URL('../', import.meta.url);

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
  assert.ok(files.length >= 18, 'Discover all existing public HTML entry points and any new pages');
  for (const file of files) {
    const html = readFileSync(file, 'utf8');
    const includes = [...html.matchAll(/<script\b[^>]*src=["'][^"']*\/assets\/js\/analytics\.js(?:\?[^"']*)?["'][^>]*>/gi)];
    assert.equal(includes.length, 1, `${file.pathname}: load shared analytics exactly once`);
    assert.match(includes[0][0], /\bdefer\b/, `${file.pathname}: analytics must not block document parsing`);
    assert.match(includes[0][0], /src=["']\/assets\/js\/analytics\.js["']/, `${file.pathname}: the stable entry point keeps helper versions centralized`);
    assert.doesNotMatch(html, /<script\b[^>]*src=["'][^"']*analytics-(?:media|performance)\.js/i, `${file.pathname}: the shared entry point owns helper loading`);
    assert.doesNotMatch(html, /googletagmanager\.com\/gtag\/js/, `${file.pathname}: avoid an independent duplicate Google loader`);
    const fallbacks = [...html.matchAll(/<iframe\b[^>]*src=["']https:\/\/www\.googletagmanager\.com\/ns\.html\?id=([^"'&]+)["'][^>]*>/gi)];
    assert.equal(fallbacks.length, 1, `${file.pathname}: retain one no-JavaScript GTM fallback`);
    assert.equal(fallbacks[0][1], 'GTM-TZZVDH4B', `${file.pathname}: the fallback must use the real container ID`);
  }
}

const defaultSite = browser();
assert.ok(defaultSite.window.protocodusAnalytics, 'Expose the shared event API');
assert.equal(defaultSite.scripts.filter((script) => new URL(script.src).pathname.endsWith('/analytics-performance.js')).length, 1, 'Enabled analytics loads performance reporting centrally');
assert.equal(defaultSite.scripts.filter((script) => new URL(script.src).pathname.endsWith('/analytics-media.js')).length, 0, 'Pages without media skip the media helper');
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
assert.equal(defaultSite.scripts.filter((script) => new URL(script.src).pathname.endsWith('/analytics-performance.js')).length, 1, 'Including the entry point twice does not duplicate helper requests');

const diagnostics = defaultSite.window.protocodusAnalytics.status();
assert.equal(diagnostics.enabled, true);
assert.equal(diagnostics.transport, 'gtag');
assert.equal(diagnostics.measurementId, 'G-0TEFG3XSN5');
assert.equal(diagnostics.tagManagerId, 'GTM-TZZVDH4B');
assert.equal(diagnostics.page.page_type, 'product');
assert.equal(diagnostics.page.product_id, 'maremba');
assert.equal(diagnostics.events.page_view, 1, 'Diagnostics count one explicit page view');
assert.equal(diagnostics.scripts.ga4, 'requested');
assert.equal(diagnostics.scripts.gtm, 'requested');
assert.equal(diagnostics.scripts.performance, 'requested');
assert.equal(diagnostics.scripts.media, undefined, 'Diagnostics distinguish unneeded helpers from requested ones');
const gaScript = defaultSite.scripts.find((script) => script.src.includes('/gtag/js'));
const tagScript = defaultSite.scripts.find((script) => script.src.includes('/gtm.js'));
gaScript.dispatchEvent({ type: 'load' });
tagScript.dispatchEvent({ type: 'error' });
assert.equal(defaultSite.window.protocodusAnalytics.status().scripts.ga4, 'loaded', 'Successful loader completion is visible in diagnostics');
assert.equal(defaultSite.window.protocodusAnalytics.status().scripts.gtm, 'failed', 'Failed GTM loading is visible in diagnostics');
defaultSite.window.protocodusAnalytics.track('game_action', { action: 'hint' });
assert.equal(defaultSite.gaEvents('game_action').length, 1, 'A failed script does not stop generating analytics events');
assert.equal(defaultSite.window.protocodusAnalytics.status().events.game_action, 1);
assert.equal(defaultSite.scripts.filter((script) => script.src.includes('/gtm.js')).length, 1, 'A failed optional loader is not retried on every event');

const helpers = browser('https://protocodus.cz/product/lamer/', undefined, {
  scriptSrc: 'https://static.example.test/site-assets/analytics.js?cache=custom',
  setup({ document, Element }) { document.body.appendChild(new Element('video')); },
});
const mediaHelper = helpers.scripts.find((script) => new URL(script.src).pathname.endsWith('/analytics-media.js'));
const performanceHelper = helpers.scripts.find((script) => new URL(script.src).pathname.endsWith('/analytics-performance.js'));
assert.ok(mediaHelper, 'A native media element causes the media helper to load');
assert.equal(new URL(mediaHelper.src).origin, 'https://static.example.test');
assert.equal(new URL(mediaHelper.src).pathname, '/site-assets/analytics-media.js', 'Helper URLs are relative to the entry script rather than the current product route');
assert.equal(new URL(performanceHelper.src).pathname, '/site-assets/analytics-performance.js');
assert.ok(new URL(mediaHelper.src).searchParams.get('v'), 'The entry point applies the centrally maintained helper version');
mediaHelper.dispatchEvent({ type: 'error' });
performanceHelper.dispatchEvent({ type: 'load' });
assert.equal(helpers.window.protocodusAnalytics.status().scripts.media, 'failed');
assert.equal(helpers.window.protocodusAnalytics.status().scripts.performance, 'loaded');
assert.equal(helpers.gaEvents('page_view').length, 1, 'Optional helper failure does not lose the page view');
helpers.run();
assert.equal(helpers.scripts.filter((script) => new URL(script.src).pathname.endsWith('/analytics-media.js')).length, 1, 'Duplicate entry includes do not duplicate media requests');
const soundCloudPage = browser('https://protocodus.cz/product/youknow/', undefined, {
  setup({ document, Element }) { document.body.appendChild(new Element('iframe', { class: 'soundcloud-player' })); },
});
assert.equal(soundCloudPage.scripts.filter((script) => new URL(script.src).pathname.endsWith('/analytics-media.js')).length, 1, 'SoundCloud widgets also enable the shared media helper');

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
assert.equal(api.status().events.unapproved_event, undefined, 'Unknown names are not counted in diagnostics');
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
const disabledDiagnosticCounts = JSON.stringify(api.status().events);
api.track('game_start', { game_name: 'zipper' });
links.click(shop);
assert.equal(links.gaEvents().length, disabledCount, 'Disabling analytics suppresses both API and interaction events');
assert.equal(links.customEvents().length, disabledLayerCount, 'Disabled analytics does not send GTM events either');
assert.equal(JSON.stringify(api.status().events), disabledDiagnosticCounts, 'Disabled calls do not inflate diagnostic event counts');
assert.equal(api.status().enabled, false);
api.setEnabled(true);
api.track('game_start', { game_name: 'zipper' });
assert.equal(links.gaEvents('game_start').length, 2, 'Tracking can be re-enabled');

const optedOut = browser('https://protocodus.cz/', undefined, { window: { protocodusAnalyticsEnabled: false } });
assert.equal(optedOut.scripts.length, 0, 'An existing analytics opt-out prevents loading Google scripts');
assert.equal(optedOut.customEvents().length, 0, 'An existing analytics opt-out prevents data-layer events');
assert.equal(Object.keys(optedOut.window.protocodusAnalytics.status().scripts).length, 0, 'Disabled startup does not request Google scripts or local helpers');
optedOut.window.protocodusAnalytics.setEnabled(true);
assert.equal(optedOut.window.protocodusAnalytics.isEnabled(), true, 'The public setter overrides an initial disabled state');
assert.equal(optedOut.gaEvents('page_view').length, 1, 'Enabling after startup sends the initial page view once');
assert.equal(optedOut.scripts.filter((script) => script.src.includes('/gtag/js')).length, 1, 'Enabling after startup loads GA');
assert.equal(optedOut.scripts.filter((script) => new URL(script.src).pathname.endsWith('/analytics-performance.js')).length, 1, 'Enabling after startup loads the central helper too');
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

let contactFooter, contactMail, contactNavigation, arbitraryAnchor;
const footerPage = browser('https://protocodus.cz/', undefined, {
  setup({ document, Element }) {
    contactFooter = document.body.appendChild(new Element('footer', { id: 'contact' }));
    contactMail = contactFooter.appendChild(new Element('a', { href: 'mailto:private-footer@example.com?subject=private-topic' }));
    contactNavigation = document.body.appendChild(new Element('a', { href: '#contact' }));
    const unrelated = document.body.appendChild(new Element('div', { id: 'untracked-fragment' }));
    unrelated.textContent = 'This is not an authored section';
    arbitraryAnchor = document.body.appendChild(new Element('a', { href: '#untracked-fragment' }));
  },
});
footerPage.click(contactMail);
assert.equal(footerPage.gaEvents('contact_click')[0][2].section_id, 'contact', 'Contact links retain their footer source section');
footerPage.click(contactNavigation);
assert.equal(footerPage.gaEvents('navigation_click')[0][2].section_id, 'contact', 'A known contact footer is an allowed same-page navigation target');
footerPage.click(arbitraryAnchor);
assert.equal(footerPage.gaEvents('navigation_click').at(-1)[2].section_id, '', 'Arbitrary fragment targets do not become analytics sections');
const footerObserver = footerPage.observers.find((observer) => observer.targets.includes(contactFooter));
assert.ok(footerObserver, 'Observe the authored contact footer for visibility');
footerObserver.callback([{ target: contactFooter, isIntersecting: true }]);
footerObserver.callback([{ target: contactFooter, isIntersecting: true }]);
assert.equal(footerPage.gaEvents('section_view').length, 1, 'Repeated visibility notifications record the footer once');
assert.equal(footerPage.gaEvents('section_view')[0][2].section_id, 'contact');
assert.doesNotMatch(JSON.stringify(footerPage.window.dataLayer), /private-footer|private-topic|untracked-fragment/, 'Footer tracking preserves contact and fragment privacy');

const rejections = browser();
rejections.window.dispatchEvent({ type: 'unhandledrejection', reason: {
  name: 'TypeError', message: 'private-rejection-message', stack: 'private-rejection-stack',
} });
assert.equal(rejections.gaEvents('exception')[0][2].error_type, 'TypeError', 'Recognized rejection error names retain their category');
assert.equal(rejections.gaEvents('exception')[0][2].action, 'unhandled_rejection');
rejections.window.dispatchEvent({ type: 'unhandledrejection', reason: 'private-raw-rejection' });
rejections.window.dispatchEvent({ type: 'unhandledrejection', reason: {
  name: 'PrivateCustomError', message: 'private-custom-message', stack: 'private-custom-stack',
} });
assert.deepEqual(Array.from(rejections.gaEvents('exception').slice(1), (entry) => entry[2].error_type), ['unhandled_rejection', 'unhandled_rejection'], 'Unknown names and free strings use the fixed rejection category');
assert.doesNotMatch(JSON.stringify(rejections.window.dataLayer), /private-rejection|private-raw|PrivateCustomError|private-custom/, 'Rejections never collect arbitrary names, reasons, messages, or stacks');

const mixedErrors = browser();
for (let i = 0; i < 3; i++) mixedErrors.window.dispatchEvent({ type: 'error', filename: 'https://protocodus.cz/assets/js/main.js', error: { name: 'TypeError' } });
for (let i = 0; i < 4; i++) mixedErrors.window.dispatchEvent({ type: 'unhandledrejection', reason: { name: 'RangeError' } });
mixedErrors.window.dispatchEvent({ type: 'error', filename: 'https://protocodus.cz/assets/js/main.js', error: { name: 'ReferenceError' } });
assert.equal(mixedErrors.gaEvents('exception').length, 5, 'Runtime errors and promise rejections share one five-event page cap');
assert.deepEqual(Array.from(mixedErrors.gaEvents('exception'), (entry) => entry[2].error_type), ['TypeError', 'TypeError', 'TypeError', 'RangeError', 'RangeError']);

const disabledErrors = browser();
disabledErrors.window.protocodusAnalytics.setEnabled(false);
for (let i = 0; i < 8; i++) disabledErrors.window.dispatchEvent({ type: 'unhandledrejection', reason: { name: 'AbortError', message: 'private-disabled' } });
assert.equal(disabledErrors.gaEvents('exception').length, 0, 'Disabled analytics sends no rejection event');
assert.equal(disabledErrors.customEvents('exception').length, 0, 'Disabled analytics sends no GTM rejection event');
assert.equal(disabledErrors.window.protocodusAnalytics.status().events.exception, undefined, 'Disabled rejections do not increment diagnostics');
disabledErrors.window.protocodusAnalytics.setEnabled(true);
for (let i = 0; i < 6; i++) disabledErrors.window.dispatchEvent({ type: 'unhandledrejection', reason: { name: 'AbortError' } });
assert.equal(disabledErrors.gaEvents('exception').length, 5, 'Disabled rejections do not consume the later enabled error budget');

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
