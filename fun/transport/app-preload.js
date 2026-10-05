// The game modules start-menu.js does not load, dependencies first. index.html
// preloads the menu graph; the menu preloads these once it is idle, so Create
// does not wait on app.js's import waterfall. tests/module-preload.test.mjs keeps
// both lists equal to the static imports. world-worker.js is never listed: a
// document preload does not reach a module worker.
export const APP_PRELOAD = Object.freeze([
  './ui-icons.js',
  './headlines.js',
  './air-flight.js', './airport-art.js',
  './compact-play.js', './construction-plan.js', './route-tiles.js', './structure-visibility.js', './atlas-runtime.js',
  './raster-industries.js', './raster-buildings.js', './tree-sprites.js', './tree-shadows.js', './raster-nature.js',
  './building-sprites.js', './town-feature-sprites.js', './processing-sprites.js', './relief-sprites.js', './raster-houses.js', './sprite-cache.js',
  './sprites.js', './zoom.js', './cargo-icons.js', './gameplay-insights.js', './landscape-scenery.js', './visibility.js',
  './vehicle-directions.js', './isometric.js', './raster-transport.js', './marine-sprites.js',
  './isometric-infrastructure.js', './weather-effects.js', './water-art.js', './overlay-placement.js',
  './formatters.js', './shoreline.js', './terrain-mesh.js', './scenery-batches.js', './route-render-index.js',
  './renderer.js', './construction-undo.js', './network-router.js', './ui-art.js', './route-planner.js', './town-forecast.js',
  './payment-rates.js',
  './ui-motion.js', './ui-line.js', './ui-refs.js',
  './achievements-view.js',
  './chains-view.js', './saves-view.js', './visibility-view.js', './ui-notices.js', './app.js'
]);
