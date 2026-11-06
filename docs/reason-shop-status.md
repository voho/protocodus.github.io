# Reason release audit — 6 November 2026

Checked the signed-in developer version history and Shop page manager against
the public [Protocodus catalog](https://www.reasonstudios.com/shop/browse/?developer=Protocodus)
and each listing. A developer-portal “released” row alone does not establish
that a Shop page is public.

## Public releases

All seven public products have their latest accepted device version in the Shop.

| Product | Latest accepted device | Public Shop version |
| --- | --- | --- |
| [Acustra](https://www.reasonstudios.com/shop/rack-extension/acustra-acoustic-guitar/) | 1.9.0d2 | 1.9.0 |
| [Binaurel](https://www.reasonstudios.com/shop/rack-extension/binaurel-advanced-panner/) | 0.1.0d26 | 0.1.0 |
| [Ceres](https://www.reasonstudios.com/shop/rack-extension/ceres-circuit-modelled-synth/) | 1.1.4f1 | 1.1.4 |
| [Lamer](https://www.reasonstudios.com/shop/rack-extension/lamer-degrader/) | 1.0.0f10 | 1.0.0 |
| [Maremba](https://www.reasonstudios.com/shop/rack-extension/maremba/) | 1.5.7f5 | 1.5.7 |
| [Press78](https://www.reasonstudios.com/shop/rack-extension/press78-fm-synth/) | 1.0.4f1 | 1.0.4 |
| [YouKnow](https://www.reasonstudios.com/shop/rack-extension/youknow-circuit-modelled-synth/) | 1.3.5f5 | 1.3.5 |

Ceres and Press78 pages were published on 5 November. Their Shop “Released”
fields still show 2 November, the original product date. The snapshot stores
these dates separately. Their website versions, schema, panel images, covers
and release notes now follow the current listings.

Acustra 1.9.19d1 is still testing; it does not supersede the public 1.9.0 release.

## Not yet public

| Product | Device status | Shop page | Next step |
| --- | --- | --- | --- |
| Acukoto | 0.18.0d1 accepted; 0.18.0 release row exists | 0.18.0 waiting for approval | Await Reason's page review; publish on approval is enabled |
| Aculele | 0.4.39d1 accepted; 0.4.39 release row exists | Submission hold requested: a demo must be added first | Draft 34606 is preserved with automatic publication off; queued page 34535 still needs removal |
| Aculyre | 0.7.9d1 accepted; latest release row is 0.7.4 | Draft's Article selector only offers 0.7.4 | Reason must make the accepted 0.7.9 article available; then select it and submit the draft |
| Respira | 0.1.16d1 submitted for device acceptance | No Shop page yet | Await device acceptance before Shop submission |

Aculyre's draft copy describes 0.7.9. It was left unsubmitted to avoid publishing
that copy against 0.7.4. Aculele's existing copy, artwork and price were retained
when submitting its page. All four checked public URLs returned HTTP 404 and
none appeared in the public developer catalog.

The owner subsequently instructed us to hold Aculele until a demo is added.
Do not submit or resubmit Aculele before that requirement is met. Reopening the
queued page created draft 34606; it did not withdraw page 34535. The draft was
saved with publish on approval off. The original remains queued with automatic
publication enabled until its removal is confirmed.

Keyra 0.4.14d1, Convretor 0.1.0d9 and Electry 1.2.8d1 are testing, with no
accepted device versions. Legacy REPAN and YouKnow106 entries are also testing.
Remix has no accepted version in Manage Products; its latest observed build
failed. These are not releases. Electry and Clareq remain excluded from the site.

## Website checks

[`STORE_SNAPSHOT.json`](../product/STORE_SNAPSHOT.json) records public versions,
accepted device versions, current artwork hashes and pending publication stages.
Product provenance and visible availability must agree with that snapshot.
Respira's older panel previews remain labelled 0.1.14d1 while its submission
status identifies 0.1.16d1.

The existing weekly/manual public catalog check watches the developer listing,
the four pending page URLs, published versions and artwork. It reports new
publications or drift for review; it does not infer acceptance from a build or
publish a product automatically.
