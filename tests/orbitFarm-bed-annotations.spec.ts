import { expect, test as base, type Page } from '@playwright/test';

interface Point { x: number; y: number }
interface SceneCheck {
  issues: string[];
  beds: number;
  represented: number;
  badges: number;
  legends: number;
  callouts: number;
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
  await page.clock.setFixedTime(new Date('2026-11-14T12:00:00Z'));
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
    let represented = 0;
    let badges = 0;
    let legends = 0;
    let callouts = 0;
    let crops = 0;
    const bedElements = [...scene.querySelectorAll<SVGGElement>('[data-testid^="plot-slot-"]')];
    const polygons = bedElements.map(bed => bed.querySelector<SVGPolygonElement>('.of-bed-ground')).filter((polygon): polygon is SVGPolygonElement => polygon !== null);
    const boxes: Array<{ id: string; bounds: DOMRect }> = [];
    const cropBoxes: Array<{ id: string; bounds: DOMRect }> = [];

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

    function overlapsPaint(polygon: SVGPolygonElement, rect: DOMRect) {
      const matrix = polygon.getScreenCTM();
      if (!matrix) return true;
      const inverse = matrix.inverse();
      for (let x = .5; x < rect.width; x += 1) {
        for (let y = .5; y < rect.height; y += 1) {
          if (polygon.isPointInFill(new DOMPoint(rect.left + x, rect.top + y).matrixTransform(inverse))) return true;
        }
      }
      // Also catch a narrow polygon whose vertices fall between the pixel samples.
      for (let index = 0; index < polygon.points.numberOfItems; index++) {
        const point = polygon.points.getItem(index).matrixTransform(matrix);
        if (point.x > rect.left + .05 && point.x < rect.right - .05 && point.y > rect.top + .05 && point.y < rect.bottom - .05) return true;
      }
      return false;
    }

    for (const bed of bedElements) {
      const id = bed.getAttribute('data-testid')!.replace('plot-slot-', '');
      const polygon = bed.querySelector<SVGPolygonElement>('.of-bed-ground');
      if (!polygon) { issues.push(`${id}: missing bed polygon`); continue; }
      const mode = bed.getAttribute('data-annotation-mode');
      modes[id] = mode;
      if (!['id', 'callout', 'legend'].includes(mode ?? '')) issues.push(`${id}: every bed needs a visible letter representation`);
      const expectedLetter = String.fromCharCode(65 + Number(id));
      const annotations = scene.querySelectorAll<SVGGElement>(`[data-testid="bed-annotation-${id}"]`);
      const legend = scene.querySelector<HTMLElement>(`[data-testid="bed-legend-${id}"]`);
      if (annotations.length !== (mode === 'legend' ? 0 : 1)) issues.push(`${id}: annotation count does not match its display mode`);
      if (mode === 'legend') {
        const bounds = legend?.getBoundingClientRect();
        if (!legend || !bounds?.width || !bounds.height || getComputedStyle(legend).visibility === 'hidden') issues.push(`${id}: the fallback letter is not visible`);
        else if (!new RegExp(`\\b${expectedLetter}\\b`).test(legend.textContent ?? '')) issues.push(`${id}: legend is missing its bed letter`);
        else { represented++; legends++; }
      }
      const box = scene.querySelector<SVGRectElement>(`[data-testid="bed-annotation-box-${id}"]`);
      const reserved = box?.getBoundingClientRect();
      if (annotations.length && !reserved) issues.push(`${id}: annotation has no shared background`);
      if (reserved) {
        badges++;
        boxes.push({ id, bounds: reserved });
        if (!(reserved.width > 0 && reserved.height > 0)) issues.push(`${id}: its letter badge is hidden`);
        else if (!new RegExp(`\\b${expectedLetter}\\b`).test(annotations[0].textContent ?? '')) issues.push(`${id}: badge is missing its bed letter`);
        else represented++;
        if (mode === 'callout') {
          callouts++;
          if (polygons.some(other => overlapsPaint(other, reserved))) issues.push(`${id}: a callout covers a bed`);
        } else insidePaint(polygon, reserved, `Bed ${id} annotation`);
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
        cropBoxes.push({ id, bounds });
        insidePaint(polygon, bounds, `Bed ${id} crop`);
      }
    }
    for (let first = 0; first < boxes.length; first++) {
      for (let second = first + 1; second < boxes.length; second++) {
        if (overlaps(boxes[first].bounds, boxes[second].bounds)) issues.push(`${boxes[first].id}/${boxes[second].id}: letter badges collide`);
      }
      if (cropBoxes.some(crop => overlaps(crop.bounds, boxes[first].bounds))) issues.push(`${boxes[first].id}: a letter badge covers a crop`);
    }
    if ([...scene.querySelectorAll('text')].some(text => text.textContent?.includes('+'))) issues.push('Empty beds must not display plus signs.');
    if (scene.querySelector('.of-bed-plus')) issues.push('An empty-bed plus marker is still rendered.');
    return { issues, beds: bedElements.length, represented, badges, legends, callouts, crops, modes };
  });
}

async function expectCleanAnnotations(page: Page) {
  await expect.poll(async () => (await inspectScene(page)).issues).toEqual([]);
  const scene = await inspectScene(page);
  expect(scene.represented, 'Every bed must keep its visible letter at every width.').toBe(scene.beds);
  expect(scene.badges, 'Readable beds must retain their identifiers.').toBeGreaterThan(0);
  expect(scene.crops, 'Collision avoidance must retain visible crops.').toBeGreaterThan(0);
  await expect(page.getByTestId('plot-slot-0').locator('[data-testid^="bed-crop-0-"]')).not.toHaveCount(0);
  await expect(page.getByTestId('plot-slot-0')).toHaveAccessibleName(/Plot A.*Wheat.*Seedling/);
  const widths = await page.evaluate(() => ({ viewport: innerWidth, content: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport + 1);
}

test('every bed keeps a letter while callouts stay clear of crops', async ({ page }, testInfo) => {
  await createDifficultBeds(page);
  await expectCleanAnnotations(page);
  const wide = await inspectScene(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await expectCleanAnnotations(page);
  const narrow = await inspectScene(page);
  expect(narrow.callouts + narrow.legends).toBeGreaterThanOrEqual(wide.callouts + wide.legends);
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
  await expect(page.getByRole('heading', { name: 'Plant crop', exact: true })).toBeVisible();
});

test('@mobile a loaded dense layout keeps all 24 letters visible and its legend selectable', async ({ page }, testInfo) => {
  await page.goto('/#/lab');
  await page.getByRole('button', { name: 'Load normal', exact: true }).click();
  await expect(page).toHaveURL(/#\/farm$/);
  // This fixture tests rendering an already-saved complex layout, not its creation journey.
  // Build it from the valid state saved by the normal scenario; API and field data stay intact.
  await page.evaluate(() => {
    const key = 'orbitFarm.farm.v1';
    const saved = localStorage.getItem(key);
    if (!saved) throw new Error('The normal scenario must persist before loading the visual fixture.');
    const farm = JSON.parse(saved);
    farm.layout = {
      width: 24,
      height: 12,
      beds: Array.from({ length: 24 }, (_, index) => ({
        slotId: index,
        name: `Dense bed ${index + 1}`,
        points: [{ x: index, y: 0 }, { x: index + 1, y: 0 }, { x: index + 1, y: 12 }, { x: index, y: 12 }],
      })),
    };
    farm.plots = [];
    farm.tasks = [];
    farm.journal = [];
    localStorage.setItem(key, JSON.stringify(farm));
  });
  await page.reload();
  await page.evaluate(async () => { await document.fonts.ready; });
  await expect(page.getByTestId('farm-scene').locator('[data-testid^="plot-slot-"]')).toHaveCount(24);
  await expect.poll(async () => (await inspectScene(page)).issues).toEqual([]);
  expect((await inspectScene(page)).represented).toBe(24);

  await page.setViewportSize({ width: 320, height: 800 });
  await expect.poll(async () => (await inspectScene(page)).issues).toEqual([]);
  const narrow = await inspectScene(page);
  expect(narrow.represented).toBe(24);
  expect(narrow.legends, 'A dense narrow layout needs visible fallback letters instead of hidden identifiers.').toBeGreaterThan(0);
  const legendId = Object.entries(narrow.modes).find(([, mode]) => mode === 'legend')![0];
  const entry = page.getByTestId(`bed-legend-${legendId}`);
  await expect(entry).toBeVisible();
  const slotId = Number(legendId);
  const otherSlot = (slotId + 1) % 24;
  await page.getByRole('combobox', { name: 'Selected bed', exact: true }).click();
  await page.getByRole('option', { name: `Dense bed ${otherSlot + 1} · Empty`, exact: true }).click();
  await expect(page.getByTestId(`plot-slot-${otherSlot}`)).toHaveAttribute('aria-pressed', 'true');
  await entry.click();
  await expect(page.getByTestId(`plot-slot-${slotId}`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('combobox', { name: 'Selected bed', exact: true })).toHaveText(`Dense bed ${slotId + 1} · Empty`);
  const widths = await page.evaluate(() => ({ viewport: innerWidth, content: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport + 1);
  await page.getByTestId('farm-scene').screenshot({ path: testInfo.outputPath('orbitFarm-bed-letters-dense-mobile.png') });
});
