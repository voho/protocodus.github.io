const $ = selector => document.querySelector(selector);
const glyph = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const closeGlyph = glyph('<path d="m6 6 12 12M6 18 18 6"/>');
const menuGlyph = glyph('<path d="M4 6h16M4 12h16M4 18h16"/>');

/** Keep secondary controls available without reserving space around the map. */
export function mountCompactPlay({ onMenu, onNews, onCompany, onGoals, onView, getView, onCancelGesture = () => {}, onMinimapOpen = () => {} }) {
  const app = $('#app'), sidebar = $('.sidebar'), mobileToggle = $('.mobile-panel-toggle');
  const topbar = $('.topbar'), canvas = $('#world'), minimap = $('.minimap-wrap');
  app.classList.add('compact-play');
  sidebar.id ||= 'management-panel';
  sidebar.classList.remove('mobile-open');

  const drawerHeading = document.createElement('div');
  drawerHeading.className = 'management-drawer-heading';
  drawerHeading.innerHTML = `<span>Management</span><button id="close-management" type="button" aria-label="Close management panel" title="Close management panel (Esc)">${closeGlyph}</button>`;
  sidebar.prepend(drawerHeading);

  // Reuse the mobile control so its existing gesture cancellation stays intact.
  topbar.insertBefore(mobileToggle, $('.main-nav'));
  mobileToggle.setAttribute('aria-controls', sidebar.id);
  mobileToggle.addEventListener('click', syncManagement);

  const menuWrap = document.createElement('div');
  menuWrap.className = 'compact-menu-wrap';
  menuWrap.innerHTML = `<button id="game-menu-button" type="button" class="icon-button" title="Game menu" aria-label="Game menu" aria-expanded="false" aria-controls="game-menu">${menuGlyph}</button><section id="game-menu" aria-label="Game menu" hidden><div class="compact-menu-heading"><strong>Transport</strong><span id="compact-menu-weather"></span></div><div class="compact-menu-actions"></div><div class="compact-menu-status"></div></section>`;
  topbar.append(menuWrap);
  const menuButton = $('#game-menu-button'), menu = $('#game-menu');
  const actions = menu.querySelector('.compact-menu-actions');
  const moveAction = (selector, label) => {
    const button = $(selector);
    if (!button) return;
    button.classList.add('compact-menu-action');
    // Preserve existing SVG icons and handlers. Dynamic audio icons use ::after.
    if (label) {
      const art = button.querySelector('svg')?.outerHTML || glyph('<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>');
      button.innerHTML = `${art}<span>${label}</span>`;
    }
    actions.append(button);
    button.addEventListener('click', () => closeMenu());
  };
  const addAction = (id, label, art, callback) => {
    const button = document.createElement('button');
    button.type = 'button'; button.id = id; button.className = 'compact-menu-action';
    button.innerHTML = `${art}<span>${label}</span>`;
    button.addEventListener('click', () => { closeMenu(); callback(); });
    actions.append(button);
    return button;
  };
  addAction('main-menu-button', 'Main menu', menuGlyph, () => { closeManagement(); onMenu?.(); });
  moveAction('#save-button', 'Save / load');
  moveAction('#world-button', 'New world');
  moveAction('.main-nav [data-open-chains]', 'Production chains');
  if (onNews) addAction('news-button', 'News', glyph('<path d="M4 5h12v13a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2ZM16 9h4v9a2 2 0 0 1-4 0M7 9h6M7 12h6M7 15h4"/>'), onNews);
  if (onCompany) addAction('company-button', 'Company', glyph('<path d="M4 20h16M7 16v-4M12 16V6M17 16v-7"/>'), onCompany);
  if (onGoals) addAction('goals-button', 'Company goals', glyph('<path d="M5 21V4m0 1h12l-2.5 4L17 13H5"/>'), onGoals);
  const overviewButton = addAction('overview-button', 'Mini map', glyph('<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2ZM9 3v16M15 5v16"/>'), () => {
    minimap.hidden = !minimap.hidden;
    overviewButton.setAttribute('aria-pressed', String(!minimap.hidden));
    if (!minimap.hidden) { onMinimapOpen(); $('#minimap').focus({ preventScroll: true }); }
  });
  overviewButton.setAttribute('aria-pressed', 'false');
  overviewButton.setAttribute('aria-controls', 'mini-map-panel');
  moveAction('#layers-button', 'Map layers');
  moveAction('#map-options-button', 'Map options');
  moveAction('#audio-button');
  moveAction('#help-button', 'How to play');
  const weather = $('#weather'), saveStatus = $('#save-status'), coordinates = $('#tile-coordinates');
  if (weather) $('#compact-menu-weather').append(weather);
  if (saveStatus) menu.querySelector('.compact-menu-status').append(saveStatus);
  if (coordinates) menu.querySelector('.compact-menu-status').append(coordinates);

  minimap.id = 'mini-map-panel'; minimap.hidden = true;
  const miniClose = document.createElement('button');
  miniClose.id = 'close-minimap'; miniClose.type = 'button';
  miniClose.setAttribute('aria-label', 'Hide mini map'); miniClose.title = 'Hide mini map';
  miniClose.innerHTML = closeGlyph;
  minimap.append(miniClose);
  miniClose.addEventListener('click', () => {
    minimap.hidden = true; overviewButton.setAttribute('aria-pressed', 'false'); canvas.focus({ preventScroll: true });
  });

  function closeMenu(restoreFocus = false) {
    const focusWasInside = menu.contains(document.activeElement);
    menu.hidden = true; menuButton.setAttribute('aria-expanded', 'false');
    if (restoreFocus || focusWasInside) menuButton.focus({ preventScroll: true });
  }
  function toggleMenu() {
    const opening = menu.hidden;
    closeMenu();
    if (!opening) return;
    onCancelGesture();
    for (const [panelId, buttonId] of [['map-options', 'map-options-button'], ['zoom-menu', 'zoom-level'], ['layers-panel', 'layers-button']]) {
      const panel = $('#' + panelId); if (panel) panel.hidden = true;
      $('#' + buttonId)?.setAttribute('aria-expanded', 'false');
    }
    menu.hidden = false; menuButton.setAttribute('aria-expanded', 'true');
    actions.querySelector('button')?.focus({ preventScroll: true });
  }
  function syncManagement() {
    const open = sidebar.classList.contains('mobile-open');
    sidebar.inert = !open;
    sidebar.setAttribute('aria-hidden', String(!open));
    mobileToggle.classList.toggle('open', open);
    mobileToggle.setAttribute('aria-expanded', String(open));
    mobileToggle.innerHTML = `${open ? closeGlyph : glyph('<path d="M4 21V4h7v17M11 9h9v12M7 8h1m-1 4h1m-1 4h1m7-3h1m-1 4h1"/>')}<span>Manage</span>`;
    for (const button of document.querySelectorAll('.main-nav [data-view]')) {
      const active = open && button.dataset.view === getView();
      button.classList.toggle('active', active);
      button.setAttribute('aria-controls', sidebar.id);
      button.setAttribute('aria-expanded', String(active));
      button.removeAttribute('aria-current');
    }
    if (!open && sidebar.contains(document.activeElement)) canvas.focus({ preventScroll: true });
  }
  function openManagement() {
    closeMenu(); sidebar.classList.add('mobile-open'); syncManagement();
  }
  function closeManagement(restoreFocus = false) {
    sidebar.classList.remove('mobile-open'); syncManagement();
    if (restoreFocus) {
      const trigger = window.innerWidth <= 700 ? mobileToggle : document.querySelector(`.main-nav [data-view="${getView()}"]`);
      trigger?.focus({ preventScroll: true });
    }
  }
  function toggleManagement(next) {
    if (sidebar.classList.contains('mobile-open') && next === getView()) { closeManagement(); return; }
    onView(next); openManagement();
  }
  $('#close-management').addEventListener('click', () => closeManagement(true));
  menuButton.addEventListener('click', toggleMenu);
  document.addEventListener('pointerdown', event => {
    if (menu.hidden || menuWrap.contains(event.target)) return;
    closeMenu();
    // Dismissal should not place construction under the menu.
    if (event.target === canvas) { event.preventDefault(); event.stopPropagation(); }
  }, true);
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); }
    event.stopPropagation();
  });
  // Moved triggers are hidden after opening their panel. Return keyboard focus
  // to the visible menu control when those panels close.
  const panelObserver = new MutationObserver(records => {
    for (const record of records) {
      if (record.target.hidden && (record.target.contains(document.activeElement) || menu.contains(document.activeElement))) {
        if (menu.hidden) menuButton.focus({ preventScroll: true });
      }
    }
  });
  for (const selector of ['#layers-panel', '#map-options']) panelObserver.observe($(selector), { attributes: true, attributeFilter: ['hidden'] });
  syncManagement();
  return { openManagement, closeManagement, toggleManagement, syncManagement, closeMenu, isMinimapVisible: () => !minimap.hidden };
}
