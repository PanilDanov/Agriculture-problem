import { describe, expect, it } from 'vitest';
import { planBedAnnotations, rectangleIntersectsPolygon, type AnnotatedBedInput, type BedAnnotationPlan } from './orbitFarm-bed-annotations';
import type { LayoutPoint } from '../domain/orbitFarm-types';

const polygon = (...coordinates: [number, number][]): LayoutPoint[] => coordinates.map(([x, y]) => ({ x, y }));
const rectangle = (x: number, y: number, width: number, height: number) => polygon([x, y], [x + width, y], [x + width, y + height], [x, y + height]);
const bed = (slotId: number, points: LayoutPoint[], overrides: Partial<AnnotatedBedInput> = {}): AnnotatedBedInput => ({ slotId, points, label: String.fromCharCode(65 + slotId), hasTask: false, empty: true, ...overrides });

function expectEveryIdentityOnce(plan: BedAnnotationPlan, inputs: AnnotatedBedInput[]) {
  for (const input of inputs) {
    const canvas = plan.beds.filter(item => item.slotId === input.slotId && item.annotation !== null).length;
    const legend = plan.legend.filter(item => item.slotId === input.slotId).length;
    expect(canvas + legend, `${input.label} must have exactly one visible identity.`).toBe(1);
  }
}

function expectNoLabelCollisions(plan: BedAnnotationPlan, inputs: AnnotatedBedInput[]) {
  const boxes = plan.beds.flatMap(item => item.annotation ? [{ ...item.annotation, slotId: item.slotId, external: item.external }] : []);
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    if (a.external) for (const input of inputs) expect(rectangleIntersectsPolygon(a, input.points)).toBe(false);
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j];
      expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y,
        `Labels ${a.slotId} and ${b.slotId} must not overlap.`).toBe(true);
    }
  }
}

describe('external label collision geometry', () => {
  it('detects a thin polygon passing through a rectangle without containing its corners', () => {
    const strip = polygon([140, 205], [220, 235], [219, 238], [139, 208]);
    expect(rectangleIntersectsPolygon({ x: 165, y: 215, width: 25, height: 20 }, strip)).toBe(true);
  });

  it('distinguishes empty concave ground from the surrounding bed', () => {
    const shape = polygon([160, 194], [300, 194], [300, 240], [210, 240], [210, 360], [160, 360]);
    expect(rectangleIntersectsPolygon({ x: 225, y: 260, width: 40, height: 25 }, shape)).toBe(false);
    expect(rectangleIntersectsPolygon({ x: 195, y: 260, width: 40, height: 25 }, shape)).toBe(true);
  });

  it('keeps the selected outline margin clear around callouts', () => {
    const shape = rectangle(200, 220, 60, 15);
    const label = { x: 200, y: 239, width: 24, height: 22 };
    expect(rectangleIntersectsPolygon(label, shape, 3)).toBe(false);
    expect(rectangleIntersectsPolygon(label, shape, 4)).toBe(true);
  });
});

describe('visible identity for every custom bed', () => {
  it('preserves inside labels and crops for roomy beds without introducing external callouts', () => {
    const inputs = [bed(0, rectangle(180, 210, 133, 81), { empty: false }), bed(1, rectangle(360, 210, 133, 81))];
    const plan = planBedAnnotations(inputs, 1);
    expectEveryIdentityOnce(plan, inputs);
    expect(plan.legend).toEqual([]);
    expect(plan.beds.every(item => item.annotation && !item.external && item.leader === null)).toBe(true);
    expect(plan.beds[0].crops.length).toBeGreaterThanOrEqual(3);
  });

  it('gives a thin H-like bed a readable outside label instead of hiding its letter', () => {
    const inputs = [bed(7, rectangle(510, 210, 70, 16))];
    const plan = planBedAnnotations(inputs, 1);
    expectEveryIdentityOnce(plan, inputs);
    expect(plan.beds[0]).toMatchObject({ external: true, annotation: { mode: 'id', fontSize: 11, showTask: false } });
    expect(plan.beds[0].leader).not.toBeNull();
    expectNoLabelCollisions(plan, inputs);
  });

  it('keeps the planted sprite when a small G-like bed needs its ID moved outside', () => {
    const inputs = [bed(6, rectangle(340, 300, 36, 45), { hasTask: true, empty: false })];
    const plan = planBedAnnotations(inputs, 1);
    expectEveryIdentityOnce(plan, inputs);
    expect(plan.beds[0].external).toBe(true);
    expect(plan.beds[0].crops).toHaveLength(1);
    expect(plan.beds[0].crops[0]).toMatchObject({ width: 24, height: 24 });
    expectNoLabelCollisions(plan, inputs);
  });

  it.each([1, .4875, .4])('separates labels from small, concave, and nearby planted beds at scale %s', scale => {
    const inputs = [
      bed(0, polygon([180, 210], [325, 210], [325, 265], [240, 265], [240, 410], [180, 410]), { empty: false, hasTask: true }),
      bed(1, polygon([360, 210], [490, 210], [410, 255], [410, 240], [345, 265]), { empty: false }),
      bed(7, rectangle(510, 210, 60, 16)),
      bed(6, polygon([280, 300], [325, 295], [335, 340], [280, 350]), { empty: false, hasTask: true }),
      bed(8, polygon([390, 315], [460, 315], [450, 355], [390, 355])),
    ];
    const plan = planBedAnnotations(inputs, scale);
    expectEveryIdentityOnce(plan, inputs);
    expectNoLabelCollisions(plan, inputs);
    for (const item of plan.beds) {
      if (item.annotation) expect(item.annotation.fontSize * scale).toBeCloseTo(11);
    }
  });

  it('uses the nearest source edge for a short callout leader on otherwise clear ground', () => {
    const inputs = [bed(0, rectangle(300, 280, 80, 14))];
    const item = planBedAnnotations(inputs, 1).beds[0];
    expect(item.external).toBe(true);
    const line = item.leader!;
    expect(Math.hypot(line.to.x - line.from.x, line.to.y - line.from.y)).toBeLessThan(15);
    expect(line.from.x === 300 || line.from.x === 380 || line.from.y === 280 || line.from.y === 294).toBe(true);
  });

  it('falls back to visible legend items for 24 dense phone-sized beds rather than losing their IDs', () => {
    const inputs = Array.from({ length: 24 }, (_, slotId) => bed(slotId, rectangle(160 + slotId % 6 * 89, 194 + Math.floor(slotId / 6) * 61, 89, 61), { hasTask: slotId === 7 }));
    const plan = planBedAnnotations(inputs, .35);
    expectEveryIdentityOnce(plan, inputs);
    expect(plan.legend).toHaveLength(24);
    expect(plan.legend.find(item => item.slotId === 7)).toMatchObject({ label: 'H', hasTask: true });
    expect(plan.beds.every(item => item.annotation === null && item.leader === null)).toBe(true);
  });

  it('reserves already placed labels when several tiny beds share the same empty ground', () => {
    const inputs = [bed(0, rectangle(300, 260, 28, 12)), bed(1, rectangle(330, 260, 28, 12)), bed(2, rectangle(360, 260, 28, 12))];
    const plan = planBedAnnotations(inputs, .5);
    expectEveryIdentityOnce(plan, inputs);
    expect(plan.beds.filter(item => item.external)).toHaveLength(3);
    expectNoLabelCollisions(plan, inputs);
  });

  it('keeps invalid geometry represented in the legend and normalizes unusable render scales', () => {
    const inputs = [bed(0, []), bed(1, rectangle(300, 280, 80, 14))];
    const plan = planBedAnnotations(inputs, Number.NaN);
    expectEveryIdentityOnce(plan, inputs);
    expect(plan.legend).toContainEqual({ slotId: 0, label: 'A', hasTask: false });
    expect(planBedAnnotations(inputs, Number.NaN)).toEqual(planBedAnnotations(inputs, 1));
  });
});
