import { access } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Loader = typeof import('./orbitFarm-assets');
type Outcome = 'load' | 'error' | 'hang';
let assets: Loader;

function mockImages(outcome: (url: string, attempt: number) => Outcome = () => 'load', rejectDecode = false) {
  const requests: string[] = [];
  const attempts = new Map<string, number>();
  let active = 0;
  let peak = 0;
  const decode = vi.fn(async () => { if (rejectDecode) throw new Error('Decode unavailable after load.'); });
  class TestImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    complete = false;
    naturalWidth = 0;
    decode = decode;
    private pending = false;
    removeAttribute() { if (this.pending) { this.pending = false; active -= 1; } }
    set src(url: string) {
      requests.push(url);
      const attempt = (attempts.get(url) ?? 0) + 1;
      attempts.set(url, attempt);
      active += 1;
      this.pending = true;
      peak = Math.max(peak, active);
      const result = outcome(url, attempt);
      if (result === 'hang') return;
      void Promise.resolve().then(() => {
        this.pending = false;
        active -= 1;
        this.complete = true;
        if (result === 'load') { this.naturalWidth = 32; this.onload?.(); }
        else this.onerror?.();
      });
    }
  }
  vi.stubGlobal('Image', TestImage);
  return { requests, attempts, decode, peak: () => peak };
}

beforeEach(async () => {
  vi.resetModules();
  assets = await import('./orbitFarm-assets');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('local visual asset warmup', () => {
  it('includes every crop stage and resolves every manifest URL to a shipped file', async () => {
    expect(assets.VISUAL_ASSET_URLS).toHaveLength(33);
    expect(new Set(assets.VISUAL_ASSET_URLS).size).toBe(33);
    expect(assets.VISUAL_ASSET_URLS.slice(0, 3)).toEqual([
      assets.ORBIT_SCANNER_SPRITE, assets.FARM_MEADOW_SPRITE, assets.FARM_DOG_SPRITE,
    ]);
    await Promise.all(assets.VISUAL_ASSET_URLS.map(url => access(`public/${url.replace(/^\.?\//, '')}`)));
  });

  it('uses the configured site base for every sprite URL', async () => {
    vi.stubEnv('BASE_URL', '/farm/');
    vi.resetModules();
    const nested = await import('./orbitFarm-assets');
    expect(nested.ORBIT_SCANNER_SPRITE).toBe('/farm/assets/orbit-1/orbit-1-scanner-v1.png');
    expect(nested.getCropSpriteUrl('wheat', 'field-v2')).toBe('/farm/assets/farm/crops/wheat-field-v2.png');
    expect(nested.VISUAL_ASSET_URLS.every(url => url.startsWith('/farm/assets/'))).toBe(true);
  });

  it('warms and decodes all sprites with at most four concurrent loads', async () => {
    const images = mockImages();
    const first = assets.preloadVisualAssets();
    expect(assets.preloadVisualAssets()).toBe(first);
    expect(images.requests).toHaveLength(4);
    await first;
    expect(images.requests).toHaveLength(33);
    expect(images.peak()).toBeLessThanOrEqual(4);
    expect(images.decode).toHaveBeenCalledTimes(33);
    expect(assets.VISUAL_ASSET_URLS.every(url => assets.getAssetStatus(url) === 'ready')).toBe(true);
  });

  it('shares an in-flight sprite request and notifies subscribers after a transient retry', async () => {
    vi.useFakeTimers();
    const images = mockImages((_url, attempt) => attempt === 1 ? 'error' : 'load');
    const states: string[] = [];
    const unsubscribe = assets.subscribeAsset(assets.ORBIT_SCANNER_SPRITE, () => states.push(assets.getAssetStatus(assets.ORBIT_SCANNER_SPRITE)));
    const loading = assets.ensureAssetLoaded(assets.ORBIT_SCANNER_SPRITE);
    expect(assets.ensureAssetLoaded(assets.ORBIT_SCANNER_SPRITE)).toBe(loading);
    await vi.advanceTimersByTimeAsync(200);
    await expect(loading).resolves.toBe(true);
    expect(images.requests).toHaveLength(2);
    expect(states).toEqual(['loading', 'ready']);
    unsubscribe();
  });

  it('settles permanent errors and avoids retry storms from repeated component mounts', async () => {
    vi.useFakeTimers();
    const images = mockImages(() => 'error');
    const loading = assets.ensureAssetLoaded(assets.FARM_DOG_SPRITE);
    await vi.advanceTimersByTimeAsync(200);
    await expect(loading).resolves.toBe(false);
    expect(assets.getAssetStatus(assets.FARM_DOG_SPRITE)).toBe('error');
    await expect(assets.ensureAssetLoaded(assets.FARM_DOG_SPRITE)).resolves.toBe(false);
    expect(images.requests).toHaveLength(2);
  });

  it('bounds stalled image requests so the warmup cannot wait forever', async () => {
    vi.useFakeTimers();
    const images = mockImages(() => 'hang');
    const loading = assets.ensureAssetLoaded(assets.ORBIT_SCANNER_SPRITE);
    await vi.advanceTimersByTimeAsync(45_000);
    await expect(loading).resolves.toBe(false);
    expect(images.requests).toHaveLength(2);
    expect(assets.getAssetStatus(assets.ORBIT_SCANNER_SPRITE)).toBe('error');
  });

  it('keeps a loaded image usable when its browser decode method rejects', async () => {
    const images = mockImages(() => 'load', true);
    await expect(assets.ensureAssetLoaded(assets.FARM_MEADOW_SPRITE)).resolves.toBe(true);
    expect(images.decode).toHaveBeenCalledOnce();
    expect(assets.getAssetStatus(assets.FARM_MEADOW_SPRITE)).toBe('ready');
  });

  it('coalesces mounted-image failures into one recovery and never loops after that', async () => {
    const images = mockImages();
    const url = assets.ORBIT_SCANNER_SPRITE;
    await expect(assets.ensureAssetLoaded(url)).resolves.toBe(true);
    const states: string[] = [];
    assets.subscribeAsset(url, () => states.push(assets.getAssetStatus(url)));
    for (let index = 0; index < 10; index++) assets.reportAssetFailure(url);
    expect(assets.getAssetStatus(url)).toBe('loading');
    expect(images.requests).toHaveLength(2);
    await expect(assets.ensureAssetLoaded(url)).resolves.toBe(true);
    expect(states).toEqual(['loading', 'ready']);
    assets.reportAssetFailure(url);
    expect(assets.getAssetStatus(url)).toBe('error');
    await expect(assets.ensureAssetLoaded(url)).resolves.toBe(false);
    expect(images.requests).toHaveLength(2);
  });

  it('bounds failed display recovery even when many mounted copies report an error', async () => {
    vi.useFakeTimers();
    const images = mockImages((_url, attempt) => attempt === 1 ? 'load' : 'error');
    const url = assets.FARM_DOG_SPRITE;
    await expect(assets.ensureAssetLoaded(url)).resolves.toBe(true);
    for (let index = 0; index < 10; index++) assets.reportAssetFailure(url);
    const recovery = assets.ensureAssetLoaded(url);
    await vi.advanceTimersByTimeAsync(200);
    await expect(recovery).resolves.toBe(false);
    expect(assets.getAssetStatus(url)).toBe('error');
    for (let index = 0; index < 10; index++) assets.reportAssetFailure(url);
    await expect(assets.ensureAssetLoaded(url)).resolves.toBe(false);
    expect(images.requests).toHaveLength(3);
  });

  it('can start display recovery from a readiness subscriber without losing the new request', async () => {
    const images = mockImages();
    const url = assets.FARM_MEADOW_SPRITE;
    let recovered = false;
    let recovery: Promise<boolean> | undefined;
    assets.subscribeAsset(url, () => {
      if (assets.getAssetStatus(url) !== 'ready' || recovered) return;
      recovered = true;
      assets.reportAssetFailure(url);
      recovery = assets.ensureAssetLoaded(url);
    });
    await expect(assets.ensureAssetLoaded(url)).resolves.toBe(true);
    await expect(recovery).resolves.toBe(true);
    expect(assets.getAssetStatus(url)).toBe('ready');
    expect(images.requests).toHaveLength(2);
  });
});
