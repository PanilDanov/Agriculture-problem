import { expect, test as base, type Page } from '@playwright/test';

interface Point { x: number; y: number }
interface SavedFarm {
  version: number;
  layout: { width: number; height: number; beds: Array<{ slotId: number; name: string; points: Point[] }> };
  plots: Array<{ id: string; slotId: number; cropId: string; plantedOn: string }>;
  tasks: Array<{ id: string; plotId: string; status: string }>;
  journal: Array<{ id: string; plotId: string; taskId: string; action: string; undone: boolean }>;
  analysis: unknown;
}

const test = base.extend<{
  runtimeErrors: string[];
  dialogs: { accept: boolean; messages: string[] };
}>({
  runtimeErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await use(errors);
    expect(errors, 'Layout editing must not throw browser runtime errors.').toEqual([]);
  }, { auto: true }],
  dialogs: [async ({ page }, use) => {
    const state = { accept: true, messages: [] as string[] };
    page.on('dialog', async (dialog) => {
      state.messages.push(dialog.message());
      if (state.accept) await dialog.accept();
      else await dialog.dismiss();
    });
    await use(state);
  }, { auto: true }],
});

const L_SHAPE: Point[] = [
  { x: 7, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 5 },
  { x: 17, y: 5 }, { x: 17, y: 7 }, { x: 7, y: 7 },
];

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/(?:[abc]\.)?tile\.openstreetmap\.org\//, (route) => route.abort());
});

async function openEditor(page: Page) {
  await page.goto('/#/farm');
  await page.getByRole('button', { name: 'Edit layout', exact: true }).click();
  await expect(page.getByTestId('layout-editor')).toBeVisible();
  await expect(page).toHaveURL(/#\/layout$/);
}

async function readFarm(page: Page): Promise<SavedFarm> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('orbitFarm.farm.v1')!));
}

async function addPoints(page: Page, points: Point[]) {
  await page.getByRole('button', { name: 'Draw bed', exact: true }).click();
  for (const point of points) {
    await page.getByLabel('Point X', { exact: true }).fill(String(point.x));
    await page.getByLabel('Point Y', { exact: true }).fill(String(point.y));
    await page.getByRole('button', { name: 'Add point', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Finish bed', exact: true }).click();
}

async function renameSelectedBed(page: Page, name: string) {
  await page.getByLabel('Bed name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Rename bed', exact: true }).click();
}

async function screenPoint(page: Page, point: Point): Promise<Point> {
  return page.getByTestId('layout-board').evaluate((element, position) => {
    const matrix = (element as SVGSVGElement).getScreenCTM();
    if (!matrix) throw new Error('The layout board must have a screen transform.');
    const result = new DOMPoint(position.x, position.y).matrixTransform(matrix);
    return { x: result.x, y: result.y };
  }, point);
}

async function editorPoints(page: Page, slotId: number): Promise<Point[]> {
  return page.getByTestId(`layout-shape-${slotId}`).evaluate((element) => {
    const points = (element as SVGPolygonElement).points;
    return Array.from({ length: points.numberOfItems }, (_, index) => {
      const point = points.getItem(index);
      return { x: point.x, y: point.y };
    });
  });
}

async function dragAcrossBoard(page: Page, from: Point, to: Point) {
  const start = await screenPoint(page, from);
  const end = await screenPoint(page, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

async function touchDragAcrossBoard(page: Page, from: Point, to: Point) {
  const start = await screenPoint(page, from);
  const end = await screenPoint(page, to);
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
    for (let step = 1; step <= 8; step++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: start.x + (end.x - start.x) * step / 8, y: start.y + (end.y - start.y) * step / 8, id: 1 }],
      });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await session.detach();
  }
}

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    viewport: innerWidth,
    content: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
  }));
  expect(widths.content, 'The layout editor must fit the current viewport.').toBeLessThanOrEqual(widths.viewport + 1);
}

async function capture(page: Page, path: string) {
  await page.evaluate(async () => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
    await document.fonts.ready;
  });
  await page.screenshot({ path, fullPage: true });
}

test('draw a seventh L-shaped bed, plant it, and preserve its exact shape after reload', async ({ page }, testInfo) => {
  await openEditor(page);
  await addPoints(page, L_SHAPE);
  await renameSelectedBed(page, 'Orchard lane');
  await capture(page, testInfo.outputPath('orbitFarm-layout-desktop.png'));
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  await expect(page).toHaveURL(/#\/farm$/);
  await expect(page.getByTestId('plot-slot-6')).toHaveAccessibleName(/Orchard lane.*Empty/);
  const saved = await readFarm(page);
  expect(saved.version).toBe(2);
  expect(saved.layout.beds).toHaveLength(7);
  expect(saved.layout.beds.find((bed) => bed.slotId === 6)).toMatchObject({ name: 'Orchard lane', points: L_SHAPE });

  await page.getByRole('combobox', { name: 'Selected bed', exact: true }).click();
  await page.getByRole('option', { name: 'Orchard lane · Empty', exact: true }).click();
  await page.getByRole('combobox', { name: 'Crop', exact: true }).click();
  await page.getByRole('option', { name: 'Chickpea', exact: true }).click();
  await page.getByLabel('Planting date', { exact: true }).fill('2026-11-01');
  await page.getByRole('button', { name: 'Plant crop', exact: true }).click();
  await expect(page.getByTestId('plot-slot-6')).toHaveAccessibleName(/Orchard lane.*Chickpea/);
  await page.reload();
  await expect(page.getByTestId('plot-slot-6')).toHaveAccessibleName(/Orchard lane.*Chickpea/);
  expect((await readFarm(page)).layout.beds.find((bed) => bed.slotId === 6)?.points).toEqual(L_SHAPE);
  await capture(page, testInfo.outputPath('orbitFarm-custom-bed.png'));
});

test('move and reshape a planted bed without losing its crop, tasks, or journal, and reject overlap', async ({ page }) => {
  await page.goto('/#/farm');
  await page.getByRole('button', { name: 'Watered', exact: true }).click();
  const before = await readFarm(page);
  await page.getByRole('button', { name: 'Edit layout', exact: true }).click();
  await page.getByRole('button', { name: 'Select Plot A', exact: true }).click();
  await page.getByRole('button', { name: 'Move bed right', exact: true }).click();
  await page.getByTestId('layout-vertex-0').click();
  await page.getByLabel('Corner X', { exact: true }).fill('2');
  await page.getByLabel('Corner Y', { exact: true }).fill('1.5');
  await page.getByRole('button', { name: 'Update corner', exact: true }).click();
  const validShape = await editorPoints(page, 0);

  await page.getByRole('button', { name: 'Select & move', exact: true }).click();
  await dragAcrossBoard(page, { x: 4.5, y: 3 }, { x: 12.5, y: 3 });
  await expect(page.getByRole('alert')).toContainText(/overlap/i);
  await expect.poll(() => editorPoints(page, 0)).toEqual(validShape);
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();

  const after = await readFarm(page);
  expect(after.layout.beds.find((bed) => bed.slotId === 0)?.points).toEqual([
    { x: 2, y: 1.5 }, { x: 7.5, y: 1 }, { x: 7.5, y: 5 }, { x: 1.5, y: 5 },
  ]);
  expect(after.plots).toEqual(before.plots);
  expect(after.tasks).toEqual(before.tasks);
  expect(after.journal).toEqual(before.journal);
  expect(after.analysis).toEqual(before.analysis);
  await page.reload();
  await expect(page.getByTestId('plot-slot-0')).toHaveAccessibleName(/Plot A.*Wheat/);
  expect((await readFarm(page)).layout).toEqual(after.layout);
});

test('cancel discards draft layout changes, while Undo and Redo stay inside the editor', async ({ page }) => {
  await page.goto('/#/farm');
  await page.getByRole('button', { name: 'Watered', exact: true }).click();
  const before = await readFarm(page);
  await page.getByRole('button', { name: 'Edit layout', exact: true }).click();
  await page.getByRole('button', { name: 'Select Plot A', exact: true }).click();
  await renameSelectedBed(page, 'Temporary north bed');
  await expect(page.getByRole('button', { name: 'Select Temporary north bed', exact: true })).toBeVisible();
  await page.getByTestId('layout-editor').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select Plot A', exact: true })).toBeVisible();
  await page.getByTestId('layout-editor').getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select Temporary north bed', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(/#\/farm$/);
  await page.reload();
  expect((await readFarm(page)).layout).toEqual(before.layout);
  expect((await readFarm(page)).journal).toEqual(before.journal);
});

test('removing a planted bed requires confirmation and preserves action history', async ({ page, dialogs }) => {
  await page.goto('/#/farm');
  await page.getByRole('button', { name: 'Watered', exact: true }).click();
  const before = await readFarm(page);
  await page.getByRole('button', { name: 'Edit layout', exact: true }).click();
  await page.getByRole('button', { name: 'Select Plot A', exact: true }).click();
  await page.getByRole('button', { name: 'Delete bed', exact: true }).click();
  dialogs.accept = false;
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  await expect(page.getByTestId('layout-editor')).toBeVisible();
  expect((await readFarm(page)).layout).toEqual(before.layout);
  expect(dialogs.messages.at(-1)).toMatch(/planted|planting/i);

  dialogs.accept = true;
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  await expect(page).toHaveURL(/#\/farm$/);
  await expect(page.getByTestId('plot-slot-0')).toHaveCount(0);
  const after = await readFarm(page);
  expect(after.layout.beds.some((bed) => bed.slotId === 0)).toBe(false);
  expect(after.plots.some((plot) => plot.slotId === 0)).toBe(false);
  expect(after.tasks.some((task) => task.plotId === before.plots.find((plot) => plot.slotId === 0)!.id)).toBe(false);
  expect(after.journal).toEqual(before.journal);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Journal', exact: true }).click();
  await expect(page.getByTestId('journal-entry').filter({ hasText: 'Irrigation logged' })).toHaveCount(1);
  await expect(page.getByTestId('journal-entry').getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
});

test('navigation protects an unsaved layout draft and leaving does not save it', async ({ page, dialogs }) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Select Plot A', exact: true }).click();
  await page.getByLabel('Bed name', { exact: true }).fill('Unsaved north bed');
  dialogs.accept = false;
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Journal', exact: true }).click();
  await expect(page).toHaveURL(/#\/layout$/);
  await expect(page.getByLabel('Bed name', { exact: true })).toHaveValue('Unsaved north bed');
  expect(dialogs.messages.at(-1)).toBe('Leave without saving your layout changes?');

  dialogs.accept = true;
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Journal', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your care journal', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Your farm', exact: true }).click();
  await page.getByRole('button', { name: 'Edit layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select Plot A', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select Unsaved north bed', exact: true })).toHaveCount(0);
});

test('Save layout validates and applies typed name and corner edits without separate apply buttons', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Select Plot A', exact: true }).click();
  await page.getByLabel('Bed name', { exact: true }).fill('North bed saved directly');
  await page.getByLabel('Corner X', { exact: true }).fill('100');
  await page.getByLabel('Corner Y', { exact: true }).fill('1.5');
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  await expect(page.getByTestId('layout-editor')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(/inside the planning area/i);
  await expect.poll(() => editorPoints(page, 0)).toEqual([
    { x: 1, y: 1 }, { x: 7, y: 1 }, { x: 7, y: 5 }, { x: 1, y: 5 },
  ]);

  await page.getByLabel('Corner X', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  await expect(page).toHaveURL(/#\/farm$/);
  const saved = await readFarm(page);
  expect(saved.layout.beds.find((bed) => bed.slotId === 0)).toMatchObject({
    name: 'North bed saved directly',
    points: [{ x: 2, y: 1.5 }, { x: 7, y: 1 }, { x: 7, y: 5 }, { x: 1, y: 5 }],
  });
  await expect(page.getByTestId('plot-slot-0')).toHaveAccessibleName(/North bed saved directly.*Wheat/);
});

test('a layout designed before field onboarding survives creation and analysis', async ({ page }) => {
  await page.goto('/#/lab');
  await page.getByRole('button', { name: 'Load empty-farm', exact: true }).click();
  await page.getByRole('button', { name: 'Edit layout', exact: true }).click();
  await page.getByRole('button', { name: 'Long rows', exact: true }).click();
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  await expect(page).toHaveURL(/#\/farm$/);
  const designed = (await readFarm(page)).layout;
  expect(designed.beds).toHaveLength(3);

  await page.getByRole('button', { name: 'Create farm', exact: true }).click();
  await page.getByLabel('Farm name', { exact: true }).fill('Preplanned garden');
  await page.getByRole('button', { name: 'Use demo boundary', exact: true }).click();
  await page.getByRole('button', { name: 'Analyze my farm', exact: true }).click();
  await page.getByRole('article', { name: 'Save water plan', exact: true }).getByRole('button', { name: 'Use this plan', exact: true }).click();
  await expect(page).toHaveURL(/#\/farm$/);
  expect((await readFarm(page)).layout).toEqual(designed);
  await page.reload();
  expect((await readFarm(page)).layout).toEqual(designed);
  await expect(page.getByTestId('farm-name')).toHaveText('Preplanned garden');
});

test('keyboard selection resets a high corner index before editing a shorter polygon', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Patchwork', exact: true }).click();
  await page.getByRole('button', { name: 'Select Plot C', exact: true }).click();
  await page.getByRole('button', { name: 'Edit corner 8', exact: true }).click();
  await page.getByTestId('layout-bed-3').focus();
  await page.getByTestId('layout-bed-3').press('ArrowLeft');
  await expect(page.getByLabel('Corner X', { exact: true })).toHaveValue('5.5');
  await expect(page.getByLabel('Corner Y', { exact: true })).toHaveValue('8');
  await page.getByLabel('Corner X', { exact: true }).fill('6');
  await page.getByLabel('Corner Y', { exact: true }).fill('8.5');
  await page.getByRole('button', { name: 'Update corner', exact: true }).click();
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  await expect(page).toHaveURL(/#\/farm$/);
  expect((await readFarm(page)).layout.beds.find((bed) => bed.slotId === 3)?.points).toEqual([
    { x: 6, y: 8.5 }, { x: 15.5, y: 8 }, { x: 15.5, y: 11 }, { x: 5.5, y: 11 },
  ]);
});

test('@mobile draw a custom polygon with touch, resize the viewport, and save without overflow', async ({ page }, testInfo) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Select Plot A', exact: true }).click();
  await page.getByTestId('layout-board').scrollIntoViewIfNeeded();
  const original = await editorPoints(page, 0);
  await touchDragAcrossBoard(page, { x: 4, y: 3 }, { x: 5, y: 3 });
  await expect.poll(() => editorPoints(page, 0)).toEqual([{ x: 2, y: 1 }, { x: 8, y: 1 }, { x: 8, y: 5 }, { x: 2, y: 5 }]);
  await page.getByTestId('layout-editor').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => editorPoints(page, 0)).toEqual(original);
  await page.getByRole('button', { name: 'Draw bed', exact: true }).click();
  await page.getByTestId('layout-board').scrollIntoViewIfNeeded();
  for (const point of L_SHAPE) {
    const position = await screenPoint(page, point);
    await page.touchscreen.tap(position.x, position.y);
  }
  await page.getByRole('button', { name: 'Finish bed', exact: true }).click();
  await renameSelectedBed(page, 'Touch garden');
  await expectNoHorizontalOverflow(page);
  await capture(page, testInfo.outputPath('orbitFarm-layout-touch.png'));
  const narrowShape = await editorPoints(page, 6);
  await page.setViewportSize({ width: 860, height: 700 });
  await expect.poll(() => editorPoints(page, 6)).toEqual(narrowShape);
  await expectNoHorizontalOverflow(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await expectNoHorizontalOverflow(page);
  await capture(page, testInfo.outputPath('orbitFarm-layout-mobile.png'));
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  await expect(page.getByTestId('plot-slot-6')).toHaveAccessibleName(/Touch garden.*Empty/);
  await page.reload();
  expect((await readFarm(page)).layout.beds.find((bed) => bed.slotId === 6)?.points).toEqual(L_SHAPE);
  await expectNoHorizontalOverflow(page);
});
