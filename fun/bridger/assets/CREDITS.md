# Bridger art

All images here were generated for Bridger on OpenArt in November 2026 with
GPT Image 2.5 Sunburst, then reduced to a true pixel grid and a small palette
by script (Lanczos downscale, median-cut palette, no dithering; vehicles keyed
off a flat magenta background).

| Files | What | Prompt gist |
| --- | --- | --- |
| `sky-valley.png`, `sky-mesa.png`, `sky-snow.png`, `sky-night.png` | Backdrops, cropped at the horizon | 16-bit pixel-art panorama in cool muted blues and violets, no green, yellow, orange or red |
| `rock-valley.png`, `rock-mesa.png`, `rock-snow.png`, `rock-night.png` | Tiling rock for the banks | 16-bit seamless rock texture in the same palette |
| `car.png`, `truck.png`, `loco.png`, `wagon.png` | Vehicle sprites | 16-bit side-view sprite on flat magenta |

The wheel positions each sprite is drawn by live in `js/render.js` (`SPRITES`).
