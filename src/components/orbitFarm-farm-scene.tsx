import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CropId, FarmLayout, LayoutPoint } from '../domain/orbitFarm-types';
import { getPlotLabel } from '../domain/orbitFarm-layout';
import { FarmBedLayer } from './orbitFarm-bed-layer';
import { CropSprite } from './orbitFarm-crop-sprite';
import { ORBIT_SCANNER_SPRITE } from './orbitFarm-scanner';
import './orbitFarm-scenes.css';

interface ScenePlot {
  id: string;
  slotId: number;
  cropId: CropId;
  plantedOn: string;
}

interface SceneTask {
  id: string;
  plotId: string;
  title: string;
  status: 'open' | 'done' | 'skipped' | 'snoozed';
  dueOn: string;
  snoozedUntil: string | null;
}

interface FarmSceneProps {
  layout: FarmLayout;
  plots: ScenePlot[];
  selectedSlotId: number | null;
  onSelectSlot: (slotId: number) => void;
  isScanning?: boolean;
  tasks?: SceneTask[];
  demoToday: string;
}

export { CropSprite } from './orbitFarm-crop-sprite';

function SatelliteDrawing() {
  return (
    <image href={ORBIT_SCANNER_SPRITE} x="-10" y="-16" width="180" height="120" />
  );
}

export function SatelliteIcon({ size = 80, className = '' }: { size?: number; className?: string }) {
  return <svg width={size} height={size / 2} viewBox="0 0 160 80" aria-hidden="true" shapeRendering="crispEdges" className={`of-satellite-icon ${className}`}><SatelliteDrawing /></svg>;
}

function Tree({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M4 87H73V97H4Z" fill="#A8C187" />
      <path d="M31 51H47V89H58V95H23V89H31Z" fill="#203D32" />
      <path d="M35 55H42V88H35Z" fill="#BA8052" />
      <path d="M22 0H53V7H66V18H74V30H80V55H72V66H59V73H18V66H7V55H0V28H8V17H20Z" fill="#203D32" />
      <path d="M22 7H50V13H61V22H68V34H73V51H65V59H55V65H22V59H12V48H7V31H15V22H24Z" fill="#39764A" />
      <path d="M24 10H46V17H34V23H21V32H12V25H19V17H24ZM51 18H59V26H51Z" fill="#79A762" />
      <path d="M13 47H25V55H36V63H22V57H13ZM55 49H66V57H55Z" fill="#28613E" />
    </g>
  );
}

function Fence({ x, y, vertical = false }: { x: number; y: number; vertical?: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {vertical ? <><path d="M2 0H12V43H2Z" fill="#203D32" /><path d="M5 0H9V43H5Z" fill="#D59663" /></> : <><path d="M0 12H44V33H0Z" fill="#203D32" /><path d="M0 16H44V23H0ZM0 27H44V30H0Z" fill="#D59663" /><path d="M0 16H44V19H0Z" fill="#F0C68B" /></>}
      <path d="M0 4H4V0H12V4H16V42H0Z" fill="#203D32" />
      <path d="M4 5H12V37H4Z" fill="#E4B779" />
      <path d="M4 5H8V33H4Z" fill="#F6D694" />
    </g>
  );
}

function WorldBackground({ scanning }: { scanning: boolean }) {
  return (
    <svg className="of-farm-world" viewBox="0 0 800 520" aria-hidden="true" shapeRendering="crispEdges">
      <path d="M56 160H744V466H720V486H82V470H56Z" fill="#AFC58A" />
      <path d="M48 150H736V454H712V477H72V462H48Z" fill="#D8E8B6" />
      <path d="M72 150H712V166H72ZM48 174H64V441H48ZM75 461H713V477H75Z" fill="#C8DBA5" />
      <path d="M396 447H448V493H396Z" fill="#F7E8BF" />
      <path d="M438 447H448V493H438Z" fill="#E3D3AA" />
      <g transform="translate(76 39)">
        <path d="M12 82H138V119H12Z" fill="#ACBF89" />
        <path d="M15 38H132V109H15Z" fill="#203D32" />
        <path d="M21 44H126V103H21Z" fill="#BE7051" />
        <path d="M21 64H126V69H21ZM21 87H126V92H21Z" fill="#D28A61" />
        <path d="M9 39V31H18V22H28V14H39V6H109V14H120V22H130V31H140V44H9Z" fill="#203D32" />
        <path d="M21 32H29V24H40V16H107V24H119V32H130V38H21Z" fill="#52734E" />
        <path d="M39 16H104V22H39ZM28 27H115V32H28Z" fill="#70915D" />
        <path d="M54 61H99V109H54Z" fill="#203D32" />
        <path d="M59 66H74V104H59ZM80 66H94V104H80Z" fill="#E3B87A" />
        <path d="M64 70H69V99H64ZM84 70H89V99H84Z" fill="#D19558" />
        <path d="M29 49H46V68H29ZM108 49H120V68H108Z" fill="#FFF8E8" />
        <path d="M33 53H42V63H33ZM112 53H117V63H112Z" fill="#BDE4F0" />
      </g>
      <g transform="translate(268 54)">
        <path d="M8 89H76V96H8Z" fill="#BFCF9C" />
        <path d="M27 35H57L66 90H18Z" fill="#203D32" />
        <path d="M33 41H51L59 85H26Z" fill="#E8DAB1" />
        <path d="M35 63H48V85H35Z" fill="#927650" />
        <path d="M37 9H45V59H37Z" fill="#203D32" />
        <path d="M9 31H74V39H9Z" fill="#203D32" />
        <path d="M18 15H27V24H36V33H27V24H18ZM48 42H57V51H66V60H57V51H48Z" fill="#D1AB70" />
        <path d="M54 10H65V20H56V29H47V38H38V29H47V20H54ZM9 48H19V39H28V30H37V39H28V48H19V58H9Z" fill="#D1AB70" />
        <path d="M35 29H48V42H35Z" fill="#203D32" /><path d="M39 33H44V38H39Z" fill="#F4C95D" />
      </g>
      <Tree x={61} y={222} />
      <Tree x={738} y={365} scale={0.44} />
      <g transform="translate(83 373)">
        <path d="M0 5H31V48H0Z" fill="#203D32" /><path d="M4 9H27V44H4Z" fill="#CA865A" /><path d="M4 12H27V22H4Z" fill="#BDE4F0" /><path d="M0 22H31V27H0ZM0 36H31V41H0Z" fill="#64785B" /><path d="M7 0H25V5H7Z" fill="#D3E7DF" />
      </g>
      <g fill="#8FAF72">
        {[[139,187],[697,190],[131,336],[701,350],[78,437],[672,440],[206,482],[593,482],[350,153],[440,160],[545,155]].map(([x,y]) => <path key={`${x}-${y}`} d={`M${x} ${y}h4v8h5v-5h4v9h-13Z`} />)}
      </g>
      <g fill="#F4C95D">
        {[[151,448],[686,294],[117,201],[471,467],[714,244]].map(([x,y]) => <path key={`${x}-${y}`} d={`M${x} ${y}h4v-4h4v4h4v4h-4v4h-4v-4h-4Z`} />)}
      </g>
      {Array.from({ length: 14 }, (_, i) => <Fence key={`back-${i}`} x={132 + i * 42} y={157} />)}
      {Array.from({ length: 7 }, (_, i) => <Fence key={`left-${i}`} x={133} y={183 + i * 40} vertical />)}
      {Array.from({ length: 7 }, (_, i) => <Fence key={`right-${i}`} x={720} y={183 + i * 40} vertical />)}
      {Array.from({ length: 6 }, (_, i) => <Fence key={`front-left-${i}`} x={133 + i * 42} y={447} />)}
      {Array.from({ length: 7 }, (_, i) => <Fence key={`front-right-${i}`} x={455 + i * 38} y={447} />)}
      {scanning && <path className="of-scan-beam" d="M650 109H677L711 428H170Z" fill="#8BC8D0" opacity=".22" />}
      <g className={scanning ? 'of-satellite of-satellite-scanning' : 'of-satellite'} transform="translate(574 28)"><SatelliteDrawing /></g>
      <path d="M422 494H430V501H422ZM414 505H422V512H414ZM430 511H438V518H430Z" fill="#D8C39B" />
    </svg>
  );
}

function isTaskDue(task: SceneTask, today: string) {
  if (task.status === 'done' || task.status === 'skipped') return false;
  if (task.status === 'snoozed' && task.snoozedUntil && task.snoozedUntil > today) return false;
  return task.dueOn <= today;
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

export function FarmScene({ layout, plots, selectedSlotId, onSelectSlot, isScanning = false, tasks = [], demoToday }: FarmSceneProps) {
  const scene = useRef<HTMLDivElement>(null);
  const [renderedWidth, setRenderedWidth] = useState(800);
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
  const beds = useMemo(() => layout.beds.map(bed => {
    const plot = plots.find(item => item.slotId === bed.slotId);
    const dueTask = plot && tasks.find(task => task.plotId === plot.id && isTaskDue(task, demoToday));
    const worldPoints = bed.points.map(p => ({ x: 160 + p.x / layout.width * 534, y: 194 + p.y / layout.height * 244 }));
    const shortName = getPlotLabel(bed.slotId).replace('Plot ', '');
    return { slotId: bed.slotId, name: bed.name, points: worldPoints, label: shortName, cropId: plot?.cropId ?? null, taskTitle: dueTask?.title ?? null };
  }), [layout, plots, tasks, demoToday, renderedWidth]);
  return (
    <div ref={scene} className={`of-farm-scene${isScanning ? ' of-farm-scene-scanning' : ''}`} data-testid="farm-scene">
      <FarmBedLayer
        beds={beds}
        pixelsPerUnit={renderedWidth / 800}
        selectedSlotId={selectedSlotId}
        onSelectSlot={onSelectSlot}
        CropSpriteComponent={CropSprite}
        background={<WorldBackground scanning={isScanning} />}
      />
      {isScanning && <div className="of-scanning-caption" role="status">Orbit-1 is checking the latest observations…</div>}
    </div>
  );
}
