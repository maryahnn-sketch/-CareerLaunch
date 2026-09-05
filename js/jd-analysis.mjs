/**
 * JD Analyzer normalize + validation helpers.
 * Keep prompt/validation rules in sync with index.html analyzeJd() and
 * api/claude-operations.mjs analyzeJd.
 */

const TRAILING_CONFIDENCE_LABEL =
  /\s+\((?:Strong|Moderate|Developing|Needs More Information)\)$/i;

const FIT_ENUM = ['Strong Match', 'Worth Considering', 'Stretch Opportunity', 'Needs More Information'];

export function formatJdRetainedSkillNames(skills = []) {
  return (skills || [])
    .map((skill) => (typeof skill === 'string' ? skill : skill?.name))
    .map((name) => String(name || '').trim())
    .filter(Boolean)
    .join(', ');
}

/** Strip only a trailing strength/confidence label. Keep other parenthetical names. */
export function stripTrailingConfidenceLabel(name) {
  return String(name || '')
    .trim()
    .replace(TRAILING_CONFIDENCE_LABEL, '')
    .trim();
}

export function normalizeYouAlreadyHave(items) {
  if (!Array.isArray(items)) return [];
  return items.map(stripTrailingConfidenceLabel).filter((name) => name.length > 0);
}

export function normalizeJdResult(result) {
  if (!result || typeof result !== 'object') return result;
  return {
    ...result,
    youAlreadyHave: normalizeYouAlreadyHave(result.youAlreadyHave),
  };
}

export function filterToRetainedSkillNames(items, retainedSkillNames = []) {
  const allowed = (retainedSkillNames || []).map((name) => String(name).toLowerCase());
  return (items || []).filter((item) => allowed.includes(String(item).toLowerCase()));
}

/**
 * After confidence-label normalize:
 * - Strong Match requires at least one exact retained skill name.
 * - Worth Considering requires a valid retained name only when the model
 *   already claimed transferable strengths (non-empty youAlreadyHave).
 * Never invents matched skills.
 */
export function validateJdAnalysis(result, retainedSkillNames = []) {
  if (!result || !Array.isArray(result.marketAsks) || result.marketAsks.length === 0) {
    return { ok: false, kind: 'structural', reason: 'marketAsks missing or empty' };
  }
  if (!Array.isArray(result.youAlreadyHave) || !Array.isArray(result.shouldStrengthen)) {
    return { ok: false, kind: 'structural', reason: 'youAlreadyHave/shouldStrengthen must be arrays' };
  }
  if (!FIT_ENUM.includes(result.overallFit)) {
    return { ok: false, kind: 'structural', reason: `invalid overallFit value: ${result.overallFit}` };
  }

  const claimedStrengths = result.youAlreadyHave.some((item) => String(item || '').trim());
  const validHave = filterToRetainedSkillNames(result.youAlreadyHave, retainedSkillNames);

  if (result.overallFit === 'Strong Match' && validHave.length === 0) {
    return {
      ok: false,
      kind: 'semantic',
      reason: 'Strong Match requires at least one retained skill name in youAlreadyHave',
    };
  }

  if (result.overallFit === 'Worth Considering' && claimedStrengths && validHave.length === 0) {
    return {
      ok: false,
      kind: 'semantic',
      reason: 'Worth Considering youAlreadyHave items must be exact retained skill names',
    };
  }

  return { ok: true };
}

export function applyJdYouAlreadyHaveFilter(result, retainedSkillNames = [], rejectedSkillNames = []) {
  if (!result || typeof result !== 'object') return result;
  const rejected = new Set((rejectedSkillNames || []).map((name) => String(name).toLowerCase()));
  const filtered = filterToRetainedSkillNames(result.youAlreadyHave, retainedSkillNames).filter(
    (name) => !rejected.has(String(name).toLowerCase())
  );
  return { ...result, youAlreadyHave: filtered };
}

export const JD_SHOULD_STRENGTHEN_RULE =
  'shouldStrengthen names ONLY the unsupported portion of a posting requirement. If the user already has inventory or order-management evidence but not the software, write a software-only gap such as "ERP or order-management software familiarity" — never "Experience with inventory, ERP, or order-management software". Do not list a retained evidenced capability as missing.';
