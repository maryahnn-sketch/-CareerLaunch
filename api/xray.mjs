/**
 * CareerLaunch Public Skill X-Ray API
 *
 * Accepts a simple { story } payload, calls Anthropic server-side with a
 * fixed model/prompt/tool schema, and returns exactly 3 skill names.
 *
 * Rate limiting note: this handler enforces input length and token budget
 * only. Durable server-side rate limiting (per-IP or per-device) will
 * require a persistent service such as Vercel KV / Upstash Redis, or
 * platform-level firewall rate limiting, before mass public launch.
 */

const MIN_STORY_CHARS = 20;
const MAX_STORY_CHARS = 2000;
const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 256;

const NO_INVENTION_RULE = `Strict evidence rule: never state or imply a fact about the user that they did not provide — no numbers, percentages, revenue, customer counts, team sizes, job titles, employer names, credentials, education, software tools, years of experience, certifications, achievements, or outcomes. Only name professional transferable skills genuinely supported by what they wrote. Skill names must be generic professional capability labels (e.g. "Customer Service"), not invented metrics or seniority claims.`;

const SYSTEM_PROMPT = `You are the Skill X-Ray inside iFindWorth. A visitor describes, in ordinary language, something they have actually done at work or in real life. Your only job is to identify exactly three professional transferable skill names supported by their words.

${NO_INVENTION_RULE}

Rules:
1) Return EXACTLY 3 skill names — no more, no fewer.
2) Each name is a concise professional capability label (1–4 words), title case.
3) Do NOT include evidence text, strength scores, career paths, salaries, percentages, or any quantitative claim.
4) Only include skills with clear support in the user's text. Prefer the strongest three.
5) Do not repeat the same skill under different wording.`;

const XRAY_TOOL = {
  name: 'report_xray_skills',
  description:
    'Report exactly three professional transferable skill names supported by the user story.',
  input_schema: {
    type: 'object',
    properties: {
      skills: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: {
          type: 'string',
          minLength: 1,
          maxLength: 60,
          description: 'A concise professional transferable skill name.',
        },
      },
    },
    required: ['skills'],
  },
};

// Patterns that suggest invented quantitative claims inside a skill name.
const FORBIDDEN_SKILL_PATTERN =
  /\b\d+(\.\d+)?%?\b|\$|\byears?\b|\brevenue\b|\bteam of\b|\bmanaged \d+/i;

function jsonResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

function normalizeStory(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim();
}

function validateStory(story) {
  if (!story) {
    return { ok: false, status: 400, error: 'Please describe something you have done.' };
  }
  if (story.length < MIN_STORY_CHARS) {
    return {
      ok: false,
      status: 400,
      error: `Please share a bit more detail — at least ${MIN_STORY_CHARS} characters.`,
    };
  }
  if (story.length > MAX_STORY_CHARS) {
    return {
      ok: false,
      status: 400,
      error: `Please shorten your description to ${MAX_STORY_CHARS} characters or fewer.`,
    };
  }
  return { ok: true };
}

function isValidSkillName(name) {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 60) return false;
  if (FORBIDDEN_SKILL_PATTERN.test(trimmed)) return false;
  return true;
}

function extractSkillsFromAnthropic(data) {
  const toolUse = (data.content || []).find(
    (block) => block.type === 'tool_use' && block.name === XRAY_TOOL.name
  );
  if (toolUse?.input?.skills && Array.isArray(toolUse.input.skills)) {
    return toolUse.input.skills;
  }

  // Fallback: some environments return plain JSON text instead of tool_use.
  const text = (data.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  if (!text) return null;

  const cleaned = text
    .replace(/^```json/i, '')
    .replace(/^```/, '')
    .replace(/```$/, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed.skills)) return parsed.skills;
    if (Array.isArray(parsed)) return parsed;
  } catch {
    return null;
  }

  return null;
}

function normalizeSkillNames(rawSkills) {
  if (!Array.isArray(rawSkills)) return null;

  const seen = new Set();
  const skills = [];

  for (const item of rawSkills) {
    if (!isValidSkillName(item)) continue;
    const normalized = item.trim().replace(/\s+/g, ' ');
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    skills.push(normalized);
    if (skills.length === 3) break;
  }

  return skills.length === 3 ? skills : null;
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return jsonResponse({ error: 'AI service is not configured' }, 500);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return jsonResponse({ error: 'Request body must be a JSON object' }, 400);
    }

    if (Object.keys(payload).length !== 1 || !('story' in payload)) {
      return jsonResponse({ error: 'Request body must contain only a "story" field' }, 400);
    }

    const story = normalizeStory(payload.story);
    const storyCheck = validateStory(story);
    if (!storyCheck.ok) {
      return jsonResponse({ error: storyCheck.error }, storyCheck.status);
    }

    const anthropicBody = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: story }],
      tools: [XRAY_TOOL],
      tool_choice: { type: 'tool', name: XRAY_TOOL.name },
    };

    let anthropicResponse;
    try {
      anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(anthropicBody),
      });
    } catch (error) {
      console.error('[CareerLaunch X-Ray API] Anthropic request failed', error);
      return jsonResponse({ error: 'Unable to reach AI service' }, 502);
    }

    let anthropicData;
    try {
      anthropicData = await anthropicResponse.json();
    } catch {
      return jsonResponse({ error: 'AI service returned an unreadable response' }, 502);
    }

    if (!anthropicResponse.ok) {
      console.error(
        '[CareerLaunch X-Ray API] Anthropic error',
        anthropicResponse.status,
        anthropicData
      );
      return jsonResponse({ error: 'AI service could not process your story' }, 502);
    }

    if (anthropicData.stop_reason === 'max_tokens') {
      return jsonResponse({ error: 'AI response was incomplete — please try again' }, 502);
    }

    const rawSkills = extractSkillsFromAnthropic(anthropicData);
    const skills = normalizeSkillNames(rawSkills);

    if (!skills) {
      console.error('[CareerLaunch X-Ray API] Malformed or incomplete skill output', {
        stop_reason: anthropicData.stop_reason,
        rawSkills,
      });
      return jsonResponse({ error: 'Could not extract three valid skills — please try again' }, 502);
    }

    return jsonResponse({ skills });
  },
};
