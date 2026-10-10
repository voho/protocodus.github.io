// Renders sound-bank recipes off the main thread; audio.js turns the returned samples into AudioBuffers.
import { renderKind, renderVoice } from './soundbank.js';
self.onmessage = ({ data: { id, name, variant, voice } }) => {
  try {
    const samples = voice ? renderVoice(name, variant) : renderKind(name, variant);
    self.postMessage({ id, samples }, [samples.buffer]);
  } catch (error) { self.postMessage({ id, error: error.message }); }
};
