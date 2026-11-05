// Read-only public-source monitor. Run: node scripts/catalog-live-check.mjs
// Exit 1: confirmed catalog/media drift. Exit 2: verification unavailable.
// It never changes snapshots, publishes content, or downloads RILL archives.
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const root = new URL('../', import.meta.url);
const youtubeChannelId = 'UCmvSdHJ0mLBPyQWaTVEJDAQ';
const timeoutMs = 12_000;
const maxBodyBytes = 3 * 1024 * 1024;
const notes = [], drift = [], unavailable = [], verified = [];

class VerificationError extends Error {}

function decode(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt);/g, entity => ({
    '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>',
  })[entity]);
}

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
    .map(([, name, double, single]) => [name.toLowerCase(), decode(double ?? single)]));
}

function difference(expected, actual) {
  return {
    added: [...new Set(actual)].filter(value => !expected.includes(value)).sort(),
    removed: [...new Set(expected)].filter(value => !actual.includes(value)).sort(),
  };
}

function listing(html, base) {
  // An empty/error/unfiltered page must not look like every product disappeared.
  const checked = [...html.matchAll(/<input\b[^>]*>/gi)].some(([tag]) =>
    attributes(tag).value === 'Protocodus' && /\bchecked(?:\s|=|\/?>)/i.test(tag));
  if (!checked) throw new VerificationError('Shop developer filter is missing; listing markup may have changed.');
  const urls = [...html.matchAll(/<a\b[^>]*>/gi)].map(([tag]) => attributes(tag).href)
    .filter(Boolean).map(href => new URL(href, base));
  const products = [...new Set(urls.filter(url => url.origin === new URL(base).origin &&
    /^\/shop\/rack-extension\/[^/]+\/$/.test(url.pathname)).map(url => url.origin + url.pathname))];
  if (!products.length) throw new VerificationError('Shop returned no recognizable products; verify the listing manually.');
  const pages = [...new Set(urls.filter(url => url.origin === new URL(base).origin &&
    url.pathname === '/shop/browse/' && url.searchParams.get('developer') === 'Protocodus' &&
    /^\d+$/.test(url.searchParams.get('page') || '')).map(url => url.href))];
  return { products, pages };
}

function shopProduct(html) {
  const version = html.match(/id=["']product\/version_title["'][\s\S]*?<\/p>\s*<div\b[^>]*>([\s\S]*?)<\/div>/i)?.[1]
    .replace(/<[^>]*>/g, '').trim();
  const releaseDate = html.match(/Released:\s*(\d{4}-\d{2}-\d{2})/)?.[1];
  const heroStart = html.search(/class=["'][^"']*\bproduct-page-hero\b[^"']*["']/i);
  const heroEnd = html.slice(heroStart).search(/<section\b[^>]*class=["'][^"']*\bbg-cream\b/i);
  if (!version || !releaseDate || heroStart < 0 || heroEnd < 0) {
    throw new VerificationError('Shop version or gallery markup is missing; no publication state inferred.');
  }
  // Restrict images to the hero: recommendation cards contain other products.
  const hero = html.slice(heroStart, heroStart + heroEnd);
  const gallery = [...hero.matchAll(/<img\b[^>]*>/gi)].map(([tag]) => attributes(tag))
    .filter(attrs => attrs.class?.split(/\s+/).includes('product-slider-content__img'))
    .map(attrs => attrs.src || attrs['data-lazy']).filter(Boolean);
  const thumbnail = [...html.matchAll(/<meta\b[^>]*>/gi)].map(([tag]) => attributes(tag))
    .filter(attrs => attrs.property === 'og:image')
    .map(attrs => attrs.content?.replace(/^https:\/\/www\.reasonstudios\.com(?=https:\/\/)/, ''))
    .find(url => url?.includes('/product_pictures/thumbnails/'));
  if (!gallery.length || !thumbnail) throw new VerificationError('Shop images could not be identified.');
  return { version, releaseDate, gallery, thumbnail };
}

async function request(url, { probe = false, fetcher = fetch, retryDelay = 750 } = {}) {
  // Log only the original public URL, never a signed artifact redirect URL.
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'Protocodus-Catalog-Monitor/1.0 (+https://protocodus.cz/)',
          ...(probe ? { Range: 'bytes=0-0' } : {}) },
      });
      if (response.status === 429 || response.status === 408 || response.status >= 500) {
        await response.body?.cancel();
        throw new VerificationError(`HTTP ${response.status}`);
      }
      const result = { status: response.status, headers: response.headers, body: '' };
      if (probe || !response.ok) {
        // Even an ignored Range must never result in downloading the archive.
        await response.body?.cancel();
        return result;
      }
      const reader = response.body.getReader();
      const chunks = [];
      let length = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > maxBodyBytes) throw new VerificationError('Response exceeds the 3 MiB metadata limit.');
          chunks.push(value);
        }
      } finally { await reader.cancel(); }
      result.body = Buffer.concat(chunks).toString('utf8');
      return result;
    } catch (error) {
      if (attempt === 2) {
        throw new VerificationError(`Could not verify ${url}: ${error.name === 'AbortError' ? 'request timed out' : error.message}`);
      }
    } finally { clearTimeout(timer); }
    await delay(retryDelay * (attempt + 1));
  }
}

function ok(response, label) {
  if (response.status !== 200) throw new VerificationError(`${label}: HTTP ${response.status}; source verification unavailable.`);
  return response.body;
}

function json(response, label) {
  try { return JSON.parse(ok(response, label)); }
  catch (error) {
    if (error instanceof VerificationError) throw error;
    throw new VerificationError(`${label}: invalid JSON response.`);
  }
}

async function check(label, task) {
  try {
    await task();
    verified.push(label);
  } catch (error) { unavailable.push(`${label}: ${error.message}`); }
}

function soundcloudPlaylistId(embedHtml) {
  const iframe = embedHtml?.match(/<iframe\b[^>]*>/i)?.[0];
  const src = iframe && attributes(iframe).src;
  if (!src) return null;
  const player = new URL(src);
  if (player.hostname !== 'w.soundcloud.com') return null;
  const resource = player.searchParams.get('url');
  // Decode only the URL parameter; iframe HTML can contain literal width="100%".
  return resource?.match(/^https:\/\/api\.soundcloud\.com\/playlists\/(\d+)$/)?.[1] || null;
}

async function pool(tasks) {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(4, tasks.length) }, async () => {
    while (index < tasks.length) await tasks[index++]();
  }));
}

function compareSet(label, expected, actual) {
  const { added, removed } = difference(expected, actual);
  if (added.length) drift.push(`${label}: new ${added.join(', ')}`);
  if (removed.length) drift.push(`${label}: missing ${removed.join(', ')}`);
}

function recentUploads(html) {
  const raw = html.match(/(?:var\s+)?ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/)?.[1];
  if (!raw) throw new VerificationError('Public YouTube channel metadata is missing.');
  let data;
  try { data = JSON.parse(raw); } catch { throw new VerificationError('Public YouTube channel metadata is invalid.'); }
  if (data.metadata?.channelMetadataRenderer?.externalId !== youtubeChannelId) {
    throw new VerificationError('YouTube channel identity did not match the verified Protocodus channel.');
  }
  const selected = data.contents?.twoColumnBrowseResultsRenderer?.tabs
    ?.find(tab => tab.tabRenderer?.selected)?.tabRenderer?.content;
  const ids = new Set();
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (value.lockupViewModel?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') ids.add(value.lockupViewModel.contentId);
    if (value.videoRenderer?.videoId) ids.add(value.videoRenderer.videoId);
    const short = value.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId;
    if (short) ids.add(short);
    for (const child of Object.values(value)) walk(child);
  }
  walk(selected);
  if (!ids.size) throw new VerificationError('Recent channel uploads could not be read; public page markup may have changed.');
  return [...ids];
}

async function youtubeDiscovery(media) {
  let ids;
  try {
    const xml = ok(await request(`https://www.youtube.com/feeds/videos.xml?channel_id=${youtubeChannelId}`), 'YouTube RSS');
    if (!xml.includes(`<yt:channelId>${youtubeChannelId}</yt:channelId>`)) throw new VerificationError('RSS channel identity missing.');
    ids = [...xml.matchAll(/<yt:videoId>([\w-]{11})<\/yt:videoId>/g)].map(match => match[1]);
    if (!ids.length) throw new VerificationError('RSS has no recognizable entries.');
  } catch {
    // Some valid channels have no working RSS feed. Public pages are a bounded
    // fallback for recent discovery; no undocumented/private API is called.
    notes.push('YouTube RSS unavailable; checked recent uploads on public Videos and Shorts pages instead.');
    ids = [];
    for (const tab of ['videos', 'shorts']) {
      ids.push(...recentUploads(ok(await request(`${media.youtube_channel}/${tab}`), `YouTube ${tab}`)));
    }
  }
  const added = difference(media.videos.map(video => video.id), ids).added;
  if (added.length) drift.push(`YouTube: new uploads need product mapping and website inclusion: ${added.join(', ')}`);
}

async function main() {
  const [store, media, rill] = await Promise.all([
    readFile(new URL('product/STORE_SNAPSHOT.json', root), 'utf8').then(JSON.parse),
    readFile(new URL('product/MEDIA.json', root), 'utf8').then(JSON.parse),
    readFile(new URL('product/rill/index.html', root), 'utf8'),
  ]);
  if (!store.products?.length || !media.videos?.length || !media.playlists?.length) {
    throw new VerificationError('Store or media snapshot is empty; cannot run the monitor.');
  }
  await check('Reason developer listing', async () => {
    const queue = [store.developer_url], visited = new Set(), products = new Set();
    while (queue.length) {
      if (visited.size >= 10) throw new VerificationError('Shop listing exceeded 10 pages; review pagination manually.');
      const url = queue.shift();
      if (visited.has(url)) continue;
      visited.add(url);
      const page = listing(ok(await request(url), 'Reason developer listing'), store.developer_url);
      page.products.forEach(product => products.add(product));
      page.pages.filter(page => !visited.has(page)).forEach(page => queue.push(page));
    }
    compareSet('Reason catalog', store.products.map(product => product.url), [...products]);
  });
  const tasks = store.products.map(product => () => check(`Shop ${product.product}`, async () => {
    const response = await request(product.url);
    if ([404, 410].includes(response.status)) { drift.push(`${product.product}: published Shop page now returns HTTP ${response.status}.`); return; }
    const live = shopProduct(ok(response, product.product));
    if (live.version !== product.version) drift.push(`${product.product}: Shop version ${live.version}; snapshot ${product.version}.`);
    if (live.releaseDate !== product.release_date) drift.push(`${product.product}: Shop release-date field changed to ${live.releaseDate}.`);
    compareSet(`${product.product} gallery`, product.gallery, live.gallery);
    if (live.thumbnail !== product.thumbnail_url) drift.push(`${product.product}: Shop cover URL changed to ${live.thumbnail}.`);
  }));
  for (const product of store.unpublished || []) tasks.push(() => check(`Pending ${product.product}`, async () => {
    const response = await request(product.checked_url);
    if (response.status === product.http_status) return;
    const live = shopProduct(ok(response, product.product));
    drift.push(`${product.product}: previously unpublished Shop page is now live at ${live.version}; review availability and purchase links.`);
  }));
  for (const video of media.videos) tasks.push(() => check(`YouTube ${video.id}`, async () => {
    const response = await request(`https://www.youtube.com/oembed?url=${encodeURIComponent(video.url)}&format=json`);
    if ([400, 401, 404, 410].includes(response.status)) { drift.push(`YouTube ${video.id}: public embedding unavailable (HTTP ${response.status}).`); return; }
    const live = json(response, video.id);
    if (live.type !== 'video' || !live.html?.includes(`/embed/${video.id}`) || live.author_url !== media.youtube_channel) {
      drift.push(`YouTube ${video.id}: embed identity or channel changed.`);
    }
  }));
  for (const playlist of media.playlists) tasks.push(() => check(`SoundCloud ${playlist.product}`, async () => {
    const response = await request(`https://soundcloud.com/oembed?url=${encodeURIComponent(playlist.permalink_url)}&format=json`);
    if ([400, 401, 404, 410].includes(response.status)) { drift.push(`SoundCloud ${playlist.product}: playlist unavailable (HTTP ${response.status}).`); return; }
    const live = json(response, playlist.product);
    if (live.type !== 'rich' || soundcloudPlaylistId(live.html) !== String(playlist.id) || live.author_url !== media.soundcloud_profile) {
      drift.push(`SoundCloud ${playlist.product}: playlist embed identity or owner changed.`);
    }
  }));
  tasks.push(() => check('New YouTube uploads', () => youtubeDiscovery(media)));
  const downloads = [...new Set([...rill.matchAll(/<a\b[^>]*>/gi)].map(([tag]) => attributes(tag).href)
    .filter(url => url?.startsWith('https://nightly.link/protocodus/rill-daw/workflows/ci/main/')))];
  if (!downloads.length) unavailable.push('RILL: no current main-build download links found in the page.');
  for (const url of downloads) tasks.push(() => check(`RILL ${new URL(url).pathname.split('/').at(-1)}`, async () => {
    const response = await request(url, { probe: true });
    if ([404, 410].includes(response.status)) { drift.push(`RILL: rolling build is unavailable or expired: ${url}`); return; }
    if (![200, 206].includes(response.status)) throw new VerificationError(`Download probe returned HTTP ${response.status}.`);
    if (!/application\/(?:zip|octet-stream|x-zip(?:-compressed)?)/i.test(response.headers.get('content-type') || '')) {
      throw new VerificationError('Download endpoint returned a non-archive content type.');
    }
    if (response.status === 206 && !/^bytes 0-0\/[1-9]\d*$/i.test(response.headers.get('content-range') || '')) {
      throw new VerificationError('Download endpoint returned an unexpected byte range.');
    }
    if (response.status === 200) notes.push('A RILL server ignored Range; only archive headers were verified and its body was cancelled.');
  }));
  await pool(tasks);
  for (const note of new Set(notes)) console.log(`NOTE: ${note}`);
  for (const failure of drift) console.error(`DRIFT: ${failure}`);
  for (const failure of unavailable) console.error(`UNAVAILABLE: ${failure}`);
  console.log(`${verified.length} source checks completed; ${drift.length} drift findings; ${unavailable.length} unavailable checks.`);
  console.log(`Compared ${store.products.length} Shop releases, ${media.videos.length} videos, ${media.playlists.length} playlists and ${downloads.length} RILL downloads. Snapshots: ${store.verified_at} / ${media.verified_at}.`);
  if (unavailable.length) process.exitCode = 2;
  else if (drift.length) process.exitCode = 1;
}

async function selfTest() {
  const assert = (await import('node:assert/strict')).default;
  assert.throws(() => listing('<h1>Service unavailable</h1>', 'https://www.reasonstudios.com'), VerificationError);
  const sample = `<input name="developer" value="Protocodus" checked><a href="/shop/rack-extension/example/">Example</a>`;
  assert.deepEqual(listing(sample, 'https://www.reasonstudios.com').products, ['https://www.reasonstudios.com/shop/rack-extension/example/']);
  const markup = `<meta property="og:image" content="https://www.reasonstudios.comhttps://cdn.example/product_pictures/thumbnails/cover.png">
    <div class="product-page-hero"><img class="product-slider-content__img" src="front.webp"><img class="product-slider-content__img" data-lazy="rear.webp"></div>
    <section class="bg-cream"><p><font id="product/version_title">Version</font></p><div>1.2.3</div><div>Released: 2026-11-05</div></section>
    <img class="product-slider-content__img" src="recommendation.webp">`;
  assert.deepEqual(shopProduct(markup), { version: '1.2.3', releaseDate: '2026-11-05', gallery: ['front.webp', 'rear.webp'], thumbnail: 'https://cdn.example/product_pictures/thumbnails/cover.png' });
  assert.throws(() => shopProduct(markup.replace('product/version_title', 'unknown')), VerificationError);
  assert.deepEqual(difference(['one', 'two'], ['two', 'three', 'three']), { added: ['three'], removed: ['one'] });
  assert.equal(soundcloudPlaylistId('<iframe width="100%" src="https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/playlists/123&amp;auto_play=false"></iframe>'), '123');
  assert.equal(soundcloudPlaylistId('<iframe src="https://example.com/player/?url=https://api.soundcloud.com/playlists/123"></iframe>'), null);
  let cancelled = false, reads = 0;
  const probe = await request('https://example.com/large.zip', { probe: true, fetcher: async (_, init) => {
    assert.equal(init.headers.Range, 'bytes=0-0');
    return { status: 200, headers: new Headers({ 'content-type': 'application/zip' }), body: {
      cancel: async () => { cancelled = true; }, getReader: () => { reads++; throw new Error('Must not read archive'); },
    } };
  } });
  assert.equal(probe.status, 200); assert.equal(cancelled, true); assert.equal(reads, 0);
  let attempts = 0;
  const retried = await request('https://example.com/metadata', { retryDelay: 1, fetcher: async () => {
    attempts++; return new Response(attempts === 1 ? 'Temporary outage' : '{}', { status: attempts === 1 ? 503 : 200 });
  } });
  assert.equal(attempts, 2); assert.deepEqual(json(retried, 'fixture'), {});
  await assert.rejects(() => request('https://example.com/outage', { retryDelay: 1, fetcher: async () => new Response('', { status: 503 }) }), VerificationError);
  console.log('Catalog monitor self-check passed: parser guards, gallery scope, drift sets, retries and zero archive-body reads.');
}

try {
  if (process.argv.includes('--self-test')) await selfTest();
  else await main();
} catch (error) {
  console.error(`UNAVAILABLE: ${error.message}`);
  process.exitCode = 2;
}
