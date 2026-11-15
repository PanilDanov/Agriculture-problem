import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type Ref, type SyntheticEvent } from 'react';
import { ensureAssetLoaded, getAssetStatus, reportAssetFailure, subscribeAsset } from '../domain/orbitFarm-assets';

/** Warmed assets still wait for their mounted image to load before replacing a fallback. */
export function useVisualImage(url: string) {
  const subscribe = useCallback((listener: () => void) => subscribeAsset(url, listener), [url]);
  const snapshot = useCallback(() => getAssetStatus(url), [url]);
  const status = useSyncExternalStore(subscribe, snapshot, () => 'idle');
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const active = useRef(url);
  active.current = url;
  useEffect(() => { void ensureAssetLoaded(url); }, [url]);
  const onLoad = (event: SyntheticEvent<HTMLImageElement | SVGImageElement>) => {
    const image = event.currentTarget;
    const finish = () => { if (active.current === url) { setLoadedUrl(url); setFailedUrl(null); } };
    if (image instanceof HTMLImageElement && typeof image.decode === 'function') {
      void image.decode().then(finish, () => { if (image.complete && image.naturalWidth > 0) finish(); });
    } else finish();
  };
  const ready = loadedUrl === url;
  return {
    ready,
    state: ready ? 'ready' : status === 'error' || failedUrl === url ? 'error' : 'loading',
    imageKey: `${url}:${status === 'ready' ? 'decoded' : 'pending'}`,
    onLoad,
    onError: () => { setLoadedUrl(null); setFailedUrl(url); reportAssetFailure(url); },
  };
}

export function SvgAssetImage({ src, x = 0, y = 0, width, height, className, imageRef, fallback, fallbackViewBox, fallbackTestId }: {
  src: string;
  x?: number;
  y?: number;
  width: number;
  height: number;
  className?: string;
  imageRef?: Ref<SVGImageElement>;
  fallback: ReactNode;
  fallbackViewBox: string;
  fallbackTestId?: string;
}) {
  const visual = useVisualImage(src);
  return <g data-asset-state={visual.state}>
    {!visual.ready && <svg x={x} y={y} width={width} height={height} viewBox={fallbackViewBox} shapeRendering="crispEdges" data-testid={fallbackTestId}>{fallback}</svg>}
    <image key={visual.imageKey} ref={imageRef} href={src} x={x} y={y} width={width} height={height}
      className={className} visibility={visual.ready ? 'visible' : 'hidden'} onLoad={visual.onLoad} onError={visual.onError} />
  </g>;
}

/** A small inline version of Orbit-1 remains visible even when its PNG cannot load. */
export function SatelliteFallback() {
  return <g>
    <path d="M8 41h45v31H8zM107 41h45v31h-45zM49 49h62v13H49z" fill="#203D32" />
    <path d="M11 44h39v25H11zM110 44h39v25h-39z" fill="#5794A2" />
    <path d="M23 44v25m13-25v25m87-25v25m13-25v25M11 56h39m60 0h39" stroke="#315E69" strokeWidth="2" />
    <path d="M13 46h8v3h-5v5h-3zm28 0h7v3h-4v4h-3zm71 0h8v3h-5v5h-3zm28 0h7v3h-4v4h-3z" fill="#B1DEE4" />
    <path d="M57 29h43v48H57zM62 24h34v5H62zM76 15h5v12h-5z" fill="#203D32" />
    <path d="M61 32h35v41H61zM65 27h29v5H65z" fill="#F9E9C6" />
    <path d="M61 32h6v5h-6zm29 0h6v5h-6zM61 68h6v5h-6zm29 0h6v5h-6z" fill="#BC7950" />
    <path d="M68 43h5v6h-5zm17 0h5v6h-5zM75 52h3v3h5v-3h3v5H75z" fill="#203D32" />
    <path d="M66 51h6v3h-6zm21 0h6v3h-6z" fill="#D58F62" />
    <path d="M76 65v-6l-6-4h5l4 3 5-6h7l-9 9v4z" fill="#34784C" />
    <path d="M72 76h14v4H72zM76 80h6v5h-6z" fill="#66B0C2" />
    <path d="M74 9h9v9h-9z" fill="#F4C95D" />
  </g>;
}

export function PlantFallback({ color = '#61935B' }: { color?: string }) {
  return <g><path d="M5 26h22v3H5z" fill="#AA704D" /><path d="M15 12h3v15h-3z" fill="#286B45" /><path d="M6 9h5v3h5v7h-5v-3H8v-3H6zm18-5h4v7h-3v4h-7V9h3V6h3z" fill={color} /></g>;
}
