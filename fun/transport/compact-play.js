import { icon } from './ui-icons.js';

const $ = selector => document.querySelector(selector);

/** Keep secondary controls available without reserving space around the map. */
export function mountCompactPlay({ onMenu, onNews, onCompany, onGoals, onAchievements, onShortcuts, onView, getView, onCancelGesture = () => {}, onMinimapOpen = () => {}, shortcuts = {} }) {
  const app = $('#app'), sidebar = $('.sidebar'), mobileToggle = $('.mobile-panel-toggle');
  const topbar = $('.topbar'), canvas = $('#world'), minimap = $('.minimap-wrap');
  app.classList.add('compact-play');
  sidebar.id ||= 'management-panel';
  sidebar.classList.remove('mobile-open');

  const drawerHeading = document.createElement('div');
  drawerHeading.className = 'management-drawer-heading';
  // The drawer's own heading names the view (DESIGN.md 6.1: no eyebrows), so this row only holds the close button.
  drawerHeading.innerHTML = `<button id="close-management" type="button" aria-label="Close panel" title="Close panel (Esc)">${icon('close')}</button>`;
  sidebar.prepend(drawerHeading);

  // Reuse the mobile control so its existing gesture cancellation stays intact.
  topbar.insertBefore(mobileToggle, $('.main-nav'));
  mobileToggle.setAttribute('aria-controls', sidebar.id);
  mobileToggle.addEventListener('click', syncManagement);

  const menuWrap = document.createElement('div');
  menuWrap.className = 'compact-menu-wrap';
  menuWrap.innerHTML = `<button id="game-menu-button" type="button" class="icon-button" title="Game menu" aria-label="Game menu" aria-expanded="false" aria-controls="game-menu">${icon('menu')}</button><section id="game-menu" aria-label="Game menu" hidden><div class="compact-menu-heading"><strong>Transport</strong><span id="compact-menu-weather"></span></div><div class="compact-menu-actions"></div><div class="compact-menu-status"></div></section>`;
  topbar.append(menuWrap);
  const menuButton = $('#game-menu-button'), menu = $('#game-menu');
  const actions = menu.querySelector('.compact-menu-actions');
  // Rows carry their shortcut on the right (DESIGN.md 12.10); a rule separates the company, the map, help and the game.
  const keyHint = key => key ? `<span class="kbd" aria-hidden="true">${key}</span>` : '';
  const moveAction = (selector, label, key = '') => {
    const button = $(selector);
    if (!button) return;
    button.classList.add('compact-menu-action');
    // Preserve existing SVG icons and handlers. Dynamic audio icons use ::after.
    if (label) {
      const art = button.querySelector('svg')?.outerHTML || icon('more');
      button.innerHTML = `${art}<span>${label}</span>${keyHint(key)}`;
    }
    if (key) button.setAttribute('aria-keyshortcuts', key.replace('Ctrl+', 'Control+'));
    actions.append(button);
    button.addEventListener('click', () => closeMenu());
  };
  const addAction = (id, label, art, callback, key = '') => {
    const button = document.createElement('button');
    button.type = 'button'; button.id = id; button.className = 'compact-menu-action';
    button.innerHTML = `${art}<span>${label}</span>${keyHint(key)}`;
    if (key) button.setAttribute('aria-keyshortcuts', key);
    button.addEventListener('click', () => { closeMenu(); callback(); });
    actions.append(button);
    return button;
  };
  const rule = () => { const line = document.createElement('div'); line.className = 'compact-menu-rule'; line.setAttribute('role', 'separator'); actions.append(line); };
  if (onCompany) addAction('company-button', 'Company', icon('company'), onCompany, shortcuts.company);
  if (onGoals) addAction('goals-button', 'Company goals', icon('flag'), onGoals, shortcuts.goals);
  if (onAchievements) addAction('achievements-button', 'Achievements', icon('achievements'), onAchievements);
  if (onNews) addAction('news-button', 'News', icon('news'), onNews, shortcuts.news);
  rule();
  moveAction('.main-nav [data-open-chains]', 'Production chains', 'C');
  moveAction('#layers-button', 'Map layers', 'L');
  const overviewButton = addAction('overview-button', 'Mini map', icon('overview'), () => {
    minimap.hidden = !minimap.hidden;
    overviewButton.setAttribute('aria-pressed', String(!minimap.hidden));
    if (!minimap.hidden) { onMinimapOpen(); $('#minimap').focus({ preventScroll: true }); }
  });
  overviewButton.setAttribute('aria-pressed', 'false');
  overviewButton.setAttribute('aria-controls', 'mini-map-panel');
  moveAction('#map-options-button', 'Map options');
  rule();
  moveAction('#audio-button');
  moveAction('#help-button', 'Guide');
  if (onShortcuts) addAction('shortcuts-button', 'Keyboard shortcuts', icon('keyboard'), onShortcuts, '?');
  rule();
  moveAction('#save-button', 'Saved games', 'Ctrl+S');
  moveAction('#world-button', 'New world');
  addAction('main-menu-button', 'Main menu', icon('world'), () => { closeManagement(); onMenu?.(); });
  // The menu's foot keeps the save status; map coordinates stay out of sight (DESIGN.md 6.1) for the screen reader cursor.
  const weather = $('#weather'), saveStatus = $('#save-status');
  if (weather) $('#compact-menu-weather').append(weather);
  if (saveStatus) menu.querySelector('.compact-menu-status').append(saveStatus);

  minimap.id = 'mini-map-panel'; minimap.hidden = true;
  const miniClose = document.createElement('button');
  miniClose.id = 'close-minimap'; miniClose.type = 'button';
  miniClose.setAttribute('aria-label', 'Hide mini map'); miniClose.title = 'Hide mini map';
  miniClose.innerHTML = icon('close');
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
    mobileToggle.innerHTML = `${open ? icon('close') : ''}<span>Manage</span>`;
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
