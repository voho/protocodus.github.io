/* Historical reference photographs, not depictions of the fictional missions.
   Locally served: no third-party requests or tracking on the loading screen.
   Source records and file checksums: assets/archive/provenance.json. */

export const ARCHIVE_IMAGES = Object.freeze([
  Object.freeze({
    id: 'moving-inland',
    src: 'assets/archive/moving-inland.webp',
    title: 'Beyond the beachhead',
    caption: 'Men of the U.S. 2nd Infantry Division move inland from Omaha Beach, 7 June 1944.',
    credit: 'U.S. Army Signal Corps',
    source: 'https://commons.wikimedia.org/wiki/File:2nd_Infantry_Division,_E-1_draw,_Easy_Red_sector,_Omaha_Beach,_D%2B1,_June_7,_1944.jpg',
    rights: 'Public domain · U.S. government photograph',
    date: '7 June 1944',
    width: 1600,
    height: 1105,
  }),
  Object.freeze({
    id: 'eve-of-d-day',
    src: 'assets/archive/eve-of-d-day.webp',
    title: 'The eve of D-Day',
    caption: 'General Eisenhower meets paratroopers of the 101st Airborne Division at Greenham Common, 5 June 1944.',
    credit: 'U.S. Army · Library of Congress',
    source: 'https://www.loc.gov/item/96522674/',
    rights: 'Public domain · U.S. government photograph',
    date: '5 June 1944',
    width: 1600,
    height: 1244,
  }),
  Object.freeze({
    id: 'omaha-landing',
    src: 'assets/archive/omaha-landing.webp',
    title: 'Into the Jaws of Death',
    caption: 'American troops leave a Coast Guard landing craft at Omaha Beach on the morning of 6 June 1944.',
    credit: 'Robert F. Sargent · U.S. Coast Guard',
    source: 'https://www.archives.gov/research/still-pictures/highlights/into-the-jaws-of-death',
    rights: 'Public domain · U.S. government photograph',
    date: '6 June 1944',
    width: 1600,
    height: 1288,
  }),
]);

const BY_MISSION = Object.freeze({
  'saint-clair': ARCHIVE_IMAGES[0],
  'la-varenne': ARCHIVE_IMAGES[1],
  'pont-tournant': ARCHIVE_IMAGES[2],
});

export function archivalImageForMission(id) {
  return Object.prototype.hasOwnProperty.call(BY_MISSION, id) ? BY_MISSION[id] : ARCHIVE_IMAGES[0];
}
