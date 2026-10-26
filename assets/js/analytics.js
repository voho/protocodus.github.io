/* Shared GA4 delivery and a namespaced Google Tag Manager data layer.
   Keep one delivery owner: direct GA4 by default, or GTM after configuring tags. */
(() => {
  'use strict';
  if (window.protocodusAnalytics) return;

  // Pages need only this stable script URL; sibling versions are managed here.
  const version = '20261026.3';
  const scriptUrl = document.currentScript?.src || new URL('/assets/js/analytics.js', location.href).href;
  const scriptStates = {};
  const eventCounts = {};
  const config = Object.assign({
    measurementId: 'G-0TEFG3XSN5',
    tagManagerId: 'GTM-TZZVDH4B',
    transport: 'gtag',
    debug: false,
  }, window.protocodusAnalyticsConfig);
  const local = /^(localhost|127\..*|\[::1\])$/.test(location.hostname) || location.protocol === 'file:';
  let enabled = (!local || config.debug) && window.protocodusAnalyticsEnabled !== false;
  const events = new Set(('page_view view_item view_item_list select_item shop_click file_download contact_click social_click navigation_click outbound_click screenshot_open section_view scroll_depth engagement_time disclosure_toggle ui_action video_start video_progress video_pause video_complete video_seek video_error audio_start audio_progress audio_pause audio_complete audio_seek audio_error game_start game_end game_action level_start level_end web_vital exception').split(' '));
  const fields = new Set(('page_location page_referrer page_title page_type page_path product_id game_name game_mode difficulty level checkpoint result score duration_seconds hints_used action theme cta_id cta_location link_url link_domain link_id section_id method file_name file_extension percent engagement_time_msec media_provider media_id media_duration current_time chapter_seconds watched_seconds error_code metric_name metric_value metric_rating error_type error_source fatal item_list_id items').split(' '));
  const products = new Set(['youknow', 'maremba', 'acustra', 'electry', 'ceres', 'press78', 'lamer', 'podcare']);
  const games = new Set(['tyran', 'ashline', 'alpen', 'meteora', 'hedgerow', 'zipper', 'patcher']);
  const path = location.pathname.replace(/index\.html$/, '');
  const product = /^\/product\/([^/]+)\//.exec(path)?.[1];
  const game = /^\/fun\/([^/]+)\//.exec(path)?.[1];
  const context = {
    page_type: products.has(product) ? 'product' : games.has(game) ? 'game'
      : path.startsWith('/product/releases/') ? 'releases' : path.startsWith('/fun/') ? 'games' : 'studio',
    page_path: path,
    ...(products.has(product) ? { product_id: product } : {}),
    ...(games.has(game) ? { game_name: game } : {}),
  };
  const privateText = /@|%40|(?:access[_-]?token|password|authorization|bearer|email)=/i;
  function safeText(value, limit = 100) {
    return typeof value === 'string' && !privateText.test(value) ? value.replace(/[\u0000-\u001f]/g, '').slice(0, limit) : undefined;
  }
  function safeUrl(value, campaign = false) {
    if (typeof value !== 'string' || !value) return '';
    try {
      const url = new URL(value, location.href);
      if (!/^https?:$/.test(url.protocol) || privateText.test(url.pathname)) return '';
      const clean = new URL(url.origin + url.pathname);
      if (campaign) {
        for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_id', 'utm_term', 'utm_content', 'gclid', 'dclid', 'gbraid', 'wbraid']) {
          const value = safeText(url.searchParams.get(key));
          if (value) clean.searchParams.set(key, value);
        }
      }
      return clean.href;
    } catch { return ''; }
  }
  function cleanParams(params) {
    const clean = {};
    for (const [key, value] of Object.entries(params || {})) {
      if (!fields.has(key)) continue;
      if (key === 'items') {
        if (Array.isArray(value)) clean.items = value.slice(0, 20).filter(item => products.has(item?.item_id)).map(item => ({ item_id: item.item_id, item_name: item.item_id }));
      } else if (key === 'page_location' || key === 'page_referrer' || key === 'link_url') {
        clean[key] = safeUrl(value, key === 'page_location');
      } else if (typeof value === 'number' && Number.isFinite(value)) clean[key] = value;
      else if (typeof value === 'boolean') clean[key] = value;
      else {
        const text = safeText(value);
        if (text !== undefined) clean[key] = text;
      }
    }
    return clean;
  }
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  let loaded = false;
  let viewed = false;
  function isEnabled() {
    return enabled && window.protocodusAnalyticsEnabled !== false && window['ga-disable-' + config.measurementId] !== true;
  }
  function loadScript(name, src) {
    if (scriptStates[name]) return;
    scriptStates[name] = 'requested';
    try {
      const script = document.createElement('script');
      script.async = true;
      script.src = src;
      script.addEventListener('load', () => { scriptStates[name] = 'loaded'; }, { once: true });
      script.addEventListener('error', () => { scriptStates[name] = 'failed'; }, { once: true });
      document.head.appendChild(script);
    } catch { scriptStates[name] = 'failed'; }
  }
  function loadFeatures() {
    const sibling = name => {
      const url = new URL('analytics-' + name + '.js', scriptUrl);
      url.searchParams.set('v', version);
      return url.href;
    };
    loadScript('performance', sibling('performance'));
    if (document.querySelector('video, audio, iframe.soundcloud-player')) loadScript('media', sibling('media'));
  }
  function initialize() {
    if (loaded || !isEnabled()) return;
    loaded = true;
    // Set safe URLs before either Google script can send an automatic event.
    window.gtag('set', {
      page_location: safeUrl(location.href, true),
      page_referrer: document.referrer ? safeUrl(document.referrer) : '',
      page_title: safeText(document.title),
    });
    if (config.transport === 'gtag') {
      window.gtag('js', new Date());
      window.gtag('config', config.measurementId, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
      loadScript('ga4', 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(config.measurementId));
    }
    if (/^GTM-[A-Z0-9]+$/.test(config.tagManagerId)) {
      window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
      loadScript('gtm', 'https://www.googletagmanager.com/gtm.js?id=' + config.tagManagerId);
    }
    loadFeatures();
  }
  function track(name, params = {}) {
    try {
      if (!isEnabled() || !events.has(name)) return;
      initialize();
      const payload = Object.assign({}, context, cleanParams(params));
      // Nested replacement prevents a preceding product/media event leaking fields
      // into a later event when GTM's Version 1 data-layer variable is used.
      window.dataLayer.push({ event: 'protocodus.' + name, analytics: payload });
      eventCounts[name] = (eventCounts[name] || 0) + 1;
      if (config.transport === 'gtag') window.gtag('event', name, Object.assign({}, payload, {
        send_to: config.measurementId, transport_type: 'beacon', ...(config.debug ? { debug_mode: true } : {}),
      }));
    } catch { /* Analytics must never interrupt navigation, playback or a game. */ }
  }
  function pageView() {
    if (viewed || !isEnabled()) return;
    viewed = true;
    track('page_view', { page_location: location.href, page_referrer: document.referrer || '', page_title: document.title });
    if (products.has(product)) track('view_item', { items: [{ item_id: product }] });
  }
  window.protocodusAnalytics = Object.freeze({
    track, isEnabled,
    // Queued event counts and loader state are diagnostics, not receipt in GA.
    status: () => ({
      enabled: isEnabled(), transport: config.transport,
      measurementId: config.measurementId, tagManagerId: config.tagManagerId,
      version, page: { ...context }, events: { ...eventCounts }, scripts: { ...scriptStates },
    }),
    setEnabled(value) {
      enabled = value === true;
      window.protocodusAnalyticsEnabled = enabled;
      window['ga-disable-' + config.measurementId] = !enabled;
      activeSince = enabled && !document.hidden ? performance.now() : null;
      if (enabled) { try { initialize(); pageView(); } catch {} }
      window.dispatchEvent(new CustomEvent('protocodus:analytics-enabled'));
    },
  });
  try { initialize(); pageView(); } catch {}

  function sectionOf(element) { return element.closest('section[id], main[id], footer[id]')?.id || ''; }
  function ctaContext(element) {
    if (!element.dataset.analyticsCta) return {};
    return {
      cta_id: element.dataset.analyticsCta,
      // Capture the source before navigation changes section_id to its target.
      cta_location: sectionOf(element) || (element.closest('.product-card') ? 'product_card' : element.closest('.mobile-menu') ? 'mobile_menu'
        : element.closest('header') ? 'header' : element.closest('footer') ? 'footer' : 'content'),
      ...(element.dataset.analyticsAction ? { action: element.dataset.analyticsAction } : {}),
    };
  }
  function productOf(element, url) {
    const candidate = /^\/product\/([^/]+)\//.exec(url.pathname)?.[1]
      || element.closest('.product-card')?.className.match(/\bp-([\w]+)\b/)?.[1]
      || element.closest('tr[id]')?.id
      || ({ 'youknow-circuit-modelled-synth': 'youknow', maremba: 'maremba', 'acustra-acoustic-guitar': 'acustra' })[url.pathname.split('/').filter(Boolean).at(-1)];
    return products.has(candidate) ? candidate : product;
  }
  function click(event) {
    if (event.type === 'auxclick' && event.button !== 1) return;
    const link = event.target.closest?.('a[href]');
    if (!link || link.closest('[data-analytics-ignore]')) return;
    const href = link.getAttribute('href');
    const base = { section_id: sectionOf(link), link_id: link.id || '', ...ctaContext(link) };
    if (/^(mailto|tel):/i.test(href)) {
      track('contact_click', { ...base, method: href.startsWith('tel:') ? 'phone' : 'email' });
      return;
    }
    let url;
    try { url = new URL(href, location.href); } catch { return; }
    if (!/^https?:$/.test(url.protocol)) return;
    const params = { ...base, link_url: url.href, link_domain: url.hostname };
    const item = productOf(link, url);
    if (products.has(item)) params.product_id = item;
    const destinationGame = /^\/fun\/([^/]+)\//.exec(url.pathname)?.[1];
    if (games.has(destinationGame) && url.origin === location.origin) params.game_name = destinationGame;
    const file = /\.([a-z0-9]+)$/i.exec(url.pathname)?.[1]?.toLowerCase();
    let name;
    if (/(^|\.)reasonstudios\.com$/.test(url.hostname) && url.pathname.startsWith('/shop/')) name = 'shop_click';
    else if (link.classList.contains('screenshot-link')) name = 'screenshot_open';
    else if (link.hasAttribute('download') || /^(pdf|zip|dmg|pkg|exe|msi|mp3|ogg|wav|mp4|webm|clap|vst3)$/.test(file || '')) {
      name = 'file_download';
      params.file_name = url.pathname.split('/').at(-1);
      params.file_extension = file || '';
    } else if (/(^|\.)(linkedin\.com|youtube\.com|youtu\.be|soundcloud\.com|facebook\.com|instagram\.com)$/.test(url.hostname)) name = 'social_click';
    else if (url.origin !== location.origin) name = 'outbound_click';
    else name = products.has(item) && /^\/product\/[^/]+\/(?:index.html)?$/.test(url.pathname)
      && url.pathname.replace(/index\.html$/, '') !== path ? 'select_item' : 'navigation_click';
    if (name === 'select_item') { params.items = [{ item_id: item }]; params.item_list_id = 'products'; }
    // Only fixed, same-page section IDs are sent, never arbitrary URL fragments.
    if (url.origin === location.origin && url.pathname === location.pathname && url.hash) {
      const target = document.getElementById(url.hash.slice(1));
      if (target?.matches('section[id], main[id], footer[id]')) params.section_id = target.id;
    }
    track(name, params);
  }
  document.addEventListener('click', click);
  document.addEventListener('auxclick', click);
  document.addEventListener('click', event => {
    const button = event.target.closest?.('button');
    if (!button || button.disabled || button.closest('[data-analytics-ignore]')) return;
    // Game boards and tactical controls can fire constantly. Only explicit HUD
    // actions are observed here; lifecycle outcomes come from the game itself.
    const action = button.dataset.analyticsAction || button.dataset.action || (button.classList.contains('menu-toggle') ? 'menu_toggle' : '');
    if (button.hasAttribute('data-analytics-cta') || ['theme', 'sound', 'help', 'daily', 'share', 'reset', 'new', 'hint', 'menu_toggle'].includes(action)) {
      const params = { action: action || 'button_click', section_id: sectionOf(button), ...ctaContext(button) };
      const chapter = button.getAttribute('data-start');
      if (action === 'play_chapter' && button.closest('.lamer-chapters') && chapter?.trim()) {
        const seconds = Number(chapter);
        if (Number.isFinite(seconds) && seconds >= 0) params.chapter_seconds = seconds;
      }
      track('ui_action', params);
    }
  });
  document.querySelectorAll('details').forEach((details, index) => {
    let open = details.open;
    details.addEventListener('toggle', () => {
      if (open === details.open) return;
      open = details.open;
      track('disclosure_toggle', { section_id: sectionOf(details), action: open ? 'open' : 'close', link_id: details.id || 'details_' + index });
    });
  });
  if ('IntersectionObserver' in window) {
    const seen = new WeakSet();
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting || seen.has(entry.target) || !isEnabled()) return;
        seen.add(entry.target);
        const element = entry.target;
        if (element.matches('section[id], footer[id]')) track('section_view', { section_id: element.id });
        else {
          const link = element.matches('a') ? element : element.querySelector('a[href]');
          const url = new URL(link?.href || location.href, location.href);
          const item = productOf(element, url);
          if (products.has(item)) track('view_item_list', { product_id: item, item_list_id: 'products', items: [{ item_id: item }] });
          else if (link) {
            const name = /^\/fun\/([^/]+)\//.exec(url.pathname)?.[1];
            if (games.has(name)) track('section_view', { section_id: 'game_card', game_name: name });
          }
        }
        observer.unobserve(element);
      });
    }, { threshold: 0.25 });
    document.querySelectorAll('section[id], footer[id], .product-card, a.game').forEach(element => observer.observe(element));
  }
  const depths = new Set();
  function scrollDepth() {
    if (!isEnabled() || document.hidden) return;
    const height = document.documentElement.scrollHeight - window.innerHeight;
    if (height <= 0) return;
    const percent = Math.min(100, Math.round(window.scrollY / height * 100));
    [25, 50, 75, 90, 100].forEach(depth => {
      if (percent >= depth && !depths.has(depth)) { depths.add(depth); track('scroll_depth', { percent: depth }); }
    });
  }
  window.addEventListener('scroll', scrollDepth, { passive: true });

  // Sparse active-time milestones; no background timer or unload request loop.
  let activeSince = document.hidden ? null : performance.now();
  let elapsed = 0;
  const milestones = new Set();
  function engagement() {
    const now = performance.now();
    if (activeSince !== null && isEnabled()) elapsed += now - activeSince;
    activeSince = document.hidden || !isEnabled() ? null : now;
    [10, 30, 60, 180, 600].forEach(seconds => {
      if (elapsed >= seconds * 1000 && !milestones.has(seconds)) {
        milestones.add(seconds); track('engagement_time', { duration_seconds: seconds });
      }
    });
  }
  window.setInterval(engagement, 10000);
  document.addEventListener('visibilitychange', engagement);
  window.addEventListener('pagehide', () => { engagement(); activeSince = null; });
  window.addEventListener('pageshow', () => { activeSince = document.hidden ? null : performance.now(); });

  // Report categories and safe source paths, never error messages or stack data.
  let errorCount = 0;
  window.addEventListener('error', event => {
    if (errorCount >= 5 || !isEnabled()) return;
    const source = safeUrl(event.filename || event.target?.src || '');
    if (!source || new URL(source).origin !== location.origin || /analytics(?:-[\w]+)?\.js/.test(source)) return;
    errorCount++;
    track('exception', { error_type: event.error?.name || 'resource_error', error_source: source, fatal: false });
  }, true);
  window.addEventListener('unhandledrejection', event => {
    if (errorCount >= 5 || !isEnabled()) return;
    errorCount++;
    const name = event.reason?.name;
    const types = ['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'AbortError'];
    track('exception', { error_type: types.includes(name) ? name : 'unhandled_rejection', action: 'unhandled_rejection', fatal: false });
  });
})();
