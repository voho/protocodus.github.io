// Open a construction area through its toolbar button without toggling an already-open drawer.
export async function openBuildArea(page, area = 'network') {
  const button = page.locator(`.main-nav [data-build-area="${area}"]`);
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
  await page.locator('.sidebar').evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
}
