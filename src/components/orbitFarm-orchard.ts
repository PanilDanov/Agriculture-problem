import type { SeasonBlend } from './orbitFarm-seasons';

type Point = readonly [number, number];
type Color = readonly [number, number, number];
type Lobe = readonly [x: number, y: number, radiusX: number, radiusY: number];
type CrownDetail = { center: Point; startsAt: number };

const OLIVE = { x: 243, y: 62 };
const CROWN = { x: -24, y: -48, width: 48, height: 45 };

const OLIVE_CROWN: readonly Lobe[] = [
  [-10, -26, 12, 8], [3, -31, 14, 10], [10, -23, 9, 7], [-2, -22, 15, 8],
];

const OLIVE_LEAVES: readonly Color[] = [[44, 73, 65], [63, 94, 78], [88, 123, 96], [124, 153, 118], [160, 176, 136]];
const OLIVES: readonly CrownDetail[] = [
  { center: [-10, -25], startsAt: .16 }, { center: [4, -32], startsAt: .36 },
  { center: [10, -24], startsAt: .26 },
];

function ease(value: number, start: number, end: number) {
  const t = Math.min(1, Math.max(0, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

function nearestLobe(px: number, py: number, lobes: readonly Lobe[]) {
  let nearest = Infinity;
  for (const [cx, cy, rx, ry] of lobes) {
    const dx = (px - cx) / rx;
    const dy = (py - cy) / ry;
    nearest = Math.min(nearest, dx * dx + dy * dy);
  }
  return nearest;
}

function canopyTexture(lobes: readonly Lobe[]) {
  const { width, height, x, y } = CROWN;
  const mask = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      if (nearestLobe(x + column, y + row, lobes) <= 1) mask[row * width + column] = 1;
    }
  }

  // Join the olive crown lobes into a solid pixel silhouette.
  const sky = [0];
  mask[0] = 2;
  for (let head = 0; head < sky.length; head++) {
    const pixel = sky[head];
    const column = pixel % width;
    const neighbors = [
      column > 0 ? pixel - 1 : -1,
      column < width - 1 ? pixel + 1 : -1,
      pixel - width,
      pixel + width,
    ];
    for (const neighbor of neighbors) {
      if (mask[neighbor] !== 0) continue;
      mask[neighbor] = 2;
      sky.push(neighbor);
    }
  }

  const tones = new Uint8Array(mask.length);
  for (let index = 0; index < tones.length; index++) {
    if (mask[index] === 2) continue;
    if (mask[index - 1] === 2 || mask[index + 1] === 2
      || mask[index - width] === 2 || mask[index + width] === 2) {
      tones[index] = 1;
      continue;
    }
    const column = index % width;
    const row = Math.floor(index / width);
    const light = nearestLobe(x + column + 3, y + row + 3, lobes);
    const tileX = Math.floor(column / 2), tileY = Math.floor(row / 2);
    const grain = ((tileX * 47) ^ (tileY * 71) ^ (tileX * tileY * 11)) % 23;
    if (light < .48) tones[index] = grain < 4 ? 5 : 4;
    else if (light < .74) tones[index] = grain < 3 ? 2 : 3;
    else tones[index] = 2;
  }
  return tones;
}

function pixelLine(context: CanvasRenderingContext2D, x: number, y: number, start: Point, end: Point, width: number, color: string) {
  const steps = Math.max(Math.abs(end[0] - start[0]), Math.abs(end[1] - start[1]), 1);
  context.fillStyle = color;
  for (let step = 0; step <= steps; step++) {
    const px = Math.round(start[0] + (end[0] - start[0]) * step / steps);
    const py = Math.round(start[1] + (end[1] - start[1]) * step / steps);
    context.fillRect(x + px - Math.floor(width / 2), y + py, width, 1);
  }
}

function paintOliveTrunk(context: CanvasRenderingContext2D) {
  const { x, y } = OLIVE;
  context.fillStyle = '#4e59353c';
  context.fillRect(x - 9, y, 18, 3);
  context.fillRect(x - 6, y + 3, 12, 1);

  pixelLine(context, x, y, [-2, 0], [-4, -10], 7, '#473e31');
  pixelLine(context, x, y, [-4, -10], [2, -21], 6, '#473e31');
  pixelLine(context, x, y, [-3, -1], [-5, -10], 2, '#a17e56');
  pixelLine(context, x, y, [-4, -10], [1, -20], 2, '#a17e56');
}

function paintMarks(
  pixels: Uint8ClampedArray, texture: Uint8Array, marks: readonly CrownDetail[],
  amount: number, skin: Color, highlight: Color,
) {
  for (const { center, startsAt } of marks) {
    const scale = ease(amount, startsAt, startsAt + .56);
    if (scale === 0) continue;
    const radius = Math.round(2 * scale);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > radius + 1) continue;
        const x = center[0] + dx - CROWN.x;
        const y = center[1] + dy - CROWN.y;
        const pixel = y * CROWN.width + x;
        if (texture[pixel] < 2) continue;
        pixels.set(dx <= 0 && dy <= 0 ? highlight : skin, pixel * 4);
      }
    }
  }
}

export function createOrchardPainter(context: CanvasRenderingContext2D) {
  const wood = document.createElement('canvas');
  wood.width = context.canvas.width;
  wood.height = 70;
  paintOliveTrunk(wood.getContext('2d')!);

  const sprite = document.createElement('canvas');
  sprite.width = CROWN.width;
  sprite.height = CROWN.height;
  const surface = sprite.getContext('2d')!;
  const frame = surface.createImageData(sprite.width, sprite.height);
  const oliveTexture = canopyTexture(OLIVE_CROWN);

  function fillCrown(texture: Uint8Array, palette: readonly Color[]) {
    frame.data.fill(0);
    for (let index = 0; index < texture.length; index++) {
      const tone = texture[index];
      if (tone === 0) continue;
      frame.data.set(palette[tone - 1], index * 4);
      frame.data[index * 4 + 3] = 255;
    }
  }

  return (blend: SeasonBlend) => {
    context.drawImage(wood, 0, 0);
    const olivePalette = OLIVE_LEAVES.map(([r, g, b]): Color => [
      r + blend.autumn * 6 - blend.winter * 4,
      g + blend.spring * 5 - blend.winter * 5,
      b + blend.winter * 5 - blend.autumn * 4,
    ]);
    fillCrown(oliveTexture, olivePalette);
    const olives = blend.autumn * .84 + blend.summer * .25;
    paintMarks(frame.data, oliveTexture, OLIVES, olives, [62, 75, 54], [133, 142, 86]);
    surface.putImageData(frame, 0, 0);
    context.drawImage(sprite, OLIVE.x + CROWN.x, OLIVE.y + CROWN.y);
  };
}
