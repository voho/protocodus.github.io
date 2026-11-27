// Keep the chosen resolution and decoded landscapes for the entire play session.
// Even a new fortress in another realm uses an image that is already in memory.
import { THEMES } from './simulation.js';

async function readImage(name) {
  const image = new Image();
  image.alt = '';
  image.decoding = 'async';
  image.src = new URL('./assets/' + name + '.webp', import.meta.url).href;
  await image.decode();
  return image;
}

export async function prepareAssets(audio, music, prepareArt, onProgress) {
  const pixels = Math.max(innerWidth, screen.width) * (devicePixelRatio || 1);
  const fineDesktop = matchMedia('(pointer: fine)').matches && innerWidth >= 1280;
  const highDetail = pixels > 1600 || fineDesktop;
  const sources = THEMES.map(({ id: name }) =>
    highDetail ? readImage(name + '-4k').catch(() => readImage(name)) : readImage(name),
  );
  const tasks = [
    ...sources,
    prepareArt(),
    audio.prepare(),
    music.prepare(),
    Promise.all([document.fonts.load('700 1em Cinzel'), document.fonts.load('500 1em Inter')]),
    ...Array.from(document.querySelectorAll('.ammo-art, .crest, img.stat-art'), (image) => image.decode()),
  ];
  let completed = 0;
  await Promise.all(tasks.map((task) => task.then(() => onProgress(++completed, tasks.length))));
  return Promise.all(sources);
}
