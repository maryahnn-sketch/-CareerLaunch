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
  /\b(i am|i'm a|i'm very|very easygoing|easygoing person|understanding|approachable|adaptable|hardworking|attentive|reliable|caring|empathetic|patient)\b/i;

const LISTEN_AS_ABILITY =
  /\b(listen to people|listening to people|active listening|i listen)\b/i;

const PAST_ACTION_VERB =
  /\bi\s+(?:organized|scheduled|managed|coordinated|led|trained|helped|answered|fixed|completed|handled|volunteered|worked|served|created|built|developed|implemented|processed|prepared|maintained|facilitated|supervised|resolved|delivered|provided|assisted|supported|taught|planned|executed|ran|designed|wrote|cooked|drove|stocked|cleaned|filed|updated|tracked|monitored|reviewed|edited|researched|presented|mentored|sold|packaged|shipped|assembled|installed|repaired|tested|drafted|published|hosted|greeted|booked|registered|enrolled|studied|performed|directed|produced|collaborated|moved|started|began|initiated|established|founded|constructed|manufactured|stocked|inventoried|restocked|reordered|balanced|counted|entered|transcribed|translated|interpreted|mediated|examined|diagnosed|treated|administered|measured|mixed|baked|grilled|fried|reserved|enrolled|graduated|practiced|auditioned|toured|relocated|voted|campaigned|canvassed|petitioned|lobbied|testified|declared|communicated|partnered|contracted|automated|converted|transformed|transferred|switched|changed|modified|adjusted|adapted|customized|standardized|operationalized|launched|opened|closed|commenced|instituted|formed|forged|cast|molded|shaped|sculpted|carved|welded|soldered|riveted|bolted|screwed|nailed|glued|attached|fastened|secured|anchored|parked|stored|warehoused|replenished|refilled|resupplied|reordered|acquired|obtained|procured|sourced|supplied|mailed|posted|sent|transmitted|broadcast|released|debuted|premiered)\b/i;

const WORK_CONTEXT =
  /\b(worked as a|served as a|volunteered at|interned at|employed as|for my (?:manager|team|boss|aunt|church|school)|helped (?:my|with)|helped my)\b/i;

const REACH_OUT_FIX = /\bpeople reach out to me\b/i;

const CARE_CONTEXT =
  /\b(medication reminders|daily routines|meals and appointments|caregiver for)\b/i;

function stripYouDescribed(text) {
  return String(text || '')
    .trim()
    .replace(/^you described\s*/i, '')
    .replace(/\.$/, '')
    .trim();
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

/** Classify one evidence statement into an evidence category. */
export function classifyEvidenceText(text) {
  const raw = String(text || '').trim();
  if (!raw) return 'trait';

  const t = stripYouDescribed(raw);

  if (ASPIRATION.test(t)) return 'aspiration';

  if (ABILITY_WRAPPER.test(t)) return 'self_described_ability';

  if (LISTEN_AS_ABILITY.test(t)) return 'self_described_ability';

  if (PREFERENCE.test(t)) return 'preference';

  if (hasConcretePastAction(t)) return 'concrete_past_action';

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

function dedupeItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.category}::${item.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Classify story + retained skill evidence and determine resume-bullet eligibility.
 */
export function gateRetainedEvidence(storyText, retainedSkills = []) {
  const items = [];

  for (const sentence of splitSentences(storyText)) {
    items.push({
      source: sentence,
      category: classifyEvidenceText(sentence),
      origin: 'story',
    });
  }

  for (const skill of retainedSkills) {
    items.push({
      source: skill.evidence,
      category: classifyEvidenceText(skill.evidence),
      origin: 'skill',
      skillName: skill.name,
    });
  }

  const deduped = dedupeItems(items);
  const concretePastActions = deduped.filter((i) => i.category === 'concrete_past_action');

  return {
    items: deduped,
    concretePastActions,
    allowResumeBullets: concretePastActions.length > 0,
  };
}

/** Force empty resume bullets when the gate disallows them — model output cannot override. */
export function applyResumeBulletGate(kitResult, gate) {
  if (!kitResult || typeof kitResult !== 'object') return kitResult;
  if (gate && !gate.allowResumeBullets) {
    return { ...kitResult, resumeBullets: [] };
  }
  return kitResult;
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
