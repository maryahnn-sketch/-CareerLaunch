/**
 * Pure helpers for private-beta gate decisions (shared by API tests).
 */

export function isPrivateBetaEnabledFlag(value) {
  return value === true || value === 'true';
}

export function shouldEnforceBetaGate(privateBetaEnabled) {
  return isPrivateBetaEnabledFlag(privateBetaEnabled);
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
