/**
 * Security regression checks for /api/claude.
 * Run: node scripts/test-claude-api-security.mjs
 */

import handler from '../api/claude.mjs';

const ORIGINAL_ENV = { ...process.env };

function setEnv(overrides = {}) {
  process.env.SUPABASE_URL = overrides.SUPABASE_URL ?? 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = overrides.SUPABASE_ANON_KEY ?? 'anon-key-test';
  process.env.ANTHROPIC_API_KEY = overrides.ANTHROPIC_API_KEY ?? 'anthropic-key-test';
}

function restoreEnv() {
  process.env = { ...ORIGINAL_ENV };
}

function makeRequest(method, body, headers = {}) {
  const init = {
    method,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  };

  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  return new Request('https://example.com/api/claude', init);
}

async function expectStatus(label, request, expectedStatus) {
  const response = await handler.fetch(request);
  const ok = response.status === expectedStatus;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: expected ${expectedStatus}, got ${response.status}`);
  if (!ok) {
    const text = await response.text();
    console.log('  body:', text.slice(0, 200));
  }
  return ok;
}

const validStructuredBody = {
  operation: 'analyzeSkills',
  max_tokens: 1000,
  system: 'You are a test system prompt.',
  messages: [{ role: 'user', content: 'User story content.' }],
  tools: [{
    name: 'report_skills',
    description: 'test tool',
    input_schema: { type: 'object', properties: { skills: { type: 'array' } }, required: ['skills'] },
  }],
  tool_choice: { type: 'tool', name: 'report_skills' },
};

let passed = 0;
let failed = 0;

async function runTest(label, fn) {
  try {
    const ok = await fn();
    if (ok) passed += 1;
    else failed += 1;
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${label}: threw ${error.message}`);
  }
}

async function main() {
  setEnv();

  // Stub Supabase auth verification for non-auth tests.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('/auth/v1/user')) {
      const token = options.headers?.Authorization?.replace(/^Bearer\s+/i, '');
      if (token === 'valid-token') {
        return new Response(JSON.stringify({ id: 'user-123' }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'invalid' }), { status: 401 });
    }

    if (String(url).includes('api.anthropic.com')) {
      return new Response(JSON.stringify({ id: 'msg_test', type: 'message', role: 'assistant', content: [], stop_reason: 'end_turn' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return originalFetch(url, options);
  };

  await runTest('POST without Authorization -> 401', async () =>
    expectStatus('no auth', makeRequest('POST', validStructuredBody), 401));

  await runTest('POST with invalid bearer -> 401', async () =>
    expectStatus('invalid auth', makeRequest('POST', validStructuredBody, { Authorization: 'Bearer bad-token' }), 401));

  await runTest('GET -> 405', async () =>
    expectStatus('GET', makeRequest('GET'), 405));

  await runTest('Invalid JSON -> 400', async () =>
    expectStatus('invalid json', makeRequest('POST', '{not-json', { Authorization: 'Bearer valid-token' }), 400));

  await runTest('Missing operation -> 400', async () => {
    const body = { ...validStructuredBody };
    delete body.operation;
    return expectStatus('missing operation', makeRequest('POST', body, { Authorization: 'Bearer valid-token' }), 400);
  });

  await runTest('Unknown operation -> 400', async () =>
    expectStatus('unknown operation', makeRequest('POST', { ...validStructuredBody, operation: 'hackEverything' }, { Authorization: 'Bearer valid-token' }), 400));

  await runTest('Arbitrary suffix -> 400', async () =>
    expectStatus('bad suffix', makeRequest('POST', { ...validStructuredBody, operation: 'analyzeSkills:evil' }, { Authorization: 'Bearer valid-token' }), 400));

  await runTest('Token cap exceeded -> 400', async () =>
    expectStatus('token cap', makeRequest('POST', { ...validStructuredBody, max_tokens: 5000 }, { Authorization: 'Bearer valid-token' }), 400));

  await runTest('Repair token cap respected -> 200', async () =>
    expectStatus('repair cap ok', makeRequest('POST', { ...validStructuredBody, operation: 'analyzeSkills:repair', max_tokens: 1600 }, { Authorization: 'Bearer valid-token' }), 200));

  await runTest('Repair token cap exceeded -> 400', async () =>
    expectStatus('repair cap fail', makeRequest('POST', { ...validStructuredBody, operation: 'analyzeSkills:repair', max_tokens: 1601 }, { Authorization: 'Bearer valid-token' }), 400));

  await runTest('Reshape token cap respected -> 200', async () =>
    expectStatus('reshape cap ok', makeRequest('POST', { ...validStructuredBody, operation: 'discoverPaths:reshape', max_tokens: 1200 }, { Authorization: 'Bearer valid-token' }), 200));

  await runTest('Plain-text sendConvo without tools -> 200', async () =>
    expectStatus('sendConvo', makeRequest('POST', {
      operation: 'sendConvo',
      max_tokens: 500,
      system: 'Reply naturally.',
      messages: [{ role: 'user', content: 'Hello' }],
    }, { Authorization: 'Bearer valid-token' }), 200));

  await runTest('Plain-text sendConvo rejects tools -> 400', async () =>
    expectStatus('sendConvo tools rejected', makeRequest('POST', {
      ...validStructuredBody,
      operation: 'sendConvo',
      max_tokens: 500,
    }, { Authorization: 'Bearer valid-token' }), 400));

  await runTest('Oversized body -> 413', async () => {
    const huge = 'x'.repeat(MAX_BODY_BYTES + 1);
    return expectStatus('oversized body', makeRequest('POST', {
      operation: 'sendConvo',
      max_tokens: 500,
      system: 'Reply naturally.',
      messages: [{ role: 'user', content: huge }],
    }, { Authorization: 'Bearer valid-token' }), 413);
  });

  await runTest('Valid authenticated structured request -> 200', async () =>
    expectStatus('valid auth structured', makeRequest('POST', validStructuredBody, { Authorization: 'Bearer valid-token' }), 200));

  globalThis.fetch = originalFetch;
  restoreEnv();

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

const MAX_BODY_BYTES = 512 * 1024;

main();
