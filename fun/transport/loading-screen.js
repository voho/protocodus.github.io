// Kept separate from the game so feedback can paint before its module graph loads.
const screen = document.querySelector('#loading-screen');
const app = document.querySelector('#app');
let previousFocus = null;
let cancelLoading = null;

export const isLoading = () => Boolean(screen && !screen.hidden);
export const paintLoading = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

export function updateLoading(status, stage = 1) {
  if (!screen) return;
  const step = Math.max(1, Math.min(3, stage));
  screen.querySelector('#loading-status').textContent = status;
  screen.querySelector('#loading-step').textContent = `Step ${step} of 3`;
  screen.querySelector('#loading-progress').value = step - 1;
  screen.querySelector('#loading-progress').setAttribute('aria-valuetext', status);
}

export function showLoading({ title = 'Loading your world', status = 'Getting everything ready…', stage = 1, onCancel = null } = {}) {
  if (!screen) return;
  if (!isLoading() || !screen.matches(':modal')) previousFocus = document.activeElement;
  app.inert = true; app.setAttribute('aria-busy', 'true');
  screen.hidden = false; screen.classList.remove('loading-failed');
  screen.querySelector('#loading-title').textContent = title;
  screen.querySelector('#loading-retry').hidden = true;
  cancelLoading = onCancel;
  screen.querySelector('#loading-cancel').hidden = !onCancel;
  screen.querySelector('#loading-progress').hidden = false;
  screen.querySelector('#loading-step').hidden = false;
  updateLoading(status, stage);
  // The initial HTML is already visible; promote it above any open game dialog.
  if (!screen.matches(':modal')) { if (screen.open) screen.close(); screen.showModal(); }
}

export function hideLoading() {
  if (!screen) return;
  cancelLoading = null;
  screen.querySelector('#loading-cancel').hidden = true;
  screen.querySelector('#loading-progress').value = 3;
  screen.close(); screen.hidden = true;
  app.inert = false; app.removeAttribute('aria-busy');
  const target = previousFocus?.isConnected && previousFocus !== document.body && !previousFocus.closest('[hidden], dialog:not([open])') && !previousFocus.disabled
    ? previousFocus : document.querySelector('#modal[open] .close-modal') || document.querySelector('#world');
  target?.focus({ preventScroll: true }); previousFocus = null;
}

export function failLoading() {
  showLoading({ title: 'The game couldn’t start', status: 'Loading was interrupted. Please try again.' });
  screen.classList.add('loading-failed');
  screen.querySelector('#loading-progress').hidden = true;
  screen.querySelector('#loading-step').hidden = true;
  screen.querySelector('#loading-retry').hidden = false;
  screen.querySelector('#loading-retry').focus({ preventScroll: true });
}

export function loadingJobProgress({phase,completed,total}) {
  const labels={generating:'Shaping terrain, rivers and towns…',restoring:'Restoring your saved world…',encoding:'Preparing your company save…',terrain:'Preparing the landscape…',routes:'Preparing your transport network…',opening:'Opening your world…',fallback:'Preparing your world…'};
  const progress=total&&phase==='opening'?` ${Math.floor(completed/total*100)}%`:'';
  updateLoading((labels[phase]||'Preparing your world…')+progress,1);
}

screen?.addEventListener('cancel', event => { event.preventDefault(); cancelLoading?.(); });
screen?.querySelector('#loading-cancel').addEventListener('click', () => cancelLoading?.());
screen?.querySelector('#loading-retry').addEventListener('click', () => location.reload());
