# Taiga tree variety 2

Nine new generated botanical identities: hornbeam, elm, sycamore-maple, red-maple, horse-chestnut, rowan, alder, willow, poplar.

The accepted raw image is `source-generation-2026-10-06.png`. The rejected initial image is preserved separately. `generation.json` records every exact image-generation prompt, reference, parameter, source path and SHA-256, plus measured actual trunk root feet, crown heights and calibration factors. Style references are the approved house atlas; they do not determine species.

Each complete tree is uniformly calibrated against the canonical 19.7227 master pixels per vertical metre and translated to the actual exposed-root anchor at 95.5% of a 256 px cell. Especially broad crowns retain up to 15% natural height variation to keep at least 12% side gutters. No tree is fitted or enlarged merely to occupy a cell. No tree artwork is hand-painted, recoloured or procedurally substituted. The standard alpha-8/two-pixel fringe cleanup removes generator background noise around each complete source object; premultiplied resampling preserves colour at transparent edges.

To reproduce from the Transport directory:

```sh
python assets/world/nature-trees-taiga/variety-1/register-source.py assets/world/nature-trees-taiga/variety-2
```

Then run the exact `packing.command` in `generation.json`. Packing uses the full calibrated cells with `--aligned --preserve-grid-scale --max-cell 256 --no-sharpen`, retaining the canonical IDs and producing 16/32/64/128/256 px LODs and isolated source cells.

`qa.json` records 45 occupied LOD profiles, independent sprite hashes, transparent master edges, root errors below half a master pixel, and actual calibrated heights. All species were reviewed on game grass at 16/32/64/128 px. Top and side edges remain clear of the tree body. At 16 px the 95.5% root anchor leaves only 0.72 px below the root, so the filtered root/contact shadow can occupy the last row; complete masters retain transparent bottom gutters.

Projection-unit correction: these forest/ground sprites render at 1:1 world pixels, while building billboards use a 1.5× enlargement. Current target and measured metre values are therefore the historical values divided by 1.5, and current master pixels per metre are multiplied by 1.5. Exact historical imagegen requests remain unchanged in the provenance files. All source/master/LOD artwork, uniform pixel resampling factors, root positions and shadow proportions are unchanged. `generation.json.projectionCorrection` records the conversion explicitly.
