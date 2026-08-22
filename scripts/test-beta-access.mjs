/**
 * Regression checks for /api/beta-access and beta gate helpers.
 * Run: node scripts/test-beta-access.mjs
 */

import betaAccessHandler from '../api/beta-access.mjs';
import claudeHandler from '../api/claude.mjs';
import {
  ensureBetaAccessForUser,
  getBetaAccess,
  getSupabaseEnv,
  invokeBetaRpc,
  isPrivateBetaEnabled,
  mapRedeemPayload,
  sha256Hex,
} from '../api/beta-auth.mjs';
import {
  BETA_GATE_COPY,
  buildBetaAdminHeaders,
  resolveBetaGateModeFromAccess,
  resolveBetaGateModeFromRedeem,
  resolveRedeemErrorMessage,
  shouldBlockNavigation,
  shouldEnforceBetaGate,
  shouldGateProtectedView,
  shouldGrantBetaAccess,
} from '../api/beta-gate-logic.mjs';

const ORIGINAL_ENV = { ...process.env };

const BETA_HASH = '5a50f1d66be34adbc8781191a16a6e2a595a8fc42946982ab40ba4669c73f1bb';
const OWNER_HASH = 'fb8824971a848e16922eb80b74bfefeb30bb65a528555ef9a531ba75c3c41ace';

const rpcState = {
  invites: new Map(),
  redemptions: new Map(),
};

let passed = 0;
let failed = 0;

function setEnv(overrides = {}) {
  process.env.SUPABASE_URL = overrides.SUPABASE_URL ?? 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = overrides.SUPABASE_ANON_KEY ?? 'anon-key-test';
  if (Object.prototype.hasOwnProperty.call(overrides, 'SUPABASE_SERVICE_ROLE_KEY')) {
    if (overrides.SUPABASE_SERVICE_ROLE_KEY === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = overrides.SUPABASE_SERVICE_ROLE_KEY;
    }
  } else {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
  }
  process.env.ANTHROPIC_API_KEY = overrides.ANTHROPIC_API_KEY ?? 'anthropic-key-test';
  if (Object.prototype.hasOwnProperty.call(overrides, 'SUPABASE_SECRET_KEY')) {
    if (overrides.SUPABASE_SECRET_KEY === undefined) {
      delete process.env.SUPABASE_SECRET_KEY;
    } else {
      process.env.SUPABASE_SECRET_KEY = overrides.SUPABASE_SECRET_KEY;
    }
  } else {
    delete process.env.SUPABASE_SECRET_KEY;
  }
  if (Object.prototype.hasOwnProperty.call(overrides, 'PRIVATE_BETA_ENABLED')) {
    if (overrides.PRIVATE_BETA_ENABLED === undefined) {
      delete process.env.PRIVATE_BETA_ENABLED;
    } else {
      process.env.PRIVATE_BETA_ENABLED = overrides.PRIVATE_BETA_ENABLED;
    }
  } else {
    process.env.PRIVATE_BETA_ENABLED = 'true';
  }
}

function restoreEnv() {
  process.env = { ...ORIGINAL_ENV };
}

function resetRpcState() {
  rpcState.invites = new Map([
    ['BETA-001', {
      id: 'BETA-001',
      code_hash: BETA_HASH,
      reusable: false,
      expires_at: null,
      revoked_at: null,
      redeemed_at: null,
      redeemed_by: null,
    }],
    ['OWNER', {
      id: 'OWNER',
      code_hash: OWNER_HASH,
      reusable: true,
      expires_at: null,
      revoked_at: null,
      redeemed_at: null,
      redeemed_by: null,
    }],
    ['BETA-EXPIRED', {
      id: 'BETA-EXPIRED',
      code_hash: 'expiredhash0000000000000000000000000000000000000000000000000001',
      reusable: false,
      expires_at: '2020-01-01T00:00:00.000Z',
      revoked_at: null,
      redeemed_at: null,
      redeemed_by: null,
    }],
    ['BETA-REVOKED', {
      id: 'BETA-REVOKED',
      code_hash: 'revokedhash00000000000000000000000000000000000000000000000000001',
      reusable: false,
      expires_at: null,
      revoked_at: '2020-01-01T00:00:00.000Z',
      redeemed_at: null,
      redeemed_by: null,
    }],
  ]);
  rpcState.redemptions = new Map();
}

async function bindInviteCode(inviteId, code) {
  const invite = rpcState.invites.get(inviteId);
  if (invite) {
    invite.code_hash = await sha256Hex(code);
  }
}

function redeemInvite(codeHash, userId) {
  const invite = [...rpcState.invites.values()].find((row) => row.code_hash === codeHash);
  if (!invite) {
    return { ok: false, error_code: 'invalid' };
  }

  const existing = rpcState.redemptions.get(userId);
  if (existing) {
    const linked = rpcState.invites.get(existing.invite_id);
    if (linked.revoked_at) {
      return { ok: false, error_code: 'revoked', invite_id: linked.id };
    }
    return {
      ok: true,
      invite_id: linked.id,
      reusable: linked.reusable,
      status: existing.status,
      granted_at: existing.granted_at,
      completed_at: existing.completed_at,
      already_assigned: true,
    };
  }

  if (invite.revoked_at) {
    return { ok: false, error_code: 'revoked' };
  }

  if (invite.expires_at && new Date(invite.expires_at) <= new Date()) {
    return { ok: false, error_code: 'expired' };
  }

  if (!invite.reusable) {
    if (invite.redeemed_at) {
      return { ok: false, error_code: 'already_redeemed', invite_id: invite.id };
    }
    invite.redeemed_at = new Date().toISOString();
    invite.redeemed_by = userId;
  }

  const grantedAt = new Date().toISOString();
  rpcState.redemptions.set(userId, {
    invite_id: invite.id,
    user_id: userId,
    status: 'in_progress',
    granted_at: grantedAt,
    completed_at: null,
  });

  return {
    ok: true,
    invite_id: invite.id,
    reusable: invite.reusable,
    status: 'in_progress',
    granted_at: grantedAt,
  };
}

function completeJourney(userId) {
  const redemption = rpcState.redemptions.get(userId);
  if (!redemption) {
    return { ok: false, error_code: 'no_access' };
  }

  const invite = rpcState.invites.get(redemption.invite_id);
  if (invite.revoked_at) {
    return { ok: false, error_code: 'revoked', invite_id: invite.id };
  }

  if (invite.reusable) {
    return {
      ok: true,
      invite_id: invite.id,
      reusable: true,
      status: redemption.status,
      skipped: true,
    };
  }

  if (redemption.status === 'completed') {
    return { ok: true, status: 'completed', already_completed: true };
  }

  redemption.status = 'completed';
  redemption.completed_at = new Date().toISOString();
  return { ok: true, status: 'completed' };
}

function getAccess(userId) {
  const redemption = rpcState.redemptions.get(userId);
  if (!redemption) {
    return { has_access: false };
  }

  const invite = rpcState.invites.get(redemption.invite_id);
  if (invite.revoked_at) {
    return { has_access: false };
  }

  return {
    has_access: true,
    invite_id: invite.id,
    reusable: invite.reusable,
    status: redemption.status,
    granted_at: redemption.granted_at,
    completed_at: redemption.completed_at,
  };
}

function installFetchMock() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);

    if (target.includes('/auth/v1/user')) {
      const token = options.headers?.Authorization?.replace(/^Bearer\s+/i, '');
      if (token === 'valid-token') {
        return new Response(JSON.stringify({ id: 'user-123' }), { status: 200 });
      }
      if (token === 'user-b') {
        return new Response(JSON.stringify({ id: 'user-b' }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'invalid' }), { status: 401 });
    }

    if (target.includes('/rest/v1/rpc/redeem_beta_invite')) {
      const body = JSON.parse(options.body);
      return new Response(JSON.stringify(redeemInvite(body.p_code_hash, body.p_user_id)), {
        status: 200,
      });
    }

    if (target.includes('/rest/v1/rpc/complete_beta_journey')) {
      const body = JSON.parse(options.body);
      return new Response(JSON.stringify(completeJourney(body.p_user_id)), { status: 200 });
    }

    if (target.includes('/rest/v1/rpc/get_beta_access')) {
      const body = JSON.parse(options.body);
      return new Response(JSON.stringify(getAccess(body.p_user_id)), { status: 200 });
    }

    if (target.includes('api.anthropic.com')) {
      return new Response(JSON.stringify({ id: 'msg_test', content: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return originalFetch(url, options);
  };

  return originalFetch;
}

function makeBetaRequest(body, headers = {}, method = 'POST') {
  const init = {
    method,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  };

  if (method !== 'GET' && body !== undefined) {
    init.body = JSON.stringify(body);
  }

  return new Request('https://example.com/api/beta-access', init);
}

function makeClaudeRequest(headers = {}) {
  return new Request('https://example.com/api/claude', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: 'Bearer valid-token',
      ...headers,
    },
    body: JSON.stringify({
      operation: 'sendConvo',
      max_tokens: 500,
      userPrompt: 'Hello',
      context: { rejectedSkillNames: [] },
    }),
  });
}

async function runTest(label, fn) {
  try {
    const ok = await fn();
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
    if (ok) passed += 1;
    else failed += 1;
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${label}: threw ${error.message}`);
  }
}

async function main() {
  const originalFetch = installFetchMock();

  await runTest('PRIVATE_BETA_ENABLED=false bypasses client gate helper', async () => {
    return shouldEnforceBetaGate('false') === false
      && shouldEnforceBetaGate(false) === false
      && shouldBlockNavigation(null, 'intake', 'false') === false
      && shouldBlockNavigation({ status: 'completed' }, 'intake', 'false') === false;
  });

  await runTest('Missing/malformed PRIVATE_BETA_ENABLED stays protected (fail closed)', async () => {
    return shouldEnforceBetaGate(undefined) === true
      && shouldEnforceBetaGate(null) === true
      && shouldEnforceBetaGate('') === true
      && shouldEnforceBetaGate('true') === true
      && shouldEnforceBetaGate('TRUE') === true
      && shouldEnforceBetaGate('yes') === true
      && shouldBlockNavigation(null, 'intake', undefined) === true;
  });

  setEnv({ PRIVATE_BETA_ENABLED: undefined });
  resetRpcState();

  await runTest('Missing env keeps server beta enforcement (fail closed)', async () => {
    return isPrivateBetaEnabled() === true;
  });

  await runTest('Malformed env keeps server beta enforcement (fail closed)', async () => {
    setEnv({ PRIVATE_BETA_ENABLED: 'TRUE' });
    return isPrivateBetaEnabled() === true;
  });

  await runTest('Client gate blocks completed tester from fresh intake when enabled', async () => {
    return shouldBlockNavigation({ status: 'completed' }, 'intake', true) === true
      && shouldBlockNavigation({ status: 'completed' }, 'dashboard', true) === false
      && shouldBlockNavigation({ reusable: true, status: 'in_progress' }, 'intake', true) === false;
  });

  setEnv({ PRIVATE_BETA_ENABLED: 'false' });
  resetRpcState();

  await runTest('Status when beta disabled returns public access', async () => {
    const response = await betaAccessHandler.fetch(makeBetaRequest({ action: 'status' }, {}, 'POST'));
    const body = await response.json();
    return response.status === 200
      && body.privateBetaEnabled === false
      && body.hasAccess === true;
  });

  await runTest('Redeem when beta disabled is a no-op pass-through', async () => {
    const response = await betaAccessHandler.fetch(makeBetaRequest({ action: 'redeem', code: 'ANY-CODE' }));
    const body = await response.json();
    return response.status === 200 && body.hasAccess === true;
  });

  await runTest('Claude API works without beta access when beta disabled', async () => {
    const response = await claudeHandler.fetch(makeClaudeRequest());
    return response.status === 200;
  });

  setEnv({ PRIVATE_BETA_ENABLED: 'true' });
  resetRpcState();
  await bindInviteCode('BETA-001', 'IFW-BETA-001');
  await bindInviteCode('OWNER', 'IFW-OWNER');
  await bindInviteCode('BETA-EXPIRED', 'IFW-EXPIRED');
  await bindInviteCode('BETA-REVOKED', 'IFW-REVOKED');

  await runTest('Status without bearer when beta enabled -> 401', async () => {
    const response = await betaAccessHandler.fetch(makeBetaRequest({ action: 'status' }));
    return response.status === 401;
  });

  await runTest('Redeem valid code -> ok true', async () => {
    const response = await betaAccessHandler.fetch(makeBetaRequest(
      { action: 'redeem', code: 'IFW-BETA-001' },
      { Authorization: 'Bearer valid-token' }
    ));
    const body = await response.json();
    return response.status === 200 && body.ok === true && body.inviteId === 'BETA-001';
  });

  await runTest('Status after redeem -> hasAccess true', async () => {
    const response = await betaAccessHandler.fetch(makeBetaRequest(
      { action: 'status' },
      { Authorization: 'Bearer valid-token' }
    ));
    const body = await response.json();
    return response.status === 200 && body.hasAccess === true && body.status === 'in_progress';
  });

  await runTest('Same user redeem again is idempotent', async () => {
    const response = await betaAccessHandler.fetch(makeBetaRequest(
      { action: 'redeem', code: 'IFW-BETA-001' },
      { Authorization: 'Bearer valid-token' }
    ));
    const body = await response.json();
    return response.status === 200 && body.ok === true && body.alreadyAssigned === true;
  });

  await runTest('Second device redeem same code -> already_redeemed', async () => {
    const response = await betaAccessHandler.fetch(makeBetaRequest(
      { action: 'redeem', code: 'IFW-BETA-001' },
      { Authorization: 'Bearer user-b' }
    ));
    const body = await response.json();
    return response.status === 409
      && body.errorCode === 'already_redeemed'
      && resolveBetaGateModeFromRedeem(body.errorCode) === 'already_used'
      && resolveBetaGateModeFromRedeem(body.errorCode) !== 'completed';
  });

  await runTest('already_redeemed maps to already_used modal copy', async () => {
    const mode = resolveBetaGateModeFromRedeem('already_redeemed');
    return mode === 'already_used'
      && BETA_GATE_COPY.already_used.title === 'This invitation has already been used.'
      && BETA_GATE_COPY.already_used.body.includes('Beta invitations can only be activated once');
  });

  await runTest('completed modal only for own completed server status', async () => {
    return resolveBetaGateModeFromAccess({ status: 'completed' }) === 'completed'
      && resolveBetaGateModeFromAccess({ status: 'in_progress' }) === 'invite'
      && resolveBetaGateModeFromAccess(null) === 'invite'
      && resolveBetaGateModeFromRedeem('already_redeemed') !== 'completed';
  });

  await runTest('Complete journey marks completed', async () => {
    const response = await betaAccessHandler.fetch(makeBetaRequest(
      { action: 'complete' },
      { Authorization: 'Bearer valid-token' }
    ));
    const body = await response.json();
    return response.status === 200 && body.ok === true && body.status === 'completed';
  });

  await runTest('Complete journey is idempotent', async () => {
    const response = await betaAccessHandler.fetch(makeBetaRequest(
      { action: 'complete' },
      { Authorization: 'Bearer valid-token' }
    ));
    const body = await response.json();
    return response.status === 200 && body.alreadyCompleted === true;
  });

  await runTest('Completed tester status hydrates from server', async () => {
    const response = await betaAccessHandler.fetch(makeBetaRequest(
      { action: 'status' },
      { Authorization: 'Bearer valid-token' }
    ));
    const body = await response.json();
    return body.hasAccess === true && body.status === 'completed';
  });

  await runTest('OWNER redeem allows multiple users', async () => {
    resetRpcState();
    await bindInviteCode('OWNER', 'IFW-OWNER');
    const first = await betaAccessHandler.fetch(makeBetaRequest(
      { action: 'redeem', code: 'IFW-OWNER' },
      { Authorization: 'Bearer valid-token' }
    ));
    const second = await betaAccessHandler.fetch(makeBetaRequest(
      { action: 'redeem', code: 'IFW-OWNER' },
      { Authorization: 'Bearer user-b' }
    ));
    const firstBody = await first.json();
    const secondBody = await second.json();
    return first.status === 200 && second.status === 200
      && firstBody.inviteId === 'OWNER' && secondBody.inviteId === 'OWNER';
  });

  await runTest('OWNER complete is skipped', async () => {
    const response = await betaAccessHandler.fetch(makeBetaRequest(
      { action: 'complete' },
      { Authorization: 'Bearer valid-token' }
    ));
    const body = await response.json();
    return response.status === 200 && body.skipped === true;
  });

  resetRpcState();
  rpcState.invites.get('BETA-001').code_hash = BETA_HASH;

  await runTest('Expired invite -> expired', async () => {
    resetRpcState();
    await bindInviteCode('BETA-EXPIRED', 'IFW-EXPIRED');
    const response = await betaAccessHandler.fetch(makeBetaRequest(
      { action: 'redeem', code: 'IFW-EXPIRED' },
      { Authorization: 'Bearer valid-token' }
    ));
    const body = await response.json();
    return response.status === 403 && body.errorCode === 'expired';
  });

  await runTest('Revoked invite -> revoked', async () => {
    resetRpcState();
    await bindInviteCode('BETA-REVOKED', 'IFW-REVOKED');
    const response = await betaAccessHandler.fetch(makeBetaRequest(
      { action: 'redeem', code: 'IFW-REVOKED' },
      { Authorization: 'Bearer valid-token' }
    ));
    const body = await response.json();
    return response.status === 403 && body.errorCode === 'revoked';
  });

  await runTest('Invalid code -> invalid', async () => {
    resetRpcState();
    await bindInviteCode('BETA-001', 'IFW-BETA-001');
    const response = await betaAccessHandler.fetch(makeBetaRequest(
      { action: 'redeem', code: 'IFW-NOPE-NOPE' },
      { Authorization: 'Bearer valid-token' }
    ));
    const body = await response.json();
    return response.status === 403 && body.errorCode === 'invalid';
  });

  await runTest('Claude API requires beta access when enabled', async () => {
    resetRpcState();
    await bindInviteCode('BETA-001', 'IFW-BETA-001');
    const response = await claudeHandler.fetch(makeClaudeRequest());
    return response.status === 403;
  });

  resetRpcState();
  await bindInviteCode('BETA-001', 'IFW-BETA-001');
  redeemInvite(await sha256Hex('IFW-BETA-001'), 'user-123');

  await runTest('Claude API allows authenticated beta user when enabled', async () => {
    const response = await claudeHandler.fetch(makeClaudeRequest());
    return response.status === 200;
  });

  await runTest('Concurrent redeem race -> exactly one success', async () => {
    resetRpcState();
    await bindInviteCode('BETA-001', 'IFW-BETA-001');
    const requests = [
      betaAccessHandler.fetch(makeBetaRequest(
        { action: 'redeem', code: 'IFW-BETA-001' },
        { Authorization: 'Bearer valid-token' }
      )),
      betaAccessHandler.fetch(makeBetaRequest(
        { action: 'redeem', code: 'IFW-BETA-001' },
        { Authorization: 'Bearer user-b' }
      )),
    ];

    const responses = await Promise.all(requests);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    const successes = bodies.filter((body) => body.ok === true);
    const alreadyRedeemed = bodies.filter((body) => body.errorCode === 'already_redeemed');
    return successes.length === 1 && alreadyRedeemed.length === 1;
  });

  await runTest('mapRedeemPayload maps RPC fields', async () => {
    const mapped = mapRedeemPayload({
      ok: true,
      invite_id: 'BETA-007',
      reusable: false,
      status: 'in_progress',
      granted_at: '2026-01-01T00:00:00.000Z',
    });
    return mapped.ok === true && mapped.inviteId === 'BETA-007';
  });

  await runTest('ensureBetaAccessForUser bypasses when beta disabled', async () => {
    setEnv({ PRIVATE_BETA_ENABLED: 'false' });
    const result = await ensureBetaAccessForUser('user-123');
    return result.ok === true && result.betaRequired === false;
  });

  resetRpcState();
  await bindInviteCode('BETA-001', 'IFW-BETA-001');
  redeemInvite(await sha256Hex('IFW-BETA-001'), 'user-123');
  rpcState.invites.get('BETA-001').revoked_at = new Date().toISOString();

  await runTest('Revoked invite blocks get_beta_access after redemption', async () => {
    setEnv({ PRIVATE_BETA_ENABLED: 'true' });
    const access = getAccess('user-123');
    const gate = await ensureBetaAccessForUser('user-123');
    return access.has_access === false && gate.ok === false;
  });

  resetRpcState();
  await bindInviteCode('BETA-001', 'IFW-BETA-001');
  redeemInvite(await sha256Hex('IFW-BETA-001'), 'user-123');
  rpcState.invites.get('BETA-001').revoked_at = new Date().toISOString();

  await runTest('Revoked invite rejects existing redemption path', async () => {
    setEnv({ PRIVATE_BETA_ENABLED: 'true' });
    const response = await betaAccessHandler.fetch(makeBetaRequest(
      { action: 'redeem', code: 'IFW-BETA-001' },
      { Authorization: 'Bearer valid-token' }
    ));
    const body = await response.json();
    return response.status === 403 && body.errorCode === 'revoked';
  });

  resetRpcState();
  await bindInviteCode('OWNER', 'IFW-OWNER');
  redeemInvite(await sha256Hex('IFW-OWNER'), 'user-123');
  rpcState.invites.get('OWNER').revoked_at = new Date().toISOString();

  await runTest('Revoked OWNER access blocked', async () => {
    setEnv({ PRIVATE_BETA_ENABLED: 'true' });
    const access = getAccess('user-123');
    const gate = await ensureBetaAccessForUser('user-123');
    const response = await claudeHandler.fetch(makeClaudeRequest());
    return access.has_access === false
      && gate.ok === false
      && response.status === 403;
  });

  await runTest('SUPABASE_SECRET_KEY preferred over SERVICE_ROLE for RPC headers', async () => {
    setEnv({
      PRIVATE_BETA_ENABLED: 'true',
      SUPABASE_SECRET_KEY: 'sb_secret_test_key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    });

    const env = getSupabaseEnv();
    const headers = buildBetaAdminHeaders(env);
    return headers.apikey === 'sb_secret_test_key'
      && !headers.Authorization;
  });

  await runTest('Secret key RPC uses apikey only (no Authorization bearer)', async () => {
    setEnv({
      PRIVATE_BETA_ENABLED: 'true',
      SUPABASE_SECRET_KEY: 'sb_secret_test_key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    });

    let capturedHeaders = null;
    const priorFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).includes('/rest/v1/rpc/get_beta_access')) {
        capturedHeaders = options.headers;
        return new Response(JSON.stringify({ has_access: false }), { status: 200 });
      }
      return priorFetch(url, options);
    };

    await getBetaAccess('user-123');
    globalThis.fetch = priorFetch;

    return capturedHeaders?.apikey === 'sb_secret_test_key'
      && !capturedHeaders?.Authorization;
  });

  await runTest('Beta RPC requests include Content-Profile: public', async () => {
    setEnv({
      PRIVATE_BETA_ENABLED: 'true',
      SUPABASE_SECRET_KEY: 'sb_secret_test_key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    });

    let capturedHeaders = null;
    const priorFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).includes('/rest/v1/rpc/get_beta_access')) {
        capturedHeaders = options.headers;
        return new Response(JSON.stringify({ has_access: false }), { status: 200 });
      }
      return priorFetch(url, options);
    };

    await getBetaAccess('user-123');
    globalThis.fetch = priorFetch;

    return capturedHeaders?.['Content-Profile'] === 'public';
  });

  await runTest('Legacy service_role RPC sends apikey and Authorization Bearer', async () => {
    setEnv({
      PRIVATE_BETA_ENABLED: 'true',
      SUPABASE_SECRET_KEY: undefined,
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    });

    let capturedHeaders = null;
    const priorFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).includes('/rest/v1/rpc/get_beta_access')) {
        capturedHeaders = options.headers;
        return new Response(JSON.stringify({ has_access: false }), { status: 200 });
      }
      return priorFetch(url, options);
    };

    await getBetaAccess('user-123');
    globalThis.fetch = priorFetch;

    return capturedHeaders?.apikey === 'service-role-test'
      && capturedHeaders?.Authorization === 'Bearer service-role-test';
  });

  await runTest('Status RPC 503 fails closed with unavailable payload', async () => {
    setEnv({ PRIVATE_BETA_ENABLED: 'true' });
    const priorFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes('/auth/v1/user')) {
        return new Response(JSON.stringify({ id: 'user-123' }), { status: 200 });
      }
      if (target.includes('/rest/v1/rpc/get_beta_access')) {
        return new Response('upstream unavailable', { status: 503 });
      }
      return priorFetch(url, options);
    };

    const response = await betaAccessHandler.fetch(makeBetaRequest(
      { action: 'status' },
      { Authorization: 'Bearer valid-token' }
    ));
    const body = await response.json();
    globalThis.fetch = priorFetch;

    return response.status === 503
      && body.privateBetaEnabled === true
      && body.hasAccess === false
      && body.errorCode === 'unavailable';
  });

  await runTest('Redeem RPC 503 returns unavailable not invalid', async () => {
    setEnv({ PRIVATE_BETA_ENABLED: 'true' });
    const priorFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes('/auth/v1/user')) {
        return new Response(JSON.stringify({ id: 'user-123' }), { status: 200 });
      }
      if (target.includes('/rest/v1/rpc/redeem_beta_invite')) {
        return new Response('upstream unavailable', { status: 503 });
      }
      return priorFetch(url, options);
    };

    const response = await betaAccessHandler.fetch(makeBetaRequest(
      { action: 'redeem', code: 'IFW-BETA-001' },
      { Authorization: 'Bearer valid-token' }
    ));
    const body = await response.json();
    globalThis.fetch = priorFetch;

    return response.status === 503
      && body.ok === false
      && body.errorCode === 'unavailable'
      && body.errorCode !== 'invalid';
  });

  await runTest('Cached beta cannot authorize when server validation failed', async () => {
    const cachedAccess = {
      inviteId: 'BETA-001',
      status: 'in_progress',
      reusable: false,
    };

    return shouldGrantBetaAccess({
      privateBetaEnabled: true,
      serverValidated: false,
      validationFailed: true,
      cachedAccess,
    }) === false
      && shouldGrantBetaAccess({
        privateBetaEnabled: true,
        serverValidated: true,
        validationFailed: false,
        serverAccess: cachedAccess,
      }) === true;
  });

  await runTest('Protected view during status failure is gated', async () => {
    return shouldGateProtectedView({
      privateBetaEnabled: true,
      gateActive: true,
      serverValidated: false,
      validationFailed: true,
      cachedAccess: { inviteId: 'BETA-001', status: 'in_progress' },
      hasProgressBar: true,
      destination: 'intake',
    }) === true
      && shouldGateProtectedView({
        privateBetaEnabled: true,
        gateActive: true,
        serverValidated: false,
        validationFailed: true,
        cachedAccess: { inviteId: 'BETA-001', status: 'in_progress' },
        hasProgressBar: false,
        destination: 'landing',
      }) === false;
  });

  await runTest('Public landing accessible during status failure', async () => {
    return shouldBlockNavigation(
      { inviteId: 'BETA-001', status: 'in_progress' },
      'landing',
      true
    ) === false
      && shouldGateProtectedView({
        privateBetaEnabled: true,
        gateActive: true,
        serverValidated: false,
        validationFailed: true,
        destination: 'landing',
      }) === false;
  });

  await runTest('503/unavailable redeem copy avoids invalid-code message', async () => {
    const message = resolveRedeemErrorMessage('unavailable', 503);
    return message === 'We could not verify your invitation right now. Please try again.'
      && message !== 'That code is not valid. Please check the invitation and try again.';
  });

  await runTest('invokeBetaRpc throws when no admin credentials configured', async () => {
    setEnv({
      PRIVATE_BETA_ENABLED: 'true',
      SUPABASE_SECRET_KEY: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
    });

    try {
      await invokeBetaRpc('get_beta_access', { p_user_id: 'user-123' });
      return false;
    } catch (error) {
      return error.message.includes('admin credentials');
    }
  });

  globalThis.fetch = originalFetch;
  restoreEnv();

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
