/* Hedgerow — the missions. Each is a level module (levels/*.js), loaded when
   it is the one played: the page builds one battlefield at a time, so
   choosing another mission reloads the page with ?mission=<id>. The image is
   shown while the battlefield is not there to be seen (loading, a reload). */

export const MISSIONS = [
  {
    id: 'saint-clair', title: 'Saint-Clair', place: 'Normandy · July 1944', time: 'Dusk, rain',
    subtitle: 'Saint-Clair, at dusk', image: 'hedgerow-card.webp',
    summary: 'Push alone through a hedgerow village, over the river and through a fortified wood to a flak gun.',
    inspired: 'Inspired by the hedgerow fighting round Saint-Lô, July 1944.',
    load: () => import('./levels/saint-clair.js'),
  },
  {
    id: 'la-varenne', title: 'La Varenne', place: 'Normandy · 6 June 1944', time: 'Morning, drizzle',
    subtitle: 'The guns at La Varenne', image: 'assets/missions/la-varenne.webp',
    summary: 'Scattered paratroopers against a battery of guns shelling the beach causeway, dug in along a hedgerow.',
    inspired: 'Inspired by the D-Day morning assaults on German gun batteries behind the beaches.',
    load: () => import('./levels/la-varenne.js'),
  },
  {
    id: 'pont-tournant', title: 'Pont-Tournant', place: 'Normandy · 6 June 1944', time: 'Night, wind and rain',
    subtitle: 'The bridge at Pont-Tournant', image: 'assets/missions/pont-tournant.webp',
    summary: 'A glider lands short of a canal bridge after midnight. Take the bridge before it can be blown, then hold it.',
    inspired: 'Inspired by the glider-borne coups de main on the canal and river bridges in the first minutes of D-Day.',
    load: () => import('./levels/pont-tournant.js'),
  },
];

/* the mission asked for in the URL, else the last one chosen, else the first */
export function pickMission(asked, stored) {
  return MISSIONS.find((m) => m.id === asked) || MISSIONS.find((m) => m.id === stored) || MISSIONS[0];
}

/* the best score kept for a mission (the first mission's from before there were others included) */
export function bestKey(id) { return id === MISSIONS[0].id ? 'hedgerow.best' : `hedgerow.best.${id}`; }
