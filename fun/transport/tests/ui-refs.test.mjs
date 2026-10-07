// References and the line language (DESIGN.md 7, 8 and 10), as strings: no DOM. The markup contract for every kind and
// variant, the gone state, templates with missing ids, bullet shapes, the strip's capsule cap, frames and glide timing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ref, renderTemplate, resolveRef, parseRef, vehicleLabel, REF_KINDS } from '../ui-refs.js';
import { bullet, roundel, strip, ladder, STRIP_CAPSULES } from '../ui-line.js';
import { cameraDuration, reducedMotion } from '../ui-motion.js';
import { GLYPHS } from '../ui-icons.js';
import { token } from '../copy.js';

const path = (x0, y0, x1) => Array.from({ length: x1 - x0 + 1 }, (_, i) => ({ x: x0 + i, y: y0 }));
const game = () => ({
  routes: [
    { id: 'route-4', number: 2, name: 'Stone quarry to Alderbrook', mode: 'road', cargo: 'stone', color: '#2D5DA8', stops: ['station-7', 'station-1'], path: [...path(10, 10, 20), { x: 20, y: 11 }, { x: 20, y: 12 }], active: true },
    { id: 'route-9', number: 14, name: 'Alderbrook – Pinehaven', mode: 'rail', cargo: 'passengers', color: '#EFC16F', stops: ['station-1', 'station-8'], path: path(20, 12, 44) },
  ],
  stations: [
    { id: 'station-7', name: 'Quarry yard', x: 10, y: 10, mode: 'road' },
    { id: 'station-1', name: 'Alderbrook Central', x: 20, y: 12, mode: 'road' },
    { id: 'station-8', name: 'Pinehaven <East>', x: 44, y: 12, mode: 'rail' },
    { id: 'station-11', name: 'North airport', x: 60, y: 40, mode: 'air', axis: 'x' },
    { id: 'station-12', name: 'South airport', x: 70, y: 80, mode: 'air', axis: 'y' },
  ],
  cities: [{ id: 'city-1', name: 'Alderbrook', x: 22, y: 14 }, { id: 'city-2', name: 'Pinehaven', x: 46, y: 9 }],
  industries: [{ id: 'industry-12', kind: 'quarry', name: 'Stone quarry', x: 6, y: 7, footprint: 2 }, { id: 'industry-13', kind: 'steel-mill', x: 90, y: 30, footprint: 3 }],
  vehicles: [
    { id: 'vehicle-3', routeId: 'route-4', x: 12.5, y: 10, progress: 2.5, load: 10, capacity: 24 },
    { id: 'vehicle-5', routeId: 'route-4', x: 16, y: 10, progress: 6, load: 0, capacity: 24 },
  ],
});
const attrs = html => Object.fromEntries([...html.match(/^<\w+([^>]*)>/)[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));

test('a reference is one button: the kind mark, the escaped label, data-ref and "<name>, <kind>"', () => {
  const g = game(), route = g.routes[0];
  const cases = {
    route: [ref('route', route.id, route.name, { route }), 'bullet bullet--road', 'Stone quarry to Alderbrook, route 2'],
    stop: [ref('stop', 'station-7', 'Quarry yard'), 'roundel', 'Quarry yard, stop'],
    town: [ref('town', 'city-1', 'Alderbrook'), 'class="i i16"', 'Alderbrook, town'],
    industry: [ref('industry', 'industry-12', 'Stone quarry', { cargo: 'stone' }), 'data-cargo-icon="stone"', 'Stone quarry, industry'],
    vehicle: [ref('vehicle', 'vehicle-3', 'Truck 1', { route, mode: 'road', cargo: 'stone' }), 'bullet bullet--road bullet--16', 'Truck 1, vehicle'],
    cargo: [ref('cargo', 'stone', 'Stone'), 'data-cargo-icon="stone"', 'Stone, cargo'],
  };
  assert.deepEqual(Object.keys(cases), REF_KINDS);
  for (const [kind, [html, mark, name]] of Object.entries(cases)) {
    const a = attrs(html);
    assert.match(html, /^<button type="button" class="ref ref--prose"/, `${kind} is a prose button`);
    assert.equal(a['data-ref'], `${kind}:${kind === 'route' ? route.id : { stop: 'station-7', town: 'city-1', industry: 'industry-12', vehicle: 'vehicle-3', cargo: 'stone' }[kind]}`);
    assert.equal(a['aria-label'], name);
    assert.ok(html.includes('<span class="ref-mark">') && html.includes(mark), `${kind} leads with its mark: ${html}`);
    assert.ok(html.includes(`<span class="ref-label">${name.split(',')[0]}</span>`), `${kind} shows its label`);
    assert.doesNotMatch(html, /<button[^>]*>[\s\S]*<button/, 'never a button inside a button');
  }
  assert.match(cases.town[0], /<svg class="i i16"[^>]*aria-hidden="true"/, 'the mark is decorative: the button carries the name');
  assert.match(cases.vehicle[0], /<span class="ref-label">Truck 1<\/span><span class="bullet[^"]*"[^>]*aria-hidden="true"/, 'a vehicle names its route with a small bullet after the label');
  assert.ok(cases.vehicle[0].includes(GLYPHS.truck), 'a freight vehicle leads with the truck glyph');
  assert.ok(ref('vehicle', 'vehicle-9', 'Train 1', { mode: 'rail' }).includes(GLYPHS.train), 'a train leads with the train glyph');
  assert.match(ref('industry', 'industry-13', 'Steel mill'), /class="i i16"/, 'an industry without a cargo falls back to the industry glyph');
  const hostile = ref('stop', 'station-8', 'Pinehaven <East> & "Co"');
  assert.ok(hostile.includes('Pinehaven &lt;East&gt; &amp; &quot;Co&quot;') && !hostile.includes('<East>'), 'labels and names are escaped');
  assert.equal(attrs(ref('stop', 'a"b', 'X'))['data-ref'], 'stop:a&quot;b', 'ids are escaped');
});

test('variants: prose, row, compact and on ink; compact shows the mark only', () => {
  const route = game().routes[0], classes = html => attrs(html).class;
  assert.equal(classes(ref('town', 'city-1', 'Alderbrook')), 'ref ref--prose');
  assert.equal(classes(ref('town', 'city-1', 'Alderbrook', { variant: 'row' })), 'ref ref--row');
  assert.equal(classes(ref('route', route.id, route.name, { variant: 'compact', route })), 'ref ref--compact');
  assert.equal(classes(ref('town', 'city-1', 'Alderbrook', { variant: 'onInk' })), 'ref ref--prose ref--on-ink');
  assert.equal(classes(ref('route', route.id, route.name, { variant: 'compact', route, onInk: true })), 'ref ref--compact ref--on-ink');
  const compact = ref('route', route.id, route.name, { variant: 'compact', route });
  assert.doesNotMatch(compact, /ref-label/, 'a compact reference is its mark');
  assert.equal(attrs(compact)['aria-label'], 'Stone quarry to Alderbrook, route 2', 'and keeps the full name for assistive technology');
  assert.match(ref('route', route.id, route.name, { variant: 'row', route }), /bullet bullet--road"/, 'rows take the 20 px bullet');
  assert.match(ref('route', route.id, route.name, { route }), /bullet bullet--road bullet--16"/, 'prose takes the 16 px bullet');
  assert.match(ref('town', 'city-1', 'Alderbrook', { variant: 'row', after: '<span class="row-extra">740</span>' }), /<span class="ref-label">Alderbrook<\/span><span class="row-extra">740<\/span><\/button>$/, 'a row holds the rest of its line inside the reference');
});

test('a reference to something that no longer exists is plain text', () => {
  assert.equal(ref('route', 'route-77', 'Coal run', { gone: true }), '<span class="ref--gone">Coal run</span>');
  assert.equal(ref('town', '', 'Birchmere'), '<span class="ref--gone">Birchmere</span>', 'no id is gone too');
  assert.equal(ref('stop', null, '<b>'), '<span class="ref--gone">&lt;b&gt;</span>');
});

test('renderTemplate turns tokens into references and missing ids into plain words', () => {
  const g = game(), html = renderTemplate(`${token('route', 'route-4')} lost its link near ${token('town', 'city-1')}: ${token('money', -154)} on ${token('date', 40)}, ${token('cargo', 'stone')} & more.`, g);
  assert.match(html, /^<button type="button" class="ref ref--prose" data-ref="route:route-4"/);
  assert.match(html, /data-ref="town:city-1" aria-label="Alderbrook, town"/);
  assert.match(html, /data-ref="cargo:stone" aria-label="stone, cargo"/);
  assert.ok(html.includes(': −$154 on 10 Feb 1950, ') && html.includes('&amp; more.'), 'money, dates and plain text read as copy.js writes them, escaped');
  const missing = renderTemplate(`${token('route', 'route-404')} and ${token('stop', 'station-404')} near ${token('town', 'city-404')}, ${token('industry', 'industry-404')}, ${token('vehicle', 'vehicle-404')} and ${token('cargo', 'unobtainium')}.`, g);
  assert.doesNotMatch(missing, /<button/, 'nothing missing is clickable');
  assert.equal(missing.match(/class="ref--gone"/g).length, 6);
  assert.match(missing, /a retired route<\/span> and <span class="ref--gone">a removed stop<\/span>/);
  assert.equal(renderTemplate('No tokens <here>.', g), 'No tokens &lt;here&gt;.');
  assert.equal(renderTemplate(undefined, g), '');
  assert.match(renderTemplate(token('town', 'city-2'), g, { onInk: true }), /class="ref ref--prose ref--on-ink"/, 'toasts ask for references on ink');
  assert.match(renderTemplate(token('industry', 'industry-12'), g), /data-cargo-icon="stone"/, 'an industry wears its output cargo');
  assert.match(renderTemplate(token('industry', 'industry-13'), g), /aria-label="Steel mill, industry"/, 'an unnamed industry takes its kind name');
  assert.match(renderTemplate(token('vehicle', 'vehicle-5'), g), /aria-label="Truck 2, vehicle"/, 'a vehicle is named by its place in its route');
});

test('bullets: shape by mode, the line colour inline, 16 or 20 px and wider for two or more digits', () => {
  const b = route => attrs(bullet(route));
  for (const mode of ['road', 'rail', 'water', 'air']) assert.equal(b({ mode, number: 3, color: '#B8323F' }).class, `bullet bullet--${mode}`);
  assert.equal(b({ number: 3 }).class, 'bullet bullet--road', 'a route without a mode is a road bullet');
  assert.equal(b({ mode: 'rail', number: 12, color: '#EFC16F' }).class, 'bullet bullet--rail bullet--wide bullet--light', 'two digits stretch it; a light fill takes the ink edge');
  assert.equal(b({ mode: 'air', number: 1234 }).class, 'bullet bullet--air bullet--wide');
  assert.equal(attrs(bullet({ mode: 'water', number: 5 }, { size: 16 })).class, 'bullet bullet--water bullet--16');
  assert.equal(b({ number: 2, color: '#2D5DA8' }).style, '--c:var(--line-1);--on:var(--line-1-on)', 'colours are the line tokens lineFor picks');
  assert.equal(b({ number: 2, color: '#69c6bc' }).style, '--c:var(--line-1);--on:var(--line-1-on)', 'a legacy hex maps to its line');
  assert.equal(b({ number: 2, color: '#d893b1' }).style, '--c:var(--line-6);--on:var(--line-6-on)');
  assert.match(bullet({ number: 27 }), />27<\/span><\/span>$/, 'the numeral is route.number');
  assert.equal(b({ number: 2 })['aria-label'], 'Route 2', 'alone it is named');
  assert.equal(b({ number: 2 }).role, 'img');
  assert.equal(attrs(bullet({ number: 2 }, { named: true }))['aria-hidden'], 'true', 'beside a name it is decoration');
  assert.equal(attrs(bullet({ number: 0 })).class, 'bullet bullet--road', 'an invalid number draws no numeral');
  assert.match(roundel(), /^<span class="roundel" aria-hidden="true"><\/span>$/);
  assert.match(roundel({ unused: true }), /class="roundel roundel--unused"/);
});

test('the strip places capsules by progress, caps them at eight and adds +N', () => {
  const g = game(), route = g.routes[0], length = route.path.length - 1, stops = route.stops.map(id => g.stations.find(s => s.id === id));
  const vehicles = Array.from({ length: 11 }, (_, i) => ({ progress: i * length / 10, load: i % 2 ? 0 : 5 }));
  const html = strip({ route, stops, vehicles, waiting: [48, 0] });
  assert.equal(STRIP_CAPSULES, 8);
  assert.equal(html.match(/class="strip__vehicle[ "]/g).length, 8, 'at most eight capsules');
  assert.match(html, /<span class="strip__more"[^>]*>\+3<\/span>/, 'then a +N tag');
  assert.equal(html.match(/strip__vehicle--loaded/g).length, 4, 'loaded capsules are filled');
  const lefts = [...html.matchAll(/class="strip__vehicle[^"]*" style="left:([\d.]+)%"/g)].map(match => Number(match[1]));
  assert.deepEqual(lefts, [0, 10, 20, 30, 40, 50, 60, 70], 'each capsule sits at its progress along the path length');
  assert.match(html, /^<div class="strip strip--road" style="--c:var\(--line-1\);--on:var\(--line-1-on\)">/);
  assert.equal(html.match(/class="strip__stop"/g).length, 2, 'a roundel at each end');
  assert.match(html, /class="strip__waiting strip__waiting--start" style="left:0%"><span class="cargo-tile">[\s\S]*?<\/span><span data-num>48<\/span>/, 'waiting cargo sits above its stop with a cargo tile and the count');
  assert.equal(html.match(/class="strip__waiting/g).length, 1, 'no count where nothing waits');
  assert.equal(html.match(/strip__chevron/g).length, 3, 'freight shows three chevrons');
  assert.match(html, /role="img" aria-label="Quarry yard to Alderbrook Central\. 11 trucks, 6 loaded\. 48 stone waiting at Quarry yard\."/);
  assert.match(html, /<span class="strip__name">Quarry yard<\/span><span class="strip__name">Alderbrook Central<\/span>/, 'the end names sit underneath');
  assert.match(strip({ route, stops, label: stop => `<b>${stop.id}</b>` }), /<span class="strip__name"><b>station-7<\/b><\/span>/, 'surfaces pass stop references as labels');
  const passengers = strip({ route: g.routes[1], stops: g.routes[1].stops.map(id => g.stations.find(s => s.id === id)) });
  assert.doesNotMatch(passengers, /strip__chevron/, 'two-way passenger routes have no chevrons');
  assert.match(passengers, /Pinehaven &lt;East&gt;/);
  const broken = strip({ route, stops, broken: .4 });
  assert.match(broken, /class="strip__gap" style="left:34%;right:54%"/, 'a broken line stops at the break and dashes the gap');
  assert.ok(broken.includes('class="strip__cut" style="left:40%">') && broken.includes(GLYPHS.broken), 'the cut wears the broken glyph');
  assert.match(broken, /The line is cut\./);
  const proposed = strip({ route: { mode: 'rail', cargo: 'coal' }, stops, proposed: true });
  assert.match(proposed, /^<div class="strip strip--rail strip--proposed">/, 'a proposed strip has no line colour yet');
  assert.doesNotMatch(proposed, /strip__vehicle|strip__chevron/);
});

test('the ladder marks done, current and next steps and dashes into a new part', () => {
  const html = ladder({ steps: [{ label: 'Place a stop', done: true, meta: '12 Jan 1950' }, { label: 'Launch <route>', part: 1 }, { label: 'First 100 deliveries', part: 2 }] });
  assert.match(html, /^<ol class="ladder">/);
  assert.deepEqual([...html.matchAll(/<li class="([^"]+)"/g)].map(match => match[1]), ['ladder__step ladder__step--done', 'ladder__step ladder__step--current', 'ladder__step ladder__step--next ladder__step--part']);
  assert.match(html, /Launch &lt;route&gt;/);
  assert.match(html, /<span class="ladder__meta">12 Jan 1950<\/span>/);
  assert.match(html, /ladder__step--done"><span class="ladder__node"><svg class="i i16"/, 'a done step is a check');
  assert.match(ladder({ steps: [{ label: 'A', done: true }, { html: '<b>B</b>', current: true }] }), /<span class="ladder__label"><b>B<\/b><\/span>/, 'steps may carry references as markup');
});

test('resolveRef frames a route, a footprint, a town, a stop, an airport and a vehicle', () => {
  const g = game();
  assert.deepEqual(parseRef('town:city-1'), { kind: 'town', id: 'city-1' });
  assert.deepEqual(parseRef({ kind: 'stop', id: 'station-7' }), { kind: 'stop', id: 'station-7' });
  assert.equal(parseRef('nonsense'), null);
  const route = resolveRef(g, 'route:route-4');
  assert.deepEqual({ ...route, entity: undefined }, { exists: true, kind: 'route', id: 'route-4', label: 'Stone quarry to Alderbrook', entity: undefined, frame: { x0: 10, y0: 10, x1: 20, y1: 12, cx: 15.5, cy: 10.5 } }, 'a route frames its path, centred on its projected extent');
  assert.deepEqual(resolveRef(g, 'industry:industry-12').frame, { x0: 6, y0: 7, x1: 7, y1: 8 }, 'an industry frames its footprint');
  assert.deepEqual(resolveRef(g, 'town:city-1').frame, { x0: 18, y0: 10, x1: 26, y1: 18, cx: 22, cy: 14 }, 'a town frames its centre plus or minus 4 tiles');
  assert.deepEqual(resolveRef(g, 'stop:station-7').frame, { x0: 10, y0: 10, x1: 10, y1: 10 });
  assert.deepEqual(resolveRef(g, 'stop:station-11').frame, { x0: 60, y0: 40, x1: 65, y1: 41 }, 'an airport covers its 6 × 2 site');
  assert.deepEqual(resolveRef(g, 'stop:station-12').frame, { x0: 70, y0: 80, x1: 71, y1: 85 });
  assert.deepEqual(resolveRef(g, 'vehicle:vehicle-3').frame, { x0: 12.5, y0: 10, x1: 12.5, y1: 10 });
  assert.deepEqual(resolveRef(g, 'vehicle:vehicle-3', { vehiclePoint: () => ({ x: 30.25, y: 7.5 }) }).frame, { x0: 30.25, y0: 7.5, x1: 30.25, y1: 7.5 }, 'a plane in flight takes the renderer’s point');
  assert.equal(resolveRef(g, 'vehicle:vehicle-3').label, 'Truck 1');
  assert.equal(vehicleLabel(g, g.vehicles[1]), 'Truck 2');
  assert.deepEqual(resolveRef(g, 'cargo:stone'), { exists: true, kind: 'cargo', id: 'stone', label: 'stone', entity: null, frame: null });
  for (const missing of ['route:route-1', 'town:city-9', 'stop:station-99', 'industry:x', 'vehicle:v', 'cargo:gold']) assert.equal(resolveRef(g, missing).exists, false, missing);
  assert.equal(resolveRef(g, 'meadow:1').exists, false);
});

test('glides last 280 ms plus 60 ms a screen up to 480 ms, and cut under reduced motion', () => {
  const saved = globalThis.matchMedia;
  try {
    globalThis.matchMedia = undefined;
    assert.equal(reducedMotion(), false);
    assert.deepEqual([0, 1, 2, 3, 3.5, 10, -1].map(cameraDuration), [280, 340, 400, 460, 480, 480, 280]);
    let reduce = true;
    globalThis.matchMedia = query => ({ matches: query === '(prefers-reduced-motion: reduce)' && reduce });
    assert.equal(reducedMotion(), true);
    assert.deepEqual([0, 1, 3].map(cameraDuration), [0, 0, 0], 'reduced motion cuts');
    reduce = false;
    assert.equal(cameraDuration(1), 340, 'the check is live, not read once');
  } finally { globalThis.matchMedia = saved; }
});

test('refs.css holds every class DESIGN.md 16.3 gives it, from tokens only', () => {
  const css = readFileSync(new URL('../refs.css', import.meta.url), 'utf8'), design = readFileSync(new URL('../DESIGN.md', import.meta.url), 'utf8');
  const row = design.split('\n').find(line => line.startsWith('| `refs.css` |') && line.includes('`.ref`'));
  // '--x' extends the last named class without its modifier, '__x' the block: `.ladder__step--done`, `--current` is .ladder__step--current.
  let base = '', block = '';
  const classes = [...row.split('|')[2].matchAll(/`([.\w-]+)`/g)].map(([, name]) => name.startsWith('.') ? (base = name.replace(/--[\w-]*$/, ''), block = name.replace(/(__|--).*$/, ''), name) : (name.startsWith('__') ? block : base) + name);
  assert.ok(classes.length >= 30, classes.join());
  for (const name of classes) assert.match(css, new RegExp(`\\${name.replace(/-/g, '\\-')}(?![\\w-])`), `${name} is styled`);
  assert.match(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), /href="\.\/components\.css">\n\s*<link rel="stylesheet" href="\.\/refs\.css">/, 'refs.css loads right after components.css');
});
