import type { SeasonBlend } from './orbitFarm-seasons';
import { createOrchardPainter } from './orbitFarm-orchard';

export const ORCHARD = { x: 178, y: 17, width: 82, height: 49 };
const TREE_SPLIT = 220 - ORCHARD.x;
const ORCHARD_GRASS_ROW = 48;
const CLEARING_COLUMNS = [217, 219, 224, 214];
const SHRUBS = [
  { x: 30, y: 47, left: 19, right: 41, top: 39, bottom: 52, berries: true },
  { x: 315, y: 44, left: 306, right: 321, top: 36, bottom: 49, berries: false },
  { x: 374, y: 64, left: 366, right: 382, top: 58, bottom: 70, berries: false },
  { x: 368, y: 107, left: 359, right: 379, top: 100, bottom: 113, berries: true },
  { x: 366, y: 188, left: 356, right: 374, top: 180, bottom: 194, berries: true },
  { x: 26, y: 210, left: 20, right: 33, top: 203, bottom: 214, berries: true },
  { x: 61, y: 210, left: 56, right: 68, top: 204, bottom: 215, berries: false },
];

export function getOrchardMask(source: ImageData) {
  const mask = new Uint8Array(ORCHARD.width * ORCHARD.height);
  // Keep the original left fruit tree; only replace the right tree with the olive.
  const treeBounds = [[TREE_SPLIT, ORCHARD.width]];
  for (let row = 0; row < ORCHARD.height; row++) {
    const y = ORCHARD.y + row;
    const rowOffset = row * ORCHARD.width;
    for (const [start, end] of treeBounds) {
      let first = end;
      let last = start - 1;
      for (let column = start; column < end; column++) {
        const x = ORCHARD.x + column;
        const offset = (source.width * y + x) * 4;
        const r = source.data[offset], g = source.data[offset + 1], b = source.data[offset + 2];
        if (source.data[offset + 3] < 128) continue;
        if (y >= 53) {
          const trunkOrShadow = (x >= 189 && x <= 214) || (x >= 227 && x <= 256);
          if (trunkOrShadow && g < 185) mask[rowOffset + column] = 1;
          continue;
        }
        if (r > g + 19 || (g > r + 7 && g > b + 11 && (y < ORCHARD_GRASS_ROW || g < 189))) {
          first = Math.min(first, column);
          last = column;
        }
      }
      mask.fill(1, rowOffset + first, rowOffset + last + 1);
    }
  }
  return mask;
}

export function orchardGrassSample(x: number, y: number, source: ImageData) {
  const mound = (x >= 193 && x <= 206) || (x >= 226 && x <= 238);
  const edge = x >= 250 ? 45 : mound ? 47 : ORCHARD_GRASS_ROW;
  if (y < edge) return -1;
  const row = Math.max(ORCHARD_GRASS_ROW, y) * source.width;
  for (const column of CLEARING_COLUMNS) {
    const offset = (row + column) * 4;
    if (source.data[offset + 1] > 185 && source.data[offset] > 148) return offset;
  }
  return (source.width * 66 + 212) * 4;
}

export function findShrub(x: number, y: number) {
  if (x > 70 && x < 300) return undefined;
  return SHRUBS.find(shrub => x >= shrub.left && x <= shrub.right && y >= shrub.top && y <= shrub.bottom);
}

function drawFlower(context: CanvasRenderingContext2D, x: number, y: number, pale: boolean) {
  context.fillStyle = pale ? '#FFF0CF' : '#EAA59B';
  context.fillRect(x - 2, y, 5, 2);
  context.fillRect(x, y - 2, 2, 5);
  context.fillStyle = '#DBA369';
  context.fillRect(x, y, 1, 1);
}

function drawFruit(context: CanvasRenderingContext2D, x: number, y: number, ripe: boolean) {
  context.fillStyle = ripe ? '#9C4731' : '#567A3D';
  context.fillRect(x - 1, y - 2, 3, 1);
  context.fillRect(x - 2, y - 1, 5, 3);
  context.fillRect(x - 1, y + 2, 3, 1);
  context.fillStyle = ripe ? '#E47848' : '#A4B85A';
  context.fillRect(x - 1, y - 1, 3, 3);
  context.fillStyle = ripe ? '#F6AC64' : '#C5CF76';
  context.fillRect(x - 1, y - 1, 1, 1);
}

const SHRUB_TIPS = [[-5, -2], [2, -4], [5, 1], [-2, 3], [2, 4]];

function drawShrubs(context: CanvasRenderingContext2D, blend: SeasonBlend) {
  for (const [index, shrub] of SHRUBS.entries()) {
    for (const [tip, [dx, dy]] of SHRUB_TIPS.entries()) {
      const x = shrub.x + dx;
      const y = shrub.y + dy;
      const threshold = .18 + ((tip + index) % SHRUB_TIPS.length) * .13;
      if (blend.spring > threshold && blend.summer < .45) {
        drawFlower(context, x, y, !shrub.berries || tip % 2 === 0);
      } else if (shrub.berries && blend.summer + blend.autumn + blend.winter * .27 > threshold) {
        drawFruit(context, x, y, blend.autumn + blend.winter > .3 || tip % 2 === 0);
      } else if (blend.spring + blend.summer + blend.autumn > threshold) {
        context.fillStyle = blend.autumn > .4 ? '#BD8A49' : '#8CAF55';
        context.fillRect(x - 1, y, 3, 1);
        context.fillRect(x, y - 1, 2, 1);
      }
    }
  }
}

export function createVegetationPainter(context: CanvasRenderingContext2D) {
  const paintOrchard = createOrchardPainter(context);
  return (blend: SeasonBlend) => {
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    paintOrchard(blend);
    drawShrubs(context, blend);
    if (blend.autumn > .33) drawFruit(context, 206, 69, true);
    if (blend.autumn > .69) drawFruit(context, 182, 65, true);
  };
}
