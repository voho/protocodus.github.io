/* Meteora — adaptive resolution.

   A heavy fight should cost sharpness, not frame rate. This picks the
   renderer's pixel ratio from a short ladder of levels, judging frames
   against the display's own refresh interval (60 Hz, 120 Hz, whatever it
   is), learnt as a slowly rising minimum of the frame times:

     drop   frames have run late for half a second (one slow frame — a GC
            pause, a tab switch — changes nothing)
     climb  three seconds at the refresh rate

   A browser never runs faster than the display, so at the refresh rate
   there is no way to see spare capacity; the only test is to climb and
   watch. To stop that turning into a sawtooth, the level where a bad
   spell began is banned for thirty seconds.

   The ceiling is 1.5: on a 2× screen that is 44 % fewer pixels than full
   density, and with antialiasing the difference is hard to see in flight. */

const LADDER = [0.6, 0.75, 0.9, 1, 1.25, 1.5];
const DROP_AFTER = 0.5, CLIMB_AFTER = 3, COOLDOWN = 0.6, BAN = 30, MAX_REFRESH_MS = 20;

export function createResolution({ devicePixelRatio = 1 } = {}) {
  const levels = LADDER.filter(l => l <= Math.max(devicePixelRatio, LADDER[0]) + 1e-9);
  let index = levels.length - 1;
  let time = 0, ema = null, refresh = null;
  let bad = 0, good = 0, cooldown = 0, inEpisode = false;
  const bannedUntil = new Map();

  return {
    levels,
    get ratio() { return levels[index]; },
    frame(ms) {
      const dt = ms / 1000;
      time += dt;
      ema = ema === null ? ms : ema * 0.9 + ms * 0.1;
      // No display refreshes slower than 50 Hz, so a game that starts slow
      // cannot teach itself that slow is normal.
      refresh = Math.min(MAX_REFRESH_MS, refresh === null ? ms : Math.min(ms, refresh + (ms - refresh) * 0.001));
      cooldown -= dt;

      if (ema > refresh * 1.3 + 0.5) { bad += dt; good = 0; }
      else if (ema <= refresh * 1.1 + 0.3) { good += dt; bad = 0; }
      else { bad = 0; good = 0; }

      if (bad >= DROP_AFTER && cooldown <= 0 && index > 0) {
        if (!inEpisode) bannedUntil.set(index, time + BAN);
        inEpisode = true;
        index--;
        bad = 0; cooldown = COOLDOWN;
      } else if (good >= CLIMB_AFTER) {
        inEpisode = false;
        const next = index + 1;
        if (next < levels.length && (bannedUntil.get(next) ?? 0) <= time && cooldown <= 0) {
          index = next;
          cooldown = 1;
        }
        good = 0;
      }
      return levels[index];
    },
  };
}
