# Race and doctrine balance trials

Engine SHA-256: `dd6ec7bed70116aefce5f906f17944990db812843f16528167f4a9431e71992e`, over `sim.js`, `ai.js`, `terrain.js`, `flocking.js`, `traffic.js`, `mission.js`, `campaign.js` and `abilities.js` in that order. Trials recorded on 2026-10-10 with the doctrine commanders (Veteran difficulty).

The final commander decided **81 of 82 matches** under the Charter rule; one doctrine match reached the 2,400-second limit. In the 34 race trials **Organics won 27 and AI Unity 7** (20.6% Unity). On Standard maps Organics won 25 of 30, including 11 of 12 held-out games. Against Balanced, Swarm went 6–6, Prospector 6–5 with one draw, Ironclad 8–4 and Siegebreaker 10–2. The race result is a real asymmetry under this commander, not noise; *Why AI Unity loses* below explains it and tests three candidate stat changes.

These results describe this fixed commander policy and seed sample. They do not establish race balance for human play, and they replace the previous trials, which measured an earlier commander (engine `faa214c6…`, 2026-09-08: Organics 16, AI Unity 18 of 34).

## Method

`tests/race-balance.mjs` creates complete, untouched games with `aiTeams: [0,1]`, independent commander state and fog knowledge for each side, normal starting credits, real research, power, mining and combat. There are no forced attacks, free reinforcements, healed nexuses or victory scores. Both sides run the same commander code; only the race (and, in doctrine trials, the doctrine) differs.

Each seed and profile is played with Organics and AI Unity swapped between side 0 (lower left) and side 1 (upper right). Doctrine trials (`--doctrines a,b`) also swap which race carries which doctrine, so every seed yields four games. A side wins under the Charter rule: the loser has neither a nexus nor a construction vehicle. A still-playing match at the time limit is a draw.

All runs used Veteran (`--difficulty hard`) commanders, `updateGame` every 0.25 simulated seconds (stepped internally at no more than 0.05 seconds), a 2,400-second limit and the game's population rule (200 units per completed nexus, at most 2,000). Each match records the winner, length, peak and final army composition, research, raids, first-raid time, peak nexus count, haulers lost, seconds spent above 1,500 credits and minute-by-minute economy samples. Simulation timings are host timings, not rendering benchmarks.

The harness now counts roles in null-prototype tallies, so the Organics `constructor` role no longer reads `Object.prototype.constructor` (which produced `NaN` peaks and garbage counts), and it takes the winner from the game status rather than from surviving nexuses, so a side that lost its last nexus but still drives a construction vehicle is no longer reported as beaten.

## Race results

Calibration plays three seeds × three profiles × both race orientations on Standard 144×112 maps (18 games); the held-out batch plays two other seeds on the same three profiles (12 games). One further seed was played in both orientations on Frontier 192×144 and Vast 224×168 Rift (four games).

| Batch | Matches | Organics wins | Unity wins | Draws | Unity win share |
| --- | ---: | ---: | ---: | ---: | ---: |
| Standard calibration | 18 | 14 | 4 | 0 | 22.2% |
| Standard held-out | 12 | 11 | 1 | 0 | 8.3% |
| All Standard | **30** | **25** | **5** | **0** | **16.7%** |
| Frontier extension | 2 | 1 | 1 | 0 | 50.0% |
| Vast extension | 2 | 1 | 1 | 0 | 50.0% |
| All race trials | **34** | **27** | **7** | **0** | **20.6%** |

| Standard profile | Matches | Organics wins | Unity wins | Draws | Unity win share |
| --- | ---: | ---: | ---: | ---: | ---: |
| Rift | 10 | 8 | 2 | 0 | 20.0% |
| Basin | 10 | 9 | 1 | 0 | 10.0% |
| Highlands | 10 | 8 | 2 | 0 | 20.0% |

Side 0 won 18 race trials and side 1 won 16. Standard games finished in 407.55–1,460.25 simulated seconds (median 613.65); Frontier and Vast games in 634.60–914.55. The largest army was 117 units on one side, so normal-economy matches still do not approach the population limit; `tests/capacity-check.mjs` and the browser population check cover that separately.

### Why AI Unity loses

The previous trials played a commander that filled fixed unit quotas (15 rifles, 8 rockets, 10 tanks and about 3.5 crawlers), so equal head counts met, and Unity's sturdier infantry carried 18 of 34 games while its price premiums mostly cost it tempo. The doctrine commander spends whatever it earns, so armies are bounded by income and cost efficiency decides. Per credit, every Unity combat unit delivers less Lanchester strength, measured as √(health × damage ÷ firing interval) ÷ cost:

| Role | Organics credits | Unity credits | Unity strength per credit |
| --- | ---: | ---: | ---: |
| rifle | 80 | 90 | −11.5% |
| rocket | 160 | 175 | −8.4% |
| scout | 140 | 150 | −15.2% |
| tank | 300 | 325 | −13.9% |
| artillery | 380 | 410 | −14.1% |
| striker | 260 | 280 | −12.4% |

Unity pays for mobility: faster walkers, skimmers and drones. The commander moves each wave at its slowest member's pace, and Unity's infantry is the slower kind, so little of that premium becomes fighting value. The composition table below shows the result: apart from the single scout, Unity fields fewer units in every combat role.

### Unity statistics experiments

Scratch copies of the engine changed only `UNITY_UNITS` in `sim.js` and replayed the trial seeds. They are evidence for a statistics change, not results of the shipped engine, and they are not pooled with the tables above.

| Variant | Change to AI Unity | Games | Unity wins |
| --- | --- | ---: | ---: |
| Shipped | none | 18 calibration + 12 held-out | 4 + 1 (16.7%) |
| A | Needle cohort 80, Breach automaton 160 credits | 18 calibration | 6 (33.3%) |
| B | every combat unit at the Organic price | 18 calibration | 7 (38.9%) |
| C | B, plus vehicle health at per-unit parity: Veil skimmer 200, Bastion walker 541, Arc siege walker 274, Talon runner 320 | 18 calibration + 12 held-out | 8 + 6 (46.7%) |

A and B ran on the build just before the final tower-mix rule, whose own calibration split 15–3; C ran on the final commander. Variant C is the recommended starting point. It keeps Unity's speed profile and its sturdier, weaker-hitting infantry, but drops the price premium and gives its walkers the durability their lighter shells now cost, so the race description's "costlier" and "lighter machines" would need rewording. Any adopted change should rerun this whole set on fresh seeds.

## Doctrine results

Each doctrine played Balanced on the three calibration seeds (Standard Rift), with both race orientations and both doctrine assignments (12 games per doctrine). "First raid" is the mean time the doctrine's first wave left; "Bases" its mean peak nexus count; "Enemy haulers lost" the mean number of haulers Balanced lost.

| Doctrine vs Balanced | Matches | Doctrine wins | Balanced wins | Draws | Doctrine win share | First raid (s) | Raids | Bases | Enemy haulers lost | Median length (s) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Swarm | 12 | 6 | 6 | 0 | 50.0% | 61 | 7.6 | 2.3 | 0.6 | 694 |
| Ironclad | 12 | 8 | 4 | 0 | 66.7% | 220 | 1.2 | 1.3 | 0.4 | 505 |
| Prospector | 12 | 6 | 5 | 1 | 54.5% | 163 | 1.7 | 2.3 | 0.7 | 456 |
| Siegebreaker | 12 | 10 | 2 | 0 | 83.3% | 151 | 3.2 | 2.3 | 1.3 | 659 |

Doctrine trials ran on Standard Rift only, 12 games per doctrine, so one game moves a share by about eight points. The race asymmetry shows here too: Organics won 38 of the 47 decided doctrine games, whichever doctrine it carried.

Swarm raids first (a mean of 61 seconds) and most often (7.6 waves a game), and it trades evenly with Balanced. Ironclad and Prospector hold their first wave longest (220 and 163 seconds) and build more before they fight. Siegebreaker's 10–2 has a clear shape in a traced game (DUSK-03, Unity Balanced against Organics Siegebreaker): Balanced's first wave leaves at 100 seconds and meets Siegebreaker's whole home army beside its first sentry. Siegebreaker waits for two crawlers before it raids (151 seconds on average), wins that defensive exchange, then counterattacks a thinned base. Ironclad, which also raids late, shows a similar margin. These trials measure each doctrine only against Balanced, so they show that waiting beats Balanced's early raids. They do not rank the doctrines against each other. At the same difficulty, a Siegebreaker rival is harder to beat than a Balanced one.

## Army composition

Mean of each role's highest living count per race trial (34 games). Peaks for different roles need not occur at the same time.

| Role | Organics mean peak | Unity mean peak |
| --- | ---: | ---: |
| rifle | 9.88 | 8.88 |
| rocket | 4.26 | 3.03 |
| scout | 1.00 | 1.00 |
| tank | 9.00 | 6.68 |
| artillery | 3.32 | 1.50 |
| harvester | 5.76 | 4.97 |
| engineer | 0.94 | 0.50 |
| striker | 1.15 | 0.71 |

## Exact matches

Times are simulated seconds. O = Organics, U = AI Unity; pairs and doctrines are side 0/side 1, and peaks use the same order.

| Batch | Size/profile | Seed | Races | Doctrines | Winner | Winning doctrine | Side | Seconds | Peak units |
| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | --- |
| calibration | standard/rift | BALANCE-CINDER-01 | O/U | — | Organics | — | 0 | 599.50 | 40/15 |
| calibration | standard/rift | BALANCE-CINDER-01 | U/O | — | Organics | — | 1 | 420.90 | 14/24 |
| calibration | standard/rift | BALANCE-VAULT-02 | O/U | — | Organics | — | 0 | 415.70 | 24/14 |
| calibration | standard/rift | BALANCE-VAULT-02 | U/O | — | Organics | — | 1 | 573.35 | 16/37 |
| calibration | standard/rift | BALANCE-DUSK-03 | O/U | — | AI Unity | — | 1 | 470.80 | 17/34 |
| calibration | standard/rift | BALANCE-DUSK-03 | U/O | — | AI Unity | — | 0 | 857.70 | 64/15 |
| calibration | standard/basin | BALANCE-CINDER-01 | O/U | — | AI Unity | — | 1 | 948.95 | 25/60 |
| calibration | standard/basin | BALANCE-CINDER-01 | U/O | — | Organics | — | 1 | 666.10 | 16/29 |
| calibration | standard/basin | BALANCE-VAULT-02 | O/U | — | Organics | — | 0 | 881.20 | 33/14 |
| calibration | standard/basin | BALANCE-VAULT-02 | U/O | — | Organics | — | 1 | 1126.65 | 17/24 |
| calibration | standard/basin | BALANCE-DUSK-03 | O/U | — | Organics | — | 0 | 558.95 | 33/16 |
| calibration | standard/basin | BALANCE-DUSK-03 | U/O | — | Organics | — | 1 | 700.00 | 16/25 |
| calibration | standard/highlands | BALANCE-CINDER-01 | O/U | — | Organics | — | 0 | 780.95 | 47/37 |
| calibration | standard/highlands | BALANCE-CINDER-01 | U/O | — | Organics | — | 1 | 484.95 | 15/39 |
| calibration | standard/highlands | BALANCE-VAULT-02 | O/U | — | Organics | — | 0 | 575.35 | 36/16 |
| calibration | standard/highlands | BALANCE-VAULT-02 | U/O | — | Organics | — | 1 | 534.25 | 15/26 |
| calibration | standard/highlands | BALANCE-DUSK-03 | O/U | — | Organics | — | 0 | 498.50 | 36/18 |
| calibration | standard/highlands | BALANCE-DUSK-03 | U/O | — | AI Unity | — | 0 | 613.65 | 70/15 |
| holdout | standard/rift | HOLDOUT-EMBER-04 | O/U | — | Organics | — | 0 | 1366.65 | 27/24 |
| holdout | standard/rift | HOLDOUT-EMBER-04 | U/O | — | Organics | — | 1 | 562.30 | 16/34 |
| holdout | standard/rift | HOLDOUT-OBSIDIAN-05 | O/U | — | Organics | — | 0 | 477.15 | 37/16 |
| holdout | standard/rift | HOLDOUT-OBSIDIAN-05 | U/O | — | Organics | — | 1 | 851.05 | 16/31 |
| holdout | standard/basin | HOLDOUT-EMBER-04 | O/U | — | Organics | — | 0 | 547.10 | 40/15 |
| holdout | standard/basin | HOLDOUT-EMBER-04 | U/O | — | Organics | — | 1 | 668.70 | 15/42 |
| holdout | standard/basin | HOLDOUT-OBSIDIAN-05 | O/U | — | Organics | — | 0 | 407.55 | 22/15 |
| holdout | standard/basin | HOLDOUT-OBSIDIAN-05 | U/O | — | Organics | — | 1 | 712.60 | 17/27 |
| holdout | standard/highlands | HOLDOUT-EMBER-04 | O/U | — | Organics | — | 0 | 620.10 | 21/15 |
| holdout | standard/highlands | HOLDOUT-EMBER-04 | U/O | — | Organics | — | 1 | 1460.25 | 25/71 |
| holdout | standard/highlands | HOLDOUT-OBSIDIAN-05 | O/U | — | Organics | — | 0 | 1449.05 | 36/32 |
| holdout | standard/highlands | HOLDOUT-OBSIDIAN-05 | U/O | — | AI Unity | — | 0 | 600.10 | 39/16 |
| extended | frontier/rift | EXTENDED-HORIZON-06 | O/U | — | AI Unity | — | 1 | 634.60 | 15/31 |
| extended | frontier/rift | EXTENDED-HORIZON-06 | U/O | — | Organics | — | 1 | 737.35 | 21/51 |
| extended | vast/rift | EXTENDED-HORIZON-06 | O/U | — | Organics | — | 0 | 914.55 | 117/21 |
| extended | vast/rift | EXTENDED-HORIZON-06 | U/O | — | AI Unity | — | 0 | 765.05 | 56/19 |
| doctrine | standard/rift | BALANCE-CINDER-01 | O/U | Swarm/Balanced | Organics | Swarm | 0 | 544.50 | 38/17 |
| doctrine | standard/rift | BALANCE-CINDER-01 | O/U | Balanced/Swarm | Organics | Balanced | 0 | 752.75 | 33/17 |
| doctrine | standard/rift | BALANCE-CINDER-01 | U/O | Swarm/Balanced | Organics | Balanced | 1 | 222.70 | 18/18 |
| doctrine | standard/rift | BALANCE-CINDER-01 | U/O | Balanced/Swarm | AI Unity | Balanced | 0 | 596.00 | 32/20 |
| doctrine | standard/rift | BALANCE-VAULT-02 | O/U | Swarm/Balanced | Organics | Swarm | 0 | 693.50 | 69/18 |
| doctrine | standard/rift | BALANCE-VAULT-02 | O/U | Balanced/Swarm | Organics | Balanced | 0 | 415.75 | 20/17 |
| doctrine | standard/rift | BALANCE-VAULT-02 | U/O | Swarm/Balanced | AI Unity | Swarm | 0 | 708.00 | 81/17 |
| doctrine | standard/rift | BALANCE-VAULT-02 | U/O | Balanced/Swarm | Organics | Swarm | 1 | 856.25 | 16/95 |
| doctrine | standard/rift | BALANCE-DUSK-03 | O/U | Swarm/Balanced | Organics | Swarm | 0 | 734.75 | 72/15 |
| doctrine | standard/rift | BALANCE-DUSK-03 | O/U | Balanced/Swarm | Organics | Balanced | 0 | 784.80 | 50/28 |
| doctrine | standard/rift | BALANCE-DUSK-03 | U/O | Swarm/Balanced | Organics | Balanced | 1 | 246.55 | 22/18 |
| doctrine | standard/rift | BALANCE-DUSK-03 | U/O | Balanced/Swarm | Organics | Swarm | 1 | 673.10 | 16/77 |
| doctrine | standard/rift | BALANCE-CINDER-01 | O/U | Ironclad/Balanced | Organics | Ironclad | 0 | 472.20 | 24/15 |
| doctrine | standard/rift | BALANCE-CINDER-01 | O/U | Balanced/Ironclad | Organics | Balanced | 0 | 414.70 | 23/16 |
| doctrine | standard/rift | BALANCE-CINDER-01 | U/O | Ironclad/Balanced | Organics | Balanced | 1 | 736.25 | 15/46 |
| doctrine | standard/rift | BALANCE-CINDER-01 | U/O | Balanced/Ironclad | Organics | Ironclad | 1 | 429.90 | 15/25 |
| doctrine | standard/rift | BALANCE-VAULT-02 | O/U | Ironclad/Balanced | Organics | Ironclad | 0 | 435.85 | 19/17 |
| doctrine | standard/rift | BALANCE-VAULT-02 | O/U | Balanced/Ironclad | AI Unity | Ironclad | 1 | 435.70 | 21/19 |
| doctrine | standard/rift | BALANCE-VAULT-02 | U/O | Ironclad/Balanced | AI Unity | Ironclad | 0 | 929.85 | 17/23 |
| doctrine | standard/rift | BALANCE-VAULT-02 | U/O | Balanced/Ironclad | Organics | Ironclad | 1 | 398.50 | 17/18 |
| doctrine | standard/rift | BALANCE-DUSK-03 | O/U | Ironclad/Balanced | Organics | Ironclad | 0 | 505.05 | 18/18 |
| doctrine | standard/rift | BALANCE-DUSK-03 | O/U | Balanced/Ironclad | Organics | Balanced | 0 | 592.20 | 24/16 |
| doctrine | standard/rift | BALANCE-DUSK-03 | U/O | Ironclad/Balanced | Organics | Balanced | 1 | 781.55 | 18/51 |
| doctrine | standard/rift | BALANCE-DUSK-03 | U/O | Balanced/Ironclad | Organics | Ironclad | 1 | 718.10 | 19/18 |
| doctrine | standard/rift | BALANCE-CINDER-01 | O/U | Prospector/Balanced | Organics | Prospector | 0 | 479.50 | 26/15 |
| doctrine | standard/rift | BALANCE-CINDER-01 | O/U | Balanced/Prospector | Organics | Balanced | 0 | 387.35 | 28/15 |
| doctrine | standard/rift | BALANCE-CINDER-01 | U/O | Prospector/Balanced | AI Unity | Prospector | 0 | 349.20 | 15/21 |
| doctrine | standard/rift | BALANCE-CINDER-01 | U/O | Balanced/Prospector | Organics | Prospector | 1 | 419.90 | 15/45 |
| doctrine | standard/rift | BALANCE-VAULT-02 | O/U | Prospector/Balanced | draw | — | — | 2400.00 | 180/17 |
| doctrine | standard/rift | BALANCE-VAULT-02 | O/U | Balanced/Prospector | Organics | Balanced | 0 | 456.40 | 36/15 |
| doctrine | standard/rift | BALANCE-VAULT-02 | U/O | Prospector/Balanced | Organics | Balanced | 1 | 441.15 | 14/22 |
| doctrine | standard/rift | BALANCE-VAULT-02 | U/O | Balanced/Prospector | Organics | Prospector | 1 | 728.65 | 17/26 |
| doctrine | standard/rift | BALANCE-DUSK-03 | O/U | Prospector/Balanced | Organics | Prospector | 0 | 915.80 | 35/19 |
| doctrine | standard/rift | BALANCE-DUSK-03 | O/U | Balanced/Prospector | Organics | Balanced | 0 | 261.40 | 21/15 |
| doctrine | standard/rift | BALANCE-DUSK-03 | U/O | Prospector/Balanced | Organics | Balanced | 1 | 293.20 | 15/26 |
| doctrine | standard/rift | BALANCE-DUSK-03 | U/O | Balanced/Prospector | Organics | Prospector | 1 | 713.40 | 19/21 |
| doctrine | standard/rift | BALANCE-CINDER-01 | O/U | Siegebreaker/Balanced | Organics | Siegebreaker | 0 | 413.70 | 32/16 |
| doctrine | standard/rift | BALANCE-CINDER-01 | O/U | Balanced/Siegebreaker | AI Unity | Siegebreaker | 1 | 556.20 | 18/24 |
| doctrine | standard/rift | BALANCE-CINDER-01 | U/O | Siegebreaker/Balanced | Organics | Balanced | 1 | 735.40 | 22/62 |
| doctrine | standard/rift | BALANCE-CINDER-01 | U/O | Balanced/Siegebreaker | Organics | Siegebreaker | 1 | 470.25 | 15/28 |
| doctrine | standard/rift | BALANCE-VAULT-02 | O/U | Siegebreaker/Balanced | Organics | Siegebreaker | 0 | 665.90 | 49/15 |
| doctrine | standard/rift | BALANCE-VAULT-02 | O/U | Balanced/Siegebreaker | Organics | Balanced | 0 | 773.85 | 40/16 |
| doctrine | standard/rift | BALANCE-VAULT-02 | U/O | Siegebreaker/Balanced | AI Unity | Siegebreaker | 0 | 957.30 | 78/26 |
| doctrine | standard/rift | BALANCE-VAULT-02 | U/O | Balanced/Siegebreaker | Organics | Siegebreaker | 1 | 659.00 | 17/43 |
| doctrine | standard/rift | BALANCE-DUSK-03 | O/U | Siegebreaker/Balanced | Organics | Siegebreaker | 0 | 479.10 | 33/18 |
| doctrine | standard/rift | BALANCE-DUSK-03 | O/U | Balanced/Siegebreaker | AI Unity | Siegebreaker | 1 | 352.05 | 20/16 |
| doctrine | standard/rift | BALANCE-DUSK-03 | U/O | Siegebreaker/Balanced | AI Unity | Siegebreaker | 0 | 754.75 | 43/17 |
| doctrine | standard/rift | BALANCE-DUSK-03 | U/O | Balanced/Siegebreaker | Organics | Siegebreaker | 1 | 324.95 | 18/20 |

## Reproduce

Run from `fun/ashline`. Each command writes standalone JSON with the engine hash, parameters, definition snapshots, every match and a summary. `--profile rift|basin|highlands` splits a batch into independent processes; `--difficulty easy|normal|hard` (default `hard`) and `--doctrines a,b` select the commanders.

```sh
node tests/race-balance.mjs --suite calibration --size standard --output /tmp/ashline-calibration.json
node tests/race-balance.mjs --suite holdout --size standard --output /tmp/ashline-holdout.json
node tests/race-balance.mjs --suite extended --size frontier --profile rift --output /tmp/ashline-frontier.json
node tests/race-balance.mjs --suite extended --size vast --profile rift --output /tmp/ashline-vast.json
node tests/race-balance.mjs --suite calibration --size standard --profile rift --doctrines swarm,balanced --output /tmp/ashline-swarm.json
```

The [complete recorded results](balance-results.json) hold every match with configuration snapshots, composition, research and economy samples.

## Limits

This is a small deterministic sample of one commander policy at one difficulty. Both sides use the same code, so the trials expose unit and economy asymmetries between the races under that policy; they do not cover human strategies, Cadet or Commander tiers, scripted operations, or doctrine pairings other than each doctrine against Balanced. Walls, crater cover, research prerequisites, brownouts, abilities and race-specific save continuation have separate functional tests. Any change to combat statistics, prices, the commander, maps or power should rerun both orientations on fresh seeds as well as this set.
