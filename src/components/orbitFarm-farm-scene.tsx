import type { CSSProperties } from 'react';
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

const SLOT_POSITIONS = [
  { x: 176, y: 205 }, { x: 354, y: 205 }, { x: 532, y: 205 },
  { x: 176, y: 337 }, { x: 354, y: 337 }, { x: 532, y: 337 },
];

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

function Tree({ x, y, small = false }: { x: number; y: number; small?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${small ? 0.74 : 1})`}>
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
      <path d="M149 309H710V332H149ZM326 173H350V455H326ZM504 173H528V455H504ZM396 447H448V493H396Z" fill="#F7E8BF" />
      <path d="M149 323H710V330H149ZM342 175H350V455H342ZM520 175H528V455H520ZM438 447H448V493H438Z" fill="#E3D3AA" />
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
      <Tree x={710} y={344} small />
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

export function FarmScene({ plots, selectedSlotId, onSelectSlot, isScanning = false, tasks = [], demoNow }: FarmSceneProps) {
  const now = Date.parse(demoNow);
  return (
    <div className={`of-farm-scene${isScanning ? ' of-farm-scene-scanning' : ''}`} data-testid="farm-scene">
      <WorldBackground scanning={isScanning} />
      {SLOT_POSITIONS.map((position, slotId) => {
        const plot = plots.find((item) => item.slotId === slotId);
        const dueTask = plot && tasks.find((task) => task.plotId === plot.id && isTaskDue(task, now));
        const cropName = plot ? CROP_NAMES[plot.cropId] : 'Empty';
        const name = `Plot ${String.fromCharCode(65 + slotId)}`;
        const style = { left: `${position.x / 8}%`, top: `${position.y / 5.2}%`, width: '18%', height: '18.46%' } satisfies CSSProperties;
        return (
          <button
            key={slotId}
            type="button"
            className={`of-plot${plot ? ' of-plot-planted' : ' of-plot-empty'}${selectedSlotId === slotId ? ' of-plot-selected' : ''}`}
            style={style}
            aria-label={`${name} · ${cropName}${dueTask ? ` · ${dueTask.title}` : ''}`}
            aria-pressed={selectedSlotId === slotId}
            data-testid={`plot-slot-${slotId}`}
            onClick={() => onSelectSlot(slotId)}
          >
            <svg className="of-plot-soil" viewBox="0 0 144 96" aria-hidden="true" shapeRendering="crispEdges">
              <path d="M0 0H144V96H0Z" fill="#203D32" />
              <path d="M5 5H139V89H5Z" fill="#A96545" />
              <path d="M7 7H137V13H7ZM7 33H137V39H7ZM7 59H137V65H7Z" fill="#CB8A5E" />
              <path d="M9 24H136V29H9ZM9 50H136V55H9ZM9 76H136V81H9Z" fill="#8E553E" />
              <path d="M4 89H140V93H4Z" fill="#6F513B" />
            </svg>
            {plot ? (
              <span className="of-crop-field" aria-hidden="true">
                {Array.from({ length: 6 }, (_, index) => <CropSprite key={index} cropId={plot.cropId} />)}
              </span>
            ) : <span className="of-plant-plus" aria-hidden="true">+</span>}
            <span className="of-plot-label"><strong>{String.fromCharCode(65 + slotId)}</strong><span>{cropName === 'Empty' ? 'Plant here' : cropName}</span></span>
            {dueTask && <span className="of-task-marker" aria-hidden="true"><svg viewBox="0 0 16 20" width="13" height="16" shapeRendering="crispEdges"><path d="M6 0H10V4H12V7H14V11H16V16H13V19H3V16H0V11H2V7H4V4H6Z" fill="#203D32" /><path d="M6 5H10V9H12V12H13V15H10V17H5V15H3V12H5V9H6Z" fill="#BDE4F0" /><path d="M5 11H8V15H5Z" fill="#FFF8E8" /></svg></span>}
          </button>
        );
      })}
      {isScanning && <div className="of-scanning-caption" role="status">Orbit-1 is checking the latest observations…</div>}
    </div>
  );
}
