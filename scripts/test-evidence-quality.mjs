/**
 * Evidence-quality regression checks for iFindWorth prompts and kit schema.
 * Run: node scripts/test-evidence-quality.mjs
 */

import {
  TOOL_DEFINITIONS,
  getServerSystemPromptForTest,
} from '../api/claude-operations.mjs';

const FIXTURE_A_STORY = `I love taking care of people, I love listening to people, I love getting things done, people reach out to me to fix things, I'm attentive, hardworking, and I like to perfect my work.`;

const FIXTURE_B_STORY = `I worked as a caregiver for my aunt, helped with meals, appointments, medication reminders, and daily routines.`;

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

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
