import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FarmLayout, LayoutPoint } from '../domain/orbitFarm-types';
import { getPlotLabel } from '../domain/orbitFarm-layout';
import { planBedContent } from './orbitFarm-bed-content';
import { ORBIT_SCANNER_SPRITE } from './orbitFarm-scanner';
import './orbitFarm-scenes.css';

type CropId = 'wheat' | 'chickpea' | 'sorghum';

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
  dueAtISO: string;
  snoozedUntilISO: string | null;
}

interface FarmSceneProps {
  layout: FarmLayout;
  plots: ScenePlot[];
  selectedSlotId: number | null;
  onSelectSlot: (slotId: number) => void;
  isScanning?: boolean;
  tasks?: SceneTask[];
  demoNow: string;
}

const CROP_NAMES: Record<CropId, string> = {
  wheat: 'Wheat',
  chickpea: 'Chickpea',
  sorghum: 'Sorghum',
};

export function CropSprite({ cropId, size = 36 }: { cropId: CropId; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" className="of-crop-sprite" shapeRendering="crispEdges">
      <path d="M8 28H26V31H8Z" fill="#694B32" opacity=".35" />
      {cropId === 'wheat' ? (
        <>
          <path d="M14 7H18V30H14ZM6 12H10V26H6ZM23 11H27V28H23Z" fill="#61713C" />
          <path d="M13 2H19V7H21V11H17V15H13V11H10V7H13ZM5 6H11V11H13V16H9V20H5V16H2V11H5ZM22 5H28V10H30V15H26V19H22V15H19V10H22Z" fill="#E3AB45" />
          <path d="M13 2H16V7H13ZM10 7H14V10H10ZM17 7H21V10H17ZM5 6H8V11H5ZM2 11H6V14H2ZM9 11H13V14H9ZM22 5H25V10H22ZM19 10H23V13H19ZM26 10H30V13H26Z" fill="#F8D979" />
          <path d="M14 17H18V20H14ZM6 22H10V25H6ZM23 21H27V24H23Z" fill="#C18A39" />
        </>
      ) : cropId === 'chickpea' ? (
        <>
          <path d="M13 19H19V31H13Z" fill="#516D3D" />
          <path d="M8 4H23V8H28V13H31V22H27V27H5V23H1V13H4V8H8Z" fill="#244F39" />
          <path d="M8 5H20V9H25V14H28V21H23V25H7V21H3V14H7Z" fill="#43804B" />
          <path d="M9 7H18V11H13V15H6V11H9ZM19 12H25V16H19ZM6 19H11V23H6Z" fill="#84AC62" />
          <path d="M12 17H17V22H12ZM22 18H26V23H22ZM5 14H9V18H5Z" fill="#C4D985" />
          <path d="M13 18H16V21H13ZM23 19H26V22H23Z" fill="#E0E9AA" />
        </>
      ) : (
        <>
          <path d="M14 12H18V31H14Z" fill="#3D6C3C" />
          <path d="M14 21H9V18H4V15H9V17H14ZM18 24H23V21H28V18H23V20H18Z" fill="#5B924C" />
          <path d="M11 1H21V5H25V15H21V19H11V15H7V5H11Z" fill="#814D31" />
          <path d="M11 3H17V7H21V11H17V16H11V12H9V7H11Z" fill="#BD7E41" />
          <path d="M12 3H16V6H12ZM17 8H21V11H17ZM10 11H14V14H10Z" fill="#E3B55E" />
        </>
      )}
    </svg>
  );
}

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

function isTaskDue(task: SceneTask, now: number) {
  if (task.status === 'done' || task.status === 'skipped') return false;
  if (task.status === 'snoozed' && task.snoozedUntilISO && Date.parse(task.snoozedUntilISO) > now) return false;
  return Date.parse(task.dueAtISO) <= now;
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

export function FarmScene({ layout, plots, selectedSlotId, onSelectSlot, isScanning = false, tasks = [], demoNow }: FarmSceneProps) {
  const id = useId().replaceAll(':', '');
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
    const dueTask = plot && tasks.find(task => task.plotId === plot.id && isTaskDue(task, Date.parse(demoNow)));
    const worldPoints = bed.points.map(p => ({ x: 160 + p.x / layout.width * 534, y: 194 + p.y / layout.height * 244 }));
    const shortName = getPlotLabel(bed.slotId).replace('Plot ', '');
    return { bed, plot, dueTask, worldPoints, shortName, content: planBedContent(worldPoints, { pixelsPerUnit: renderedWidth / 800, label: shortName, hasTask: Boolean(dueTask), empty: !plot }) };
  }), [layout, plots, tasks, demoNow, renderedWidth]);
  return (
    <div ref={scene} className={`of-farm-scene${isScanning ? ' of-farm-scene-scanning' : ''}`} data-testid="farm-scene">
      <WorldBackground scanning={isScanning} />
      <svg className="of-bed-layer" viewBox="0 0 800 520" aria-label="Your planting beds">
        <defs>
          <pattern id={`${id}-soil`} width="18" height="28" patternUnits="userSpaceOnUse">
            <rect width="18" height="28" fill="#A96545" />
            <path d="M0 3H18V9H0Z" fill="#CB8A5E" /><path d="M0 22H18V27H0Z" fill="#8E553E" />
          </pattern>
          {beds.map(({bed,worldPoints}) => <clipPath key={bed.slotId} id={`${id}-clip-${bed.slotId}`}><polygon points={worldPoints.map(p => `${p.x},${p.y}`).join(' ')} /></clipPath>)}
        </defs>
        {beds.map(({ bed, plot, dueTask, worldPoints, shortName, content }) => {
          const cropName = plot ? CROP_NAMES[plot.cropId] : 'Empty';
          const points = worldPoints.map(p => `${p.x},${p.y}`).join(' ');
          const badge = content.annotation;
          return <g
            key={bed.slotId}
            className={`of-bed-shape${dueTask ? ' of-bed-needs-care' : ''}${selectedSlotId === bed.slotId ? ' of-bed-shape-selected' : ''}`}
            role="button"
            tabIndex={0}
            aria-label={`${bed.name} · ${cropName}${dueTask ? ` · ${dueTask.title}` : ''}`}
            aria-pressed={selectedSlotId === bed.slotId}
            data-testid={`plot-slot-${bed.slotId}`}
            data-annotation-mode={badge?.mode ?? 'none'}
            onClick={() => onSelectSlot(bed.slotId)}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectSlot(bed.slotId); } }}
          >
            <title>{`${bed.name} · ${cropName}${dueTask ? ` · ${dueTask.title}` : ''}`}</title>
            <polygon className="of-bed-ground" points={points} fill={`url(#${id}-soil)`} stroke="#203D32" strokeWidth="5" strokeLinejoin="round" />
            <g clipPath={`url(#${id}-clip-${bed.slotId})`} pointerEvents="none" aria-hidden="true">
              {plot && content.crops.map((crop, index) => <g key={index} data-testid={`bed-crop-${bed.slotId}-${index}`} data-bed-id={bed.slotId} transform={`translate(${crop.x} ${crop.y})`}><CropSprite cropId={plot.cropId} size={crop.width} /></g>)}
            </g>
            <polygon className="of-bed-selection" points={points} fill="none" stroke="#FFF8E8" strokeWidth="3" strokeLinejoin="round" pointerEvents="none" />
            {badge && <g className="of-bed-badge" data-testid={`bed-annotation-${bed.slotId}`} pointerEvents="none" aria-hidden="true">
              <rect data-testid={`bed-annotation-box-${bed.slotId}`} x={badge.x} y={badge.y} width={badge.width} height={badge.height} rx={2 / (renderedWidth / 800)} fill={dueTask ? '#F4C95D' : '#FFF8E8'} stroke="#203D32" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
              <text className="of-bed-badge-text" x={badge.showTask || badge.showPlus ? badge.x + badge.fontSize * .55 : badge.x + badge.width / 2} y={badge.y + badge.height / 2} textAnchor={badge.showTask || badge.showPlus ? 'start' : 'middle'} dominantBaseline="central" style={{ fontSize: badge.fontSize }}>{shortName}</text>
              {badge.showTask && <svg x={badge.x + badge.width - badge.fontSize * 1.7} y={badge.y + (badge.height - badge.fontSize * 1.15) / 2} width={badge.fontSize * 1.15} height={badge.fontSize * 1.15} viewBox="0 0 16 20"><path d="M6 0H10V4H12V7H14V11H16V16H13V19H3V16H0V11H2V7H4V4H6Z" fill="#203D32" /><path d="M6 5H10V9H12V12H13V15H10V17H5V15H3V12H5V9H6Z" fill="#BDE4F0" /></svg>}
              {badge.showPlus && <path d={`M${badge.x + badge.width - badge.fontSize * 1.7} ${badge.y + badge.height / 2}h${badge.fontSize * 1.15}m${-badge.fontSize * .575} ${-badge.fontSize * .575}v${badge.fontSize * 1.15}`} stroke="#49653E" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />}
            </g>}
          </g>;
        })}
      </svg>
      {isScanning && <div className="of-scanning-caption" role="status">Orbit-1 is checking the latest observations…</div>}
    </div>
  );
}
