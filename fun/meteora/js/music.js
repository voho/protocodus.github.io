/* Meteora — the soundtrack.

   Six recorded pieces, one for each kind of moment, crossfaded as the mood
   changes:

     The Sea of Distant Suns      menu         the belt at rest, the briefings
     Beneath Uncharted Skies      calm         patrols, the flight home
     The Weight of Faraway Suns   stealth, tension, defeat
     Apex of the Armada           combat, climax
     Grandeur of the Fallen       victory
     Gravity's Final Breath       the Well, all the way down

   A mission may give a mood a piece of its own (its `soundtrack`: a map of
   mood to piece, or one piece for the whole flight).

   Each piece streams from an <audio> element routed through the Web Audio
   graph, so only what plays is downloaded and the music volume and the
   ducking under the radio apply to it; a mission's pieces are fetched
   before it starts (`prepare`). Going back to a piece within a minute and
   a half picks it up where it was; later, it starts again. Missions
   choose the mood; on top of that, Harrow ships closing on the player lift
   a calm or tense mission into combat until the sky clears. */

export const TRACKS = {
  sea: { file: 'the-sea-of-distant-suns.mp3', title: 'The Sea of Distant Suns' },
  skies: { file: 'beneath-uncharted-skies.mp3', title: 'Beneath Uncharted Skies' },
  weight: { file: 'the-weight-of-faraway-suns.mp3', title: 'The Weight of Faraway Suns' },
  armada: { file: 'apex-of-the-armada.mp3', title: 'Apex of the Armada' },
  grandeur: { file: 'grandeur-of-the-fallen.mp3', title: 'Grandeur of the Fallen' },
  gravity: { file: 'gravitys-final-breath.mp3', title: 'Gravity\'s Final Breath' },
};
export const MOODS = {
  menu: 'sea', calm: 'skies', stealth: 'weight', tension: 'weight',
  combat: 'armada', climax: 'armada', victory: 'grandeur', defeat: 'weight',
};
const FLIGHT = ['calm', 'stealth', 'tension', 'combat', 'climax'];
const FADE = 2.5, RESUME = 90, DUCK = 0.45;
const BASE = new URL('../assets/music/', import.meta.url);

/* The piece a mood plays under a mission's soundtrack. */
export function trackFor(mood, soundtrack = null) {
  if (typeof soundtrack === 'string') return FLIGHT.includes(mood) ? soundtrack : MOODS[mood] ?? null;
  return soundtrack?.[mood] ?? MOODS[mood] ?? null;
}

export function createMusic(audio, volume = 0.6) {
  let ctx = null, out = null, level = volume;
  let mood = 'menu', base = 'menu', heat = 0, soundtrack = null, playing = null, ducked = false;
  const pieces = new Map();

  const clock = () => performance.now() / 1000;
  function piece(key) {
    let p = pieces.get(key);
    if (!p) {
      const el = new Audio();
      el.preload = 'none';
      el.loop = true;
      el.src = new URL(TRACKS[key].file, BASE).href;
      p = { key, el, gain: null, left: -Infinity, stop: null };
      pieces.set(key, p);
    }
    if (ctx && !p.gain) {
      p.gain = ctx.createGain();
      p.gain.gain.value = 0;
      p.gain.connect(out);
      ctx.createMediaElementSource(p.el).connect(p.gain);
    }
    return p;
  }
  const ramp = (param, value, seconds) => {
    const now = ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + seconds);
  };

  function play(key) {
    if (!ctx || playing?.key === key) return;
    if (playing) {
      const p = playing;
      ramp(p.gain.gain, 0, FADE);
      p.left = clock();
      clearTimeout(p.stop);
      p.stop = setTimeout(() => { if (playing !== p) p.el.pause(); }, FADE * 1000 + 150);
    }
    playing = null;
    if (!key) return;
    const p = piece(key);
    clearTimeout(p.stop);
    if (clock() - p.left > RESUME) { try { p.el.currentTime = 0; } catch { /* not loaded yet */ } }
    p.el.preload = 'auto';
    p.el.play().catch(() => { /* not allowed yet: the next gesture starts it */ });
    ramp(p.gain.gain, ducked ? DUCK : 1, FADE);
    playing = p;
  }
  const refresh = () => play(trackFor(mood, soundtrack));

  function build() {
    ctx = audio.ctx;
    if (!ctx || out) return;
    out = ctx.createGain();
    out.gain.value = level * level * 0.7;
    out.connect(ctx.destination);
    for (const p of pieces.values()) piece(p.key);
    refresh();
  }

  function setMood(next, { force = false } = {}) {
    if (!(next in MOODS)) return;
    base = next;
    if (!force && heat > 0.5 && (next === 'calm' || next === 'tension' || next === 'stealth')) next = 'combat';
    mood = next;
    refresh();
  }

  return {
    /* From a user gesture: browsers let a page sound only after one, so
       a piece they held back starts here. */
    start() {
      if (!ctx) build();
      if (playing?.el.paused) playing.el.play().catch(() => {});
    },
    setVolume(v) { level = v; if (out) ramp(out.gain, v * v * 0.7, 0.1); },
    setMood,
    get mood() { return mood; },
    get track() { return playing ? TRACKS[playing.key].title : null; },
    /* A mission's own pieces (see trackFor), null for the usual. */
    setSoundtrack(s) { soundtrack = s ?? null; refresh(); },
    /* Fetch the pieces a flight will play, so none of them waits on the
       network when its moment comes. */
    prepare(s = soundtrack) {
      for (const m of [...FLIGHT, 'victory', 'defeat']) {
        const key = trackFor(m, s);
        if (key) piece(key).el.preload = 'auto';
      }
    },
    /* Quieter while someone on the radio is speaking. */
    duck(on) {
      if (on === ducked || !ctx) return;
      ducked = on;
      if (playing) ramp(playing.gain.gain, on ? DUCK : 1, on ? 0.4 : 1.2);
    },
    /* Lift the score into combat while the Harrow are close. */
    update(world, dt) {
      if (!ctx && audio.ctx) build();
      if (!ctx || !world?.player) return;
      const p = world.player;
      let near = false;
      if (world.state === 'flying' && p.alive) {
        for (const e of world.entities) {
          if (e.team !== 1 || !e.alive || e.frozen || e.role === 'sentry' || e.role === 'seed' || e.role === 'anchor') continue;
          const d = Math.hypot(e.ship.pos[0] - p.ship.pos[0], e.ship.pos[1] - p.ship.pos[1], e.ship.pos[2] - p.ship.pos[2]);
          if (d < (e.big ? 3500 : 1600)) { near = true; break; }
        }
      }
      heat = near ? Math.min(1, heat + dt * 0.8) : Math.max(0, heat - dt / 9);
      const lifted = heat > 0.5 && (base === 'calm' || base === 'tension' || base === 'stealth') ? 'combat' : base;
      if (lifted !== mood) { mood = lifted; refresh(); }
    },
    stop() { play(null); },
  };
}
