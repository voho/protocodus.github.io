// Run this reference renderer only from the browser-owning QA process. Upright
// airport parts are isolated at one shared physical density, never fitted.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import {
  AIRPORT_BUILDING_ART, AIRPORT_BUILDING_CENTRES, AIRPORT_BUILDING_SLOTS,
} from '../airport-building-art.js';
import { buildingGenerationPrompt, SPRITE_SCALE } from '../sprite-art-direction.js';

const output = resolve(process.argv[2] || '/tmp/transport-airport-art');
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const dimensions = {
  tower: { widthMetres: 5.44, depthMetres: 5.44, roofHeightMetres: 30.3, antennaHeightMetres: 4.75 },
  terminal: { widthMetres: 16.96, depthMetres: 10.88, wingHeightMetres: 7, hallHeightMetres: 11 },
  hangar: { widthMetres: 9.6, depthMetres: 10.56, wallHeightMetres: 6, roofHeightMetres: 10 },
  depot: { widthMetres: 9.6, depthMetres: 8.32, bundHeightMetres: .8, tankHeightMetres: 3.5 },
};
const descriptions = {
  tower: 'Airport control tower: exact 5.44m square brick base, narrow pale shaft, projecting observation balcony and glazed control cab, dark roof at 30.3m above the ground, and a 4.75m antenna above that roof. Preserve the tall slender native silhouette and all ground-axis dimensions. Any ordinary personnel door is 2.1m high, not a monumental entrance.',
  terminal: 'Airport passenger terminal: exact 16.96m by 10.88m wing, wing roof 7m above the ground, raised central glazed hall 11m high. Pale warm walls, broad muted green glazing, brick lower wall and one broad orange entrance canopy. Keep the native wings, hall, roof and canopy dimensions. Keep the ordinary personnel door at 2.1m: its visible leaf must be 16.8 reference pixels tall. Larger public glazing and canopy openings do not change the door leaf scale. Simplify glazing to broad panes; remove roof spectators, lettering and dense railings.',
  hangar: 'Airport aircraft hangar: exact 9.6m by 10.56m base, 6m walls and gently bowed roof reaching 10m above the ground. Muted metal shell and one clearly large aircraft opening, approximately 5.25m high, which is an aircraft bay rather than a personnel door. Keep its native barrel-roof profile, ground rectangle and broad sliding-door mass. No dense corrugation or fine door grid. Any added ordinary personnel door is only 2.1m high.',
  depot: 'Airport fuel depot: exact 9.6m by 8.32m purpose-built containment bund, 0.8m high, containing the two native pale cylindrical fuel tanks, each 3.5m high above the bund. Preserve both tank positions, muted orange tank bands, native tank width and elliptical tops. The containment surface is useful built infrastructure and remains opaque; every bare-ground pixel outside it is transparent. No decorative tiny pipes or invented buildings.',
};
const entries = AIRPORT_BUILDING_SLOTS.map(slot => ({
  ...slot,
  name: `${slot.kind}, airport axis ${slot.axis}`,
  localCenter: AIRPORT_BUILDING_CENTRES[slot.kind],
  physicalDimensions: dimensions[slot.kind],
  description: `${descriptions[slot.kind]} Airport axis ${slot.axis}: preserve this cell's native orientation exactly; the second row swaps the world axes without rotating the camera.`,
}));
const job = {
  id: AIRPORT_BUILDING_ART.id,
  type: 'airport-components',
  columns: AIRPORT_BUILDING_ART.columns,
  rows: AIRPORT_BUILDING_ART.rows,
  cellPixels: AIRPORT_BUILDING_ART.referenceCellPixels,
  biome: 'taiga',
  componentFrame: {
    worldPixels: AIRPORT_BUILDING_ART.worldFramePixels,
    groundCenterCell: [...AIRPORT_BUILDING_ART.groundCenterSource],
  },
  sourcePixelsPerWorldPixel: AIRPORT_BUILDING_ART.referencePixelsPerWorldPixel,
  sourcePixelsPerMetre: SPRITE_SCALE.worldPixelsPerMetre * AIRPORT_BUILDING_ART.referencePixelsPerWorldPixel,
  personnelDoorHeightPixels: SPRITE_SCALE.doorHeightMetres * SPRITE_SCALE.worldPixelsPerMetre * AIRPORT_BUILDING_ART.referencePixelsPerWorldPixel,
  entries,
  destination: resolve('fun/transport/assets/world/airport-buildings-v2'),
  reference: join(output, 'guide.png'),
};
job.prompt = buildingGenerationPrompt({
  ...job,
  direction: 'Paint the supplied construction atlas in the shared quiet hand-painted architectural style. The guide supplies the exact component geometry, physical camera and common density. Keep its cell placement, full height, ground centre and both ground axes; keep every component separate inside its own 384px cell. Keep the terminal personnel door leaf at the canonical 2.1m height. Preserve component dimensions instead of filling the independent square-parcel envelope. No backdrop, grass patch, ground card, people, red/yellow construction marks or dense surface noise. All eight cells remain RGBA cutouts with transparent bare ground.',
});
await mkdir(output, { recursive: true });
await writeFile(join(output, 'job.json'), `${JSON.stringify(job, null, 2)}\n`);
await writeFile(join(output, 'prompt.txt'), `${job.prompt}\n`);

const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route('**/*.png', route => route.abort());
  await page.route('**/airport-building-guide', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><canvas></canvas>',
  }));
  await page.goto(new URL('airport-building-guide', base).href);
  const result = await page.evaluate(async job => {
    const { drawTower, drawTerminal, drawHangar, drawDepot, localToProjected } = await import('./airport-art.js');
    const painters = { tower: drawTower, terminal: drawTerminal, hangar: drawHangar, depot: drawDepot };
    const canvas = document.querySelector('canvas');
    canvas.width = job.columns * job.cellPixels;
    canvas.height = job.rows * job.cellPixels;
    const c = canvas.getContext('2d');
    c.clearRect(0, 0, canvas.width, canvas.height);
    for (const [index, entry] of job.entries.entries()) {
      const offsetX = index % job.columns * job.cellPixels;
      const offsetY = Math.floor(index / job.columns) * job.cellPixels;
      const p = localToProjected(entry.axis, entry.localCenter.u, entry.localCenter.v);
      c.save();
      c.beginPath();
      c.rect(offsetX, offsetY, job.cellPixels, job.cellPixels);
      c.clip();
      c.translate(offsetX + job.componentFrame.groundCenterCell[0], offsetY + job.componentFrame.groundCenterCell[1]);
      c.scale(job.sourcePixelsPerWorldPixel, job.sourcePixelsPerWorldPixel);
      c.translate(-p.x, -p.y);
      painters[entry.kind](c, { axis: entry.axis, detail: 'town', biome: job.biome });
      c.restore();
    }
    return canvas.toDataURL('image/png').split(',')[1];
  }, job);
  await writeFile(join(output, 'guide.png'), Buffer.from(result, 'base64'));
  console.log(join(output, 'guide.png'));
  console.log(join(output, 'job.json'));
  console.log(join(output, 'prompt.txt'));
} finally {
  await browser.close();
}
