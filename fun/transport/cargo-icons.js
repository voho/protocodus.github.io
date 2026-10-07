import { CARGO } from './data.js';
import { escapeHTML as escape } from './copy.js';

// Fresh material pictograms use broad forms, a fixed upper-left light and the
// same warm neutral material palette as the map. Empty space stays transparent.
const shape=(d,fill)=>`<path d="${d}" fill="${fill}"/>`;
const line=d=>`<path d="${d}" fill="none"/>`;
const disk=(x,y,r,fill)=>`<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;
const block=(top='#d5bd8e',left='#b0956a',right='#8d7c61')=>shape('M4 11 16 5l12 6-12 6Z',top)+shape('M4 11v13l12 6V17Z',left)+shape('M16 17v13l12-6V11Z',right);
const ore=(light,mid,dark)=>shape('M3 22 7 13l9-7 11 9 2 10-13 5Z',mid)+shape('M7 13 16 6l3 13-16 3Z',light)+shape('M19 19 27 15l2 10-13 5Z',dark);
const sack=(paper,band)=>shape('M9 4h14l-2 6 6 14-3 6H8l-3-6 6-14Z',paper)+shape('M8 17h16v7H8Z',band)+line('M10 9h12');
const barrel=(body,top)=>shape('M6 8h20v18c-6 4-14 4-20 0Z',body)+`<ellipse cx="16" cy="8" rx="10" ry="4" fill="${top}"/>`+line('M6 15c6 4 14 4 20 0M6 23c6 4 14 4 20 0');
const ART = {
  passengers:disk(12,8,4,'#c2a269')+shape('M4 28v-9c0-6 16-6 16 0v9Z','#758f89')+disk(24,11,3,'#d9c39b')+shape('M23 18c6 0 7 4 6 10h-6Z','#996b63'),
  mail:shape('M4 9 23 4l6 7-18 6Z','#c7bca5')+shape('M3 12h24v16H3Z','#f0e9d6')+line('M3 12l12 9 12-9M3 28l8-9M27 28l-8-9')+shape('M22 14h3v4h-3Z','#996b63'),
  timber:shape('M4 16 21 7l7 4v10l-17 9-7-4Z','#997a5b')+shape('M4 16l7 4 17-9-7-4Z','#c7b18b')+line('M11 20v10M7 15l7 4M10 13l7 4M14 11l7 4')+disk(8,23,2,'#dfcea9'),
  lumber:shape('M3 10 23 3l6 4-20 8Z','#e3d7b7')+shape('M3 10v5l6 4 20-8V7l-20 8Z','#c2a269')+shape('M3 19 23 12l6 4v5L9 29l-6-5Z','#997a5b')+line('M3 19l6 5 20-8M9 24v5'),
  coal:ore('#7b8583','#536762','#344942'),iron:ore('#c7a084','#ac826d','#7c6157'),stone:ore('#d9d4bd','#b3b5a5','#87998a'),copper:ore('#d8b184','#b1846c','#91775f'),
  steel:block('#c3d1c8','#899e98','#697780')+line('M4 15l12 6 12-6M4 21l12 6 12-6'),
  grain:shape('M16 29V6M16 24 7 16M16 18l9-8','#c2a269')+line('M16 29V6M16 24 7 16M16 18l9-8')+shape('M15 13C8 13 7 8 9 5c5 0 7 4 6 8ZM15 22C7 22 4 17 5 14c6-1 10 4 10 8ZM17 16c-1-7 3-11 8-10 0 6-3 9-8 10ZM17 24c-1-7 3-11 9-10 0 6-4 10-9 10Z','#d7ba79'),
  food:sack('#e3d7b7','#899265')+disk(16,20,3,'#c2a269'),
  furniture:shape('M8 5l13-3 4 3v15l-4 3-13-4Z','#997a5b')+shape('M4 18l18-4 7 5-18 5Z','#c2a269')+shape('M4 18v7l7 5v-6l18-5v6l-3 2v-5l-15 5v3l-4-2v-6Z','#b1846c')+line('M12 7v9M17 6v9'),
  machinery:shape('M9 8 20 4l8 4v14l-12 7-13-7V12Z','#899e98')+shape('M9 8l7 4 12-4-8-4Z','#c4cfc1')+disk(11,19,5,'#6c7878')+disk(11,19,2,'#e3d7b7')+line('M19 16l6-3M19 21l6-3'),
  fish:shape('M9 17 3 10v14l6-7C15 7 25 8 29 17c-5 9-14 10-20 0Z','#88a5a4')+shape('M14 11l5-6 4 5M15 24l6 5 2-7','#c1cbbb')+disk(25,16,1,'#4b5954')+line('M22 12c-3 3-3 7 0 10'),
  oil:barrel('#697780','#aab9b2')+shape('M16 13c-1 3-4 5-4 8a4 4 0 0 0 8 0c0-3-3-5-4-8Z','#344942'),
  fuel:shape('M8 4h11l5 6h3v19H5V10h3ZM11 7v3h8l-3-3Z','#c2a269')+line('M9 15l14 10M23 15 9 25')+shape('M23 8l4-4 3 3-4 4Z','#997a5b'),
  sand:shape('M2 25 9 18l7-13 8 15 6 5-14 5Z','#d8c49b')+shape('M16 5 13 23l-5 4 8 3 14-5-6-5Z','#c2a269'),
  glass:shape('M4 8l16-5 1 22-17 5Z','#759c9a')+shape('M11 10l16-5 2 23-17 3Z','#b1c8bb')+line('M15 17l9-7M15 25l10-7'),
  wire:barrel('#b1846c','#c2a269')+line('M7 12c6 4 12 4 18 0M7 18c6 4 12 4 18 0')+disk(16,8,2,'#6c7878')+line('M25 26l4 2-4 2'),
  cement:sack('#c7bca5','#697780'),goods:block('#d4bfaf','#ac8e86','#996b63')+shape('M10 8l12 6v7l-5 2v-7L5 10Z','#e3d7b7'),
  milk:shape('M7 4h8v5l3 7v13H4V16l3-7Z','#f0e9d6')+shape('M7 4h8v4H7ZM4 19h14v6H4Z','#88a5a4')+shape('M23 8h5v6l2 5v10H20V19l3-5Z','#c7d4c7'),
  produce:shape('M3 17h26v12H3Z','#c2a269')+line('M3 23h26M9 17v12M23 17v12')+disk(10,13,5,'#a76f51')+disk(21,13,5,'#899265')+line('M10 8V4M21 8l3-5'),
  livestock:shape('M5 12h16l6 7v9h-5v-7H10v7H5Z','#e3d7b7')+shape('M19 7h8l3 5-3 8h-9l-2-8Z','#c7bca5')+shape('M9 12h5v6H9Z','#997a5b')+disk(24,12,1,'#4b5954')+line('M19 8l-3-5M27 8l3-4'),
  property:shape('M3 14 15 4l10 8-12 5Z','#a76f51')+shape('M5 15v11l8 4V17ZM13 17v13l10-5V14Z','#e3d7b7')+disk(24,23,6,'#c2a269')+disk(24,23,3,'#e3d7b7'),
};

const cargoName = kind => Object.hasOwn(CARGO, kind) ? CARGO[kind].name : kind === 'property' ? 'Rent' : 'Cargo';
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
