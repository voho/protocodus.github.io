export const MIN_GAME_VIEWPORT = Object.freeze({ width: 768, height: 540 });

// A phone in landscape or with a mouse attached is still a phone. Tablets
// keep the desktop controls and need a keyboard and mouse to play.
export function gameDeviceSupport({ width, height, screenWidth = width, screenHeight = height,
  userAgent = '', mobileHint = false, coarsePointer = false, touchPoints = 0 } = {}) {
  const shortScreen = Math.min(screenWidth, screenHeight);
  const phone = mobileHint === true || /iPhone|iPod|Windows Phone|Android[^\n]*Mobile/i.test(userAgent)
    || (coarsePointer && touchPoints > 0 && shortScreen > 0 && shortScreen < 600);
  if (phone) return { supported: false, reason: 'phone' };
  if (!(width >= MIN_GAME_VIEWPORT.width && height >= MIN_GAME_VIEWPORT.height)) return { supported: false, reason: 'window' };
  return { supported: true, reason: null };
}

export function currentDeviceSupport() {
  return gameDeviceSupport({ width: window.innerWidth, height: window.innerHeight,
    screenWidth: window.screen.width, screenHeight: window.screen.height,
    userAgent: navigator.userAgent, mobileHint: navigator.userAgentData?.mobile,
    coarsePointer: window.matchMedia('(any-pointer: coarse)').matches, touchPoints: navigator.maxTouchPoints });
}
