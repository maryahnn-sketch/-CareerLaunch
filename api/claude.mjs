/**
 * iFindWorth /api/claude proxy — authenticated, validated Anthropic gateway.
 *
 * TODO: Add durable edge/platform rate limiting (Vercel Firewall, KV/Redis, etc.)
 * before broader public launch. In-memory counters inside this serverless
 * function are not reliable for rate limiting.
 */

import { MAX_BODY_BYTES, prepareAnthropicRequest } from './claude-operations.mjs';

function jsonResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

function extractBearerToken(request) {
  const header = request.headers.get('authorization') || request.headers.get('Authorization');
  if (!header) return null;

  const match = header.match(/^Bearer\s+(\S+)\s*$/i);
  return match ? match[1] : null;
}

async function verifySupabaseAccessToken(accessToken, supabaseUrl, supabaseAnonKey) {
  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey,
    },
  });

  if (!response.ok) return false;

  const user = await response.json();
  return !!user?.id;
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    const contentType = request.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return jsonResponse({ error: 'Content-Type must be application/json' }, 400);
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return jsonResponse({ error: 'Authentication service is not configured' }, 503);
    }

    if (!apiKey) {
      return jsonResponse({ error: 'AI service is not configured' }, 500);
    }

    const accessToken = extractBearerToken(request);
    if (!accessToken) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    let isAuthenticated = false;
    try {
      isAuthenticated = await verifySupabaseAccessToken(
        accessToken,
        supabaseUrl,
        supabaseAnonKey
      );
    } catch (error) {
      console.error('[CareerLaunch API] Supabase token verification failed', error);
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    if (!isAuthenticated) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    let rawBody;
    try {
      rawBody = await request.text();
    } catch (error) {
      console.error('[CareerLaunch API] Failed to read request body', error);
      return jsonResponse({ error: 'Invalid request body' }, 400);
    }

    const bodyBytes = new TextEncoder().encode(rawBody).length;
    if (bodyBytes > MAX_BODY_BYTES) {
      return jsonResponse({ error: 'Request body too large' }, 413);
    }

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return jsonResponse({ error: 'Invalid JSON' }, 400);
    }

    const validation = prepareAnthropicRequest(body);
    if (!validation.ok) {
      return jsonResponse({ error: validation.error }, validation.status || 400);
    }

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(validation.anthropicPayload),
      });

      const result = await response.text();

      return new Response(result, {
        status: response.status,
        headers: {
          'content-type': response.headers.get('content-type') || 'application/json',
          'cache-control': 'no-store',
        },
      });
    } catch (error) {
      console.error('[CareerLaunch API] Claude request failed', error);
      return jsonResponse({ error: 'Unable to reach AI service' }, 502);
    }
  },
};
