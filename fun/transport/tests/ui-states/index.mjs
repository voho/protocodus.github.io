// Every UI harness state, surface by surface. tools/ui-snapshot.mjs and ui-system-browser-check.mjs run them all.
import { states as hud } from './hud.mjs';
import { states as build } from './build.mjs';
import { states as routes } from './routes.mjs';
import { states as places } from './places.mjs';
import { states as notices } from './notices.mjs';
import { states as dialogs } from './dialogs.mjs';

export const surfaces = { hud, build, routes, places, notices, dialogs };
export const states = Object.entries(surfaces).flatMap(([surface, list]) => list.map(state => ({ ...state, surface })));
