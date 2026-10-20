// Existing gameplay scenarios use a stable setup; product defaults deliberately randomize every choice.
// Only resolve untouched Random controls, preserving each scenario's explicit selections.
export async function prepareSkirmish(page) {
  const defaults = {
    'player-race': 'organics', 'enemy-race': 'aiUnity', difficulty: 'normal',
    'map-size': 'expanse', 'map-profile': 'rift', environment: 'ash', 'skirmish-mode': 'annihilation',
  };
  for (const [id, value] of Object.entries(defaults)) {
    const select = page.locator(`#${id}`);
    if (await select.inputValue() === 'random') await select.selectOption(value);
  }
}
