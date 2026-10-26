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
tracking only on pages containing native video/audio or a SoundCloud player.
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

Publish the initial container version in Google Tag Manager to make its loader
available. A newly created, unpublished container may return 404; this does not
prevent the site's direct GA4 delivery. Container publishing requires GTM account
access and is separate from deploying this repository.

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

When using this site's explicit tracking, disable overlapping Enhanced
Measurement for outbound clicks, downloads, scrolls and video in the GA4 web
stream. Disable form interactions and history-based page views too: the site has
no lead form, and game hashes are board state rather than new pages. GA4's normal
session/user engagement collection remains enabled. These stream settings and
key-event/custom-dimension configuration require GA account access; they cannot
be changed by the static website.

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
| `disclosure_toggle`, `ui_action` | Details panels, menu and selected puzzle HUD actions |
| `video_*`, `audio_*` | Native video/audio and SoundCloud start, pause, progress, completion, seek and errors |
| `game_start`, `game_end` | Actual starts and decided outcomes in all seven games; mode, difficulty, score and active duration where available |
| `web_vital` | CLS, LCP, INP, FCP, TTFB from locally vendored official `web-vitals`; value and rating |
| `exception` | Up to five same-origin runtime/resource errors and unhandled promise-rejection categories per page; no raw messages/stacks |

Media progress uses unique played ranges at 25/50/75%, so jumping to a chapter
does not imply watching the skipped video. Completion means reaching the end;
progress indicates how much was watched. Pause, completion, seek and error events
retain the actual watched total; disabled collection intervals are excluded.
SoundCloud uses its official Widget
API; blocked widgets cannot report listening. The SoundCloud track identifier is
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
- Localhost/file previews do not send analytics by default. Before loading the
  scripts, set `window.protocodusAnalyticsConfig = {debug: true}` to opt into a
  deliberate debug session. Debug events include GA4 `debug_mode`.
- The scripts fail independently of navigation, media playback and games.

## Verification and GA reporting

Run:

```sh
node tests/analytics-check.mjs
node tests/analytics-media-check.mjs
node tests/analytics-performance-check.mjs
node tests/game-analytics-check.mjs
node tests/site-content-check.mjs
node tests/navigation-check.mjs
node tests/background-check.mjs
node fun/shared/tests/shell-check.mjs
```

`node tests/analytics-browser-check.mjs` additionally verifies real page loading,
the shared loader on every public page, Web Vitals and native video playback
with Playwright and Chromium installed.
Set `CHROMIUM_PATH` if Chromium is not at `/usr/bin/chromium`. All third-party
requests in that test are stubbed, so QA does not send events to Google.

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

Recommended GA4 event-scoped custom dimensions: `page_type`, `product_id`,
`game_name`, `game_mode`, `difficulty`, `section_id`, `action`, `result`,
`media_provider`, `media_id`, `metric_name`, `metric_rating`. Numeric metrics:
`duration_seconds`, `hints_used`, `watched_seconds`, `metric_value` (split by
`metric_name`; CLS has no unit, other vitals are milliseconds). GA4's standard
ecommerce reports use the supplied `items` arrays. Consider `shop_click` and
`contact_click` as key events only if those intent signals match business goals.
