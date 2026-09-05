/**
 * Shared retry-tier policy for callStructured.
 * Keep in sync with the inline helpers in index.html callStructured().
 */

export const DISCOVER_PATHS_MIN_TIER_MS = 25000;

export function remainingDeadlineMs(deadlineAt, now = Date.now()) {
  if (deadlineAt == null || !Number.isFinite(deadlineAt)) return Infinity;
  return Math.max(0, deadlineAt - now);
}

export function canStartAiTier(remainingMs, minMs = DISCOVER_PATHS_MIN_TIER_MS) {
  return Number(remainingMs) >= minMs;
}

export function shouldReshapeStructuredFailure(err) {
  return !!(
    err &&
    err.category === 'schema' &&
    err.partial &&
    err.validationKind !== 'semantic'
  );
}

/**
 * Decide the next callStructured action after a failed tier.
 * @returns {'reshape' | 'repair' | 'abort'}
 */
export function nextStructuredRetryAction(
  err,
  remainingMs,
  { alreadyTriedReshape = false, minMs = DISCOVER_PATHS_MIN_TIER_MS } = {}
) {
  if (!canStartAiTier(remainingMs, minMs)) return 'abort';
  if (!alreadyTriedReshape && shouldReshapeStructuredFailure(err)) return 'reshape';
  return 'repair';
}
