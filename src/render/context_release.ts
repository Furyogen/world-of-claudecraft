// Promptly release WebGL contexts when the page is torn down (reload, navigation,
// tab close). Browsers cap the number of live WebGL contexts per GPU process
// (~16) and reclaim lost ones lazily, so a player who reloads repeatedly - which
// the client does on every logout / "Return to Login" via location.reload - can
// exhaust the pool and make the next `new THREE.WebGLRenderer` throw
// "Error creating WebGL context". Forcing context loss on `pagehide` hands every
// context back at once instead of waiting for garbage collection.

/** The slice of THREE.WebGLRenderer we need to free a GPU context. */
export interface WebGLContextHolder {
  forceContextLoss(): void;
  dispose(): void;
}

const holders = new Set<WebGLContextHolder>();
const teardownFns = new Set<() => void>();

/**
 * Track a renderer so its GL context is released on page teardown. Returns an
 * unregister function; call it if the renderer is disposed earlier so it is not
 * touched twice.
 */
export function trackWebGLContext(holder: WebGLContextHolder): () => void {
  holders.add(holder);
  return () => {
    holders.delete(holder);
  };
}

/**
 * Register a callback to run on page teardown alongside WebGL context release —
 * e.g. closing AudioContexts, which are not GPU contexts but leak the same way
 * across the editor↔playtest navigation ping-pong. Returns an unregister
 * function. Callbacks must be idempotent and swallow their own errors.
 */
export function registerPageTeardown(fn: () => void): () => void {
  teardownFns.add(fn);
  return () => {
    teardownFns.delete(fn);
  };
}

function runPageTeardowns(): void {
  for (const fn of teardownFns) {
    try {
      fn();
    } catch {
      /* best-effort teardown */
    }
  }
}

/**
 * Force-lose and dispose every tracked context, then forget them. Safe to call
 * more than once; per-holder failures are swallowed so one already-lost context
 * cannot block the rest.
 */
export function releaseTrackedWebGLContexts(): void {
  for (const holder of holders) {
    try {
      holder.forceContextLoss();
    } catch {
      /* context may already be lost */
    }
    try {
      holder.dispose();
    } catch {
      /* best-effort teardown */
    }
  }
  holders.clear();
}

/**
 * Wire context release to the page-teardown event. `pagehide` fires on reload,
 * navigation, and tab close, and unlike `unload` it does not disqualify the page
 * from the bfcache. Call once at startup.
 *
 * Release only on a real teardown (`persisted === false`) — this is what frees
 * the GPU context whose leak the ~16-per-process cap otherwise punishes (the
 * editor's viewport renderer never wired this, so every Playtest launch leaked
 * its context until the browser was restarted). Registered page-teardown
 * callbacks (e.g. closing AudioContexts) run in the same breath.
 *
 * When the page is frozen into the bfcache (`persisted === true`) everything must
 * survive: `dispose()` is terminal and nothing rebuilds them, so a bfcache
 * restore (`pageshow` with `persisted`) has to come back to live canvases, not
 * dead ones. bfcache retention is bounded (the browser evicts under memory
 * pressure), so it is not the unbounded leak.
 */
export function installWebGLContextRelease(
  target: Pick<EventTarget, 'addEventListener'> = window,
): void {
  target.addEventListener('pagehide', (e) => {
    if (!(e as PageTransitionEvent).persisted) {
      runPageTeardowns();
      releaseTrackedWebGLContexts();
    }
  });
}
