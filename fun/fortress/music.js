// Hold the compressed recordings for this session. The media element decodes only
// the portion it is playing, and changing tracks never requires the network.
const tracks = ['fingers-of-grey', 'blood-on-the-rampart', 'before-the-iron-gate'];

export function createMusic(player) {
  let playlist = [];
  let index = 0;
  let activated = false;
  let enabled = false;
  let paused = false;
  let preparing;

  function sync() {
    if (!enabled || !activated || paused || !playlist.length) {
      player.pause();
      return;
    }
    if (player.paused) player.play().catch(() => {});
  }

  player.addEventListener('ended', () => {
    if (!playlist.length) return;
    index = (index + 1) % playlist.length;
    player.src = playlist[index];
    sync();
  });

  return {
    prepare() {
      if (!preparing) {
        preparing = Promise.all(
          tracks.map(async (name) => {
            try {
              const response = await fetch(new URL('./assets/music/' + name + '.mp3', import.meta.url));
              if (!response.ok) return null;
              return URL.createObjectURL(await response.blob());
            } catch {
              return null;
            }
          }),
        ).then((urls) => {
          playlist = urls.filter(Boolean);
          if (playlist.length) player.src = playlist[0];
        });
      }
      return preparing;
    },
    enable(value) {
      enabled = value;
      sync();
    },
    activate() {
      activated = true;
      sync();
    },
    pause(value) {
      paused = value;
      sync();
    },
  };
}
