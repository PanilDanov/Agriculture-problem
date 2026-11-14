import { describe, expect, it } from 'vitest';
import { planBedContent, rectInsidePolygon, rectanglesOverlap, type BedContentOptions, type ContentRectangle } from './orbitFarm-bed-content';
import type { LayoutPoint } from '../domain/orbitFarm-types';

const polygon = (...coordinates: [number, number][]): LayoutPoint[] => coordinates.map(([x, y]) => ({ x, y }));
const rectangle = (x: number, y: number, width: number, height: number) => polygon([x, y], [x + width, y], [x + width, y + height], [x, y + height]);
const options = (overrides: Partial<BedContentOptions> = {}): BedContentOptions => ({ pixelsPerUnit: 1, label: 'A', hasTask: false, empty: false, ...overrides });

// This separate ray-cast sampler verifies the visible footprint rather than repeating the planner's rectangle-fit algorithm.
function strictlyInside(point: LayoutPoint, points: LayoutPoint[]) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function expectFootprintInside(rect: ContentRectangle, points: LayoutPoint[]) {
  for (let x = 0; x <= 10; x++) for (let y = 0; y <= 10; y++) {
    expect(strictlyInside({ x: rect.x + rect.width * x / 10, y: rect.y + rect.height * y / 10 }, points)).toBe(true);
  }
}

describe('bed content containment', () => {
  it('rejects a rectangle whose corners sit inside a U-shaped bed but bridge its notch', () => {
    const shape = polygon([0, 0], [100, 0], [100, 100], [70, 100], [70, 30], [30, 30], [30, 100], [0, 100]);
    expect(rectInsidePolygon({ x: 10, y: 10, width: 80, height: 80 }, shape)).toBe(false);
    expect(rectInsidePolygon({ x: 5, y: 40, width: 20, height: 40 }, shape)).toBe(true);
  });

  it('accounts for the complete selected-border inset', () => {
    const shape = rectangle(0, 0, 100, 50);
    expect(rectInsidePolygon({ x: 4, y: 4, width: 92, height: 42 }, shape, 4)).toBe(true);
    expect(rectInsidePolygon({ x: 3.9, y: 4, width: 92, height: 42 }, shape, 4)).toBe(false);
    expect(rectInsidePolygon({ x: 4, y: 4, width: 92, height: 42 }, [...shape].reverse(), 4)).toBe(true);
  });

  it('allows touching rectangles without treating them as occupied overlap', () => {
    expect(rectanglesOverlap({ x: 0, y: 0, width: 20, height: 20 }, { x: 20, y: 0, width: 10, height: 20 })).toBe(false);
    expect(rectanglesOverlap({ x: 0, y: 0, width: 20, height: 20 }, { x: 19.5, y: 0, width: 10, height: 20 })).toBe(true);
  });
});

describe('responsive bed content planning', () => {
  it('uses a plain ID badge for an empty bed', () => {
    const shape = rectangle(100, 100, 130, 80);
    const result = planBedContent(shape, options({ empty: true }));
    expect(result.annotation).toMatchObject({ mode: 'id', showTask: false });
    expect(result.crops).toEqual([]);
    expectFootprintInside(result.annotation!, shape);
  });

  it('keeps a task indicator in the shared badge', () => {
    const shape = rectangle(100, 100, 130, 80);
    const result = planBedContent(shape, options({ hasTask: true, empty: true }));
    expect(result.annotation).toMatchObject({ mode: 'compact', showTask: true });
    expectFootprintInside(result.annotation!, shape);
  });

  it('keeps a small ID badge inside a narrow bed', () => {
    const shape = rectangle(100, 100, 36, 36);
    const result = planBedContent(shape, options({ empty: true }));
    expect(result.annotation).toMatchObject({ mode: 'id', showTask: false });
    expectFootprintInside(result.annotation!, shape);
  });

  it('omits the entire badge on a thin H-like bed instead of clipping its text', () => {
    const result = planBedContent(rectangle(100, 100, 70, 20), options({ empty: true }));
    expect(result.annotation).toBeNull();
    expect(result.crops).toEqual([]);
  });

  it.each([
    ['an L-shaped bed', polygon([100, 100], [250, 100], [250, 155], [165, 155], [165, 290], [100, 290])],
    ['a triangle', polygon([100, 100], [250, 100], [110, 180])],
    ['a skewed quadrilateral', polygon([100, 100], [160, 95], [172, 153], [98, 165])],
  ])('keeps badges and complete crop sprites inside %s', (_name, shape) => {
    const result = planBedContent(shape, options({ hasTask: true }));
    expect(result.annotation).not.toBeNull();
    expect(result.crops.length).toBeGreaterThan(0);
    expectFootprintInside(result.annotation!, shape);
    result.crops.forEach(crop => expectFootprintInside(crop, shape));
  });

  it('reserves the badge area so crop sprites cannot appear beneath its ID or task icon', () => {
    const shape = rectangle(100, 100, 200, 110);
    const result = planBedContent(shape, options({ hasTask: true }));
    const badge = result.annotation!;
    expect(result.crops.length).toBeGreaterThan(0);
    for (const crop of result.crops) {
      expect(crop.x + crop.width <= badge.x - 4 || crop.x >= badge.x + badge.width + 4
        || crop.y + crop.height <= badge.y - 4 || crop.y >= badge.y + badge.height + 4).toBe(true);
    }
  });

  it('keeps a normal rectangular bed visibly planted instead of rejecting both inset crop rows', () => {
    const shape = rectangle(100, 100, 133, 81);
    const result = planBedContent(shape, options({ hasTask: true }));
    expect(result.annotation).toMatchObject({ showTask: true });
    expect(result.crops.length).toBeGreaterThanOrEqual(3);
    expect(result.crops.every(crop => crop.width === 34 && crop.height === 34)).toBe(true);
    result.crops.forEach(crop => expectFootprintInside(crop, shape));
  });

  it('keeps text readable and adapts badge visibility when the same bed is rendered on a phone', () => {
    const shape = rectangle(100, 100, 75, 45);
    const desktop = planBedContent(shape, options({ empty: true, pixelsPerUnit: 1 }));
    const phone = planBedContent(shape, options({ empty: true, pixelsPerUnit: .35 }));
    expect(desktop.annotation).not.toBeNull();
    expect(desktop.annotation!.fontSize).toBe(11);
    expect(phone.annotation).toBeNull();
    const spaciousPhone = planBedContent(rectangle(100, 100, 160, 100), options({ empty: true, pixelsPerUnit: .35 }));
    expect(spaciousPhone.annotation).not.toBeNull();
    expect(spaciousPhone.annotation!.fontSize * .35).toBeCloseTo(11);
  });

  it('never falls back to a polygon vertex when a narrow diagonal has no safe annotation area', () => {
    const shape = polygon([100, 100], [330, 215], [329, 217], [99, 102]);
    const result = planBedContent(shape, options({ hasTask: true }));
    expect(result.annotation).toBeNull();
    expect(result.crops).toEqual([]);
  });

  it('places a smaller whole sprite when a small planted bed cannot hold a full-size crop', () => {
    const shape = rectangle(100, 100, 36, 36);
    const result = planBedContent(shape, options({ pixelsPerUnit: .35 }));
    expect(result.annotation).toBeNull();
    expect(result.crops).toHaveLength(1);
    expect(result.crops[0]).toMatchObject({ width: 24, height: 24 });
    expectFootprintInside(result.crops[0], shape);
  });

  it('keeps a planted crop visible when even an ID-only badge would consume its only usable area', () => {
    const shape = rectangle(100, 100, 36, 45);
    const result = planBedContent(shape, options({ hasTask: true }));
    expect(result.annotation).toBeNull();
    expect(result.crops).toHaveLength(1);
    expect(result.crops[0]).toMatchObject({ width: 24, height: 24 });
    expectFootprintInside(result.crops[0], shape);
  });

  it('sizes multi-letter IDs without changing their readable font size', () => {
    const single = planBedContent(rectangle(100, 100, 200, 100), options({ empty: true, label: 'A' }));
    const multiple = planBedContent(rectangle(100, 100, 200, 100), options({ empty: true, label: 'AA' }));
    expect(multiple.annotation!.width).toBeGreaterThan(single.annotation!.width);
    expect(multiple.annotation!.fontSize).toBe(single.annotation!.fontSize);
  });

  it('reserves enough text space for a wide four-letter ID beside its icon', () => {
    const result = planBedContent(rectangle(100, 100, 200, 100), options({ hasTask: true, label: 'WWWW' }));
    const badge = result.annotation!;
    expect(badge).toMatchObject({ mode: 'compact', showTask: true });
    expect(badge.width).toBeGreaterThanOrEqual(73);
    const textRight = badge.fontSize * .55 + badge.fontSize * 4;
    const iconLeft = badge.width - badge.fontSize * .55 - badge.fontSize * 1.15;
    expect(iconLeft - textRight).toBeGreaterThanOrEqual(3);
  });

  it('fails safely for missing or non-finite geometry and normalizes invalid render scales', () => {
    expect(planBedContent([], options())).toEqual({ annotation: null, crops: [] });
    expect(planBedContent(polygon([0, 0], [1, 1], [Number.NaN, 2]), options())).toEqual({ annotation: null, crops: [] });
    const shape = rectangle(100, 100, 200, 100);
    expect(planBedContent(shape, options({ pixelsPerUnit: Number.NaN }))).toEqual(planBedContent(shape, options({ pixelsPerUnit: 1 })));
    expect(planBedContent(shape, options({ pixelsPerUnit: 10 }))).toEqual(planBedContent(shape, options({ pixelsPerUnit: 3 })));
  });
});
