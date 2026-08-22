/**
 * Shared Supabase auth + private beta access helpers for API routes.
 *
 * Anonymous beta access is tied to the Supabase anonymous user/session created in
 * each browser. A single-use invite code binds to that user id; another browser
 * cannot recover the same redemption in this phase (no cross-browser recovery).
 *
 * PRIVATE_BETA_ENABLED fail-closed: only the literal string "false" disables
 * protection; missing, empty, or any other value keeps beta enforcement on.
 */

const NO_STORE_HEADERS = { 'cache-control': 'no-store' };

export function isPrivateBetaEnabled() {
  return process.env.PRIVATE_BETA_ENABLED !== 'false';
}

export function jsonResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

export function extractBearerToken(request) {
  const header = request.headers.get('authorization') || request.headers.get('Authorization');
  if (!header) return null;

  const match = header.match(/^Bearer\s+(\S+)\s*$/i);
  return match ? match[1] : null;
}

export function getSupabaseEnv() {
  return {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    secretKey: process.env.SUPABASE_SECRET_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

export async function verifySupabaseAccessToken(accessToken) {
  const { url, anonKey } = getSupabaseEnv();
  if (!url || !anonKey || !accessToken) return null;

  const response = await fetch(`${url.replace(/\/$/, '')}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
    },
  });

  if (!response.ok) return null;

  const user = await response.json();
  return user?.id || null;
}

export async function invokeBetaRpc(rpcName, body) {
  const { url, secretKey, serviceRoleKey } = getSupabaseEnv();
  const adminKey = secretKey || serviceRoleKey;
  if (!url || !adminKey) {
    throw new Error('Supabase admin credentials are not configured');
  }

  const headers = {
    'content-type': 'application/json',
    'Content-Profile': 'public',
    apikey: adminKey,
  };
  if (!secretKey && serviceRoleKey) {
    headers.Authorization = `Bearer ${serviceRoleKey}`;
  }

  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/${rpcName}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`RPC ${rpcName} failed (${response.status}): ${text.slice(0, 200)}`);
  }

  return response.json();
}

export async function getBetaAccess(userId) {
  return invokeBetaRpc('get_beta_access', { p_user_id: userId });
}

export async function redeemBetaInvite(codeHash, userId) {
  return invokeBetaRpc('redeem_beta_invite', {
    p_code_hash: codeHash,
    p_user_id: userId,
  });
}

export async function completeBetaJourney(userId) {
  return invokeBetaRpc('complete_beta_journey', { p_user_id: userId });
}

export async function requireAuthenticatedUser(request) {
  const accessToken = extractBearerToken(request);
  if (!accessToken) {
    return { ok: false, response: jsonResponse({ error: 'Unauthorized' }, 401) };
  }

  let userId = null;
  try {
    userId = await verifySupabaseAccessToken(accessToken);
  } catch (error) {
    console.error('[iFindWorth beta] Supabase token verification failed', error);
    return { ok: false, response: jsonResponse({ error: 'Unauthorized' }, 401) };
  }

  if (!userId) {
    return { ok: false, response: jsonResponse({ error: 'Unauthorized' }, 401) };
  }

  return { ok: true, userId, accessToken };
}

export async function ensureBetaAccessForUser(userId) {
  if (!isPrivateBetaEnabled()) {
    return { ok: true, betaRequired: false };
  }

  let access = null;
  try {
    access = await getBetaAccess(userId);
  } catch (error) {
    console.error('[iFindWorth beta] get_beta_access failed', error);
    return { ok: false, response: jsonResponse({ error: 'Beta access check failed' }, 503) };
  }

  if (!access?.has_access) {
    return { ok: false, response: jsonResponse({ error: 'Beta access required' }, 403) };
  }

  return { ok: true, betaRequired: true, access };
}

export async function requireBetaAccess(request) {
  if (!isPrivateBetaEnabled()) {
    return { ok: true, betaRequired: false };
  }

  const auth = await requireAuthenticatedUser(request);
  if (!auth.ok) {
    return auth;
  }

  const beta = await ensureBetaAccessForUser(auth.userId);
  if (!beta.ok) {
    return beta;
  }

  return { ok: true, betaRequired: true, userId: auth.userId, access: beta.access };
}

export function normalizeInviteCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function mapAccessPayload(access) {
  if (!access?.has_access) {
    return { hasAccess: false };
  }

  return {
    hasAccess: true,
    inviteId: access.invite_id,
    reusable: access.reusable === true,
    status: access.status,
    grantedAt: access.granted_at || null,
    completedAt: access.completed_at || null,
  };
}

export function mapRedeemPayload(result) {
  if (!result?.ok) {
    return {
      ok: false,
      errorCode: result?.error_code || 'invalid',
      inviteId: result?.invite_id || null,
    };
  }

  return {
    ok: true,
    inviteId: result.invite_id,
    reusable: result.reusable === true,
    status: result.status,
    grantedAt: result.granted_at || new Date().toISOString(),
    alreadyAssigned: result.already_assigned === true,
  };
}
