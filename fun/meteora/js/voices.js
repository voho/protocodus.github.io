/* Meteora — radio voices.

   The radio is spoken as well as shown, through the browser's own speech
   synthesis (the Web Speech API): no recordings, like the rest of the
   sound. Each speaker is cast once from the voices the system offers — by
   the sex the script gives them where the voice's name tells (system
   voices are named, not labelled), by accent for variety (the Commander
   British, Wren American, Saint Australian, Okonkwo South African where
   such voices exist), the better "natural" voices first — and each gets a
   pitch and pace of their own, so one voice can play two parts and still
   be told apart. The flight computer and the Harrow get the most
   mechanical voice there is, pitched down.

   A line is spoken when it appears on the radio, faster when its words
   would outlast its time on screen. A line still waiting when its time on
   screen is over is dropped, so the voices never fall behind the story.
   Pausing cuts the line short. Lantern One — the player — is never voiced.
   Out of flight the Commander reads the briefing, and a narrator the
   prologue and the debrief (`narrate`).
   Without speech synthesis, or without an English voice, the radio is
   only read. */

const CAST = [
  ['doukas', { sex: 'f', accents: ['en-GB', 'en-IE', 'en-AU'], pitch: 0.92, rate: 0.98 }],
  ['wren', { sex: 'f', accents: ['en-US', 'en-CA', 'en-AU'], pitch: 1.12, rate: 1.08 }],
  ['saint', { sex: 'm', accents: ['en-AU', 'en-IE', 'en-GB', 'en-US'], pitch: 0.94, rate: 1.03 }],
  ['okonkwo', { sex: 'f', accents: ['en-ZA', 'en-NG', 'en-IN', 'en-GB'], pitch: 1.02, rate: 1.04 }],
  ['ferrante', { sex: 'm', accents: ['en-GB', 'en-US', 'en-IE'], pitch: 0.84, rate: 0.95 }],
  ['perpetua', { sex: 'm', accents: ['en-US', 'en-GB'], pitch: 1.0, rate: 1.06 }],
  ['varlaam', { sex: 'f', accents: ['en-IE', 'en-GB', 'en-US'], pitch: 1.0, rate: 1.05 }],
  ['halo', { sex: 'm', accents: ['en-US', 'en-GB', 'en-IN'], pitch: 1.06, rate: 1.06 }],
  ['ember', { sex: 'f', accents: ['en-AU', 'en-GB', 'en-US'], pitch: 0.96, rate: 1.05 }],
  ['mule', { sex: 'm', accents: ['en-IN', 'en-US', 'en-GB'], pitch: 0.96, rate: 1.0 }],
  // The prologue's and the debriefs' storyteller. Never on the radio, so it
  // takes the best voice whoever else has it.
  ['narrator', { sex: 'm', accents: ['en-GB', 'en-IE', 'en-US'], pitch: 0.86, rate: 0.94, offAir: true }],
  ['tender', { robot: /zarvox|albert/i, pitch: 1.35, rate: 1.15 }],
  ['system', { robot: /fred|ralph/i, pitch: 0.9, rate: 1.1 }],
  ['harrow', { robot: /trinoids|zarvox/i, pitch: 0.1, rate: 0.72 }],
];

// "female" before "male": the one contains the other.
const FEMALE = /female|woman|google us english|samantha|karen|moira|tessa|victoria|fiona|veena|allison|\bava\b|susan|\bzoe\b|serena|\bkate\b|kathy|princess|vicki|\bflo\b|grandma|sandy|shelley|zira|hazel|heera|\baria\b|jenny|sonia|libby|natasha|clara|\bemma\b|michelle|catherine|nicky|martha|joanna|salli|kimberly|\bivy\b|kendra|\bamy\b|olivia|isha|lekha|tiffany|neerja|\bleah\b|maisie|\bsara\b|helena|linda|heather|kathleen|elsa|\bruth\b|\bana\b|luciana|yuna|melina|\bnora\b/i;
const MALE = /\bmale\b|\bman\b|daniel|\balex\b|\bfred\b|rishi|oliver|\btom\b|aaron|arthur|gordon|\blee\b|albert|ralph|junior|bruce|eddy|grandpa|\breed\b|rocko|david|\bmark\b|george|james|\bguy\b|\bryan\b|christopher|\beric\b|roger|steffan|thomas|william|matthew|justin|joey|brian|russell|prabhat|ravi|liam|connor|mitchell|\bnoah\b|andrew|brandon|jason|\btony\b|\bevan\b|\bdavis\b/i;
const NOVELTY = /bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|organ|superstar|whisper|wobble/i;
const ROBOT = /zarvox|trinoids|\bfred\b|\bralph\b|\balbert\b/i;
const GOOD = /natural|neural|premium|enhanced|online|google/i;
// Usable, but flatter than the rest: the old MacinTalk voices and the
// Eloquence family. They fill parts only when nothing better is left.
const PLAIN = /\b(eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|junior|kathy)\b/i;
// Seconds a voice at rate 1 takes per character (about 150 words a
// minute, as the system voices measured).
const PER_CHAR = 1 / 13;

const sexOf = v => (FEMALE.test(v.name) ? 'f' : MALE.test(v.name) ? 'm' : null);
const langOf = v => (v.lang ?? '').replace('_', '-');
// Speakable text: dashes and ellipses as pauses, no symbols read aloud.
const speakable = text => text.replace(/[▲△●◆]/g, '').replace(/\s*[—–]\s*/g, ', ').replace(/…/g, '... ').replace(/\s+/g, ' ').trim();

/* Who plays whom, from a list of voices (as getVoices returns them). */
export function castVoices(voices) {
  const english = voices.filter(v => /^en\b/i.test(langOf(v)) && !NOVELTY.test(v.name) && !ROBOT.test(v.name));
  const robots = voices.filter(v => /^en\b/i.test(langOf(v)) && ROBOT.test(v.name));
  const cast = new Map();
  if (!english.length) return cast;
  const used = new Map(), pitches = new Map();
  for (const [who, part] of CAST) {
    let best = null, bestScore = -Infinity;
    const pool = part.robot && robots.length ? robots : english;
    for (const v of pool) {
      let score = 0;
      if (part.robot) score += part.robot.test(v.name) ? 8 : ROBOT.test(v.name) ? 6 : 0;
      else {
        const sex = sexOf(v);
        // Reusing a voice (at another pitch) beats casting against the script.
        score += sex === part.sex ? 4 : sex ? -10 : 1;
        const i = part.accents.findIndex(a => langOf(v).toLowerCase() === a.toLowerCase());
        if (i >= 0) score += 3 - 0.5 * i;
        if (GOOD.test(v.name)) score += 2;
        if (PLAIN.test(v.name)) score -= 7;
      }
      if (v.localService) score += 0.5;
      if (!part.offAir) score -= 3 * (used.get(v) ?? 0);
      if (score > bestScore) { bestScore = score; best = v; }
    }
    if (part.offAir) { cast.set(who, { voice: best, pitch: part.pitch, rate: part.rate }); continue; }
    used.set(best, (used.get(best) ?? 0) + 1);
    // Two parts on one voice keep their pitches well apart.
    const taken = pitches.get(best) ?? [];
    let pitch = part.pitch;
    for (let k = 1; k < 9 && taken.some(p => Math.abs(p - pitch) < 0.08); k++) pitch = Math.round((part.pitch + (k % 2 ? -1 : 1) * 0.09 * Math.ceil(k / 2)) * 100) / 100;
    taken.push(pitch);
    pitches.set(best, taken);
    cast.set(who, { voice: best, pitch, rate: part.rate });
  }
  return cast;
}

/* The speaking rate for a line with `room` seconds on screen. */
export function rateFor(text, room, base) {
  const natural = text.length * PER_CHAR;
  return Math.min(1.5, Math.max(base, natural / Math.max(1.5, room)));
}

export function createVoices({ volume = () => 1 } = {}) {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
  let cast = new Map();
  let mission = null, cursor = 0, queue = [], current = null;

  const recast = () => { cast = castVoices(synth.getVoices()); };
  // Not every engine announces its voices: look again when one is needed.
  const partFor = who => { if (!cast.size && synth) recast(); return cast.get(who); };
  if (synth) {
    recast();
    synth.addEventListener?.('voiceschanged', recast);
  }

  function silence() {
    queue = [];
    current = null;
    if (synth && (synth.speaking || synth.pending)) synth.cancel();
  }

  function speak(line) {
    const part = partFor(line.who);
    const level = volume();
    if (!part || !synth || level <= 0) return;
    const u = new SpeechSynthesisUtterance(speakable(line.text));
    u.voice = part.voice;
    u.lang = part.voice.lang;
    u.pitch = part.pitch;
    u.rate = rateFor(u.text, line.dur - 0.3, part.rate);
    u.volume = Math.min(1, level);
    u.onend = u.onerror = () => { if (current === u) current = null; };
    current = u;
    synth.speak(u);
  }

  return {
    get available() { return cast.size > 0; },
    get cast() { return cast; },
    /* Once a frame in flight. Returns how many radio lines appeared this
       frame (each gets the squelch, voiced or not). */
    update(world, paused) {
      const rt = world?.mission;
      if (rt !== mission) { mission = rt; cursor = 0; silence(); }
      if (!rt) return 0;
      if (paused) { silence(); return 0; }
      // Some engines never report the end of a line: trust what they say.
      if (current && synth && !synth.speaking && !synth.pending) current = null;
      const now = rt.time;
      let started = 0;
      while (cursor < rt.radio.length && rt.radio[cursor].at <= now) {
        const line = rt.radio[cursor++];
        started++;
        if (line.who !== 'you') queue.push(line);
      }
      // A line whose time on screen is over is not worth starting.
      while (queue.length && now > queue[0].at + queue[0].dur) queue.shift();
      if (!current && queue.length) speak(queue.shift());
      return started;
    },
    /* Out of flight: read a text in a character's voice, cutting off
       whatever was being said. Sentence by sentence, because some engines
       stop a single long utterance after about fifteen seconds. */
    narrate(who, text) {
      silence();
      const part = partFor(who);
      const level = volume();
      if (!part || !synth || level <= 0 || !text) return;
      const sentences = speakable(text).match(/[^.!?]+[.!?]*["'”’]?\s*/g) ?? [];
      for (const sentence of sentences) {
        const u = new SpeechSynthesisUtterance(sentence.trim());
        Object.assign(u, { voice: part.voice, lang: part.voice.lang, pitch: part.pitch, rate: part.rate, volume: Math.min(1, level) });
        u.onend = u.onerror = () => { if (current === u) current = null; };
        current = u;
        synth.speak(u);
      }
    },
    stop() { silence(); },
  };
}
