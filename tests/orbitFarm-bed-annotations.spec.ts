import { expect, test as base, type Page } from '@playwright/test';

interface Point { x: number; y: number }
interface SceneCheck {
  issues: string[];
  badges: number;
  crops: number;
  modes: Record<string, string | null>;
}

const test = base.extend<{ runtimeErrors: string[] }>({
  runtimeErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await use(errors);
    expect(errors, 'Responsive bed annotations must not throw browser runtime errors.').toEqual([]);
  }, { auto: true }],
});

test.beforeEach(async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await page.route(/^https:\/\/(?:[abc]\.)?tile\.openstreetmap\.org\//, route => route.abort());
});

async function addBed(page: Page, points: Point[], name: string) {
  await page.getByRole('button', { name: 'Draw bed', exact: true }).click();
  for (const point of points) {
    await page.getByLabel('Point X', { exact: true }).fill(String(point.x));
    await page.getByLabel('Point Y', { exact: true }).fill(String(point.y));
    await page.getByRole('button', { name: 'Add point', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Finish bed', exact: true }).click();
  await page.getByLabel('Bed name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Rename bed', exact: true }).click();
}

/** Exercise the actual editor: no ready farm is inserted into browser storage. */
async function createDifficultBeds(page: Page) {
  await page.goto('/#/farm');
  await page.getByRole('button', { name: 'Edit layout', exact: true }).click();
  await page.getByRole('button', { name: 'Patchwork', exact: true }).click();
  // The preset supplies a planted L, a planted concave arrow, and a narrow hook.
  await addBed(page, [
    { x: 10, y: 0 }, { x: 13, y: 0 }, { x: 13, y: .75 }, { x: 10, y: .75 },
  ], 'Narrow row');
  await addBed(page, [
    { x: 18, y: 6 }, { x: 19.5, y: 7.5 }, { x: 18, y: 7.5 },
  ], 'Sharp corner');
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  await expect(page).toHaveURL(/#\/farm$/);

  await page.getByRole('combobox', { name: 'Selected bed', exact: true }).click();
  await page.getByRole('option', { name: 'Sharp corner · Empty', exact: true }).click();
  await page.getByRole('combobox', { name: 'Crop', exact: true }).click();
  await page.getByRole('option', { name: 'Chickpea', exact: true }).click();
  await page.getByLabel('Planting date', { exact: true }).fill('2026-11-01');
  await page.getByRole('button', { name: 'Plant crop', exact: true }).click();
  await expect(page.getByTestId('selected-task')).toContainText('Check soil moisture');
  await page.evaluate(async () => { await document.fonts.ready; });
}

/** Use the browser's SVG paint geometry rather than the application's placement helper. */
async function inspectScene(page: Page): Promise<SceneCheck> {
  return page.getByTestId('farm-scene').evaluate(scene => {
    const issues: string[] = [];
    const modes: Record<string, string | null> = {};
    let badges = 0;
    let crops = 0;

    function insidePaint(polygon: SVGPolygonElement, rect: DOMRect, name: string) {
      const matrix = polygon.getScreenCTM();
      if (!matrix) { issues.push(`${name}: polygon has no screen transform`); return; }
      const inverse = matrix.inverse();
      // Corners, edges, and interior samples catch a label bridging a concave notch.
      for (const xFraction of [.01, .25, .5, .75, .99]) {
        for (const yFraction of [.01, .25, .5, .75, .99]) {
          const point = new DOMPoint(rect.left + rect.width * xFraction, rect.top + rect.height * yFraction).matrixTransform(inverse);
          if (!polygon.isPointInFill(point)) { issues.push(`${name}: painted content leaves its bed`); return; }
        }
      }
    }

    function overlaps(a: DOMRect, b: DOMRect) {
      return Math.min(a.right, b.right) - Math.max(a.left, b.left) > .05
        && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > .05;
    }

    for (const bed of scene.querySelectorAll<SVGGElement>('[data-testid^="plot-slot-"]')) {
      const id = bed.getAttribute('data-testid')!.replace('plot-slot-', '');
      const polygon = bed.querySelector<SVGPolygonElement>('.of-bed-ground');
      if (!polygon) { issues.push(`${id}: missing bed polygon`); continue; }
      const mode = bed.getAttribute('data-annotation-mode');
      modes[id] = mode;
      if (!['compact', 'id', 'none'].includes(mode ?? '')) issues.push(`${id}: missing annotation mode`);
      const annotations = bed.querySelectorAll<SVGGElement>(`[data-testid="bed-annotation-${id}"]`);
      if (annotations.length !== (mode === 'none' ? 0 : 1)) issues.push(`${id}: annotation count does not match the available space`);
      const box = bed.querySelector<SVGRectElement>(`[data-testid="bed-annotation-box-${id}"]`);
      const reserved = box?.getBoundingClientRect();
      if (annotations.length && !reserved) issues.push(`${id}: annotation has no shared background`);
      if (reserved) {
        badges++;
        insidePaint(polygon, reserved, `Bed ${id} annotation`);
        for (const glyph of annotations[0].querySelectorAll<SVGGraphicsElement>('text,path,line,polyline,polygon,circle,ellipse,svg')) {
          const glyphBounds = glyph.getBoundingClientRect();
          if (glyphBounds.left < reserved.left - .5 || glyphBounds.right > reserved.right + .5
            || glyphBounds.top < reserved.top - .5 || glyphBounds.bottom > reserved.bottom + .5) {
            issues.push(`${id}: an annotation letter or icon does not fit its background`);
          }
        }
      }
      for (const crop of bed.querySelectorAll<SVGGElement>(`[data-testid^="bed-crop-${id}-"]`)) {
        crops++;
        const bounds = crop.getBoundingClientRect();
        insidePaint(polygon, bounds, `Bed ${id} crop`);
        if (reserved && overlaps(bounds, reserved)) issues.push(`${id}: an annotation covers a crop`);
      }
    }
    return { issues, badges, crops, modes };
  });
}

async function expectCleanAnnotations(page: Page) {
  await expect.poll(async () => (await inspectScene(page)).issues).toEqual([]);
  const scene = await inspectScene(page);
  expect(scene.badges, 'Readable beds must retain their identifiers.').toBeGreaterThan(0);
  expect(scene.crops, 'Collision avoidance must retain visible crops.').toBeGreaterThan(0);
  await expect(page.getByTestId('plot-slot-0').locator('[data-testid^="bed-crop-0-"]')).not.toHaveCount(0);
  await expect(page.getByTestId('plot-slot-0')).toHaveAccessibleName(/Plot A.*Wheat.*Check soil moisture/);
  const widths = await page.evaluate(() => ({ viewport: innerWidth, content: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport + 1);
}

test('bed labels, prompts, and due markers fit difficult polygons without covering crops', async ({ page }, testInfo) => {
  await createDifficultBeds(page);
  await expectCleanAnnotations(page);
  const wide = await inspectScene(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await expectCleanAnnotations(page);
  const narrow = await inspectScene(page);
  expect(Object.values(narrow.modes).filter(mode => mode === 'compact').length)
    .toBeLessThanOrEqual(Object.values(wide.modes).filter(mode => mode === 'compact').length);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expectCleanAnnotations(page);
  await page.getByTestId('farm-scene').screenshot({ path: testInfo.outputPath('orbitFarm-bed-annotations-desktop.png') });
});

test('@mobile small bed annotations reflow after resize and keep details available', async ({ page }, testInfo) => {
  await createDifficultBeds(page);
  await expectCleanAnnotations(page);
  await expect(page.getByRole('combobox', { name: 'Selected bed', exact: true })).toHaveText('Sharp corner · Chickpea');
  await page.getByTestId('farm-scene').screenshot({ path: testInfo.outputPath('orbitFarm-bed-annotations-mobile.png') });
  await page.setViewportSize({ width: 860, height: 700 });
  await expectCleanAnnotations(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await expectCleanAnnotations(page);
  await page.reload();
  await expectCleanAnnotations(page);
  await page.getByRole('combobox', { name: 'Selected bed', exact: true }).click();
  await page.getByRole('option', { name: 'Narrow row · Empty', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make room for something good.', exact: true })).toBeVisible();
});
