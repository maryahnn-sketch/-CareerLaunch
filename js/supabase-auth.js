/**
 * Silent anonymous Supabase identity bootstrap for iFindWorth.
 * Failures are swallowed; the app continues in memory-only mode.
 *
 * Also owns the private-beta access gate so the public landing page can stay
 * visible while the career-discovery journey remains invite-only.
 *
 * Beta protection is fail-closed on the client: gate stays active unless the
 * server explicitly reports privateBetaEnabled === false. Anonymous access is
 * bound to the Supabase session in this browser (no cross-browser recovery).
 */

const SUPABASE_JS_VERSION = '2.49.8';
const BETA_ACCESS_STORAGE_KEY = 'ifindworth.beta.access.v1';
const BETA_MODAL_ID = 'ifw-beta-access-modal';

const authState = {
  userId: null,
  isAuthenticated: false,
  client: null
};

const betaState = {
  privateBetaEnabled: true,
  gateActive: false,
  serverValidated: false,
  validationFailed: false,
  unavailable: false,
  serverAccess: null,
};

function readBetaAccess() {
  try {
    const raw = localStorage.getItem(BETA_ACCESS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.inviteId || !['in_progress', 'completed'].includes(parsed.status)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeBetaAccess(access) {
  try {
    localStorage.setItem(BETA_ACCESS_STORAGE_KEY, JSON.stringify(access));
  } catch {
    // Storage may be unavailable in strict/privacy browser modes.
  }
}

function clearBetaAccessCache() {
  try {
    localStorage.removeItem(BETA_ACCESS_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function cacheAccessFromServer(payload) {
  if (!payload?.hasAccess) {
    clearBetaAccessCache();
    return null;
  }

  const access = {
    inviteId: payload.inviteId,
    status: payload.status,
    reusable: payload.reusable === true,
    grantedAt: payload.grantedAt || null,
    completedAt: payload.completedAt || null
  };

  writeBetaAccess(access);
  return access;
}

async function betaApiRequest(body) {
  const headers = { 'content-type': 'application/json' };
  const token = await window.CareerLaunchAuth.getAccessToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch('/api/beta-access', {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  const result = await response.json().catch(() => ({}));
  return { response, result };
}

function getEffectiveBetaAccess() {
  if (!betaState.privateBetaEnabled) {
    return { reusable: true, status: 'in_progress' };
  }

  if (betaState.validationFailed || !betaState.serverValidated) {
    return null;
  }

  return betaState.serverAccess;
}

function markServerValidationFailure({ unavailable = false } = {}) {
  betaState.serverValidated = false;
  betaState.validationFailed = true;
  betaState.unavailable = unavailable;
  betaState.serverAccess = null;
  clearBetaAccessCache();
}

function markServerValidationSuccess(access = null) {
  betaState.serverValidated = true;
  betaState.validationFailed = false;
  betaState.unavailable = false;
  betaState.serverAccess = access;
}

function currentViewLooksProtected() {
  return Boolean(document.querySelector('#app .progress-bar'));
}

async function hydrateBetaAccessFromServer() {
  try {
    const { response, result } = await betaApiRequest({ action: 'status' });

    if (!response.ok) {
      markServerValidationFailure({
        unavailable: response.status === 503 && result?.errorCode === 'unavailable',
      });
      betaState.privateBetaEnabled = result?.privateBetaEnabled !== false;
      return { blocked: true, unavailable: betaState.unavailable };
    }

    if (!result || typeof result !== 'object' || !('privateBetaEnabled' in result)) {
      markServerValidationFailure();
      betaState.privateBetaEnabled = true;
      return { blocked: true };
    }

    betaState.privateBetaEnabled = result.privateBetaEnabled !== false;

    if (!betaState.privateBetaEnabled) {
      markServerValidationSuccess(null);
      return { skipGate: true };
    }

    if (result.hasAccess === true) {
      const access = cacheAccessFromServer(result);
      markServerValidationSuccess(access);
      return { access };
    }

    markServerValidationSuccess(null);
    return { blocked: true };
  } catch {
    markServerValidationFailure();
    betaState.privateBetaEnabled = true;
    return { blocked: true };
  }
}

function settleUnauthenticated() {
  authState.userId = null;
  authState.isAuthenticated = false;
}

function settleAuthenticated(userId, client) {
  authState.userId = userId;
  authState.isAuthenticated = true;
  authState.client = client;
}

function redeemErrorMessage(result, response) {
  if (result?.errorCode === 'unavailable' || response?.status === 503) {
    return 'We could not verify your invitation right now. Please try again.';
  }

  return 'That code is not valid. Please check the invitation and try again.';
}

async function bootstrapAuth() {
  try {
    const configResponse = await fetch('/api/public-config');

    if (!configResponse.ok) {
      settleUnauthenticated();
      return;
    }

    const config = await configResponse.json();
    const { supabaseUrl, supabaseAnonKey } = config;

    if (
      typeof supabaseUrl !== 'string' ||
      !supabaseUrl ||
      typeof supabaseAnonKey !== 'string' ||
      !supabaseAnonKey
    ) {
      settleUnauthenticated();
      return;
    }

    const { createClient } = await import(
      `https://esm.sh/@supabase/supabase-js@${SUPABASE_JS_VERSION}`
    );

    const client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });

    const { data: sessionData, error: sessionError } = await client.auth.getSession();

    if (sessionError) {
      settleUnauthenticated();
      return;
    }

    if (sessionData?.session?.user?.id) {
      settleAuthenticated(sessionData.session.user.id, client);
      return;
    }

    const { data: signInData, error: signInError } =
      await client.auth.signInAnonymously();

    if (signInError || !signInData?.session?.user?.id) {
      settleUnauthenticated();
      return;
    }

    settleAuthenticated(signInData.session.user.id, client);
  } catch {
    settleUnauthenticated();
  }
}

function injectBetaGateStyles() {
  if (document.getElementById('ifw-beta-gate-styles')) return;

  const style = document.createElement('style');
  style.id = 'ifw-beta-gate-styles';
  style.textContent = `
    .ifw-beta-backdrop{
      position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;
      padding:24px;background:rgba(32,41,44,.58);backdrop-filter:blur(6px);
    }
    .ifw-beta-card{
      width:min(100%,480px);background:#fff;border:1px solid #E2DED5;border-radius:20px;
      padding:28px;box-shadow:0 24px 70px rgba(32,41,44,.24);font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif;
    }
    .ifw-beta-logo{display:block;width:170px;max-width:60%;height:auto;margin:0 0 24px;}
    .ifw-beta-kicker{font-size:12px;letter-spacing:.1em;text-transform:uppercase;font-weight:700;color:#4F46E5;margin-bottom:8px;}
    .ifw-beta-card h2{font-family:'Playfair Display',Georgia,serif;font-size:30px;line-height:1.1;margin:0 0 10px;color:#20292C;}
    .ifw-beta-card p{font-size:15px;line-height:1.55;color:#5B6669;margin:0 0 20px;}
    .ifw-beta-label{display:block;font-size:13px;font-weight:700;color:#20292C;margin-bottom:8px;}
    .ifw-beta-input{
      width:100%;height:50px;border:1.5px solid #D8D4CB;border-radius:12px;padding:0 14px;
      font:600 15px/1 Inter,-apple-system,BlinkMacSystemFont,sans-serif;text-transform:uppercase;
      letter-spacing:.04em;color:#20292C;background:#fff;outline:none;
    }
    .ifw-beta-input:focus{border-color:#4F46E5;box-shadow:0 0 0 3px rgba(79,70,229,.11);}
    .ifw-beta-actions{display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;}
    .ifw-beta-button{
      min-height:46px;border:0;border-radius:999px;padding:0 20px;font-weight:700;font-size:14px;cursor:pointer;
      font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif;
    }
    .ifw-beta-primary{background:#4F46E5;color:#fff;flex:1;}
    .ifw-beta-secondary{background:#F0EEE8;color:#20292C;}
    .ifw-beta-error{min-height:20px;margin-top:10px;font-size:13px;color:#B42318;}
    .ifw-beta-note{font-size:12px!important;color:#747D80!important;margin:14px 0 0!important;}
    .ifw-beta-spinner{opacity:.65;pointer-events:none;}
    @media (max-width:520px){.ifw-beta-card{padding:24px 20px}.ifw-beta-card h2{font-size:27px}.ifw-beta-logo{width:150px}}
  `;
  document.head.appendChild(style);
}

function closeBetaGate() {
  document.getElementById(BETA_MODAL_ID)?.remove();
}

function betaGateCopy(mode) {
  if (mode === 'completed') {
    return {
      title: 'You already completed this beta.',
      body: 'Thank you for testing iFindWorth. This invitation has already been used for a completed journey. Your existing results remain available on this browser.',
    };
  }

  if (mode === 'already_used') {
    return {
      title: 'This invitation has already been used.',
      body: 'Beta invitations can only be activated once. If you already started testing iFindWorth, please continue on the browser where you began. If you believe this is an error, contact us.',
    };
  }

  return {
    title: 'Your invitation opens the experience.',
    body: 'The iFindWorth website is public, but the career-discovery experience is currently invite-only. Enter the code that came with your invitation to continue.',
  };
}

function showBetaGate(mode = 'invite', initialError = '') {
  injectBetaGateStyles();
  closeBetaGate();

  const isTerminal = mode === 'completed' || mode === 'already_used';
  const copy = betaGateCopy(mode);
  const backdrop = document.createElement('div');
  backdrop.id = BETA_MODAL_ID;
  backdrop.className = 'ifw-beta-backdrop';

  backdrop.innerHTML = `
    <div class="ifw-beta-card" role="dialog" aria-modal="true" aria-labelledby="ifwBetaTitle">
      <img class="ifw-beta-logo" src="/logo/iFindWorth_Logo_Primary_NoTagline_Transparent.png" alt="iFindWorth">
      <div class="ifw-beta-kicker">Private Beta</div>
      <h2 id="ifwBetaTitle">${copy.title}</h2>
      <p>${copy.body}</p>

      ${isTerminal ? `
        <div class="ifw-beta-actions">
          <button type="button" class="ifw-beta-button ifw-beta-secondary" id="ifwBetaClose">Close</button>
        </div>
      ` : `
        <form id="ifwBetaForm">
          <label class="ifw-beta-label" for="ifwBetaCode">Beta access code</label>
          <input class="ifw-beta-input" id="ifwBetaCode" name="code" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" placeholder="IFW-XXXXXXXX" required>
          <div class="ifw-beta-error" id="ifwBetaError" aria-live="polite">${initialError}</div>
          <div class="ifw-beta-actions">
            <button type="submit" class="ifw-beta-button ifw-beta-primary" id="ifwBetaSubmit">Continue to iFindWorth</button>
            <button type="button" class="ifw-beta-button ifw-beta-secondary" id="ifwBetaCancel">Not now</button>
          </div>
          <p class="ifw-beta-note">Please keep your invitation code private while the product is in beta.</p>
        </form>
      `}
    </div>
  `;

  document.body.appendChild(backdrop);

  if (isTerminal) {
    document.getElementById('ifwBetaClose')?.addEventListener('click', closeBetaGate);
    return;
  }

  const form = document.getElementById('ifwBetaForm');
  const input = document.getElementById('ifwBetaCode');
  const error = document.getElementById('ifwBetaError');
  const submit = document.getElementById('ifwBetaSubmit');

  document.getElementById('ifwBetaCancel')?.addEventListener('click', closeBetaGate);

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = String(input?.value || '').trim();
    if (!code) return;

    error.textContent = '';
    submit.disabled = true;
    submit.classList.add('ifw-beta-spinner');
    submit.textContent = 'Checking…';

    try {
      await window.CareerLaunchAuth.ready;
      const { response, result } = await betaApiRequest({ action: 'redeem', code });

      if (result?.errorCode === 'already_redeemed') {
        showBetaGate('already_used');
        return;
      }

      if (result?.errorCode === 'unavailable' || response.status === 503) {
        error.textContent = redeemErrorMessage(result, response);
        return;
      }

      if (!response.ok || result?.ok !== true) {
        error.textContent = redeemErrorMessage(result, response);
        return;
      }

      const access = cacheAccessFromServer({
        hasAccess: true,
        inviteId: result.inviteId,
        status: result.status || 'in_progress',
        reusable: result.reusable,
        grantedAt: result.grantedAt,
        completedAt: null
      });
      markServerValidationSuccess(access);
      closeBetaGate();
    } catch {
      error.textContent = 'We could not verify your invitation right now. Please try again.';
    } finally {
      submit.disabled = false;
      submit.classList.remove('ifw-beta-spinner');
      submit.textContent = 'Continue to iFindWorth';
    }
  });

  requestAnimationFrame(() => input?.focus());
}

function currentProtectedDestination() {
  const label = document.querySelector('#app .progress-label');
  if (!label) return null;

  const text = label.textContent?.trim();
  const labelToScreen = {
    'Your story': 'intake',
    'Analyzing': 'analyzing',
    'Skills': 'skills',
    'Career paths': 'paths',
    'Discuss results': 'conversation',
    'Choose direction': 'choose',
    'Unlock roadmap': 'paywall',
    'Your roadmap': 'roadmap',
    'Positioning': 'kit',
    'Dashboard': 'dashboard',
  };

  return labelToScreen[text] || 'protected';
}

function shouldBlockCurrentProtectedView() {
  if (!betaState.privateBetaEnabled || !betaState.gateActive) {
    return false;
  }

  if (!currentViewLooksProtected()) {
    return false;
  }

  const access = getEffectiveBetaAccess();

  if (access?.reusable === true) {
    return false;
  }

  if (access?.status === 'in_progress') {
    return false;
  }

  if (access?.status === 'completed') {
    return currentProtectedDestination() !== 'dashboard';
  }

  return true;
}

function enforceProtectedViewGate() {
  if (!shouldBlockCurrentProtectedView()) {
    return;
  }

  const access = getEffectiveBetaAccess();
  showBetaGate(access?.status === 'completed' ? 'completed' : 'invite');
}

function startProtectedViewObserver() {
  const app = document.getElementById('app');
  if (!app || app.dataset.ifwBetaObserver === '1') {
    return;
  }

  app.dataset.ifwBetaObserver = '1';
  const observer = new MutationObserver(() => {
    enforceProtectedViewGate();
  });
  observer.observe(app, { childList: true, subtree: true });
}

async function markBetaCompleted() {
  if (!betaState.privateBetaEnabled) return;

  const access = getEffectiveBetaAccess();
  if (!access || access.reusable === true || access.status === 'completed') return;

  const completed = {
    ...access,
    status: 'completed',
    completedAt: new Date().toISOString()
  };
  writeBetaAccess(completed);

  try {
    await window.CareerLaunchAuth.ready;
    const { result } = await betaApiRequest({ action: 'complete' });
    if (result?.ok) {
      const completedAccess = cacheAccessFromServer({
        hasAccess: true,
        inviteId: access.inviteId,
        status: 'completed',
        reusable: access.reusable === true,
        grantedAt: access.grantedAt,
        completedAt: completed.completedAt
      });
      markServerValidationSuccess(completedAccess);
    }
  } catch {
    // Local cache still reflects completion for this browser.
  }
}

async function validateInviteFromUrl() {
  if (!betaState.privateBetaEnabled) return false;

  const url = new URL(window.location.href);
  const code = url.searchParams.get('invite');
  if (!code || getEffectiveBetaAccess()) return false;

  try {
    await window.CareerLaunchAuth.ready;
    const { response, result } = await betaApiRequest({ action: 'redeem', code });

    url.searchParams.delete('invite');
    history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);

    if (result?.errorCode === 'already_redeemed') {
      showBetaGate('already_used');
      return true;
    }

    if (result?.errorCode === 'unavailable' || response.status === 503) {
      showBetaGate('invite', redeemErrorMessage(result, response));
      return true;
    }

    if (!response.ok || result?.ok !== true) {
      showBetaGate('invite', redeemErrorMessage(result, response));
      return true;
    }

    const access = cacheAccessFromServer({
      hasAccess: true,
      inviteId: result.inviteId,
      status: result.status || 'in_progress',
      reusable: result.reusable,
      grantedAt: result.grantedAt,
      completedAt: null
    });
    markServerValidationSuccess(access);

    return true;
  } catch {
    showBetaGate('invite', 'We could not verify your invitation right now. Please try again.');
    return true;
  }
}

function handleBetaNavigation(event) {
  if (!betaState.privateBetaEnabled || !betaState.gateActive) return;

  const target = event.target;
  if (!(target instanceof Element)) return;

  const dashboardButton = target.closest('#toDashboard');
  if (dashboardButton) {
    setTimeout(() => {
      markBetaCompleted();
    }, 0);
    return;
  }

  const goElement = target.closest('[data-go]');
  if (!goElement) return;

  const destination = goElement.getAttribute('data-go');
  if (!destination || destination === 'landing') return;

  const access = getEffectiveBetaAccess();

  if (access?.reusable === true) return;

  if (access?.status === 'in_progress') return;

  if (access?.status === 'completed' && destination === 'dashboard') return;

  event.preventDefault();
  event.stopImmediatePropagation();

  showBetaGate(access?.status === 'completed' ? 'completed' : 'invite');
}

function initializeBetaGate() {
  window.CareerLaunchAuth.ready
    .then(hydrateBetaAccessFromServer)
    .then((statusResult) => {
      if (statusResult?.skipGate || betaState.privateBetaEnabled === false) {
        betaState.gateActive = false;
        return;
      }

      betaState.gateActive = true;
      injectBetaGateStyles();
      document.addEventListener('click', handleBetaNavigation, true);
      startProtectedViewObserver();

      return validateInviteFromUrl().finally(() => {
        enforceProtectedViewGate();
      });
    })
    .catch(() => {
      markServerValidationFailure();
      betaState.gateActive = betaState.privateBetaEnabled;
      if (betaState.gateActive) {
        injectBetaGateStyles();
        document.addEventListener('click', handleBetaNavigation, true);
        startProtectedViewObserver();
        enforceProtectedViewGate();
      }
    });
}

window.CareerLaunchAuth = {
  ready: bootstrapAuth().catch(() => {
    settleUnauthenticated();
  }),

  get userId() {
    return authState.userId;
  },

  get isAuthenticated() {
    return authState.isAuthenticated;
  },

  getClient() {
    return authState.client;
  },

  async getAccessToken() {
    await this.ready;

    const client = authState.client;
    if (!client) return null;

    try {
      const { data, error } = await client.auth.getSession();
      if (error || !data?.session?.access_token) return null;
      return data.session.access_token;
    } catch {
      return null;
    }
  }
};

initializeBetaGate();
