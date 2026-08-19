/**
 * Evidence-quality regression checks for iFindWorth prompts and kit schema.
 * Run: node scripts/test-evidence-quality.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  TOOL_DEFINITIONS,
  getServerSystemPromptForTest,
} from '../api/claude-operations.mjs';
import {
  getConfirmedSkills,
  getRetainedStorySkills,
  getUnconfirmedStorySkills,
  getRejectedSkillNames,
  skillValidationAfterContinue,
  dashboardConfirmedSkillNames,
} from './skill-state.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = readFileSync(join(__dirname, '../index.html'), 'utf8');

const FIXTURE_SKILLS = [
  { name: 'Active listening', strength: 'Strong', evidence: 'You described listening carefully.' },
  { name: 'Organization', strength: 'Moderate', evidence: 'You described keeping things on track.' },
  { name: 'Problem solving', strength: 'Developing', evidence: 'You described fixing things for people.' },
  { name: 'Rejected skill', strength: 'Moderate', evidence: 'You described something else.' },
];

const FIXTURE_B_STORY = `I worked as a caregiver for my aunt, helped with meals, appointments, medication reminders, and daily routines.`;

const FIXTURE_A_STORY = `I love taking care of people, I love listening to people, I love getting things done, people reach out to me to fix things, I'm attentive, hardworking, and I like to perfect my work.`;

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`PASS ${label}`);
    passed += 1;
    return true;
  }
  console.log(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  failed += 1;
  return false;
}

function promptIncludesAll(prompt, phrases, label) {
  for (const phrase of phrases) {
    if (!prompt.includes(phrase)) {
      assert(label, false, `missing "${phrase}"`);
      return false;
    }
  }
  assert(label, true);
  return true;
}

function main() {
  const kitPrompt = getServerSystemPromptForTest('buildKit');
  const discoverPrompt = getServerSystemPromptForTest('discoverPaths');
  const refinePrompt = getServerSystemPromptForTest('refinePaths');
  const foundationPrompt = getServerSystemPromptForTest('buildRoadmapFoundation');
  const actionPlanPrompt = getServerSystemPromptForTest('buildRoadmapActionPlan');
  const kitSchema = TOOL_DEFINITIONS.report_application_kit.input_schema.properties.resumeBullets;

  promptIncludesAll(kitPrompt, [
    'WHAT I HAVE DONE',
    'return zero resume bullets',
    'provided personal care',
    'clearly distinguish existing qualities/experience',
  ], 'buildKit prompt enforces past-evidence boundary');

  promptIncludesAll(discoverPrompt, [
    'meaningfully different occupational/function families',
    'NOT evidence of healthcare or professional caregiving experience',
    'never be upgraded into experience fit',
  ], 'discoverPaths prompt enforces career diversity');

  promptIncludesAll(refinePrompt, [
    'meaningfully different occupational/function families',
    'NOT evidence of healthcare or professional caregiving experience',
  ], 'refinePaths prompt enforces career diversity');

  promptIncludesAll(foundationPrompt, [
    'hands-on personal support experience',
    'concrete things they HAVE done',
  ], 'buildRoadmapFoundation prompt blocks aspirational past claims');

  promptIncludesAll(actionPlanPrompt, [
    'Check whether this role requires certification',
    'Never assign certification completion to a fixed 30/60/90-day window',
  ], 'buildRoadmapActionPlan prompt keeps certification conditional');

  assert(
    'application kit schema allows zero resume bullets',
    kitSchema.minItems === 0 && kitSchema.maxItems === 4
  );

  assert(
    'Fixture A is preference-heavy without professional caregiving duties',
    FIXTURE_A_STORY.includes('love taking care of people') &&
      !/\bcaregiver\b/i.test(FIXTURE_A_STORY) &&
      !/\bpatient/i.test(FIXTURE_A_STORY)
  );

  assert(
    'Fixture B contains explicit caregiving work evidence',
    FIXTURE_B_STORY.includes('caregiver') &&
      FIXTURE_B_STORY.includes('medication reminders')
  );

  assert(
    'Fixture A prompts forbid upgrading care preferences into past care work',
    kitPrompt.includes('Never write bullets that describe target-role duties, caregiving/client/patient support')
  );

  assert(
    'Fixture B is not blocked by diversity rule (caregiving may appear when evidenced)',
    !discoverPrompt.includes('never include caregiving') &&
      discoverPrompt.includes('do not manufacture unrelated careers for diversity alone')
  );

  // --- Skill confirmation state semantics (deterministic; not live-AI tests) ---

  assert(
    'index.html does not auto-confirm skills on continue (acceptPendingSkills removed)',
    !INDEX_HTML.includes('acceptPendingSkills')
  );

  assert(
    'toPaths handler does not mutate skillValidation before discoverPaths',
    /toPaths\)\.addEventListener\('click', \(\)=>\{\s*discoverPaths\(\);\s*\}\)/.test(INDEX_HTML)
  );

  const beforeValidation = {
    'Active listening': 'yes',
    Organization: undefined,
    'Problem solving': undefined,
    'Rejected skill': 'no',
  };
  const afterContinue = skillValidationAfterContinue(beforeValidation);

  assert(
    'continuing from skills screen does not convert undefined skills to yes',
    afterContinue.Organization === undefined && afterContinue['Problem solving'] === undefined
  );
  assert('explicit yes remains yes after continue', afterContinue['Active listening'] === 'yes');
  assert('explicit no remains no after continue', afterContinue['Rejected skill'] === 'no');

  const retained = getRetainedStorySkills(FIXTURE_SKILLS, beforeValidation);
  assert(
    'retainedStorySkills includes yes and undefined but excludes no',
    retained.length === 3 &&
      retained.some((s) => s.name === 'Active listening') &&
      retained.some((s) => s.name === 'Organization') &&
      retained.some((s) => s.name === 'Problem solving') &&
      !retained.some((s) => s.name === 'Rejected skill')
  );

  const confirmed = getConfirmedSkills(FIXTURE_SKILLS, beforeValidation);
  assert(
    'confirmedSkills includes yes only',
    confirmed.length === 1 && confirmed[0].name === 'Active listening'
  );

  const unconfirmed = getUnconfirmedStorySkills(FIXTURE_SKILLS, beforeValidation);
  assert(
    'unconfirmedStorySkills excludes yes and no',
    unconfirmed.length === 2 &&
      unconfirmed.every((s) => s.name === 'Organization' || s.name === 'Problem solving')
  );

  assert(
    'rejectedSkills lists explicit no only',
    getRejectedSkillNames(FIXTURE_SKILLS, beforeValidation).join(',') === 'Rejected skill'
  );

  const moderateConfirmedValidation = {
    'Active listening': undefined,
    Organization: 'yes',
    'Problem solving': undefined,
    'Rejected skill': 'no',
  };
  assert(
    'confirmed Moderate/Developing skill appears in dashboard confirmed group',
    dashboardConfirmedSkillNames(FIXTURE_SKILLS, moderateConfirmedValidation).includes('Organization')
  );

  const storyBankPrompt = getServerSystemPromptForTest('buildStoryBank');
  const jdPrompt = getServerSystemPromptForTest('analyzeJd');

  assert(
    'buildKit server prompt does not claim unconfirmed retained skills were user-accepted',
    !kitPrompt.includes('user accepted') && kitPrompt.includes('Retained story skills')
  );
  assert(
    'discoverPaths server prompt uses retained story skills terminology',
    discoverPrompt.includes('Retained story skills') && !discoverPrompt.includes('Validated skills')
  );
  assert(
    'buildStoryBank server prompt uses story-supported evidence wording',
    storyBankPrompt.includes('story-supported') && storyBankPrompt.includes('Retained story skills')
  );
  assert(
    'analyzeJd server prompt uses retained story skills terminology',
    jdPrompt.includes('Retained story skills') && !jdPrompt.includes('validated skills')
  );

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
