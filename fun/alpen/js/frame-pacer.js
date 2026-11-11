/* A FAST PANEL IS NOT A REASON TO DRAW MORE. Game code is under a millisecond
   of a frame and the scene is already as cheap as it gets, so what the CPU
   and GPU spend is set by how many frames are drawn: a 144 Hz panel was
   costing 2.4 times what a 60 Hz one does for the same ride. On a panel
   faster than about 116 Hz only every second (third, fourth) refresh is
   drawn, the most that still gives sixty frames a second, and always a whole
   number of refreshes so the pacing stays even.

   The panel's period is learnt from the callbacks, which arrive once a
   refresh whether or not one is drawn. It follows a shorter gap quickly and a
   longer one slowly, so a hitch does not read as a slower panel, while a GPU
   that cannot keep up stretches every gap and lifts the cap by itself. The
   skip is judged against the clock, not counted, so a refresh the browser
   dropped is not waited out a second time.

   `frameMs` is the longest a drawn frame may be asked to last. The returned
   function takes this callback's time and the time of the last drawn frame
   (0 before the first) and says whether to skip drawing this one. */
export function createFramePacer(frameMs) {
  let lastCallback = 0;
  let refreshMs = 1000 / 60;
  return (now, lastDrawn) => {
    const gap = now - lastCallback;
    lastCallback = now;
    if (gap > 0 && gap < 50) refreshMs += (gap - refreshMs) * (gap < refreshMs ? 0.2 : 0.02);
    const every = Math.floor(frameMs / refreshMs);
    return every > 1 && lastDrawn > 0 && now - lastDrawn < (every - 0.5) * refreshMs;
  };
}
