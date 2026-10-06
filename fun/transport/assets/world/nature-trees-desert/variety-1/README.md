# Desert tree variety 1

Nine new dryland botanical identities generated with image_gen on 2026-10-06, using the approved desert tree and house artwork as references. The original nine tree slots are unchanged.

`generation.json` records every exact prompt, parameter, reference/source hash, rejected draft and accepted raw source. `source-generation-2026-10-06.png` is the unmodified accepted tool output. `registration.json` records measured crown/root positions and one uniform physical calibration for each complete tree; it preserves proportions and targets actual metres rather than enlarging silhouettes to fill a cell. The trunk root is registered to 95.5% of the cell. Natural specimen heights stay within 15% of the requested mature heights.

`registered-generation-2026-10-06.png` contains the calibrated full 512px parcel cells. Run the exact packing arguments recorded in `generation.json` through `../../../../tools/build-world-atlases.py` to reproduce `atlas.png`, all five LODs and the source cutouts. The packer uses full-grid registration, premultiplied-alpha filtering and no sharpening. It ignores invisible matte specks outside alpha greater than 8 plus a two-source-pixel cushion.

Reviewed all nine identities at 16, 32, 64 and 128px. Broad crowns, palm fans, succulent arms and distinctive trunks remain recognizable. The 256px master has zero-alpha edges; 16px bottom-row sampling includes the 95.5% root/contact shadow without cropping any master anatomy. The game supplies the separate projected ground shadow.

Projection-unit correction: these forest/ground sprites render at 1:1 world pixels, while building billboards use a 1.5× enlargement. Current target and measured metre values are therefore the historical values divided by 1.5, and current master pixels per metre are multiplied by 1.5. Exact historical imagegen requests remain unchanged in the provenance files. All source/master/LOD artwork, uniform pixel resampling factors, root positions and shadow proportions are unchanged. `generation.json.projectionCorrection` records the conversion explicitly.
