export const LOCATIONS = Object.freeze({
  prague: Object.freeze({
    id: 'prague',
    name: 'Praha',
    over: 'Nad Prahou',
    from: 'z Prahy',
    country: 'Česko',
    zone: 'SELČ',
    utcOffset: 2,
    latitude: 50.0755,
    longitude: 14.4378,
    start: 19 * 60 + 19 + 22 / 60,
    maximum: 20 * 60 + 11 + 50 / 60,
    end: 20 * 60 + 26 + 28 / 60,
    geometricEnd: 21 * 60 + 2,
    maxCoverage: 0.863,
    magnitude: 0.885,
    moonRadius: 1.032,
    kind: 'partial',
    endKind: 'sunset',
    startAltitude: 9.4,
    maximumAltitude: 1.3,
    endAltitude: 0,
    marker: [2.48, 1.72],
  }),
  brno: Object.freeze({
    id: 'brno',
    name: 'Brno',
    over: 'Nad Brnem',
    from: 'z Brna',
    country: 'Česko',
    zone: 'SELČ',
    utcOffset: 2,
    latitude: 49.1951,
    longitude: 16.6068,
    start: 19 * 60 + 20 + 23.6 / 60,
    maximum: 20 * 60 + 12 + 13.3 / 60,
    end: 20 * 60 + 15 + 21.6 / 60,
    geometricEnd: 21 * 60 + 2,
    maxCoverage: 0.864,
    magnitude: 0.887,
    moonRadius: 1.032,
    kind: 'partial',
    endKind: 'sunset',
    startAltitude: 7.7,
    maximumAltitude: -0.4,
    endAltitude: -0.8,
    marker: [2.44, 1.87],
  }),
  ostrava: Object.freeze({
    id: 'ostrava',
    name: 'Ostrava',
    over: 'Nad Ostravou',
    from: 'z Ostravy',
    country: 'Česko',
    zone: 'SELČ',
    utcOffset: 2,
    latitude: 49.8209,
    longitude: 18.2625,
    start: 19 * 60 + 19 + 2.7 / 60,
    maximum: 20 * 60 + 12,
    end: 20 * 60 + 10 + 29 / 60,
    geometricEnd: 21 * 60 + 2,
    maxCoverage: 0.855,
    magnitude: 0.88,
    moonRadius: 1.032,
    kind: 'partial',
    endKind: 'sunset',
    startAltitude: 7,
    maximumAltitude: -0.7,
    endAltitude: 0,
    marker: [2.47, 1.99],
  }),
  reykjavik: Object.freeze({
    id: 'reykjavik',
    name: 'Reykjavík',
    over: 'Nad Reykjavíkem',
    from: 'z Reykjavíku',
    country: 'Island',
    zone: 'GMT',
    utcOffset: 0,
    latitude: 64.1466,
    longitude: -21.9426,
    start: 16 * 60 + 47 + 9.8 / 60,
    maximum: 17 * 60 + 48 + 42.3 / 60,
    end: 18 * 60 + 47 + 34.4 / 60,
    geometricEnd: 18 * 60 + 47 + 34.4 / 60,
    totalityStart: 17 * 60 + 48 + 11 / 60,
    totalityEnd: 17 * 60 + 49 + 15.5 / 60,
    maxCoverage: 1,
    magnitude: 1.002,
    moonRadius: 1.028,
    kind: 'total',
    endKind: 'contact',
    startAltitude: 30.6,
    maximumAltitude: 24.5,
    endAltitude: 18.2,
    marker: [2.73, -0.15],
  }),
  madrid: Object.freeze({
    id: 'madrid',
    name: 'Madrid',
    over: 'Nad Madridem',
    from: 'z Madridu',
    country: 'Španělsko',
    zone: 'SELČ',
    utcOffset: 2,
    latitude: 40.4168,
    longitude: -3.7038,
    start: 19 * 60 + 36 + 42.4 / 60,
    maximum: 20 * 60 + 32 + 18.5 / 60,
    end: 21 * 60 + 16 + 24 / 60,
    geometricEnd: 21 * 60 + 30,
    maxCoverage: 0.999,
    magnitude: 0.999,
    moonRadius: 1.038,
    kind: 'partial',
    endKind: 'sunset',
    startAltitude: 17.7,
    maximumAltitude: 7.2,
    endAltitude: 0,
    marker: [1.9, 1.15],
  }),
  newyork: Object.freeze({
    id: 'newyork',
    name: 'New York',
    over: 'Nad New Yorkem',
    from: 'z New Yorku',
    country: 'USA',
    zone: 'EDT',
    utcOffset: -4,
    latitude: 40.7128,
    longitude: -74.006,
    start: 13 * 60 + 7 + 43.9 / 60,
    maximum: 13 * 60 + 54 + 7 / 60,
    end: 14 * 60 + 38 + 45.2 / 60,
    geometricEnd: 14 * 60 + 38 + 45.2 / 60,
    maxCoverage: 0.094,
    magnitude: 0.186,
    moonRadius: 1.033,
    kind: 'partial',
    endKind: 'contact',
    startAltitude: 64.1,
    maximumAltitude: 61.6,
    endAltitude: 56.5,
    marker: [1.9, -2.4],
  }),
  sydney: Object.freeze({
    id: 'sydney',
    name: 'Sydney',
    over: 'Nad Sydney',
    from: 'ze Sydney',
    country: 'Austrálie',
    zone: 'AEST',
    utcOffset: 10,
    latitude: -33.8688,
    longitude: 151.2093,
    start: 25 * 60 + 34,
    maximum: 27 * 60 + 46,
    end: 29 * 60 + 58,
    geometricEnd: 29 * 60 + 58,
    maxCoverage: 0,
    magnitude: 0,
    moonRadius: 1.03,
    kind: 'none',
    endKind: 'contact',
    startAltitude: -35,
    maximumAltitude: -48,
    endAltitude: -30,
    marker: [-2.4, 1.9],
    farSide: true,
  }),
});

export const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
export const lerp = (a, b, amount) => a + (b - a) * amount;

export function circleOverlapFraction(distance, sunRadius = 1, moonRadius = 1) {
  const d = Math.max(0, distance);
  const sum = sunRadius + moonRadius;
  const difference = Math.abs(sunRadius - moonRadius);
  const epsilon = Number.EPSILON * 8;

  if (d >= sum - epsilon) return 0;
  if (d <= difference + epsilon) {
    return Math.min(1, (Math.PI * Math.min(sunRadius, moonRadius) ** 2)
      / (Math.PI * sunRadius ** 2));
  }

  const sunAngle = Math.acos(clamp(
    (d ** 2 + sunRadius ** 2 - moonRadius ** 2) / (2 * d * sunRadius), -1, 1,
  ));
  const moonAngle = Math.acos(clamp(
    (d ** 2 + moonRadius ** 2 - sunRadius ** 2) / (2 * d * moonRadius), -1, 1,
  ));
  const lens = 0.5 * Math.sqrt(Math.max(0,
    (-d + sunRadius + moonRadius)
    * (d + sunRadius - moonRadius)
    * (d - sunRadius + moonRadius)
    * (d + sunRadius + moonRadius),
  ));
  const overlap = sunRadius ** 2 * sunAngle + moonRadius ** 2 * moonAngle - lens;
  return clamp(overlap / (Math.PI * sunRadius ** 2));
}

export function separationForCoverage(coverage, sunRadius = 1, moonRadius = 1) {
  const target = clamp(coverage);
  let near = 0;
  let far = sunRadius + moonRadius;

  for (let i = 0; i < 60; i += 1) {
    const middle = (near + far) / 2;
    if (circleOverlapFraction(middle, sunRadius, moonRadius) > target) near = middle;
    else far = middle;
  }
  return (near + far) / 2;
}

export function eclipseStateAt(location, progress) {
  const p = clamp(progress);
  const minutes = lerp(location.start, location.end, p);
  const maximumSeparation = location.kind === 'total'
    ? clamp(1 + location.moonRadius - 2 * location.magnitude, 0, location.moonRadius - 1)
    : separationForCoverage(location.maxCoverage, 1, location.moonRadius);
  const contactSeparation = 1 + location.moonRadius;
  const horizontalAtContact = Math.sqrt(Math.max(0,
    contactSeparation ** 2 - maximumSeparation ** 2,
  ));

  let offsetX;
  if (location.kind === 'total') {
    const totalitySeparation = location.moonRadius - 1;
    const horizontalAtTotality = Math.sqrt(Math.max(0,
      totalitySeparation ** 2 - maximumSeparation ** 2,
    ));
    if (minutes <= location.totalityStart) {
      offsetX = lerp(-horizontalAtContact, -horizontalAtTotality,
        (minutes - location.start) / Math.max(1, location.totalityStart - location.start));
    } else if (minutes <= location.maximum) {
      offsetX = lerp(-horizontalAtTotality, 0,
        (minutes - location.totalityStart) / Math.max(1 / 60, location.maximum - location.totalityStart));
    } else if (minutes <= location.totalityEnd) {
      offsetX = lerp(0, horizontalAtTotality,
        (minutes - location.maximum) / Math.max(1 / 60, location.totalityEnd - location.maximum));
    } else {
      offsetX = lerp(horizontalAtTotality, horizontalAtContact,
        (minutes - location.totalityEnd) / Math.max(1, location.end - location.totalityEnd));
    }
  } else if (minutes <= location.maximum) {
    const before = Math.max(1, location.maximum - location.start);
    offsetX = -horizontalAtContact * (location.maximum - minutes) / before;
  } else {
    const after = Math.max(1, location.geometricEnd - location.maximum);
    offsetX = horizontalAtContact * (minutes - location.maximum) / after;
  }

  const separation = Math.hypot(offsetX, maximumSeparation);
  const coverage = circleOverlapFraction(separation, 1, location.moonRadius);
  const maxProgress = (location.maximum - location.start) / (location.end - location.start);
  const altitude = minutes <= location.maximum
    ? lerp(location.startAltitude, location.maximumAltitude,
      (minutes - location.start) / Math.max(1, location.maximum - location.start))
    : lerp(location.maximumAltitude, location.endAltitude,
      (minutes - location.maximum) / Math.max(1, location.end - location.maximum));

  return {
    progress: p,
    minutes,
    offsetX,
    offsetY: -maximumSeparation,
    separation,
    coverage,
    altitude,
    maxProgress,
  };
}

export function phaseAt(location, state) {
  if (location.kind === 'none') return 'Noc · zatmění není vidět';
  const minute = state.minutes;
  if (Math.abs(minute - location.start) < 0.35) return 'První kontakt';
  if (location.totalityStart != null
    && minute >= location.totalityStart && minute <= location.totalityEnd) return 'Úplné zatmění';
  if (Math.abs(minute - location.maximum) < 0.55) return 'Maximum zatmění';
  if (state.progress >= 0.999) return location.endKind === 'sunset' ? 'Západ · pozorování končí' : 'Poslední kontakt';
  return minute < location.maximum ? 'Měsíc zakrývá Slunce' : 'Měsíc ustupuje';
}

export function chapterAt(location, progress) {
  const maxProgress = (location.maximum - location.start) / (location.end - location.start);
  if (progress < maxProgress * 0.3) return 0;
  if (progress < maxProgress * 0.62) return 1;
  if (progress < maxProgress * 0.9) return 2;
  return 3;
}

export function chapterStart(location, chapter) {
  const maxProgress = (location.maximum - location.start) / (location.end - location.start);
  return [0, maxProgress * 0.31, maxProgress * 0.63, maxProgress * 0.91][clamp(chapter, 0, 3)];
}

export function formatClock(minutes) {
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60) % 24;
  const mins = rounded % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}
