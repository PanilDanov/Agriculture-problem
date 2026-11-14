import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/(?:[abc]\.)?tile\.openstreetmap\.org\//, (route) => route.abort());
});

async function startDrawing(page: Page) {
  await page.goto('/#/farm');
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await page.getByRole('button', { name: 'Clear boundary', exact: true }).click();
  const map = page.getByTestId('boundary-map');
  const bounds = await map.boundingBox();
  expect(bounds).not.toBeNull();
  const corners = [
    { x: bounds!.width * 0.3, y: bounds!.height * 0.3 },
    { x: bounds!.width * 0.65, y: bounds!.height * 0.3 },
    { x: bounds!.width * 0.65, y: bounds!.height * 0.7 },
    { x: bounds!.width * 0.3, y: bounds!.height * 0.7 },
  ];
  return { map, corners, count: page.locator('.of-map-corner-count') };
}

async function savedRing(page: Page): Promise<number[][]> {
  await page.getByRole('button', { name: 'Confirm boundary', exact: true }).click();
  await expect(page.getByTestId('boundary-map')).toHaveCount(0);
  return page.evaluate(() => JSON.parse(localStorage.getItem('orbitFarm.farm.v1')!).boundary.coordinates[0]);
}

test('closing the first corner keeps four unique corners in the map and saved field', async ({ page }) => {
  const { map, corners, count } = await startDrawing(page);
  for (const position of corners) await map.click({ position });
  await expect(count).toHaveText('4 corners placed · Drawing');
  await map.click({ position: corners[0] });
  await expect(count).toHaveText('4 corners placed · Closed boundary');
  await expect(page.getByRole('button', { name: 'Finish boundary', exact: true })).toBeDisabled();

  const ring = await savedRing(page);
  expect(ring).toHaveLength(5);
  expect(new Set(ring.slice(0, -1).map((corner) => JSON.stringify(corner))).size).toBe(4);
  expect(ring.at(-1)).toEqual(ring[0]);

  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(count).toHaveText('4 corners placed · Closed boundary');
});

test('three corners stay open until explicitly finished and save as a triangle', async ({ page }) => {
  const { map, corners, count } = await startDrawing(page);
  for (const position of corners.slice(0, 3)) await map.click({ position });
  await expect(count).toHaveText('3 corners placed · Drawing');
  await expect(page.getByRole('button', { name: 'Finish boundary', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Finish boundary', exact: true }).click();
  await expect(count).toHaveText('3 corners placed · Closed boundary');

  const ring = await savedRing(page);
  expect(ring).toHaveLength(4);
  expect(new Set(ring.slice(0, -1).map((corner) => JSON.stringify(corner))).size).toBe(3);
  expect(ring.at(-1)).toEqual(ring[0]);
});

test('double clicks and existing markers never add duplicate corners', async ({ page }) => {
  const { map, corners, count } = await startDrawing(page);
  await map.dblclick({ position: corners[0] });
  await expect(count).toHaveText('1 corner placed · Drawing');
  await map.click({ position: corners[1] });
  await map.click({ position: corners[2] });
  await map.dblclick({ position: corners[3] });
  await expect(count).toHaveText('4 corners placed · Drawing');
  await map.click({ position: corners[1] });
  await expect(count).toHaveText('4 corners placed · Drawing');
  await page.getByRole('button', { name: 'Finish boundary', exact: true }).click();
  await expect(count).toHaveText('4 corners placed · Closed boundary');
});

test('undo after closing preserves the other corners and can finish again', async ({ page }) => {
  const { map, corners, count } = await startDrawing(page);
  for (const position of corners) await map.click({ position });
  await map.click({ position: corners[0] });
  await expect(count).toHaveText('4 corners placed · Closed boundary');
  await page.getByRole('button', { name: 'Undo point', exact: true }).click();
  await expect(count).toHaveText('3 corners placed · Drawing');
  await page.getByRole('button', { name: 'Finish boundary', exact: true }).click();
  await expect(count).toHaveText('3 corners placed · Closed boundary');
  expect(await savedRing(page)).toHaveLength(4);
});

test('coordinate entry rejects any previously entered corner', async ({ page }) => {
  const { count } = await startDrawing(page);
  await page.getByText('Enter coordinates instead', { exact: true }).click();
  for (const [latitude, longitude] of [['30.850', '34.790'], ['30.852', '34.792'], ['30.850', '34.790']]) {
    await page.getByLabel('Latitude', { exact: true }).fill(latitude);
    await page.getByLabel('Longitude', { exact: true }).fill(longitude);
    await page.getByRole('button', { name: 'Add point', exact: true }).click();
  }
  await expect(count).toHaveText('2 corners placed · Drawing');
  await expect(page.getByRole('alert')).toContainText('This corner was already added.');
  await expect(page.getByRole('button', { name: 'Finish boundary', exact: true })).toBeDisabled();
});

test('@mobile tapping the first corner closes the same four-corner field', async ({ page }) => {
  const { map, corners, count } = await startDrawing(page);
  for (const position of corners) await map.tap({ position });
  await expect(count).toHaveText('4 corners placed · Drawing');
  await map.tap({ position: corners[0] });
  await expect(count).toHaveText('4 corners placed · Closed boundary');
  expect(await savedRing(page)).toHaveLength(5);
});
