/* Authored daylight, shared by the sky dome, environment capture, global
   light and scene/particle fog. The legacy overcast profile is exact; only
   missions which opt in (currently Prague at first light) use another.
   Local lamps, muzzle flashes, shadows and the night mode are unchanged. */

function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

export const LIGHTING_PROFILES = freeze({
  overcast: {
    id: 'overcast', fog: '#aab6be', exposure: 1.15,
    sky: { zenith: '#94a5b8', horizon: '#bdc8cf', glow: '#000000', glowAzimuth: 1.0,
      cloudCover: 1, front: 0, nightGlow: 0.05 },
    lights: {
      hemi: { sky: '#c6d2df', ground: '#6d7569', intensity: 2.8 },
      key: { color: '#fff1d9', intensity: 2.2, offset: [60, 85, 30], relative: false },
      rim: { color: '#b7c7d6', intensity: 0.6, position: [30, 40, -40] },
    },
  },
  'prague-dawn': {
    id: 'prague-dawn', fog: '#a6adb1', exposure: 1.23,
    sky: { zenith: '#7c8fa5', horizon: '#bdc0bc', glow: '#725b4d', glowAzimuth: -1.13,
      cloudCover: 0.78, front: 0, nightGlow: 0.07 },
    lights: {
      hemi: { sky: '#adb9c9', ground: '#6d665d', intensity: 2.9 },
      // A restrained warm edge from east-north-east, with the diffuse sky
      // carrying most of the scene. Relative placement keeps this low key
      // angle constant as the long avenue climbs away from the river.
      key: { color: '#edc5a0', intensity: 1.35, offset: [-75, 18, 35], relative: true },
      rim: { color: '#9eafc4', intensity: 0.48, position: [35, 48, -55] },
    },
  },
});

export function resolveLightingProfile(profile = null) {
  if (profile && typeof profile === 'object' && profile.sky && profile.lights && profile.fog) return profile;
  return typeof profile === 'string' && Object.hasOwn(LIGHTING_PROFILES, profile)
    ? LIGHTING_PROFILES[profile] : LIGHTING_PROFILES.overcast;
}

export function lightingProfileFor(level = {}) {
  return resolveLightingProfile(level.lightingProfile ?? (level.id === 'prague' ? 'prague-dawn' : 'overcast'));
}
