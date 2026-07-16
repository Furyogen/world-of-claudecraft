// Runtime asset loading: glTF models (meshopt-compressed) + HDR environment
// maps, with a promise cache so every consumer shares one parse per URL.
// Render-layer only — the sim must never import this (it runs headless).
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { type GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { assetUrl } from './media';
import { assetLoadStarted, recordAssetLoad } from './stats';

let gltfLoader: GLTFLoader | null = null;
const gltfCache = new Map<string, Promise<GLTF>>();
const hdrCache = new Map<string, Promise<THREE.DataTexture>>();
const texCache = new Map<string, Promise<THREE.Texture>>();

interface AssetQueue {
  active: number;
  limit: number;
  pending: (() => void)[];
}

function constrainedBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const narrow = typeof innerWidth === 'number' && Math.min(innerWidth, innerHeight) <= 700;
  return (coarse && narrow) || (nav.deviceMemory !== undefined && nav.deviceMemory <= 4);
}

const constrained = constrainedBrowser();
const gltfQueue: AssetQueue = { active: 0, limit: constrained ? 2 : 4, pending: [] };
const textureQueue: AssetQueue = { active: 0, limit: constrained ? 3 : 6, pending: [] };
const hdrQueue: AssetQueue = { active: 0, limit: 1, pending: [] };

function pumpQueue(q: AssetQueue): void {
  while (q.active < q.limit && q.pending.length > 0) {
    const start = q.pending.shift()!;
    q.active++;
    // Keep large loader callback chains from running in one import-time burst.
    globalThis.setTimeout(start, 0);
  }
}

function scheduleLoad<T>(q: AssetQueue, run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    q.pending.push(() => {
      run()
        .then(resolve, reject)
        .finally(() => {
          q.active = Math.max(0, q.active - 1);
          pumpQueue(q);
        });
    });
    pumpQueue(q);
  });
}

function loader(): GLTFLoader {
  if (!gltfLoader) {
    gltfLoader = new GLTFLoader();
    gltfLoader.setMeshoptDecoder(MeshoptDecoder);
  }
  return gltfLoader;
}

/** Load + parse a .glb once; subsequent calls share the same parsed scene.
 *  Consumers must treat the result as immutable — clone before mutating. */
export function loadGltf(url: string): Promise<GLTF> {
  const resolved = assetUrl(url);
  let p = gltfCache.get(resolved);
  if (!p) {
    const startedAt = assetLoadStarted();
    p = scheduleLoad(
      gltfQueue,
      () =>
        new Promise<GLTF>((resolve, reject) => {
          loader().load(
            resolved,
            (gltf) => {
              recordAssetLoad('gltf', resolved, startedAt);
              resolve(gltf);
            },
            undefined,
            () => {
              recordAssetLoad('gltf', resolved, startedAt, true);
              reject(new Error(`asset load failed: ${url} (missing file or bad GLB)`));
            },
          );
        }),
    ).catch((err: unknown) => {
      // Evict the rejected promise so the next call re-fetches rather than
      // permanently caching a failure (black void bug: rejected promise poisons
      // ensureDungeonAssets for the whole session).
      gltfCache.delete(resolved);
      throw err;
    });
    gltfCache.set(resolved, p);
  }
  return p;
}

/** Drop a parsed glTF from the cache once its data has been extracted into
 *  module-owned structures — lets the parsed scene, original geometry and any
 *  duplicate decoded textures be garbage-collected. A later loadGltf for the
 *  same url would simply re-fetch. */
export function releaseGltf(url: string): void {
  gltfCache.delete(assetUrl(url));
}

// One shared decode worker (created lazily): fetch + RGBE parse of an 8MB 2k
// HDRI is over a second of pure CPU, a measured full-frame stall every time
// zone streaming brought in a new biome's sky. Requests are matched by id;
// the pixel buffer transfers back zero-copy.
let hdrWorker: Worker | null = null;
let hdrWorkerSeq = 0;
const hdrWorkerPending = new Map<
  number,
  (r: import('./hdr_decode_worker').HdrDecodeResponse) => void
>();
function hdrDecodeInWorker(url: string): Promise<import('./hdr_decode_worker').HdrDecodeResponse> {
  if (!hdrWorker) {
    try {
      hdrWorker = new Worker(new URL('./hdr_decode_worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch {
      return Promise.resolve({ id: 0, ok: false, error: 'worker unavailable' });
    }
    hdrWorker.onmessage = (e: MessageEvent<import('./hdr_decode_worker').HdrDecodeResponse>) => {
      const pending = hdrWorkerPending.get(e.data.id);
      if (pending) {
        hdrWorkerPending.delete(e.data.id);
        pending(e.data);
      }
    };
    // A worker-level failure (script load, uncaught throw) must never strand
    // the callers: fail every pending decode so loadHdr's fallback path runs.
    hdrWorker.onerror = () => {
      for (const [id, resolve] of hdrWorkerPending) {
        hdrWorkerPending.delete(id);
        resolve({ id, ok: false, error: 'hdr decode worker error' });
      }
    };
  }
  const id = ++hdrWorkerSeq;
  return new Promise((resolve) => {
    hdrWorkerPending.set(id, resolve);
    hdrWorker?.postMessage({ id, url } satisfies import('./hdr_decode_worker').HdrDecodeRequest);
  });
}

// The exact texture configuration RGBELoader.load applies for the HalfFloat/
// Float types it produces (three/examples RGBELoader onLoadCallback), plus the
// equirect mapping loadHdr always set. Keep in lockstep with the fallback path
// below, which still routes through RGBELoader.load itself.
function finishHdrTexture(tex: THREE.DataTexture): THREE.DataTexture {
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.flipY = true;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.needsUpdate = true;
  return tex;
}

/** Equirectangular Radiance .hdr for IBL / sky sampling (HalfFloat). */
export function loadHdr(url: string): Promise<THREE.DataTexture> {
  const resolved = assetUrl(url);
  let p = hdrCache.get(resolved);
  if (!p) {
    const startedAt = assetLoadStarted();
    p = scheduleLoad(hdrQueue, async () => {
      // Decode off-thread when the host has workers (the game client);
      // plain-Node tests and exotic hosts fall back to the loader path.
      if (typeof Worker !== 'undefined') {
        const decoded = await hdrDecodeInWorker(resolved);
        if (decoded.ok && decoded.data && decoded.width && decoded.height) {
          const pixels = decoded.data as unknown as Uint16Array<ArrayBuffer>;
          const tex = new THREE.DataTexture(pixels, decoded.width, decoded.height);
          tex.type = decoded.type as THREE.TextureDataType;
          finishHdrTexture(tex);
          recordAssetLoad('hdr', resolved, startedAt);
          return tex;
        }
        // fall through to the main-thread loader on a worker failure
      }
      return new Promise<THREE.DataTexture>((resolve, reject) => {
        new RGBELoader().load(
          resolved,
          (tex) => {
            tex.mapping = THREE.EquirectangularReflectionMapping;
            recordAssetLoad('hdr', resolved, startedAt);
            resolve(tex);
          },
          undefined,
          () => {
            recordAssetLoad('hdr', resolved, startedAt, true);
            reject(new Error(`hdr load failed: ${url}`));
          },
        );
      });
    });
    hdrCache.set(resolved, p);
  }
  return p;
}

/** Plain image texture (terrain splats, water normals, VFX sprites). */
export function loadTexture(
  url: string,
  opts: { srgb?: boolean; repeat?: boolean } = {},
): Promise<THREE.Texture> {
  const resolved = assetUrl(url);
  const key = `${resolved}|${opts.srgb ? 's' : 'l'}|${opts.repeat ? 'r' : 'c'}`;
  let p = texCache.get(key);
  if (!p) {
    const startedAt = assetLoadStarted();
    p = scheduleLoad(
      textureQueue,
      () =>
        new Promise<THREE.Texture>((resolve, reject) => {
          new THREE.TextureLoader().load(
            resolved,
            (tex) => {
              if (opts.srgb) tex.colorSpace = THREE.SRGBColorSpace;
              if (opts.repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
              recordAssetLoad('texture', resolved, startedAt);
              resolve(tex);
            },
            undefined,
            () => {
              recordAssetLoad('texture', resolved, startedAt, true);
              reject(new Error(`texture load failed: ${url}`));
            },
          );
        }),
    );
    texCache.set(key, p);
  }
  return p;
}
