import type { LayoutPoint } from '../domain/orbitFarm-types';
import { planBedContent, rectanglesOverlap, type BedAnnotation, type ContentRectangle } from './orbitFarm-bed-content';

export interface AnnotatedBedInput {
  slotId: number;
  points: LayoutPoint[];
  label: string;
  hasTask: boolean;
  empty: boolean;
}

export interface BedLeader {
  from: LayoutPoint;
  to: LayoutPoint;
}

export interface AnnotatedBedPlan {
  slotId: number;
  annotation: BedAnnotation | null;
  crops: ContentRectangle[];
  external: boolean;
  leader: BedLeader | null;
}

export interface BedAnnotationPlan {
  beds: AnnotatedBedPlan[];
  legend: Array<{ slotId: number; label: string; hasTask: boolean }>;
}

const EPSILON = 1e-7;
const INNER_FIELD: ContentRectangle = { x: 160, y: 194, width: 534, height: 244 };
const NEAR_FIELD: ContentRectangle = { x: 140, y: 180, width: 595, height: 265 };
const cross = (a: LayoutPoint, b: LayoutPoint, p: LayoutPoint) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function onSegment(point: LayoutPoint, a: LayoutPoint, b: LayoutPoint): boolean {
  return Math.abs(cross(a, b, point)) <= EPSILON
    && point.x >= Math.min(a.x, b.x) - EPSILON && point.x <= Math.max(a.x, b.x) + EPSILON
    && point.y >= Math.min(a.y, b.y) - EPSILON && point.y <= Math.max(a.y, b.y) + EPSILON;
}

function pointInside(point: LayoutPoint, points: LayoutPoint[], includeBoundary = true): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j], b = points[i];
    if (onSegment(point, a, b)) return includeBoundary;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function segmentsTouch(a: LayoutPoint, b: LayoutPoint, c: LayoutPoint, d: LayoutPoint): boolean {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  if (((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON))
    && ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))) return true;
  return onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b);
}

function inflate(rect: ContentRectangle, margin: number): ContentRectangle {
  return { x: rect.x - margin, y: rect.y - margin, width: rect.width + margin * 2, height: rect.height + margin * 2 };
}

function corners(rect: ContentRectangle): LayoutPoint[] {
  return [{ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height }, { x: rect.x, y: rect.y + rect.height }];
}

function polygonBounds(points: LayoutPoint[]): ContentRectangle {
  const minX = Math.min(...points.map(point => point.x)), maxX = Math.max(...points.map(point => point.x));
  const minY = Math.min(...points.map(point => point.y)), maxY = Math.max(...points.map(point => point.y));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** True for any contact: callouts need clear ground, including their border margin. */
export function rectangleIntersectsPolygon(rect: ContentRectangle, points: LayoutPoint[], margin = 0): boolean {
  if (points.length < 3) return false;
  const box = inflate(rect, margin), bounds = polygonBounds(points);
  if (box.x > bounds.x + bounds.width + EPSILON || box.x + box.width < bounds.x - EPSILON
    || box.y > bounds.y + bounds.height + EPSILON || box.y + box.height < bounds.y - EPSILON) return false;
  const rectanglePoints = corners(box);
  if (rectanglePoints.some(point => pointInside(point, points))) return true;
  if (points.some(point => point.x >= box.x - EPSILON && point.x <= box.x + box.width + EPSILON
    && point.y >= box.y - EPSILON && point.y <= box.y + box.height + EPSILON)) return true;
  return points.some((point, index) => rectanglePoints.some((corner, edge) => segmentsTouch(point, points[(index + 1) % points.length], corner, rectanglePoints[(edge + 1) % rectanglePoints.length])));
}

function nearestBoundaryPoint(point: LayoutPoint, points: LayoutPoint[]): LayoutPoint {
  let best = points[0], bestDistance = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], dx = b.x - a.x, dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    const amount = length > EPSILON ? clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / length, 0, 1) : 0;
    const candidate = { x: a.x + amount * dx, y: a.y + amount * dy };
    const distance = (point.x - candidate.x) ** 2 + (point.y - candidate.y) ** 2;
    if (distance < bestDistance) { bestDistance = distance; best = candidate; }
  }
  return best;
}

function leaderFor(rect: ContentRectangle, points: LayoutPoint[]): BedLeader {
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const from = nearestBoundaryPoint(center, points), dx = from.x - center.x, dy = from.y - center.y;
  const fraction = Math.min(Math.abs(dx) > EPSILON ? rect.width / 2 / Math.abs(dx) : Infinity,
    Math.abs(dy) > EPSILON ? rect.height / 2 / Math.abs(dy) : Infinity);
  return { from, to: { x: center.x + dx * fraction, y: center.y + dy * fraction } };
}

/** Split a leader at boundary crossings and inspect each open interval, including vertex crossings. */
function leaderCrossesInterior(leader: BedLeader, points: LayoutPoint[]): boolean {
  const a = leader.from, b = leader.to, dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
  if (length <= EPSILON) return false;
  const parameters = [0, 1];
  for (let i = 0; i < points.length; i++) {
    const c = points[i], d = points[(i + 1) % points.length], ex = d.x - c.x, ey = d.y - c.y;
    const denominator = dx * ey - dy * ex;
    if (Math.abs(denominator) > EPSILON) {
      const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / denominator;
      const u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / denominator;
      if (t >= -EPSILON && t <= 1 + EPSILON && u >= -EPSILON && u <= 1 + EPSILON) parameters.push(clamp(t, 0, 1));
    } else if (Math.abs(cross(a, b, c)) <= EPSILON) {
      for (const point of [c, d]) {
        const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / length;
        if (t >= 0 && t <= 1) parameters.push(t);
      }
    }
  }
  parameters.sort((first, second) => first - second);
  return parameters.some((value, index) => {
    const next = parameters[index + 1];
    if (next === undefined || next - value <= EPSILON) return false;
    const t = (value + next) / 2;
    return pointInside({ x: a.x + dx * t, y: a.y + dy * t }, points, false);
  });
}

function fitsRegion(rect: ContentRectangle, region: ContentRectangle, margin: number): boolean {
  return rect.x >= region.x + margin - EPSILON && rect.y >= region.y + margin - EPSILON
    && rect.x + rect.width <= region.x + region.width - margin + EPSILON
    && rect.y + rect.height <= region.y + region.height - margin + EPSILON;
}

function calloutCandidates(points: LayoutPoint[], width: number, height: number, margin: number, region: ContentRectangle): ContentRectangle[] {
  const bounds = polygonBounds(points), result: ContentRectangle[] = [];
  const add = (x: number, y: number) => {
    const rect = { x, y, width, height };
    if (fitsRegion(rect, region, margin)) result.push(rect);
  };
  // Try nearby cardinal positions first, including locations aligned with individual corners.
  const xAnchors = [bounds.x + bounds.width / 2, ...points.map(point => point.x)];
  const yAnchors = [bounds.y + bounds.height / 2, ...points.map(point => point.y)];
  for (const gap of [margin * 1.5, margin * 1.5 + 12, margin * 1.5 + 28]) {
    for (const y of yAnchors) {
      add(bounds.x - width - gap, y - height / 2);
      add(bounds.x + bounds.width + gap, y - height / 2);
    }
    for (const x of xAnchors) {
      add(x - width / 2, bounds.y - height - gap);
      add(x - width / 2, bounds.y + bounds.height + gap);
    }
  }
  // This grid is bounded by the field and becomes coarser as screen-space labels grow.
  const stepX = Math.max(12, width / 2), stepY = Math.max(12, height / 2);
  const availableX = region.width - margin * 2 - width, availableY = region.height - margin * 2 - height;
  if (availableX >= 0 && availableY >= 0) {
    const columns = Math.min(48, Math.max(1, Math.ceil(availableX / stepX)));
    const rows = Math.min(24, Math.max(1, Math.ceil(availableY / stepY)));
    for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
      add(region.x + margin + availableX * x / columns, region.y + margin + availableY * y / rows);
    }
  }
  return result;
}

function findCallout(source: AnnotatedBedInput, beds: AnnotatedBedInput[], occupied: ContentRectangle[], scale: number): { annotation: BedAnnotation; leader: BedLeader } | null {
  if (source.points.length < 3 || !source.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))) return null;
  const text = source.label.trim() || String(source.slotId);
  const width = Math.max(22, Math.ceil(text.length * 11 + 2 * 11 * .55)) / scale, height = 22 / scale;
  const margin = Math.max(4, 2 / scale);
  for (const region of [INNER_FIELD, NEAR_FIELD]) {
    const available = calloutCandidates(source.points, width, height, margin, region).filter(rect =>
      !occupied.some(other => rectanglesOverlap(rect, other, margin))
      && !beds.some(bed => rectangleIntersectsPolygon(rect, bed.points, margin)));
    const ranked = available.map(rect => {
      const leader = leaderFor(rect, source.points);
      return { rect, leader, distance: (leader.to.x - leader.from.x) ** 2 + (leader.to.y - leader.from.y) ** 2 };
    }).sort((first, second) => first.distance - second.distance);
    let fallback: typeof ranked[number] | null = null, fewestCrossings = Infinity;
    for (const candidate of ranked) {
      const crossings = beds.reduce((count, bed) => count + (leaderCrossesInterior(candidate.leader, bed.points) ? 1 : 0), 0)
        + occupied.reduce((count, rect) => count + (leaderCrossesInterior(candidate.leader, corners(rect)) ? 1 : 0), 0);
      if (crossings < fewestCrossings) { fallback = candidate; fewestCrossings = crossings; }
      if (crossings === 0) break;
    }
    if (fallback) {
      return { annotation: { ...fallback.rect, fontSize: 11 / scale, mode: 'id', showTask: false }, leader: fallback.leader };
    }
  }
  return null;
}

/** Every bed receives one readable canvas label or one visible legend item, never a hidden identity. */
export function planBedAnnotations(beds: AnnotatedBedInput[], pixelsPerUnit: number): BedAnnotationPlan {
  const scale = Number.isFinite(pixelsPerUnit) && pixelsPerUnit > 0 ? clamp(pixelsPerUnit, .1, 3) : 1;
  const result: BedAnnotationPlan = {
    beds: beds.map(bed => ({ slotId: bed.slotId, ...planBedContent(bed.points, { pixelsPerUnit: scale, label: bed.label, hasTask: bed.hasTask, empty: bed.empty }), external: false, leader: null })),
    legend: [],
  };
  const occupied = result.beds.flatMap(bed => bed.annotation ? [bed.annotation] : []);
  for (let index = 0; index < beds.length; index++) {
    const input = beds[index], planned = result.beds[index];
    if (planned.annotation) continue;
    const callout = findCallout(input, beds, occupied, scale);
    if (callout) {
      planned.annotation = callout.annotation; planned.external = true; planned.leader = callout.leader;
      occupied.push(callout.annotation);
    } else result.legend.push({ slotId: input.slotId, label: input.label, hasTask: input.hasTask });
  }
  return result;
}
