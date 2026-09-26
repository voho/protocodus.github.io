const MAX = Number.MAX_SAFE_INTEGER;
const LIFETIME = 4, HOLD = .25;
const counter = value => value === Infinity ? MAX : Number.isFinite(value) ? Math.min(MAX, Math.max(0, Math.floor(value))) : 0;
const add = (a, b) => Math.min(MAX, a + b);
const NOTICE_LABELS = new Map([
  ['repair', 'Repair'], ['rapid', 'Rapid fire'], ['invulnerable', 'Invulnerable'],
  ['power', 'Power core'], ['drone', 'Wing drone'], ['bomb', 'Nova charge'],
  ['squadron', 'Squadron cleared'], ['rescue', 'Drone rescued'], ['nova', 'Nova'],
  ['power-lost', 'Power lost'], ['captured', 'Drone captured'], ['extra-life', 'Extra ship'],
  ['reserve-bonus', 'Reserve bonus'],
]);
const PICKUPS = new Set(['repair', 'rapid', 'invulnerable', 'power', 'drone', 'bomb']);
const EVENT_NOTICES = new Set(['squadron', 'rescue', 'nova', 'power-lost', 'captured']);
function noticeKey(event) {
  if (!event || typeof event !== 'object') return null;
  if (event.type === 'pickup') return PICKUPS.has(event.bonus) ? event.bonus : null;
  if (event.type === 'extra-life') return event.credits > 0 ? 'reserve-bonus' : 'extra-life';
  return EVENT_NOTICES.has(event.type) ? event.type : null;
}

/** One rolling reward readout. Rendering and pause timing belong to the caller. */
export class CombatFeedback {
  #baseline = null;
  #age = LIFETIME;
  #notices = new Map();
  #latest = null;

  constructor() {
    this.revision = 0;
    this.reset();
  }

  get visible() { return this.#age < LIFETIME; }
  get opacity() { return this.visible ? Math.max(0, 1 - Math.max(0, this.#age - HOLD) / (LIFETIME - HOLD)) : 0; }
  get details() {
    const latest = [...this.#notices].reverse().slice(0, 3);
    const labels = latest.map(([key, count]) => `${NOTICE_LABELS.get(key)}${count > 1 ? ` ×${count}` : ''}`);
    if (this.#notices.size > 3) labels.push(`+${this.#notices.size - 3} more`);
    return labels.join(' · ');
  }

  #clear() {
    this.score = 0; this.credits = 0; this.chain = 0; this.label = 'Rewards';
    this.#notices.clear(); this.#latest = null;
    this.#age = LIFETIME;
  }

  #activate() {
    const hidden = !this.visible;
    if (hidden) this.#clear();
    this.#age = 0;
    return hidden;
  }

  reset(state = null) {
    this.#clear();
    this.#baseline = state ? { score: counter(state.score), credits: counter(state.credits) } : null;
    this.revision++;
  }

  collect(state, events = []) {
    if (!state || typeof state !== 'object') return;
    const score = counter(state.score), credits = counter(state.credits);
    const scoreGain = this.#baseline ? Math.max(0, score - this.#baseline.score) : 0;
    const creditGain = this.#baseline ? Math.max(0, credits - this.#baseline.credits) : 0;
    // Spending, resets and gains all advance the baseline. Event payloads are
    // presentation metadata and never another source of score or money.
    if (!this.#baseline) this.#baseline = { score, credits };
    else { this.#baseline.score = score; this.#baseline.credits = credits; }

    const chain = state.comboTime > 0 && counter(state.combo) >= 2 ? counter(state.combo) : 0;
    const previousChain = this.chain;
    let changed = false, activity = scoreGain > 0 || creditGain > 0;
    if (activity) {
      changed = this.#activate();
      const nextScore = add(this.score, scoreGain), nextCredits = add(this.credits, creditGain);
      changed ||= nextScore !== this.score || nextCredits !== this.credits;
      this.score = nextScore; this.credits = nextCredits;
    }
    if (Array.isArray(events)) for (const event of events) {
      // A newly earned combo is still feedback when counters have saturated.
      // Only its explicit event refreshes the burst, never the ticking timer.
      if (event?.type === 'combo' && chain > previousChain) {
        if (!activity) changed = this.#activate();
        activity = true;
      }
      const key = noticeKey(event);
      if (!key) continue;
      if (!activity) changed = this.#activate();
      activity = true;
      // Deleting and reinserting moves a repeated type to the front of the
      // readout, without admitting an arbitrary event label into this map.
      const count = this.#notices.get(key) || 0;
      const wasLatest = this.#latest === key;
      this.#latest = key;
      this.#notices.delete(key); this.#notices.set(key, add(count, 1));
      changed ||= count < MAX || !wasLatest;
    }

    const label = chain && typeof state.comboLabel === 'string' && state.comboLabel.trim()
      ? state.comboLabel.slice(0, 64) : 'Rewards';
    changed ||= this.chain !== chain || this.label !== label;
    this.chain = chain; this.label = label;
    if (changed) this.revision++;
  }

  update(dt) {
    if (!this.visible || !Number.isFinite(dt) || dt <= 0) return;
    this.#age = Math.min(LIFETIME, this.#age + dt);
    if (!this.visible) { this.#clear(); this.revision++; }
  }
}
