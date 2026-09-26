import { BIOMES, CARGO, INDUSTRIES, TOWN_CARGO } from './data.js';
import { cargoBadge, cargoIcon, cargoRecipe } from './cargo-icons.js';
import { drawUIArtwork } from './ui-art.js';
import { chainProducts, defaultChainProduct, nearestTown, productionChain } from './chains.js';

const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const closeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>';
const locateIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/></svg>';
const number = value => Math.floor(value || 0).toLocaleString('en-US');

/** Mount into the existing modal; callbacks keep camera/build ownership in app.js. */
export function mountChains(container, game, { onLocate, onBuild, onClose, onChange = () => {} }, options = {}) {
  const products = chainProducts(game.biome);
  let cargo = options.cargo === 'all' || products.includes(options.cargo) ? options.cargo : defaultChainProduct(game.biome, options.industryKind);
  let selectedKind = options.industryKind;
  let graph, resizeObserver, frame = 0, disposed = false;

  function sitesFor(kind) { return kind === 'towns' ? game.cities : game.industries.filter(industry => industry.kind === kind); }
  function remember() { onChange({ cargo, industryKind: selectedKind }); }
  function dispose() { disposed = true; resizeObserver?.disconnect(); cancelAnimationFrame(frame); }
  function finish(callback, value) { dispose(); callback?.(value); }

  function nodeHTML(node) {
    const sites = sitesFor(node.kind), selected = node.kind === selectedKind;
    if (node.kind === 'towns') return `<button type="button" class="chain-node chain-town-node${selected ? ' selected' : ''}" data-chain-industry="towns" data-chain-node="towns" aria-pressed="${selected}" aria-label="Towns, ${sites.length} locations"><span class="chain-node-kicker">Customers</span><strong>Towns</strong><span class="chain-town-cargo">${Object.keys(node.definition.inputs).map(key => cargoBadge(key)).join('')}</span><span class="chain-node-sites">${sites.length} towns <span aria-hidden="true">↗</span></span></button>`;
    const definition = node.definition;
    return `<button type="button" class="chain-node${selected ? ' selected' : ''}${sites.length ? '' : ' chain-node-missing'}" data-chain-industry="${node.kind}" data-chain-node="${node.kind}" aria-pressed="${selected}" aria-label="${escape(definition.name)}, ${sites.length} sites"><span class="chain-node-kicker">${Object.keys(definition.inputs).length ? 'Processing' : 'Raw materials'}</span><span class="chain-node-heading"><canvas width="112" height="112" data-industry-sprite="${node.kind}" aria-hidden="true"></canvas><strong>${escape(definition.name)}</strong></span>${cargoRecipe(definition.inputs, definition.outputs)}<span class="chain-node-sites">${sites.length ? `${sites.length} ${sites.length === 1 ? 'site' : 'sites'}` : 'No sites · build one'} <span aria-hidden="true">↗</span></span></button>`;
  }

  function render() {
    graph = productionChain(game.biome, cargo);
    if (!graph.nodes.some(node => node.kind === selectedKind)) selectedKind = graph.nodes.findLast(node => node.kind !== 'towns')?.kind;
    const groupOptions = keys => keys.map(key => `<option value="${key}"${cargo === key ? ' selected' : ''}>${escape(CARGO[key].name)}</option>`).join('');
    container.innerHTML = `<div class="modal-inner chains-explorer"><button type="button" class="close-modal" aria-label="Close production chains">${closeIcon}</button><div class="modal-heading chains-heading"><span class="eyebrow">${escape(BIOMES[game.biome]?.name || game.biome)} · production</span><h2>Follow the chain.</h2><p>Raw materials to a thriving town.</p></div><div class="chains-toolbar"><label for="chain-product">Follow resource<select id="chain-product"><option value="all"${cargo === 'all' ? ' selected' : ''}>All industries</option><optgroup label="Town deliveries">${groupOptions(products.filter(key => TOWN_CARGO.includes(key)))}</optgroup><optgroup label="Materials">${groupOptions(products.filter(key => !TOWN_CARGO.includes(key)))}</optgroup></select></label><div class="chain-key">${cargo === 'all' ? '<span class="chain-all-mark" aria-hidden="true">↗</span>' : cargoIcon(cargo, { decorative: true })}<span>${cargo === 'all' ? 'Every industry in this region' : escape(CARGO[cargo].name)}<small>Select an industry to find its sites</small></span></div></div><div class="chain-scroll" tabindex="0" role="region" aria-label="Production chain diagram. Scroll horizontally to follow every stage."><div class="chain-board" style="--chain-stages:${graph.levels.length}"><svg class="chain-edges" aria-hidden="true"></svg>${graph.levels.map((nodes, index) => `<section class="chain-stage" aria-label="Stage ${index + 1}"><div class="chain-stage-label"><b>${String(index + 1).padStart(2, '0')}</b><span>${nodes.every(node => node.kind === 'towns') ? 'Delivery' : index === 0 ? 'Sources' : 'Production'}</span></div><div class="chain-stage-nodes">${nodes.map(nodeHTML).join('')}</div></section>`).join('')}</div></div><p class="chains-caption">Arrows show cargo flow. Recipe numbers are base batch amounts.<span> Scroll to follow every stage →</span></p><section class="chain-site-section" aria-labelledby="chain-sites-heading"></section></div>`;
    container.querySelector('.close-modal').addEventListener('click', () => finish(onClose));
    container.querySelector('#chain-product').addEventListener('change', event => { cargo = event.target.value; render(); container.querySelector('#chain-product').focus({ preventScroll: true }); });
    container.querySelectorAll('[data-chain-industry]').forEach(button => button.addEventListener('click', () => { select(button.dataset.chainIndustry); container.querySelector('.chain-site-section').scrollIntoView({ block: 'start' }); }));
    renderSites();
    drawUIArtwork(container,game);
    resizeObserver?.disconnect();
    resizeObserver = new ResizeObserver(scheduleEdges);
    resizeObserver.observe(container.querySelector('.chain-board'));
    scheduleEdges();
    remember();
  }

  function select(kind) {
    selectedKind = kind;
    container.querySelectorAll('[data-chain-industry]').forEach(button => {
      button.classList.toggle('selected', button.dataset.chainIndustry === kind);
      button.setAttribute('aria-pressed', String(button.dataset.chainIndustry === kind));
    });
    renderSites();
    scheduleEdges();
    remember();
  }

  function renderSites() {
    const region = container.querySelector('.chain-site-section'), sites = sitesFor(selectedKind), definition = INDUSTRIES[selectedKind], towns = selectedKind === 'towns';
    const connections = graph.edges.filter(edge => edge.from === selectedKind);
    region.innerHTML = `<button type="button" class="chain-back" data-chain-back>↑ Back to chain</button><div class="chain-sites-title"><div><span class="eyebrow">On the map</span><h3 id="chain-sites-heading">${towns ? 'Towns' : escape(definition?.name || 'Industry')} <span>${sites.length}</span></h3></div>${!towns ? `<button type="button" class="button chain-build" data-chain-build="${escape(selectedKind)}">+ Build</button>` : ''}</div>${connections.length ? `<div class="chain-consumers"><span>Supplies</span>${connections.map(edge => `<button type="button" data-chain-consumer="${escape(edge.to)}">${cargoIcon(edge.cargo, { decorative: true })}<span aria-hidden="true">→</span><span>${escape(edge.to === 'towns' ? 'Towns' : INDUSTRIES[edge.to].name)}</span></button>`).join('')}</div>` : ''}${sites.length ? `<div class="chain-places"><div class="chain-map-wrap"><canvas id="chain-sites-map" width="560" height="420" role="img" aria-label="${sites.length} ${towns ? 'town' : 'industry'} locations in this region; numbered to match the location list."></canvas><p>Select a pin or locate a site.</p></div><div class="chain-sites-list">${sites.map((site, index) => {
      const town = towns ? null : nearestTown(game, site), outputs = Object.keys(definition?.outputs || {});
      return `<article class="chain-site" data-chain-site="${escape(site.id)}"><div class="chain-site-name"><span class="chain-pin">${index + 1}</span><strong>${escape(site.name || definition?.name)}</strong></div><p>${town ? `${escape(town.name)} · ${Math.round(town.distance)} tiles` : towns ? `${number(site.population)} residents` : 'Open country'}</p><div class="chain-site-detail"><span class="chain-site-coordinates">${site.x}, ${site.y}</span>${outputs.map(output => cargoBadge(output, { count: Math.floor(site.inventory?.[output] || 0) })).join('')}</div><button type="button" class="small-button" data-chain-locate="${escape(site.id)}" data-chain-kind="${towns ? 'city' : 'industry'}" aria-label="Locate ${escape(site.name || definition?.name)} at ${site.x}, ${site.y}">${locateIcon} Locate</button></article>`;
    }).join('')}</div></div>` : `<div class="chain-no-sites"><strong>No ${escape(definition?.name.toLowerCase() || 'industry')} sites yet.</strong><p>Build one to complete this chain.</p><button type="button" class="button button-primary" data-chain-build="${escape(selectedKind)}">Build ${escape(definition?.name || 'industry')}</button></div>`}`;
    region.querySelector('[data-chain-back]').addEventListener('click', () => { container.querySelector('.chains-heading').scrollIntoView({ block: 'start' }); });
    region.querySelectorAll('[data-chain-build]').forEach(button => button.addEventListener('click', () => finish(onBuild, button.dataset.chainBuild)));
    region.querySelectorAll('[data-chain-locate]').forEach(button => button.addEventListener('click', () => finish(onLocate, button.dataset.chainLocate)));
    region.querySelectorAll('[data-chain-consumer]').forEach(button => button.addEventListener('click', () => {
      select(button.dataset.chainConsumer);
      container.querySelector(`[data-chain-node="${button.dataset.chainConsumer}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }));
    if (sites.length) drawSitesMap(region.querySelector('canvas'), sites);
  }

  function scheduleEdges() { cancelAnimationFrame(frame); frame = requestAnimationFrame(drawEdges); }
  function drawEdges() {
    if (disposed || !container.querySelector('.chain-board')?.isConnected) return;
    const board = container.querySelector('.chain-board'), svg = container.querySelector('.chain-edges'), rect = board.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    svg.innerHTML = `<defs><marker id="chain-arrow" markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 7 3.5 0 7Z" fill="#7d9569"/></marker><marker id="chain-arrow-selected" markerWidth="8" markerHeight="8" refX="6.5" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 8 4 0 8Z" fill="#b77641"/></marker></defs>${graph.edges.map(edge => {
      const from = board.querySelector(`[data-chain-node="${edge.from}"]`).getBoundingClientRect(), to = board.querySelector(`[data-chain-node="${edge.to}"]`).getBoundingClientRect();
      const siblings = graph.edges.filter(other => other.to === edge.to), offset = (siblings.indexOf(edge) - (siblings.length - 1) / 2) * 10;
      const x1 = from.right - rect.left, y1 = from.top + from.height * .55 - rect.top, x2 = to.left - rect.left - 3, y2 = to.top + to.height * .55 - rect.top + offset;
      const bend = Math.max(14, (x2 - x1) * .5), active = edge.from === selectedKind || edge.to === selectedKind;
      return `<path data-chain-edge="${edge.from}:${edge.to}:${edge.cargo}" class="${active ? 'selected' : ''}" d="M${x1} ${y1} C${x1 + bend} ${y1},${x2 - bend} ${y2},${x2} ${y2}" marker-end="url(#chain-arrow${active ? '-selected' : ''})"><title>${escape(CARGO[edge.cargo].name)}: ${escape(INDUSTRIES[edge.from].name)} to ${escape(edge.to === 'towns' ? 'Towns' : INDUSTRIES[edge.to].name)}</title></path>`;
    }).join('')}`;
  }

  function drawSitesMap(canvas, sites) {
    const width = 560, height = Math.round(width * game.height / game.width);
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d'), sx = width / game.width, sy = height / game.height;
    const palettes = { taiga: { grass: '#a1b47b', forest: '#5f8050', sand: '#c9bc8a', snow: '#d4d8c6' }, tundra: { grass: '#b6c1a4', forest: '#748c75', sand: '#c5c4a4', snow: '#dce1cf' }, desert: { grass: '#aaa968', forest: '#7e935e', sand: '#cfb278', snow: '#ddd5ba' } };
    const palette = { ...palettes[game.biome], water: '#7eacae', river: '#7eacae', sea: '#759da4', lake: '#8ab2af', mountain: '#939785', rock: '#b0aa8f' };
    const terrain = document.createElement('canvas'); terrain.width = game.width; terrain.height = game.height;
    const ground = terrain.getContext('2d');
    for (let y = 0; y < game.height; y++) for (let x = 0; x < game.width; x++) {
      const tile = game.tiles[y * game.width + x]; ground.fillStyle = tile.road || tile.rail ? '#d3ccb1' : palette[tile.terrain] || palette.grass; ground.fillRect(x, y, 1, 1);
    }
    context.imageSmoothingEnabled = false; context.drawImage(terrain, 0, 0, width, height);
    for (const town of game.cities) { context.fillStyle = '#f1e5bc'; context.beginPath(); context.arc((town.x + .5) * sx, (town.y + .5) * sy, 3, 0, Math.PI * 2); context.fill(); }
    const pins = sites.map((site, index) => ({ site, index, x: Math.max(14, Math.min(width - 14, (site.x + .5) * sx)), y: Math.max(14, Math.min(height - 14, (site.y + .5) * sy)) }));
    context.font = 'bold 16px Arial'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.lineWidth = 3;
    for (const pin of pins) { context.beginPath(); context.arc(pin.x, pin.y, 13, 0, Math.PI * 2); context.fillStyle = '#b77a45'; context.fill(); context.strokeStyle = '#faf4dd'; context.stroke(); context.fillStyle = '#fff9e8'; context.fillText(String(pin.index + 1), pin.x, pin.y + .5); }
    canvas.addEventListener('click', event => {
      const rect = canvas.getBoundingClientRect(), x = (event.clientX - rect.left) / rect.width * width, y = (event.clientY - rect.top) / rect.height * height;
      const closest = pins.map(pin => ({ ...pin, distance: Math.hypot(pin.x - x, pin.y - y) })).sort((a, b) => a.distance - b.distance)[0];
      if (closest?.distance < 20) finish(onLocate, closest.site.id);
    });
  }

  render();
  container.closest('dialog')?.addEventListener('close', dispose, { once: true });
  return { dispose, getSelection: () => ({ cargo, industryKind: selectedKind }) };
}
