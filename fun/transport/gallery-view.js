import { BIOMES, CARGO } from './data.js';
import { GALLERY_CATEGORIES, galleryCatalog, filterGallery, galleryDetails, galleryBuildState } from './catalog-data.js';
import { escapeHTML as escape, money } from './copy.js';
import { icon } from './ui-icons.js';
import { cargoIcon, cargoRecipe } from './cargo-icons.js';
import { drawUIArtwork } from './ui-art.js';
import { createSprites, PALETTES } from './sprites.js';
import { paintGroundTextures } from './terrain-materials.js';
import { onWorldArtChange, drawAtlas } from './atlas-runtime.js';
import { onHouseAssetsChange } from './raster-houses.js';

const numeric = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);

/** Catalog navigation reads the world; the app owns closing, chains and construction. */
export function mountGallery(container, game, { onClose, onBuild, onOpenChains, onRelated, onBrowse, onChange = () => {} } = {}, options = {}) {
  const entries = galleryCatalog(), byId = new Map(entries.map(entry => [entry.id, entry]));
  let category = Object.hasOwn(GALLERY_CATEGORIES, options.category) ? options.category : 'all';
  let climate = options.climate === 'all' || BIOMES[options.climate] ? options.climate : game.biome;
  let query = String(options.query || ''), entryId = byId.has(options.entryId) ? options.entryId : null;
  const singleEntry = options.singleEntry === true, preview = singleEntry ? options.preview || {} : {};
  let variant = preview.variant || 0, disposed = false, redrawFrame = 0, history = [], detailStamp = '';
  const density = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const spriteBanks = new Map();
  const portraitBounds = new WeakMap();
  const dialog = container.closest('dialog');
  const selection = () => ({ category, climate, query, entryId });
  const remember = () => onChange(selection());
  const previewBiome = entry => climate !== 'all' && entry.biomes.includes(climate) ? climate : entry.biomes.includes(game.biome) ? game.biome : entry.biomes[0];

  function dispose() {
    if (disposed) return;
    disposed = true; cancelAnimationFrame(redrawFrame);
    stopWorld(); stopHouses(); container.removeEventListener('keydown', keydown);
    dialog?.removeEventListener('close', dialogClosed);
  }
  // A queued close event from a previous view must not dispose a reopened guide.
  function dialogClosed() { if (!dialog?.open) dispose(); }
  function finish(callback, value) { dispose(); callback?.(value); }
  function artHTML(entry, big = false) {
    const art = entry.art, attributes = art.type === 'building' ? `data-building-sprite="${escape(art.kind)}" data-building-variant="${big ? variant : 0}"` :
      art.type === 'industry' ? `data-industry-sprite="${escape(art.kind)}" data-industry-footprint="${big && singleEntry ? preview.footprint || entry.footprint : entry.footprint}" data-industry-variant="${big && singleEntry ? preview.variant || 0 : 0}"` :
      art.type === 'infrastructure' ? `data-infrastructure-sprite="${escape(art.kind)}"${big && singleEntry && art.kind === 'airport' ? ` data-infrastructure-axis="${preview.axis === 'y' ? 'y' : 'x'}"` : ''}` :
      art.type === 'vehicle' ? `data-vehicle-sprite="purchase" data-mode="${art.mode}" data-cargo="${big && singleEntry ? preview.cargo || art.cargo : art.cargo}" data-level="${big && singleEntry ? preview.level || 0 : 0}"` : `data-gallery-nature="${escape(entry.id)}"`;
    return art.type === 'cargo' ? `<span class="gallery-cargo-art">${cargoIcon(art.kind, { decorative: true })}</span>` : `<canvas width="112" height="112" ${attributes}${big && art.type === 'building' ? ` data-gallery-featured="${escape(entry.id)}"` : ''} data-gallery-climate="${previewBiome(entry)}" aria-hidden="true"></canvas>`;
  }

  function render() {
    if (singleEntry) {
      container.innerHTML = `<section class="inspector-gallery" aria-label="Gallery information"><div class="inspector-gallery-heading"><h4>Gallery</h4><button type="button" class="small-button" data-gallery-browse>Browse Gallery${icon('chevronRight', { size: 14 })}</button></div><div class="gallery-detail"></div></section>`;
      container.querySelector('[data-gallery-browse]').addEventListener('click', () => onBrowse?.(entryId));
      renderDetail(); drawArtwork(); return;
    }
    container.innerHTML = `<div class="modal-inner gallery-explorer"><header class="gallery-heading"><div><h2>Gallery</h2><p>Find an object, understand its role, then choose your next step.</p></div><button type="button" class="close-modal" aria-label="Close gallery">${icon('close')}</button></header><div class="gallery-filters"><label class="gallery-search">${icon('search', { size: 18 })}<span class="sr-only">Search gallery</span><input type="search" id="gallery-search" placeholder="Search names or cargo…" value="${escape(query)}" autocomplete="off"></label><label><span class="sr-only">Gallery category</span><select id="gallery-category" aria-label="Gallery category">${Object.entries(GALLERY_CATEGORIES).map(([key, name]) => `<option value="${key}"${key === category ? ' selected' : ''}>${escape(name)}</option>`).join('')}</select></label><label><span class="sr-only">Gallery climate</span><select id="gallery-climate" aria-label="Gallery climate"><option value="all"${climate === 'all' ? ' selected' : ''}>All climates</option>${Object.entries(BIOMES).map(([key, b]) => `<option value="${key}"${key === climate ? ' selected' : ''}>${escape(b.name)}</option>`).join('')}</select></label></div><div class="gallery-layout"><section class="gallery-index" aria-label="Gallery objects"><p class="gallery-count" role="status" aria-live="polite"></p><div class="gallery-list"></div></section><section class="gallery-detail" aria-label="Selected object"></section></div></div>`;
    container.querySelector('.close-modal').addEventListener('click', () => finish(onClose));
    container.querySelector('#gallery-search').addEventListener('input', event => { query = event.target.value; renderList(); });
    container.querySelector('#gallery-category').addEventListener('change', event => { category = event.target.value; renderList(); });
    container.querySelector('#gallery-climate').addEventListener('change', event => { climate = event.target.value; renderList(); });
    renderList();
  }

  function renderList() {
    const visible = filterGallery(entries, selection()), list = container.querySelector('.gallery-list');
    if (!visible.some(entry => entry.id === entryId)) { entryId = visible[0]?.id || null; variant = 0; }
    container.querySelector('.gallery-count').textContent = `${visible.length} ${visible.length === 1 ? 'object' : 'objects'}${query ? ` matching “${query}”` : ''}`;
    list.innerHTML = visible.length ? visible.map(entry => `<button type="button" class="gallery-entry${entry.id === entryId ? ' selected' : ''}" data-gallery-entry="${escape(entry.id)}" aria-pressed="${entry.id === entryId}">${artHTML(entry)}<span><strong>${escape(entry.name)}</strong><small>${escape(GALLERY_CATEGORIES[entry.category])}${entry.footprint ? `, ${typeof entry.footprint === 'number' ? `${entry.footprint} × ${entry.footprint}` : entry.footprint}` : ''}</small></span>${icon('chevronRight', { size: 16 })}</button>`).join('') : '<p class="gallery-empty">No matching objects. Try another name, category or climate.</p>';
    list.querySelectorAll('[data-gallery-entry]').forEach(button => button.addEventListener('click', () => select(button.dataset.galleryEntry)));
    renderDetail(); drawArtwork(); remember();
  }

  function select(id, linked = false) {
    if (!byId.has(id)) return;
    if (entryId && entryId !== id) history.push(selection());
    entryId = id; variant = 0;
    if (linked) {
      category = 'all'; query = '';
      if (climate !== 'all' && !byId.get(id).biomes.includes(climate)) climate = 'all';
      container.querySelector('#gallery-category').value = category;
      container.querySelector('#gallery-climate').value = climate;
      container.querySelector('#gallery-search').value = query;
      renderList();
      container.querySelector(`[data-gallery-entry="${id}"]`)?.scrollIntoView({ block: 'nearest' });
      focusDetail();
    } else {
      container.querySelectorAll('[data-gallery-entry]').forEach(button => { const selected = button.dataset.galleryEntry === id; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); });
      renderDetail(); drawArtwork(); remember();
    }
  }

  function focusDetail() {
    const region = container.querySelector('.gallery-detail');
    if (region) region.scrollTop = 0;
    container.querySelector('#gallery-object-heading')?.focus({ preventScroll: true });
  }

  function renderDetail() {
    const region = container.querySelector('.gallery-detail'), entry = byId.get(entryId);
    if (!entry) { region.innerHTML = '<p class="gallery-empty">Choose a different search to explore the gallery.</p>'; return; }
    const biome = previewBiome(entry), detail = galleryDetails(game, entry, biome), build = galleryBuildState(game, entry);
    const priceLabels = new Set(['Build price today', 'Current purchase price', 'Base upkeep for 30 days', 'Base stop upkeep for 30 days', 'Base cargo fare']);
    const house = !singleEntry && entry.type === 'building' && entry.category === 'homes';
    detailStamp = JSON.stringify([detail, build]);
    const formatStat = (label, value) => typeof value !== 'number' ? escape(value) : priceLabels.has(label) ? money(value) : numeric(value);
    region.innerHTML = `${history.length ? `<button type="button" class="gallery-back" data-gallery-back>${icon('chevronLeft', { size: 16 })}Back to previous object</button>` : ''}<div class="gallery-object-head"><div class="gallery-portrait">${artHTML(entry, true)}</div><div><p class="gallery-meta">${escape(GALLERY_CATEGORIES[entry.category])}, ${escape(BIOMES[biome].name)}</p><h3 id="${singleEntry ? 'inspector-gallery-object-heading' : 'gallery-object-heading'}" tabindex="-1">${escape(entry.name)}</h3><p>${escape(entry.description)}</p>${house ? `<div class="gallery-variants"><button type="button" class="small-button" data-gallery-design>Other design</button><button type="button" class="small-button" data-gallery-turn>Turn</button></div>` : ''}</div></div><div class="gallery-actions">${entry.tool ? `<button type="button" class="button button-primary" data-gallery-build${build.available ? '' : ' disabled'}>${icon('build', { size: 16 })}Build ${escape(entry.name)}</button>` : ''}${detail.chain ? `<button type="button" class="button button-outline" data-gallery-chain>${icon('chains', { size: 16 })}Open production chain</button>` : ''}</div>${build.reason ? `<p class="gallery-note gallery-build-note">${escape(build.reason)}</p>` : ''}${detail.recipes.length ? `<section class="gallery-recipe"><h4>${entry.type === 'workshop' ? 'Recipes' : 'Daily production'}</h4>${detail.recipes.map(recipe => cargoRecipe(recipe.inputs, recipe.outputs, { labels: true })).join('')}</section>` : ''}${detail.stats.length ? `<dl class="gallery-facts">${detail.stats.map(([label, value]) => `<div><dt>${escape(label)}</dt><dd>${formatStat(label, value)}</dd></div>`).join('')}</dl>` : ''}${detail.consumers.length ? `<section class="gallery-connections"><h4>Where cargo goes</h4>${detail.consumers.map(group => `<div class="gallery-cargo-flow"><div class="gallery-flow-label">${cargoIcon(group.cargo, { decorative: true })}<strong>${escape(CARGO[group.cargo]?.name || group.cargo)}</strong><span>${group.incoming ? 'Comes from' : 'Continues to'}</span></div>${group.entries.length ? group.entries.map(target => `<button type="button" class="gallery-related" data-gallery-related="${escape(target.id)}"><span><strong>${escape(target.name)}</strong><small>${escape(target.role)}</small></span>${icon('chevronRight', { size: 16 })}</button>`).join('') : '<p class="gallery-note">No buyer in this climate.</p>'}</div>`).join('')}</section>` : ''}${detail.notes.map(note => `<p class="gallery-note">${escape(note)}</p>`).join('')}${singleEntry && options.related?.length ? `<section class="gallery-connections"><h4>Trees in this grove</h4>${options.related.map(id => byId.get(id)).filter(Boolean).map(tree => `<button type="button" class="gallery-related" data-gallery-related="${escape(tree.id)}"><span><strong>${escape(tree.name)}</strong><small>View this tree</small></span>${icon('chevronRight', { size: 16 })}</button>`).join('')}</section>` : ''}`;
    region.querySelector('[data-gallery-build]')?.addEventListener('click', () => { if (galleryBuildState(game, entry).available) finish(onBuild, singleEntry && entry.tool === 'airport-x' && preview.axis === 'y' ? 'airport-y' : entry.tool); });
    region.querySelector('[data-gallery-chain]')?.addEventListener('click', () => singleEntry ? onOpenChains?.(detail.chain) : finish(onOpenChains, detail.chain));
    region.querySelectorAll('[data-gallery-related]').forEach(button => button.addEventListener('click', () => singleEntry ? onRelated?.(button.dataset.galleryRelated) : select(button.dataset.galleryRelated, true)));
    region.querySelector('[data-gallery-back]')?.addEventListener('click', () => { const previous = history.pop(); ({ category, climate, query, entryId } = previous); variant = 0; render(); focusDetail(); });
    region.querySelector('[data-gallery-design]')?.addEventListener('click', () => { variant = (Math.floor(variant / 6) + 1) % 3 * 6 + variant % 2; renderDetail(); drawArtwork(); region.querySelector('[data-gallery-design]')?.focus({ preventScroll: true }); });
    region.querySelector('[data-gallery-turn]')?.addEventListener('click', () => { variant = Math.floor(variant / 6) * 6 + (1 - variant % 2); renderDetail(); drawArtwork(); region.querySelector('[data-gallery-turn]')?.focus({ preventScroll: true }); });
  }

  function drawArtwork() {
    if (disposed) return;
    // UI artwork uses the same atlas registry as the map. Group by preview climate
    // without altering the company's biome or invoking simulation updates.
    for (const biome of Object.keys(BIOMES)) {
      const canvases = [...container.querySelectorAll(`[data-gallery-climate="${biome}"]`)].filter(canvas => !canvas.dataset.galleryNature);
      if (canvases.length) drawUIArtwork({ querySelectorAll: () => canvases }, { ...game, biome });
    }
    for (const canvas of container.querySelectorAll('[data-gallery-featured]')) {
      const entry = byId.get(canvas.dataset.galleryFeatured), biome = previewBiome(entry);
      let sprite = spriteBanks.get(biome);
      if (!sprite) { sprite = createSprites(biome, { pixelScale: density * 2, detailLevel: 'detail' }); spriteBanks.set(biome, sprite); }
      const image = sprite(entry.art.kind, Number(canvas.dataset.buildingVariant) || 0, singleEntry ? preview.level || 1 : 1, '', singleEntry ? preview.footprint || entry.footprint : entry.footprint);
      canvas.width = canvas.height = 152 * density;
      let bounds = portraitBounds.get(image);
      if (!bounds) {
        const pixels = image.getContext('2d').getImageData(0, 0, image.width, image.height).data;
        let left = image.width, top = image.height, right = -1, bottom = -1;
        for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (pixels[(y * image.width + x) * 4 + 3]) {
          left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
        bounds = right < left ? { x: 0, y: 0, width: image.width, height: image.height } : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
        portraitBounds.set(image, bounds);
      }
      // Only the selected catalog portrait fits its visible content. Include
      // every nontransparent garden, fence and shadow pixel; preserve aspect.
      const inset = 6 * density;
      const scale = Math.min((canvas.width - inset * 2) / bounds.width, (canvas.height - inset * 2) / bounds.height);
      const c = canvas.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, canvas.width, canvas.height);
      c.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height, (canvas.width - bounds.width * scale) / 2, (canvas.height - bounds.height * scale) / 2, bounds.width * scale, bounds.height * scale);
    }
    for (const canvas of container.querySelectorAll('[data-gallery-nature]')) {
      const entry = byId.get(canvas.dataset.galleryNature), biome = previewBiome(entry), width = 112;
      canvas.width = canvas.height = width * density;
      const c = canvas.getContext('2d'); c.scale(density, density);
      if (['grass', 'sand', 'snow', 'water'].includes(entry.art.kind)) {
        c.save(); c.translate(56, 22); c.transform(1.5, .75, -1.5, .75, 0, 0);
        c.fillStyle = PALETTES[biome][entry.art.kind === 'water' ? 'water' : entry.art.kind === 'sand' ? 'sand' : 'ground']; c.fillRect(0, 0, 32, 32);
        if (entry.art.kind !== 'water') paintGroundTextures(c, { x0: 0, y0: 0, x1: 1, y1: 1 }, () => ({ terrain: entry.art.kind, elevation: .2 }), biome, 'detail', 1847);
        c.restore();
      } else if (entry.art.atlas?.[biome] && drawAtlas(c, entry.art.atlas[biome], 8, 8, 96, 96, { pixelScale: density })) {
        // Individual catalog species show their exact authored identity, while
        // woodland entries retain the map's complete mixed-tree composition.
      } else {
        let sprite = spriteBanks.get(biome);
        if (!sprite) { sprite = createSprites(biome, { pixelScale: density * 2, detailLevel: 'detail' }); spriteBanks.set(biome, sprite); }
        const image = sprite(entry.art.kind, singleEntry ? preview.variant || 0 : 0, singleEntry ? preview.level || 1 : 1, singleEntry ? preview.detail ?? entry.art.detail ?? '' : entry.art.detail || '', singleEntry ? preview.footprint || 1 : 1);
        c.drawImage(image, 8, 0, 96, 108);
      }
    }
  }
  function scheduleArtwork() { if (!disposed && !redrawFrame) redrawFrame = requestAnimationFrame(() => { redrawFrame = 0; drawArtwork(); }); }
  function keydown(event) {
    if (!singleEntry && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(onClose); }
    if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) && event.target.closest('[data-gallery-entry]')) {
      const buttons = [...container.querySelectorAll('[data-gallery-entry]')], current = buttons.indexOf(event.target.closest('[data-gallery-entry]'));
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
      event.preventDefault(); buttons[index]?.focus(); select(buttons[index]?.dataset.galleryEntry);
    }
  }
  const stopWorld = onWorldArtChange(scheduleArtwork), stopHouses = onHouseAssetsChange(scheduleArtwork);
  container.addEventListener('keydown', keydown);
  dialog?.addEventListener('close', dialogClosed);
  render();
  return { dispose, getSelection: selection, refresh() {
    if (disposed || !singleEntry) return;
    const entry = byId.get(entryId);
    if (entry && JSON.stringify([galleryDetails(game, entry, previewBiome(entry)), galleryBuildState(game, entry)]) !== detailStamp) { renderDetail(); drawArtwork(); }
  } };
}

/** The inspector and full Gallery share one detail renderer, facts and artwork lifecycle. */
export function mountGalleryEntry(container, game, callbacks = {}, selection = {}) {
  return mountGallery(container, game, callbacks, { ...selection, singleEntry: true });
}
