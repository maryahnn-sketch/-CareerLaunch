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
  /\b(medication reminders|daily routines|meals and appointments|caregiver for|personal care)\b/i;

const CLAUSE_CONJUNCTION = /,\s*(?:and|but|or|yet|so)\s+/i;

const CLAUSE_INDEPENDENT_START =
  /,\s+(?=(?:I['']?\s|I['']m\s|I['']ve\s|I['']d\s|people\s))/i;

/** Voice input: split before a new independent subject without a comma. */
const CLAUSE_BARE_CONJUNCTION =
  /\s+(?:and|but|or|yet|so)\s+(?=(?:I['']?\s|I['']m\s|I['']ve\s|I['']d\s|people\s))/i;

const STOP_WORDS = new Set([
  'you',
  'described',
  'the',
  'a',
  'an',
  'to',
  'my',
  'their',
  'that',
  'this',
  'your',
  'and',
  'or',
  'but',
  'for',
  'with',
  'of',
  'in',
  'on',
  'at',
  'as',
  'is',
  'are',
  'was',
  'were',
  'be',
  'being',
]);

function stripYouDescribed(text) {
  return String(text || '')
    .trim()
    .replace(/^you described\s*/i, '')
    .replace(/\.$/, '')
    .trim();
}

export function normalizeSourceQuote(text) {
  return String(text || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\.+$/, '')
    .trim();
}

function normalizeForMatch(text) {
  return normalizeSourceQuote(text).toLowerCase();
}

function tokenize(text) {
  return normalizeForMatch(text)
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function hasConcretePastAction(text) {
  const t = String(text || '').trim();
  if (!t) return false;

  if (ABILITY_WRAPPER.test(t) && !PAST_ACTION_VERB.test(t)) return false;

  if (REACH_OUT_FIX.test(t) && /\bfix\b/i.test(t)) return true;

  if (PAST_ACTION_VERB.test(t)) return true;

  if (WORK_CONTEXT.test(t) && /\b(helped|organized|scheduled|managed|coordinated|with|provided|personal care)\b/i.test(t)) {
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

export function listStoryClauses(storyText) {
  const clauses = [];
  for (const sentence of splitSentences(storyText)) {
    for (const clause of extractClauses(sentence)) {
      clauses.push(clause);
    }
  }
  return clauses;
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

  clauses = clauses.flatMap((clause) =>
    clause
      .split(CLAUSE_BARE_CONJUNCTION)
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
  for (const clause of listStoryClauses(text)) {
    items.push({
      source: clause,
      category: classifyEvidenceText(clause),
      origin: 'story',
    });
  }
  return items;
}

function clauseExistsInStory(clause, storyText) {
  const clauseNorm = normalizeForMatch(clause);
  if (!clauseNorm) return false;
  return normalizeForMatch(storyText).includes(clauseNorm);
}

function clauseMatchScore(clause, evidenceParaphrase) {
  const clauseWords = tokenize(clause);
  const evidenceWords = tokenize(stripYouDescribed(evidenceParaphrase));
  const significant = evidenceWords.filter((w) => !STOP_WORDS.has(w) && w.length > 2);
  if (!significant.length) return 0;

  let hits = 0;
  for (const word of significant) {
    if (clauseWords.some((cw) => cw === word || cw.includes(word) || word.includes(cw))) {
      hits += 1;
    }
  }
  return hits / significant.length;
}

/** Find the best verbatim story clause supporting a skill's evidence paraphrase. */
export function deriveSourceQuoteFromStory(storyText, skillEvidence) {
  const clauses = listStoryClauses(storyText);
  if (!clauses.length) return '';

  let bestClause = '';
  let bestScore = 0;
  for (const clause of clauses) {
    if (!clauseExistsInStory(clause, storyText)) continue;
    const score = clauseMatchScore(clause, skillEvidence);
    if (score > bestScore) {
      bestScore = score;
      bestClause = clause;
    }
  }

  if (bestScore >= 0.34 || clauseMatchScore(bestClause, skillEvidence) >= 0.34) {
    return bestClause;
  }
  return '';
}

/** Attach validated story sourceQuote provenance to analyzed skills. */
export function enrichSkillsWithSourceQuotes(skills, storyText) {
  return (skills || []).map((skill) => {
    const existing =
      skill.sourceQuote && clauseExistsInStory(skill.sourceQuote, storyText)
        ? skill.sourceQuote
        : '';
    const derived = existing || deriveSourceQuoteFromStory(storyText, skill.evidence);
    return {
      ...skill,
      sourceQuote: derived || '',
    };
  });
}

function resolveSkillSourceQuote(skill, storyText) {
  if (skill.sourceQuote && clauseExistsInStory(skill.sourceQuote, storyText)) {
    return skill.sourceQuote;
  }
  const derived = deriveSourceQuoteFromStory(storyText, skill.evidence);
  return derived || '';
}

function createProvenanceEntry() {
  return { retained: new Set(), rejected: new Set() };
}

/** Map normalized story clause → retained/rejected skill names. */
export function buildClauseProvenance(storyText, retainedSkills = [], rejectedSkills = []) {
  const map = new Map();

  function linkSkill(skill, bucket) {
    const quote = resolveSkillSourceQuote(skill, storyText);
    if (!quote || !clauseExistsInStory(quote, storyText)) return;
    const key = normalizeForMatch(quote);
    if (!map.has(key)) map.set(key, createProvenanceEntry());
    map.get(key)[bucket].add(skill.name);
  }

  for (const skill of retainedSkills) linkSkill(skill, 'retained');
  for (const skill of rejectedSkills) linkSkill(skill, 'rejected');

  return map;
}

function getProvenanceEntry(clauseSource, provenance) {
  return provenance.get(normalizeForMatch(clauseSource)) || null;
}

/** Story clause allowed for downstream use unless linked ONLY to rejected skills. */
export function isStoryClauseAllowed(clauseSource, provenance) {
  const entry = getProvenanceEntry(clauseSource, provenance);
  if (!entry) return true;
  if (entry.retained.size > 0) return true;
  if (entry.rejected.size > 0 && entry.retained.size === 0) return false;
  return true;
}

/** Concrete story clause allowed unless linked ONLY to rejected skills. */
export function isConcreteClauseAllowed(clauseSource, provenance) {
  return isStoryClauseAllowed(clauseSource, provenance);
}

function dedupeItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.category}::${item.origin}::${item.source}`;
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
 * Classify story + skill evidence and determine resume-bullet eligibility.
 * Rejected-skill provenance excludes concrete clauses tied only to rejected skills.
 */
export function gateRetainedEvidence(storyText, retainedSkills = [], rejectedSkills = []) {
  const enrichedRetained = enrichSkillsWithSourceQuotes(retainedSkills, storyText);
  const enrichedRejected = enrichSkillsWithSourceQuotes(rejectedSkills, storyText);
  const provenance = buildClauseProvenance(storyText, enrichedRetained, enrichedRejected);

  const items = [];
  items.push(...collectEvidenceItems(storyText, 'story'));

  for (const skill of enrichedRetained) {
    items.push(...collectEvidenceItems(skill.evidence, 'skill', skill.name));
  }

  const deduped = dedupeItems(items);

  const concretePastActions = deduped.filter(
    (item) =>
      item.category === 'concrete_past_action' &&
      item.origin === 'story' &&
      isStoryClauseAllowed(item.source, provenance)
  );

  const downstreamStoryItems = deduped.filter(
    (item) => item.origin === 'story' && isStoryClauseAllowed(item.source, provenance)
  );

  const rejectedOnlyStory = deduped.filter(
    (item) => item.origin === 'story' && !isStoryClauseAllowed(item.source, provenance)
  );

  return {
    items: deduped,
    concretePastActions,
    allowResumeBullets: concretePastActions.length > 0,
    provenance,
    downstreamStoryItems,
    rejectedOnlyStory,
    rejectedOnlyConcrete: rejectedOnlyStory.filter(
      (item) => item.category === 'concrete_past_action'
    ),
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

function formatAllowedCategoryBlock(gate, category) {
  const lines = (gate.downstreamStoryItems || [])
    .filter((i) => i.category === category)
    .map((i) => `- "${i.source}"`);
  return lines.length ? lines.join('\n') : 'none';
}

/** Prompt block sent to buildKit — allow-list only; rejected-only evidence stays internal. */
export function formatEvidenceGateForPrompt(gate) {
  const lines = [
    'Evidence gate (application-owned classification — do not upgrade categories):',
    `concrete_past_action:\n${formatAllowedCategoryBlock(gate, 'concrete_past_action')}`,
    `self_described_ability:\n${formatAllowedCategoryBlock(gate, 'self_described_ability')}`,
    `trait:\n${formatAllowedCategoryBlock(gate, 'trait')}`,
    `preference:\n${formatAllowedCategoryBlock(gate, 'preference')}`,
    `aspiration:\n${formatAllowedCategoryBlock(gate, 'aspiration')}`,
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

/** Provenance-filtered story context for career path reasoning (discoverPaths / refinePaths). */
export function formatDownstreamStoryForPaths(gate) {
  const storyLines = (gate.downstreamStoryItems || []).map((i) => i.source).join(' ');
  const lines = [
    storyLines || '(no story evidence after rejected-skill filtering)',
    '',
    'Story evidence by category (provenance-filtered — rejected Not Quite skill evidence excluded):',
    `concrete_past_action:\n${formatAllowedCategoryBlock(gate, 'concrete_past_action')}`,
    `self_described_ability:\n${formatAllowedCategoryBlock(gate, 'self_described_ability')}`,
    `trait:\n${formatAllowedCategoryBlock(gate, 'trait')}`,
    `preference:\n${formatAllowedCategoryBlock(gate, 'preference')}`,
    `aspiration:\n${formatAllowedCategoryBlock(gate, 'aspiration')}`,
  ];

  return lines.join('\n\n');
}

/** Build provenance-filtered path prompt story section from raw inputs. */
export function buildPathPromptStoryContext(storyText, retainedSkills = [], rejectedSkills = []) {
  return formatDownstreamStoryForPaths(
    gateRetainedEvidence(storyText, retainedSkills, rejectedSkills)
  );
}

/** Evidence gate block for roadmap sections (foundation, action plan, direction). Allow-list only. */
export function formatEvidenceGateForRoadmapPrompt(gate) {
  const lines = [
    'Evidence gate (application-owned classification — do not upgrade categories):',
    `concrete_past_action:\n${formatAllowedCategoryBlock(gate, 'concrete_past_action')}`,
    `self_described_ability:\n${formatAllowedCategoryBlock(gate, 'self_described_ability')}`,
    `trait:\n${formatAllowedCategoryBlock(gate, 'trait')}`,
    `preference:\n${formatAllowedCategoryBlock(gate, 'preference')}`,
    `aspiration:\n${formatAllowedCategoryBlock(gate, 'aspiration')}`,
  ];

  if (!gate.allowResumeBullets) {
    lines.push(
      'ZERO concrete past actions identified. Do not describe performed work tasks, "demonstrated strengths," or experience managing/coordinating unless concrete_past_action items exist above.'
    );
  }

  lines.push(
    'POSITIONING RULE: If organization/coordination/listening appear only as self_described_ability, positioning may say the user identifies these as personal strengths while building concrete examples — never "demonstrated strengths," never imply performed organizing/coordinating/listening tasks unless concrete_past_action items exist.'
  );

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

/** Non-concrete allowed story evidence usable for LinkedIn About/headlines. */
export function formatLinkedInEvidenceContext(gate) {
  const lines = (gate.downstreamStoryItems || [])
    .filter((i) => i.category !== 'concrete_past_action')
    .map((i) => `[${i.category}] "${i.source}"`);
  return lines.length ? lines.join('\n') : 'none';
}

/** LinkedIn category-discipline block for buildKit user prompt. */
export function formatLinkedInRulesForPrompt(gate) {
  const hasConcrete = (gate?.concretePastActions || []).length > 0;
  const lines = [
    'LinkedIn evidence discipline (preserve category semantics — do not upgrade):',
    '- self_described_ability: may say the user identifies organization/coordination/listening as personal strengths; must NOT become skilled scheduler, effective prioritizer, strong coordinator, or keeps operations running smoothly unless separately evidenced.',
    '- trait: may say easygoing, understanding, attentive as self-described qualities; must NOT become works effectively across teams, reliable professional, thrives in collaborative environments, or universal claims like every interaction/task unless stated.',
    '- preference: may express what the user likes/values; must NOT become professional competence or performed duties.',
    '- target career: may be future-facing (Transitioning into / Building toward); must NOT imply the user currently holds the target title or has performed target-role duties.',
    '- Recruiter headlines may include target ROLE KEYWORDS for searchability but must signal transition/building when the user has no concrete work history in that field.',
  ];
  if (!hasConcrete) {
    lines.push(
      '- ZERO concrete_past_action evidence: do NOT use scheduling, detail-oriented, prioritize, reliable, thrive, work well across teams, keep things running smoothly, Support Professional, or similar performance/identity upgrades unless those exact concepts appear in allowed evidence above.'
    );
  }
  return lines.join('\n');
}

const LINKEDIN_UPGRADE_CHECKS = [
  { id: 'scheduling', pattern: /\bschedul(?:e|es|ed|ing|er)\b/i, evidenceStems: ['schedul', 'appointment'] },
  { id: 'detail-oriented', pattern: /\bdetail[- ]oriented\b/i, evidenceStems: ['detail'] },
  { id: 'prioritize', pattern: /\bprioriti(?:z|s)(?:e|es|ed|ing|y|ies)\b/i, evidenceStems: ['priorit'] },
  { id: 'reliable', pattern: /\breliab(?:le|ility)\b/i, evidenceStems: ['reliab'] },
  { id: 'thrive', pattern: /\bthriv(?:e|es|ing)\b/i, evidenceStems: ['thriv'] },
  {
    id: 'work-across-teams',
    pattern: /\b(?:work(?:s|ing)? well )?(?:across teams|with teams and)\b/i,
    evidenceStems: ['team', 'teams'],
  },
  {
    id: 'keep-things-running',
    pattern: /\bkeep(?:s|ing)? things running smoothly\b/i,
    evidenceStems: ['running', 'smooth'],
  },
  {
    id: 'support-professional',
    pattern: /\bsupport professional\b/i,
    evidenceStems: ['support professional'],
  },
  {
    id: 'universal-scope',
    pattern: /\bevery (?:interaction|task|responsibility)\b/i,
    evidenceStems: ['every interaction', 'every task', 'every responsibility'],
  },
  {
    id: 'experienced-in-concept',
    pattern: /\bexperienced in\b/i,
    evidenceStems: ['experienced in'],
  },
  {
    id: 'skilled-role',
    pattern: /\bskilled\b/i,
    evidenceStems: ['skilled'],
  },
  {
    id: 'office-skills',
    pattern: /\boffice skills\b/i,
    evidenceStems: ['office skills'],
  },
  {
    id: 'self-aware',
    pattern: /\bself-aware\b/i,
    evidenceStems: ['self-aware', 'self aware'],
  },
  {
    id: 'meaningful-work',
    pattern: /\bmeaningful work\b/i,
    evidenceStems: ['meaningful work'],
  },
];

const COMPETENCE_UPGRADE_PATTERN =
  /\b(?:strong|experienced|skilled|expert|proven|demonstrated)\b/i;

/** Evidence corpus: allowed story items only — target career is NOT evidence. */
export function buildLinkedInEvidenceCorpus(gate) {
  return (gate?.downstreamStoryItems || [])
    .map((item) => item.source)
    .join(' ')
    .toLowerCase();
}

function corpusHasStem(corpus, stems) {
  const normalized = String(corpus || '').toLowerCase();
  return (stems || []).some((stem) => normalized.includes(String(stem).toLowerCase()));
}

function targetTitleTokens(targetPathTitle) {
  return String(targetPathTitle || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/]/g, ' ')
    .split(/[\s/]+/)
    .filter((token) => token.length > 3);
}

function escapeTargetForRegex(targetPathTitle) {
  return targetPathShortLabel(targetPathTitle)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s*\/\s*/g, '\\s*/\\s*')
    .replace(/\s+/g, '\\s+');
}

const FUTURE_TARGET_PREFIX =
  '(?:transition(?:ing)?(?:\\s+into)?|building toward|aspiring to(?:\\s+become)?|moving toward|exploring a move toward)';

/** Remove only the authorized future-target span; validate the remainder separately. */
export function maskAuthorizedFutureTargetSpan(clause, targetPathTitle) {
  const clauseText = String(clause || '').trim();
  const targetPattern = escapeTargetForRegex(targetPathTitle);
  if (!clauseText || !targetPattern) {
    return { remainder: clauseText, masked: '' };
  }

  const spanRegex = new RegExp(`\\b${FUTURE_TARGET_PREFIX}\\s+${targetPattern}\\b`, 'i');
  const match = clauseText.match(spanRegex);
  if (!match) {
    return { remainder: clauseText, masked: '' };
  }

  const remainder = clauseText.replace(spanRegex, ' ').replace(/\s+/g, ' ').trim();
  return { remainder, masked: match[0] };
}

function splitLinkedInClauses(text) {
  return String(text || '')
    .split(/\s*[|;]\s*|\n+|(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function findProfessionalIdentityViolations(clause, hasConcrete) {
  if (hasConcrete) return [];
  const violations = [];
  if (/\bi am\b/i.test(clause) && /\b(?:support )?professional\b/i.test(clause)) {
    violations.push('implied-professional-identity');
  }
  if (/\borganized professional\b/i.test(clause)) {
    violations.push('implied-professional-identity');
  }
  return violations;
}

function validateClauseRemainder(clause, evidenceCorpus, hasConcrete, targetPathTitle) {
  const violations = [];
  const { remainder } = maskAuthorizedFutureTargetSpan(clause, targetPathTitle);
  const validationText = remainder.trim();
  if (!validationText) return violations;

  for (const check of LINKEDIN_UPGRADE_CHECKS) {
    if (!check.pattern.test(validationText)) continue;
    if (corpusHasStem(evidenceCorpus, check.evidenceStems)) continue;
    violations.push(check.id);
  }

  if (
    !hasConcrete &&
    COMPETENCE_UPGRADE_PATTERN.test(validationText) &&
    /\b(organization|organiz|coordinat|listen|schedul)/i.test(validationText) &&
    !corpusHasStem(evidenceCorpus, ['strong', 'experienced', 'skilled'])
  ) {
    violations.push('strong-ability-upgrade');
  }

  if (
    !hasConcrete &&
    /\b(?:experienced in|skilled)\b/i.test(validationText) &&
    checkPatternWithoutEvidence(validationText, evidenceCorpus, ['schedul', 'coordinat', 'organiz'])
  ) {
    violations.push('target-concept-as-experience');
  }

  violations.push(...findProfessionalIdentityViolations(validationText, hasConcrete));
  return violations;
}

function linkedInTextBlocks(kitResult) {
  const blocks = [];
  if (kitResult?.linkedinAbout) blocks.push(String(kitResult.linkedinAbout));
  for (const headline of kitResult?.linkedinHeadlines || []) {
    if (headline?.text) blocks.push(String(headline.text));
  }
  return blocks;
}

/** Evidence-aware LinkedIn upgrade violations (empty = valid). */
export function findLinkedInUpgradeViolations(text, gate, targetPathTitle = '') {
  const evidenceCorpus = buildLinkedInEvidenceCorpus(gate);
  const hasConcrete = (gate?.concretePastActions || []).length > 0;
  const violations = [];

  for (const clause of splitLinkedInClauses(String(text || ''))) {
    violations.push(...validateClauseRemainder(clause, evidenceCorpus, hasConcrete, targetPathTitle));
  }

  return [...new Set(violations)];
}

function checkPatternWithoutEvidence(clause, evidenceCorpus, conceptStems) {
  const clauseLower = clause.toLowerCase();
  const mentionsConcept = conceptStems.some((stem) => clauseLower.includes(stem));
  if (!mentionsConcept) return false;
  return !conceptStems.some((stem) => evidenceCorpus.includes(stem));
}

/** Validate all LinkedIn fields in a kit result. */
export function validateLinkedInKit(kitResult, gate, targetPathTitle = '') {
  const violations = [];
  for (const block of linkedInTextBlocks(kitResult)) {
    violations.push(...findLinkedInUpgradeViolations(block, gate, targetPathTitle));
  }
  const unique = [...new Set(violations)];
  return { ok: unique.length === 0, violations: unique };
}

function extractSupportedTraitWords(gate) {
  const traits = (gate?.downstreamStoryItems || [])
    .filter((item) => item.category === 'trait')
    .map((item) => item.source.toLowerCase());
  const words = [];
  const candidates = [
    ['easygoing', 'easygoing'],
    ['understanding', 'understanding'],
    ['attentive', 'attentive'],
    ['approachable', 'approachable'],
    ['patient', 'patient'],
    ['friendly', 'friendly'],
  ];
  for (const [pattern, label] of candidates) {
    if (traits.some((t) => t.includes(pattern))) words.push(label);
  }
  return [...new Set(words)];
}

function isSubstantiveEvidencePhrase(phrase) {
  const normalized = String(phrase || '').trim();
  if (normalized.length < 10) return false;
  if (/^(hi|hello|hey)[.!]?$/i.test(normalized)) return false;
  return true;
}

function extractSupportedAbilityPhrases(gate) {
  return (gate?.downstreamStoryItems || [])
    .filter((item) => item.category === 'self_described_ability')
    .map((item) => item.source.replace(/\.+$/, '').trim())
    .filter(isSubstantiveEvidencePhrase);
}

function pickPrimaryAbilityPhrase(phrases) {
  const substantive = phrases.filter(isSubstantiveEvidencePhrase);
  const preferred = substantive.find((phrase) => /know how|organiz|coordinat|listen/i.test(phrase));
  return preferred || substantive[0] || '';
}

function extractSupportedPreferencePhrases(gate) {
  return (gate?.downstreamStoryItems || [])
    .filter((item) => item.category === 'preference')
    .map((item) => item.source.replace(/\.+$/, '').trim())
    .filter(Boolean);
}

function shortEvidencePhrase(phrase, max = 48) {
  const text = Array.isArray(phrase) ? phrase[0] : phrase;
  if (!text) return '';
  const normalized = String(text).trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1).trim()}…`;
}

function targetPathShortLabel(targetPathTitle) {
  const title = String(targetPathTitle || 'Target Role').trim();
  return title.replace(/\s*\/\s*/g, ' / ').replace(/\s+/g, ' ').trim();
}

function joinHeadlineParts(parts) {
  return parts.filter(Boolean).join(' | ');
}

/** Deterministic evidence-grounded LinkedIn fallback when model output fails validation. */
export function buildFallbackLinkedIn(gate, targetPathTitle = '') {
  const targetShort = targetPathShortLabel(targetPathTitle);
  const traitWords = extractSupportedTraitWords(gate);
  const abilityPhrases = extractSupportedAbilityPhrases(gate);
  const preferencePhrases = extractSupportedPreferencePhrases(gate);
  const abilityShort = shortEvidencePhrase(pickPrimaryAbilityPhrase(abilityPhrases) || abilityPhrases[0], 40);
  const preferenceShort = shortEvidencePhrase(preferencePhrases[0], 40);

  const recruiterParts = [`Building Toward ${targetShort}`];
  if (abilityShort) recruiterParts.push(abilityShort);
  if (preferenceShort) recruiterParts.push(preferenceShort);

  const transitionParts = [`Transitioning into ${targetShort}`];
  if (abilityPhrases.length) {
    transitionParts.push(`Self-Described Strengths: ${abilityShort}`);
  } else if (traitWords.length) {
    transitionParts.push(`Self-Described Qualities: ${traitWords.join(', ')}`);
  }

  const brandParts = [];
  if (traitWords.length) brandParts.push(traitWords.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' & '));
  brandParts.push(`Building Toward ${targetShort}`);

  const aboutParts = [`I'm exploring a move toward ${targetShort}.`];
  if (traitWords.length) {
    aboutParts.push(`I describe myself as ${traitWords.join(' and ')}.`);
  }
  if (preferencePhrases.length) {
    aboutParts.push(`${preferencePhrases[0]}.`);
  }
  for (const phrase of abilityPhrases.slice(0, 2)) {
    aboutParts.push(`${phrase}.`);
  }
  aboutParts.push(
    "I'm continuing to identify concrete examples from my experience that support this direction."
  );

  return {
    linkedinHeadlines: [
      { style: 'Recruiter Search-Focused', text: joinHeadlineParts(recruiterParts) },
      { style: 'Career Transition-Focused', text: joinHeadlineParts(transitionParts) },
      { style: 'Professional Brand-Focused', text: joinHeadlineParts(brandParts) },
    ],
    linkedinAbout: aboutParts.join(' '),
  };
}

/** Ultra-conservative LinkedIn fallback — target direction only. */
export function buildUltraConservativeLinkedIn(gate, targetPathTitle = '') {
  const targetShort = targetPathShortLabel(targetPathTitle);
  return {
    linkedinHeadlines: [
      { style: 'Recruiter Search-Focused', text: `Building Toward ${targetShort}` },
      { style: 'Career Transition-Focused', text: `Transitioning into ${targetShort}` },
      { style: 'Professional Brand-Focused', text: `Building Toward ${targetShort}` },
    ],
    linkedinAbout: `I'm exploring a move toward ${targetShort}. I'm continuing to identify concrete examples from my experience that support this direction.`,
  };
}

function linkedInFieldsFromResult(kitResult, linkedInFields) {
  return {
    linkedinHeadlines: linkedInFields.linkedinHeadlines,
    linkedinAbout: linkedInFields.linkedinAbout,
  };
}

/**
 * Validate LinkedIn output and replace with deterministic fallback when upgrades are detected.
 * Fallback is validated; ultra-conservative fallback used if needed.
 */
export function applyLinkedInGate(kitResult, gate, targetPathTitle = '') {
  if (!kitResult || typeof kitResult !== 'object') return kitResult;

  const validation = validateLinkedInKit(kitResult, gate, targetPathTitle);
  if (validation.ok) return kitResult;

  let fallback = buildFallbackLinkedIn(gate, targetPathTitle);
  if (!validateLinkedInKit(linkedInFieldsFromResult(kitResult, fallback), gate, targetPathTitle).ok) {
    fallback = buildUltraConservativeLinkedIn(gate, targetPathTitle);
  }

  return {
    ...kitResult,
    linkedinHeadlines: fallback.linkedinHeadlines,
    linkedinAbout: fallback.linkedinAbout,
  };
}
