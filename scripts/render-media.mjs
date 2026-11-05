// Static, crawlable product demos. Run with --check in CI or without it to regenerate.
import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const media = JSON.parse(await readFile(new URL('product/MEDIA.json', root), 'utf8'));
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const slug = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '_');
let changed = 0;
for (const product of new Set([...media.videos, ...media.playlists].map(item => item.product))) {
  const videos = media.videos.filter(item => item.product === product);
  const playlists = media.playlists.filter(item => item.product === product);
  const name = { youknow: 'YouKnow', press78: 'Press78', lamer: 'Lamer Degrader' }[product] || product[0].toUpperCase() + product.slice(1);
  const note = product === 'youknow' ? 'These V1 recordings demonstrate an earlier version of YouKnow.'
    : ['keyra', 'acukoto', 'respira'].includes(product) ? 'Performances and walkthroughs from the instrument in development. The interface and sound may evolve before release.'
    : product === 'binaurel' ? 'Put on headphones to hear the movement, height and distance.'
    : 'Hear the character. Watch the controls. Find a starting point for your next track.';
  const content = `    <!-- product-media:start -->
    <section class="band product-media" id="listen">
      <div class="wrap">
        <div class="media-heading"><div><span class="tag">Watch &amp; listen</span><h2 class="title">${escape(name)} in action.</h2></div><p class="lede">${note}</p></div>
        ${videos.length ? `<div class="video-grid">${videos.map(video => `
          <figure class="demo-video${video.kind === 'short' ? ' demo-video-short' : ''}">
            <iframe class="youtube-player" data-media-id="${product}-${video.id}" width="560" height="315" loading="lazy" title="${escape(video.title)}" src="https://www.youtube-nocookie.com/embed/${video.id}?enablejsapi=1&amp;origin=https%3A%2F%2Fprotocodus.cz&amp;playsinline=1&amp;rel=0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
            <figcaption><span>${escape(video.title)}</span><a href="${escape(video.url)}" data-analytics-cta="youtube_${slug(video.id)}" data-analytics-action="watch_demo">${video.kind === 'short' ? 'Watch Short' : 'Watch on YouTube'} ↗</a></figcaption>
          </figure>`).join('')}
        </div>` : ''}
        ${playlists.map(playlist => `<div class="demo-playlist">
          <div class="playlist-heading"><h3>SoundCloud playlist</h3><a href="${escape(playlist.permalink_url)}" data-analytics-cta="soundcloud_${playlist.id}" data-analytics-action="listen_demo">${playlist.track_count} ${playlist.track_count === 1 ? 'demo' : 'demos'} · Open playlist ↗</a></div>
          <iframe class="soundcloud-player" data-media-id="${product}-playlist-${playlist.id}" title="${escape(playlist.title)} on SoundCloud" width="100%" height="300" scrolling="no" loading="lazy" allow="autoplay; encrypted-media" src="https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Fplaylists%2F${playlist.id}&amp;color=%2387d7be&amp;auto_play=false&amp;hide_related=true&amp;show_comments=false&amp;show_user=true&amp;show_reposts=false&amp;visual=false"></iframe>
        </div>`).join('\n        ')}
      </div>
    </section>
    <!-- product-media:end -->`.replace(/[ \t]+$/gm, '');
  const path = new URL(`product/${product}/index.html`, root);
  const html = await readFile(path, 'utf8');
  const marker = /    <!-- product-media:start -->[\s\S]*?    <!-- product-media:end -->/;
  if (!marker.test(html)) throw new Error(`${product}: missing media markers`);
  const next = html.replace(marker, () => content);
  if (next !== html) {
    changed++;
    if (!process.argv.includes('--check')) await writeFile(path, next);
  }
}
if (changed && process.argv.includes('--check')) throw new Error(`${changed} product media sections are stale. Run node scripts/render-media.mjs.`);
console.log(`Media ${process.argv.includes('--check') ? 'check' : 'render'} passed: ${media.videos.length} videos, ${media.playlists.length} playlists, ${media.playlists.reduce((n, p) => n + p.track_count, 0)} playlist tracks.`);
