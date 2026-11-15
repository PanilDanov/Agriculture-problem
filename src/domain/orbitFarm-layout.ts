import { z } from 'zod';
import type { FarmLayout, LayoutPoint } from './orbitFarm-types';

export const LAYOUT_WIDTH = 24;
export const LAYOUT_HEIGHT = 12;
export const MAX_LAYOUT_BEDS = 24;
export const MAX_BED_CORNERS = 32;
const EPSILON = 1e-8;

export interface BedValidationResult {
  valid: boolean;
  errors: string[];
  area: number;
}

export function getPlotLabel(slotId: number): string {
  if (!Number.isSafeInteger(slotId) || slotId < 0) return 'Plot';
  let value = slotId + 1;
  let letters = '';
  while (value > 0) {
    value -= 1;
    letters = String.fromCharCode(65 + value % 26) + letters;
    value = Math.floor(value / 26);
  }
  return `Plot ${letters}`;
}

export function getBedName(layout: FarmLayout, slotId: number): string {
  return layout.beds.find(bed => bed.slotId === slotId)?.name ?? getPlotLabel(slotId);
}

export function createDefaultLayout(): FarmLayout {
  return {
    width: LAYOUT_WIDTH,
    height: LAYOUT_HEIGHT,
    beds: [{ slotId: 0, name: 'Whole field', points: [{ x: 0, y: 0 }, { x: LAYOUT_WIDTH, y: 0 }, { x: LAYOUT_WIDTH, y: LAYOUT_HEIGHT }, { x: 0, y: LAYOUT_HEIGHT }] }],
  };
}

// Existing demonstration farms and version-one saves use these six stable slots.
export function createDemoLayout(): FarmLayout {
  return {
    width: LAYOUT_WIDTH,
    height: LAYOUT_HEIGHT,
    beds: Array.from({ length: 6 }, (_, slotId) => {
      const x = 1 + slotId % 3 * 8;
      const y = 1 + Math.floor(slotId / 3) * 6;
      return { slotId, name: getPlotLabel(slotId), points: [{ x, y }, { x: x + 6, y }, { x: x + 6, y: y + 4 }, { x, y: y + 4 }] };
    }),
  };
}

const cross = (a: LayoutPoint, b: LayoutPoint, c: LayoutPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const equalPoint = (a: LayoutPoint, b: LayoutPoint) => Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON;
const between = (a: number, b: number, value: number) => value >= Math.min(a, b) - EPSILON && value <= Math.max(a, b) + EPSILON;
const onSegment = (a: LayoutPoint, b: LayoutPoint, point: LayoutPoint) => Math.abs(cross(a, b, point)) <= EPSILON && between(a.x, b.x, point.x) && between(a.y, b.y, point.y);

function segmentsIntersect(a: LayoutPoint, b: LayoutPoint, c: LayoutPoint, d: LayoutPoint): boolean {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  if (((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON)) && ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))) return true;
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

function signedArea(points: LayoutPoint[]): number {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function polygonErrors(points: LayoutPoint[]): string[] {
  const errors: string[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (equalPoint(points[i], points[j])) return ['Each corner must be unique. The bed closes automatically.'];
    }
    const previous = points[(i + points.length - 1) % points.length];
    const next = points[(i + 1) % points.length];
    if (Math.abs(cross(previous, points[i], next)) <= EPSILON && !onSegment(previous, next, points[i])) return ['Bed edges must not double back on themselves.'];
  }
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      if (segmentsIntersect(points[i], points[(i + 1) % points.length], points[j], points[(j + 1) % points.length])) return ['The bed crosses or touches itself. Move a corner to keep a simple shape.'];
    }
  }
  const area = Math.abs(signedArea(points));
  if (area < 1 - EPSILON) errors.push('A bed must cover at least one planning square.');
  if (!errors.length) {
    const triangles = triangulate(points);
    const coveredArea = triangles.reduce((sum, triangle) => sum + Math.abs(signedArea(triangle)), 0);
    if (!triangles.length || Math.abs(coveredArea - area) > EPSILON * 100) errors.push('This shape cannot be checked safely. Move a corner and try again.');
  }
  return errors;
}

export const layoutPointSchema = z.object({
  x: z.number().finite().min(0, 'Keep every corner inside the planning area.').max(LAYOUT_WIDTH, 'Keep every corner inside the planning area.'),
  y: z.number().finite().min(0, 'Keep every corner inside the planning area.').max(LAYOUT_HEIGHT, 'Keep every corner inside the planning area.'),
}).strict();

export const bedPolygonSchema = z.array(layoutPointSchema).min(3, 'Place at least three corners.').max(MAX_BED_CORNERS, `Use at most ${MAX_BED_CORNERS} corners per bed.`).superRefine((points, ctx) => {
  for (const message of polygonErrors(points)) ctx.addIssue({ code: 'custom', message });
});

export function validateBedPolygon(points: unknown): BedValidationResult {
  const parsed = bedPolygonSchema.safeParse(points);
  return parsed.success
    ? { valid: true, errors: [], area: Math.abs(signedArea(parsed.data)) }
    : { valid: false, errors: parsed.error.issues.map(issue => issue.message), area: 0 };
}

/** A partial bed or one bed among several cannot establish whole-field crop history. */
export function isWholeFieldLayout(layout: FarmLayout): boolean {
  if (layout.beds.length !== 1) return false;
  const bed = validateBedPolygon(layout.beds[0].points);
  return bed.valid && Math.abs(bed.area - LAYOUT_WIDTH * LAYOUT_HEIGHT) <= EPSILON;
}

function triangulate(points: LayoutPoint[]): LayoutPoint[][] {
  const vertices = points.filter((point, index) => !onSegment(points[(index + points.length - 1) % points.length], points[(index + 1) % points.length], point));
  if (signedArea(vertices) < 0) vertices.reverse();
  const triangles: LayoutPoint[][] = [];
  while (vertices.length > 3) {
    let found = false;
    for (let i = 0; i < vertices.length; i++) {
      const previous = vertices[(i + vertices.length - 1) % vertices.length];
      const current = vertices[i];
      const next = vertices[(i + 1) % vertices.length];
      if (cross(previous, current, next) <= EPSILON) continue;
      if (vertices.some((point, index) => index !== i && index !== (i + 1) % vertices.length && index !== (i + vertices.length - 1) % vertices.length && cross(previous, current, point) >= -EPSILON && cross(current, next, point) >= -EPSILON && cross(next, previous, point) >= -EPSILON)) continue;
      triangles.push([previous, current, next]);
      vertices.splice(i, 1);
      found = true;
      break;
    }
    if (!found) return [];
  }
  if (vertices.length === 3) triangles.push(vertices);
  return triangles;
}

function lineIntersection(a: LayoutPoint, b: LayoutPoint, c: LayoutPoint, d: LayoutPoint): LayoutPoint {
  const denominator = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(denominator) <= EPSILON) return a;
  const fraction = Math.max(0, Math.min(1, ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / denominator));
  return { x: a.x + fraction * (b.x - a.x), y: a.y + fraction * (b.y - a.y) };
}

function triangleIntersectionArea(subject: LayoutPoint[], clip: LayoutPoint[]): number {
  let output = subject;
  for (let edge = 0; edge < clip.length && output.length; edge++) {
    const a = clip[edge], b = clip[(edge + 1) % clip.length];
    const input = output;
    output = [];
    let previous = input[input.length - 1];
    for (const point of input) {
      const inside = cross(a, b, point) >= -EPSILON;
      const previousInside = cross(a, b, previous) >= -EPSILON;
      if (inside !== previousInside) output.push(lineIntersection(previous, point, a, b));
      if (inside) output.push(point);
      previous = point;
    }
  }
  return output.length >= 3 ? Math.abs(signedArea(output)) : 0;
}

/** True only for a shared interior; touching boundaries do not occupy the same bed area. */
export function polygonsOverlap(a: LayoutPoint[], b: LayoutPoint[]): boolean {
  if (!a.length || !b.length) return false;
  const xOverlap = Math.min(Math.max(...a.map(p => p.x)), Math.max(...b.map(p => p.x))) - Math.max(Math.min(...a.map(p => p.x)), Math.min(...b.map(p => p.x)));
  const yOverlap = Math.min(Math.max(...a.map(p => p.y)), Math.max(...b.map(p => p.y))) - Math.max(Math.min(...a.map(p => p.y)), Math.min(...b.map(p => p.y)));
  if (xOverlap <= EPSILON || yOverlap <= EPSILON) return false;
  const aTriangles = triangulate(a), bTriangles = triangulate(b);
  return aTriangles.some(first => bTriangles.some(second => triangleIntersectionArea(first, second) > EPSILON));
}

export const farmLayoutSchema = z.object({
  width: z.literal(LAYOUT_WIDTH),
  height: z.literal(LAYOUT_HEIGHT),
  beds: z.array(z.object({
    slotId: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
    name: z.string().trim().min(1, 'Give each bed a name.').max(40, 'Use at most 40 characters for a bed name.'),
    points: bedPolygonSchema,
  }).strict()).max(MAX_LAYOUT_BEDS, `Use at most ${MAX_LAYOUT_BEDS} beds.`),
}).strict().superRefine((layout, ctx) => {
  if (new Set(layout.beds.map(bed => bed.slotId)).size !== layout.beds.length) ctx.addIssue({ code: 'custom', message: 'Bed identifiers must be unique.' });
  for (let i = 0; i < layout.beds.length; i++) {
    for (let j = i + 1; j < layout.beds.length; j++) {
      if (polygonsOverlap(layout.beds[i].points, layout.beds[j].points)) ctx.addIssue({ code: 'custom', message: `${layout.beds[i].name} overlaps ${layout.beds[j].name}. Keep their interiors separate.` });
    }
  }
});

export function validateFarmLayout(layout: unknown): { valid: boolean; errors: string[] } {
  const parsed = farmLayoutSchema.safeParse(layout);
  return parsed.success ? { valid: true, errors: [] } : { valid: false, errors: parsed.error.issues.map(issue => issue.message) };
}
