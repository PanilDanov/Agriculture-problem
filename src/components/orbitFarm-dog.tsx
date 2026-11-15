import { useEffect, useRef } from 'react';
import { createDogMotion, DOG_PATH_Y, STANDING_DOG, type DogPose } from './orbitFarm-dog-motion';

const FRAME_WIDTH = 48;
const FRAME_HEIGHT = 34;
const FRAME_COUNT = 12;
const sprite = `${import.meta.env.BASE_URL}assets/farm/orbitFarm-dog-astronaut-v1.png`;

export function FarmDog() {
  const routeRef = useRef<SVGGElement>(null);
  const facingRef = useRef<SVGGElement>(null);
  const spriteRef = useRef<SVGImageElement>(null);

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
      if (pose.frame !== lastDrawn.frame) image.setAttribute('x', String(-pose.frame * FRAME_WIDTH));
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
          <image ref={spriteRef} href={sprite} x={-STANDING_DOG.frame * FRAME_WIDTH}
            width={FRAME_COUNT * FRAME_WIDTH} height={FRAME_HEIGHT} />
        </svg>
      </g>
    </g>
  );
}
