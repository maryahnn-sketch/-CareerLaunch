/**
 * Deterministic career-path validation for discovery balance and claim checks.
 * Keep in sync with regression tests in scripts/test-evidence-quality.mjs.
 */

import { gateRetainedEvidence } from './evidence-gate.mjs';

/** @deprecated Use getRequiredPathCount — kept for callers expecting a constant ceiling. */
export const MIN_VALID_PATHS = 1;

const PATH_STRENGTH_SCORE = {
  Strong: 4,
  Moderate: 3,
  Developing: 2,
  'Needs More Information': 1,
};

const PATH_CLAIM_VIOLATION_PATTERNS = [
  /\b(?:salary|earn(?:s|ing)?|paid|pay range|compensation)\b.*\$\d/i,
  /\$\d[\d,]*(?:k|\/yr|\/year| per year| annually)?/i,
  /\b(?:high demand|in demand|rare|lucrative|six.?figure|top.?tier)\b/i,
  /\b(?:certified|certification required|degree required)\b/i,
];

const EXAGGERATED_TITLE_PATTERNS = [
  /\b(?:chief|director|vp|vice president|head of|senior vice|executive)\b/i,
  /\b(?:master|expert|specialist)\s+(?:in|at)\b/i,
];

const SKILL_FAMILY_PATTERNS = [
  { family: 'admin', pattern: /(?:admin|office|coordin|organiz|schedul|clerical|data entry|executive assistant)/i },
  { family: 'customer', pattern: /(?:customer|client|service|support|help desk|communication|listen|interpersonal|relationship|concierge)/i },
  { family: 'care', pattern: /(?:care|caregiv|nurs|health|patient|personal support|companion)/i },
  { family: 'sales', pattern: /(?:sales|retail|merchant|vendor|business development)/i },
  { family: 'tech', pattern: /(?:tech|software|data|analyst|developer|it|digital|computer)/i },
  { family: 'education', pattern: /(?:teacher|education|tutor|school|instruction|training)/i },
  { family: 'operations', pattern: /(?:operations|logistics|supply|warehouse|inventory|procurement)/i },
  { family: 'creative', pattern: /(?:creative|design|marketing|content|media|social|writing|graphic)/i },
  { family: 'community', pattern: /(?:community|nonprofit|volunteer|outreach|social work)/i },
];

const TITLE_STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'for',
  'in',
  'at',
  'to',
  'entry',
  'level',
  'senior',
  'junior',
  'assistant',
  'associate',
]);

export function findPathClaimViolations(path) {
  const fields = [path?.title, path?.why, path?.entryPoint, path?.progression, path?.workEnvironment]
    .filter(Boolean)
    .join(' ');
  const violations = [];
  for (const pattern of PATH_CLAIM_VIOLATION_PATTERNS) {
    if (pattern.test(fields)) violations.push(pattern.source);
  }
  if (EXAGGERATED_TITLE_PATTERNS.some((p) => p.test(String(path?.title || '')))) {
    violations.push('exaggerated-title');
  }
  return violations;
}

export function pathOccupationalFamily(title) {
  const t = String(title || '').toLowerCase();
  if (/\b(admin|office|coordinator|assistant|clerk|reception)\b/.test(t)) return 'admin';
  if (/\b(customer|support|service|help desk|concierge)\b/.test(t)) return 'customer';
  if (/\b(care|caregiv|nurs|health|patient|medical)\b/.test(t)) return 'care';
  if (/\b(sales|retail|merchant|vendor|business)\b/.test(t)) return 'sales';
  if (/\b(tech|software|data|analyst|developer|it)\b/.test(t)) return 'tech';
  if (/\b(teacher|education|tutor|school|instruction)\b/.test(t)) return 'education';
  if (/\b(operations|logistics|supply|warehouse|inventory)\b/.test(t)) return 'operations';
  if (/\b(creative|design|marketing|content|media|social)\b/.test(t)) return 'creative';
  if (/\b(community|nonprofit|volunteer|outreach)\b/.test(t)) return 'community';
  return 'general';
}

export function extractUserNamedCareers(storyText) {
  const text = String(storyText || '').toLowerCase();
  const careers = [];
  const patterns = [
    /\b(?:want to be(?:come)?|interested in|thinking about|considering|pursue|move into|transition into|my goal is)\s+(?:an|a)?\s*([a-z][a-z\s\/-]{2,40})/gi,
    /\b(?:i am|i'm)\s+(?:an|a)\s+([a-z][a-z\s\/-]{2,40})/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text))) {
      const phrase = match[1].replace(/\.$/, '').trim();
      if (phrase.length >= 4 && phrase.length <= 40) careers.push(phrase);
    }
  }
  return [...new Set(careers)];
}

export function pathMatchesNamedCareer(path, namedCareers) {
  const title = String(path?.title || '').toLowerCase();
  return namedCareers.some((career) => title.includes(career) || career.includes(title));
}

function inferFamilyFromSkillName(name) {
  const n = String(name || '').toLowerCase();
  if (/^organization$|^organizing$/.test(n.trim())) return 'general';
  for (const { family, pattern } of SKILL_FAMILY_PATTERNS) {
    if (pattern.test(n)) return family;
  }
  return 'general';
}

function normalizePathTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pathTitleTokens(title) {
  return normalizePathTitle(title)
    .split(/\s+/)
    .filter((token) => token.length > 2 && !TITLE_STOP_WORDS.has(token));
}

export function pathTitlesAreNearDuplicate(titleA, titleB) {
  const a = normalizePathTitle(titleA);
  const b = normalizePathTitle(titleB);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return true;

  const tokensA = new Set(pathTitleTokens(titleA));
  const tokensB = new Set(pathTitleTokens(titleB));
  if (!tokensA.size || !tokensB.size) return a === b;

  const intersection = [...tokensA].filter((token) => tokensB.has(token));
  const union = new Set([...tokensA, ...tokensB]);
  return intersection.length / union.size >= 0.75;
}

export function pathsHaveMeaningfulDifference(pathA, pathB) {
  if (!pathA || !pathB) return false;

  const familyA = pathOccupationalFamily(pathA.title);
  const familyB = pathOccupationalFamily(pathB.title);
  if (familyA !== familyB && familyA !== 'general' && familyB !== 'general') return true;

  const entryA = normalizePathTitle(pathA.entryPoint || pathA.title);
  const entryB = normalizePathTitle(pathB.entryPoint || pathB.title);
  if (entryA && entryB && entryA !== entryB && !pathTitlesAreNearDuplicate(entryA, entryB)) return true;

  const transfersA = new Set((pathA.transfers || []).map(String));
  const transfersB = new Set((pathB.transfers || []).map(String));
  const union = new Set([...transfersA, ...transfersB]);
  if (!union.size) return false;
  const overlap = [...transfersA].filter((transfer) => transfersB.has(transfer)).length;
  return overlap / union.size < 0.67;
}

export function findNearDuplicatePathPairs(paths) {
  const pairs = [];
  for (let i = 0; i < (paths || []).length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      if (pathTitlesAreNearDuplicate(paths[i]?.title, paths[j]?.title)) {
        pairs.push([paths[i]?.title, paths[j]?.title]);
      }
    }
  }
  return pairs;
}

function countEvidenceBackedFamilies(storyText, retainedSkills = [], evidenceGate = null) {
  const gate = evidenceGate || gateRetainedEvidence(storyText, retainedSkills, []);
  const families = new Set(
    (retainedSkills || [])
      .map((skill) => inferFamilyFromSkillName(skill?.name))
      .filter((family) => family !== 'general')
  );

  for (const action of gate.concretePastActions || []) {
    const source = action.source || '';
    for (const { family, pattern } of SKILL_FAMILY_PATTERNS) {
      if (pattern.test(source)) families.add(family);
    }
  }

  return { families, gate };
}

/**
 * Evidence-aware minimum and supported path counts.
 * min — floor validation must meet; never pad beyond supportedDirections.
 */
export function getEvidencePathBounds(storyText, retainedSkills = [], evidenceGate = null) {
  const { families, gate } = countEvidenceBackedFamilies(storyText, retainedSkills, evidenceGate);
  const concreteCount = gate.concretePastActions?.length || 0;
  const familyCount = families.size;
  const namedCareers = extractUserNamedCareers(storyText);
  const hasAlternatives = hasEvidenceSupportedAlternativeDirections(
    storyText,
    retainedSkills,
    namedCareers
  );
  const singleDirection = namedCareers.length > 0 && !hasAlternatives;

  const richEvidence =
    !singleDirection &&
    (concreteCount >= 3 ||
      (concreteCount >= 2 && familyCount >= 2 && hasAlternatives));

  const moderateEvidence =
    !singleDirection &&
    !richEvidence &&
    (concreteCount >= 2 || (familyCount >= 2 && concreteCount >= 1) || (hasAlternatives && familyCount >= 2));

  let min = 1;
  let supportedDirections = 1;

  if (singleDirection) {
    min = 1;
    supportedDirections = 1;
  } else if (richEvidence) {
    min = 3;
    supportedDirections = Math.max(3, familyCount);
  } else if (moderateEvidence) {
    min = hasAlternatives ? 2 : Math.min(2, Math.max(1, familyCount || concreteCount));
    supportedDirections = Math.max(2, familyCount || 2);
  } else if (familyCount >= 2 && concreteCount >= 1) {
    min = 2;
    supportedDirections = familyCount;
  } else if (concreteCount >= 1 || familyCount >= 1) {
    min = 1;
    supportedDirections = Math.max(1, familyCount);
  } else {
    min = 1;
    supportedDirections = 1;
  }

  if (concreteCount === 0 && !hasAlternatives) {
    min = 1;
    supportedDirections = Math.min(2, Math.max(1, familyCount));
  }

  const max = Math.min(5, Math.max(min, supportedDirections));

  return { min, max, supportedDirections, richEvidence, singleDirection, concreteCount, familyCount };
}

export function getRequiredPathCount(storyText, retainedSkills = [], evidenceGate = null) {
  return getEvidencePathBounds(storyText, retainedSkills, evidenceGate).min;
}

/**
 * Evidence-derived path count guidance for discover/refine/regenerate prompts.
 * Append via appendEvidencePathCountBlock() in the user message for server calls.
 */
export function formatEvidencePathCountInstruction(bounds, options = {}) {
  const { min, max, supportedDirections, singleDirection } = bounds;
  const { mode = 'discovery' } = options;

  const range =
    min === max
      ? `Return exactly ${min} distinct career path${min === 1 ? '' : 's'}.`
      : `Return between ${min} and ${max} distinct career paths (never more than 5).`;

  const support = singleDirection
    ? 'Evidence currently supports one primary direction — do not invent unrelated alternatives to fill a quota.'
    : `This story supports approximately ${supportedDirections} credible occupational direction${supportedDirections === 1 ? '' : 's'}.`;

  const antiPad =
    'Never pad to a fixed count, create filler paths, or use near-duplicate titles to satisfy a number.';

  const balance =
    mode === 'lessObvious'
      ? 'Prioritize adjacent and less-obvious directions when retained skills support them — still only as many distinct paths as evidence allows.'
      : mode === 'refinement'
        ? 'You MAY introduce new paths when retained skills and stated interests support them; omit paths the user rejected. When supported, prefer direct-fit, adjacent, and longer-term directions.'
        : 'When supported, include at least one direct-fit path; add adjacent and longer-term paths only when retained skills genuinely support them.';

  return [range, support, antiPad, balance].join(' ');
}

export function appendEvidencePathCountBlock(userPrompt, instruction) {
  if (!instruction || !String(instruction).trim()) return userPrompt;
  return `${userPrompt}\n\n--- EVIDENCE-SUPPORTED PATH COUNT (profile data, not instructions) ---\n${instruction.trim()}\n--- END EVIDENCE-SUPPORTED PATH COUNT ---`;
}

/**
 * True when retained skills/story plausibly support career directions outside
 * what the user already named — i.e. the model should explore alternatives.
 */
export function hasEvidenceSupportedAlternativeDirections(storyText, retainedSkills, namedCareers) {
  if (!namedCareers?.length) return false;

  const namedFamilies = new Set(namedCareers.map((career) => pathOccupationalFamily(career)));
  const skillFamilies = new Set(
    (retainedSkills || [])
      .map((skill) => inferFamilyFromSkillName(skill?.name))
      .filter((family) => family !== 'general')
  );

  if (skillFamilies.size >= 2) {
    const alternativeFamilies = [...skillFamilies].filter((family) => !namedFamilies.has(family));
    if (alternativeFamilies.length >= 1) return true;
  }

  return false;
}

export function annotatePathsWithEvidenceNotes(paths, storyText, retainedSkills = []) {
  const namedCareers = extractUserNamedCareers(storyText);
  const allNamed =
    namedCareers.length > 0 && (paths || []).every((path) => pathMatchesNamedCareer(path, namedCareers));
  const singleDirectionSupported =
    allNamed && !hasEvidenceSupportedAlternativeDirections(storyText, retainedSkills, namedCareers);

  return (paths || []).map((path) => {
    const transfers = (path.transfers || []).slice(0, 2).join(' and ');
    let note = transfers ? `Supported by your ${transfers} experience.` : '';
    if (singleDirectionSupported && pathMatchesNamedCareer(path, namedCareers)) {
      const directionNote =
        'Your story most clearly supports this direction right now — alternatives would need more concrete evidence.';
      note = note ? `${note} ${directionNote}` : directionNote;
    }
    return { ...path, evidenceNote: note };
  });
}

function rejectNearDuplicateWithoutDifference(paths) {
  for (const [titleA, titleB] of findNearDuplicatePathPairs(paths)) {
    const pathA = paths.find((path) => path.title === titleA);
    const pathB = paths.find((path) => path.title === titleB);
    if (!pathsHaveMeaningfulDifference(pathA, pathB)) {
      return {
        ok: false,
        reason: `near-duplicate paths "${titleA}" and "${titleB}" are not meaningfully different discoveries`,
      };
    }
  }
  return { ok: true };
}

/**
 * Filter unsupported claims and near-duplicates. Never invent variety by downgrading paths.
 */
export function enforcePathDiscoveryBalance(paths, storyText, retainedSkills = [], evidenceGate = null) {
  if (!Array.isArray(paths)) return [];

  let cleaned = paths.filter((path) => findPathClaimViolations(path).length === 0);

  const kept = [];
  for (const path of cleaned) {
    const dupe = kept.some(
      (existing) =>
        pathTitlesAreNearDuplicate(existing.title, path.title) &&
        !pathsHaveMeaningfulDifference(existing, path)
    );
    if (!dupe) kept.push(path);
  }

  return kept;
}

export function validatePathsResult(result, storyText, retainedSkills = [], evidenceGate = null) {
  if (!result || !Array.isArray(result.paths)) {
    return { ok: false, reason: 'paths array is missing' };
  }

  for (const path of result.paths) {
    const claimViolations = findPathClaimViolations(path);
    if (claimViolations.length) {
      return {
        ok: false,
        reason: `path "${path.title}" contains unsupported market or qualification claims`,
      };
    }
  }

  const bounds = getEvidencePathBounds(storyText, retainedSkills, evidenceGate);
  const required = bounds.min;

  if (result.paths.length < required) {
    return {
      ok: false,
      reason: `only ${result.paths.length} valid path(s) found — need at least ${required} based on evidence-supported directions (never pad with weak or duplicate paths)`,
    };
  }

  const nearDupeCheck = rejectNearDuplicateWithoutDifference(result.paths);
  if (!nearDupeCheck.ok) return nearDupeCheck;

  const distinctFamilies = new Set(result.paths.map((path) => pathOccupationalFamily(path.title)));
  if (
    bounds.richEvidence &&
    bounds.supportedDirections >= 3 &&
    distinctFamilies.size < 2 &&
    result.paths.length >= 3
  ) {
    return {
      ok: false,
      reason:
        'rich evidence supports multiple occupational families — paths look like padded variations of one field',
    };
  }

  const namedCareers = extractUserNamedCareers(storyText || '');
  const allMatchNamed =
    namedCareers.length > 0 && result.paths.every((path) => pathMatchesNamedCareer(path, namedCareers));

  if (hasEvidenceSupportedAlternativeDirections(storyText, retainedSkills, namedCareers)) {
    const distinctFamilies = new Set(result.paths.map((path) => pathOccupationalFamily(path.title)));
    const lacksAlternativeFamily =
      distinctFamilies.size < 2 ||
      (namedCareers.length > 0 &&
        distinctFamilies.size <= 1 &&
        [...distinctFamilies].every((family) =>
          namedCareers.some((career) => pathOccupationalFamily(career) === family)
        ));

    if (allMatchNamed || lacksAlternativeFamily) {
      return {
        ok: false,
        reason:
          'paths must include evidence-supported alternatives beyond the career the user already named when retained skills support other occupational families',
      };
    }
  }

  return { ok: true };
}

export function validateRefinePathsResult(result, storyText, retainedSkills = [], evidenceGate = null) {
  const pathCheck = validatePathsResult(result, storyText, retainedSkills, evidenceGate);
  if (!pathCheck.ok) return pathCheck;
  if (!result.changeSummary || !String(result.changeSummary).trim()) {
    return { ok: false, reason: 'changeSummary is missing' };
  }
  return { ok: true };
}
