/**
 * iFindWorth /api/claude proxy — authenticated, validated Anthropic gateway.
 *
 * TODO: Add durable edge/platform rate limiting (Vercel Firewall, KV/Redis, etc.)
 * before broader public launch. In-memory counters inside this serverless
 * function are not reliable for rate limiting.
 */

const MODEL = 'claude-sonnet-4-6';
const REPAIR_BUDGET_CAP = 4000;
const RESHAPE_CAP = 1200;

const MAX_BODY_BYTES = 512 * 1024;
const MAX_SYSTEM_CHARS = 50_000;
const MAX_USER_CONTENT_CHARS = 100_000;
const MAX_TOOLS_JSON_BYTES = 64 * 1024;

/** Base output-token budgets mirrored from TOKEN_BUDGETS in index.html */
const BASE_OPERATION_LIMITS = {
  analyzeSkills: 1000,
  discoverPaths: 2000,
  sendConvo: 500,
  sendConvoProfileDelta: 400,
  refinePaths: 2000,
  rerankPaths: 700,
  buildRoadmapFoundation: 700,
  buildRoadmapActionPlan: 900,
  buildRoadmapDirection: 1200,
  buildKit: 1800,
  strengthenBullet: 200,
  submitAddExperience: 1000,
  buildStoryBank: 2000,
  addStoryDetail: 300,
  analyzeJd: 1200,
};

const PLAIN_TEXT_OPERATIONS = new Set(['sendConvo']);

function jsonResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

function repairMaxTokens(baseLimit) {
  return Math.min(Math.ceil(baseLimit * 1.6), REPAIR_BUDGET_CAP);
}

function reshapeMaxTokens(baseLimit) {
  return Math.min(baseLimit, RESHAPE_CAP);
}

function parseOperation(rawOperation) {
  if (typeof rawOperation !== 'string') {
    return { ok: false, error: 'operation must be a string' };
  }

  const operation = rawOperation.trim();
  if (!operation) {
    return { ok: false, error: 'operation is required' };
  }

  if (operation.endsWith(':repair')) {
    const base = operation.slice(0, -':repair'.length);
    if (!base) return { ok: false, error: 'invalid operation suffix' };
    return { ok: true, operation, base, suffix: 'repair' };
  }

  if (operation.endsWith(':reshape')) {
    const base = operation.slice(0, -':reshape'.length);
    if (!base) return { ok: false, error: 'invalid operation suffix' };
    return { ok: true, operation, base, suffix: 'reshape' };
  }

  if (operation.includes(':')) {
    return { ok: false, error: 'unsupported operation suffix' };
  }

  return { ok: true, operation, base: operation, suffix: null };
}

function getMaxTokensForOperation(baseOperation, suffix) {
  const baseLimit = BASE_OPERATION_LIMITS[baseOperation];
  if (!baseLimit) return null;

  if (suffix === 'repair') return repairMaxTokens(baseLimit);
  if (suffix === 'reshape') return reshapeMaxTokens(baseLimit);
  return baseLimit;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length !== 1) {
    return { ok: false, error: 'messages must contain exactly one user turn' };
  }

  const message = messages[0];
  if (!isPlainObject(message)) {
    return { ok: false, error: 'message must be an object' };
  }

  if (message.role !== 'user') {
    return { ok: false, error: 'message role must be user' };
  }

  if (typeof message.content !== 'string') {
    return { ok: false, error: 'message content must be a string' };
  }

  const content = message.content;
  if (!content.trim()) {
    return { ok: false, error: 'message content must not be empty' };
  }

  if (content.length > MAX_USER_CONTENT_CHARS) {
    return { ok: false, error: 'message content exceeds allowed length' };
  }

  return { ok: true };
}

function validateTools(tools, toolChoice, isPlainTextOperation) {
  if (isPlainTextOperation) {
    if (tools !== undefined && tools !== null) {
      return { ok: false, error: 'tools are not allowed for this operation' };
    }
    if (toolChoice !== undefined && toolChoice !== null) {
      return { ok: false, error: 'tool_choice is not allowed for this operation' };
    }
    return { ok: true };
  }

  if (!Array.isArray(tools) || tools.length !== 1) {
    return { ok: false, error: 'tools must contain exactly one tool definition' };
  }

  const toolsJson = JSON.stringify(tools);
  if (toolsJson.length > MAX_TOOLS_JSON_BYTES) {
    return { ok: false, error: 'tools payload exceeds allowed size', status: 413 };
  }

  const tool = tools[0];
  if (!isPlainObject(tool) || typeof tool.name !== 'string' || !tool.name.trim()) {
    return { ok: false, error: 'tool definition is invalid' };
  }

  if (!isPlainObject(toolChoice)) {
    return { ok: false, error: 'tool_choice is required for structured operations' };
  }

  if (
    toolChoice.type !== 'tool' ||
    typeof toolChoice.name !== 'string' ||
    toolChoice.name !== tool.name
  ) {
    return { ok: false, error: 'tool_choice must target the provided tool' };
  }

  return { ok: true };
}

function validateClaudeRequest(body) {
  if (!isPlainObject(body)) {
    return { ok: false, error: 'request body must be a JSON object' };
  }

  const parsedOperation = parseOperation(body.operation);
  if (!parsedOperation.ok) {
    return { ok: false, error: parsedOperation.error };
  }

  const { base, suffix } = parsedOperation;
  if (!Object.prototype.hasOwnProperty.call(BASE_OPERATION_LIMITS, base)) {
    return { ok: false, error: 'unsupported operation' };
  }

  const isPlainTextOperation = PLAIN_TEXT_OPERATIONS.has(base);
  if (suffix && isPlainTextOperation) {
    return { ok: false, error: 'unsupported operation suffix' };
  }

  if (typeof body.system !== 'string' || !body.system.trim()) {
    return { ok: false, error: 'system must be a non-empty string' };
  }

  if (body.system.length > MAX_SYSTEM_CHARS) {
    return { ok: false, error: 'system prompt exceeds allowed length', status: 413 };
  }

  const messagesCheck = validateMessages(body.messages);
  if (!messagesCheck.ok) {
    return messagesCheck;
  }

  const toolsCheck = validateTools(body.tools, body.tool_choice, isPlainTextOperation);
  if (!toolsCheck.ok) {
    return toolsCheck;
  }

  const allowedMaxTokens = getMaxTokensForOperation(base, suffix);
  const requestedMaxTokens = body.max_tokens;

  if (
    typeof requestedMaxTokens !== 'number' ||
    !Number.isFinite(requestedMaxTokens) ||
    requestedMaxTokens <= 0
  ) {
    return { ok: false, error: 'max_tokens must be a positive number' };
  }

  if (requestedMaxTokens > allowedMaxTokens) {
    return { ok: false, error: 'max_tokens exceeds allowed limit for operation' };
  }

  return {
    ok: true,
    operation: parsedOperation.operation,
    maxTokens: requestedMaxTokens,
  };
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

function buildAnthropicPayload(body, maxTokens) {
  const payload = {
    model: MODEL,
    max_tokens: maxTokens,
    system: body.system,
    messages: body.messages,
  };

  if (body.tools) payload.tools = body.tools;
  if (body.tool_choice) payload.tool_choice = body.tool_choice;

  return payload;
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

    const validation = validateClaudeRequest(body);
    if (!validation.ok) {
      return jsonResponse({ error: validation.error }, validation.status || 400);
    }

    try {
      const anthropicPayload = buildAnthropicPayload(body, validation.maxTokens);

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(anthropicPayload),
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
