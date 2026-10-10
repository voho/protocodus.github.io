# Race and doctrine balance trials

Engine SHA-256: `c1d77024d42608606c9d18e8ccccb1efeefb6a5273b4befe74062cdafd3e4d0d`, over `sim.js`, `ai.js`, `terrain.js`, `flocking.js`, `traffic.js`, `mission.js`, `campaign.js` and `abilities.js` in that order. Trials recorded on 2026-10-10 (race trials on Veteran; doctrine trials on Commander and Veteran).

**Races.** AI Unity's combat units were repriced (no health or weapon values changed). Over 48 Standard race trials on the calibration, held-out and fresh seeds, both orientations, Organics won 23 and AI Unity 25 (52.1% Unity); before the change Organics won 25 of the 30 calibration and held-out games. All 52 race trials, including Frontier and Vast, split 26–26.

**Doctrines.** Three doctrines were retuned and Balanced was left alone. Against Balanced, over 24 games each (calibration and fresh seeds): on Veteran Swarm 9–15, Ironclad 13–11, Prospector 13–11 and Siegebreaker 14–10; on Commander Swarm 5–19, Ironclad 17–7, Prospector 12–12 and Siegebreaker 15–9. Siegebreaker no longer dominates (it was 10–2 and 9–3 before), and no doctrine wins more than 58.3% on Veteran. Two imbalances remain open on Commander: Ironclad wins 70.8% (8–4 on the calibration seeds), above the 65% target, and Balanced beats Swarm in 79% of games.

**Operations.** Red Ledger now meets a Swarm rival, Hold the Relay an Ironclad one and Severance a Prospector one; a scripted player wins each of them at the Commander setting.

These results describe a fixed commander policy and seed sample. They do not establish balance for human play. The engine before these changes (`d53d0e2c…`) played exactly the matches recorded for engine `64baa92b…` in the previous report: Organics won 25 of the 30 Standard race trials, and against Balanced on Veteran Swarm went 6–6, Ironclad 8–4, Prospector 7–5 and Siegebreaker 10–2. The same engine on Commander, measured for this report, gave Swarm 0–12, Ironclad 11–1, Prospector 9–3 and Siegebreaker 9–3.

## Method

`tests/race-balance.mjs` creates complete, untouched games with `aiTeams: [0,1]`, independent commander state and fog knowledge for each side, normal starting credits, real research, power, mining and combat. There are no forced attacks, free reinforcements, healed nexuses or victory scores. Both sides run the same commander code; only the race (and, in doctrine trials, the doctrine) differs.

Each seed and profile is played with Organics and AI Unity swapped between side 0 (lower left) and side 1 (upper right). Doctrine trials (`--doctrines a,b`) also swap which race carries which doctrine, so every seed yields four games and the races cancel out. A side wins under the Charter rule: the loser has neither a nexus nor a construction vehicle. A still-playing match at the time limit is a draw.

Race trials use Veteran (`--difficulty hard`) commanders; doctrine trials use Commander (`normal`) and Veteran. Games advance `updateGame` every 0.25 simulated seconds (stepped internally at no more than 0.05 seconds) with a 2,400-second limit and the game's population rule. Each match records the winner, length, peak and final army composition, research, raids, first-raid time, peak nexus count, haulers lost, seconds spent above 1,500 credits and minute-by-minute economy samples.

The changes were tuned on the calibration and held-out seeds. The `fresh` suite (FRESH-BASALT-07, FRESH-SLAG-08, FRESH-PUMICE-09) was added afterwards and played only to validate them: the race change on all three profiles, the doctrine knobs on Rift.

## Race results

AI Unity's combat units now cost what their strength is worth (*Unity prices* below). Calibration plays three seeds × three profiles (Rift, Basin and Highlands) × both race orientations on Standard 144×112 maps (18 games), the held-out batch two other seeds (12 games) and the fresh batch three more (18 games). One further seed was played in both orientations on Frontier 192×144 and Vast 224×168 Rift (four games).

| Batch | Matches | Organics wins | Unity wins | Draws | Organics share | Unity share |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Standard calibration | 18 | 10 | 8 | 0 | 55.6% | 44.4% |
| Standard held-out | 12 | 4 | 8 | 0 | 33.3% | 66.7% |
| Standard fresh seeds | 18 | 9 | 9 | 0 | 50.0% | 50.0% |
| All Standard | **48** | **23** | **25** | **0** | **47.9%** | **52.1%** |
| Frontier extension | 2 | 1 | 1 | 0 | 50.0% | 50.0% |
| Vast extension | 2 | 2 | 0 | 0 | 100.0% | 0.0% |
| All race trials | **52** | **26** | **26** | **0** | **50.0%** | **50.0%** |

| Standard profile | Matches | Organics wins | Unity wins | Draws | Organics share | Unity share |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Rift | 16 | 6 | 10 | 0 | 37.5% | 62.5% |
| Basin | 16 | 9 | 7 | 0 | 56.3% | 43.8% |
| Highlands | 16 | 8 | 8 | 0 | 50.0% | 50.0% |

Side 0 won 22 race trials and side 1 won 30. Standard games finished in 288.55–1,601.50 simulated seconds (median 598.45), the Frontier and Vast games in 584.85–882.35. The largest army was 88 units on one side. The fresh seeds, never used for tuning, gave AI Unity 9 of 18 games; the four larger-map games are too few to read on their own.

### Unity prices

The doctrine commander spends whatever it earns, so armies are bounded by income and cost efficiency decides. Per credit, every Unity combat unit used to deliver less Lanchester strength, √(health × damage ÷ firing interval) ÷ cost, than its Organics counterpart, and its speed premium bought little: a wave moves at its slowest member's pace and Unity's infantry is the slower kind. The new prices level that strength per credit; `tests/races-check.mjs` now asserts it (within 3%) instead of the old premium.

| Role | Organics credits | Unity credits before | Unity credits now | Unity strength per credit before | now |
| --- | ---: | ---: | ---: | ---: | ---: |
| rifle | 80 | 90 | 80 | −11.5% | −0.5% |
| rocket | 160 | 175 | 160 | −8.4% | +0.2% |
| scout | 140 | 150 | 130 | −15.2% | −2.2% |
| tank | 300 | 325 | 280 | −13.9% | −0.1% |
| artillery | 380 | 410 | 350 | −14.1% | +0.6% |
| striker | 260 | 280 | 245 | −12.4% | +0.1% |

No health, damage, interval, speed or build time changed, so the identities stand as before: Unity's Needle cohorts and Breach automata are tougher, slower and weaker-hitting than organic infantry at the same price; its walkers, skimmers and runners are lighter, faster and now cheaper than the sturdier, harder-hitting organic vehicles; its structures keep their power efficiencies. The race description drops "Costlier" and the Bastion walker's card names its lower price.

Existing saves still load: `save.js` validates `maxHp` against the health tables, which did not change. A queue refunds the current price when a unit is cancelled or its building sold, so a Unity unit queued in an older save returns 10 to 60 credits less than it cost.

Price experiments (scratch copies of the engine, calibration and held-out seeds, Veteran):

| Variant | Change to AI Unity | Engine | Games | Unity wins |
| --- | --- | --- | ---: | ---: |
| Shipped before | none | `d53d0e2c…` | 30 | 5 (16.7%) |
| A (previous report) | Needle cohort 80, Breach automaton 160 credits | `64baa92b…` | 30 | 13 (43.3%) |
| B (previous report) | every combat unit at the Organic price | `64baa92b…` | 30 | 11 (36.7%) |
| C (previous report) | B plus walker, skimmer and runner health raised to organic parity | `64baa92b…` | 30 | 15 (50.0%) |
| **P (adopted)** | infantry at the Organic price, machines priced to their strength | `db017cbe…` | 30 | 16 (53.3%) |

Variant C was the previous report's recommendation. It was not adopted: it changes four health values, so every existing save holding one of those units would fail validation without a migration, and it makes the Bastion walker (541) sturdier than the Vanguard tank (520), contradicting "lighter machines" and "sturdy vehicles". Variant P reaches the same parity with prices alone. Its fresh-seed validation on the same engine gave AI Unity 9 of 18 games.

## Doctrine results

Each doctrine played Balanced on Standard Rift, with both race orientations and both doctrine assignments: 12 games on the calibration seeds and 12 on the fresh seeds per doctrine and difficulty. "First raid" is the mean time the doctrine's first wave left; "Bases" its mean peak nexus count; "Enemy haulers lost" the mean number of haulers Balanced lost.

| Difficulty | Doctrine vs Balanced | Matches | Doctrine wins | Balanced wins | Draws | Doctrine share | First raid (s) | Raids | Bases | Enemy haulers lost | Median length (s) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Commander | Swarm | 24 | 5 | 19 | 0 | 20.8% | 91 | 3.4 | 1.6 | 0.3 | 477 |
| Commander | Ironclad | 24 | 17 | 7 | 0 | 70.8% | 269 | 1.7 | 1.5 | 1.2 | 489 |
| Commander | Prospector | 24 | 12 | 12 | 0 | 50.0% | 228 | 1.4 | 1.8 | 0.9 | 497 |
| Commander | Siegebreaker | 24 | 15 | 9 | 0 | 62.5% | 151 | 2.2 | 1.5 | 0.8 | 556 |
| Veteran | Swarm | 24 | 9 | 15 | 0 | 37.5% | 61 | 5.8 | 2.2 | 0.4 | 612 |
| Veteran | Ironclad | 24 | 13 | 11 | 0 | 54.2% | 171 | 3.3 | 1.9 | 0.7 | 635 |
| Veteran | Prospector | 24 | 13 | 11 | 0 | 54.2% | 178 | 2.3 | 2.8 | 0.7 | 491 |
| Veteran | Siegebreaker | 24 | 14 | 10 | 0 | 58.3% | 101 | 4.1 | 2.3 | 0.8 | 651 |

| Difficulty | Doctrine | Calibration seeds | Fresh seeds | Before (calibration) |
| --- | --- | ---: | ---: | ---: |
| Commander | Swarm | 2–10 | 3–9 | 0–12 |
| Commander | Ironclad | 8–4 | 9–3 | 11–1 |
| Commander | Prospector | 5–7 | 7–5 | 9–3 |
| Commander | Siegebreaker | 7–5 | 8–4 | 9–3 |
| Veteran | Swarm | 6–6 | 3–9 | 6–6 |
| Veteran | Ironclad | 6–6 | 7–5 | 8–4 |
| Veteran | Prospector | 6–6 | 7–5 | 7–5 |
| Veteran | Siegebreaker | 7–5 | 7–5 | 10–2 |

The calibration column is the 12-game sample the doctrines were tuned on; the fresh column validates it. Every adopted setting reproduced its scratch-copy result exactly on the final engine. Shares move by about eight points per game at 12 games and four at 24, so Ironclad's Commander share (8–4 and 9–3) is just above the 65% target rather than clearly within it, and Swarm's weakness on Commander held in every variant tried. Prospector was not changed and stays even.

### Why waiting won

With the races level, the doctrine trials stopped being decided by race (before, Organics won 39 of the 48 Veteran doctrine games whichever doctrine it carried) and the doctrines' own edges showed. On the new prices but the old knobs, Siegebreaker beat Balanced 11–1 on both difficulties, Ironclad 11–1 on Commander, and Swarm lost 3–9 and 2–10.

A traced Commander game (BALANCE-CINDER-01, Balanced against Ironclad) shows the pattern. Balanced's first wave of eleven leaves at 165 seconds into Ironclad's base, where three sentries, walls and a tank-heavy home army wait; it loses the exchange, regroups forward and is reinforced there until nothing is left, and Ironclad's single push of fourteen at about 400 seconds ends the game. A Veteran trace (BALANCE-VAULT-02, Siegebreaker against Balanced) is similar: Balanced's first wave of ten leaves at 101 seconds and loses its infantry to Siegebreaker's home army and two sentries, and two crawlers then shell Balanced's sentries from beyond their reach until the base falls at 351 seconds.

The cause is the timing knobs, not the doctrines' other traits. Giving Balanced's own knobs Ironclad's timing (`raid` 1.7, `wave` 2) won 11–1 against Balanced on Commander; giving Ironclad Balanced's timing made it 5–7. Removing Ironclad's walls and towers, its second foundry, its engineers, its focus fire, its research order or its unit mix each left it at 9–3 to 12–0 on Commander. The minimum wave size mattered most: Ironclad with `raid` 1 and `wave` 2 went 12–0, with `raid` 1.7 and `wave` 1 8–4. Prospector waits nearly as long and stays even; it spends its early credits on remote nexuses instead.

### Changes

- **Ironclad** keeps the latest first push (`raid` 1.7) but no longer doubles its minimum wave (`wave` 2 → 1). Its armor-heavy mix, two foundries, extra and walled sentries and focus fire are unchanged, and on Veteran its first wave still takes every staged unit.
- **Siegebreaker** raids on Balanced's schedule (`raid` 1.1 → 1, `wave` 1.2 → 1) and no longer holds a wave for up to 90 seconds until it has two crawlers while towers are known. That hold was the only use of the `guns` knob, so the knob and the hold are gone. It keeps its gun-heavy mix, two spotting rovers, engineers, stand-off sieges of remembered towers (`storm` 8), tower-first and reactor-second targets and its focus fire.
- **Swarm** fields more launcher teams and strikers and fewer rifles and rovers (rifle .42 → .30, rocket .14 → .26, scout .14 → .08, tank .08 → .10, striker .22 → .26). Its timing, hauler raids and towers are unchanged.
- **Balanced** and **Prospector** are unchanged, so the default commander, the Cadet tests and `tests/sim-check.mjs`'s pinned games play exactly as before.

### Experiments

Scratch copies changed `ai.js` and replayed the calibration doctrine games (12 games; 24 where marked, adding the fresh seeds). All ran on the new Unity prices. Wins are the doctrine's against Balanced, Veteran / Commander; "—" was not run.

| Doctrine | Variant | Change from the old knobs | Veteran | Commander |
| --- | --- | --- | ---: | ---: |
| Ironclad | old | `raid` 1.7, `wave` 2 | 7–5 | 11–1 |
| Ironclad | I1 | `towers` 2 → 1 | 7–5 | 11–1 |
| Ironclad | I2 | `raid` 1.4 | 8–4 | 12–0 |
| Ironclad | I3 | `wave` 1.5 | 8–4 | 10–2 |
| Ironclad | I4 | `raid` 1.3, `wave` 1.5 | 9–3 | 12–0 |
| Ironclad | I5 | `raid` 1.2, `wave` 1.4 | 8–4 | 10–2 |
| Ironclad | J2 | `raid` 1, `wave` 2 | — | 12–0 |
| Ironclad | J3 | `raid` 1.3, `wave` 1.2 | 8–4 | 8–4 |
| Ironclad | J4 | `raid` 1.1, `wave` 1.6 | — | 10–2 |
| Ironclad | T2 | `raid` 1, `wave` 1 | — | 5–7 |
| Ironclad | A1–A5 | Balanced's research order / one foundry / `engineers` .08 / no extra sentries or walls / Balanced's mix | — | 9–3 / 12–0 / 11–1 / 10–2 / 9–3 |
| Ironclad | F0 | no focus fire on Commander | — | 11–1 |
| Ironclad | **J1 (adopted)** | `wave` 2 → 1 | 6–6 | 8–4 |
| Ironclad | J1, 24 games | with the fresh seeds | 13–11 | 17–7 |
| Ironclad | R1, 24 games | `raid` 1.3, `wave` 1 | 16–8 | 15–9 |
| Ironclad | E1, 24 games | `raid` 1.5, `wave` 1 | 12–12 | 20–4 |
| Ironclad | E2, 24 games | J1 without focus fire on Commander | — | 20–4 |
| Siegebreaker | old | `raid` 1.1, `wave` 1.2, waits for 2 crawlers | 11–1 | 11–1 |
| Siegebreaker | S1 | waits for 1 crawler | 11–1 | 11–1 |
| Siegebreaker | S2 | `raid` .9 | 11–1 | 9–3 |
| Siegebreaker | S3 | `storm` 3 | 11–1 | 10–2 |
| Siegebreaker | S4 | `raid` .9, waits for 1 crawler | 10–2 | 10–2 |
| Siegebreaker | S5 | `raid` 1, `wave` 1, waits for 1 crawler | 9–3 | 8–4 |
| Siegebreaker | S6 | `raid` 1, `wave` 1.1, waits for 1 crawler, `storm` 5 | 9–3 | 8–4 |
| Siegebreaker | G1 | no wait | 10–2 | 10–2 |
| Siegebreaker | G2 | `raid` 1, `wave` 1, waits for 1 crawler, `storm` 3 | 10–2 | 8–4 |
| Siegebreaker | Q2 | `raid` 1.1, `wave` 1, no wait | 9–3 | 10–2 |
| Siegebreaker | B1–B4 | Balanced's research order / `engineers` .08 / Balanced's mix / Balanced's targets | — | 10–2 / 11–1 / 9–3 / 9–3 |
| Siegebreaker | B5 | one rover, no wait, `storm` 3, `towerAversion` 8 | — | 12–0 |
| Siegebreaker | **T3 (adopted)** | `raid` 1, `wave` 1, no wait | 7–5 | 7–5 |
| Siegebreaker | T3, 24 games | with the fresh seeds | 14–10 | 15–9 |
| Siegebreaker | S5, 24 games | with the fresh seeds | 15–9 | 17–7 |
| Siegebreaker | S5 without focus, 24 games | no focus fire on Commander | — | 18–6 |
| Swarm | old | rifle .42, rocket .14, scout .14, tank .08, striker .22 | 3–9 | 2–10 |
| Swarm | W1 | `raid` .8, `wave` 1 | 2–10 | 2–10 |
| Swarm | W2 | rifle .36, rocket .2, scout .08, tank .1, striker .26 | 5–7 | 3–9 |
| Swarm | W3 | W1 and W2 | 4–8 | 2–10 |
| Swarm | X1 | W2, `towers` −1 → 0 | 4–8 | 3–9 |
| Swarm | X2 | W2, one rover, `harass` 4 | 4–8 | 3–9 |
| Swarm | X3 | W2, `raid` .7, `wave` .9 | 6–6 | 3–9 |
| Swarm | **X4 (adopted)** | rifle .3, rocket .26, scout .08, tank .1, striker .26 | 6–6 | 2–10 |
| Swarm | Y1 | waves fall back at 1.4 × the usual ratio and need 1.4 × the edge to return (a new knob) | 5–7 | 2–10 |
| Swarm | Y2 | Y1 and X4 | 4–8 | 4–8 |
| Swarm | Y3 | Y2, `raid` .75 | 4–8 | 1–11 |
| Swarm | Z1–Z3 | Y2 with `towers` 0 / `wave` 1 / `expand` .8 and one more base | 2–10 / 4–8 / 6–6 | 4–8 / 4–8 / 3–9 |
| Swarm | Y2, 24 games | with the fresh seeds | 7–17 | 8–16 |
| Swarm | E3, 24 games | Y2, `harass` 4, one rover, `raid` .7 | 13–11 | 4–20 |
| Balanced's knobs | T1 | in Prospector's place with `raid` 1.7, `wave` 2 | 7–5 | 11–1 |
| Balanced's knobs | T4 | in Prospector's place with `raid` 1.3, `wave` 1.3 | — | 9–3 |

Shared commander changes, each played by all four doctrines on the old knobs (wins against Balanced for Swarm, Ironclad, Prospector and Siegebreaker):

| Variant | Change | Veteran | Commander |
| --- | --- | --- | --- |
| V1 | a regrouping wave still short of what beat it after 50 s returns to the rally instead of advancing again | 2–10, 6–6, 5–7, 12–0 | 1–11, 11–1, 7–5, 11–1 |
| V2 | V1, and a wave keeps massing (for up to two cadences) while it is weaker than the remembered towers at its target and the enemy units seen in the last 60 s | 5–7, 9–3, 5–7, 10–2 | 3–9, 12–0, 7–5, 10–2 |
| V3 | V1, and the same check with units seen in the last 90 s and no time limit | 2–10, 8–4, 5–7, 12–0 | 2–10, 10–2, 6–6, 10–2 |
| L1 | Commander waves fall back at 0.8 of the enemy's strength instead of 0.6 | — | 3–9, 10–2, 7–5, 9–3 |
| M1 | Commander waves take up to 60 staged units instead of 12 | — | 1–11, 10–2, 8–4, 9–3 |
| K1 | Balanced's `raid` 1 → 1.3 | 2–10, 8–4, 3–9, 10–2 | 2–10, 11–1, 8–4, 9–3 |

None of the five shared commander changes moved the patient doctrines below about 75% on Commander, and each also changes how the default commander plays, so none was kept. On 12 games one game moves a share by eight points, so differences of one or two games between rows are noise; the adopted knobs were chosen from rows that held up on the fresh seeds.

### Style

The doctrines remain distinct. Mean share of each combat role in each doctrine's peak army and its mean first raid, over its doctrine games (Balanced over all of them):

| Difficulty | Doctrine | Rifle | Rocket | Scout | Tank | Artillery | Striker | First raid (s) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Commander | Balanced | 37% | 17% | 5% | 33% | 6% | 2% | 151 |
| Commander | Swarm | 42% | 27% | 13% | 14% | 0% | 5% | 91 |
| Commander | Ironclad | 27% | 14% | 5% | 44% | 10% | 0% | 269 |
| Commander | Prospector | 34% | 19% | 5% | 35% | 6% | 1% | 228 |
| Commander | Siegebreaker | 29% | 12% | 11% | 27% | 21% | 0% | 151 |
| Veteran | Balanced | 43% | 13% | 5% | 30% | 7% | 3% | 101 |
| Veteran | Swarm | 42% | 22% | 13% | 14% | 0% | 9% | 61 |
| Veteran | Ironclad | 33% | 11% | 5% | 39% | 11% | 0% | 171 |
| Veteran | Prospector | 39% | 18% | 5% | 29% | 6% | 2% | 178 |
| Veteran | Siegebreaker | 33% | 11% | 10% | 23% | 23% | 0% | 101 |

`tests/ai-doctrines.test.mjs` still holds every signature: Swarm raids first and most often, hunts haulers and leans on infantry; Ironclad raids after Balanced with more towers, walls and armor; Prospector stands up a remote nexus before Balanced; Siegebreaker brings more crawlers and two rovers and breaks a fortified line from beyond its reach.

## Operation rivals

Operations with a rival commander now set its doctrine in `campaign.js` (`aiProfiles`). `tests/operation-probe.mjs` plays a scripted Expedition 07 through the public commands at the Commander setting (Hold the Relay launches its rival one level up, at Veteran, as the briefing does). The probe builds two refineries, a barracks pair, two foundries, a laboratory and two sentries, trains rifles, rocket teams, tanks, one crawler per three tanks and an engineer, and takes expansions only where an objective asks for nexuses (Red Ledger). *Rush* pushes once 18 units stand; *macro* holds until 420 seconds and 30 units. It knows where rival nexuses stand, as a commander who has scouted would, and attacks the nearest; on Hold the Relay it takes the relay.

| Operation | Rival doctrine | Rush | Macro |
| --- | --- | --- | --- |
| Red Ledger | Balanced (before) | lost at 708 s | won at 605 s |
| Red Ledger | Swarm | won at 907 s | won at 640 s |
| Hold the Relay | Balanced (before) | won at 375 s | lost at 265 s |
| Hold the Relay | Ironclad | won at 362 s | lost at 265 s |
| Severance | Balanced (before) | won at 295 s | won at 613 s |
| Severance | Prospector | won at 293 s | won at 647 s |

- **Red Ledger → Swarm.** Dace Mor jumps claims for a living; Swarm's raids on the shard runs fit the claim-jumpers, and the probe won both games against it (it won only the macro game against Balanced). Prospector was tried first: the probe lost its rush game and, in the macro game, filed its three claims but had not delivered the red seam crystal when the 2,400-second limit ended it.
- **Hold the Relay → Ironclad.** Unity's veteran cohorts wall in and garrison the relay from the first minute, then reinforce it with walkers. Contesting the relay early wins against either rival; waiting until 420 seconds loses either way, because the rival holds the relay for four minutes first.
- **Severance → Prospector.** Unity runs the reach from outlying mainframes on the expansion shelves; a Survey core that keeps claiming fields fits the finale. The probe won both games, as against Balanced. Siegebreaker was tried first, on an intermediate engine whose Siegebreaker still held a wave for one crawler, and dropped: the probe lost both games against it (at 819 and 763 seconds).

The briefing copy names the rivals' plans. A rival doctrine changes only how the commander plays: it is stored when an operation starts, so an operation saved before this change continues against Balanced.

## Army composition

Mean of each role's highest living count per race trial (52 games). Peaks for different roles need not occur at the same time.

| Role | Organics mean peak | Unity mean peak |
| --- | ---: | ---: |
| rifle | 8.73 | 10.27 |
| rocket | 2.98 | 3.81 |
| scout | 1.00 | 1.00 |
| tank | 7.08 | 8.33 |
| artillery | 1.90 | 2.67 |
| harvester | 4.83 | 5.67 |
| engineer | 0.75 | 0.71 |
| striker | 0.69 | 0.85 |

## Exact matches

Times are simulated seconds. O = Organics, U = AI Unity; pairs and doctrines are side 0/side 1, and peaks use the same order.

| Batch | Size/profile | Seed | Races | Doctrines | Winner | Winning doctrine | Side | Seconds | Peak units |
| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | --- |
| calibration | standard/rift | BALANCE-CINDER-01 | O/U | — | AI Unity | — | 1 | 686.25 | 16/88 |
| calibration | standard/rift | BALANCE-CINDER-01 | U/O | — | Organics | — | 1 | 552.70 | 15/26 |
| calibration | standard/rift | BALANCE-VAULT-02 | O/U | — | AI Unity | — | 1 | 742.05 | 20/56 |
| calibration | standard/rift | BALANCE-VAULT-02 | U/O | — | Organics | — | 1 | 548.50 | 16/25 |
| calibration | standard/rift | BALANCE-DUSK-03 | O/U | — | AI Unity | — | 1 | 588.45 | 17/40 |
| calibration | standard/rift | BALANCE-DUSK-03 | U/O | — | Organics | — | 1 | 537.75 | 18/20 |
| calibration | standard/basin | BALANCE-CINDER-01 | O/U | — | AI Unity | — | 1 | 698.75 | 20/45 |
| calibration | standard/basin | BALANCE-CINDER-01 | U/O | — | Organics | — | 1 | 463.15 | 16/28 |
| calibration | standard/basin | BALANCE-VAULT-02 | O/U | — | AI Unity | — | 1 | 699.65 | 18/39 |
| calibration | standard/basin | BALANCE-VAULT-02 | U/O | — | Organics | — | 1 | 346.40 | 16/21 |
| calibration | standard/basin | BALANCE-DUSK-03 | O/U | — | Organics | — | 0 | 563.50 | 56/16 |
| calibration | standard/basin | BALANCE-DUSK-03 | U/O | — | AI Unity | — | 0 | 778.50 | 56/17 |
| calibration | standard/highlands | BALANCE-CINDER-01 | O/U | — | AI Unity | — | 1 | 576.85 | 17/38 |
| calibration | standard/highlands | BALANCE-CINDER-01 | U/O | — | Organics | — | 1 | 311.55 | 19/23 |
| calibration | standard/highlands | BALANCE-VAULT-02 | O/U | — | Organics | — | 0 | 385.90 | 18/16 |
| calibration | standard/highlands | BALANCE-VAULT-02 | U/O | — | AI Unity | — | 0 | 1206.40 | 61/18 |
| calibration | standard/highlands | BALANCE-DUSK-03 | O/U | — | Organics | — | 0 | 985.05 | 33/29 |
| calibration | standard/highlands | BALANCE-DUSK-03 | U/O | — | Organics | — | 1 | 880.80 | 32/41 |
| holdout | standard/rift | HOLDOUT-EMBER-04 | O/U | — | AI Unity | — | 1 | 707.05 | 16/54 |
| holdout | standard/rift | HOLDOUT-EMBER-04 | U/O | — | AI Unity | — | 0 | 689.70 | 34/17 |
| holdout | standard/rift | HOLDOUT-OBSIDIAN-05 | O/U | — | AI Unity | — | 1 | 598.45 | 17/32 |
| holdout | standard/rift | HOLDOUT-OBSIDIAN-05 | U/O | — | Organics | — | 1 | 927.70 | 16/23 |
| holdout | standard/basin | HOLDOUT-EMBER-04 | O/U | — | Organics | — | 0 | 482.30 | 35/15 |
| holdout | standard/basin | HOLDOUT-EMBER-04 | U/O | — | AI Unity | — | 0 | 626.60 | 41/15 |
| holdout | standard/basin | HOLDOUT-OBSIDIAN-05 | O/U | — | Organics | — | 0 | 771.65 | 55/17 |
| holdout | standard/basin | HOLDOUT-OBSIDIAN-05 | U/O | — | AI Unity | — | 0 | 736.95 | 35/16 |
| holdout | standard/highlands | HOLDOUT-EMBER-04 | O/U | — | Organics | — | 0 | 782.70 | 24/16 |
| holdout | standard/highlands | HOLDOUT-EMBER-04 | U/O | — | AI Unity | — | 0 | 323.35 | 25/16 |
| holdout | standard/highlands | HOLDOUT-OBSIDIAN-05 | O/U | — | AI Unity | — | 1 | 488.40 | 15/41 |
| holdout | standard/highlands | HOLDOUT-OBSIDIAN-05 | U/O | — | AI Unity | — | 0 | 845.40 | 52/15 |
| fresh | standard/rift | FRESH-BASALT-07 | O/U | — | AI Unity | — | 1 | 801.45 | 18/41 |
| fresh | standard/rift | FRESH-BASALT-07 | U/O | — | AI Unity | — | 0 | 596.85 | 47/14 |
| fresh | standard/rift | FRESH-SLAG-08 | O/U | — | AI Unity | — | 1 | 532.65 | 18/30 |
| fresh | standard/rift | FRESH-SLAG-08 | U/O | — | AI Unity | — | 0 | 1051.85 | 50/18 |
| fresh | standard/rift | FRESH-PUMICE-09 | O/U | — | Organics | — | 0 | 471.95 | 25/17 |
| fresh | standard/rift | FRESH-PUMICE-09 | U/O | — | Organics | — | 1 | 326.45 | 16/18 |
| fresh | standard/basin | FRESH-BASALT-07 | O/U | — | AI Unity | — | 1 | 652.45 | 15/43 |
| fresh | standard/basin | FRESH-BASALT-07 | U/O | — | Organics | — | 1 | 573.05 | 16/29 |
| fresh | standard/basin | FRESH-SLAG-08 | O/U | — | Organics | — | 0 | 288.55 | 21/16 |
| fresh | standard/basin | FRESH-SLAG-08 | U/O | — | AI Unity | — | 0 | 573.70 | 36/16 |
| fresh | standard/basin | FRESH-PUMICE-09 | O/U | — | Organics | — | 0 | 447.60 | 25/19 |
| fresh | standard/basin | FRESH-PUMICE-09 | U/O | — | Organics | — | 1 | 452.10 | 16/24 |
| fresh | standard/highlands | FRESH-BASALT-07 | O/U | — | Organics | — | 0 | 743.90 | 55/18 |
| fresh | standard/highlands | FRESH-BASALT-07 | U/O | — | Organics | — | 1 | 455.95 | 19/25 |
| fresh | standard/highlands | FRESH-SLAG-08 | O/U | — | AI Unity | — | 1 | 630.75 | 16/23 |
| fresh | standard/highlands | FRESH-SLAG-08 | U/O | — | Organics | — | 1 | 298.60 | 16/20 |
| fresh | standard/highlands | FRESH-PUMICE-09 | O/U | — | AI Unity | — | 1 | 611.60 | 17/41 |
| fresh | standard/highlands | FRESH-PUMICE-09 | U/O | — | AI Unity | — | 0 | 1601.50 | 43/37 |
| extended | frontier/rift | EXTENDED-HORIZON-06 | O/U | — | AI Unity | — | 1 | 694.75 | 15/50 |
| extended | frontier/rift | EXTENDED-HORIZON-06 | U/O | — | Organics | — | 1 | 764.80 | 16/50 |
| extended | vast/rift | EXTENDED-HORIZON-06 | O/U | — | Organics | — | 0 | 584.85 | 47/19 |
| extended | vast/rift | EXTENDED-HORIZON-06 | U/O | — | Organics | — | 1 | 882.35 | 33/68 |
| doctrine (Commander) | standard/rift | BALANCE-CINDER-01 | O/U | Swarm/Balanced | AI Unity | Balanced | 1 | 346.60 | 24/20 |
| doctrine (Commander) | standard/rift | BALANCE-CINDER-01 | O/U | Balanced/Swarm | Organics | Balanced | 0 | 626.25 | 30/22 |
| doctrine (Commander) | standard/rift | BALANCE-CINDER-01 | U/O | Swarm/Balanced | Organics | Balanced | 1 | 522.65 | 24/36 |
| doctrine (Commander) | standard/rift | BALANCE-CINDER-01 | U/O | Balanced/Swarm | AI Unity | Balanced | 0 | 313.05 | 21/22 |
| doctrine (Commander) | standard/rift | BALANCE-VAULT-02 | O/U | Swarm/Balanced | AI Unity | Balanced | 1 | 533.20 | 23/28 |
| doctrine (Commander) | standard/rift | BALANCE-VAULT-02 | O/U | Balanced/Swarm | Organics | Balanced | 0 | 335.85 | 27/26 |
| doctrine (Commander) | standard/rift | BALANCE-VAULT-02 | U/O | Swarm/Balanced | Organics | Balanced | 1 | 477.30 | 25/26 |
| doctrine (Commander) | standard/rift | BALANCE-VAULT-02 | U/O | Balanced/Swarm | AI Unity | Balanced | 0 | 809.45 | 41/24 |
| doctrine (Commander) | standard/rift | BALANCE-DUSK-03 | O/U | Swarm/Balanced | Organics | Swarm | 0 | 394.75 | 32/16 |
| doctrine (Commander) | standard/rift | BALANCE-DUSK-03 | O/U | Balanced/Swarm | Organics | Balanced | 0 | 309.90 | 21/23 |
| doctrine (Commander) | standard/rift | BALANCE-DUSK-03 | U/O | Swarm/Balanced | AI Unity | Swarm | 0 | 305.85 | 31/15 |
| doctrine (Commander) | standard/rift | BALANCE-DUSK-03 | U/O | Balanced/Swarm | AI Unity | Balanced | 0 | 454.60 | 22/24 |
| doctrine (Commander) | standard/rift | FRESH-BASALT-07 | O/U | Swarm/Balanced | AI Unity | Balanced | 1 | 980.60 | 31/46 |
| doctrine (Commander) | standard/rift | FRESH-BASALT-07 | O/U | Balanced/Swarm | AI Unity | Swarm | 1 | 666.10 | 22/45 |
| doctrine (Commander) | standard/rift | FRESH-BASALT-07 | U/O | Swarm/Balanced | Organics | Balanced | 1 | 314.35 | 20/23 |
| doctrine (Commander) | standard/rift | FRESH-BASALT-07 | U/O | Balanced/Swarm | AI Unity | Balanced | 0 | 371.15 | 22/29 |
| doctrine (Commander) | standard/rift | FRESH-SLAG-08 | O/U | Swarm/Balanced | AI Unity | Balanced | 1 | 516.10 | 23/20 |
| doctrine (Commander) | standard/rift | FRESH-SLAG-08 | O/U | Balanced/Swarm | Organics | Balanced | 0 | 960.70 | 29/32 |
| doctrine (Commander) | standard/rift | FRESH-SLAG-08 | U/O | Swarm/Balanced | AI Unity | Swarm | 0 | 1096.50 | 57/19 |
| doctrine (Commander) | standard/rift | FRESH-SLAG-08 | U/O | Balanced/Swarm | AI Unity | Balanced | 0 | 438.65 | 21/29 |
| doctrine (Commander) | standard/rift | FRESH-PUMICE-09 | O/U | Swarm/Balanced | AI Unity | Balanced | 1 | 433.60 | 19/25 |
| doctrine (Commander) | standard/rift | FRESH-PUMICE-09 | O/U | Balanced/Swarm | AI Unity | Swarm | 1 | 283.40 | 14/31 |
| doctrine (Commander) | standard/rift | FRESH-PUMICE-09 | U/O | Swarm/Balanced | Organics | Balanced | 1 | 627.05 | 22/33 |
| doctrine (Commander) | standard/rift | FRESH-PUMICE-09 | U/O | Balanced/Swarm | AI Unity | Balanced | 0 | 796.90 | 55/24 |
| doctrine (Commander) | standard/rift | BALANCE-CINDER-01 | O/U | Ironclad/Balanced | AI Unity | Balanced | 1 | 756.20 | 17/44 |
| doctrine (Commander) | standard/rift | BALANCE-CINDER-01 | O/U | Balanced/Ironclad | Organics | Balanced | 0 | 771.75 | 34/15 |
| doctrine (Commander) | standard/rift | BALANCE-CINDER-01 | U/O | Ironclad/Balanced | AI Unity | Ironclad | 0 | 430.20 | 22/25 |
| doctrine (Commander) | standard/rift | BALANCE-CINDER-01 | U/O | Balanced/Ironclad | Organics | Ironclad | 1 | 1214.85 | 22/60 |
| doctrine (Commander) | standard/rift | BALANCE-VAULT-02 | O/U | Ironclad/Balanced | Organics | Ironclad | 0 | 430.60 | 17/21 |
| doctrine (Commander) | standard/rift | BALANCE-VAULT-02 | O/U | Balanced/Ironclad | AI Unity | Ironclad | 1 | 614.90 | 24/18 |
| doctrine (Commander) | standard/rift | BALANCE-VAULT-02 | U/O | Ironclad/Balanced | AI Unity | Ironclad | 0 | 421.40 | 20/22 |
| doctrine (Commander) | standard/rift | BALANCE-VAULT-02 | U/O | Balanced/Ironclad | AI Unity | Balanced | 0 | 1031.55 | 29/22 |
| doctrine (Commander) | standard/rift | BALANCE-DUSK-03 | O/U | Ironclad/Balanced | AI Unity | Balanced | 1 | 1308.70 | 20/59 |
| doctrine (Commander) | standard/rift | BALANCE-DUSK-03 | O/U | Balanced/Ironclad | AI Unity | Ironclad | 1 | 401.95 | 23/21 |
| doctrine (Commander) | standard/rift | BALANCE-DUSK-03 | U/O | Ironclad/Balanced | AI Unity | Ironclad | 0 | 509.05 | 22/20 |
| doctrine (Commander) | standard/rift | BALANCE-DUSK-03 | U/O | Balanced/Ironclad | Organics | Ironclad | 1 | 776.25 | 20/37 |
| doctrine (Commander) | standard/rift | FRESH-BASALT-07 | O/U | Ironclad/Balanced | Organics | Ironclad | 0 | 460.55 | 18/25 |
| doctrine (Commander) | standard/rift | FRESH-BASALT-07 | O/U | Balanced/Ironclad | Organics | Balanced | 0 | 549.75 | 37/18 |
| doctrine (Commander) | standard/rift | FRESH-BASALT-07 | U/O | Ironclad/Balanced | Organics | Balanced | 1 | 428.10 | 17/30 |
| doctrine (Commander) | standard/rift | FRESH-BASALT-07 | U/O | Balanced/Ironclad | Organics | Ironclad | 1 | 373.85 | 21/19 |
| doctrine (Commander) | standard/rift | FRESH-SLAG-08 | O/U | Ironclad/Balanced | Organics | Ironclad | 0 | 466.35 | 16/24 |
| doctrine (Commander) | standard/rift | FRESH-SLAG-08 | O/U | Balanced/Ironclad | AI Unity | Ironclad | 1 | 636.75 | 18/25 |
| doctrine (Commander) | standard/rift | FRESH-SLAG-08 | U/O | Ironclad/Balanced | AI Unity | Ironclad | 0 | 489.30 | 26/25 |
| doctrine (Commander) | standard/rift | FRESH-SLAG-08 | U/O | Balanced/Ironclad | Organics | Ironclad | 1 | 934.95 | 22/22 |
| doctrine (Commander) | standard/rift | FRESH-PUMICE-09 | O/U | Ironclad/Balanced | Organics | Ironclad | 0 | 471.35 | 23/22 |
| doctrine (Commander) | standard/rift | FRESH-PUMICE-09 | O/U | Balanced/Ironclad | AI Unity | Ironclad | 1 | 390.50 | 24/32 |
| doctrine (Commander) | standard/rift | FRESH-PUMICE-09 | U/O | Ironclad/Balanced | Organics | Balanced | 1 | 446.35 | 19/31 |
| doctrine (Commander) | standard/rift | FRESH-PUMICE-09 | U/O | Balanced/Ironclad | Organics | Ironclad | 1 | 379.15 | 26/24 |
| doctrine (Commander) | standard/rift | BALANCE-CINDER-01 | O/U | Prospector/Balanced | AI Unity | Balanced | 1 | 755.90 | 21/56 |
| doctrine (Commander) | standard/rift | BALANCE-CINDER-01 | O/U | Balanced/Prospector | AI Unity | Prospector | 1 | 342.80 | 19/18 |
| doctrine (Commander) | standard/rift | BALANCE-CINDER-01 | U/O | Prospector/Balanced | AI Unity | Prospector | 0 | 337.20 | 25/21 |
| doctrine (Commander) | standard/rift | BALANCE-CINDER-01 | U/O | Balanced/Prospector | AI Unity | Balanced | 0 | 366.30 | 22/21 |
| doctrine (Commander) | standard/rift | BALANCE-VAULT-02 | O/U | Prospector/Balanced | Organics | Prospector | 0 | 356.85 | 22/21 |
| doctrine (Commander) | standard/rift | BALANCE-VAULT-02 | O/U | Balanced/Prospector | Organics | Balanced | 0 | 496.75 | 24/19 |
| doctrine (Commander) | standard/rift | BALANCE-VAULT-02 | U/O | Prospector/Balanced | AI Unity | Prospector | 0 | 905.45 | 30/20 |
| doctrine (Commander) | standard/rift | BALANCE-VAULT-02 | U/O | Balanced/Prospector | AI Unity | Balanced | 0 | 863.45 | 34/21 |
| doctrine (Commander) | standard/rift | BALANCE-DUSK-03 | O/U | Prospector/Balanced | AI Unity | Balanced | 1 | 515.35 | 18/28 |
| doctrine (Commander) | standard/rift | BALANCE-DUSK-03 | O/U | Balanced/Prospector | Organics | Balanced | 0 | 326.70 | 23/21 |
| doctrine (Commander) | standard/rift | BALANCE-DUSK-03 | U/O | Prospector/Balanced | Organics | Balanced | 1 | 1208.30 | 25/47 |
| doctrine (Commander) | standard/rift | BALANCE-DUSK-03 | U/O | Balanced/Prospector | Organics | Prospector | 1 | 422.20 | 20/17 |
| doctrine (Commander) | standard/rift | FRESH-BASALT-07 | O/U | Prospector/Balanced | Organics | Prospector | 0 | 607.95 | 24/26 |
| doctrine (Commander) | standard/rift | FRESH-BASALT-07 | O/U | Balanced/Prospector | Organics | Balanced | 0 | 888.80 | 40/24 |
| doctrine (Commander) | standard/rift | FRESH-BASALT-07 | U/O | Prospector/Balanced | AI Unity | Prospector | 0 | 744.10 | 56/27 |
| doctrine (Commander) | standard/rift | FRESH-BASALT-07 | U/O | Balanced/Prospector | AI Unity | Balanced | 0 | 347.95 | 26/20 |
| doctrine (Commander) | standard/rift | FRESH-SLAG-08 | O/U | Prospector/Balanced | Organics | Prospector | 0 | 476.20 | 22/23 |
| doctrine (Commander) | standard/rift | FRESH-SLAG-08 | O/U | Balanced/Prospector | Organics | Balanced | 0 | 687.95 | 50/25 |
| doctrine (Commander) | standard/rift | FRESH-SLAG-08 | U/O | Prospector/Balanced | AI Unity | Prospector | 0 | 553.80 | 32/26 |
| doctrine (Commander) | standard/rift | FRESH-SLAG-08 | U/O | Balanced/Prospector | AI Unity | Balanced | 0 | 907.40 | 25/24 |
| doctrine (Commander) | standard/rift | FRESH-PUMICE-09 | O/U | Prospector/Balanced | Organics | Prospector | 0 | 445.35 | 20/21 |
| doctrine (Commander) | standard/rift | FRESH-PUMICE-09 | O/U | Balanced/Prospector | AI Unity | Prospector | 1 | 384.75 | 18/28 |
| doctrine (Commander) | standard/rift | FRESH-PUMICE-09 | U/O | Prospector/Balanced | Organics | Balanced | 1 | 309.65 | 21/26 |
| doctrine (Commander) | standard/rift | FRESH-PUMICE-09 | U/O | Balanced/Prospector | Organics | Prospector | 1 | 473.05 | 23/33 |
| doctrine (Commander) | standard/rift | BALANCE-CINDER-01 | O/U | Siegebreaker/Balanced | AI Unity | Balanced | 1 | 320.95 | 16/22 |
| doctrine (Commander) | standard/rift | BALANCE-CINDER-01 | O/U | Balanced/Siegebreaker | Organics | Balanced | 0 | 724.85 | 47/17 |
| doctrine (Commander) | standard/rift | BALANCE-CINDER-01 | U/O | Siegebreaker/Balanced | AI Unity | Siegebreaker | 0 | 475.40 | 22/17 |
| doctrine (Commander) | standard/rift | BALANCE-CINDER-01 | U/O | Balanced/Siegebreaker | AI Unity | Balanced | 0 | 408.05 | 29/16 |
| doctrine (Commander) | standard/rift | BALANCE-VAULT-02 | O/U | Siegebreaker/Balanced | Organics | Siegebreaker | 0 | 399.75 | 28/18 |
| doctrine (Commander) | standard/rift | BALANCE-VAULT-02 | O/U | Balanced/Siegebreaker | Organics | Balanced | 0 | 767.70 | 39/16 |
| doctrine (Commander) | standard/rift | BALANCE-VAULT-02 | U/O | Siegebreaker/Balanced | AI Unity | Siegebreaker | 0 | 731.05 | 18/22 |
| doctrine (Commander) | standard/rift | BALANCE-VAULT-02 | U/O | Balanced/Siegebreaker | Organics | Siegebreaker | 1 | 298.60 | 16/21 |
| doctrine (Commander) | standard/rift | BALANCE-DUSK-03 | O/U | Siegebreaker/Balanced | Organics | Siegebreaker | 0 | 545.50 | 25/21 |
| doctrine (Commander) | standard/rift | BALANCE-DUSK-03 | O/U | Balanced/Siegebreaker | Organics | Balanced | 0 | 556.05 | 24/16 |
| doctrine (Commander) | standard/rift | BALANCE-DUSK-03 | U/O | Siegebreaker/Balanced | AI Unity | Siegebreaker | 0 | 728.40 | 33/17 |
| doctrine (Commander) | standard/rift | BALANCE-DUSK-03 | U/O | Balanced/Siegebreaker | Organics | Siegebreaker | 1 | 756.75 | 19/33 |
| doctrine (Commander) | standard/rift | FRESH-BASALT-07 | O/U | Siegebreaker/Balanced | Organics | Siegebreaker | 0 | 613.40 | 35/20 |
| doctrine (Commander) | standard/rift | FRESH-BASALT-07 | O/U | Balanced/Siegebreaker | AI Unity | Siegebreaker | 1 | 661.05 | 17/37 |
| doctrine (Commander) | standard/rift | FRESH-BASALT-07 | U/O | Siegebreaker/Balanced | AI Unity | Siegebreaker | 0 | 445.20 | 16/19 |
| doctrine (Commander) | standard/rift | FRESH-BASALT-07 | U/O | Balanced/Siegebreaker | Organics | Siegebreaker | 1 | 420.85 | 17/21 |
| doctrine (Commander) | standard/rift | FRESH-SLAG-08 | O/U | Siegebreaker/Balanced | AI Unity | Balanced | 1 | 537.00 | 17/21 |
| doctrine (Commander) | standard/rift | FRESH-SLAG-08 | O/U | Balanced/Siegebreaker | AI Unity | Siegebreaker | 1 | 310.70 | 16/21 |
| doctrine (Commander) | standard/rift | FRESH-SLAG-08 | U/O | Siegebreaker/Balanced | AI Unity | Siegebreaker | 0 | 345.55 | 25/24 |
| doctrine (Commander) | standard/rift | FRESH-SLAG-08 | U/O | Balanced/Siegebreaker | AI Unity | Balanced | 0 | 576.65 | 30/18 |
| doctrine (Commander) | standard/rift | FRESH-PUMICE-09 | O/U | Siegebreaker/Balanced | AI Unity | Balanced | 1 | 857.90 | 15/29 |
| doctrine (Commander) | standard/rift | FRESH-PUMICE-09 | O/U | Balanced/Siegebreaker | AI Unity | Siegebreaker | 1 | 327.35 | 17/25 |
| doctrine (Commander) | standard/rift | FRESH-PUMICE-09 | U/O | Siegebreaker/Balanced | Organics | Balanced | 1 | 1008.30 | 16/50 |
| doctrine (Commander) | standard/rift | FRESH-PUMICE-09 | U/O | Balanced/Siegebreaker | Organics | Siegebreaker | 1 | 567.70 | 18/43 |
| doctrine (Veteran) | standard/rift | BALANCE-CINDER-01 | O/U | Swarm/Balanced | AI Unity | Balanced | 1 | 528.05 | 22/32 |
| doctrine (Veteran) | standard/rift | BALANCE-CINDER-01 | O/U | Balanced/Swarm | AI Unity | Swarm | 1 | 756.85 | 18/72 |
| doctrine (Veteran) | standard/rift | BALANCE-CINDER-01 | U/O | Swarm/Balanced | AI Unity | Swarm | 0 | 900.05 | 90/17 |
| doctrine (Veteran) | standard/rift | BALANCE-CINDER-01 | U/O | Balanced/Swarm | AI Unity | Balanced | 0 | 586.70 | 31/21 |
| doctrine (Veteran) | standard/rift | BALANCE-VAULT-02 | O/U | Swarm/Balanced | Organics | Swarm | 0 | 588.40 | 56/13 |
| doctrine (Veteran) | standard/rift | BALANCE-VAULT-02 | O/U | Balanced/Swarm | Organics | Balanced | 0 | 304.75 | 19/23 |
| doctrine (Veteran) | standard/rift | BALANCE-VAULT-02 | U/O | Swarm/Balanced | AI Unity | Swarm | 0 | 876.10 | 90/19 |
| doctrine (Veteran) | standard/rift | BALANCE-VAULT-02 | U/O | Balanced/Swarm | AI Unity | Balanced | 0 | 617.20 | 26/24 |
| doctrine (Veteran) | standard/rift | BALANCE-DUSK-03 | O/U | Swarm/Balanced | Organics | Swarm | 0 | 633.85 | 66/18 |
| doctrine (Veteran) | standard/rift | BALANCE-DUSK-03 | O/U | Balanced/Swarm | Organics | Balanced | 0 | 487.05 | 31/23 |
| doctrine (Veteran) | standard/rift | BALANCE-DUSK-03 | U/O | Swarm/Balanced | Organics | Balanced | 1 | 428.70 | 23/22 |
| doctrine (Veteran) | standard/rift | BALANCE-DUSK-03 | U/O | Balanced/Swarm | Organics | Swarm | 1 | 748.70 | 17/84 |
| doctrine (Veteran) | standard/rift | FRESH-BASALT-07 | O/U | Swarm/Balanced | AI Unity | Balanced | 1 | 950.85 | 26/49 |
| doctrine (Veteran) | standard/rift | FRESH-BASALT-07 | O/U | Balanced/Swarm | Organics | Balanced | 0 | 470.35 | 31/18 |
| doctrine (Veteran) | standard/rift | FRESH-BASALT-07 | U/O | Swarm/Balanced | Organics | Balanced | 1 | 260.65 | 21/21 |
| doctrine (Veteran) | standard/rift | FRESH-BASALT-07 | U/O | Balanced/Swarm | Organics | Swarm | 1 | 1265.15 | 25/46 |
| doctrine (Veteran) | standard/rift | FRESH-SLAG-08 | O/U | Swarm/Balanced | AI Unity | Balanced | 1 | 412.10 | 17/18 |
| doctrine (Veteran) | standard/rift | FRESH-SLAG-08 | O/U | Balanced/Swarm | AI Unity | Swarm | 1 | 611.75 | 18/61 |
| doctrine (Veteran) | standard/rift | FRESH-SLAG-08 | U/O | Swarm/Balanced | Organics | Balanced | 1 | 528.95 | 20/49 |
| doctrine (Veteran) | standard/rift | FRESH-SLAG-08 | U/O | Balanced/Swarm | AI Unity | Balanced | 0 | 589.55 | 27/20 |
| doctrine (Veteran) | standard/rift | FRESH-PUMICE-09 | O/U | Swarm/Balanced | AI Unity | Balanced | 1 | 753.65 | 23/34 |
| doctrine (Veteran) | standard/rift | FRESH-PUMICE-09 | O/U | Balanced/Swarm | Organics | Balanced | 0 | 628.05 | 45/19 |
| doctrine (Veteran) | standard/rift | FRESH-PUMICE-09 | U/O | Swarm/Balanced | Organics | Balanced | 1 | 312.20 | 19/25 |
| doctrine (Veteran) | standard/rift | FRESH-PUMICE-09 | U/O | Balanced/Swarm | Organics | Swarm | 1 | 671.10 | 18/59 |
| doctrine (Veteran) | standard/rift | BALANCE-CINDER-01 | O/U | Ironclad/Balanced | Organics | Ironclad | 0 | 382.05 | 20/16 |
| doctrine (Veteran) | standard/rift | BALANCE-CINDER-01 | O/U | Balanced/Ironclad | Organics | Balanced | 0 | 324.95 | 25/19 |
| doctrine (Veteran) | standard/rift | BALANCE-CINDER-01 | U/O | Ironclad/Balanced | AI Unity | Ironclad | 0 | 386.30 | 17/16 |
| doctrine (Veteran) | standard/rift | BALANCE-CINDER-01 | U/O | Balanced/Ironclad | AI Unity | Balanced | 0 | 606.05 | 43/16 |
| doctrine (Veteran) | standard/rift | BALANCE-VAULT-02 | O/U | Ironclad/Balanced | AI Unity | Balanced | 1 | 851.10 | 20/42 |
| doctrine (Veteran) | standard/rift | BALANCE-VAULT-02 | O/U | Balanced/Ironclad | AI Unity | Ironclad | 1 | 322.30 | 21/21 |
| doctrine (Veteran) | standard/rift | BALANCE-VAULT-02 | U/O | Ironclad/Balanced | AI Unity | Ironclad | 0 | 576.80 | 31/22 |
| doctrine (Veteran) | standard/rift | BALANCE-VAULT-02 | U/O | Balanced/Ironclad | AI Unity | Balanced | 0 | 1380.00 | 61/19 |
| doctrine (Veteran) | standard/rift | BALANCE-DUSK-03 | O/U | Ironclad/Balanced | Organics | Ironclad | 0 | 390.85 | 21/22 |
| doctrine (Veteran) | standard/rift | BALANCE-DUSK-03 | O/U | Balanced/Ironclad | AI Unity | Ironclad | 1 | 367.85 | 19/19 |
| doctrine (Veteran) | standard/rift | BALANCE-DUSK-03 | U/O | Ironclad/Balanced | Organics | Balanced | 1 | 541.95 | 19/49 |
| doctrine (Veteran) | standard/rift | BALANCE-DUSK-03 | U/O | Balanced/Ironclad | AI Unity | Balanced | 0 | 873.60 | 34/19 |
| doctrine (Veteran) | standard/rift | FRESH-BASALT-07 | O/U | Ironclad/Balanced | Organics | Ironclad | 0 | 1517.95 | 47/25 |
| doctrine (Veteran) | standard/rift | FRESH-BASALT-07 | O/U | Balanced/Ironclad | Organics | Balanced | 0 | 390.65 | 23/19 |
| doctrine (Veteran) | standard/rift | FRESH-BASALT-07 | U/O | Ironclad/Balanced | AI Unity | Ironclad | 0 | 843.00 | 27/19 |
| doctrine (Veteran) | standard/rift | FRESH-BASALT-07 | U/O | Balanced/Ironclad | AI Unity | Balanced | 0 | 817.45 | 45/16 |
| doctrine (Veteran) | standard/rift | FRESH-SLAG-08 | O/U | Ironclad/Balanced | Organics | Ironclad | 0 | 1037.80 | 24/20 |
| doctrine (Veteran) | standard/rift | FRESH-SLAG-08 | O/U | Balanced/Ironclad | Organics | Balanced | 0 | 498.20 | 19/16 |
| doctrine (Veteran) | standard/rift | FRESH-SLAG-08 | U/O | Ironclad/Balanced | AI Unity | Ironclad | 0 | 636.00 | 36/19 |
| doctrine (Veteran) | standard/rift | FRESH-SLAG-08 | U/O | Balanced/Ironclad | AI Unity | Balanced | 0 | 1160.95 | 87/18 |
| doctrine (Veteran) | standard/rift | FRESH-PUMICE-09 | O/U | Ironclad/Balanced | Organics | Ironclad | 0 | 740.60 | 33/20 |
| doctrine (Veteran) | standard/rift | FRESH-PUMICE-09 | O/U | Balanced/Ironclad | AI Unity | Ironclad | 1 | 552.10 | 17/24 |
| doctrine (Veteran) | standard/rift | FRESH-PUMICE-09 | U/O | Ironclad/Balanced | AI Unity | Ironclad | 0 | 635.15 | 28/18 |
| doctrine (Veteran) | standard/rift | FRESH-PUMICE-09 | U/O | Balanced/Ironclad | AI Unity | Balanced | 0 | 857.60 | 38/19 |
| doctrine (Veteran) | standard/rift | BALANCE-CINDER-01 | O/U | Prospector/Balanced | Organics | Prospector | 0 | 588.55 | 43/15 |
| doctrine (Veteran) | standard/rift | BALANCE-CINDER-01 | O/U | Balanced/Prospector | Organics | Balanced | 0 | 319.20 | 23/16 |
| doctrine (Veteran) | standard/rift | BALANCE-CINDER-01 | U/O | Prospector/Balanced | AI Unity | Prospector | 0 | 472.85 | 31/16 |
| doctrine (Veteran) | standard/rift | BALANCE-CINDER-01 | U/O | Balanced/Prospector | Organics | Prospector | 1 | 606.60 | 20/43 |
| doctrine (Veteran) | standard/rift | BALANCE-VAULT-02 | O/U | Prospector/Balanced | Organics | Prospector | 0 | 847.35 | 48/17 |
| doctrine (Veteran) | standard/rift | BALANCE-VAULT-02 | O/U | Balanced/Prospector | Organics | Balanced | 0 | 1169.80 | 38/17 |
| doctrine (Veteran) | standard/rift | BALANCE-VAULT-02 | U/O | Prospector/Balanced | Organics | Balanced | 1 | 306.75 | 14/30 |
| doctrine (Veteran) | standard/rift | BALANCE-VAULT-02 | U/O | Balanced/Prospector | AI Unity | Balanced | 0 | 487.75 | 35/16 |
| doctrine (Veteran) | standard/rift | BALANCE-DUSK-03 | O/U | Prospector/Balanced | AI Unity | Balanced | 1 | 430.25 | 15/33 |
| doctrine (Veteran) | standard/rift | BALANCE-DUSK-03 | O/U | Balanced/Prospector | AI Unity | Prospector | 1 | 716.10 | 19/26 |
| doctrine (Veteran) | standard/rift | BALANCE-DUSK-03 | U/O | Prospector/Balanced | Organics | Balanced | 1 | 256.50 | 16/21 |
| doctrine (Veteran) | standard/rift | BALANCE-DUSK-03 | U/O | Balanced/Prospector | Organics | Prospector | 1 | 780.15 | 20/42 |
| doctrine (Veteran) | standard/rift | FRESH-BASALT-07 | O/U | Prospector/Balanced | AI Unity | Balanced | 1 | 360.30 | 15/32 |
| doctrine (Veteran) | standard/rift | FRESH-BASALT-07 | O/U | Balanced/Prospector | Organics | Balanced | 0 | 443.35 | 23/15 |
| doctrine (Veteran) | standard/rift | FRESH-BASALT-07 | U/O | Prospector/Balanced | AI Unity | Prospector | 0 | 480.30 | 54/17 |
| doctrine (Veteran) | standard/rift | FRESH-BASALT-07 | U/O | Balanced/Prospector | Organics | Prospector | 1 | 608.10 | 21/22 |
| doctrine (Veteran) | standard/rift | FRESH-SLAG-08 | O/U | Prospector/Balanced | Organics | Prospector | 0 | 490.65 | 22/16 |
| doctrine (Veteran) | standard/rift | FRESH-SLAG-08 | O/U | Balanced/Prospector | Organics | Balanced | 0 | 302.25 | 23/14 |
| doctrine (Veteran) | standard/rift | FRESH-SLAG-08 | U/O | Prospector/Balanced | Organics | Balanced | 1 | 755.90 | 17/50 |
| doctrine (Veteran) | standard/rift | FRESH-SLAG-08 | U/O | Balanced/Prospector | Organics | Prospector | 1 | 437.00 | 16/33 |
| doctrine (Veteran) | standard/rift | FRESH-PUMICE-09 | O/U | Prospector/Balanced | AI Unity | Balanced | 1 | 437.65 | 14/26 |
| doctrine (Veteran) | standard/rift | FRESH-PUMICE-09 | O/U | Balanced/Prospector | AI Unity | Prospector | 1 | 745.15 | 17/55 |
| doctrine (Veteran) | standard/rift | FRESH-PUMICE-09 | U/O | Prospector/Balanced | AI Unity | Prospector | 0 | 529.10 | 36/18 |
| doctrine (Veteran) | standard/rift | FRESH-PUMICE-09 | U/O | Balanced/Prospector | Organics | Prospector | 1 | 1352.75 | 33/32 |
| doctrine (Veteran) | standard/rift | BALANCE-CINDER-01 | O/U | Siegebreaker/Balanced | AI Unity | Balanced | 1 | 884.05 | 19/66 |
| doctrine (Veteran) | standard/rift | BALANCE-CINDER-01 | O/U | Balanced/Siegebreaker | Organics | Balanced | 0 | 835.05 | 53/14 |
| doctrine (Veteran) | standard/rift | BALANCE-CINDER-01 | U/O | Siegebreaker/Balanced | AI Unity | Siegebreaker | 0 | 622.55 | 41/17 |
| doctrine (Veteran) | standard/rift | BALANCE-CINDER-01 | U/O | Balanced/Siegebreaker | AI Unity | Balanced | 0 | 768.40 | 45/28 |
| doctrine (Veteran) | standard/rift | BALANCE-VAULT-02 | O/U | Siegebreaker/Balanced | Organics | Siegebreaker | 0 | 704.90 | 57/15 |
| doctrine (Veteran) | standard/rift | BALANCE-VAULT-02 | O/U | Balanced/Siegebreaker | AI Unity | Siegebreaker | 1 | 529.05 | 19/26 |
| doctrine (Veteran) | standard/rift | BALANCE-VAULT-02 | U/O | Siegebreaker/Balanced | Organics | Balanced | 1 | 1101.75 | 22/72 |
| doctrine (Veteran) | standard/rift | BALANCE-VAULT-02 | U/O | Balanced/Siegebreaker | Organics | Siegebreaker | 1 | 347.00 | 18/24 |
| doctrine (Veteran) | standard/rift | BALANCE-DUSK-03 | O/U | Siegebreaker/Balanced | Organics | Siegebreaker | 0 | 723.00 | 46/16 |
| doctrine (Veteran) | standard/rift | BALANCE-DUSK-03 | O/U | Balanced/Siegebreaker | AI Unity | Siegebreaker | 1 | 374.90 | 16/27 |
| doctrine (Veteran) | standard/rift | BALANCE-DUSK-03 | U/O | Siegebreaker/Balanced | AI Unity | Siegebreaker | 0 | 639.40 | 32/16 |
| doctrine (Veteran) | standard/rift | BALANCE-DUSK-03 | U/O | Balanced/Siegebreaker | AI Unity | Balanced | 0 | 738.30 | 28/16 |
| doctrine (Veteran) | standard/rift | FRESH-BASALT-07 | O/U | Siegebreaker/Balanced | AI Unity | Balanced | 1 | 723.70 | 20/63 |
| doctrine (Veteran) | standard/rift | FRESH-BASALT-07 | O/U | Balanced/Siegebreaker | Organics | Balanced | 0 | 576.55 | 18/15 |
| doctrine (Veteran) | standard/rift | FRESH-BASALT-07 | U/O | Siegebreaker/Balanced | AI Unity | Siegebreaker | 0 | 547.40 | 63/20 |
| doctrine (Veteran) | standard/rift | FRESH-BASALT-07 | U/O | Balanced/Siegebreaker | Organics | Siegebreaker | 1 | 565.40 | 20/37 |
| doctrine (Veteran) | standard/rift | FRESH-SLAG-08 | O/U | Siegebreaker/Balanced | Organics | Siegebreaker | 0 | 368.35 | 15/16 |
| doctrine (Veteran) | standard/rift | FRESH-SLAG-08 | O/U | Balanced/Siegebreaker | AI Unity | Siegebreaker | 1 | 932.10 | 18/53 |
| doctrine (Veteran) | standard/rift | FRESH-SLAG-08 | U/O | Siegebreaker/Balanced | Organics | Balanced | 1 | 651.40 | 14/47 |
| doctrine (Veteran) | standard/rift | FRESH-SLAG-08 | U/O | Balanced/Siegebreaker | Organics | Siegebreaker | 1 | 871.00 | 27/33 |
| doctrine (Veteran) | standard/rift | FRESH-PUMICE-09 | O/U | Siegebreaker/Balanced | Organics | Siegebreaker | 0 | 462.75 | 26/15 |
| doctrine (Veteran) | standard/rift | FRESH-PUMICE-09 | O/U | Balanced/Siegebreaker | Organics | Balanced | 0 | 352.55 | 17/15 |
| doctrine (Veteran) | standard/rift | FRESH-PUMICE-09 | U/O | Siegebreaker/Balanced | AI Unity | Siegebreaker | 0 | 680.50 | 29/23 |
| doctrine (Veteran) | standard/rift | FRESH-PUMICE-09 | U/O | Balanced/Siegebreaker | AI Unity | Balanced | 0 | 561.95 | 40/14 |

## Reproduce

Run from `fun/ashline`. Each `race-balance` command writes standalone JSON with the engine hash, parameters, definition snapshots, every match and a summary. `--profile` takes one or more comma-separated ids (`rift`, `basin`, `highlands`, `ember`, `steppe`, `deadwood`, `crown`); without it a batch plays all seven, so the commands below name the profiles these trials used. One profile per process splits a batch. `--suite calibration|holdout|fresh|extended`, `--difficulty easy|normal|hard` (default `hard`) and `--doctrines a,b` select the seeds and commanders.

```sh
node tests/race-balance.mjs --suite calibration --size standard --profile rift,basin,highlands --output /tmp/ashline-calibration.json
node tests/race-balance.mjs --suite holdout --size standard --profile rift,basin,highlands --output /tmp/ashline-holdout.json
node tests/race-balance.mjs --suite fresh --size standard --profile rift,basin,highlands --output /tmp/ashline-fresh.json
node tests/race-balance.mjs --suite extended --size frontier --profile rift --output /tmp/ashline-frontier.json
node tests/race-balance.mjs --suite extended --size vast --profile rift --output /tmp/ashline-vast.json
node tests/race-balance.mjs --suite calibration --size standard --profile rift --difficulty normal --doctrines swarm,balanced --output /tmp/ashline-normal-calibration-swarm.json
node tests/race-balance.mjs --suite calibration --size standard --profile rift --difficulty normal --doctrines ironclad,balanced --output /tmp/ashline-normal-calibration-ironclad.json
node tests/race-balance.mjs --suite calibration --size standard --profile rift --difficulty normal --doctrines prospector,balanced --output /tmp/ashline-normal-calibration-prospector.json
node tests/race-balance.mjs --suite calibration --size standard --profile rift --difficulty normal --doctrines siegebreaker,balanced --output /tmp/ashline-normal-calibration-siegebreaker.json
node tests/race-balance.mjs --suite fresh --size standard --profile rift --difficulty normal --doctrines swarm,balanced --output /tmp/ashline-normal-fresh-swarm.json
node tests/race-balance.mjs --suite fresh --size standard --profile rift --difficulty normal --doctrines ironclad,balanced --output /tmp/ashline-normal-fresh-ironclad.json
node tests/race-balance.mjs --suite fresh --size standard --profile rift --difficulty normal --doctrines prospector,balanced --output /tmp/ashline-normal-fresh-prospector.json
node tests/race-balance.mjs --suite fresh --size standard --profile rift --difficulty normal --doctrines siegebreaker,balanced --output /tmp/ashline-normal-fresh-siegebreaker.json
node tests/race-balance.mjs --suite calibration --size standard --profile rift --difficulty hard --doctrines swarm,balanced --output /tmp/ashline-hard-calibration-swarm.json
node tests/race-balance.mjs --suite calibration --size standard --profile rift --difficulty hard --doctrines ironclad,balanced --output /tmp/ashline-hard-calibration-ironclad.json
node tests/race-balance.mjs --suite calibration --size standard --profile rift --difficulty hard --doctrines prospector,balanced --output /tmp/ashline-hard-calibration-prospector.json
node tests/race-balance.mjs --suite calibration --size standard --profile rift --difficulty hard --doctrines siegebreaker,balanced --output /tmp/ashline-hard-calibration-siegebreaker.json
node tests/race-balance.mjs --suite fresh --size standard --profile rift --difficulty hard --doctrines swarm,balanced --output /tmp/ashline-hard-fresh-swarm.json
node tests/race-balance.mjs --suite fresh --size standard --profile rift --difficulty hard --doctrines ironclad,balanced --output /tmp/ashline-hard-fresh-ironclad.json
node tests/race-balance.mjs --suite fresh --size standard --profile rift --difficulty hard --doctrines prospector,balanced --output /tmp/ashline-hard-fresh-prospector.json
node tests/race-balance.mjs --suite fresh --size standard --profile rift --difficulty hard --doctrines siegebreaker,balanced --output /tmp/ashline-hard-fresh-siegebreaker.json
```

The operation probe prints one JSON line per game; `--mission`, `--doctrine` (doctrine ids, or `operation` for the operation's own rival), `--style rush,macro`, `--difficulty` (the briefing's Opposition setting) and `--limit` select the games:

```sh
node tests/operation-probe.mjs --mission red-ledger --doctrine balanced,operation --style rush,macro
node tests/operation-probe.mjs --mission hold-the-relay --doctrine balanced,operation --style rush,macro
node tests/operation-probe.mjs --mission severance --doctrine balanced,operation --style rush,macro
```

The [complete recorded results](balance-results.json) hold every race and doctrine match with configuration snapshots, composition, research and economy samples. `tests/balance-docs.test.mjs` checks that the `race-balance` commands above play the profiles recorded there.

## Limits

This is a small deterministic sample of one commander policy. Both sides use the same code, so the trials expose unit and economy asymmetries between the races, and timing and composition asymmetries between the doctrines, under that policy; they do not cover human strategies, Cadet, scripted operations beyond the probe, or doctrine pairings other than each doctrine against Balanced. A 12-game doctrine sample resolves about eight points per game, so the doctrine shares are estimates, not rankings. Walls, crater cover, research prerequisites, brownouts, abilities and race-specific save continuation have separate functional tests. Any change to combat statistics, prices, the commander, maps or power should rerun both orientations on fresh seeds as well as this set.
