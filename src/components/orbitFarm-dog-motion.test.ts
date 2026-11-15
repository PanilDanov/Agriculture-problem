import { describe, expect, it } from 'vitest';
import { createDogMotion, DOG_PATH_Y, STANDING_DOG } from './orbitFarm-dog-motion';

describe('the farm dog', () => {
  it('eases into its stride, stops for varied actions, and stays on the path', () => {
    const step = createDogMotion(() => .7);
    const poses = Array.from({ length: 2200 }, () => step(16));
    const start = poses.findIndex(pose => pose.action === 'walk');
    const stop = poses.findIndex((pose, index) => index > start && pose.action !== 'walk');
    const distance = (index: number) => Math.abs(poses[index].x - poses[index - 1].x);

    expect(DOG_PATH_Y).toBe(535);
    expect(poses.every(pose => pose.x >= STANDING_DOG.x && pose.x <= 668)).toBe(true);
    expect(distance(start + 1)).toBeLessThan(.15);
    expect(distance(start + 30)).toBeGreaterThan(.7);
    expect(distance(stop)).toBeLessThan(.15);
    expect([...new Set(poses.map(pose => pose.action))]).toEqual(expect.arrayContaining(['walk', 'wag', 'sniff', 'sit']));
    expect(poses.every((_, index) => index === 0 || distance(index) < .84)).toBe(true);
  });

  it('holds its footing and shows the front pose before walking back', () => {
    const step = createDogMotion(() => .7);
    const poses = Array.from({ length: 1800 }, () => step(16));
    const start = poses.findIndex(pose => pose.action === 'turn');
    const end = poses.findIndex((pose, index) => index > start && pose.action !== 'turn');
    const turn = poses.slice(start, end);
    const frames = turn.map(pose => pose.frame).filter((frame, index, all) => index === 0 || frame !== all[index - 1]);

    expect(frames).toEqual([4, 8, 9, 8, 4]);
    expect(new Set(turn.map(pose => pose.x)).size).toBe(1);
    expect(poses[end].action).toBe('walk');
    expect(poses[end].direction).toBe(-turn[0].direction);
  });
});
