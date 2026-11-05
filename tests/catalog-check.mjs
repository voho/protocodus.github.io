// Release, media and attribution contracts that must hold without network access.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const catalog = JSON.parse(read('product/STORE_SNAPSHOT.json'));
const media = JSON.parse(read('product/MEDIA.json'));
const home = read('index.html');
const releases = read('product/releases/index.html');
const pages = ['index.html', 'product/releases/index.html', 'product/releases/archive-2026-10-12.html', ...readdirSync(new URL('product/', root), { withFileTypes: true }).filter(e => e.isDirectory() && e.name !== 'releases' && existsSync(new URL(`product/${e.name}/index.html`, root))).map(e => `product/${e.name}/index.html`)];
const decode = text => text.replaceAll('&amp;', '&');
for (const removed of ['clareq', 'electry']) {
  assert.ok(!existsSync(new URL(`product/${removed}/index.html`, root)), `${removed}: removed public product page`);
  assert.ok(!read('sitemap.xml').includes(`/product/${removed}/`), `${removed}: removed from sitemap`);
  assert.ok(!read('assets/js/analytics.js').includes(`'${removed}'`), `${removed}: removed from analytics catalog`);
  for (const file of pages) assert.doesNotMatch(read(file), new RegExp(removed, 'i'), `${file}: removed product still advertised`);
}
const cards = [...home.matchAll(/<article\b[^>]*class="product-card p-([a-z0-9]+)\b/g)].map(m => m[1]);
assert.equal(cards[0], 'rill', 'RILL leads Products');
assert.equal(cards.at(-1), 'podcare', 'Podcare follows all instruments and effects');
assert.ok(home.indexOf('id="fun"') > home.indexOf('p-podcare'), 'Games follow Podcare');
assert.equal((home.match(/id="software"/g) || []).length, 1, 'Software navigation retains a single destination');
for (const product of catalog.products) {
  const html = read(`product/${product.product}/index.html`);
  for (const [label, source] of [['page', html], ['catalog', home.match(new RegExp(`<article[^>]*class="product-card p-${product.product}">[\\s\\S]*?</article>`))?.[0]], ['availability', releases.match(new RegExp(`<tr id="${product.product}"[\\s\\S]*?</tr>`))?.[0]]]) {
    assert.ok(source, `${product.product}: present in ${label}`);
    assert.ok(source.includes(`data-shop-version="${product.version}"`), `${product.product}: ${label} agrees with verified Shop version`);
    assert.ok(source.includes(product.url), `${product.product}: ${label} links to its live Shop listing`);
  }
  const schemas = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap(m => JSON.parse(m[1]));
  const application = schemas.find(s => s['@type'] === 'SoftwareApplication');
  assert.ok(application, `${product.product}: software structured data exists`);
  assert.equal(application.softwareVersion, product.version, `${product.product}: schema uses the published version`);
  for (const asset of product.assets) {
    const data = readFileSync(new URL(asset.file, root));
    assert.equal(createHash('sha256').update(data).digest('hex'), asset.sha256, `${asset.file}: source provenance still matches`);
    if (['front', 'rear'].includes(asset.role)) {
      const panel = html.match(new RegExp(`<a\\b[^>]*data-analytics-cta="${asset.role}_panel"[^>]*>[\\s\\S]*?</a>`))?.[0];
      assert.ok(panel, `${product.product}: ${asset.role} panel is displayed`);
      const image = asset.file.split('/').at(-1) + '?v=' + asset.sha256.slice(0, 12);
      assert.ok(panel.includes(`src="${image}"`) && panel.includes(`href="${image}"`), `${product.product}: displayed and full-size panels both use the verified Shop gallery`);
      assert.ok(panel.includes(`Reason Shop ${product.version}`), `${product.product}: panel caption identifies the published version`);
    }
  }
}
for (const pending of catalog.unpublished) {
  for (const file of pages) assert.ok(!read(file).includes(`href="${pending.checked_url}`), `${file}: no dead purchase link for ${pending.product}`);
}
const expectedVideos = new Set(media.videos.map(v => v.id));
const expectedPlaylists = new Set(media.playlists.map(v => String(v.id)));
const actualVideos = new Set(), actualPlaylists = new Set();
let commerceLinks = 0;
for (const path of pages) {
  const html = read(path);
  for (const [, source] of html.matchAll(/<a\b([^>]+)>/g)) {
    const href = /href="([^"]+)"/.exec(source)?.[1];
    if (!href) continue;
    const url = new URL(decode(href), `https://protocodus.cz/${path.replace('index.html', '')}`);
    if (url.origin === 'https://protocodus.cz') assert.ok(![...url.searchParams.keys()].some(k => k.startsWith('utm_')), `${path}: internal links must not overwrite acquisition`);
    if (url.hostname === 'www.reasonstudios.com' && url.pathname.startsWith('/shop/')) {
      assert.equal(url.searchParams.get('utm_source'), 'protocodus.cz');
      assert.equal(url.searchParams.get('utm_medium'), 'website');
      assert.equal(url.searchParams.get('utm_campaign'), 'rack_extensions');
      assert.equal(url.searchParams.get('utm_content'), /data-analytics-cta="([^"]+)"/.exec(source)?.[1]);
      commerceLinks++;
    }
  }
  for (const [, tag] of html.matchAll(/<iframe\b([^>]+)>/g)) {
    const source = /src="([^"]+)"/.exec(tag)?.[1];
    if (!source) continue;
    const url = new URL(decode(source));
    if (url.hostname.includes('youtube')) {
      assert.equal(url.hostname, 'www.youtube-nocookie.com');
      assert.equal(url.searchParams.get('enablejsapi'), '1');
      assert.equal(url.searchParams.get('origin'), 'https://protocodus.cz');
      assert.equal(url.searchParams.get('autoplay'), null);
      assert.match(tag, /referrerpolicy="strict-origin-when-cross-origin"/);
      const id = url.pathname.split('/').at(-1);
      assert.ok(!actualVideos.has(id), `${id}: embedded only once`);
      actualVideos.add(id);
    }
    if (url.hostname === 'w.soundcloud.com') {
      const collection = new URL(url.searchParams.get('url'));
      assert.match(collection.pathname, /^\/playlists\/\d+$/, `${path}: SoundCloud embeds must be playlists, never individual tracks`);
      assert.equal(url.searchParams.get('auto_play'), 'false');
      const id = collection.pathname.split('/').at(-1);
      assert.ok(!actualPlaylists.has(id), `${id}: playlist embedded only once`);
      actualPlaylists.add(id);
    }
    if (url.hostname.includes('youtube') || url.hostname === 'w.soundcloud.com') {
      assert.match(tag, /loading="lazy"/);
      assert.match(tag, /data-media-id="[a-zA-Z0-9_-]+"/);
      assert.match(tag, /title="[^"]+"/);
    }
  }
}
assert.deepEqual(actualVideos, expectedVideos, 'All verified YouTube uploads are embedded');
assert.deepEqual(actualPlaylists, expectedPlaylists, 'All verified SoundCloud playlists are embedded');
assert.ok(commerceLinks >= catalog.products.length * 3, 'Shop CTAs carry campaign and placement tags');
const rill = read('product/rill/index.html');
const downloads = [...rill.matchAll(/href="(https:\/\/nightly\.link\/protocodus\/rill-daw\/workflows\/ci\/main\/[^"?]+\.zip)"/g)];
assert.equal(downloads.length, 5, 'RILL provides all five rolling platform artifacts');
assert.equal(new Set(downloads.map(m => m[1])).size, 5);
assert.match(rill, /ALPHA/);
assert.match(rill, /unsigned/);
assert.match(rill, /not notarized/);
console.log(`Catalog checks passed: ${catalog.products.length} Shop releases, ${actualVideos.size} videos, ${actualPlaylists.size} playlists, ${commerceLinks} tagged Shop links, RILL first and five alpha downloads.`);
