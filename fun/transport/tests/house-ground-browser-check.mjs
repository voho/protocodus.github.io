// Compatibility entry point for the current authored-RGBA ground contract.
// Review all architectural cutouts, including every house design/rotation,
// then verify that raised building sites replay actual textured world ground.
// Each imported runner closes its browser before the next one starts.
import { resolve } from 'node:path';

const previous = {
  output: process.env.TRANSPORT_OUTPUT,
  screenshots: process.env.TRANSPORT_SCREENSHOTS,
};
const output = resolve(previous.screenshots || previous.output || '/tmp/transport-house-ground-browser');
try {
  process.env.TRANSPORT_OUTPUT = resolve(output, 'authored-alpha');
  await import('./building-plot-alpha-browser-check.mjs');
  process.env.TRANSPORT_SCREENSHOTS = resolve(output, 'foundation-ground');
  await import('./foundation-ground-browser-check.mjs');
  console.log(`PASS authored architectural alpha and textured building foundations. Artifacts: ${output}`);
} finally {
  for (const [name, value] of [['TRANSPORT_OUTPUT', previous.output], ['TRANSPORT_SCREENSHOTS', previous.screenshots]]) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
