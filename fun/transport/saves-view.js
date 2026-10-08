import { BIOMES } from './data.js';
import { listSaveSlots, writeSaveSlot, readSaveSlot, renameSaveSlot, deleteSaveSlot, slotDate as worldDate, slotMoney as money } from './save-slots.js';
import { showLoading, hideLoading, paintLoading, loadingJobProgress } from './loading-screen.js';
import { icon, has } from './ui-icons.js';
import { escapeHTML as escape } from './copy.js';

// Saves draw the biome's own glyph; an unknown landscape falls back to the globe.
const biomeGlyph = biome => BIOMES[biome] && has(biome) ? biome : 'world';
function savedDate(value, autosave = false) {
  if (value === null || value === undefined) return autosave ? 'Latest automatic save' : 'Saved date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Saved date unavailable' : `Saved ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

/** Local save management. A disposed dialog never applies a pending load. */
export function mountSaves(container, game, { onLoad, onClose }) {
  let alive = true, busy = false, slots = [], expanded = null, operationController = null, pendingLoadId = null, focusLoadId = null;
  const defaultName = `${game.cities?.[0]?.name || BIOMES[game.biome]?.name || 'New'} Transport`.slice(0, 40);
  const dialog = container.closest('dialog');

  const isActive = () => alive && (!dialog || dialog.open);
  function dispose() { alive = false; operationController?.abort(); }
  function close() { dispose(); onClose?.(); }
  function setMessage(text = '', error = false, reveal = false) {
    if (!isActive()) return;
    const message = container.querySelector('#saves-message');
    message.textContent = text; message.hidden = !text; message.classList.toggle('is-error', error);
    if (reveal) message.scrollIntoView({ block: 'nearest' });
  }
  function setBusy(value) {
    busy = value;
    if (!isActive()) return;
    container.querySelector('.saves-explorer').setAttribute('aria-busy', String(value));
    container.querySelectorAll('button:not(.close-modal), input').forEach(control => { control.disabled = value || control.dataset.unavailable === 'true'; });
  }
  async function run(message, operation) {
    if (!isActive() || busy) return;
    operationController = new AbortController();
    setBusy(true); setMessage(message);
    try { await operation(); }
    catch (error) { if (isActive()) setMessage(error?.message || 'This browser could not complete that save action.', true, true); }
    finally {
      operationController = null;
      if (isActive()) {
        setBusy(false);
        if (focusLoadId !== null) {
          const target = container.querySelector(`[data-save-confirm="load"][data-save-id="${CSS.escape(String(focusLoadId))}"]`);
          target?.focus({ preventScroll: true }); target?.closest('.save-card')?.scrollIntoView({ block: 'nearest' });
          focusLoadId = null;
        }
      }
    }
  }
  function getSlot(id) { return slots.find(slot => String(slot.id) === String(id)); }
  function showView(view, focus = false) {
    if (!isActive() || busy) return;
    container.querySelectorAll('[data-saves-panel]').forEach(panel => { panel.hidden = panel.dataset.savesPanel !== view; });
    container.querySelectorAll('[data-saves-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.savesView === view)));
    if (focus) container.querySelector(view === 'save' ? '#save-new-name' : '[data-save-action="load"]')?.focus({ preventScroll: true });
  }

  function confirmation(slot) {
    if (expanded?.id !== slot.id) return '';
    if (expanded.action === 'rename') return `<form class="save-inline-form" data-save-rename-form="${escape(slot.id)}"><label>Save name<input name="slotName" value="${escape(slot.name)}" maxlength="40" required autocomplete="off" aria-label="New name for ${escape(slot.name)}"></label><div class="save-confirm-actions"><button type="button" class="button button-outline" data-save-cancel>Cancel</button><button type="submit" class="button button-primary">Rename</button></div></form>`;
    const text = expanded.action === 'load' ? `Load “${slot.name}”?` : expanded.action === 'delete' ? `Delete “${slot.name}”?` : `Replace “${slot.name}”?`;
    const note = expanded.action === 'load' ? 'Replaces the current world and autosave.' : expanded.action === 'overwrite' ? 'Replace this slot with the current world.' : 'This named save cannot be recovered.';
    const action = expanded.action === 'load' ? 'Load game' : expanded.action === 'overwrite' ? 'Replace save' : 'Delete save';
    return `<div class="save-confirmation" role="group" aria-label="Confirm ${expanded.action}"><strong>${escape(text)}</strong><p>${note}</p><div class="save-confirm-actions">${expanded.action === 'load' ? '<button type="button" class="button button-outline" data-save-first>Save current first</button>' : ''}<button type="button" class="button button-outline" data-save-cancel>Cancel</button><button type="button" class="button ${expanded.action === 'delete' ? 'button--danger' : 'button-primary'}" data-save-confirm="${expanded.action}" data-save-id="${escape(slot.id)}">${action}</button></div></div>`;
  }

  function card(slot) {
    const readonly = slot.readonly || slot.id === 'autosave', ready = slot.status === 'ready', landscape = BIOMES[slot.biome];
    return `<article class="save-card${readonly ? ' save-autosave' : ''}${ready ? '' : ' save-card-unavailable'}" data-save-slot="${escape(slot.id)}"><div class="save-card-main"><div class="save-landscape save-landscape-${escape(slot.biome)}">${icon(readonly ? 'clock' : biomeGlyph(slot.biome))}</div><div class="save-card-info"><h4>${escape(slot.name)}</h4><div class="save-world-details"><span>${escape(landscape?.name || 'Unknown world')}</span><span>${worldDate(slot.day)}</span><strong>${money(slot.money)}</strong></div><p class="save-timestamp">${escape(savedDate(slot.savedAt, readonly))}</p></div></div>${!ready ? `<p class="save-card-error">${escape(slot.message || 'This save is unavailable. Your current world is unchanged.')}</p>` : ''}<div class="save-card-actions"><button type="button" class="button button-primary save-load" data-save-action="load" data-save-id="${escape(slot.id)}"${ready ? '' : ' data-unavailable="true" disabled'} aria-label="Load ${escape(slot.name)}">${icon('saved')} Load</button>${readonly ? '<span class="save-auto-note">Automatic checkpoint</span>' : `<div class="save-edit-actions"><button type="button" class="button button-outline" data-save-action="overwrite" data-save-id="${escape(slot.id)}" title="Overwrite with current world" aria-label="Overwrite ${escape(slot.name)}">${icon('saved')} Replace</button><button type="button" class="button button-outline" data-save-action="rename" data-save-id="${escape(slot.id)}" title="Rename save" aria-label="Rename ${escape(slot.name)}">${icon('edit')} Rename</button><button type="button" class="button button--danger" data-save-action="delete" data-save-id="${escape(slot.id)}" title="Delete save" aria-label="Delete ${escape(slot.name)}">${icon('retire')} Delete</button></div>`}</div>${confirmation(slot)}</article>`;
  }

  function renderSlots() {
    if (!isActive()) return;
    const scrollTop = dialog?.scrollTop || 0, manual = slots.filter(slot => slot.id !== 'autosave' && !slot.readonly), autosave = slots.filter(slot => slot.id === 'autosave' || slot.readonly);
    container.querySelector('#save-slot-list').innerHTML = `<div class="saves-section-title"><h3>Your saves</h3><span>${manual.length}</span></div><div class="save-manual-list">${manual.length ? manual.map(card).join('') : '<div class="saves-empty"><strong>No named saves yet.</strong><p>Save your current world to keep it.</p><button class="button button-outline" data-save-first>Save current world</button></div>'}</div>${autosave.length ? `<div class="saves-section-title saves-autosave-title"><h3>Autosave</h3><span>Latest checkpoint</span></div>${autosave.map(card).join('')}` : ''}`;
    container.querySelectorAll('[data-save-action]').forEach(button => button.addEventListener('click', () => {
      if (busy || !isActive()) return;
      pendingLoadId = null; expanded = { id: button.dataset.saveId, action: button.dataset.saveAction }; setMessage(); renderSlots();
      const target = expanded.action === 'rename' ? container.querySelector(`[data-save-rename-form="${CSS.escape(String(expanded.id))}"] input`) : container.querySelector(`[data-save-confirm="${expanded.action}"][data-save-id="${CSS.escape(String(expanded.id))}"]`);
      target?.focus({ preventScroll: true }); target?.closest('.save-card')?.scrollIntoView({ block: 'nearest' });
      if (expanded.action === 'rename') target?.select();
    }));
    container.querySelectorAll('[data-save-first]').forEach(button => button.addEventListener('click', () => {
      pendingLoadId = expanded?.action === 'load' ? expanded.id : null;
      showView('save', true);
    }));
    container.querySelectorAll('[data-save-cancel]').forEach(button => button.addEventListener('click', () => {
      const previous = expanded; expanded = null; pendingLoadId = null; renderSlots();
      container.querySelector(`[data-save-action="${previous.action}"][data-save-id="${CSS.escape(String(previous.id))}"]`)?.focus({ preventScroll: true });
    }));
    container.querySelectorAll('[data-save-confirm]').forEach(button => button.addEventListener('click', () => perform(button.dataset.saveConfirm, button.dataset.saveId)));
    container.querySelectorAll('[data-save-rename-form]').forEach(form => form.addEventListener('submit', event => {
      event.preventDefault(); const name = form.elements.slotName.value.trim();
      if (!name) { setMessage('Give this save a name.', true, true); return; }
      perform('rename', form.dataset.saveRenameForm, name);
    }));
    if (dialog) dialog.scrollTop = scrollTop;
    setBusy(busy);
  }

  function refresh() {
    const result = listSaveSlots();
    if (result.ok) slots = result.slots || [];
    else { if (Array.isArray(result.slots)) slots = result.slots; setMessage(result.message || 'Saved games could not be read from this browser.', true); }
    renderSlots();
    return result.ok;
  }

  function perform(action, id, name) {
    const slot = getSlot(id); if (!slot) return;
    const progress = { load: 'Loading game…', overwrite: 'Saving current world…', rename: 'Renaming save…', delete: 'Deleting save…' }[action];
    return run(progress, async () => {
      let result;
      if (action === 'load') {
        const controller=operationController;
        showLoading({ title: 'Loading your world', status: 'Reading your saved company…', stage: 1, onCancel:()=>controller.abort() });
        try {
          await paintLoading();
          if (!isActive()) return;
          result = await readSaveSlot(id,{signal:controller.signal,onProgress:loadingJobProgress});
          controller.signal.throwIfAborted();
          if (!isActive()) return;
          if (result.ok) result = await onLoad?.(result.game, slot, { isActive, signal:controller.signal });
          if (!isActive()) return;
          if (result?.ok === false) setMessage(result.message || 'The save could not be loaded. Your current world is unchanged.', true, true);
          else if (result?.ok) { dispose(); onClose?.(); }
        } finally { hideLoading(); }
        return;
      }
      if (action === 'overwrite') result = await writeSaveSlot(game, { id, name: slot.name, capturePaused:true, signal:operationController.signal, isCurrent:isActive });
      if (action === 'rename') result = await renameSaveSlot(id, name);
      if (action === 'delete') result = await deleteSaveSlot(id);
      if (!isActive()) return;
      if (!result?.ok) { setMessage(result?.message || 'The save action could not be completed.', true, true); return; }
      expanded = null;
      if (refresh()) setMessage(action === 'delete' ? 'Save deleted.' : action === 'rename' ? 'Save renamed.' : `“${slot.name}” updated.`);
    });
  }

  container.innerHTML = `<div class="modal-inner saves-explorer" aria-busy="false"><button type="button" class="close-modal" aria-label="Close saved games">${icon('close')}</button><div class="saves-heading"><span class="eyebrow">Your worlds</span><h2>Save / load</h2><p>Saved in this browser.</p></div><nav class="saves-tabs" aria-label="Saved worlds"><button class="button button-outline" data-saves-view="save" aria-pressed="true">${icon('saved')} Save current</button><button class="button button-outline" data-saves-view="load" aria-pressed="false">${icon('world')} Load worlds</button></nav><section data-saves-panel="save" aria-label="Save current world"><section class="save-current" aria-label="Current world"><span class="save-current-icon">${icon(biomeGlyph(game.biome))}</span><div><span>Current world</span><strong>${escape(BIOMES[game.biome]?.name || game.biome)}, ${worldDate(game.day)}</strong></div><b>${money(game.money)}</b></section><form id="save-new-form" class="save-new-form"><label for="save-new-name">Save name<input id="save-new-name" name="saveName" maxlength="40" required autocomplete="off" value="${escape(defaultName)}" placeholder="Name this world"></label><button type="submit" id="save-new-button" class="button button-primary">${icon('saved')} Save world</button></form><p class="saves-local-note">Named saves stay until you replace or delete them.</p></section><p id="saves-message" class="saves-message" role="status" aria-live="polite" hidden></p><section id="save-slot-list" data-saves-panel="load" aria-label="Saved games" hidden></section><details class="saves-storage-note"><summary>About browser saves</summary><p>Clearing this browser’s storage removes every saved world.</p></details><div class="save-footer"><button class="button button-outline" data-saves-done>Back to game ${icon('arrow')}</button></div></div>`;
  container.querySelectorAll('[data-saves-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.savesView)));
  container.querySelector('[data-saves-done]').addEventListener('click', close);
  container.querySelector('.close-modal').addEventListener('click', close);
  container.querySelector('#save-new-form').addEventListener('submit', event => {
    event.preventDefault(); const name = container.querySelector('#save-new-name').value.trim();
    if (!name) { setMessage('Give this save a name.', true, true); return; }
    run('Saving current world…', async () => {
      const result = await writeSaveSlot(game, { name, capturePaused:true, signal:operationController.signal, isCurrent:isActive });
      if (!isActive()) return;
      if (!result?.ok) { setMessage(result?.message || 'This browser could not save the world.', true, true); return; }
      expanded = pendingLoadId ? { id: pendingLoadId, action: 'load' } : null;
      pendingLoadId = null;
      if (refresh()) {
        setMessage(`“${name}” saved.`);
        if (expanded) {
          container.querySelectorAll('[data-saves-panel]').forEach(panel => { panel.hidden = panel.dataset.savesPanel !== 'load'; });
          container.querySelectorAll('[data-saves-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.savesView === 'load')));
          focusLoadId = expanded.id;
        }
      }
    });
  });
  dialog?.addEventListener('close', dispose, { once: true });
  try { refresh(); } catch { setMessage('Saved games could not be read from this browser.', true); }
  return { dispose };
}
