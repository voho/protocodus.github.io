// Short, quiet answers to play. No loops, samples, or audio work before a gesture.
const MAX_VOICES = 8;
const MASTER_LEVEL = .6;
const PENDING_LIFETIME = 250;
const note = (frequency, offset, duration, level, type = 'sine', endFrequency = frequency) =>
 ({frequency, offset, duration, level, type, endFrequency});
const CUES = {
 confirm: {gap:120, notes:[note(523.25,0,.12,.025),note(783.99,.025,.13,.009)]},
 construction: {group:'work',gap:75, notes:[note(392,0,.10,.035,'triangle',440),note(784,.012,.08,.009)]},
 demolition: {group:'work',gap:75, notes:[note(220,0,.14,.028,'triangle',146.83),note(293.66,.025,.10,.009,'sine',196)]},
 undo: {group:'work',gap:75, notes:[note(293.66,0,.11,.022),note(392,.065,.14,.022)]},
 launch: {gap:300, notes:[note(392,0,.17,.026,'triangle'),note(523.25,.065,.18,.022),note(659.25,.13,.24,.018)]},
 error: {gap:250, notes:[note(246.94,0,.11,.026),note(220,.085,.15,.022)]},
 delivery: {gap:700, notes:[note(659.25,0,.17,.014),note(987.77,.075,.20,.012)]},
 milestone: {group:'occasion',gap:1800, notes:[note(523.25,0,.21,.022),note(783.99,.085,.23,.019),note(1046.5,.17,.28,.015)]},
 headline: {group:'occasion',gap:1800, notes:[note(523.25,0,.20,.018),note(659.25,.09,.22,.017),note(783.99,.18,.27,.015)]},
};

function browserContext() {
 const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
 return Context ? new Context() : null;
}

/**
 * unlock() and play(..., {gesture:true}) belong only in trusted input handlers.
 * Merely enabling sound, loading a save, or receiving a delivery never starts audio.
 * now() is a monotonic clock in milliseconds. Factories may return null when unsupported.
 */
export function createGameAudio({createContext = browserContext, now = () => performance.now(),
 isVisible = () => globalThis.document?.visibilityState !== 'hidden'} = {}) {
 let enabled = false, suspended = false, context = null, master = null, unlocking = null;
 let generation = 0, pendingGesture = null;
 const voices = new Set(), lastPlayed = new Map();
 const allowed = () => enabled && !suspended && isVisible();

 function cleanup(voice) {
  voices.delete(voice);
  if (voice.oscillator) {
   voice.oscillator.onended = null;
   try { voice.oscillator.disconnect(); } catch {}
  }
  try { voice.gain?.disconnect(); } catch {}
 }

 function silence() {
  generation++;pendingGesture = null;
  if (master) {
   try { master.gain.cancelScheduledValues(0);master.gain.setValueAtTime(0,context.currentTime); } catch {}
  }
  for (const voice of [...voices]) {
   try { voice.oscillator?.stop(); } catch {}
   cleanup(voice);
  }
 }

 function ready() { return allowed() && context?.state === 'running'; }

 // A rejection is contained here: autoplay policy or a missing device never breaks play.
 function unlock() {
  if (!allowed()) return Promise.resolve(false);
  if (unlocking) return unlocking;
  try {
   if (!context || context.state === 'closed') {
    silence();
    try { master?.disconnect(); } catch {}
    master = null;context = createContext();
   }
   if (!context) return Promise.resolve(false);
   if (!master) {
    const output = context.createGain();
    try {
     output.gain.setValueAtTime(0,context.currentTime);
     output.connect(context.destination);master = output;
    } catch {
     try { output.disconnect(); } catch {}
     return Promise.resolve(false);
    }
   }
   if (context.state === 'running') return Promise.resolve(ready());
   const operation = Promise.resolve(context.resume()).then(() => ready(), () => false);
   unlocking = operation;
   // The separate settled handler does not reject, even if resume() does.
   operation.then(() => { if (unlocking === operation) unlocking = null; });
   return operation;
  } catch {
   return Promise.resolve(false);
  }
 }

 function schedule(kind) {
  if (!ready() || !master) return false;
  const cue = CUES[kind], time = now(), group = cue.group || kind;
  if (time - (lastPlayed.get(group) ?? -Infinity) < cue.gap || voices.size + cue.notes.length > MAX_VOICES) return false;
  const created = [];
  try {
   const start = context.currentTime + .008;
   master.gain.setValueAtTime(MASTER_LEVEL,context.currentTime);
   for (const spec of cue.notes) {
    const voice = {oscillator:null,gain:null};created.push(voice);
    voice.oscillator = context.createOscillator();voice.gain = context.createGain();
    const {oscillator,gain} = voice, at = start + spec.offset, end = at + spec.duration;
    oscillator.type = spec.type;
    oscillator.frequency.setValueAtTime(spec.frequency,at);
    if (spec.endFrequency !== spec.frequency) oscillator.frequency.exponentialRampToValueAtTime(spec.endFrequency,at + spec.duration * .7);
    gain.gain.setValueAtTime(.0001,at);
    gain.gain.exponentialRampToValueAtTime(spec.level,at + .008);
    gain.gain.exponentialRampToValueAtTime(.0001,end);
    gain.gain.setValueAtTime(0,end + .01);
    oscillator.connect(gain);gain.connect(master);
    oscillator.onended = () => cleanup(voice);
    voices.add(voice);
    oscillator.start(at);oscillator.stop(end + .015);
   }
   lastPlayed.set(group,time);
   return true;
  } catch {
   for (const voice of created) {
    try { voice.oscillator?.stop(); } catch {}
    cleanup(voice);
   }
   return false;
  }
 }

 // True means accepted; a gesture cue may wait briefly for the browser to unlock.
 function play(kind, {gesture = false} = {}) {
  if (!Object.hasOwn(CUES,kind) || !allowed()) return false;
  if (ready()) return schedule(kind);
  if (!gesture) return false;
  const operation = unlock();
  if (ready()) return schedule(kind);
  if (!context || !master) return false;
  const request = {kind,at:now(),generation};pendingGesture = request;
  operation.then(open => {
   if (pendingGesture !== request) return;
   pendingGesture = null;
   if (open && request.generation === generation && now() - request.at <= PENDING_LIFETIME) schedule(request.kind);
  });
  return true;
 }

 return {
  setEnabled(value) { enabled = Boolean(value);if (!enabled) silence();return enabled; },
  unlock,
  play,
  // Keep the context idle but open: coming back to the tab needs no new autoplay request.
  suspend() { suspended = true;silence(); },
  resume() { suspended = false; },
  getStats() { return {enabled,suspended,contextState:context?.state || 'uninitialized',activeVoices:voices.size,maxVoices:MAX_VOICES}; },
 };
}
