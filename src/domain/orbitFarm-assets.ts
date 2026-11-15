import { CROP_IDS } from './orbitFarm-crop-catalog';
import type { CropId } from './orbitFarm-types';

const assetRoot = `${import.meta.env.BASE_URL}assets/`;
export const ORBIT_SCANNER_SPRITE = `${assetRoot}orbit-1/orbit-1-scanner-v1.png`;
export const FARM_MEADOW_SPRITE = `${assetRoot}farm/orbitFarm-meadow-v2.png`;
export const FARM_DOG_SPRITE = `${assetRoot}farm/orbitFarm-dog-astronaut-v1.png`;
const cropArtwork = ['seedling-v1', 'growing-v1', 'field-v2'] as const;

export function getCropSpriteUrl(cropId: CropId, artwork: string): string {
  return `${assetRoot}farm/crops/${cropId}-${artwork}.png`;
}

export const VISUAL_ASSET_URLS: readonly string[] = Object.freeze([
  ORBIT_SCANNER_SPRITE, FARM_MEADOW_SPRITE, FARM_DOG_SPRITE,
  ...CROP_IDS.flatMap(cropId => cropArtwork.map(artwork => getCropSpriteUrl(cropId, artwork))),
]);

export type AssetStatus = 'idle' | 'loading' | 'ready' | 'error';
interface AssetEntry {
  status: AssetStatus;
  attempts: number;
  displayRecoveryAttempts: number;
  promise?: Promise<boolean>;
  listeners: Set<() => void>;
}
interface AssetJob { url: string; entry: AssetEntry; resolve: (loaded: boolean) => void }
const entries = new Map<string, AssetEntry>();
const queue: AssetJob[] = [];
const MAX_CONCURRENT_LOADS = 4;
const MAX_LOAD_ATTEMPTS = 2;
const LOAD_TIMEOUT_MS = 8_000;
const CRITICAL_LOAD_TIMEOUT_MS = 20_000;
const RETRY_DELAY_MS = 150;
let activeLoads = 0;
let warmup: Promise<void> | undefined;

function entryFor(url: string): AssetEntry {
  let entry = entries.get(url);
  if (!entry) { entry = { status: 'idle', attempts: 0, displayRecoveryAttempts: 0, listeners: new Set() }; entries.set(url, entry); }
  return entry;
}

function setStatus(entry: AssetEntry, status: AssetStatus) {
  if (entry.status === status) return;
  entry.status = status;
  for (const listener of entry.listeners) listener();
}

export function getAssetStatus(url: string): AssetStatus {
  return entries.get(url)?.status ?? 'idle';
}

export function subscribeAsset(url: string, listener: () => void): () => void {
  const entry = entryFor(url);
  entry.listeners.add(listener);
  return () => { entry.listeners.delete(listener); };
}

function loadImage(url: string): Promise<boolean> {
  return new Promise(resolve => {
    const image = new Image();
    const critical = url === ORBIT_SCANNER_SPRITE || url === FARM_MEADOW_SPRITE;
    let settled = false;
    let decoding = false;
    const finish = (loaded: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      if (!loaded) image.removeAttribute('src');
      resolve(loaded);
    };
    const loaded = async () => {
      if (settled || decoding) return;
      decoding = true;
      // Some browsers reject decode() for an already loaded image. Its load
      // result and dimensions still provide a usable fallback in that case.
      try { if (typeof image.decode === 'function') await image.decode(); } catch { /* Keep a successfully loaded image. */ }
      finish(image.naturalWidth > 0);
    };
    const timeout = setTimeout(() => finish(false), critical ? CRITICAL_LOAD_TIMEOUT_MS : LOAD_TIMEOUT_MS);
    image.decoding = 'async';
    image.fetchPriority = critical ? 'high' : 'low';
    image.onload = () => { void loaded(); };
    image.onerror = () => finish(false);
    image.src = url;
    if (image.complete && image.naturalWidth > 0) void loaded();
  });
}

async function runJob(job: AssetJob) {
  let loaded = false;
  try {
    while (job.entry.attempts < MAX_LOAD_ATTEMPTS) {
      job.entry.attempts += 1;
      if (await loadImage(job.url)) { loaded = true; break; }
      if (job.entry.attempts < MAX_LOAD_ATTEMPTS) await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    }
  } catch {
    // Decorative assets must never prevent navigation or field analysis.
  }
  job.entry.promise = undefined;
  setStatus(job.entry, loaded ? 'ready' : 'error');
  job.resolve(loaded);
  activeLoads -= 1;
  drainQueue();
}

function drainQueue() {
  while (activeLoads < MAX_CONCURRENT_LOADS && queue.length > 0) {
    activeLoads += 1;
    void runJob(queue.shift()!);
  }
}

/** Deduplicated, bounded loading shared by startup and visible components. */
export function ensureAssetLoaded(url: string): Promise<boolean> {
  const entry = entryFor(url);
  if (entry.status === 'ready') return Promise.resolve(true);
  if (entry.promise) return entry.promise;
  if (typeof Image === 'undefined' || entry.attempts >= MAX_LOAD_ATTEMPTS) return Promise.resolve(false);
  entry.promise = new Promise(resolve => { queue.push({ url, entry, resolve }); });
  setStatus(entry, 'loading');
  drainQueue();
  return entry.promise;
}

/** Recover once when a mounted image fails after an earlier successful preload. */
export function reportAssetFailure(url: string): void {
  const entry = entryFor(url);
  if (entry.status !== 'ready') return;
  if (entry.displayRecoveryAttempts >= 1) {
    entry.attempts = MAX_LOAD_ATTEMPTS;
    setStatus(entry, 'error');
    return;
  }
  entry.displayRecoveryAttempts += 1;
  entry.attempts = 0;
  // ensureAssetLoaded publishes loading after installing its shared promise,
  // so simultaneous mounted-image errors all join the same recovery.
  entry.status = 'idle';
  void ensureAssetLoaded(url);
}

/** Warm every local sprite without delaying application rendering. */
export function preloadVisualAssets(): Promise<void> {
  warmup ??= Promise.all(VISUAL_ASSET_URLS.map(ensureAssetLoaded)).then(() => undefined);
  return warmup;
}
