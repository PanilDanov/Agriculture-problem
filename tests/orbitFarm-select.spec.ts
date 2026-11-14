import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/(?:[abc]\.)?tile\.openstreetmap\.org\//, (route) => route.abort());
  await page.goto('/#/setup');
  // Wait for the lazy map to occupy its final space before measuring or dragging menus.
  await expect(page.getByTestId('boundary-map')).toBeVisible();
});

async function expectMenuInViewport(page: Page) {
  const menu = page.getByRole('listbox');
  await expect(menu).toBeVisible();
  // Resize events and React's positioning render may finish just after setViewportSize.
  await expect(async () => {
    const bounds = await menu.boundingBox();
    const viewport = page.viewportSize()!;
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(11);
    expect(bounds!.y).toBeGreaterThanOrEqual(11);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width - 11);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height - 11);
  }).toPass({ timeout: 2000 });
}

test('custom selects support keyboard navigation, typeahead, selection, and dismissal', async ({ page }) => {
  const texture = page.getByRole('combobox', { name: 'Soil texture', exact: true });
  await texture.focus();
  await texture.press('ArrowDown');
  await expect(texture).toHaveAttribute('aria-expanded', 'true');
  await texture.press('End');
  await texture.press('Enter');
  await expect(texture).toHaveText('clay');
  await expect(texture).toBeFocused();
  await expect(page.getByRole('listbox')).toHaveCount(0);

  await texture.press('s');
  await texture.press('i');
  await texture.press('l');
  await texture.press('t');
  await texture.press('Enter');
  await expect(texture).toHaveText('silt loam');
  await texture.press('Home');
  await texture.press('Escape');
  await expect(texture).toHaveText('silt loam');
  await expect(texture).toHaveAttribute('aria-expanded', 'false');
  await texture.press('Space');
  await texture.press('Tab');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Irrigation access', exact: true })).toBeFocused();

  await texture.click();
  await page.getByRole('heading', { name: 'Field details', exact: true }).click();
  await expect(texture).toHaveAttribute('aria-expanded', 'false');
  await texture.press('s');
  await texture.press('s');
  await texture.press('Enter');
  await expect(texture).toHaveText('sandy clay loam');
  await expect(page.locator('select')).toHaveCount(0);
});

test('custom menu flips above an edge and closes when its field scrolls out of view', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 900, height: 520 });
  const texture = page.getByRole('combobox', { name: 'Soil texture', exact: true });
  await texture.scrollIntoViewIfNeeded();
  await texture.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    window.scrollBy(0, bounds.bottom - window.innerHeight + 35);
  });
  await texture.click();
  await expect(page.getByRole('listbox')).toHaveAttribute('data-side', 'top');
  await expectMenuInViewport(page);
  await page.screenshot({ path: testInfo.outputPath('orbitFarm-select-desktop.png'), fullPage: true, animations: 'disabled' });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByRole('listbox')).toHaveCount(0);
});

test('@mobile custom menus stay inside narrow viewports and remain usable after resize', async ({ page }, testInfo) => {
  const texture = page.getByRole('combobox', { name: 'Soil texture', exact: true });
  await texture.tap();
  await expectMenuInViewport(page);
  await page.screenshot({ path: testInfo.outputPath('orbitFarm-select-mobile.png'), animations: 'disabled' });
  // Exercise a real touch pan, rather than scrolling the element from JavaScript.
  const bounds = (await page.getByRole('listbox').boundingBox())!;
  const session = await page.context().newCDPSession(page);
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height - 25;
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let distance = 24; distance <= 144; distance += 24) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - distance }] });
    await page.waitForTimeout(20);
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.getByRole('listbox').evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await session.detach();
  await page.getByRole('option', { name: 'silty clay loam', exact: true }).tap();
  await expect(texture).toHaveText('silty clay loam');

  const irrigation = page.getByRole('combobox', { name: 'Irrigation access', exact: true });
  await irrigation.tap();
  await expectMenuInViewport(page);
  await page.setViewportSize({ width: 320, height: 568 });
  // Responsive reflow may move this field offscreen; that must dismiss its menu.
  await expect(async () => {
    const bounds = (await irrigation.boundingBox())!;
    const offscreen = bounds.y + bounds.height <= 0 || bounds.y >= page.viewportSize()!.height;
    await expect(irrigation).toHaveAttribute('aria-expanded', offscreen ? 'false' : 'true');
    if (!offscreen) await expectMenuInViewport(page);
  }).toPass({ timeout: 2000 });
  if (await irrigation.getAttribute('aria-expanded') === 'false') await irrigation.tap();
  await expectMenuInViewport(page);
  await page.getByRole('option', { name: 'Available', exact: true }).tap();
  await expect(page.getByRole('combobox', { name: 'Irrigation method', exact: true })).toBeVisible();

  // Use an earlier field so the shorter form can keep the anchor visible after resize.
  await page.setViewportSize({ width: 390, height: 844 });
  await texture.evaluate((element) => window.scrollBy(0, element.getBoundingClientRect().top - 100));
  await texture.tap();
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(async () => {
    const bounds = (await texture.boundingBox())!;
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(568);
    await expect(texture).toHaveAttribute('aria-expanded', 'true');
    await expectMenuInViewport(page);
  }).toPass({ timeout: 2000 });
  await page.getByRole('option', { name: 'clay', exact: true }).tap();
  await expect(texture).toHaveText('clay');
  const widths = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport);
});
