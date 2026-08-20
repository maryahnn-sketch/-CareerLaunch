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
  classifyEvidenceText,
  classifyStoryClauses,
  gateRetainedEvidence,
  applyResumeBulletGate,
  validateResumeBulletSources,
  buildPathPromptStoryContext,
  formatEvidenceGateForRoadmapPrompt,
  formatEvidenceGateForPrompt,
  formatLinkedInEvidenceContext,
  findLinkedInUpgradeViolations,
  validateLinkedInKit,
  applyLinkedInGate,
  buildFallbackLinkedIn,
  buildUltraConservativeLinkedIn,
  buildLinkedInEvidenceCorpus,
} from './evidence-gate.mjs';
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

const FIXTURE_C_STORY = `Hi, I'm a very easygoing person. I like taking care of people and socializing. I'm very understanding, I care about people, and I listen to people. I know how to organize things and I know how to coordinate things.`;

const FIXTURE_C_SKILLS = [
  { name: 'Active Listening', strength: 'Moderate', evidence: 'You described listening to people and being understanding.' },
  { name: 'Socialization & Relationship Building', strength: 'Moderate', evidence: 'You described liking to socialize and take care of people.' },
  { name: 'Organization & Coordination', strength: 'Moderate', evidence: 'You described knowing how to organize and coordinate things.' },
  { name: 'Adaptability & Approachability', strength: 'Moderate', evidence: 'You described being easygoing.' },
];

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

function findClause(clauses, pattern) {
  return clauses.find((c) => pattern.test(c.source));
}

function assertMixedClauseStory(label, story, expectations) {
  const clauses = classifyStoryClauses(story);
  for (const { pattern, category } of expectations) {
    const clause = findClause(clauses, pattern);
    if (!clause || clause.category !== category) {
      assert(
        label,
        false,
        `expected ${category} for ${pattern}; got ${clause ? clause.category : 'missing'} (${JSON.stringify(clauses.map((c) => c.source))})`
      );
      return false;
    }
  }
  assert(label, true);
  return true;
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
  const directionPrompt = getServerSystemPromptForTest('buildRoadmapDirection');
  const kitSchema = TOOL_DEFINITIONS.report_application_kit.input_schema.properties.resumeBullets;

  promptIncludesAll(kitPrompt, [
    'WHAT I HAVE DONE',
    'return zero resume bullets',
    'provided personal care',
    'clearly distinguish existing qualities/experience',
  ], 'buildKit prompt enforces past-evidence boundary');

  promptIncludesAll(kitPrompt, [
    'CONCRETE PAST ACTION EVIDENCE',
    'NOT sufficient alone for a resume bullet',
    'Do NOT infer outcomes',
    'Do NOT universalize traits',
    'self-described qualities',
    'stated preferences/dislikes',
  ], 'buildKit prompt distinguishes action evidence from traits/preferences/outcomes');

  assert(
    'buildKit prompt allows zero bullets for trait-only stories (Fixture A)',
    kitPrompt.includes('return zero resume bullets') &&
      kitPrompt.includes('I am hardworking') &&
      kitPrompt.includes('I like to perfect my work') &&
      kitPrompt.includes('people reach out to me to fix things')
  );

  assert(
    'buildKit prompt forbids upgrading traits into invented performance bullets',
    kitPrompt.includes('delivered polished outcomes') &&
      kitPrompt.includes('in every responsibility undertaken') &&
      kitPrompt.includes('consistently responding with follow-through')
  );

  assert(
    'buildKit prompt prefers strengthen questions over fabricated bullets from traits',
    kitPrompt.includes('strengthen') && kitPrompt.includes('Which task showed your attentiveness')
  );

  assert(
    'buildKit prompt avoids people-heavy headlines when preferences conflict',
    kitPrompt.includes('People-Focused Professional') &&
      kitPrompt.includes('high people interaction')
  );

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
    'Self-described vs demonstrated evidence',
    'demonstrated strengths',
  ], 'buildRoadmapFoundation prompt blocks self-described upgrades');

  promptIncludesAll(actionPlanPrompt, [
    'Check whether this role requires certification',
    'Never assign certification completion to a fixed 30/60/90-day window',
    'List daily tasks you already handle',
  ], 'buildRoadmapActionPlan prompt uses conditional language for unproven tasks');

  promptIncludesAll(directionPrompt, [
    'Self-described vs demonstrated evidence',
    'demonstrated strengths',
    'concrete_past_action',
  ], 'buildRoadmapDirection prompt blocks self-described upgrades');

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
    kitPrompt.includes('provided personal care') &&
      kitPrompt.includes('performed caregiving responsibilities')
  );

  assert(
    'Fixture A is trait/preference-heavy with one narrow action phrase only',
    FIXTURE_A_STORY.includes('people reach out to me to fix things') &&
      FIXTURE_A_STORY.includes('hardworking') &&
      !/\banswered\b/i.test(FIXTURE_A_STORY) &&
      !/\bscheduled\b/i.test(FIXTURE_A_STORY)
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
    /toPaths.*addEventListener\('click', \(\)=>\{\s*discoverPaths\(\);\s*\}\)/.test(INDEX_HTML)
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
    !kitPrompt.includes('user accepted') && kitPrompt.includes('self_described_ability')
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

  assert(
    'buildKit prompt references application evidence gate',
    kitPrompt.includes('Application evidence gate rule') &&
      kitPrompt.includes('concrete_past_action')
  );

  assert(
    'buildKit prompt applies LinkedIn evidence-category discipline',
    kitPrompt.includes('preserve evidence categories') &&
      kitPrompt.includes('self_described_ability') &&
      kitPrompt.includes('scheduling') &&
      kitPrompt.includes('Building toward')
  );

  // --- Evidence gate (deterministic classifier; not live-AI tests) ---

  assert(
    '"I know how to organize things" classifies as self_described_ability',
    classifyEvidenceText('I know how to organize things and I know how to coordinate things.') ===
      'self_described_ability'
  );
  assert(
    '"I am hardworking" classifies as trait',
    classifyEvidenceText('I am hardworking.') === 'trait'
  );
  assert(
    '"I prefer remote work" classifies as preference',
    classifyEvidenceText('I prefer remote work.') === 'preference'
  );
  assert(
    '"I want to become an Operations Coordinator" classifies as aspiration',
    classifyEvidenceText('I want to become an Operations Coordinator.') === 'aspiration'
  );
  assert(
    '"I organized my church fundraiser" classifies as concrete_past_action',
    classifyEvidenceText('I organized my church fundraiser.') === 'concrete_past_action'
  );
  assert(
    '"I scheduled appointments for my manager" classifies as concrete_past_action',
    classifyEvidenceText('I scheduled appointments for my manager.') === 'concrete_past_action'
  );

  assertMixedClauseStory(
    'mixed clause: preference + concrete organizing',
    'I love organizing, and I organized our church fundraiser.',
    [
      { pattern: /love organizing/i, category: 'preference' },
      { pattern: /organized our church fundraiser/i, category: 'concrete_past_action' },
    ]
  );

  assertMixedClauseStory(
    'mixed clause: listening preference + reach-out concrete action',
    'I love listening to people, but people reach out to me to fix things.',
    [
      { pattern: /love listening/i, category: 'preference' },
      { pattern: /reach out to me/i, category: 'concrete_past_action' },
    ]
  );

  assertMixedClauseStory(
    'mixed clause: self-described ability + scheduled concrete action',
    'I know how to coordinate things, and I scheduled appointments for my manager.',
    [
      { pattern: /know how to coordinate/i, category: 'self_described_ability' },
      { pattern: /scheduled appointments for my manager/i, category: 'concrete_past_action' },
    ]
  );

  assertMixedClauseStory(
    'no-comma mixed clause: preference + concrete organizing',
    'I love organizing and I organized our church fundraiser.',
    [
      { pattern: /love organizing/i, category: 'preference' },
      { pattern: /organized our church fundraiser/i, category: 'concrete_past_action' },
    ]
  );

  assertMixedClauseStory(
    'no-comma mixed clause: listening preference + reach-out concrete action',
    'I love listening to people but people reach out to me to fix things.',
    [
      { pattern: /love listening/i, category: 'preference' },
      { pattern: /reach out to me/i, category: 'concrete_past_action' },
    ]
  );

  assertMixedClauseStory(
    'no-comma mixed clause: self-described ability + scheduled concrete action',
    'I know how to coordinate things and I scheduled appointments for my manager.',
    [
      { pattern: /know how to coordinate/i, category: 'self_described_ability' },
      { pattern: /scheduled appointments for my manager/i, category: 'concrete_past_action' },
    ]
  );

  assert(
    'compound verb phrase does not split on bare and',
    classifyStoryClauses('I organized and coordinated the fundraiser.').length === 1 &&
      classifyStoryClauses('I organized and coordinated the fundraiser.')[0].category ===
        'concrete_past_action'
  );

  const fixtureCGate = gateRetainedEvidence(FIXTURE_C_STORY, FIXTURE_C_SKILLS);
  assert(
    'Fixture C evidence gate identifies ZERO concrete past actions',
    fixtureCGate.concretePastActions.length === 0 && !fixtureCGate.allowResumeBullets
  );

  const gatedKit = applyResumeBulletGate(
    {
      resumeBullets: [
        { text: 'Applied organizational skills to manage and coordinate tasks efficiently.' },
        { text: 'Leveraged active listening to understand needs and communicate effectively.' },
      ],
      linkedinHeadlines: [{ style: 'x', text: 'y' }, { style: 'x', text: 'y' }, { style: 'x', text: 'y' }],
      linkedinAbout: 'About',
    },
    fixtureCGate
  );
  assert(
    'Fixture C application kit is forced to resumeBullets: [] after gate',
    Array.isArray(gatedKit.resumeBullets) && gatedKit.resumeBullets.length === 0
  );

  const fixtureAGate = gateRetainedEvidence(FIXTURE_A_STORY, []);
  assert(
    'Fixture A gate extracts reach-out clause as concrete_past_action',
    fixtureAGate.concretePastActions.some((i) => /reach out to me/i.test(i.source))
  );
  assert(
    'Fixture A gate keeps listening clause non-concrete',
    fixtureAGate.items.some((i) => /listening to people/i.test(i.source) && i.category !== 'concrete_past_action')
  );

  const singleActionGate = gateRetainedEvidence('I organized my church fundraiser.', []);
  const perBulletKit = applyResumeBulletGate(
    {
      resumeBullets: [
        { text: 'Organized a church fundraiser.', sourceQuote: 'I organized my church fundraiser.' },
        { text: 'Consistently managed competing tasks.', sourceQuote: 'I am hardworking.' },
        { text: 'Delivered high-quality outcomes.', sourceQuote: 'I never said this.' },
        { text: 'Coordinated stakeholders efficiently.', sourceQuote: 'I prefer remote work.' },
      ],
      linkedinHeadlines: [{ style: 'x', text: 'y' }, { style: 'x', text: 'y' }, { style: 'x', text: 'y' }],
      linkedinAbout: 'About',
    },
    singleActionGate
  );
  assert(
    'per-bullet gate keeps only bullets with allowed concrete sourceQuote',
    perBulletKit.resumeBullets.length === 1 &&
      perBulletKit.resumeBullets[0].text === 'Organized a church fundraiser.' &&
      perBulletKit.resumeBullets[0].sourceQuote === undefined
  );

  const noMatchKit = applyResumeBulletGate(
    {
      resumeBullets: [{ text: 'Fabricated bullet.', sourceQuote: 'Totally invented action.' }],
      linkedinHeadlines: [{ style: 'x', text: 'y' }, { style: 'x', text: 'y' }, { style: 'x', text: 'y' }],
      linkedinAbout: 'About',
    },
    singleActionGate
  );
  assert(
    'per-bullet gate drops all bullets when no sourceQuote matches allowed sources',
    noMatchKit.resumeBullets.length === 0
  );

  const PRODUCTION_REJECT_STORY =
    'I organized church events. I provided personal care to my aunt.';
  const PRODUCTION_RETAINED = [
    {
      name: 'Organization & Coordination',
      strength: 'Strong',
      evidence: 'You described organizing church events.',
    },
  ];
  const PRODUCTION_REJECTED = [
    {
      name: 'Caregiving & People Support',
      strength: 'Moderate',
      evidence: 'You described providing personal care to your aunt.',
    },
  ];
  const productionRejectGate = gateRetainedEvidence(
    PRODUCTION_REJECT_STORY,
    PRODUCTION_RETAINED,
    PRODUCTION_REJECTED
  );
  assert(
    'production path keeps retained-skill concrete source in allowed set',
    productionRejectGate.concretePastActions.some((i) => /organized church events/i.test(i.source))
  );
  assert(
    'production path excludes rejected-only concrete source from allowed set',
    !productionRejectGate.concretePastActions.some((i) => /personal care/i.test(i.source)) &&
      productionRejectGate.rejectedOnlyConcrete.some((i) => /personal care/i.test(i.source))
  );
  const productionRejectKit = applyResumeBulletGate(
    {
      resumeBullets: [
        {
          text: 'Organized church events to support community activities.',
          sourceQuote: 'I organized church events.',
        },
        {
          text: 'Provided personal care to a family member.',
          sourceQuote: 'I provided personal care to my aunt.',
        },
      ],
      linkedinHeadlines: [{ style: 'x', text: 'y' }, { style: 'x', text: 'y' }, { style: 'x', text: 'y' }],
      linkedinAbout: 'About',
    },
    productionRejectGate
  );
  assert(
    'production path drops resume bullet grounded in rejected-only sourceQuote',
    productionRejectKit.resumeBullets.length === 1 &&
      productionRejectKit.resumeBullets[0].text.includes('Organized church events')
  );

  const pathRejectContext = buildPathPromptStoryContext(
    PRODUCTION_REJECT_STORY,
    PRODUCTION_RETAINED,
    PRODUCTION_REJECTED
  );
  assert(
    'path context retains organizing clause after rejected-skill filtering',
    /organized church events/i.test(pathRejectContext)
  );
  assert(
    'path context excludes rejected-only personal-care clause',
    !/personal care/i.test(pathRejectContext)
  );

  const PREFERENCE_REJECT_STORY =
    'I like taking care of people. I know how to organize things.';
  const PREFERENCE_RETAINED = [
    {
      name: 'Organization & Coordination',
      strength: 'Moderate',
      evidence: 'You described knowing how to organize things.',
    },
  ];
  const PREFERENCE_REJECTED = [
    {
      name: 'Caregiving & People Support',
      strength: 'Moderate',
      evidence: 'You described liking to take care of people.',
    },
  ];
  const preferenceRejectContext = buildPathPromptStoryContext(
    PREFERENCE_REJECT_STORY,
    PREFERENCE_RETAINED,
    PREFERENCE_REJECTED
  );
  assert(
    'path context excludes rejected-only care preference clause',
    !/like taking care of people/i.test(preferenceRejectContext)
  );
  assert(
    'path context retains organizing self-description for retained skill',
    /know how to organize things/i.test(preferenceRejectContext)
  );

  const preferenceRejectGate = gateRetainedEvidence(
    PREFERENCE_REJECT_STORY,
    PREFERENCE_RETAINED,
    PREFERENCE_REJECTED
  );
  const roadmapPreferenceContext = formatEvidenceGateForRoadmapPrompt(preferenceRejectGate);
  const kitPreferenceContext = formatEvidenceGateForPrompt(preferenceRejectGate);
  const linkedInPreferenceContext = formatLinkedInEvidenceContext(preferenceRejectGate);
  assert(
    'roadmap prompt omits rejected-only care preference',
    /know how to organize things/i.test(roadmapPreferenceContext) &&
      !/like taking care of people/i.test(roadmapPreferenceContext) &&
      !/excluded_rejected/i.test(roadmapPreferenceContext)
  );
  assert(
    'kit prompt omits rejected-only care preference',
    /know how to organize things/i.test(kitPreferenceContext) &&
      !/like taking care of people/i.test(kitPreferenceContext) &&
      !/excluded_rejected/i.test(kitPreferenceContext)
  );
  assert(
    'LinkedIn context omits rejected-only care preference',
    /know how to organize things/i.test(linkedInPreferenceContext) &&
      !/like taking care of people/i.test(linkedInPreferenceContext)
  );

  const roadmapRejectContext = formatEvidenceGateForRoadmapPrompt(productionRejectGate);
  assert(
    'roadmap prompt retains organizing concrete evidence',
    /organized church events/i.test(roadmapRejectContext)
  );
  assert(
    'roadmap prompt omits rejected-only personal-care evidence',
    !/personal care/i.test(roadmapRejectContext) && !/excluded_rejected/i.test(roadmapRejectContext)
  );
  assert(
    'kit prompt omits rejected-only personal-care evidence',
    !/personal care/i.test(formatEvidenceGateForPrompt(productionRejectGate)) &&
      !/excluded_rejected/i.test(formatEvidenceGateForPrompt(productionRejectGate))
  );
  assert(
    'internal gate retains rejectedOnlyStory for deterministic enforcement',
    productionRejectGate.rejectedOnlyStory?.some((i) => /personal care/i.test(i.source))
  );

  const fixtureCDirectionContext = formatEvidenceGateForRoadmapPrompt(fixtureCGate);
  assert(
    'Fixture C direction context classifies organization as self_described_ability',
    /self_described_ability:\n- "I know how to organize things"/.test(fixtureCDirectionContext) ||
      fixtureCDirectionContext.includes('I know how to organize things')
  );
  assert(
    'Fixture C direction context has zero concrete past actions',
    fixtureCGate.concretePastActions.length === 0 &&
      /concrete_past_action:\nnone/.test(fixtureCDirectionContext)
  );
  assert(
    'Fixture C direction context forbids demonstrated-strength positioning',
    fixtureCDirectionContext.includes('demonstrated strengths') &&
      fixtureCDirectionContext.includes('ZERO concrete past actions')
  );

  const FIXTURE_C_TARGET = 'Administrative / Office Coordinator';
  const fixtureCLinkedInContext = formatLinkedInEvidenceContext(fixtureCGate);
  assert(
    'Fixture C LinkedIn context contains allowed self-described organization evidence',
    /know how to organize things/i.test(fixtureCLinkedInContext)
  );
  assert(
    'Fixture C LinkedIn context contains allowed listening evidence',
    /listen to people/i.test(fixtureCLinkedInContext)
  );

  const liveInvalidLinkedIn = {
    resumeBullets: [],
    linkedinHeadlines: [
      {
        style: 'Recruiter Search-Focused',
        text: 'Administrative Coordinator | Office Coordination | Organizing & Scheduling | Detail-Oriented Support Professional',
      },
      {
        style: 'Career Transition-Focused',
        text: 'Transitioning into Administrative Coordination | Bringing Strong Organization & Listening Skills to Office Environments',
      },
      {
        style: 'Professional Brand-Focused',
        text: 'Easygoing & Organized Professional | Knows How to Coordinate, Prioritize, and Keep Things Running Smoothly',
      },
    ],
    linkedinAbout:
      'qualities I bring into every interaction and task I take on. I thrive in environments where structure and clear communication matter, which helps me work well across teams and with a wide range of people, drawing on my organizational abilities and steady, reliable presence.',
  };
  const liveInvalidViolations = validateLinkedInKit(liveInvalidLinkedIn, fixtureCGate, FIXTURE_C_TARGET);
  assert(
    'Fixture C live-invalid LinkedIn fails evidence-aware validation',
    !liveInvalidViolations.ok &&
      liveInvalidViolations.violations.includes('scheduling') &&
      liveInvalidViolations.violations.includes('detail-oriented') &&
      liveInvalidViolations.violations.includes('prioritize') &&
      liveInvalidViolations.violations.includes('reliable') &&
      liveInvalidViolations.violations.includes('thrive') &&
      liveInvalidViolations.violations.includes('work-across-teams') &&
      liveInvalidViolations.violations.includes('keep-things-running')
  );

  const linkedInGated = applyLinkedInGate(liveInvalidLinkedIn, fixtureCGate, FIXTURE_C_TARGET);
  const linkedInGatedValidation = validateLinkedInKit(linkedInGated, fixtureCGate, FIXTURE_C_TARGET);
  assert(
    'applyLinkedInGate replaces invalid Fixture C LinkedIn with evidence-grounded fallback',
    linkedInGatedValidation.ok &&
      /Administrative Coordination|Administrative \/ Office Coordinator/i.test(
        `${linkedInGated.linkedinAbout} ${linkedInGated.linkedinHeadlines.map((h) => h.text).join(' ')}`
      ) &&
      /organiz|listen/i.test(
        `${linkedInGated.linkedinAbout} ${linkedInGated.linkedinHeadlines.map((h) => h.text).join(' ')}`
      ) &&
      !/scheduling|detail-oriented|prioritize|reliable|thrive|work well across teams|keep things running smoothly|Support Professional/i.test(
        `${linkedInGated.linkedinAbout} ${linkedInGated.linkedinHeadlines.map((h) => h.text).join(' ')}`
      )
  );

  const acceptableLinkedIn = buildFallbackLinkedIn(fixtureCGate, FIXTURE_C_TARGET);
  assert(
    'Fixture C fallback LinkedIn allows future-facing Administrative Coordination',
    /Administrative Coordination|Administrative \/ Office Coordinator/i.test(
      acceptableLinkedIn.linkedinHeadlines.map((h) => h.text).join(' ')
    )
  );
  assert(
    'Fixture C fallback LinkedIn uses self-described organization/listening wording',
    /know how to organize|listen to people/i.test(
      `${acceptableLinkedIn.linkedinAbout} ${acceptableLinkedIn.linkedinHeadlines.map((h) => h.text).join(' ')}`
    )
  );
  assert(
    'Fixture C fallback LinkedIn validates itself before return',
    validateLinkedInKit(acceptableLinkedIn, fixtureCGate, FIXTURE_C_TARGET).ok
  );
  assert(
    'Fixture C zero resume bullets still enforced alongside LinkedIn gate',
    applyResumeBulletGate(liveInvalidLinkedIn, fixtureCGate).resumeBullets.length === 0
  );

  assert(
    'target-role scheduling keyword alone is not allowed without evidence for Fixture C',
    findLinkedInUpgradeViolations('Organizing & Scheduling for office work', fixtureCGate, FIXTURE_C_TARGET).includes(
      'scheduling'
    )
  );

  const CULINARY_STORY = 'I love cooking and I am patient.';
  const culinaryGate = gateRetainedEvidence(CULINARY_STORY, [], []);
  const culinaryFallback = applyLinkedInGate(
    {
      resumeBullets: [],
      linkedinHeadlines: [{ style: 'Recruiter Search-Focused', text: 'Detail-Oriented Office Professional | Scheduling Expert' }],
      linkedinAbout: 'I thrive across teams with reliable office skills.',
    },
    culinaryGate,
    'Culinary Assistant'
  );
  const culinaryText = `${culinaryFallback.linkedinAbout} ${culinaryFallback.linkedinHeadlines.map((h) => h.text).join(' ')}`;
  assert(
    'non-admin fallback uses only supported culinary evidence',
    validateLinkedInKit(culinaryFallback, culinaryGate, 'Culinary Assistant').ok &&
      /Culinary Assistant/i.test(culinaryText) &&
      (/patient|cooking/i.test(culinaryText) || /exploring a move toward/i.test(culinaryText)) &&
      !/organization|coordination|listening|office skills|self-aware|meaningful work/i.test(culinaryText)
  );

  const DRAWING_STORY = 'I like drawing.';
  const drawingGate = gateRetainedEvidence(DRAWING_STORY, [], []);
  const drawingFallback = buildFallbackLinkedIn(drawingGate, 'Graphic Design Assistant');
  const drawingText = `${drawingFallback.linkedinAbout} ${drawingFallback.linkedinHeadlines.map((h) => h.text).join(' ')}`;
  assert(
    'minimal-evidence fallback stays literal and future-facing only',
    validateLinkedInKit(drawingFallback, drawingGate, 'Graphic Design Assistant').ok &&
      /Graphic Design Assistant|drawing/i.test(drawingText) &&
      !/organized|reliable|detail-oriented|teamwork|communication|office skills|meaningful work/i.test(drawingText)
  );

  const FRIENDLY_GATE = gateRetainedEvidence('I am friendly.', [], []);
  const SCHEDULING_TARGET = 'Scheduling Coordinator';
  assert(
    'target-title future direction alone is allowed without scheduling evidence',
    findLinkedInUpgradeViolations('Transitioning into Scheduling Coordinator', FRIENDLY_GATE, SCHEDULING_TARGET).length === 0
  );
  assert(
    'strong scheduling skills violates without scheduling evidence',
    findLinkedInUpgradeViolations('Strong Scheduling Skills', FRIENDLY_GATE, SCHEDULING_TARGET).length > 0
  );
  assert(
    'experienced in scheduling violates without scheduling evidence',
    findLinkedInUpgradeViolations('Experienced in scheduling', FRIENDLY_GATE, SCHEDULING_TARGET).length > 0
  );
  assert(
    'skilled scheduler violates without scheduling evidence',
    findLinkedInUpgradeViolations('Skilled scheduler', FRIENDLY_GATE, SCHEDULING_TARGET).length > 0
  );
  assert(
    'mixed future target + strong scheduling phrase fails validation',
    findLinkedInUpgradeViolations(
      'Transitioning into Scheduling Coordinator | Strong Scheduling Skills',
      FRIENDLY_GATE,
      SCHEDULING_TARGET
    ).length > 0
  );
  assert(
    'target path title is excluded from evidence corpus',
    !buildLinkedInEvidenceCorpus(FRIENDLY_GATE).includes('scheduling')
  );
  assert(
    'ultra-conservative fallback validates itself',
    validateLinkedInKit(buildUltraConservativeLinkedIn(FRIENDLY_GATE, SCHEDULING_TARGET), FRIENDLY_GATE, SCHEDULING_TARGET).ok
  );

  const ADMIN_TARGET = 'Administrative Coordinator';
  const adminFutureRemainderViolations = findLinkedInUpgradeViolations(
    'Building toward Administrative Coordinator as a reliable, detail-oriented professional.',
    FRIENDLY_GATE,
    ADMIN_TARGET
  );
  assert(
    'future-target span does not sanitize reliable or detail-oriented remainder',
    adminFutureRemainderViolations.includes('reliable') &&
      adminFutureRemainderViolations.includes('detail-oriented')
  );
  assert(
    'future-target span does not sanitize prioritize or scheduling remainder',
    findLinkedInUpgradeViolations(
      'Building toward Administrative Coordinator while learning to prioritize schedules.',
      FRIENDLY_GATE,
      ADMIN_TARGET
    ).includes('prioritize') &&
      findLinkedInUpgradeViolations(
        'Building toward Administrative Coordinator while learning to prioritize schedules.',
        FRIENDLY_GATE,
        ADMIN_TARGET
      ).includes('scheduling')
  );
  assert(
    'pure future scheduling target span passes without scheduling evidence',
    findLinkedInUpgradeViolations('Building toward Scheduling Coordinator', FRIENDLY_GATE, SCHEDULING_TARGET).length === 0
  );
  assert(
    'future scheduling target span does not sanitize reliable execution remainder',
    findLinkedInUpgradeViolations(
      'Building toward Scheduling Coordinator with reliable execution',
      FRIENDLY_GATE,
      SCHEDULING_TARGET
    ).includes('reliable')
  );
  assert(
    'span-scoped mixed future target and strong scheduling phrase fails',
    findLinkedInUpgradeViolations(
      'Transitioning into Scheduling Coordinator | Strong Scheduling Skills',
      FRIENDLY_GATE,
      SCHEDULING_TARGET
    ).length > 0
  );
  assert(
    'professional identity is evaluated per sentence not whole text',
    findLinkedInUpgradeViolations(
      "I'm building toward Administrative Coordinator. I am a support professional.",
      FRIENDLY_GATE,
      ADMIN_TARGET
    ).includes('support-professional') ||
      findLinkedInUpgradeViolations(
        "I'm building toward Administrative Coordinator. I am a support professional.",
        FRIENDLY_GATE,
        ADMIN_TARGET
      ).includes('implied-professional-identity')
  );
  const schedulingEvidenceGate = gateRetainedEvidence('I scheduled appointments for my manager.', [], []);
  assert(
    'evidence-supported scheduling language passes when scheduling is in corpus',
    !findLinkedInUpgradeViolations(
      'I scheduled appointments and am interested in scheduling coordination roles.',
      schedulingEvidenceGate,
      SCHEDULING_TARGET
    ).includes('scheduling')
  );

  const fixtureBGate = gateRetainedEvidence(FIXTURE_B_STORY, []);
  assert(
    'Fixture B gate finds concrete caregiving past actions',
    fixtureBGate.allowResumeBullets && fixtureBGate.concretePastActions.length > 0
  );

  assert(
    'kit schema requires sourceQuote on each resume bullet',
    kitSchema.items.required.includes('sourceQuote')
  );

  assert(
    'index.html wires evidence gate into buildKit with rejected-skill provenance',
    INDEX_HTML.includes('loadEvidenceGate') &&
      INDEX_HTML.includes('applyResumeBulletGate') &&
      INDEX_HTML.includes('applyLinkedInGate') &&
      INDEX_HTML.includes('gateRetainedEvidence') &&
      INDEX_HTML.includes('getRejectedSkills')
  );

  assert(
    'index.html wires provenance-filtered story into discoverPaths and refinePaths',
    INDEX_HTML.includes('formatDownstreamStoryForPaths') &&
      /discoverPaths[\s\S]*formatDownstreamStoryForPaths/.test(INDEX_HTML) &&
      /refinePaths[\s\S]*formatDownstreamStoryForPaths/.test(INDEX_HTML)
  );

  assert(
    'index.html wires allow-list roadmap formatter into all roadmap sections',
    /buildRoadmapFoundation[\s\S]*formatEvidenceGateForRoadmapPrompt/.test(INDEX_HTML) &&
      /buildRoadmapActionPlan[\s\S]*formatEvidenceGateForRoadmapPrompt/.test(INDEX_HTML) &&
      /buildRoadmapDirection[\s\S]*formatEvidenceGateForRoadmapPrompt/.test(INDEX_HTML)
  );

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
