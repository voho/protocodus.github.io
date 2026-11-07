/* Authored daylight, shared by the sky dome, environment capture, global
   light and scene/particle fog. The legacy overcast profile is exact;
   missions may opt into a custom profile.
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
});

export function resolveLightingProfile(profile = null) {
  if (profile && typeof profile === 'object' && profile.sky && profile.lights && profile.fog) return profile;
  return typeof profile === 'string' && Object.hasOwn(LIGHTING_PROFILES, profile)
    ? LIGHTING_PROFILES[profile] : LIGHTING_PROFILES.overcast;
}

export function lightingProfileFor(level = {}) {
  return resolveLightingProfile(level.lightingProfile);
}
