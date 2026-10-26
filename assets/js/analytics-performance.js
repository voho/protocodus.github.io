/* Core Web Vitals through the official local web-vitals module. */
(() => {
  'use strict';
  try {
    const analytics = window.protocodusAnalytics;
    if (!analytics) return;
    const scriptUrl = document.currentScript?.src;
    if (!scriptUrl) return;
    const moduleUrl = new URL('../vendor/web-vitals/web-vitals.js', scriptUrl);
    let loading = false, registered = false;
    function start() {
      if (!analytics.isEnabled() || loading || registered) return;
      loading = true;
      import(moduleUrl.href).then(vitals => {
        loading = false;
        if (!analytics.isEnabled()) return;
        registered = true;
        const report = metric => {
          if (!analytics.isEnabled()) return;
          analytics.track('web_vital', {
            metric_name: metric.name,
            metric_value: metric.value,
            metric_rating: metric.rating,
          });
        };
        // Defaults report settled measurements, rather than every intermediate
        // value. Unsupported browser metrics simply do not produce an event.
        for (const method of ['onCLS', 'onLCP', 'onINP', 'onFCP', 'onTTFB']) {
          try { vitals[method]?.(report); } catch { /* Other metrics can continue. */ }
        }
      }).catch(() => { loading = false; /* Retry only after another enable event. */ });
    }
    window.addEventListener('protocodus:analytics-enabled', start);
    start();
  } catch { /* Performance reporting is optional. */ }
})();
