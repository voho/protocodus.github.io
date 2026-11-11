// Release, media and attribution contracts that must hold without network access.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const catalog = JSON.parse(read('product/STORE_SNAPSHOT.json'));
const media = JSON.parse(read('product/MEDIA.json'));
const home = read('index.html');
const pages = ['index.html', ...readdirSync(new URL('product/', root), { withFileTypes: true }).filter(e => e.isDirectory() && existsSync(new URL(`product/${e.name}/index.html`, root))).map(e => `product/${e.name}/index.html`)];
const decode = text => text.replaceAll('&amp;', '&');
const cards = [...home.matchAll(/<article\b[^>]*class="product-card p-([a-z0-9]+)\b/g)].map(m => m[1]);
assert.equal(cards[0], 'rill', 'RILL leads Products');
assert.equal(cards.at(-1), 'podcare', 'Podcare follows all instruments and effects');
assert.ok(home.indexOf('id="fun"') > home.indexOf('p-podcare'), 'Games follow Podcare');
assert.equal((home.match(/id="software"/g) || []).length, 1, 'Software navigation retains a single destination');
for (const product of catalog.products) {
  const html = read(`product/${product.product}/index.html`);
  const card = home.match(new RegExp(`<article[^>]*class="product-card p-${product.product}">[\\s\\S]*?</article>`))?.[0];
  for (const [label, source] of [['page', html], ['catalog', card]]) {
    assert.ok(source, `${product.product}: present in ${label}`);
    assert.ok(source.includes(`data-shop-version="${product.version}"`), `${product.product}: ${label} agrees with verified Shop version`);
    assert.ok(source.includes(product.url), `${product.product}: ${label} links to its live Shop listing`);
  }
  const facts = card.match(/<p class="product-facts">([\s\S]*?)<\/p>/)?.[1];
  assert.ok(facts?.includes(product.version), `${product.product}: visible catalog facts include the published version`);
  assert.doesNotMatch(facts, /in development|coming soon|awaiting/i, `${product.product}: published products are not labelled unreleased`);
  const schemas = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap(m => JSON.parse(m[1]));
  const application = schemas.find(s => s['@type'] === 'SoftwareApplication');
  assert.ok(application, `${product.product}: software structured data exists`);
  assert.equal(application.softwareVersion, product.version, `${product.product}: schema uses the published version`);
  const provenance = JSON.parse(read(`product/${product.product}/ASSET_PROVENANCE.json`));
  const socialUrl = html.match(/<meta property="og:image" content="([^"]+)">/)?.[1];
  assert.equal(application.image, socialUrl, `${product.product}: structured data and social sharing use the same current cover`);
  assert.ok(html.includes(`<meta name="twitter:image" content="${socialUrl}">`), `${product.product}: social cover metadata agrees`);
  // A documented website cover refresh can precede approval of its Shop artwork.
  const coverSources = product.assets.filter(asset => asset.role === 'social');
  if (provenance.shop_cover_refresh) coverSources.push({ ...provenance.shop_cover_refresh, file: `product/${product.product}/${provenance.shop_cover_refresh.file}` });
  const socialCover = coverSources.find(asset => socialUrl === `https://protocodus.cz/${asset.file}?v=${asset.sha256.slice(0, 12)}`);
  assert.ok(socialCover, `${product.product}: social cover is either verified Shop artwork or a documented website refresh`);
  assert.equal(createHash('sha256').update(readFileSync(new URL(socialCover.file, root))).digest('hex'), socialCover.sha256, `${product.product}: social cover matches its recorded source`);
  assert.equal(provenance.availability, 'published', `${product.product}: provenance identifies a public release`);
  assert.equal(provenance.public_release.version, product.version, `${product.product}: release provenance matches the catalog`);
  assert.equal(provenance.public_release.accepted_version, product.accepted_version, `${product.product}: accepted device version is recorded consistently`);
  assert.equal(product.accepted_version.replace(/[dbf]\d+$/, ''), product.version, `${product.product}: public version corresponds to the accepted device`);
  assert.equal(provenance.current_shop_gallery.version, product.version, `${product.product}: artwork provenance identifies the public release`);
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
  const card = home.match(new RegExp(`<article[^>]*class="product-card p-${pending.product}">[\\s\\S]*?</article>`))?.[0];
  assert.match(card, /Awaiting Shop publication/, `${pending.product}: visible catalog status remains unpublished`);
  const html = read(`product/${pending.product}/index.html`);
  const provenance = JSON.parse(read(`product/${pending.product}/ASSET_PROVENANCE.json`));
  assert.equal(provenance.availability, pending.status, `${pending.product}: provenance matches the pending approval stage`);
  assert.deepEqual(provenance.publication_check, { checked_on: catalog.verified_at, ...pending }, `${pending.product}: publication evidence matches the catalog`);
  assert.ok(!provenance.public_release, `${pending.product}: no public release claimed before publication`);
  const schemas = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap(m => JSON.parse(m[1]));
  const applications = schemas.filter(s => s['@type'] === 'SoftwareApplication');
  assert.equal(applications.length, 1, `${pending.product}: unpublished product page includes SoftwareApplication structured data`);
  const socialUrl = html.match(/<meta property="og:image" content="([^"]+)">/)?.[1];
  for (const application of applications) {
    assert.ok(!application.datePublished, `${pending.product}: unpublished software has no release date in structured data`);
    assert.equal(application.softwareVersion, pending.accepted_version || pending.submitted_version, `${pending.product}: structured data identifies the verified device version`);
    assert.equal(application.image, socialUrl, `${pending.product}: structured data and social sharing use the same current cover`);
  }
  for (const source of [html, card]) {
    assert.doesNotMatch(source, /data-shop-version=|data-analytics-action="open_shop"|schema\.org\/InStock/, `${pending.product}: no public release or purchase CTA before publication`);
  }
  if (pending.accepted_version) {
    assert.ok(html.includes(`data-accepted-version="${pending.accepted_version}"`), `${pending.product}: page identifies the latest accepted device`);
    assert.match(html, /[Aa]ccepted/);
    const acceptedArticle = pending.accepted_version.replace(/[dbf]\d+$/, '');
    if (pending.status === 'awaiting_shop_approval') {
      assert.equal(pending.shop_page_version, acceptedArticle, `${pending.product}: submitted page uses the accepted version`);
      assert.equal(pending.shop_page_status, 'waiting_for_approval');
    } else if (pending.status === 'awaiting_shop_article') {
      assert.notEqual(pending.shop_page_version, acceptedArticle, `${pending.product}: article mismatch remains explicit`);
      assert.equal(pending.shop_page_status, 'draft', `${pending.product}: do not submit the older article`);
    }
  } else if (pending.submitted_version) {
    assert.ok(html.includes(`data-submitted-version="${pending.submitted_version}"`), `${pending.product}: page identifies the submitted device`);
    assert.match(html, /[Aa]waiting device acceptance/);
    assert.doesNotMatch(html, /data-accepted-version=/, `${pending.product}: submitted does not mean accepted`);
  }
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
const rillProvenance = JSON.parse(read('product/rill/ASSET_PROVENANCE.json'));
const rillApplication = JSON.parse(rill.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
const rillScreenshots = [];
for (const [name, asset] of Object.entries(rillProvenance.assets)) {
  const bytes = readFileSync(new URL(`product/rill/${name}`, root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, `RILL ${name}: image matches its provenance`);
  assert.equal(bytes.length, asset.bytes, `RILL ${name}: recorded file size matches`);
  if (!/\.(webp|jpg)$/.test(name)) continue;
  const versioned = `${name}?v=${asset.sha256.slice(0, 12)}`;
  const references = [...`${rill}\n${home}`.matchAll(new RegExp(name.replaceAll('.', '\\.') + '(?:\\?v=[a-f0-9]+)?', 'g'))];
  assert.ok(references.length, `RILL ${name}: image is used`);
  for (const reference of references) assert.equal(reference[0], versioned, `RILL ${name}: every reference uses the current image`);
  const url = `https://protocodus.cz/product/rill/${versioned}`;
  if (name.endsWith('.webp')) {
    rillScreenshots.push(url);
    const image = rill.match(new RegExp(`<img[^>]+src="${versioned.replace(/[.?]/g, '\\$&')}"[^>]*>`))?.[0];
    assert.ok(image?.includes(`width="${asset.dimensions[0]}" height="${asset.dimensions[1]}"`), `RILL ${name}: intrinsic dimensions match provenance`);
  } else {
    assert.equal(rillApplication.image, url, 'RILL structured data uses the current social cover');
    for (const html of [rill, home]) {
      assert.ok(html.includes(`<meta property="og:image" content="${url}">`), 'RILL and homepage Open Graph cover agree');
      assert.ok(html.includes(`<meta name="twitter:image" content="${url}">`), 'RILL and homepage Twitter cover agree');
      assert.ok(html.includes(`<meta property="og:image:width" content="${asset.dimensions[0]}">`));
      assert.ok(html.includes(`<meta property="og:image:height" content="${asset.dimensions[1]}">`));
    }
  }
}
assert.deepEqual(rillApplication.screenshot, rillScreenshots, 'RILL structured data lists the current screenshots');
const downloads = [...rill.matchAll(/href="(https:\/\/nightly\.link\/protocodus\/rill-daw\/workflows\/ci\/main\/[^"?]+\.zip)"/g)];
assert.equal(downloads.length, 5, 'RILL provides all five rolling platform artifacts');
assert.equal(new Set(downloads.map(m => m[1])).size, 5);
assert.match(rill, /ALPHA/);
assert.match(rill, /unsigned/);
assert.match(rill, /not notarized/);
console.log(`Catalog checks passed: ${catalog.products.length} Shop releases, ${actualVideos.size} videos, ${actualPlaylists.size} playlists, ${commerceLinks} tagged Shop links, RILL first and five alpha downloads.`);
