// Open a construction area through its toolbar button without toggling an already-open drawer.
export async function openBuildArea(page, area = 'network') {
  const button = page.locator(`.main-nav [data-build-area="${area}"]`);
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
  await page.locator('.sidebar').evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
}

// Choose roads, rails and stops through Network; demolition remains a global action.
export async function chooseBuildTool(page, tool, area = 'network') {
  if (tool === 'bulldoze') return page.locator('.topbar [data-toolbar-tool="bulldoze"]').click();
  await openBuildArea(page, area);
  await page.locator(`#panel-content [data-tool="${tool}"]`).click();
}
