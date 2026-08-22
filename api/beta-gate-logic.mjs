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
