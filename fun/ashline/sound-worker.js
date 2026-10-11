// Renders sound-bank recipes and the reverb impulse off the main thread; audio.js turns the returned samples
// into AudioBuffers.
import { renderKind, renderVoice, renderImpulse } from './soundbank.js';
self.onmessage = ({ data: { id, name, variant, voice, impulse, seconds } }) => {
  try {
    if (impulse) { const channels = renderImpulse(variant, seconds); self.postMessage({ id, channels }, channels.map(data => data.buffer)); return; }
    const samples = voice ? renderVoice(name, variant) : renderKind(name, variant);
    self.postMessage({ id, samples }, [samples.buffer]);
  } catch (error) { self.postMessage({ id, error: error.message }); }
};
