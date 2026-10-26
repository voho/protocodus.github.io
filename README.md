<img src="assets/images/logo.svg" alt="Protocodus" width="120">

# Protocodus

[protocodus.cz](https://protocodus.cz/)

## Analytics

Shared GA4 and Google Tag Manager tracking covers every public page, product
interest, shop/contact/download clicks, demos, games and Web Vitals. See
[analytics setup, event coverage and verification](docs/analytics.md).

## Tyran

[Play Tyran](fun/tyran/index.html) is a ten-sector scrolling top-down shooter with solo and two-player flight. Each sector has a dedicated terrain palette and destructible scenery, plus a ship palette reserved for enemies so hostile craft stay readable against the ground.

- Seeded terrain tiles, rocks, vegetation and structures share one ground plane, with clouds or dust scrolling above them.
- Enemy rounds scale with hull class: small ships fire compact, low-damage spectrum rounds while heavier craft use larger, brighter shapes. A cap keeps hostile fire from overwhelming the frame rate.
- Every fighter uses one fixed hull sprite, with separate shadows, engine light and restrained animation.
- Single-player flight uses WASD to move, Space for primary fire and Q for secondary fire. Primary pulse is unlimited; stronger secondary plasma consumes regenerating energy. Formations, boss weak points and timed armor windows reward different tactics.
- Every sector sets two salted objectives and grades the flight from S to D; a mid-sector checkpoint lets a lost flight resume halfway. Weapon classes meet enemy barriers differently, and the pilot's shield collapses with a clearing pulse.
- Positional stereo effects from public-domain (CC0) recordings at full 44.1 kHz quality, layered explosions and a critical-hull alarm sit under the unchanged soundtrack. The soundtrack streams, so music starts within moments even on a slow connection.
- Campaign progress saves automatically in the browser, including fire energy; the shop offers shared equipment upgrades after each sector.
- The interface uses normal-case labels and locally served Chakra Petch for a consistent space-console feel.

## Meteora

[Play Meteora](fun/meteora/index.html) is a space-combat campaign in the spirit of FreeSpace, set around a red dwarf. Ten missions in three acts follow the Belt Watch's Lantern Wing from a missing ore tug through a siege to the evacuation of the whole belt, with briefings, a hangar, debriefs, medals, ranks and four difficulties. Patrols, dense-rock recon and convoy lanes alternate with open orbital demolition, exposed station defense and fleet actions beneath distinct nebulae.

- The missions vary: patrol and first contact, convoy escort through a rockslide, stealth recon past sensor Eyes, destroying seeded asteroids, holding a station during an evacuation, guarding the carrier *Perpetua* under an eclipse, cutting an enemy supply line in open space, a fleet assault on a Mother-class capital ship, a convoy with a traitor, and a last battle around a colony ark until it jumps — plus a special operation, a rescue from a convoy falling into a black hole (drawn with real gravitational lensing). Every place has its own sky, light and dust, and the story is uncovered clue by clue in a case file. Flight training teaches the basics first.
- Choose an interceptor, a fighter or a bomber, a gun, missiles or torpedoes and a reactor; every mission recommends a loadout and says why, and the hangar warns when a choice will not do the job.
- Steer with the mouse or a gamepad (adjustable sensitivity, self-centring or stick-like steering, rebindable keys). Quadrant shields, a low-hull alarm and a repair drone on R keep you flying; the nearest hostile is targeted by itself and pictured in a target panel; wing orders, subsystem targeting and torpedo interception are a key away. Rocks collide by their real shapes.
- The ships, stations and capital ships are built by committed Blender scripts with baked textures, and their turrets, bays, subsystems and lights come from the models.
- Synthesised 3D sound, live generated music and a voiced radio (the browser's own speech synthesis reads the radio, the briefings and the debriefs); every mission opens and closes on a camera shot, and the big moments get cutaways. Survival mode keeps the old endless waves.
- See the [game guide](fun/meteora/README.md) for the controls, the campaign, the armoury, the model pipeline and the checks.
- Tactical choices change the fight: a silenced relay cancels reinforcements, an early cargo scan seals an infiltrator's launch doors, and a protected repair crew restores the carrier's engines. Wingmen acknowledge orders, split threats, regroup and disengage when badly hurt; designated wing kills earn command assists. Personal debrief notes remember the people and ships you brought home.

## Zipper

[Play Zipper](fun/zipper/index.html) is a 3D logic puzzle: draw one unbroken line through every cell of the board, passing the numbers in order and never crossing a glowing wall. Easy, medium and hard boards (5×5, 6×6 and 7×7) are generated on request or after a solve, and every board has exactly one solution.

- Each board starts as a random path through every cell; the numbers and walls are drawn from that path, and the solver adds a number or a wall wherever a second path still fits, so the puzzle is both solvable and unique by construction. A seed in the address (`#medium-k7x2ab`) reopens the same board.
- Draw by dragging, tapping neighbouring cells or using the arrow keys. Fast swipes fill skipped cells, retracing erases, and Undo or Backspace takes one step back. Rings mark the head and the next number; a coverage meter shows progress. Hints highlight a wrong turn or the route to the next number without making the move for you.
- Shared with Patcher: a lit three.js table viewed through a fixed 12° camera tilt, with aligned board edges, shallow bevels, a subtle satin shader, soft shadows, reflections, restrained HDR bloom, drifting bokeh and faint procedural scenery behind it (`fun/shared/`). Six themes (jungle, ocean, arctic, industrial, volcano, moon) each bring their own palette, sky, light and weather: fireflies, bubbles, snow, sparks, embers or stars. A picker in the HUD remembers the choice for both puzzles and `T` cycles it. A Daily button opens a reproducible board for the local date; the Board button copies a link to it. The timer pauses while reading help or visiting another tab.
- Phone, tablet and desktop layouts keep the tilted board between the controls, including landscape and safe areas. Tiles share one GPU draw call; weather and bokeh move in vertex shaders without CPU buffer uploads. Shadows redraw only when board geometry changes, bloom runs at reduced resolution, and a pixel budget limits large-screen rendering cost. Input wakes smooth animation immediately; idle scenery uses a sleeping timer at 10–12 fps, and background tabs stop drawing. Reduced motion sleeps completely once a move settles. Fast swipes publish one line update per input event and the line reuses its GPU geometry.
- Check: `node fun/zipper/tests/puzzle-check.mjs` (unique seeded boards, legal stepping, hints).

## Patcher

[Play Patcher](fun/patcher/index.html) is a 3D logic puzzle in the Shikaku family: cut the whole board into rectangular patches, one clue in each. The icon is the patch's shape (a square, a wide bar or a tall bar) and a number, when there is one, its cell count. Easy, medium and hard boards (5×5, 7×7 and 9×9), generated on request or after a solve, each with exactly one solution.

- A board starts as a random tiling, each patch given a clue; while a second cutting fits, a differing clue is strengthened (a number added or the clue moved) until only the intended one remains. A cell index speeds up that search while preserving seeded boards and solution order. A deduction pass grades each board so that easy ones always have a forced patch and hard ones need a look ahead.
- Padded satin keys sit in a wider tray. Tall clues put the number beside the icon; wide and square clues put it below. Measured glyph bounds keep digits centred and clear of the icons, including two-digit clues and fallback fonts; placed icons use the same dark ink as the numbers. Gentle landings and restrained highlights give the patches shallow relief. Patcher's backdrop uses slow, theme-specific light flows with a quiet centre and sparse drifting weather, all in the existing shader passes and static GPU buffers.
- Drag between opposite corners, or tap one corner then the other, to draw a patch. The rectangle can grow or shrink, with an outline and live size/validation feedback; tap the selected corner or press Escape to cancel. Patches land quickly with colour, a soft bounce and dust; tap to lift, or Undo to recover a move. Keyboard controls: arrows move, Enter starts and places, X lifts. Hints highlight a patch to draw or reconsider without changing the board.
- Checks: `node fun/patcher/tests/puzzle-check.mjs` (unique seeded cuttings, graded deduction, rejections, hints), `node fun/patcher/tests/board-render-check.mjs` (tile batching, padding, settled buffers and shadows, clue relief, patch landing/lifting and cleanup), and `node fun/patcher/tests/clue-layout-check.mjs` (icon/number separation, measured glyph alignment, safe margins and patch ink contrast).
- Shared checks: `node fun/shared/tests/hint-interaction-check.mjs`, `node fun/shared/tests/pointer-interaction-check.mjs`, `node fun/shared/tests/theme-check.mjs`, and `node fun/shared/tests/shell-check.mjs` cover hints, fast swipes, two-corner taps, pointer ownership, cancellation, replay, theme contrast, daily seeds and active play timing. `node fun/shared/tests/stage-check.mjs` checks the fixed camera tilt, projection/picking, idle scheduling, shadow invalidation and tab suspension. `node fun/zipper/tests/input-batching-check.mjs` checks swipe batching; `node fun/zipper/tests/board-render-check.mjs` checks that drawing/retracing reuses GPU geometry and disposes effects.
