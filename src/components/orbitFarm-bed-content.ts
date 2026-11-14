import type { LayoutPoint } from '../domain/orbitFarm-types';

export interface ContentRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BedAnnotation extends ContentRectangle {
  fontSize: number;
  mode: 'full' | 'compact' | 'id';
  showTask: boolean;
  showPlus: boolean;
}

export interface BedContentPlan {
  annotation: BedAnnotation | null;
  crops: ContentRectangle[];
}

export interface BedContentOptions {
  pixelsPerUnit: number;
  label: string;
  hasTask: boolean;
  empty: boolean;
}

const EPSILON = 1e-7;
const cross = (a: LayoutPoint, b: LayoutPoint, p: LayoutPoint) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);

function onSegment(p: LayoutPoint, a: LayoutPoint, b: LayoutPoint): boolean {
  return Math.abs(cross(a, b, p)) <= EPSILON
    && p.x >= Math.min(a.x, b.x) - EPSILON && p.x <= Math.max(a.x, b.x) + EPSILON
    && p.y >= Math.min(a.y, b.y) - EPSILON && p.y <= Math.max(a.y, b.y) + EPSILON;
}

function containsPoint(points: LayoutPoint[], p: LayoutPoint): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j], b = points[i];
    if (onSegment(p, a, b)) return true;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function inflated(rect: ContentRectangle, padding: number): ContentRectangle {
  return { x: rect.x - padding, y: rect.y - padding, width: rect.width + padding * 2, height: rect.height + padding * 2 };
}

/** Whether any positive segment length enters the open rectangle, excluding edge contact. */
function edgeEntersRectangle(a: LayoutPoint, b: LayoutPoint, rect: ContentRectangle): boolean {
  let first = 0, last = 1;
  for (const [origin, delta, low, high] of [
    [a.x, b.x - a.x, rect.x + EPSILON, rect.x + rect.width - EPSILON],
    [a.y, b.y - a.y, rect.y + EPSILON, rect.y + rect.height - EPSILON],
  ]) {
    if (Math.abs(delta) <= EPSILON) {
      if (origin <= low || origin >= high) return false;
      continue;
    }
    const start = (low - origin) / delta, end = (high - origin) / delta;
    first = Math.max(first, Math.min(start, end));
    last = Math.min(last, Math.max(start, end));
    if (last - first <= EPSILON) return false;
  }
  return last - first > EPSILON;
}

/** Corners alone are insufficient: a concave notch can cut through their rectangle. */
export function rectInsidePolygon(rect: ContentRectangle, points: LayoutPoint[], padding = 0): boolean {
  if (points.length < 3 || ![rect.x, rect.y, rect.width, rect.height, padding].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0 || padding < 0) return false;
  const box = inflated(rect, padding);
  const corners = [
    { x: box.x, y: box.y }, { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height }, { x: box.x, y: box.y + box.height },
  ];
  if (!corners.every(point => containsPoint(points, point))) return false;
  return !points.some((point, index) => edgeEntersRectangle(point, points[(index + 1) % points.length], box));
}

export function rectanglesOverlap(a: ContentRectangle, b: ContentRectangle, padding = 0): boolean {
  return a.x < b.x + b.width + padding - EPSILON && a.x + a.width > b.x - padding + EPSILON
    && a.y < b.y + b.height + padding - EPSILON && a.y + a.height > b.y - padding + EPSILON;
}

function bounds(points: LayoutPoint[]) {
  const minX = Math.min(...points.map(point => point.x)), maxX = Math.max(...points.map(point => point.x));
  const minY = Math.min(...points.map(point => point.y)), maxY = Math.max(...points.map(point => point.y));
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

function candidates(points: LayoutPoint[], width: number, height: number, margin: number): LayoutPoint[] {
  const box = bounds(points), halfWidth = width / 2, halfHeight = height / 2;
  const left = box.minX + halfWidth + margin, right = box.maxX - halfWidth - margin;
  const top = box.minY + halfHeight + margin, bottom = box.maxY - halfHeight - margin;
  if (right < left - EPSILON || bottom < top - EPSILON) return [];
  const result: LayoutPoint[] = [{ x: (left + right) / 2, y: bottom }, { x: (left + right) / 2, y: (top + bottom) / 2 }];
  for (let xi = 0; xi <= 20; xi++) for (let yi = 0; yi <= 20; yi++) {
    result.push({ x: left + (right - left) * xi / 20, y: top + (bottom - top) * yi / 20 });
  }
  let areaTwice = 0, centroidX = 0, centroidY = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const factor = a.x * b.y - b.x * a.y;
    areaTwice += factor; centroidX += (a.x + b.x) * factor; centroidY += (a.y + b.y) * factor;
    for (const dx of [-1, 1]) for (const dy of [-1, 1]) result.push({ x: a.x + dx * (halfWidth + margin), y: a.y + dy * (halfHeight + margin) });
  }
  if (Math.abs(areaTwice) > EPSILON) result.push({ x: centroidX / (3 * areaTwice), y: centroidY / (3 * areaTwice) });
  return result;
}

function findRectangle(points: LayoutPoint[], width: number, height: number, margin: number, excluded?: ContentRectangle): ContentRectangle | null {
  const box = bounds(points);
  const preferred = { x: (box.minX + box.maxX) / 2, y: box.maxY - height / 2 - margin };
  let best: ContentRectangle | null = null, score = Infinity;
  for (const center of candidates(points, width, height, margin)) {
    const rect = { x: center.x - width / 2, y: center.y - height / 2, width, height };
    if (!rectInsidePolygon(rect, points, margin) || (excluded && rectanglesOverlap(rect, excluded, margin))) continue;
    const nextScore = (center.y - preferred.y) ** 2 + (center.x - preferred.x) ** 2 * .35;
    if (nextScore < score - EPSILON) { score = nextScore; best = rect; }
  }
  return best;
}

/** Content uses world coordinates; text retains an eleven-pixel screen size as the scene resizes. */
export function planBedContent(points: LayoutPoint[], options: BedContentOptions): BedContentPlan {
  const emptyPlan = { annotation: null, crops: [] } satisfies BedContentPlan;
  if (points.length < 3 || !points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))) return emptyPlan;
  const areaTwice = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
  if (!Number.isFinite(areaTwice) || Math.abs(areaTwice) <= EPSILON) return emptyPlan;

  const scale = Number.isFinite(options.pixelsPerUnit) && options.pixelsPerUnit > 0 ? Math.max(.1, Math.min(3, options.pixelsPerUnit)) : 1;
  const margin = Math.max(4, 2 / scale);
  const text = options.label.trim() || '?';
  const fontSize = 11 / scale, height = 22 / scale;
  const textWidth = Math.max(22, Math.ceil(text.length * 11 + 2 * 11 * .55));
  const wantsIcon = options.hasTask || options.empty;
  const modes: Array<'compact' | 'id'> = wantsIcon ? ['compact', 'id'] : ['id'];
  const annotations: BedAnnotation[] = [];
  for (const mode of modes) {
    const width = (textWidth + (mode === 'compact' ? 17 : 0)) / scale;
    const rect = findRectangle(points, width, height, margin);
    if (rect) {
      annotations.push({ ...rect, fontSize, mode, showTask: mode === 'compact' && options.hasTask, showPlus: mode === 'compact' && !options.hasTask && options.empty });
    }
  }
  if (options.empty) return { annotation: annotations[0] ?? null, crops: [] };

  const box = bounds(points);
  const availableWidth = Math.max(0, box.width - margin * 2), availableHeight = Math.max(0, box.height - margin * 2);
  const cols = Math.min(64, Math.max(1, Math.floor(availableWidth / 40))), rows = Math.min(64, Math.max(1, Math.floor(availableHeight / 34)));
  function planCrops(annotation: BedAnnotation | null): ContentRectangle[] {
    const reserved = annotation ? inflated(annotation, margin) : undefined;
    const crops: ContentRectangle[] = [];
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const rect = { x: box.minX + margin + availableWidth * (col + .5) / cols - 17, y: box.minY + margin + availableHeight * (row + .5) / rows - 17, width: 34, height: 34 };
      if (rectInsidePolygon(rect, points, margin) && (!reserved || !rectanglesOverlap(rect, reserved))) crops.push(rect);
    }
    if (!crops.length) {
      for (const size of [24, 16]) {
        const rect = findRectangle(points, size, size, margin, reserved);
        if (rect) { crops.push(rect); break; }
      }
    }
    return crops;
  }
  // A badge must not erase the only visible indication that a bed is planted.
  for (const annotation of [...annotations, null]) {
    const crops = planCrops(annotation);
    if (crops.length) return { annotation, crops };
  }
  return { annotation: annotations[0] ?? null, crops: [] };
}
