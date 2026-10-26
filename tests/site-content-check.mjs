// Run with: node tests/site-content-check.mjs
// Check the published HTML source without requesting external websites.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const origin = 'https://protocodus.cz';
const contactEmail = 'protocodus@proton.me';
const excluded = new Set(['assets', 'tests', 'docs', 'tools', 'node_modules']);
function publicHtml(directory = root) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') || excluded.has(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? publicHtml(path) : entry.name.endsWith('.html') ? [path] : [];
  });
}
function decodeEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(entity[1].toLowerCase() === 'x' ? 2 : 1), entity[1].toLowerCase() === 'x' ? 16 : 10));
    return named[entity.toLowerCase()];
  });
}
function attributes(source) {
  const values = {};
  for (const [, name, doubleQuoted, singleQuoted, unquoted] of source.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    values[name.toLowerCase()] = decodeEntities(doubleQuoted ?? singleQuoted ?? unquoted ?? '');
  }
  return values;
}
function parse(path) {
  const html = readFileSync(path, 'utf8');
  const schemas = [];
  // Script contents may contain HTML strings and comparison operators. They are
  // not document elements; keep only their opening tags for source references.
  const markup = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/\1\s*>/gi, (_, tag, source, body) => {
    if (tag.toLowerCase() === 'script' && attributes(source).type === 'application/ld+json') {
      assert.doesNotThrow(() => schemas.push(JSON.parse(body)), `${relative(root, path)}: structured data must be valid JSON`);
    }
    return `<${tag}${source}></${tag}>`;
  });
  const tags = [...markup.matchAll(/<([a-z][\w:-]*)\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>/gi)].map(([, name, source]) => ({ name: name.toLowerCase(), attrs: attributes(source) }));
  const ids = new Set();
  for (const { attrs } of tags) {
    if (!attrs.id) continue;
    assert.ok(!ids.has(attrs.id), `${relative(root, path)}: duplicate document ID ${attrs.id}`);
    ids.add(attrs.id);
  }
  const route = '/' + relative(root, path).split('\\').join('/').replace(/index\.html$/, '');
  return { path, html, markup, tags, ids, schemas, url: origin + route };
}
const pages = new Map(publicHtml().map((path) => [path, parse(path)]));
assert.ok(pages.size >= 18, 'Discover every existing public page and any newly added pages');
let checkedReferences = 0, checkedMailLinks = 0;
function checkReference(page, value, description) {
  let url;
  assert.doesNotThrow(() => { url = new URL(value, page.url); }, `${relative(root, page.path)}: invalid ${description} URL ${value}`);
  if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) return;
  let pathname;
  assert.doesNotThrow(() => { pathname = decodeURIComponent(url.pathname); }, `${relative(root, page.path)}: malformed URL encoding in ${value}`);
  let target = resolve(root, '.' + pathname);
  assert.ok(target === resolve(root) || target.startsWith(resolve(root) + '/'), `${relative(root, page.path)}: reference escapes the website root`);
  assert.ok(existsSync(target), `${relative(root, page.path)}: missing internal ${description} ${value}`);
  if (statSync(target).isDirectory()) target = join(target, 'index.html');
  assert.ok(existsSync(target) && statSync(target).isFile(), `${relative(root, page.path)}: ${value} does not resolve to a published file`);
  checkedReferences++;
  if (url.hash && extname(target) === '.html') {
    let fragment;
    assert.doesNotThrow(() => { fragment = decodeURIComponent(url.hash.slice(1)); }, `${relative(root, page.path)}: malformed fragment in ${value}`);
    const destination = pages.get(target);
    assert.ok(destination, `${relative(root, page.path)}: linked HTML page is outside the checked public pages: ${value}`);
    assert.ok(destination.ids.has(fragment), `${relative(root, page.path)}: missing anchor ${value}`);
  }
}
for (const page of pages.values()) {
  const label = relative(root, page.path);
  const canonical = page.tags.filter(({ name, attrs }) => name === 'link' && attrs.rel?.split(/\s+/).includes('canonical'));
  const openGraphUrl = page.tags.filter(({ name, attrs }) => name === 'meta' && attrs.property === 'og:url');
  assert.equal(canonical.length, 1, `${label}: declare one canonical page URL`);
  assert.equal(canonical[0].attrs.href, page.url, `${label}: canonical URL must identify this page`);
  assert.equal(openGraphUrl.length, 1, `${label}: declare one Open Graph page URL`);
  assert.equal(openGraphUrl[0].attrs.content, page.url, `${label}: Open Graph URL must match the canonical route`);
  for (const { name, attrs } of page.tags) {
    for (const key of ['href', 'src', 'poster']) if (attrs[key]) checkReference(page, attrs[key], `${name} ${key}`);
    if (name === 'meta' && ['og:image', 'twitter:image'].includes(attrs.property || attrs.name)) checkReference(page, attrs.content, 'social image');
    if (attrs.srcset) {
      for (const candidate of attrs.srcset.split(',')) {
        const value = candidate.trim().split(/\s+/)[0];
        if (value && !value.startsWith('data:')) checkReference(page, value, 'srcset image');
      }
    }
  }
  for (const [, source, content] of page.markup.matchAll(/<a\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/a\s*>/gi)) {
    const href = attributes(source).href;
    if (!href?.toLowerCase().startsWith('mailto:')) continue;
    const recipient = decodeURIComponent(href.slice(7).split('?')[0]).toLowerCase();
    assert.equal(recipient, contactEmail, `${label}: contact links must use the shared support address`);
    const visible = decodeEntities(content.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const displayedEmails = visible.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
    for (const email of displayedEmails) assert.equal(email.toLowerCase(), recipient, `${label}: displayed email must match its mailto recipient`);
    checkedMailLinks++;
  }
  function checkSchema(value, primary = false) {
    if (Array.isArray(value)) return value.forEach((child) => checkSchema(child, primary));
    if (!value || typeof value !== 'object') return;
    if (primary && ['SoftwareApplication', 'WebPage', 'Product'].includes(value['@type']) && typeof value.url === 'string' && new URL(value.url, page.url).origin === origin) {
      assert.equal(value.url, page.url, `${label}: structured page/product URL must match its canonical route`);
    }
    if (typeof value.image === 'string') checkReference(page, value.image, 'structured image');
    Object.values(value).forEach((child) => { if (child && typeof child === 'object') checkSchema(child); });
  }
  page.schemas.forEach((schema) => checkSchema(schema, true));
}
assert.ok(checkedMailLinks > 0, 'Validate actual website contact links');
console.log(`Site content checks passed: ${pages.size} pages, ${checkedReferences} internal references, shared support address, anchors, IDs, canonical/social URLs, and structured data.`);
