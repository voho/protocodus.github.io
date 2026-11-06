# Retained diffuse sources

`grass-source.webp` and `forest-source.webp` are lossless RGB copies of
host-native OpenAI ImageGen output. The original generation prompts are saved
beside them, including exclusions (there was no separate negative-prompt
parameter). No external photograph, texture pack or paid-provider job was used.
These images are project-generated content under the project's existing terms;
they are not represented as public-domain archival material.

`provenance.json` records original and retained source hashes and dimensions.
The originals remain in the session's `generated_images` directory as well.
Runtime textures are reproducible from these retained source bytes; image
generation need not be repeated to rebuild the game assets.

The requested four-metre coverage is an art prompt, not a verified scale.
Physical scale is set during packing: the sward source is repeated twice across
its 4.30 m runtime tile, and the leaf-litter source four times across its 4.60 m
tile. This keeps clover and deciduous leaves within plausible centimetre sizes.
The game adds broad world-space variation above these fine repeats.

The inputs are **diffuse-only sources**, not material scans. `textures.py`
calibrates their color in linear light and derives restrained relief and dry
roughness estimates. It derives normals from the exact quantized height shipped
in alpha; it does not claim measured displacement or recovered true geometry.
The procedural sward and litter implementations remain available with the
explicit `--procedural` switch for comparison.

`landscape-calibration.json` is a separate original procedural field contract.
It retains quantiles from the previous authored broad moisture/growth/drift
mixtures plus their original texture hashes. No old texture image is needed
to rebuild the field. Its four periodic, independently seeded scalar channels
are not diffuse imagery and must be loaded as linear data.
