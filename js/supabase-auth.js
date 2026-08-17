/**
 * Silent anonymous Supabase identity bootstrap for CareerLaunch.
 * Failures are swallowed; the app continues in memory-only mode.
 */

const SUPABASE_JS_VERSION = '2.49.8';

const authState = {
  userId: null,
  isAuthenticated: false,
  client: null
};

function settleUnauthenticated() {
  authState.userId = null;
  authState.isAuthenticated = false;
}

function settleAuthenticated(userId, client) {
  authState.userId = userId;
  authState.isAuthenticated = true;
  authState.client = client;
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
  }
};
