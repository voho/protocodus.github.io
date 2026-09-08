# Race balance trials

Final engine SHA-256: `faa214c6c62886503363f5e384fbae5d2a0d26b5891fd58ed8bf504b1f149963`. Trials recorded on 2026-09-08.

The final candidate completed **34 of 34 matches by destroying an opposing nexus**, with no time-limit draws: **Organics 16 wins, AI Unity 18 wins** (47.1%/52.9%). On Standard maps, Organics won **13/30** and AI Unity won **17/30** (56.7% Unity). The independent held-out set was 6–6 in Organics–Unity order. Larger-map checks were 3–1. These results describe this fixed AI policy and seed sample; they do not establish universal race balance for human play.

## Method

`tests/race-balance.mjs` creates complete, untouched games with `difficulty: 'hard'`, `aiTeams: [0,1]`, and independent AI state and fog knowledge for each side. Both use full production pace, the same decision policy, normal initial credits, actual research and power systems, ordinary mining, and live combat. There are no forced attacks, free reinforcements, healed nexuses or victory scores in these trials.

Each seed/profile is played twice, swapping Organics and AI Unity between side 0 (lower-left) and side 1 (upper-right). Terrain and mineral reserves are point-symmetric. Side swaps remain necessary because placement choices, shared random-number ordering and movement tie breaks can still produce different battles. A win requires one live nexus and one actually destroyed nexus; a still-playing match at the limit is a draw.

All final runs used a **200-unit cap per team**, calls to `updateGame` every 0.25 simulated seconds (internally stepped at no more than 0.05 seconds), and a 2,400-second simulated limit. Army counts, nonnegative credits, peak composition, final composition, kills, research, grid status and economy samples were recorded. Simulation timings are host timings, not rendering benchmarks.

Calibration used three seeds × three profiles × both race orientations on Standard 144×112 maps (18 games). Combat statistics and prices were then frozen before the held-out batch: two fresh seeds × three profiles × both orientations (12 games). One additional fresh seed was run in both orientations on default Frontier 192×144 and Vast 224×168, using Rift (four games). All 34 final runs share the engine hash above.

## Results

| Batch | Matches | Organics wins | Unity wins | Draws | Unity win share |
| --- | ---: | ---: | ---: | ---: | ---: |
| Standard calibration | 18 | 7 | 11 | 0 | 61.1% |
| Standard held-out | 12 | 6 | 6 | 0 | 50.0% |
| All Standard | 30 | 13 | 17 | 0 | 56.7% |
| Frontier extension | 2 | 2 | 0 | 0 | 0.0% |
| Vast extension | 2 | 1 | 1 | 0 | 50.0% |
| All final runs | 34 | 16 | 18 | 0 | 52.9% |

| Standard profile | Matches | Organics wins | Unity wins | Draws | Unity win share |
| --- | ---: | ---: | ---: | ---: | ---: |
| Rift | 10 | 6 | 4 | 0 | 40.0% |
| Basin | 10 | 4 | 6 | 0 | 60.0% |
| Highlands | 10 | 3 | 7 | 0 | 70.0% |

Across all final runs, side 0 won 15 and side 1 won 19. The calibration Rift games all favored side 1, regardless of race; its three mirrored race pairs therefore split 3–3. The aggregate result must not be read as proof that every seed, profile, or starting side is equally favorable.

Standard games finished in 309.35–911.40 simulated seconds (median 553.45). Frontier/Vast checks finished in 476.80–1036.05 seconds. The largest observed army was 54 units on one side. These normal-economy matches do **not** exercise the 200-unit limit; `tests/capacity-check.mjs` and the browser population check separately exercise 200+200 entities, queues, collisions, destinations and saves.

## Army composition

The table shows the mean of each role’s highest living count per match across the final 34 games. Peak counts for different roles need not occur at the same time; they must not be summed into a simultaneous army. Raw JSON retains each match’s exact race-specific type counts, final role composition and minute-by-minute economy/research samples.

| Role | Organics mean peak | Unity mean peak |
| --- | ---: | ---: |
| rifle | 15.00 | 15.00 |
| rocket | 8.00 | 8.00 |
| scout | 1.00 | 1.00 |
| tank | 10.00 | 9.00 |
| artillery | 3.53 | 3.12 |
| harvester | 3.00 | 3.00 |
| engineer | 0.85 | 0.50 |
| striker | 0.00 | 0.00 |

## Candidate adjustments

Early calibration exposed a Unity advantage: the first 18 complete trials split 3–15; infantry firepower/durability adjustment alone split 4–14. Faster Organic infantry also reached fights ahead of its heavy vehicles. A shared AI rally-and-wave travel policy improved cohesion for both races and changed that calibration to 5–13. Unity’s remaining combat-unit benefits were priced explicitly; its carriers and support economy retained their previous costs. The final 18-game calibration split 7–11. These development batches are **not** pooled with the final held-out results.

Unity retains durable, slower robotic infantry and lighter, faster combat machines. Its final combat-unit prices are shown against Organics; the complete raw report also records health, damage, firing interval, speed, build costs and production times.

| Combat role | Organics credits | Unity credits |
| --- | ---: | ---: |
| rifle | 80 | 90 |
| rocket | 160 | 175 |
| scout | 140 | 150 |
| tank | 300 | 325 |
| artillery | 380 | 410 |
| striker | 260 | 280 |

The final empty-field carrier retry optimization was checked against the preceding premium calibration: all 18 recorded simulation outcomes, finish times, army counts, composition, credits, research and samples reproduced exactly. Only host execution time changed. No combat or economy tuning was made after observing the held-out seeds.

## Exact final matches

Times are simulated seconds. O=Organics, U=AI Unity. A pairing is side 0/side 1; peaks use that same side order. Every listed result is a destroyed opposing nexus.

| Batch | Size/profile | Seed | Pair | Winner | Side | Seconds | Peak units |
| --- | --- | --- | --- | --- | ---: | ---: | --- |
| calibration | standard/rift | BALANCE-CINDER-01 | O/U | AI Unity | 1 | 563.45 | 37/43 |
| calibration | standard/rift | BALANCE-CINDER-01 | U/O | Organics | 1 | 506.25 | 39/54 |
| calibration | standard/rift | BALANCE-VAULT-02 | O/U | AI Unity | 1 | 544.35 | 37/36 |
| calibration | standard/rift | BALANCE-VAULT-02 | U/O | Organics | 1 | 562.55 | 34/39 |
| calibration | standard/rift | BALANCE-DUSK-03 | O/U | AI Unity | 1 | 405.00 | 36/39 |
| calibration | standard/rift | BALANCE-DUSK-03 | U/O | Organics | 1 | 432.95 | 37/47 |
| calibration | standard/basin | BALANCE-CINDER-01 | O/U | Organics | 0 | 698.60 | 39/38 |
| calibration | standard/basin | BALANCE-CINDER-01 | U/O | AI Unity | 0 | 448.10 | 39/34 |
| calibration | standard/basin | BALANCE-VAULT-02 | O/U | AI Unity | 1 | 403.15 | 36/41 |
| calibration | standard/basin | BALANCE-VAULT-02 | U/O | AI Unity | 0 | 751.80 | 37/39 |
| calibration | standard/basin | BALANCE-DUSK-03 | O/U | Organics | 0 | 518.00 | 36/34 |
| calibration | standard/basin | BALANCE-DUSK-03 | U/O | AI Unity | 0 | 494.90 | 39/34 |
| calibration | standard/highlands | BALANCE-CINDER-01 | O/U | AI Unity | 1 | 543.65 | 41/40 |
| calibration | standard/highlands | BALANCE-CINDER-01 | U/O | Organics | 1 | 598.05 | 37/39 |
| calibration | standard/highlands | BALANCE-VAULT-02 | O/U | AI Unity | 1 | 451.75 | 37/40 |
| calibration | standard/highlands | BALANCE-VAULT-02 | U/O | AI Unity | 0 | 911.40 | 38/40 |
| calibration | standard/highlands | BALANCE-DUSK-03 | O/U | Organics | 0 | 689.75 | 39/38 |
| calibration | standard/highlands | BALANCE-DUSK-03 | U/O | AI Unity | 0 | 450.90 | 40/37 |
| holdout | standard/rift | HOLDOUT-EMBER-04 | O/U | Organics | 0 | 408.25 | 40/31 |
| holdout | standard/rift | HOLDOUT-EMBER-04 | U/O | Organics | 1 | 432.95 | 34/43 |
| holdout | standard/rift | HOLDOUT-OBSIDIAN-05 | O/U | Organics | 0 | 464.75 | 40/35 |
| holdout | standard/rift | HOLDOUT-OBSIDIAN-05 | U/O | AI Unity | 0 | 859.60 | 42/42 |
| holdout | standard/basin | HOLDOUT-EMBER-04 | O/U | Organics | 0 | 664.80 | 37/33 |
| holdout | standard/basin | HOLDOUT-EMBER-04 | U/O | Organics | 1 | 309.35 | 30/40 |
| holdout | standard/basin | HOLDOUT-OBSIDIAN-05 | O/U | AI Unity | 1 | 600.45 | 38/38 |
| holdout | standard/basin | HOLDOUT-OBSIDIAN-05 | U/O | AI Unity | 0 | 727.35 | 39/38 |
| holdout | standard/highlands | HOLDOUT-EMBER-04 | O/U | AI Unity | 1 | 567.30 | 36/37 |
| holdout | standard/highlands | HOLDOUT-EMBER-04 | U/O | Organics | 1 | 705.10 | 39/40 |
| holdout | standard/highlands | HOLDOUT-OBSIDIAN-05 | O/U | AI Unity | 1 | 582.95 | 39/38 |
| holdout | standard/highlands | HOLDOUT-OBSIDIAN-05 | U/O | AI Unity | 0 | 811.00 | 41/38 |
| extended | frontier/rift | EXTENDED-HORIZON-06 | O/U | Organics | 0 | 476.80 | 44/37 |
| extended | frontier/rift | EXTENDED-HORIZON-06 | U/O | Organics | 1 | 1036.05 | 37/40 |
| extended | vast/rift | EXTENDED-HORIZON-06 | O/U | AI Unity | 1 | 558.70 | 40/44 |
| extended | vast/rift | EXTENDED-HORIZON-06 | U/O | Organics | 1 | 558.30 | 38/46 |

## Reproduce

Run from `fun/ashline`. Each command writes standalone JSON with engine hash, parameter values, definition snapshots, individual matches and summary. The default profile selection includes all three profiles; `--profile rift|basin|highlands` can split the Standard batches into independent processes.

```sh
node tests/race-balance.mjs --suite calibration --size standard --output /tmp/ashline-calibration.json
node tests/race-balance.mjs --suite holdout --size standard --output /tmp/ashline-holdout.json
node tests/race-balance.mjs --suite extended --size frontier --profile rift --output /tmp/ashline-frontier.json
node tests/race-balance.mjs --suite extended --size vast --profile rift --output /tmp/ashline-vast.json
```

The [complete recorded results](balance-results.json) are included alongside this report, with configuration snapshots and economy/composition samples for every match. The commands above regenerate standalone JSON for each batch.

## Limits

This is a small deterministic sample of one shared AI policy, not an estimate across all possible human strategies. The AI does not deliberately design wall networks or seek crater cover, and it may favor some technology paths or unit mixes. Neither side produced advanced strikers in this final sample, so these matches do not establish that late-tech unit’s matchup balance. Walls, crater damage, research prerequisites, production upgrades, brownouts and race-specific save continuation have separate functional tests. The four larger-map games provide a travel-distance check, not a separate statistically broad balance result. Further changes to combat stats, AI movement, mineral flow, maps or power should rerun both orientations on new seeds as well as this regression set.
