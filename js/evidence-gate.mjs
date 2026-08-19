/**
 * Deterministic evidence classification gate for resume bullets and roadmap copy.
 * Keep in sync with regression tests in scripts/test-evidence-quality.mjs.
 */

export const EVIDENCE_CATEGORIES = [
  'concrete_past_action',
  'self_described_ability',
  'trait',
  'preference',
  'aspiration',
];

const ABILITY_WRAPPER =
  /\b(know how to|knowing how to|knew how to|can |could |am able to|m able to|good at|skilled at|capable of)\b/i;

const ASPIRATION =
  /\b(want to become|want to be an?|hope to|plan to|looking to|aiming to|aspire|moving toward|transition into|my goal is|would like to work as)\b/i;

const PREFERENCE =
  /\b(i like|i love|i enjoy|i prefer|socializing|taking care of people|care about people)\b/i;

const TRAIT =
  /\b(i am|i'm a|i'm very|i'm attentive|very easygoing|easygoing person|understanding|approachable|adaptable|hardworking|attentive|reliable|caring|empathetic|patient)\b/i;

const LISTEN_AS_ABILITY =
  /\b(listen to people|listening to people|active listening|i listen)\b/i;

const PAST_ACTION_VERB =
  /\bi\s+(?:organized|scheduled|managed|coordinated|led|trained|helped|answered|fixed|completed|handled|volunteered|worked|served|created|built|developed|implemented|processed|prepared|maintained|facilitated|supervised|resolved|delivered|provided|assisted|supported|taught|planned|executed|ran|designed|wrote|cooked|drove|stocked|cleaned|filed|updated|tracked|monitored|reviewed|edited|researched|presented|mentored|sold|packaged|shipped|assembled|installed|repaired|tested|drafted|published|hosted|greeted|booked|registered|enrolled|studied|performed|directed|produced|collaborated|moved|started|began|initiated|established|founded|constructed|manufactured|inventoried|restocked|reordered|balanced|counted|entered|transcribed|translated|interpreted|mediated|examined|diagnosed|treated|administered|measured|mixed|baked|grilled|fried|graduated|practiced|auditioned|toured|relocated|voted|campaigned|canvassed|petitioned|lobbied|testified|declared|communicated|partnered|contracted|automated|converted|transformed|transferred|switched|changed|modified|adjusted|adapted|customized|standardized|operationalized|launched|opened|closed|commenced|instituted|formed|forged|cast|molded|shaped|sculpted|carved|welded|soldered|riveted|bolted|screwed|nailed|glued|attached|fastened|secured|anchored|parked|stored|warehoused|replenished|refilled|resupplied|reordered|acquired|obtained|procured|sourced|supplied|mailed|posted|sent|transmitted|broadcast|released|debuted|premiered)\b/i;

const WORK_CONTEXT =
  /\b(worked as a|served as a|volunteered at|interned at|employed as|for my (?:manager|team|boss|aunt|church|school)|helped (?:my|with)|helped my)\b/i;

const REACH_OUT_FIX = /\bpeople reach out to me\b/i;

const CARE_CONTEXT =
  /\b(medication reminders|daily routines|meals and appointments|caregiver for)\b/i;

const CLAUSE_CONJUNCTION = /,\s*(?:and|but|or|yet|so)\s+/i;

const CLAUSE_INDEPENDENT_START =
  /,\s+(?=(?:I['']?\s|I['']m\s|I['']ve\s|I['']d\s|people\s))/i;

function stripYouDescribed(text) {
  return String(text || '')
    .trim()
    .replace(/^you described\s*/i, '')
    .replace(/\.$/, '')
    .trim();
}

function normalizeSourceQuote(text) {
  return String(text || '').trim().replace(/\.+$/, '').trim();
}

function hasConcretePastAction(text) {
  const t = String(text || '').trim();
  if (!t) return false;

  if (ABILITY_WRAPPER.test(t) && !PAST_ACTION_VERB.test(t)) return false;

  if (REACH_OUT_FIX.test(t) && /\bfix\b/i.test(t)) return true;

  if (PAST_ACTION_VERB.test(t)) return true;

  if (WORK_CONTEXT.test(t) && /\b(helped|organized|scheduled|managed|coordinated|with)\b/i.test(t)) {
    return true;
  }

  if (CARE_CONTEXT.test(t)) return true;

  return false;
}

/** Classify one evidence clause (not a compound sentence). */
export function classifyEvidenceText(text) {
  const raw = String(text || '').trim();
  if (!raw) return 'trait';

  const t = stripYouDescribed(raw);

  if (hasConcretePastAction(t)) return 'concrete_past_action';

  if (ASPIRATION.test(t)) return 'aspiration';

  if (ABILITY_WRAPPER.test(t)) return 'self_described_ability';

  if (PREFERENCE.test(t)) return 'preference';

  if (LISTEN_AS_ABILITY.test(t)) return 'self_described_ability';

  if (TRAIT.test(t)) return 'trait';

  if (/\b(know how|organize things|coordinate things)\b/i.test(t)) {
    return 'self_described_ability';
  }

  return 'self_described_ability';
}

function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Split a sentence into independent evidence clauses for separate classification. */
export function extractClauses(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  let clauses = [raw];

  clauses = clauses.flatMap((clause) =>
    clause
      .split(CLAUSE_CONJUNCTION)
      .map((part) => part.trim())
      .filter(Boolean)
  );

  clauses = clauses.flatMap((clause) =>
    clause
      .split(CLAUSE_INDEPENDENT_START)
      .map((part) => part.trim())
      .filter(Boolean)
  );

  return clauses
    .map((part) => part.replace(/^[,;\s]+|[,;\s]+$/g, '').trim())
    .filter(Boolean);
}

/** Classify each clause extracted from story text (for tests and prompts). */
export function classifyStoryClauses(text) {
  const items = [];
  for (const sentence of splitSentences(text)) {
    for (const clause of extractClauses(sentence)) {
      items.push({
        source: clause,
        category: classifyEvidenceText(clause),
        origin: 'story',
      });
    }
  }
  return items;
}

function dedupeItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.category}::${item.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectEvidenceItems(text, origin, skillName) {
  const items = [];
  const base = origin === 'skill' ? stripYouDescribed(text) || text : text;
  for (const sentence of splitSentences(base)) {
    for (const clause of extractClauses(sentence)) {
      items.push({
        source: clause,
        category: classifyEvidenceText(clause),
        origin,
        ...(skillName ? { skillName } : {}),
      });
    }
  }
  return items;
}

/**
 * Classify story + retained skill evidence and determine resume-bullet eligibility.
 */
export function gateRetainedEvidence(storyText, retainedSkills = []) {
  const items = [];

  items.push(...collectEvidenceItems(storyText, 'story'));

  for (const skill of retainedSkills) {
    items.push(...collectEvidenceItems(skill.evidence, 'skill', skill.name));
  }

  const deduped = dedupeItems(items);
  const concretePastActions = deduped.filter((i) => i.category === 'concrete_past_action');

  return {
    items: deduped,
    concretePastActions,
    allowResumeBullets: concretePastActions.length > 0,
  };
}

export function getAllowedSourceQuotes(gate) {
  return (gate?.concretePastActions || []).map((item) => item.source);
}

function sourceQuoteIsAllowed(sourceQuote, gate) {
  const normalized = normalizeSourceQuote(sourceQuote);
  if (!normalized) return false;

  return (gate?.concretePastActions || []).some((item) => {
    if (normalizeSourceQuote(item.source) !== normalized) return false;
    return item.category === 'concrete_past_action';
  });
}

/** Keep only bullets whose sourceQuote matches an allowed concrete_past_action source. */
export function validateResumeBulletSources(bullets, gate) {
  if (!gate?.allowResumeBullets) return [];
  if (!Array.isArray(bullets)) return [];

  return bullets.filter((bullet) => {
    if (!bullet || !isNonEmptyStr(bullet.text)) return false;
    if (!sourceQuoteIsAllowed(bullet.sourceQuote, gate)) return false;
    if (classifyEvidenceText(bullet.sourceQuote) !== 'concrete_past_action') return false;
    return true;
  });
}

function isNonEmptyStr(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function stripInternalBulletFields(bullet) {
  const out = { text: bullet.text.trim() };
  if (bullet.strengthen) out.strengthen = bullet.strengthen;
  return out;
}

/**
 * Enforce resume bullet evidence per bullet. Zero concrete actions → [].
 * Surviving bullets have internal sourceQuote stripped before UI use.
 */
export function applyResumeBulletGate(kitResult, gate) {
  if (!kitResult || typeof kitResult !== 'object') return kitResult;

  if (!gate?.allowResumeBullets) {
    return { ...kitResult, resumeBullets: [] };
  }

  const validated = validateResumeBulletSources(kitResult.resumeBullets || [], gate).map(
    stripInternalBulletFields
  );

  return { ...kitResult, resumeBullets: validated };
}

function formatCategoryBlock(gate, category) {
  const lines = gate.items.filter((i) => i.category === category).map((i) => `- "${i.source}"`);
  return lines.length ? lines.join('\n') : 'none';
}

/** Prompt block sent to buildKit / roadmap operations. */
export function formatEvidenceGateForPrompt(gate) {
  const lines = [
    'Evidence gate (application-owned classification — do not upgrade categories):',
    `concrete_past_action:\n${formatCategoryBlock(gate, 'concrete_past_action')}`,
    `self_described_ability:\n${formatCategoryBlock(gate, 'self_described_ability')}`,
    `trait:\n${formatCategoryBlock(gate, 'trait')}`,
    `preference:\n${formatCategoryBlock(gate, 'preference')}`,
    `aspiration:\n${formatCategoryBlock(gate, 'aspiration')}`,
  ];

  if (!gate.allowResumeBullets) {
    lines.push(
      'RESUME BULLET GATE: ZERO concrete past actions identified. resumeBullets MUST be an empty array []. This gate cannot be overridden.'
    );
  } else {
    lines.push(
      'Each resume bullet MUST include sourceQuote set to the EXACT concrete_past_action quote it is grounded in (copy verbatim from the list above). Bullets with missing or invalid sourceQuote are removed after generation.'
    );
  }

  return lines.join('\n\n');
}

/** Resume-bullet-only source list for buildKit user prompt. */
export function formatResumeBulletSources(gate) {
  if (!gate.concretePastActions.length) {
    return 'NONE — return resumeBullets: []';
  }
  return gate.concretePastActions
    .map((a) => `- "${a.source}"${a.skillName ? ` (${a.skillName})` : ''}`)
    .join('\n');
}

/** Non-concrete evidence usable for LinkedIn About/headlines. */
export function formatLinkedInEvidenceContext(gate) {
  const lines = gate.items
    .filter((i) => i.category !== 'concrete_past_action')
    .map((i) => `[${i.category}] "${i.source}"`);
  return lines.length ? lines.join('\n') : 'none';
}
