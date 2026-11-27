import assert from 'node:assert/strict';

export async function checkOrcArt(page) {
  const result = await page.evaluate(async () => {
    const { prepareOrcArt, drawOrcPart, drawOrcBoot, crossbowTip, shootingPose } = await import('./orc-art.js');
    await prepareOrcArt();
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 190;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const scale = .5, footX = 100, footY = 170;
    function draw(index, facing, boot = false) {
      ctx.resetTransform();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(facing, 0, 0, 1, footX, footY);
      if (boot) drawOrcBoot(ctx, index, scale);
      else drawOrcPart(ctx, index, scale);
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    }
    const offset = (x, y) => 4 * (Math.floor(footY + y * scale) * canvas.width + Math.floor(footX + x * scale));
    function helmet(pixels, facing) {
      const colors = new Array(64).fill(0);
      let opaque = 0;
      for (let y = -246; y <= -204; y += 2) for (let x = -52; x <= -16; x += 2) {
        const i = offset(x * facing, y);
        if (pixels[i + 3] < 180) continue;
        colors[(pixels[i] >> 6) * 16 + (pixels[i + 1] >> 6) * 4 + (pixels[i + 2] >> 6)]++;
        opaque++;
      }
      return { opaque, colors: colors.map((count) => count / opaque) };
    }
    let minHelmet = Infinity, maxColorChange = 0, minTipAlpha = 255, lowestTip = -Infinity;
    const signatures = new Set();
    for (const facing of [1, -1]) {
      const idle = helmet(draw(0, facing), facing);
      const inspect = (pixels) => {
        const { opaque, colors } = helmet(pixels, facing);
        minHelmet = Math.min(minHelmet, opaque);
        maxColorChange = Math.max(maxColorChange, colors.reduce((sum, weight, bin) =>
          sum + Math.abs(weight - idle.colors[bin]), 0));
        if (facing === 1) {
          let hash = 0;
          for (let i = 0; i < pixels.length; i += 68) hash = (Math.imul(hash, 31) + pixels[i]) | 0;
          signatures.add(hash);
        }
      };
      for (let index = 0; index < 3; index++) inspect(draw(index, facing));
      for (let step = -6; step <= 6; step++) {
        const pitch = step * Math.PI / 12;
        for (let frame = 0; frame < 3; frame++) {
          const index = shootingPose(frame, pitch), pixels = draw(index, facing);
          inspect(pixels);
          if (frame === 0) continue;
          const [x, y] = crossbowTip(pitch, frame === 1);
          lowestTip = Math.max(lowestTip, y);
          minTipAlpha = Math.min(minTipAlpha, pixels[offset(facing * x, y) + 3]);
        }
      }
    }
    const boots = [0, 1].map((index) => {
      const pixels = draw(index, 1, true);
      let bottom = -Infinity, count = 0, sumX = 0;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        if (pixels[(y * canvas.width + x) * 4 + 3] < 180) continue;
        bottom = Math.max(bottom, (y - footY) / scale);
        sumX += (x - footX) / scale;
        count++;
      }
      return { bottom, center: sumX / count };
    });
    return { minHelmet, maxColorChange, minTipAlpha, lowestTip, boots, poses: signatures.size };
  });
  assert.equal(result.poses, 42, 'Three idle/reaction frames and 39 firing frames each have distinct painted poses');
  assert.ok(result.minHelmet > 290 && result.maxColorChange < .4,
    'The same painted helmet remains visible facing either way through every animation');
  assert.ok(result.minTipAlpha > 140 && result.lowestTip < 0,
    'Both release poses place the bolt tip on the painted bow and above the standing surface');
  const [left, right] = result.boots;
  assert.ok(left.center < -20 && right.center > 20 && Math.abs(left.bottom - right.bottom) <= 4 &&
    Math.abs(left.bottom) <= 6 && Math.abs(right.bottom) <= 6, 'The two separate boots meet the ground together');
}
