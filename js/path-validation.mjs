/**
 * Deterministic career-path validation for discovery balance and claim checks.
 * Keep in sync with regression tests in scripts/test-evidence-quality.mjs.
 */

export const MIN_VALID_PATHS = 3;

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

function pathStrengthScore(val) {
  return PATH_STRENGTH_SCORE[val] || 1;
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

/**
 * Filter unsupported claims only. Never invent variety by downgrading paths.
 */
export function enforcePathDiscoveryBalance(paths, storyText, retainedSkills = []) {
  if (!Array.isArray(paths) || paths.length < 2) return paths || [];

  let cleaned = paths.filter((path) => findPathClaimViolations(path).length === 0);
  if (cleaned.length < MIN_VALID_PATHS) cleaned = paths.slice();

  return cleaned;
}

export function validatePathsResult(result, storyText, retainedSkills = []) {
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

  if (result.paths.length < MIN_VALID_PATHS) {
    return {
      ok: false,
      reason: `only ${result.paths.length} valid path(s) found after filtering out malformed items — need at least ${MIN_VALID_PATHS} for a useful set of options`,
    };
  }

  const namedCareers = extractUserNamedCareers(storyText || '');
  const allMatchNamed =
    namedCareers.length > 0 && result.paths.every((path) => pathMatchesNamedCareer(path, namedCareers));

  if (
    allMatchNamed &&
    hasEvidenceSupportedAlternativeDirections(storyText, retainedSkills, namedCareers)
  ) {
    return {
      ok: false,
      reason:
        'paths must include evidence-supported alternatives beyond the career the user already named when retained skills support other occupational families',
    };
  }

  return { ok: true };
}

export function validateRefinePathsResult(result, storyText, retainedSkills = []) {
  const pathCheck = validatePathsResult(result, storyText, retainedSkills);
  if (!pathCheck.ok) return pathCheck;
  if (!result.changeSummary || !String(result.changeSummary).trim()) {
    return { ok: false, reason: 'changeSummary is missing' };
  }
  return { ok: true };
}
