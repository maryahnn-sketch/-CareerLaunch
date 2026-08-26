/** Absolute deadline watchdog for discoverPaths — shared with regression tests. */

export const DISCOVER_PATHS_TIMEOUT_MS = 90000;
export const DISCOVER_PATHS_COPY_DELAY_MS = 30000;
export const DISCOVER_PATHS_COPY_MESSAGE =
  'Still working — checking a fuller set of directions…';

export class DiscoverPathsTimeoutError extends Error {
  constructor(message = `Operation did not respond within ${DISCOVER_PATHS_TIMEOUT_MS}ms.`) {
    super(message);
    this.name = 'DiscoverPathsTimeoutError';
    this.code = 'TIMEOUT';
    this.category = 'network';
  }
}

export class DiscoverPathsStaleError extends Error {
  constructor() {
    super('Stale discoverPaths response');
    this.name = 'DiscoverPathsStaleError';
  }
}

/**
 * @param {object} opts
 * @param {() => boolean} opts.isActive - true while this attempt may mutate UI state
 * @param {() => void} opts.onCopyDelay - invoked once at copy delay if still active
 * @param {number} [opts.startedAt] - ms when analyzing screen started (deadline anchor)
 * @param {number} [opts.deadlineAt] - absolute ms deadline; defaults to startedAt + timeout
 * @param {number} [opts.now] - injectable clock (ms) for copy-delay scheduling
 * @param {typeof setTimeout} [opts.setTimeoutFn]
 * @param {typeof clearTimeout} [opts.clearTimeoutFn]
 */
export function createDiscoverPathsWatchdog({
  isActive,
  onCopyDelay,
  startedAt = Date.now(),
  deadlineAt = startedAt + DISCOVER_PATHS_TIMEOUT_MS,
  now = startedAt,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  let copyTimer = null;
  let disposed = false;
  const copyAt = startedAt + DISCOVER_PATHS_COPY_DELAY_MS;

  copyTimer = setTimeoutFn(() => {
    if(disposed || !isActive()) return;
    onCopyDelay();
  }, Math.max(0, copyAt - now));

  function remainingMs(at = Date.now()) {
    return Math.max(0, deadlineAt - at);
  }

  function raceDeadline(promise, at = Date.now()) {
    const remaining = remainingMs(at);
    if(remaining <= 0){
      return Promise.reject(new DiscoverPathsTimeoutError());
    }
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        setTimeoutFn(() => reject(new DiscoverPathsTimeoutError()), remaining);
      }),
    ]);
  }

  function dispose() {
    if(disposed) return;
    disposed = true;
    if(copyTimer != null) clearTimeoutFn(copyTimer);
    copyTimer = null;
  }

  return { raceDeadline, dispose, remainingMs, deadlineAt, startedAt };
}

/** Bump generation so in-flight work from `myGen` cannot mutate state. */
export function invalidateDiscoverPathsGeneration(currentGen, getGen, setGen) {
  if(getGen() === currentGen) setGen(currentGen + 1);
}

/** Clear busy only if no newer discoverPaths attempt has started. */
export function shouldClearDiscoverPathsBusy(myGen, currentGen) {
  return currentGen <= myGen + 1;
}
