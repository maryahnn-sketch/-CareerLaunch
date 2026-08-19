/**
 * Pure skill confirmation state helpers — shared by regression tests.
 * Mirrors index.html semantics: yes = explicit confirm, no = explicit reject,
 * undefined = unreviewed (retained for story evidence unless rejected).
 */

export function getConfirmedSkills(skills, skillValidation) {
  return skills.filter((s) => skillValidation[s.name] === 'yes');
}

export function getRetainedStorySkills(skills, skillValidation) {
  return skills.filter((s) => skillValidation[s.name] !== 'no');
}

export function getUnconfirmedStorySkills(skills, skillValidation) {
  return skills.filter(
    (s) => skillValidation[s.name] !== 'yes' && skillValidation[s.name] !== 'no'
  );
}

export function getRejectedSkillNames(skills, skillValidation) {
  return skills.filter((s) => skillValidation[s.name] === 'no').map((s) => s.name);
}

/** Continue / Explore Career Paths must not mutate skillValidation. */
export function skillValidationAfterContinue(skillValidation) {
  return { ...skillValidation };
}

export function dashboardConfirmedSkillNames(skills, skillValidation) {
  return getConfirmedSkills(skills, skillValidation).map((s) => s.name);
}
