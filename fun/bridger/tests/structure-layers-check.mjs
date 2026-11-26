import assert from 'node:assert/strict';

// Render a car with its opaque door centred on each piece. Comparing the
// same pixel with and without the car avoids hard-coding the material art.
export async function checkStructureLayers(page) {
  const cases = await page.evaluate(async () => {
    const { createView, draw } = await import('./js/render.js');
    const { createSim } = await import('./js/physics.js');
    const { buildScenery, THEMES } = await import('./js/scenery.js');
    await Promise.all(['car', 'wheel-road'].map((name) => {
      const image = new Image();
      image.src = `assets/${name}.webp`;
      return image.decode();
    }));

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
      const reflection = () => ctx.getImageData(x, belowWater, 1, view.height - belowWater).data.join();
      let behindReflection;
      const paint = ctx.drawImage.bind(ctx);
      ctx.drawImage = (image, ...args) => {
        if (image.src?.endsWith('/car.webp') && ctx.getTransform().d < 0) behindReflection = reflection();
        paint(image, ...args);
      };
      draw(ctx, document.createElement('canvas').getContext('2d'), {
        mode, mission: scene, members, view, scenery, theme: THEMES.valley, time: 0, particles: [],
        parked: mode === 'build' ? sim.car : null, sim: mode === 'test' ? sim : null,
      });
      return { main: ctx.getImageData(x, y, 1, 1).data.join(), reflected: reflection(), behindReflection };
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
    // The river composites translucent layers. Observe its actual contents
    // just before the car is painted and again after the bridge is painted.
    assert.notEqual(car.reflected, empty.reflected, `${name}: the vehicle is reflected`);
    assert.ok(both.behindReflection, `${name}: the car is drawn during the reflection pass`);
    assert.equal(both.behindReflection, car.behindReflection, `${name}: the reflected car is painted first`);
    assert.notEqual(both.reflected, car.reflected, `${name}: the reflected piece covers the car`);
  }
}
