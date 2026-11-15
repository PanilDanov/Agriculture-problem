import { useEffect, useId, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { ORBIT_SCANNER_SPRITE } from './orbitFarm-scanner';
import { FarmDog } from './orbitFarm-dog';
import { FARM_SEASONS, getFarmSeasonBlend, type FarmSeason, type SeasonBlend } from './orbitFarm-seasons';
import { paintTerrain } from './orbitFarm-terrain';
import { createVegetationPainter, getOrchardMask } from './orbitFarm-vegetation';
import './orbitFarm-world.css';

export const FARM_WORLD_WIDTH = 800;
export const FARM_WORLD_VIEW_BOX = `0 0 ${FARM_WORLD_WIDTH} 612`;
const assets = `${import.meta.env.BASE_URL}assets/farm/`;

function SeasonalTerrain({ blend }: { blend: SeasonBlend }) {
  const root = useRef<HTMLDivElement>(null);
  const vegetation = useRef<HTMLCanvasElement>(null);
  const paint = useRef<((season: SeasonBlend) => void) | null>(null);
  const displayed = useRef(blend);
  const target = useRef(blend);
  const frameRequest = useRef<number | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    target.current = blend;
    const apply = paint.current;
    if (!ready || !apply) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reducedMotion.matches) {
      if (frameRequest.current !== null) cancelAnimationFrame(frameRequest.current);
      frameRequest.current = null;
      displayed.current = blend;
      apply(blend);
      return;
    }
    if (frameRequest.current !== null || FARM_SEASONS.every(season => displayed.current[season] === blend[season])) return;

    let previousTime = performance.now();
    function step(time: number) {
      const next = target.current;
      const current = displayed.current;
      const settled = FARM_SEASONS.every(season => Math.abs(current[season] - next[season]) < .004);
      if (settled || reducedMotion.matches) {
        displayed.current = next;
        apply?.(next);
        frameRequest.current = null;
        return;
      }
      // All four terrain weights use the same step to keep coverage constant during scrubbing.
      const progress = 1 - Math.exp(-Math.max(0, time - previousTime) / 134);
      const approach = (season: FarmSeason) => current[season] + (next[season] - current[season]) * progress;
      const frame = { winter: approach('winter'), spring: approach('spring'), summer: approach('summer'), autumn: approach('autumn') };
      apply?.(frame);
      displayed.current = frame;
      previousTime = time;
      frameRequest.current = requestAnimationFrame(step);
    }
    frameRequest.current = requestAnimationFrame(step);
  }, [blend, ready]);

  useEffect(() => () => {
    if (frameRequest.current !== null) cancelAnimationFrame(frameRequest.current);
    frameRequest.current = null;
  }, []);

  function loadArtwork(event: SyntheticEvent<HTMLImageElement>) {
    const image = event.currentTarget;
    const source = document.createElement('canvas');
    source.width = image.naturalWidth;
    source.height = image.naturalHeight;
    const sourceContext = source.getContext('2d');
    if (!sourceContext || !root.current || !vegetation.current) return;
    sourceContext.drawImage(image, 0, 0);
    let pixels: ImageData;
    try {
      pixels = sourceContext.getImageData(0, 0, source.width, source.height);
    } catch {
      return;
    }
    const orchardMask = getOrchardMask(pixels);
    const frames: Array<{ season: FarmSeason; canvas: HTMLCanvasElement }> = [];
    for (const season of FARM_SEASONS) {
      const frame = root.current.querySelector<HTMLCanvasElement>(`[data-season="${season}"]`);
      if (!frame) return;
      frame.width = source.width;
      frame.height = source.height;
      const context = frame.getContext('2d');
      if (!context) return;
      paintTerrain(context, pixels, season, orchardMask);
      frames.push({ season, canvas: frame });
    }
    vegetation.current.width = source.width;
    vegetation.current.height = source.height;
    const plantContext = vegetation.current.getContext('2d');
    if (!plantContext) return;
    const paintPlants = createVegetationPainter(plantContext);
    paint.current = season => {
      for (const frame of frames) frame.canvas.style.opacity = String(season[frame.season]);
      paintPlants(season);
    };
    displayed.current = blend;
    paint.current(blend);
    setReady(true);
  }

  return (
    <div ref={root} className="of-season-terrain" data-terrain-ready={ready ? 'true' : undefined} aria-hidden="true">
      <img src={`${assets}orbitFarm-meadow-v2.png`} alt="" onLoad={loadArtwork} draggable={false} />
      {FARM_SEASONS.map(season => <canvas key={season} data-season={season} />)}
      <canvas ref={vegetation} data-seasonal-plants="" />
    </div>
  );
}

function Mill() {
  return (
    <g transform="translate(293 88) rotate(24)" shapeRendering="crispEdges">
      <g className="of-mill-rotor of-scene-motion">
        {[0, 90, 180, 270].map(angle => (
          <g key={angle} transform={`rotate(${angle})`}>
            <path d="M0-2h43v5H0Z M12-13h31v12H12Z" fill="#4C5937" />
            <path d="M15-11h25v7H15Z" fill="#F2D39A" />
            <path d="M21-11h2v7h-2zm8 0h2v7h-2zm8 0h2v7h-2z" fill="#BB8854" />
          </g>
        ))}
        <path d="M-5-5H5V5H-5Z" fill="#4C5937" />
        <path d="M-2-2H2V2H-2Z" fill="#F8DAA5" />
      </g>
    </g>
  );
}

function Bee({ x, y, delayed = false }: { x: number; y: number; delayed?: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`} shapeRendering="crispEdges">
      <g className={`of-bee-flight of-scene-motion${delayed ? ' of-bee-delayed' : ''}`}>
        <path className="of-bee-wings of-scene-motion" d="M2-4h3v4H2zm4 1h3v3H6z" fill="#FFF5D4" />
        <path d="M1 0h7v1h2v3H1z" fill="#69472D" />
        <path d="M2 0h2v3H2zm4 0h2v3H6z" fill="#F5CB59" />
      </g>
    </g>
  );
}

const PETALS = [[365, 81], [381, 94], [394, 79], [409, 104], [417, 88]];
const FLOWERS = [[166, 168], [350, 151], [488, 155], [738, 211], [112, 406], [144, 499], [620, 562]];
const LEAVES = [[359, 114], [374, 127], [398, 106], [421, 119], [686, 497]];
const FALLEN_LEAVES = [[354, 150], [369, 153], [382, 157], [401, 145], [414, 158], [432, 153], [565, 503], [706, 552], [166, 516]];
const GLINTS = [[41, 310], [81, 318], [44, 347], [91, 361], [657, 159], [770, 449]];

function SeasonalDetails({ blend }: { blend: SeasonBlend }) {
  const fog = `${useId().replaceAll(':', '')}-pond-mist`;
  return <>
    <defs>
      <radialGradient id={fog}>
        <stop stopColor="#E3ECDD" stopOpacity=".68" />
        <stop offset=".62" stopColor="#C7DFD5" stopOpacity=".36" />
        <stop offset="1" stopColor="#C7DFD5" stopOpacity="0" />
      </radialGradient>
    </defs>
    <g className="of-season-detail" style={{ opacity: blend.spring }} shapeRendering="crispEdges">
      {FLOWERS.map(([x, y], index) => <g key={x} transform={`translate(${x} ${y})`}>
        <path d="M2 5h2v5H2z M3 7h4v2H3z" fill="#568548" />
        <path d="M2 0h2v2h2v2H4v2H2V4H0V2h2z" fill={index % 3 ? '#F7C7BE' : '#FFF0CF'} />
        <path d="M2 2h2v2H2z" fill="#D5A35A" />
      </g>)}
      {PETALS.map(([x, y], index) => <g key={x} transform={`translate(${x} ${y})`}>
        <path d="M0 0h4v2H2v2H0z" fill={index % 2 ? '#FFDECE' : '#F7ADA7'}
          className="of-spring-petal of-scene-motion" style={{ animationDelay: `${-1.55 * index}s` }} />
      </g>)}
    </g>
    <g className="of-season-detail" style={{ opacity: blend.summer }} shapeRendering="crispEdges" fill="#FFF2B8">
      {GLINTS.map(([x, y], index) => <g key={x} transform={`translate(${x} ${y})`}>
        <path d="M0 0h5v2H0z M2-2h1v6H2z"
          className="of-summer-glint of-scene-motion" style={{ animationDelay: `${-1.38 * index}s` }} />
      </g>)}
    </g>
    <g className="of-season-detail" style={{ opacity: blend.autumn * .8 + blend.winter * .32 }} shapeRendering="crispEdges">
      {FALLEN_LEAVES.map(([x, y], index) => <path key={x} transform={`translate(${x} ${y})`}
        d="M0 2h2V0h5v2H5v2H2v1H0z" fill={index % 2 ? '#A86236' : '#CF883B'} opacity=".86" />)}
    </g>
    <g className="of-season-detail" style={{ opacity: blend.autumn * (.62 + blend.winter * 1.15) }} shapeRendering="crispEdges">
      {LEAVES.map(([x, y], index) => <g key={x} transform={`translate(${x} ${y})`}>
        <path d="M0 3h2V1h3V0h2v3H5v2H2v1H0z" fill={index % 2 ? '#D88A45' : '#A95E38'}
          className="of-autumn-leaf of-scene-motion" style={{ animationDelay: `${-1.8 * index}s` }} />
      </g>)}
    </g>
    <g className="of-season-detail" style={{ opacity: blend.winter }}>
      <ellipse cx="57" cy="342" rx="45" ry="12" fill={`url(#${fog})`} className="of-pond-mist of-scene-motion" />
      <ellipse cx="76" cy="364" rx="40" ry="10" fill={`url(#${fog})`}
        className="of-pond-mist of-scene-motion" style={{ animationDelay: '-6s' }} />
      <g shapeRendering="crispEdges">
        <path d="M193 532h21v2h8v3h-16v2h-24v-3h11z M593 524h33v2h8v3h-49v-3h8z M688 548h18v2h9v2h-32v-2h5z"
          fill="#718F84" opacity=".27" />
        <path d="M195 535h17v2h-17z M596 526h23v1h-23z M692 550h14v1h-14z" fill="#E1DFB8" opacity=".68" />
      </g>
    </g>
  </>;
}

export function FarmWorld({ scanning, viewDate }: { scanning: boolean; viewDate: string }) {
  const blend = useMemo(() => getFarmSeasonBlend(viewDate), [viewDate]);
  return (
    <>
      <SeasonalTerrain blend={blend} />
      <svg className="of-farm-world" viewBox={FARM_WORLD_VIEW_BOX} aria-hidden="true">
        <Mill />
        <g fill="#E5E5C4" shapeRendering="crispEdges">
          <path className="of-chimney-smoke of-scene-motion" d="M184 20h5v3h5v5h-12v-5h2Z" />
          <path className="of-chimney-smoke of-chimney-smoke-delayed of-scene-motion" d="M184 20h5v3h5v5h-12v-5h2Z" />
        </g>
        <g fill="#AEE0CA" shapeRendering="crispEdges">
          <path className="of-pond-ripple of-scene-motion" d="M25 328h18v2H25zm7 4h18v2H32z" />
          <path className="of-pond-ripple of-pond-ripple-delayed of-scene-motion" d="M82 353h16v2H82zm-7 4h15v2H75z" />
        </g>
        <SeasonalDetails blend={blend} />
        <g className="of-season-detail" style={{ opacity: blend.spring * .85 + blend.summer + blend.autumn * .2 }}>
          <Bee x={722} y={261} />
          <Bee x={104} y={420} delayed />
        </g>
        <FarmDog />
        {scanning && <>
          <path className="of-scan-beam of-scene-motion" d="M638 80H661L692 422H163Z" fill="#93DFEB" opacity=".18" />
          <g className="of-satellite-scanning of-scene-motion" transform="translate(574 18)">
            <image href={ORBIT_SCANNER_SPRITE} x="-10" y="-16" width="180" height="120" />
          </g>
        </>}
      </svg>
    </>
  );
}
