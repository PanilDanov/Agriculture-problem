import { useId } from 'react';
import './orbitFarm-scanner.css';
import { ORBIT_SCANNER_SPRITE } from '../domain/orbitFarm-assets';
import { SatelliteFallback, useVisualImage } from './orbitFarm-image';

export { ORBIT_SCANNER_SPRITE } from '../domain/orbitFarm-assets';

interface OrbitScannerProps {
  state?: 'scanning' | 'complete';
  mode?: 'demo' | 'api';
  compact?: boolean;
}

/** Motion is decorative: only the request lifecycle determines the result. */
export function OrbitScanner({ state = 'scanning', mode = 'demo', compact = false }: OrbitScannerProps) {
  const titleId = useId();
  const complete = state === 'complete';
  const visual = useVisualImage(ORBIT_SCANNER_SPRITE);
  return (
    <section
      className={`of-orbit-scanner${compact ? ' of-orbit-scanner-compact' : ''}`}
      data-testid="orbit-scanner"
      data-state={state}
      aria-labelledby={titleId}
      aria-busy={!complete}
    >
      <div className="of-scanner-topline">
        <span className="of-scanner-source">{mode === 'demo' ? 'Demo data' : 'Connected API'}</span>
      </div>

      <div className="of-scanner-scene" aria-hidden="true">
        <span className="of-scanner-corner of-scanner-corner-tl" />
        <span className="of-scanner-corner of-scanner-corner-tr" />
        <span className="of-scanner-corner of-scanner-corner-bl" />
        <span className="of-scanner-corner of-scanner-corner-br" />
        <svg className="of-scanner-orbit" viewBox="0 0 640 320" fill="none">
          <path d="M33 134C111 29 467 14 606 126" stroke="currentColor" strokeDasharray="3 9" />
          <path d="M93 84h12m-6-6v12M544 65h10m-5-5v10M481 131h8m-4-4v8M180 36h8m-4-4v8" stroke="currentColor" />
          <circle cx="389" cy="45" r="2" fill="currentColor" />
          <circle cx="59" cy="179" r="2" fill="currentColor" />
          <circle cx="583" cy="190" r="2" fill="currentColor" />
        </svg>

        <svg className="of-scanner-ground" viewBox="0 0 640 320" fill="none" shapeRendering="crispEdges">
          <path d="M125 227H515V285H499V297H141V285H125Z" fill="#B3C78E" />
          <path d="M112 211H528V269H512V281H128V269H112Z" fill="#DDEDC5" />
          <path d="M128 269H512V281H128Z" fill="#C7DBAA" />
          <path d="M148 228H252V259H148ZM268 228H372V259H268ZM388 228H492V259H388Z" fill="#8E6247" />
          <path d="M152 232H248V237H152ZM272 232H368V237H272ZM392 232H488V237H392ZM152 247H248V252H152ZM272 247H368V252H272ZM392 247H488V252H392Z" fill="#BD8258" />
          {[169, 199, 229, 289, 319, 349, 409, 439, 469].map((x, index) => (
            <g key={x} className="of-scanner-plant" style={{ animationDelay: `${1 + index * 0.09}s` }}>
              <path d={`M${x} 222h4v24h-4Z`} fill="#286B45" />
              <path d={`M${x - 7} 224h7v5h4v5h-7v-5h-4ZM${x + 4} 217h7v7h-7v5h-4v-7h4Z`} fill={index < 3 ? '#D5AA4D' : '#61935B'} />
              <path d={`M${x + 4} 217h4v4h-4Z`} fill={index < 3 ? '#F4C95D' : '#94B876'} />
            </g>
          ))}
          <path d="M111 242h-8v-9h-4v13h12ZM532 263h8v-9h4v13h-12Z" fill="#92B273" />
        </svg>

        <div className="of-scanner-flight">
          <div className="of-scanner-pass">
            <div className="of-scanner-hover" data-testid="orbit-scanner-craft" data-asset-state={visual.state}>
              <div className="of-scanner-beam" data-testid="orbit-scanner-beam"><span /><span /><span /></div>
              <div className="of-scanner-artwork">
                {!visual.ready && <svg className="of-scanner-fallback" viewBox="0 0 160 100" data-testid="orbit-scanner-fallback" shapeRendering="crispEdges"><SatelliteFallback /></svg>}
                <img key={visual.imageKey} className="of-scanner-sprite" src={ORBIT_SCANNER_SPRITE} width="1536" height="1024" alt="" draggable={false} loading="eager" decoding="async" fetchPriority="high" style={{ visibility: visual.ready ? 'visible' : 'hidden' }} onLoad={visual.onLoad} onError={visual.onError} />
              </div>
              <span className="of-scanner-sensor" />
            </div>
          </div>
        </div>
        <div className="of-scanner-footprint"><span /><span /></div>
        <span className="of-scanner-lock">{complete ? '✓' : '+'}</span>
      </div>

      <div className="of-scanner-copy" role="status" aria-live="polite" aria-atomic="true">
        <h2 id={titleId}>{complete ? 'Analysis complete' : 'Analyzing field'}</h2>
        {complete && <span className="of-scanner-status"><span aria-hidden="true" />Preview only · saved analysis unchanged</span>}
      </div>
    </section>
  );
}
