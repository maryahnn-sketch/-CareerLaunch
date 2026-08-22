/**
 * Silent anonymous Supabase identity bootstrap for iFindWorth.
 * Failures are swallowed; the app continues in memory-only mode.
 *
 * Also owns the private-beta access gate so the public landing page can stay
 * visible while the career-discovery journey remains invite-only.
 */

const SUPABASE_JS_VERSION = '2.49.8';
const BETA_ACCESS_STORAGE_KEY = 'ifindworth.beta.access.v1';
const BETA_MODAL_ID = 'ifw-beta-access-modal';

const authState = {
  userId: null,
  isAuthenticated: false,
  client: null
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

function hydrateBetaAccessFromUser(user) {
  const metadata = user?.user_metadata;
  if (!metadata || readBetaAccess()) return;

  const inviteId = metadata.ifw_beta_invite_id;
  const status = metadata.ifw_beta_status;
  if (!inviteId || !['in_progress', 'completed'].includes(status)) return;

  writeBetaAccess({
    inviteId,
    status,
    reusable: metadata.ifw_beta_reusable === true,
    grantedAt: metadata.ifw_beta_granted_at || null,
    completedAt: metadata.ifw_beta_completed_at || null
  });
}

async function syncBetaAccessToUser(access) {
  const client = authState.client;
  if (!client || !access) return;

  try {
    await client.auth.updateUser({
      data: {
        ifw_beta_invite_id: access.inviteId,
        ifw_beta_status: access.status,
        ifw_beta_reusable: access.reusable === true,
        ifw_beta_granted_at: access.grantedAt || null,
        ifw_beta_completed_at: access.completedAt || null
      }
    });
  } catch {
    // Local access still works if metadata sync fails.
  }
}

function settleUnauthenticated() {
  authState.userId = null;
  authState.isAuthenticated = false;
}

function settleAuthenticated(userId, client, user) {
  authState.userId = userId;
  authState.isAuthenticated = true;
  authState.client = client;
  hydrateBetaAccessFromUser(user);
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
      settleAuthenticated(
        sessionData.session.user.id,
        client,
        sessionData.session.user
      );
      return;
    }

    const { data: signInData, error: signInError } =
      await client.auth.signInAnonymously();

    if (signInError || !signInData?.session?.user?.id) {
      settleUnauthenticated();
      return;
    }

    settleAuthenticated(
      signInData.session.user.id,
      client,
      signInData.session.user
    );
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

function showBetaGate(mode = 'invite', initialError = '') {
  injectBetaGateStyles();
  closeBetaGate();

  const isCompleted = mode === 'completed';
  const backdrop = document.createElement('div');
  backdrop.id = BETA_MODAL_ID;
  backdrop.className = 'ifw-beta-backdrop';

  backdrop.innerHTML = `
    <div class="ifw-beta-card" role="dialog" aria-modal="true" aria-labelledby="ifwBetaTitle">
      <img class="ifw-beta-logo" src="/logo/iFindWorth_Logo_Primary_NoTagline_Transparent.png" alt="iFindWorth">
      <div class="ifw-beta-kicker">Private Beta</div>
      <h2 id="ifwBetaTitle">${isCompleted ? 'You already completed this beta.' : 'Your invitation opens the experience.'}</h2>
      <p>${isCompleted
        ? 'Thank you for testing iFindWorth. This invitation has already been used for a completed journey. Your existing results remain available on this browser.'
        : 'The iFindWorth website is public, but the career-discovery experience is currently invite-only. Enter the code that came with your invitation to continue.'}</p>

      ${isCompleted ? `
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

  if (isCompleted) {
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
      const response = await fetch('/api/beta-access', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code })
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.valid !== true) {
        error.textContent = 'That code is not valid. Please check the invitation and try again.';
        return;
      }

      const access = {
        inviteId: result.inviteId,
        status: 'in_progress',
        reusable: result.reusable === true,
        grantedAt: new Date().toISOString(),
        completedAt: null
      };

      writeBetaAccess(access);
      closeBetaGate();

      window.CareerLaunchAuth?.ready
        ?.then(() => syncBetaAccessToUser(access))
        .catch(() => {});
    } catch {
      error.textContent = 'We could not verify the code right now. Please try again.';
    } finally {
      submit.disabled = false;
      submit.classList.remove('ifw-beta-spinner');
      submit.textContent = 'Continue to iFindWorth';
    }
  });

  requestAnimationFrame(() => input?.focus());
}

function currentViewLooksProtected() {
  return Boolean(document.querySelector('#app .progress-bar'));
}

function markBetaCompleted() {
  const access = readBetaAccess();
  if (!access || access.reusable === true || access.status === 'completed') return;

  const completed = {
    ...access,
    status: 'completed',
    completedAt: new Date().toISOString()
  };
  writeBetaAccess(completed);

  window.CareerLaunchAuth?.ready
    ?.then(() => syncBetaAccessToUser(completed))
    .catch(() => {});
}

async function validateInviteFromUrl() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('invite');
  if (!code || readBetaAccess()) return false;

  try {
    const response = await fetch('/api/beta-access', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok || result?.valid !== true) {
      url.searchParams.delete('invite');
      history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      showBetaGate('invite', 'This invitation link is not valid. Please enter your access code.');
      return true;
    }

    const access = {
      inviteId: result.inviteId,
      status: 'in_progress',
      reusable: result.reusable === true,
      grantedAt: new Date().toISOString(),
      completedAt: null
    };
    writeBetaAccess(access);

    url.searchParams.delete('invite');
    history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);

    window.CareerLaunchAuth?.ready
      ?.then(() => syncBetaAccessToUser(access))
      .catch(() => {});

    return true;
  } catch {
    showBetaGate('invite', 'We could not verify this invitation link. Please enter the code manually.');
    return true;
  }
}

function handleBetaNavigation(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const dashboardButton = target.closest('#toDashboard');
  if (dashboardButton) {
    setTimeout(markBetaCompleted, 0);
    return;
  }

  const goElement = target.closest('[data-go]');
  if (!goElement) return;

  const destination = goElement.getAttribute('data-go');
  if (!destination || destination === 'landing') return;

  const access = readBetaAccess();

  if (access?.reusable === true) return;

  if (access?.status === 'in_progress') return;

  // A completed tester can still open their existing dashboard/results, but
  // cannot start a fresh beta journey with the same access.
  if (access?.status === 'completed' && destination === 'dashboard') return;

  event.preventDefault();
  event.stopImmediatePropagation();

  showBetaGate(access?.status === 'completed' ? 'completed' : 'invite');
}

function initializeBetaGate() {
  injectBetaGateStyles();
  document.addEventListener('click', handleBetaNavigation, true);

  Promise.resolve()
    .then(validateInviteFromUrl)
    .finally(() => {
      window.CareerLaunchAuth.ready.finally(() => {
        const access = readBetaAccess();
        if (currentViewLooksProtected() && !access) {
          showBetaGate('invite');
        }
      });
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