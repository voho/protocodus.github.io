export function createInstrumentAudio({ baseUrl, processor, instrument, accelerator, scalarAccelerator, minimumRate, preferredRate, configure, releaseAll }) {
  const startButton = document.querySelector('#audio-start');
  const status = document.querySelector('#audio-status');
  let session = null;

  function showAudio(label, message, active = false) {
    startButton.textContent = label;
    startButton.setAttribute('aria-pressed', String(active));
    status.textContent = message;
  }

  function send(event) {
    if (session?.ready) session.node.port.postMessage(event);
  }

  function stopAudio(message = 'Audio stopped') {
    const previous = session;
    session = null;
    delete status.dataset.renderer;
    releaseAll();
    if (previous) {
      previous.context.onstatechange = null;
      previous.node?.port.close();
      previous.node?.disconnect();
      previous.context.close().catch(() => {});
    }
    showAudio('Start audio', message);
  }

  function updateState(current) {
    if (session !== current || !current.ready) return;
    if (current.context.state === 'running') {
      showAudio('Stop audio', 'Audio on', true);
    } else {
      releaseAll();
      showAudio('Resume audio', 'Audio paused');
    }
  }

  // A minimal module returning i8x16.splat(0) tests SIMD without fetching the engine.
  const simdProbe = Uint8Array.of(0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,8,1,6,0,65,0,253,15,11);
  const wasmProbe = Uint8Array.of(0,97,115,109,1,0,0,0);
  const renderers = [
    { suffix: '-simd', path: accelerator, probe: simdProbe },
    ...(scalarAccelerator ? [{ suffix: '-scalar', path: scalarAccelerator, probe: wasmProbe }] : []),
    { suffix: '' }
  ];

  async function loadProcessor(current, index = 0) {
    if (session !== current) return;
    const context = current.context;
    const renderer = renderers[index];
    try {
      if (!context.audioWorklet) throw new Error('AudioWorklet unavailable');
      let node;
      try {
        if (renderer.path && !renderer.module) {
          if (!globalThis.WebAssembly?.validate(renderer.probe)) return loadProcessor(current, index + 1);
          const response = await fetch(new URL(renderer.path, baseUrl));
          if (!response.ok) throw new Error('Could not load the audio accelerator');
          renderer.module = await WebAssembly.compile(await response.arrayBuffer());
        }
        if (session !== current) return;
        await context.audioWorklet.addModule(new URL('./processor' + renderer.suffix + '.js', baseUrl));
        if (session !== current) return;
        node = new AudioWorkletNode(context, processor + renderer.suffix, {
          numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
          processorOptions: renderer.module ? { module: renderer.module } : {}
        });
      } catch (error) {
        if (renderer.path) return loadProcessor(current, index + 1);
        throw error;
      }
      current.node = node;
      node.onprocessorerror = () => {
        if (session !== current || current.node !== node) return;
        if (renderer.path && !current.ready) {
          node.port.close();
          node.disconnect();
          current.node = null;
          void loadProcessor(current, index + 1);
        } else {
          stopAudio('The audio engine stopped. Start audio to try again.');
        }
      };
      node.port.onmessage = ({ data }) => {
        if (session !== current || current.node !== node || data.type !== 'ready') return;
        status.dataset.renderer = data.renderer;
        // Preserve a quick first press and release across the worklet download.
        // Bound replay time so the console catches up promptly even on a slow link.
        const events = current.events;
        if (events.length) {
          const first = events[0].time;
          const scale = Math.min(1, 160 / Math.max(1, events[events.length - 1].time - first));
          for (const event of events) event.delayMs = (event.time - first) * scale;
        }
        node.port.postMessage(configure(events));
        current.ready = true;
        current.events = [];
        updateState(current);
      };
      node.connect(context.destination);
    } catch (error) {
      if (session !== current) return;
      console.error(processor + ' audio initialization failed', error);
      stopAudio('Audio could not start. Use a browser with Web Audio on HTTPS or localhost, then retry.');
    }
  }

  function startAudio() {
    if (!session) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context || !window.isSecureContext) {
        showAudio('Start audio', 'Web Audio requires a compatible browser on HTTPS or localhost.');
        return;
      }
      try {
        let context;
        try {
          context = new Context({ latencyHint: 'interactive', ...(preferredRate ? { sampleRate: preferredRate } : {}) });
        } catch (error) {
          if (!preferredRate || error.name !== 'NotSupportedError') throw error;
          context = new Context({ latencyHint: 'interactive' });
        }
        if (context.sampleRate < minimumRate || context.sampleRate > 192000) {
          void context.close();
          showAudio('Start audio', 'Choose an audio device running at ' + minimumRate / 1000 + '–192 kHz.');
          return;
        }
        const current = session = { context, node: null, ready: false, events: [] };
        context.onstatechange = () => updateState(current);
        showAudio('Starting…', 'Loading ' + instrument);
        void loadProcessor(current);
      } catch {
        showAudio('Start audio', 'The audio device could not open. Check your output device and retry.');
        return;
      }
    }
    // Resume inside the originating pointer/key gesture, before awaiting any module.
    const current = session;
    if (current && current.context.state !== 'running') {
      current.context.resume().catch(() => {
        if (session === current) stopAudio('Audio paused. Press Start audio to try again.');
      });
    }
  }

  function perform(event) {
    if ((event.type === 'noteOn' || event.type === 'divisionNoteOn') && (!session || session.context.state !== 'running')) startAudio();
    if (!session) return;
    if (session.ready) send(event);
    else session.events.push({ ...event, time: performance.now() });
  }

  function panic() {
    if (session) session.events = [];
    send({ type: 'panic' });
  }

  startButton.addEventListener('click', () => {
    if (session?.ready && session.context.state === 'running') stopAudio();
    else startAudio();
  });
  window.addEventListener('pagehide', () => stopAudio());

  return { startAudio, send, perform, panic };
}
