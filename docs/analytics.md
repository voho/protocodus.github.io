# Website analytics

Every public HTML page loads one shared analytics entry point and the GTM noscript
fallback. The destinations are GA4 **G-0TEFG3XSN5** and Google
Tag Manager container **GTM-TZZVDH4B**.

## Shared setup and new pages

Each page needs only this stable, deferred JavaScript include:

```html
<script defer src="/assets/js/analytics.js"></script>
```

The entry point owns configuration, GA/GTM loading, page context, interactions,
diagnostics and helper versions. It loads Web Vitals tracking once, and demo
tracking only on pages containing native video/audio, a YouTube player or a SoundCloud player.
Do not include `analytics-media.js` or `analytics-performance.js` in page HTML.
Changing analytics behavior or helper versions requires editing shared files,
without changing the include on every page.

The small `<noscript>` GTM iframe remains immediately inside each `<body>`.
It cannot be injected by JavaScript and still work when JavaScript is disabled.
The coverage check verifies its container ID matches the shared configuration.
New static pages still need the one include and this fallback; the test discovers
all public HTML files and fails if any page omits them. Both Cloudflare's static
hosting and GitHub Pages serve the same HTML, without a template/build dependency.

## Delivery and duplicate prevention

`assets/js/analytics.js` owns direct GA4 delivery. It loads gtag.js once, disables
the automatic initial page view, and sends one explicit `page_view` with safe URL
and page context. GA4 supplies its normal user/session, acquisition, browser,
device and approximate location reporting. No separate identifiers are invented.

The same events are available in GTM as `protocodus.<event_name>`, with parameters
in the nested `analytics` object. The new container may remain empty: direct GA4
tracking already sends the events. GTM is available for additional tags. **Do not
add another GA4 configuration or forward these events to the same GA4 property
while direct delivery is enabled.** That would double-count events.

On 5 November 2026, the live GTM container was verified as published and empty
(resource version 2, no tags). Its loader returns HTTP 200. GA4 property
544343507, web stream 15207658854, uses the measurement ID above and reports
recent traffic. Keep GA4: it is the reporting destination, while GTM is a tag
manager. Only one of direct GA4 or GTM should deliver the same events.

To move ownership to GTM later:

1. Set `transport: 'gtm'` in the defaults at the top of `analytics.js` (or set
   `window.protocodusAnalyticsConfig` before the deferred script executes).
2. Configure a Google tag for `G-0TEFG3XSN5`, with automatic page views disabled.
3. Create a Custom Event trigger matching `^protocodus\.` with regex matching on.
   Read the `analytics` object with a **Version 1** Data Layer Variable so each
   event replaces prior parameters. Create the individual parameter variables
   from this object, including the `items` array for ecommerce events.
4. Send a GA4 Event with the `protocodus.` prefix removed from its name and the
   corresponding analytics parameters. Publish the container and verify in
   Preview/DebugView before switching production ownership.

On 5 November 2026, Enhanced Measurement was switched off in the GA4 web stream
and the saved state was verified after reloading. This prevents overlapping
outbound clicks, downloads, scroll, video, form interactions and history-based
page views. The site sends explicit events; game hashes are board state rather
than new pages. GA4's normal session/user engagement collection remains enabled.
Google Signals and user-provided-data collection were verified as not enabled
in the property. Account settings are separate from this repository.

## Event coverage

| Events | What they measure |
| --- | --- |
| `page_view` | Each loaded page, with `page_type`, `page_path`, product/game context and sanitized campaign URL |
| `view_item`, `view_item_list`, `select_item` | Product detail views, visible product cards, and product selections; standard GA4 `items` arrays |
| `shop_click` | Reason Shop purchase intent, including product and source section |
| `contact_click` | Email/phone contact intent, without addresses, numbers or subjects |
| `file_download`, `screenshot_open` | Manual/media download clicks and full-size product images |
| `navigation_click`, `outbound_click`, `social_click` | Internal/section navigation and external/social destinations; includes middle clicks |
| `section_view`, `scroll_depth` | Once-per-page section/card visibility and 25/50/75/90/100% scroll milestones |
| `engagement_time` | 10/30/60/180/600 seconds of visible-page time; background tabs excluded |
| `disclosure_toggle`, `ui_action` | Details panels, menu, game settings/hangar/codex controls, and selected puzzle HUD actions |
| `video_*`, `audio_*` | Native video/audio, YouTube and SoundCloud start, pause, progress, completion, seek and errors |
| `game_start`, `game_end` | Actual starts and decided outcomes in all seven games; mode, difficulty, score and active duration where available |
| `web_vital` | CLS, LCP, INP, FCP, TTFB from locally vendored official `web-vitals`; value and rating |
| `exception` | Up to five same-origin runtime/resource errors and unhandled promise-rejection categories per page; no raw messages/stacks |

Media progress uses unique played ranges at 25/50/75%, so jumping to a chapter
does not imply watching the skipped video. Completion means reaching the end;
progress indicates how much was watched. Pause, completion, seek and error events
retain the actual watched total; disabled collection intervals are excluded.
YouTube uses its official IFrame Player API and privacy-enhanced embeds with
stable authored media IDs. SoundCloud uses its official Widget API and only
playlist embeds; blocked widgets cannot report listening. The SoundCloud track identifier is
only its numeric playlist index, never its title or creator metadata.

Game starts come from the game state, rather than a Play-link click. Pausing does
not start another attempt. Zipper/Patcher start at the first move and record
difficulty, daily/puzzle mode, active solve time and hints used. Tyran reports each
sector attempt, Meteora each mission attempt, Ashline each operation/skirmish,
and Hedgerow each mission/checkpoint attempt. Ashline identifies campaign,
training, relay, survival and skirmish, with authored mission, difficulty and
displayed end score. Hedgerow includes normalized difficulty, fixed level,
checkpoint and retry action. Alpen is endless: it reports drop-ins and restarts
with the authored chapter, without inventing a win or loss.

The site cannot observe purchases completed on Reason Studios, download
completion, or visitors who block analytics. `shop_click` is **not** a `purchase`,
and contact clicks are **not** confirmed leads. Configure shop-side reporting
separately if completed sales are needed.

## Product calls to action

Important existing product links and buttons carry fixed `data-analytics-cta`
and `data-analytics-action` attributes. The shared collector adds `cta_id`,
`cta_location` and `action` to their existing semantic event, alongside
`product_id`. It does not emit a second generic click event. This distinguishes
the hero Shop button, the release-section Shop link, manuals, full-size panels,
demo links, release notes, source/native guides and support email links.

The source `cta_location` is captured before a navigation event's `section_id`
changes to its destination. For example, the hero Listen link has source `top`
and destination `listen`. Nested icons and middle clicks retain the same CTA
identity; normal keyboard activation works through the browser's click event.

Lamer chapter buttons emit one `ui_action` with `action: 'play_chapter'` and
`chapter_seconds`, even if playback is still loading. The later media lifecycle
events report actual playback/seeking. Disabled or ignored controls emit no CTA
event. Visible text, email addresses, mail subjects and input values are never
used to name CTAs.

For a new CTA, add these attributes to its existing link or button, without an
inline tracking handler:

```html
<a href="https://www.reasonstudios.com/shop/rack-extension/maremba/"
   data-analytics-cta="hero_shop" data-analytics-action="open_shop">Get Maremba</a>
```

Keep CTA IDs unique within a page and reuse action names for equivalent intent.
`node tests/product-cta-check.mjs` verifies authored CTA coverage and event
routing/privacy without contacting Google.

Reason Shop links also carry `utm_source=protocodus.cz`, `utm_medium=website`,
`utm_campaign=rack_extensions` and the fixed CTA ID as `utm_content`. Internal
links never carry UTMs, so they do not overwrite acquisition. RILL artifact
URLs remain unchanged; the collector records their product and platform CTA.

## Data boundaries and controls

- No input/form values, email addresses, game seeds, saves, raw exception text,
  or arbitrary event parameters are sent by these scripts.
- Page URLs retain only UTM campaign parameters and Google click IDs. Other
  query parameters and all fragments are stripped. Referrer and link URLs omit
  all query parameters and fragments. Campaign values containing an email
  address are discarded; campaign names should still use non-personal labels.
- Google Signals and advertising personalization signals are disabled by
  default. The scripts do not change an existing consent policy or imply consent.
- `window.protocodusAnalyticsEnabled = false` before startup prevents the loaders
  and events. An existing consent controller can call
  `window.protocodusAnalytics.setEnabled(true/false)` when consent changes.
  Disabling also sets Google's `ga-disable-G-0TEFG3XSN5` flag. Any future GTM tags
  must independently honor the site's consent requirements.
- Only `protocodus.cz` and `www.protocodus.cz` send production analytics.
  Localhost, file previews and Cloudflare branch/commit previews stay disabled,
  including after a consent controller calls `setEnabled(true)`. Before loading the
  scripts, set `window.protocodusAnalyticsConfig = {debug: true}` to opt into a
  deliberate debug session. Debug events include GA4 `debug_mode`.
- The scripts fail independently of navigation, media playback and games.

## Verification and GA reporting

Run:

```sh
node tests/analytics-check.mjs
node tests/analytics-media-check.mjs
node tests/analytics-performance-check.mjs
node tests/product-cta-check.mjs
node tests/game-analytics-check.mjs
node tests/site-content-check.mjs
node tests/navigation-check.mjs
node tests/background-check.mjs
node fun/shared/tests/shell-check.mjs
```

`npm ci && npx playwright install chromium && npm test` runs the complete suite.
The analytics browser check verifies the shared loader on every public page,
Web Vitals and native video playback. The responsive browser check verifies
product images, mobile layout, keyboard menus, media size, RILL navigation and
all five download CTAs. Playwright uses its bundled Chromium by default;
`CHROMIUM_PATH` is an optional override. Third-party requests are stubbed, so QA
does not send events to Google. CI retains responsive screenshots and reports.

For a visitor-side diagnosis, open the browser console and run:

```js
window.protocodusAnalytics.status()
```

This returns the enabled state, destination IDs, shared version, page context,
counts of events queued on this page and each loader's `requested`, `loaded` or
`failed` state. A page without demos should have no `media` loader. These states
help distinguish disabled collection, missing scripts and event generation;
they do **not** prove that Google's servers accepted an event. Use GA4 Realtime
or DebugView for that last check.

After deployment, use GTM Preview for the container and GA4 Realtime/DebugView for
the measurement ID. Check a product view, shop click, guide download, video play
and seek, SoundCloud play, and a game start/outcome. `dataLayer` should contain
one namespaced event and one direct GA command per explicit event. Do not expect
INP without a user interaction or a final LCP/CLS until a visibility transition.

Registered in GA4 on 5 November 2026: event-scoped dimensions `page_type`,
`product_id`, `section_id`, `action`, `cta_id`, `cta_location`, `media_provider`
and `media_id`. Optional additional dimensions for game/performance reporting:
`game_name`, `game_mode`, `difficulty`, `result`, `metric_name`, `metric_rating`.
Optional numeric metrics:
`duration_seconds`, `hints_used`, `watched_seconds`, `metric_value` (split by
`metric_name`; CLS has no unit, other vitals are milliseconds). GA4's standard
ecommerce reports use the supplied `items` arrays. Consider `shop_click` and
`contact_click` as key events only if those intent signals match business goals.

## Search Console and indexing

`robots.txt`, `sitemap.xml`, and `llms.txt` are published at the site root for Google Search
Console, search crawlers, and AI answer engines (GEO). Every public HTML page declares one canonical URL,
matching Open Graph (`og:site_name`, `og:locale`, `og:title`, `og:description`, `og:image`) and Twitter card metadata, and validated JSON-LD structured data across all 23 public pages:
the homepage (`Organization` with registered entity/Prague address/ARES/Reason Shop identity and `WebSite`),
all 15 product pages (`SoftwareApplication` and `BreadcrumbList`), the games hub (`CollectionPage` with `ItemList` and `BreadcrumbList`),
and all six browser game pages (`VideoGame` and `BreadcrumbList`). Released Reason Shop products include `InStock` offers and `sameAs` store links;
unpublished products omit `datePublished` and `InStock` offers while documenting their verified device version;
RILL describes its free, MIT-licensed alpha. `node tests/site-content-check.mjs` verifies that
`sitemap.xml` and `llms.txt` stay in sync with the published site.

The domain property `sc-domain:protocodus.cz` was verified in Search Console on
5 November 2026, with the existing DNS TXT verification record. The canonical
`https://protocodus.cz/sitemap.xml` was submitted and returned **Success** on the
same date. The 27 discovered pages at submission reflect the then-deployed
site; the updated sitemap contains 23 public pages after removing Clareq, Electry, and the releases pages.
No invented verification token or duplicate HTML verification tag is needed.

The verified `protocodus.cz` domain property was also linked to the matching
GA4 web stream on 5 November 2026. The Analytics integration returned
**Link created**. Search data becomes available through that integration
subject to Google's normal reporting delay.
