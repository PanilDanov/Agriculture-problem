import { createHash } from 'node:crypto';
import { expect, test as base, type Page } from '@playwright/test';

// IDs and names were checked against brand/sprites/crops-v1/manifest.json.
// Keep expectations separate from the application catalog so an omitted crop cannot validate itself.
const CROPS = [
  { id: 'wheat', name: 'Wheat' },
  { id: 'barley', name: 'Barley' },
  { id: 'maize', name: 'Maize' },
  { id: 'sorghum', name: 'Sorghum' },
  { id: 'chickpea', name: 'Chickpea' },
  { id: 'lentil', name: 'Lentil' },
  { id: 'faba-bean', name: 'Faba bean' },
  { id: 'sunflower', name: 'Sunflower' },
  { id: 'potato', name: 'Potato' },
  { id: 'tomato', name: 'Open-field tomato' },
] as const;

const test = base.extend<{ runtimeErrors: string[] }>({
  runtimeErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await use(errors);
    expect(errors, 'Every crop must render without browser runtime errors.').toEqual([]);
  }, { auto: true }],
});

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/(?:[abc]\.)?tile\.openstreetmap\.org\//, route => route.abort());
});

async function chooseCrop(page: Page, name: string) {
  await page.getByRole('combobox', { name: 'Crop', exact: true }).click();
  const menu = page.getByRole('listbox');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('option')).toHaveCount(10);
  const bounds = await menu.boundingBox();
  const viewport = page.viewportSize();
  expect(bounds).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(-1);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(bounds!.y).toBeGreaterThanOrEqual(-1);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport!.height + 1);
  await menu.getByRole('option', { name, exact: true }).click();
}

async function readLoadedArtwork(page: Page, cropId: string) {
  const sprites = page.getByTestId('plot-slot-2').locator('[data-crop-id]');
  await expect(sprites.first()).toHaveAttribute('data-crop-id', cropId);
  expect(await sprites.evaluateAll(elements => [...new Set(elements.map(element => element.getAttribute('data-crop-id')))])).toEqual([cropId]);
  const rendered = await sprites.first().evaluate(async element => {
    const image = element.querySelector<SVGImageElement>('image');
    const href = image?.href.baseVal;
    if (!href) throw new Error('The planted crop must render an image asset.');
    const url = new URL(href, location.href).href;
    const bitmap = new Image();
    bitmap.src = url;
    await bitmap.decode();
    return {
      url,
      width: bitmap.naturalWidth,
      height: bitmap.naturalHeight,
      artwork: element.getAttribute('data-crop-artwork'),
    };
  });
  expect(rendered.width).toBeGreaterThan(0);
  expect(rendered.height).toBeGreaterThan(0);
  expect(rendered.artwork).toBeTruthy();
  expect(decodeURIComponent(new URL(rendered.url).pathname)).toContain(`${cropId}-`);
  const response = await page.request.get(rendered.url);
  expect(response.ok(), `The ${cropId} artwork asset must be served successfully.`).toBe(true);
  return { url: rendered.url, hash: createHash('sha256').update(await response.body()).digest('hex') };
}

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({ viewport: innerWidth, content: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) }));
  expect(widths.content, 'Crop names, controls, and artwork must fit the viewport.').toBeLessThanOrEqual(widths.viewport + 1);
}

async function exerciseCropCatalog(page: Page) {
  await page.goto('/#/farm');
  await page.getByRole('combobox', { name: 'Selected bed', exact: true }).click();
  await page.getByRole('option', { name: 'Plot C · Empty', exact: true }).click();

  // Plant a newly supported crop first, then exercise editing through the complete catalog.
  // The final crop is also new, so reload cannot pass by falling back to a legacy three-crop farm.
  const ordered = [CROPS[1], ...CROPS.filter(crop => crop.id !== 'barley')];
  const artworkUrls = new Set<string>();
  const artworkHashes = new Set<string>();
  for (const [index, crop] of ordered.entries()) {
    if (index > 0) await page.getByRole('button', { name: 'Edit planting', exact: true }).click();
    await chooseCrop(page, crop.name);
    await page.getByLabel('Planting date', { exact: true }).fill('2026-11-01');
    await page.getByRole('button', { name: index === 0 ? 'Plant crop' : 'Save planting', exact: true }).click();
    await expect(page.getByTestId('plot-slot-2')).toHaveAccessibleName(new RegExp(`Plot C.*${crop.name}`));
    await expect(page.locator('.plot-summary').getByRole('heading', { name: crop.name, exact: true })).toBeVisible();
    const artwork = await readLoadedArtwork(page, crop.id);
    artworkUrls.add(artwork.url);
    artworkHashes.add(artwork.hash);
    await expectNoHorizontalOverflow(page);
  }
  expect(artworkUrls.size, 'Each crop must use its own artwork resource.').toBe(10);
  expect(artworkHashes.size, 'Different crop names must not reuse identical artwork bytes.').toBe(10);
  await page.reload();
  await expect(page.getByTestId('plot-slot-2')).toHaveAccessibleName(/Plot C.*Open-field tomato/);
  await page.getByRole('combobox', { name: 'Selected bed', exact: true }).click();
  await page.getByRole('option', { name: 'Plot C · Open-field tomato', exact: true }).click();
  await expect(page.locator('.plot-summary').getByRole('heading', { name: 'Open-field tomato', exact: true })).toBeVisible();
  await readLoadedArtwork(page, 'tomato');
  await expectNoHorizontalOverflow(page);
}

test('plant and edit all ten crops with distinct loaded artwork and preserve a new crop after reload', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await exerciseCropCatalog(page);
  await page.getByTestId('farm-scene').screenshot({ path: testInfo.outputPath('orbitFarm-ten-crops-desktop.png') });
});

test('@mobile all ten crop choices and their artwork remain usable on a narrow screen', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await exerciseCropCatalog(page);
  await page.getByTestId('farm-scene').screenshot({ path: testInfo.outputPath('orbitFarm-ten-crops-mobile.png') });
});
