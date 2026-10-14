/* Native video controls work without this optional chapter navigation. */
(() => {
  'use strict';

  const video = document.getElementById('lamer-video');
  const chapters = document.querySelector('.lamer-chapters');
  const status = document.querySelector('.lamer-video-status');
  if (!video || !chapters || !status) return;

  const buttons = [...chapters.querySelectorAll('button[data-start]')];
  let pendingStart = null;

  const showStatus = (message) => {
    status.textContent = message;
    status.hidden = !message;
  };
  const updateChapter = () => {
    const active = buttons.findLast((button) => Number(button.dataset.start) <= video.currentTime);
    buttons.forEach((button) => {
      if (button === active) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    });
  };

  video.addEventListener('loadedmetadata', () => {
    if (pendingStart !== null) {
      video.currentTime = pendingStart;
      pendingStart = null;
    }
  });
  video.addEventListener('timeupdate', updateChapter);
  video.addEventListener('error', () => showStatus('The video could not load. Try the direct video link below.'));

  buttons.forEach((button) => button.addEventListener('click', () => {
    showStatus('');
    const start = Number(button.dataset.start);
    if (video.readyState >= 1) video.currentTime = start;
    else pendingStart = start;
    video.play().catch((error) => {
      if (error.name !== 'AbortError') showStatus('Press Play on the video to start this chapter.');
    });
  }));

  chapters.hidden = false;
})();
