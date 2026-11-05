/* Puzzle Box — picks Zipper or Patcher, strips the other game's words from
   the shared chrome and starts the picked one. Switching reloads the page
   (?game=…): each game wires the same HUD for the life of the page. */
const GAMES = {
  zipper: { label: 'Zipper board. Arrow keys draw the line, Backspace takes it back.' },
  patcher: { label: 'Patcher board. Arrow keys move, Enter starts and places a patch, X lifts one.' },
};
const read = () => { try { return localStorage.getItem('puzzles-game'); } catch { return null; } };
const store = (value) => { try { localStorage.setItem('puzzles-game', value); } catch { /* private mode */ } };

const asked = new URLSearchParams(location.search).get('game');
const game = GAMES[asked] ? asked : GAMES[read()] ? read() : 'zipper';
store(game);

document.documentElement.dataset.game = game;
for (const node of document.querySelectorAll('[data-only]')) if (node.dataset.only !== game) node.remove();
for (const dialog of document.querySelectorAll('dialog')) dialog.setAttribute('aria-labelledby', dialog.querySelector('h2').id);
document.getElementById('stage').setAttribute('aria-label', GAMES[game].label);
for (const link of document.querySelectorAll('[data-game-link]')) {
  if (link.dataset.gameLink !== game) continue;
  link.setAttribute('aria-current', 'page');
  // A tap on the game already open must not throw away the board.
  link.addEventListener('click', (event) => event.preventDefault());
}

await import(`../../${game}/js/main.js`);
