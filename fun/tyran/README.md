# Tyran

An original browser arcade shooter inspired by the vertical scrolling tradition of Tyrian. Available at `/fun/tyran/`, linked from the home page and Fun section. Static ES modules and Canvas 2D; no build step, third-party runtime, account, or backend.

## Play

Serve the repository root and open the game:

```sh
python3 -m http.server 8773 --bind 127.0.0.1
```

Open `http://127.0.0.1:8773/fun/tyran/`.

- **Solo:** WASD or arrows to move; either Control key, Space, or Enter to fire.
- **Co-op pilot 1:** WASD to move; left Control or Space to fire.
- **Pilot 2:** arrows to move; right Control or Enter to fire. Choose co-op before launching.
- **Pause:** Escape or P. **Sound:** M. Sound and effects quality are also available in the pause menu.
- **Touch:** drag the left control to steer and hold the right control to fire.

Fly through ten sectors: jungle, snow, desert, tropical islands, asteroid belt, Mars, volcanic foundry, neon city, alien garden, and void citadel. Each introduces nine enemy classes, followed by a sector guardian with three attack phases. Ten sector liveries and fittings create 100 enemy variants from ten underlying silhouettes. World cards preview the environments; a new campaign always begins in sector one.

Destroy ships and scenery for credits, collect repair and salvage pickups, and purchase six tiers each of weapons, shields, hull, and recharge between sectors. Co-op shares the upgrade budget and equipment; one surviving pilot can complete a sector, and both ships return with full hull and shields at the next launch. Progress and purchases save at the service bay in local storage. Continue resumes the last saved service-bay loadout; mid-flight positions are not saved. Retry keeps current equipment and accumulated credits/score.

## Visuals and audio

Original generated title artwork and environment terrain assets are stored in `assets/`; their generation prompts and provenance accompany them. Runtime terrain has a procedural fallback. Cached detailed ship sprites, independently scrolling atmosphere, destructible props, salvage, scorch marks, debris, bloom, impact shake, short impact blur, shockwaves, and chained boss explosions are drawn in Canvas 2D. Ships, props, and effects are code-native artwork. Audio effects and an adaptive electronic sequence are synthesized with Web Audio after a user gesture.

Effects have high/low settings. Reduced-motion preference disables screen shake, impact blur and bright screen flashes. Losing window focus automatically pauses. Failure or denial of local storage and audio does not prevent play.

Ships now cast separate ground shadows, with silver armor rims, white-hot engine fire and warm nozzle bloom. Thrust responds to acceleration. Hull and equipment add mass: heavier ships accelerate, coast, reverse and bank more gradually while retaining their cruise speed. Both keyboard layouts use the same motion model.

Each world has changing terrain sections with blended crop/zoom composition, clustered vegetation, outposts and landmarks. Terrain, scenery, shadows, glow, wreckage and projectile sprites are cached; nearby terrain chunks and spacecraft are prepared before they are needed. Collision checks reject distant targets cheaply and scenery uses spatial buckets. Damaged scenery retains its state when scrolling out of the image cache.

Physics runs at a fixed 60 updates per second. Rendering interpolates between updates for smooth motion on faster displays and catches up through brief slow frames with a bounded budget. Paused and covered title screens stop repainting the arena. High-DPI rendering has a pixel budget and reduces backing resolution under sustained load; this never changes the flight area or simulation speed.

## Structure

| File | Responsibility |
| --- | --- |
| `game.js` | Rendering loop, input, screens, persistence and integration |
| `sim.js` | Combat, collision, campaign progression and upgrade economy |
| `worlds.js` | Ten scrolling environments and destructible scenery |
| `ships.js` | Ten enemy classes and cached spacecraft artwork |
| `effects.js` | Explosions, debris, lighting, wreckage and motion |
| `audio.js` | Original synthesized music and sound effects |
| `index.html`, `style.css` | Responsive menu, HUD, hangar and controls |

## Verification

```sh
node fun/tyran/tests/sim-check.mjs --balance
node tests/navigation-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/browser-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/timing-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/world-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/ship-visual-check.mjs
TYRAN_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node fun/tyran/tests/performance-check.mjs
```

Browser QA expects the root server at port 8773 and installed Chrome. `TYRAN_URL`, `TYRAN_BROWSER` and `TYRAN_SCREENSHOTS` override the defaults. Screenshots are written outside the repository to `/tmp/tyran-qa`.

The simulation suite verifies collision, shields, all spawn schedules, upgrades, persistence input validation, co-op deaths/revival, and the full campaign. Optional deterministic autopilot trials complete both solo and co-op using ordinary movement and firing plus earned purchases. These trials prove reachability; they do not substitute for human difficulty tuning. Browser QA covers both physical Control keys, pause, world previews, scenery destruction, shop, continuation, victory, storage denial and real touch input.

Timing QA drives real keyboard events at simulated 30/60/120 Hz, checking movement parity, visible interpolation, pause, slow-frame recovery and adaptive resolution. World checks cover all ten biomes at three viewport widths, image seams, persistent damage and loading transitions. The performance harness records Chrome frame intervals and CPU profiles for a repeatable co-op battle with 19 enemies and sustained fire; it reports measurements without assuming other computers have the same frame rate.
