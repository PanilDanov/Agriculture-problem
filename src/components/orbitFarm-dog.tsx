import { useEffect, useRef } from 'react';
import { createDogMotion, DOG_PATH_Y, STANDING_DOG, type DogPose } from './orbitFarm-dog-motion';
import { FARM_DOG_SPRITE } from '../domain/orbitFarm-assets';
import { useVisualImage } from './orbitFarm-image';

const FRAME_WIDTH = 48;
const FRAME_HEIGHT = 34;
const FRAME_COUNT = 12;

export function FarmDog() {
  const routeRef = useRef<SVGGElement>(null);
  const facingRef = useRef<SVGGElement>(null);
  const spriteRef = useRef<SVGImageElement>(null);
  const visual = useVisualImage(FARM_DOG_SPRITE);

  useEffect(() => {
    const route = routeRef.current;
    const facing = facingRef.current;
    const image = spriteRef.current;
    if (!route || !facing || !image) return;

    const step = createDogMotion();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let lastDrawn = STANDING_DOG;
    let previousTime: number | null = null;
    let request = 0;

    const draw = (pose: DogPose) => {
      if (pose.x !== lastDrawn.x) route.setAttribute('transform', `translate(${pose.x} ${DOG_PATH_Y})`);
      if (pose.direction !== lastDrawn.direction) facing.setAttribute('transform', `scale(${pose.direction} 1)`);
      if (pose.frame !== lastDrawn.frame) spriteRef.current?.setAttribute('x', String(-pose.frame * FRAME_WIDTH));
      if (pose.action !== lastDrawn.action) route.dataset.dogAction = pose.action;
      lastDrawn = pose;
    };

    function animate(time: number) {
      const delta = previousTime === null ? 0 : Math.min(time - previousTime, 48);
      previousTime = time;
      draw(step(delta));
      request = window.requestAnimationFrame(animate);
    }

    function syncMotion() {
      window.cancelAnimationFrame(request);
      previousTime = null;
      if (reducedMotion.matches) {
        draw({ ...lastDrawn, frame: STANDING_DOG.frame, action: 'stand' });
      } else if (!document.hidden) {
        request = window.requestAnimationFrame(animate);
      }
    }

    reducedMotion.addEventListener('change', syncMotion);
    document.addEventListener('visibilitychange', syncMotion);
    syncMotion();
    return () => {
      window.cancelAnimationFrame(request);
      reducedMotion.removeEventListener('change', syncMotion);
      document.removeEventListener('visibilitychange', syncMotion);
    };
  }, []);

  return (
    <g ref={routeRef} transform={`translate(${STANDING_DOG.x} ${DOG_PATH_Y})`}
      data-testid="farm-dog" data-dog-action={STANDING_DOG.action}>
      <path d="M-16-2h32v2h5v3H-21V0h5Z" fill="#9C693C" opacity=".42" shapeRendering="crispEdges" />
      <g ref={facingRef}>
        <svg x="-30" y="-41" width="60" height="42.5" viewBox={`0 0 ${FRAME_WIDTH} ${FRAME_HEIGHT}`} overflow="hidden">
          {!visual.ready && <g shapeRendering="crispEdges" data-testid="farm-dog-fallback">
            <path d="M8 21h27v8H8zM9 27h5v5H9zm18 0h5v5h-5zM30 15h10v13H30zM5 18h6v7H5z" fill="#705236" />
            <path d="M9 20h23v8H9zM31 16h7v9h-7z" fill="#F2DFC0" />
            <path d="M28 5h14v17H28z" fill="#527C7E" /><path d="M30 7h10v13H30z" fill="#C5DCD4" />
            <path d="M31 11h7v7h-7zM9 23h19v3H9z" fill="#F8EDCF" /><path d="M36 12h2v2h-2z" fill="#203D32" />
          </g>}
          <image key={visual.imageKey} ref={spriteRef} href={FARM_DOG_SPRITE} x={-STANDING_DOG.frame * FRAME_WIDTH}
            width={FRAME_COUNT * FRAME_WIDTH} height={FRAME_HEIGHT} visibility={visual.ready ? 'visible' : 'hidden'} onLoad={visual.onLoad} onError={visual.onError} />
        </svg>
      </g>
    </g>
  );
}
