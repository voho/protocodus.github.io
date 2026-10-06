// Transport is a computer game. A narrow browser window is still supported;
// phones and devices with only a coarse touch pointer stop before game startup.
export function requiresComputer() {
  return navigator.userAgentData?.mobile === true
    || /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(navigator.userAgent)
    || (matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches);
}

export function showComputerRequired() {
  document.querySelector('#loading-screen').remove();
  document.querySelector('#app').remove();
  document.querySelector('#startup-preloads').remove();
  document.querySelector('#computer-required').hidden = false;
}
