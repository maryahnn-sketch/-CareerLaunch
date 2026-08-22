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

export const PROTECTED_BETA_DESTINATIONS = new Set([
  'intake',
  'analyzing',
  'skills',
  'paths',
  'conversation',
  'choose',
  'paywall',
  'roadmap',
  'kit',
  'dashboard',
]);

export function isProtectedBetaDestination(destination) {
  return PROTECTED_BETA_DESTINATIONS.has(destination);
}

/**
 * Fail-closed: cached/local access never grants protected views when server
 * validation failed or is still pending.
 */
export function shouldGrantBetaAccess({
  privateBetaEnabled,
  serverValidated = false,
  validationFailed = false,
  serverAccess = null,
  cachedAccess = null,
}) {
  if (!shouldEnforceBetaGate(privateBetaEnabled)) {
    return true;
  }

  if (validationFailed || !serverValidated) {
    return false;
  }

  return Boolean(serverAccess?.inviteId || cachedAccess?.inviteId);
}

export function shouldGateProtectedView({
  privateBetaEnabled,
  gateActive = true,
  serverValidated = false,
  validationFailed = false,
  serverAccess = null,
  cachedAccess = null,
  hasProgressBar = false,
  destination = null,
}) {
  if (!shouldEnforceBetaGate(privateBetaEnabled) || !gateActive) {
    return false;
  }

  if (destination && !isProtectedBetaDestination(destination) && destination !== 'landing') {
    return false;
  }

  if (!hasProgressBar && !destination) {
    return false;
  }

  if (destination === 'landing') {
    return false;
  }

  const access = serverValidated && !validationFailed
    ? (serverAccess || cachedAccess)
    : null;

  if (access?.reusable === true) {
    return false;
  }

  if (access?.status === 'in_progress') {
    return false;
  }

  if (access?.status === 'completed' && destination === 'dashboard') {
    return false;
  }

  return Boolean(hasProgressBar || (destination && isProtectedBetaDestination(destination)));
}

export function resolveRedeemErrorMessage(errorCode, responseStatus) {
  if (errorCode === 'unavailable' || responseStatus === 503) {
    return 'We could not verify your invitation right now. Please try again.';
  }

  return 'That code is not valid. Please check the invitation and try again.';
}

export function buildBetaAdminHeaders({ secretKey = null, serviceRoleKey = null } = {}) {
  const adminKey = secretKey || serviceRoleKey;
  if (!adminKey) {
    throw new Error('Supabase admin credentials are not configured');
  }

  const headers = {
    'content-type': 'application/json',
    apikey: adminKey,
  };

  if (!secretKey && serviceRoleKey) {
    headers.Authorization = `Bearer ${serviceRoleKey}`;
  }

  return headers;
}

/** @typedef {'invite' | 'completed' | 'already_used'} BetaGateMode */

export const BETA_GATE_COPY = {
  invite: {
    title: 'Your invitation opens the experience.',
    body: 'The iFindWorth website is public, but the career-discovery experience is currently invite-only. Enter the code that came with your invitation to continue.',
  },
  completed: {
    title: 'You already completed this beta.',
    body: 'Thank you for testing iFindWorth. This invitation has already been used for a completed journey. Your existing results remain available on this browser.',
  },
  already_used: {
    title: 'This invitation has already been used.',
    body: 'Beta invitations can only be activated once. If you already started testing iFindWorth, please continue on the browser where you began. If you believe this is an error, contact us.',
  },
};

/**
 * Modal mode after a redeem attempt. `already_redeemed` means another session
 * claimed the code — not this user's completed journey.
 */
export function resolveBetaGateModeFromRedeem(errorCode) {
  if (errorCode === 'already_redeemed') {
    return 'already_used';
  }

  return 'invite';
}

/** Modal mode from hydrated server/local access for this browser session. */
export function resolveBetaGateModeFromAccess(access) {
  if (access?.status === 'completed') {
    return 'completed';
  }

  return 'invite';
}
