# Hollow tundra trees

Three actual imagegen cutouts, generated on 2026-10-06: hollow birch, hollow larch and hollow spruce. Each has a large dark trunk cavity, broken upper limbs, sparse species-specific crowns and restrained snow. Roots have genuine transparency with only a tiny contact shadow; there are no snow discs, rocks, soil mounds or platforms.

The current tundra house atlas was a style reference only. `prompt.txt` contains the exact `hollowTreeGenerationPrompt()` request. `generation.json` records source, prompt and reference hashes, the shared physical contract, source-cell positions and measured root/crown coordinates. `source-generated-2026-10-06.png` is the unchanged imagegen output.

`register-source.py` resamples all three complete cutouts at one shared **0.25 source-pixel scale** and centres their actual root feet at 95.5% of each 256px cell. This preserves the original tree proportions and relative dimensions without independently enlarging silhouettes to fill the frame. The shared game envelope uses **19.723 master pixels per vertical metre**. The resulting natural heights are approximately 7.7 m, 8.1 m and 8.4 m, within 6% of the nominal 7.33/8/8.67 m species targets. No artwork is redrawn by packing.

To reproduce, run `python fun/transport/assets/world/nature-trees-tundra/hollow/register-source.py` from the repository root, then run the exact `buildCommand` in `generation.json`. The shared atlas packer uses `--aligned --preserve-grid-scale --max-cell 256 --no-sharpen` to produce the 3×1 sheet and its 16, 32, 64, 128 and 256 pixel densities.

QA checked all 15 sprite/mip cells, distinct master cutouts, root alignment, transparent master boundaries, nonempty smaller mips and exact independent-cell premultiplied-alpha filtering. `qa.json` records the measurements. At 16px, the prescribed root baseline contributes to the final pixel row; the complete master remains transparent at its edges and every mip exactly matches whole-cell resampling.

Projection-unit correction: these forest/ground sprites render at 1:1 world pixels, while building billboards use a 1.5× enlargement. Current target and measured metre values are therefore the historical values divided by 1.5, and current master pixels per metre are multiplied by 1.5. Exact historical imagegen requests remain unchanged in the provenance files. All source/master/LOD artwork, uniform pixel resampling factors, root positions and shadow proportions are unchanged. `generation.json.projectionCorrection` records the conversion explicitly.
