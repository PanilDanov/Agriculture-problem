import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FarmLayout, LayoutPoint, Plot } from '../domain/orbitFarm-types';
import { getPlotLabel } from '../domain/orbitFarm-layout';
import { getGrowthStage } from '../domain/orbitFarm-model';
import { FarmBedLayer, type FarmBedVisual } from './orbitFarm-bed-layer';
import { ORBIT_SCANNER_SPRITE } from '../domain/orbitFarm-assets';
import { SatelliteFallback, SvgAssetImage } from './orbitFarm-image';
import { FarmWorld, FARM_WORLD_WIDTH } from './orbitFarm-world';
import './orbitFarm-scenes.css';

const FIELD_AREA = { x: 160, y: 204, width: 534, height: 234 };

interface FarmSceneProps {
  layout: FarmLayout;
  plots: Plot[];
  selectedSlotId: number | null;
  onSelectSlot: (slotId: number) => void;
  isScanning: boolean;
  viewDate: string;
}

export { CropSprite } from './orbitFarm-crop-sprite';

function SatelliteDrawing() {
  return (
    <SvgAssetImage src={ORBIT_SCANNER_SPRITE} x={-10} y={-16} width={180} height={120} fallback={<SatelliteFallback />} fallbackViewBox="0 0 160 100" />
  );
}

export function SatelliteIcon({ size = 80, className = '' }: { size?: number; className?: string }) {
  return <svg width={size} height={size / 2} viewBox="0 0 160 80" aria-hidden="true" shapeRendering="crispEdges" className={`of-satellite-icon ${className}`}><SatelliteDrawing /></svg>;
}

function insideBed(point: LayoutPoint, points: LayoutPoint[]) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function getSchematicLabelPosition(points: LayoutPoint[]) {
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
  let best = points[0], clearance = -1;
  for (let xi = 1; xi < 18; xi++) for (let yi = 1; yi < 18; yi++) {
    const p = { x: minX + (maxX - minX) * xi / 18, y: minY + (maxY - minY) * yi / 18 };
    if (!insideBed(p, points)) continue;
    let distance = Infinity;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
      distance = Math.min(distance, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
    }
    const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
    if (distance > clearance + 1e-7 || (Math.abs(distance - clearance) < 1e-7 && Math.hypot(p.x - centerX, p.y - centerY) < Math.hypot(best.x - centerX, best.y - centerY))) { best = p; clearance = distance; }
  }
  return { point: best, clearance, minX, maxX, minY, maxY };
}

export function FarmScene({ layout, plots, selectedSlotId, onSelectSlot, isScanning, viewDate }: FarmSceneProps) {
  const scene = useRef<HTMLDivElement>(null);
  const [renderedWidth, setRenderedWidth] = useState(FARM_WORLD_WIDTH);
  useLayoutEffect(() => {
    const element = scene.current;
    if (!element) return;
    const measure = () => { const width = element.getBoundingClientRect().width; if (width > 0) setRenderedWidth(Math.round(width * 10) / 10); };
    measure();
    if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure); }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const beds = useMemo(() => layout.beds.map((bed): FarmBedVisual => {
    const plot = plots.find(item => item.slotId === bed.slotId);
    return {
      slotId: bed.slotId,
      name: bed.name,
      points: bed.points.map(point => ({
        x: FIELD_AREA.x + point.x / layout.width * FIELD_AREA.width,
        y: FIELD_AREA.y + point.y / layout.height * FIELD_AREA.height,
      })),
      label: getPlotLabel(bed.slotId).replace('Plot ', ''),
      crop: plot ? { id: plot.cropId, stage: getGrowthStage(plot, viewDate) } : null,
    };
  }), [layout, plots, viewDate]);

  return (
    <div ref={scene} className="of-farm-scene" data-testid="farm-scene">
      <FarmBedLayer
        beds={beds}
        pixelsPerUnit={renderedWidth / FARM_WORLD_WIDTH}
        selectedSlotId={selectedSlotId}
        onSelectSlot={onSelectSlot}
        background={<FarmWorld scanning={isScanning} viewDate={viewDate} />}
      />
      {isScanning && <div className="of-scanning-caption" role="status">Analyzing field…</div>}
    </div>
  );
}
