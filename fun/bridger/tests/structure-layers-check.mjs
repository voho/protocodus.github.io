import assert from 'node:assert/strict';

// Render a car with its opaque door centred on each piece. Comparing the
// same pixel with and without the car avoids hard-coding the material art.
export async function checkStructureLayers(page) {
  const cases = await page.evaluate(async () => {
    const { createView, draw } = await import('./js/render.js');
    const { createSim } = await import('./js/physics.js');
    const { buildScenery, THEMES } = await import('./js/scenery.js');

    const mission = { ...bridger.mission, left: 0, right: 14, span: 7, water: -1.5, ground: () => -7, anchors: [] };
    const view = createView(mission, 640, 480, 0, 0);
    const scenery = buildScenery(mission);
    const x = Math.round(view.sx(6)), y = Math.round(view.sy(0));
    const belowWater = Math.ceil(view.sy(mission.water)) + 3;

    const frame = (mode, part, showCar) => {
      const scene = { ...mission, anchors: part === 'anchor' ? [[3, 0]] : [] };
      const members = part && part !== 'anchor' ? [{ a: [2, 0], b: [4, 0], mat: part }] : [];
      const sim = createSim(scene, members, 'car');
      for (const axle of sim.car.axles) {
        axle.x = (showCar ? 8.1 : -100) - axle.offset;
        axle.y = -0.75;
      }
      const canvas = document.createElement('canvas');
      canvas.width = view.width; canvas.height = view.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      draw(ctx, document.createElement('canvas').getContext('2d'), {
        mode, mission: scene, members, view, scenery, theme: THEMES.valley, time: 0, particles: [],
        parked: mode === 'build' ? sim.car : null, sim: mode === 'test' ? sim : null,
      });
      const water = scenery.raster.water;
      const mirrorX = Math.round(x - water.left);
      const mirrorY = Math.round(water.level + 0.84 * (water.level - y) - water.top);
      return { main: ctx.getImageData(x, y, 1, 1).data.join(),
        reflected: ctx.getImageData(x, belowWater, 1, view.height - belowWater).data.join(),
        mirror: water.reflected.getImageData(mirrorX, mirrorY, 1, 1).data.join() };
    };

    const results = [];
    for (const mode of ['build', 'test']) {
      const empty = frame(mode, null, false), car = frame(mode, null, true);
      for (const part of ['wood', 'steel', 'cable', 'road', 'anchor']) {
        results.push({ mode, part, empty, car, structure: frame(mode, part, false), both: frame(mode, part, true) });
      }
    }
    return results;
  });

  for (const { mode, part, empty, car, structure, both } of cases) {
    const name = `${mode} ${part}`;
    assert.notEqual(car.main, empty.main, `${name}: the vehicle covers the sample`);
    assert.notEqual(structure.main, car.main, `${name}: the piece is distinguishable from the vehicle`);
    assert.notEqual(structure.main, empty.main, `${name}: the piece covers the sample`);
    assert.equal(both.main, structure.main, `${name}: the piece is in front of the vehicle`);
    if (part === 'anchor') continue;
    // Compare the mirror sources before their pixels are bent by the waves.
    assert.notEqual(car.reflected, empty.reflected, `${name}: the vehicle is reflected`);
    assert.notEqual(car.mirror, structure.mirror, `${name}: the reflected piece is distinguishable from the car`);
    assert.equal(both.mirror, structure.mirror, `${name}: the reflected vehicle is behind the piece`);
    assert.notEqual(both.reflected, car.reflected, `${name}: the reflected piece covers the car`);
  }
  await checkBuildEdits(page);
}

// A warmed editor should produce the same frame as a freshly opened copy
// of each design, including the reflection and the focused drawing grid.
async function checkBuildEdits(page) {
  const checks = await page.evaluate(async () => {
    const { createView, draw } = await import('./js/render.js');
    const { createSim } = await import('./js/physics.js');
    const { buildScenery, THEMES } = await import('./js/scenery.js');
    const mission = bridger.mission;
    const makeView = () => createView(mission, 500, 360, 12, 20);
    const view = makeView();
    const wood = { a: [1, 0], b: [2, 1], mat: 'wood' };
    const steel = { a: [2, 1], b: [3, 0], mat: 'steel' };
    const initial = [wood];
    const state = {
      mission, members: initial, mode: 'build', time: 0, parked: createSim(mission, initial, 'car').car,
      scenery: buildScenery(mission), theme: THEMES.valley, peaks: new Map(), particles: [],
      peakOf: member => state.peaks.get(member),
    };
    const frame = (view, ratio) => {
      const canvas = document.createElement('canvas');
      canvas.width = view.width * ratio; canvas.height = view.height * ratio;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.scale(ratio, ratio);
      draw(ctx, document.createElement('canvas').getContext('2d'), { ...state, view });
      return new Uint32Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer);
    };
    const same = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
    const cases = [];
    let previous = frame(view, 1);
    const verify = (name, changes, ratio = 1) => {
      Object.assign(state, changes);
      const warm = frame(view, ratio), cold = frame(makeView(), ratio);
      cases.push({ name, matches: same(warm, cold), changed: !same(previous, warm) });
      previous = warm;
    };
    verify('member hover', { hover: { member: wood } });
    verify('stress after a test', { peaks: new Map([[wood, 0.8]]) });
    verify('clear stress and add steel', { members: [wood, steel], hover: null, peaks: new Map() });
    verify('drag focus', { focus: [2, 1, 3] });
    verify('undo and cancel drag', { members: initial, focus: null });
    verify('device pixel ratio', {}, 2);
    return cases;
  });
  for (const { name, matches, changed } of checks) {
    assert.ok(matches, `${name}: warm and cold frames match`);
    assert.ok(changed, `${name}: the edit is visible`);
  }
}
