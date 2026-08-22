/**
 * Pure helpers for private-beta gate decisions (shared by API tests).
 *
 * Fail-closed: only explicit false disables protection; missing/malformed stays protected.
 */

export function isPrivateBetaDisabledFlag(value) {
  return value === false || value === 'false';
}

/** @deprecated Use isPrivateBetaDisabledFlag; kept for test clarity. */
export function isPrivateBetaEnabledFlag(value) {
  return !isPrivateBetaDisabledFlag(value);
}

export function shouldEnforceBetaGate(privateBetaEnabled) {
  return !isPrivateBetaDisabledFlag(privateBetaEnabled);
}

export function shouldBlockNavigation(access, destination, privateBetaEnabled) {
  if (!shouldEnforceBetaGate(privateBetaEnabled)) {
    return false;
  }

  if (access?.reusable === true) {
    return false;
  }

  if (access?.status === 'in_progress') {
    return false;
  }

  if (access?.status === 'completed' && destination === 'dashboard') {
    return false;
  }

  if (!destination || destination === 'landing') {
    return false;
  }

  return true;
}
