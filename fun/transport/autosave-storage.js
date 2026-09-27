import { SAVE_KEY } from './model.js';
import { preparedSave } from './background-jobs.js';

// A worker has already validated and encoded this newly opened world. Commit
// atomically, only after the player has finished creating or loading it.
export function savePreparedGame(game) {
  try {
    const serialized=preparedSave(game);
    if(!serialized)throw new Error('The prepared save is unavailable.');
    localStorage.setItem(SAVE_KEY,serialized);
    return {ok:true};
  } catch { return {ok:false,message:'Could not save this world. Free some browser storage and try again. Existing saves are unchanged.'}; }
}
