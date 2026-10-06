# Transport project decisions

## Supported devices

The user decided on 2026-10-06 that Transport is a computer-only game because phone support adds friction.

- Support desktop and laptop browsers with a keyboard and mouse or trackpad. Preserve desktop keyboard accessibility, trackpad scrolling and zoom, display density support, and laptop-sized layouts.
- Phones and tablets show only the exact message `please use computer to play the game` before the game starts. Do not generate or restore a world, initialize gameplay, or alter saved games on these devices.
- Do not add phone gameplay, mobile navigation, bottom sheets, touch placement, multi-touch map gestures, phone safe-area layouts, or phone gameplay test matrices unless the user explicitly changes this decision.
- A narrow computer window, browser zoom, or a touchscreen on a computer does not by itself make it a phone. Keep computer gameplay usable with keyboard and pointer controls.
- Verify the unsupported-device message with a small entry-screen check; gameplay and UI checks target computers.

This decision overrides older phone requirements in feature notes. [DESIGN.md](DESIGN.md), [README.md](README.md), and [ARCHITECTURE.md](ARCHITECTURE.md) describe the current computer interface.

## Sprite scale and industry plots

The user decided on 2026-10-06 that buildings must share a physical scale, use fewer tiny details, and remain recognizable at smaller zoom levels. Every newly generated, constructed or opened industry uses a **5 × 5 tile plot**, including farms; a farm has a **2 × 2 building core** with fields and fences inside its full plot.

- Every building and industry image-generation job must use `buildingGenerationPrompt()` from [sprite-art-direction.js](sprite-art-direction.js), normally through [tools/generate-building-prompt.mjs](tools/generate-building-prompt.mjs). This module is the canonical source of scale and style; do not maintain separate family-specific proportions or competing prompt rules.
- Its current scale is a 16 m tile, a 1.75 m person, a 2.1 m personnel door, a 3 m storey and a 4.2 m vehicle loading bay. Read `SPRITE_SCALE` and its conversion helpers when drawing or normalizing artwork. Larger buildings gain wings, rooms, floors and bays while their human features keep the same dimensions.
- Preserve the full parcel and its calibrated scale when packing sprites. Do not independently enlarge each silhouette to fill its atlas cell. Use broad roof and wall masses and large identifying features; omit tiny brick joints, roof tiles, lettering, flower dots and similar decorative noise. Review the actual Region, Town and Detail views at standard and Retina density.
- Keep published world recipes 1–9 unchanged. Recipe 10 is the current 5 × 5 generator. Existing saves resize only where construction and station connections remain safe; blocked legacy sites retain their original footprint. Do not erase a neighbor's building, road or stop to force a migration.

[SPRITES.md](SPRITES.md) describes the generation and review workflow. The computer-only decision above also applies to artwork QA.
