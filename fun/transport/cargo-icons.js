import { CARGO } from './data.js';

// A shared, outlined pictogram vocabulary. Shapes stay distinct without colour
// and the roomy 32px grid keeps the same marks readable in small recipe rows.
const ART = {
  passengers: `<circle cx="11" cy="9" r="4" fill="#e1b874"/><path d="M3.5 27v-6a7.5 7.5 0 0 1 15 0v6Z" fill="#799590"/><circle cx="23" cy="11" r="3.5" fill="#e1b874"/><path d="M21 19a6 6 0 0 1 8 5v3h-8" fill="#d5a875"/>`,
  timber: `<path d="m6 22 12-12q6-3 9 3L15 26Z" fill="#99764d"/><path d="m5 13 9-9q6-3 9 3l-9 9Z" fill="#a68151"/><ellipse cx="9" cy="15" rx="5" ry="4.5" transform="rotate(35 9 15)" fill="#dbc090"/><ellipse cx="11" cy="24" rx="5" ry="4.5" transform="rotate(35 11 24)" fill="#ddc397"/><path d="m18 17 7-7M17 10l3-3" stroke="#705638"/><path d="m7 15 3 1m-1 7 3 2" stroke="#9c774a"/>`,
  lumber: `<path d="m3 22 20-9 6 5-20 10Z" fill="#c39156"/><path d="m3 16 20-9 6 5-20 10Z" fill="#d6ad70"/><path d="m3 10 20-7 6 5-20 8Z" fill="#ead09d"/><path d="m9 16 20-8v4M9 22l20-10v6M9 28v-6M3 10v6m0 0v6" fill="none"/><path d="m11 10 9-3m-8 13 8-4" stroke="#ac824a"/>`,
  coal: `<path d="m3 23 2-9 7-3 7 8-1 8H7Z" fill="#53616a"/><path d="m14 13 3-8 8 2 4 8-8 7Z" fill="#667078"/><path d="m15 24 4-9 8 3 2 8-7 3Z" fill="#3e4d54"/><path d="m7 16 5 1 3 6m4-14 3 3m0 9 4 2" fill="none" stroke="#97a2a5"/>`,
  iron: `<path d="m3 23 4-13 9-6 9 5 4 14-8 5H10Z" fill="#a87964"/><path d="m7 10 8 5 10-6m-10 6 6 13m-6-13L3 23" fill="none" stroke="#795d50"/><path d="m10 9 5-3 3 2-5 4Zm7 11 6-5 2 3-6 6Z" fill="#cbd0c5"/><path d="m7 20 4-2 2 3-4 2Z" fill="#e2b194"/>`,
  steel: `<path d="m3 18 18-9 8 4-18 9Z" fill="#b7c7cf"/><path d="m11 22 18-9v4l-7 3v3l7-3v4l-18 8V28l6-3v-3l-6 3Z" fill="#879ca8" transform="translate(0 -3)"/><path d="m3 15 8 4v4l-3-1v3l3 1v3l-8-4v-3l3 1v-3l-3-1Z" fill="#b9cbd0"/><path d="m8 20 14-7" stroke="#dce7e6"/>`,
  grain: `<path d="M16 29V7M16 23 7 14m9 5 9-10" fill="none" stroke="#927237" stroke-width="2"/><path d="M16 11c-7-1-8-5-6-8 4 0 7 3 6 8ZM16 16c-8 1-11-3-10-7 5-1 9 2 10 7ZM16 22c-8 1-11-2-11-6 5-2 10 1 11 6ZM17 14c0-7 4-10 8-9 1 5-3 9-8 9ZM17 21c0-7 4-10 9-9 0 5-3 9-9 9Z" fill="#ddc16a"/>`,
  food: `<path d="M7 16c-4-7 3-12 7-7 4-5 11-1 8 6" fill="#cf8c66"/><path d="M19 14c-1-8 7-9 9-4 1 3-1 5-2 7" fill="#96ae70"/><path d="m13 9 2-5m-1 3 5-1" fill="none" stroke="#607b4a"/><path d="M3 15h26l-2 13H5Z" fill="#c69d64"/><path d="M5 20h22M6 24h20M10 16v11m12-11v11" fill="none" stroke="#866744"/>`,
  furniture: `<path d="M9 20V5q7-3 14 0v15" fill="#b68158"/><path d="M11 7h10v10H11Z" fill="#d8af77"/><path d="M5 20h22v5H5Z" fill="#c69663"/><path d="M8 25v4m16-4v4M7 19v-5m18 5v-5" fill="none" stroke-width="2.5"/>`,
  machinery: `<path d="m13 3 6 0 1 5 4-2 4 5-3 4 4 3-2 6-5-1-1 6h-7l-1-5-5 2-4-5 3-4-4-3 2-6 6 1Z" fill="#8da6b0"/><circle cx="16" cy="16" r="6" fill="#d9e3dc"/><circle cx="16" cy="16" r="2" fill="#536b73" stroke="none"/>`,
  fish: `<path d="M10 16 3 8v16l7-8ZM9 16C16 4 25 7 29 16c-4 9-13 12-20 0Z" fill="#8dc1ca"/><path d="m15 10 3-6 5 5m-7 14 4 5 3-6" fill="#b5d8d5"/><path d="M23 11c-3 3-3 7 0 10" fill="none"/><circle cx="25" cy="15" r="1.4" fill="#324c51" stroke="none"/>`,
  oil: `<path d="M7 6q9-5 18 0v21q-9 5-18 0Z" fill="#74767c"/><ellipse cx="16" cy="6" rx="9" ry="3" fill="#9fa3a5"/><path d="M7 12q9 4 18 0M7 23q9 4 18 0" fill="none" stroke="#c3c4ba"/><path d="M16 12c-1 3-4 5-4 8a4 4 0 0 0 8 0c0-3-3-5-4-8Z" fill="#34484c" stroke="#d7d5c5"/>`,
  fuel: `<path d="M8 9V4h11l4 5h2v19H7V9Z" fill="#c8ad68"/><path d="M11 9V7h6l2 2M23 9l4-3 2 3-4 3" fill="#e6d396"/><path d="m10 14 12 10m0-10L10 24" fill="none" stroke="#8f793f"/><path d="M12 4h6" fill="none" stroke-width="2.5"/>`,
  stone: `<path d="m3 21 5-8 10 1 3 10-7 4-10-2Z" fill="#a6a89b"/><path d="m14 15 4-9 8 1 4 10-6 7-7-3Z" fill="#c1c1b1"/><path d="m18 6 5 9 7 2M8 13l3 9 10 2" fill="none" stroke="#868f83"/><path d="m6 24 6 1m9-15 4 2" fill="none" stroke="#dfe0cb"/>`,
  sand: `<path d="m3 26 6-8 7-11 6 12 7 7q-12 5-26 0Z" fill="#dec38b"/><path d="m16 7-2 12-5 7m5-7 8 5" fill="none" stroke="#b49a61"/><path d="m18 14 2 6 5 6" fill="none" stroke="#f1dbae"/><path d="M3 29h2m20 0h3M6 21h1" fill="none"/>`,
  glass: `<path d="M4 4h18v22H4Z" fill="#a5cbc9"/><path d="M10 9h18v21H10Z" fill="#c0dfd8" fill-opacity=".85"/><path d="m14 19 10-6m-10 12 10-6M7 12l10-6" fill="none" stroke="#f8f7e8" stroke-width="2.5"/>`,
  copper: `<path d="m4 24 1-9 7-9 5 4 6-6 5 10-1 12-12 3Z" fill="#bd895e"/><path d="m5 15 7-9 2 14-10 4Zm9 5 9-16 2 12-10 13Z" fill="#d2a36f"/><path d="m23 4-1 13 5 9m-13-6 11-4M5 15l9 5" fill="none" stroke="#795d49"/><path d="m8 19 4-3m7 7 3-4" fill="none" stroke="#f0c598"/>`,
  wire: `<path d="M8 7h16v19H8Z" fill="#b57e57"/><path d="M9 10h14M9 14h14M9 18h14M9 22h14" fill="none" stroke="#ecc29a" stroke-width="2"/><ellipse cx="8" cy="16" rx="5" ry="12" fill="#d5b176"/><ellipse cx="24" cy="16" rx="5" ry="12" fill="#d5b176"/><ellipse cx="24" cy="16" rx="2" ry="5" fill="#867052"/><path d="M24 27q-1 4-8 2" fill="none" stroke="#b97c51" stroke-width="2"/>`,
  cement: `<path d="M9 4h14l-1 6 5 14q1 5-5 5H10q-6 0-5-5l5-14Z" fill="#d3cdb5"/><path d="M9 8h14M8 23h16" fill="none" stroke="#9c9b87"/><path d="M11 13h10v7H11Z" fill="#8c9d93"/><path d="M13 16h6m-6 2h4" fill="none" stroke="#eae5d3"/>`,
  goods: `<path d="m3 9 13-6 13 6v16l-13 5-13-5Z" fill="#b694b2"/><path d="m3 9 13 6 13-6M16 15v15" fill="none"/><path d="m10 6 13 6v7l-5 2v-7L5 8Z" fill="#e4cca0"/><path d="M6 18v4l5 2v-4Z" fill="#f0e8ce" stroke="none"/>`,
};

const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const cargoName = kind => Object.hasOwn(CARGO, kind) ? CARGO[kind].name : 'Cargo';
const countText = value => typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value) : String(value);

export function cargoIcon(kind, { decorative = false } = {}) {
  const name = escape(cargoName(kind));
  return `<svg class="cargo-icon" data-cargo-icon="${escape(kind)}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="#475a52" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" focusable="false" ${decorative ? 'aria-hidden="true"' : `role="img" aria-label="${name}"`}><title>${name}</title>${Object.hasOwn(ART, kind) ? ART[kind] : ART.goods}</svg>`;
}

export function cargoBadge(kind, { count, label = false } = {}) {
  const name = cargoName(kind), hasCount = count !== undefined && count !== null;
  const number = hasCount ? countText(count) : '', description = hasCount ? `${number} ${name}` : name;
  return `<span class="cargo-badge" data-cargo="${escape(kind)}" role="img" title="${escape(description)}" aria-label="${escape(description)}">${cargoIcon(kind, { decorative: true })}${label ? `<span class="cargo-label">${escape(name)}</span>` : ''}${hasCount ? `<span class="cargo-count">${escape(number)}</span>` : ''}</span>`;
}

export function cargoRecipe(inputs = {}, outputs = {}, { counts = true, labels = false } = {}) {
  const incoming = Object.entries(inputs), outgoing = Object.entries(outputs);
  const badges = entries => entries.map(([kind, count]) => cargoBadge(kind, { count: counts ? count : undefined, label: labels })).join('');
  const describe = entries => entries.map(([kind, count]) => `${counts ? `${countText(count)} ` : ''}${cargoName(kind)}`).join(', ');
  const description = `${incoming.length ? `Consumes ${describe(incoming)}; ` : ''}produces ${describe(outgoing)}`;
  return `<span class="cargo-recipe" role="img" aria-label="${escape(description)}">${incoming.length ? `<span class="cargo-inputs">${badges(incoming)}</span>` : ''}<span class="cargo-result">${incoming.length ? '<span class="cargo-arrow" aria-hidden="true">→</span>' : ''}<span class="cargo-outputs">${badges(outgoing)}</span></span></span>`;
}
