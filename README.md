<img src="assets/images/logo.svg" alt="Protocodus" width="120">

# Protocodus

[protocodus.cz](https://protocodus.cz/)

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

[Play Meteora](fun/meteora/index.html) is a space-combat campaign in the spirit of FreeSpace, set in a dense asteroid belt around a red dwarf. Ten missions follow the Belt Watch's Lantern Wing from a missing ore tug to the evacuation of the whole belt, with briefings, a hangar, debriefs, medals, ranks and four difficulties.

- The missions vary: patrol and first contact, convoy escort through a rockslide, stealth recon past sensor Eyes, destroying seeded asteroids, holding a station during an evacuation, guarding the carrier *Perpetua* under an eclipse, cutting an enemy supply line in open space, a fleet assault on a Mother-class capital ship, a convoy with a traitor, and a last battle around a colony ark until it jumps — plus a special operation, a rescue from a convoy falling into a black hole (drawn with real gravitational lensing). Every place has its own sky, light and dust, and the story is uncovered clue by clue in a case file. Flight training teaches the basics first.
- Choose an interceptor, a fighter or a bomber, a gun, missiles or torpedoes and a reactor; every mission recommends a loadout and says why, and the hangar warns when a choice will not do the job.
- Steer with the mouse or a gamepad (adjustable sensitivity, self-centring or stick-like steering, rebindable keys). Quadrant shields, a low-hull alarm and a repair drone on R keep you flying; the nearest hostile is targeted by itself and pictured in a target panel; wing orders, subsystem targeting and torpedo interception are a key away. Rocks collide by their real shapes.
- The ships, stations and capital ships are built by committed Blender scripts with baked textures, and their turrets, bays, subsystems and lights come from the models.
- Synthesised 3D sound, live generated music and a voiced radio (the browser's own speech synthesis reads the radio, the briefings and the debriefs); every mission opens and closes on a camera shot, and the big moments get cutaways. Survival mode keeps the old endless waves.
- See the [game guide](fun/meteora/README.md) for the controls, the campaign, the armoury, the model pipeline and the checks.
