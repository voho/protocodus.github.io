// CI can opt into Chromium's software WebGL for coverage on GPU-less runners.
// Keep this developer-only mode confined to a locally served checkout.
export function chromiumOptions(env = process.env) {
  const options = { channel: env.TYRAN_BROWSER || 'chrome', headless: true };
  if (env.TYRAN_SOFTWARE_GPU === '1') {
    const host = new URL(env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/').hostname;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
      throw new Error('TYRAN_SOFTWARE_GPU requires a loopback TYRAN_URL.');
    }
    options.args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  }
  return options;
}
