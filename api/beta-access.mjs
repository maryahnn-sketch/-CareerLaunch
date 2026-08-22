/**
 * iFindWorth private beta access API.
 *
 * Supabase is the source of truth for invite redemption and journey status.
 * Raw invite codes are never logged or persisted — only SHA-256 hashes reach RPCs.
 */

import {
  completeBetaJourney,
  getBetaAccess,
  isPrivateBetaEnabled,
  jsonResponse,
  mapAccessPayload,
  mapRedeemPayload,
  normalizeInviteCode,
  redeemBetaInvite,
  requireAuthenticatedUser,
  sha256Hex,
} from './beta-auth.mjs';

function publicStatusBody(access = null) {
  const privateBetaEnabled = isPrivateBetaEnabled();

  if (!privateBetaEnabled) {
    return {
      privateBetaEnabled: false,
      hasAccess: true,
    };
  }

  return {
    privateBetaEnabled: true,
    ...mapAccessPayload(access),
  };
}

async function handleStatus(request) {
  if (!isPrivateBetaEnabled()) {
    return jsonResponse(publicStatusBody());
  }

  const auth = await requireAuthenticatedUser(request);
  if (!auth.ok) {
    return auth.response;
  }

  let access = null;
  try {
    access = await getBetaAccess(auth.userId);
  } catch (error) {
    console.error('[iFindWorth beta] status lookup failed', error);
    return jsonResponse({
      privateBetaEnabled: true,
      hasAccess: false,
      errorCode: 'unavailable',
    }, 503);
  }

  return jsonResponse(publicStatusBody(access));
}

async function handleRedeem(request, payload) {
  if (!isPrivateBetaEnabled()) {
    return jsonResponse({
      ok: true,
      privateBetaEnabled: false,
      hasAccess: true,
    });
  }

  const auth = await requireAuthenticatedUser(request);
  if (!auth.ok) {
    return auth.response;
  }

  const code = normalizeInviteCode(payload?.code);
  if (!code || code.length < 8 || code.length > 40) {
    return jsonResponse({ ok: false, errorCode: 'invalid' }, 403);
  }

  const codeHash = await sha256Hex(code);

  let result = null;
  try {
    result = await redeemBetaInvite(codeHash, auth.userId);
  } catch (error) {
    console.error('[iFindWorth beta] redeem failed for user', auth.userId, error);
    return jsonResponse({ ok: false, errorCode: 'unavailable' }, 503);
  }

  const mapped = mapRedeemPayload(result);
  if (!mapped.ok) {
    const status = mapped.errorCode === 'already_redeemed' ? 409 : 403;
    console.info('[iFindWorth beta] redeem rejected', {
      userId: auth.userId,
      errorCode: mapped.errorCode,
      inviteId: mapped.inviteId || undefined,
    });
    return jsonResponse(mapped, status);
  }

  console.info('[iFindWorth beta] redeem accepted', {
    userId: auth.userId,
    inviteId: mapped.inviteId,
    reusable: mapped.reusable,
  });

  return jsonResponse(mapped);
}

async function handleComplete(request) {
  if (!isPrivateBetaEnabled()) {
    return jsonResponse({ ok: true, privateBetaEnabled: false, skipped: true });
  }

  const auth = await requireAuthenticatedUser(request);
  if (!auth.ok) {
    return auth.response;
  }

  let result = null;
  try {
    result = await completeBetaJourney(auth.userId);
  } catch (error) {
    console.error('[iFindWorth beta] complete failed for user', auth.userId, error);
    return jsonResponse({ ok: false, errorCode: 'no_access' }, 503);
  }

  if (!result?.ok) {
    return jsonResponse({
      ok: false,
      errorCode: result?.error_code || 'no_access',
    }, 403);
  }

  console.info('[iFindWorth beta] journey complete', {
    userId: auth.userId,
    inviteId: result.invite_id || undefined,
    skipped: result.skipped === true,
  });

  return jsonResponse({
    ok: true,
    status: result.status || 'completed',
    skipped: result.skipped === true,
    alreadyCompleted: result.already_completed === true,
  });
}

async function parsePayload(request) {
  if (request.method === 'GET') {
    return {};
  }

  try {
    return await request.json();
  } catch {
    return null;
  }
}

export default {
  async fetch(request) {
    if (request.method !== 'POST' && request.method !== 'GET') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    const payload = await parsePayload(request);
    if (payload === null) {
      return jsonResponse({ error: 'Invalid request' }, 400);
    }

    const action = payload.action || (payload.code ? 'redeem' : 'status');

    switch (action) {
      case 'status':
        return handleStatus(request);
      case 'redeem':
        return handleRedeem(request, payload);
      case 'complete':
        if (request.method === 'GET') {
          return jsonResponse({ error: 'Method not allowed' }, 405);
        }
        return handleComplete(request);
      default:
        return jsonResponse({ error: 'Unknown action' }, 400);
    }
  },
};
