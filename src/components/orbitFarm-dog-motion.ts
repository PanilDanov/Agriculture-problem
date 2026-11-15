type Direction = 1 | -1;
type IdleAction = 'wag' | 'sniff' | 'sit';

type Phase =
  | { action: 'walk'; duration: number; target: number }
  | { action: 'turn' | IdleAction; duration: number };

export interface DogPose {
  x: number;
  direction: Direction;
  frame: number;
  action: Phase['action'] | 'stand';
}

const PATH_LEFT = 128;
const PATH_RIGHT = 668;
const WALK_SPEED = .051;
const RAMP_TIME = 300;
const WALK_FRAME_TRAVEL = 6.2;
const TURN_TIME = 520;
const SPRITE = {
  standing: 4, wag: 5, sniff: 6, liftHead: 7, quarterTurn: 8, front: 9, sit: 10, blink: 11,
};
const TURN_FRAMES = [SPRITE.standing, SPRITE.quarterTurn, SPRITE.front, SPRITE.quarterTurn, SPRITE.standing];
const IDLE_DURATIONS = {
  wag: [880, 1420],
  sniff: [1200, 1850],
  sit: [1650, 2450],
} satisfies Record<IdleAction, [number, number]>;
const IDLE_ACTIONS: IdleAction[] = ['wag', 'sniff', 'sit'];

export const DOG_PATH_Y = 535;
export const STANDING_DOG: DogPose = { x: PATH_LEFT, direction: 1, frame: SPRITE.standing, action: 'stand' };

function opposite(direction: Direction): Direction {
  return direction === 1 ? -1 : 1;
}

function walkDistance(elapsed: number, duration: number, distance: number) {
  const ramp = Math.min(RAMP_TIME, duration / 2);
  const speed = distance / (duration - ramp);
  const remaining = duration - elapsed;
  if (elapsed < ramp) return speed * elapsed ** 2 / (2 * ramp);
  if (remaining < ramp) return distance - speed * remaining ** 2 / (2 * ramp);
  return speed * (elapsed - ramp / 2);
}

function idleFrame(action: IdleAction, elapsed: number, duration: number) {
  const remaining = duration - elapsed;
  if (elapsed < 90 || remaining < 90) return SPRITE.standing;

  switch (action) {
    case 'wag':
      return Math.floor(elapsed / 150) % 2 ? SPRITE.wag : SPRITE.standing;
    case 'sniff':
      if (elapsed < 250 || remaining < 220) return SPRITE.liftHead;
      return Math.floor(elapsed / 280) % 3 === 1 ? SPRITE.liftHead : SPRITE.sniff;
    case 'sit':
      if (elapsed < 240 || remaining < 245) return SPRITE.quarterTurn;
      return elapsed % 780 >= 640 ? SPRITE.blink : SPRITE.sit;
  }
}

export function createDogMotion(random: () => number = Math.random) {
  let x = STANDING_DOG.x;
  let direction = STANDING_DOG.direction;
  let lastIdle: IdleAction = 'wag';
  let phase: Phase = { action: 'wag', duration: 430 };
  let elapsed = 0;

  function walk(): Phase {
    const distance = 88 + random() * 102;
    const target = Math.max(PATH_LEFT, Math.min(PATH_RIGHT, x + direction * distance));
    return { action: 'walk', duration: Math.abs(target - x) / WALK_SPEED + RAMP_TIME, target };
  }

  function advancePhase(): Phase {
    if (phase.action === 'walk') {
      x = phase.target;
      const options = IDLE_ACTIONS.filter(action => action !== lastIdle);
      lastIdle = options[Math.floor(random() * options.length)];
      const [minimum, maximum] = IDLE_DURATIONS[lastIdle];
      return { action: lastIdle, duration: minimum + random() * (maximum - minimum) };
    }
    if (phase.action === 'turn') {
      direction = opposite(direction);
      return walk();
    }
    const distanceToEdge = direction === 1 ? PATH_RIGHT - x : x - PATH_LEFT;
    const hasRoomToTurn = x - PATH_LEFT >= 88 && PATH_RIGHT - x >= 88;
    return distanceToEdge < 35 || (hasRoomToTurn && random() < .18)
      ? { action: 'turn', duration: TURN_TIME }
      : walk();
  }

  return (delta: number): DogPose => {
    elapsed += delta;
    while (elapsed >= phase.duration) {
      elapsed -= phase.duration;
      phase = advancePhase();
    }

    const { action, duration } = phase;
    if (action === 'walk') {
      const distance = Math.abs(phase.target - x);
      const traveled = walkDistance(elapsed, duration, distance);
      const nearStop = traveled < 2 || distance - traveled < 2;
      const frame = nearStop ? SPRITE.standing : Math.floor(traveled / WALK_FRAME_TRAVEL) % 4;
      return { x: x + direction * traveled, direction, frame, action };
    }
    if (action === 'turn') {
      const stage = Math.floor(elapsed * TURN_FRAMES.length / duration);
      const poseDirection = stage < 2 ? direction : stage === 2 ? 1 : opposite(direction);
      return { x, direction: poseDirection, frame: TURN_FRAMES[stage], action };
    }
    return { x, direction, frame: idleFrame(action, elapsed, duration), action };
  };
}
