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
  extractClauses,
  splitParallelActivityList,
  gateRetainedEvidence,
  applyResumeBulletGate,
  validateResumeBulletSources,
  getRequiredResumeBulletCount,
  validateResumeBulletCount,
  getUncoveredConcreteSources,
  strengthenQuestionForUncoveredSource,
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
  findResumeBulletIndirectnessViolation,
  validateResumeBulletDirectness,
  deriveApplicationKitSearchTerms,
} from './evidence-gate.mjs';
import {
  validatePathsResult,
  hasEvidenceSupportedAlternativeDirections,
  enforcePathDiscoveryBalance,
  annotatePathsWithEvidenceNotes,
  filterTransfersToRetainedSkills,
  findRejectedSkillIntegrityViolations,
  findPathClaimViolations,
  getRequiredPathCount,
  getEvidencePathBounds,
  formatEvidencePathCountInstruction,
  appendEvidencePathCountBlock,
  pathTitlesAreNearDuplicate,
  findNearDuplicatePathPairs,
  pathOccupationalFamily,
} from '../js/path-validation.mjs';
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
const XRAY_HTML = readFileSync(join(__dirname, '../xray.html'), 'utf8');

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
    'helped manage',
    'meaningfully different',
  ], 'buildKit prompt enforces past-evidence boundary and kit quality');

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
    'Discovery balance',
    'Do not return only paths the user already named',
    'EVIDENCE-SUPPORTED PATH COUNT',
    'never pad beyond what evidence supports',
  ], 'discoverPaths prompt enforces career diversity and discovery balance');

  promptIncludesAll(refinePrompt, [
    'meaningfully different occupational/function families',
    'NOT evidence of healthcare or professional caregiving experience',
    'EVIDENCE-SUPPORTED PATH COUNT',
    'never pad beyond what evidence supports',
  ], 'refinePaths prompt enforces career diversity and evidence-aware path counts');

  const OBSOLETE_PATH_COUNT_PATTERNS = [
    /4[-–]5\s+(?:evidence-supported\s+)?career\s+path/i,
    /Return\s+4[-–]5\s+paths/i,
    /fresh set of 4[-–]5/i,
    /Regenerate a fresh set of 4[-–]5/i,
    /return at least 3 meaningfully different paths/i,
  ];

  function assertNoObsoletePathCountInstructions(source, label) {
    for (const pattern of OBSOLETE_PATH_COUNT_PATTERNS) {
      assert(
        `${label} has no obsolete fixed path count (${pattern})`,
        !pattern.test(source)
      );
    }
  }

  assertNoObsoletePathCountInstructions(discoverPrompt, 'discoverPaths server prompt');
  assertNoObsoletePathCountInstructions(refinePrompt, 'refinePaths server prompt');

  const indexPathPromptSources = [
    INDEX_HTML.match(/async function discoverPaths\(\)[\s\S]*?async function sendConvo/)?.[0] || '',
    INDEX_HTML.match(/async function regenerateLessObviousPaths\(\)[\s\S]*?async function refinePaths/)?.[0] || '',
    INDEX_HTML.match(/async function refinePaths\(\)[\s\S]*?async function rerankPaths/)?.[0] || '',
  ].join('\n');

  assertNoObsoletePathCountInstructions(indexPathPromptSources, 'index.html path generation prompts');

  assert(
    'path tool schemas allow evidence-aware counts (minItems 1, maxItems 5)',
    TOOL_DEFINITIONS.report_career_paths.input_schema.properties.paths.minItems === 1 &&
      TOOL_DEFINITIONS.report_career_paths.input_schema.properties.paths.maxItems === 5 &&
      TOOL_DEFINITIONS.report_refined_career_paths.input_schema.properties.paths.minItems === 1 &&
      TOOL_DEFINITIONS.report_refined_career_paths.input_schema.properties.paths.maxItems === 5
  );

  assert(
    'index.html path tool schemas allow evidence-aware counts',
    /paths:\s*\{\s*type:\s*'array',\s*minItems:\s*1,\s*maxItems:\s*5/.test(INDEX_HTML)
  );

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
  assert(
    'present-tense real action classifies as concrete_past_action',
    classifyEvidenceText('I manage household schedules and appointments.') === 'concrete_past_action'
  );
  assert(
    'present-perfect real action classifies as concrete_past_action',
    classifyEvidenceText('I have helped organize school events and family travel.') === 'concrete_past_action'
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

  assert(
    'intake screen shows type-or-microphone hint above textarea',
    INDEX_HTML.includes('Type here or use the microphone') &&
      INDEX_HTML.includes('intake-hint') &&
      INDEX_HTML.includes('Start typing here')
  );

  assert(
    'intake copy lists nontraditional experience types',
    INDEX_HTML.includes('caregiving') &&
      INDEX_HTML.includes('household responsibilities') &&
      INDEX_HTML.includes('side hustles') &&
      INDEX_HTML.includes('school projects')
  );

  assert(
    'discovery tiers use direct-fit, adjacent, and longer-term labels',
    INDEX_HTML.includes("'Direct-fit paths'") &&
      INDEX_HTML.includes("'Adjacent opportunities'") &&
      INDEX_HTML.includes("'Longer-term possibilities'")
  );

  assert(
    'path validation module is wired into discoverPaths flow',
    INDEX_HTML.includes('loadPathValidation') &&
      INDEX_HTML.includes('validatePathsResultWithStructure')
  );

  const adminNamedStory =
    'I want to become an administrative coordinator. I organized church events and scheduled appointments for my manager.';
  const adminNamedSkills = [
    { name: 'Organization & Coordination', strength: 'Strong', evidence: 'You described organizing church events.' },
    { name: 'Active Listening', strength: 'Moderate', evidence: 'You described listening carefully.' },
    { name: 'Problem Solving', strength: 'Moderate', evidence: 'You described fixing things for people.' },
  ];
  const adminNamedCareers = ['administrative coordinator'];
  const allAdminNamedPaths = {
    paths: [
      { title: 'Administrative Coordinator', entryPoint: 'Admin Coordinator', progression: 'Office Manager', category: 'Strong Evidence', why: 'Organizing evidence', transfers: ['Organization & Coordination'], gaps: ['tools'], transition: 'Strong', workEnvironment: 'Office pace' },
      { title: 'Office Coordinator', entryPoint: 'Office Coordinator', progression: 'Operations Lead', category: 'Strong Evidence', why: 'Scheduling evidence', transfers: ['Organization & Coordination'], gaps: ['software'], transition: 'Strong', workEnvironment: 'Team-based' },
      { title: 'Scheduling Assistant', entryPoint: 'Scheduling Assistant', progression: 'Coordinator', category: 'Worth Exploring', why: 'Listening evidence', transfers: ['Active Listening'], gaps: ['experience'], transition: 'Moderate', workEnvironment: 'Desk-based' },
    ],
  };
  const mixedNamedPaths = {
    paths: [
      allAdminNamedPaths.paths[0],
      { title: 'Customer Service Representative', entryPoint: 'Customer Service Rep', progression: 'Support Lead', category: 'Worth Exploring', why: 'Listening and problem solving', transfers: ['Active Listening', 'Problem Solving'], gaps: ['metrics'], transition: 'Moderate', workEnvironment: 'People-facing' },
      { title: 'Operations Coordinator', entryPoint: 'Operations Coordinator', progression: 'Operations Lead', category: 'Growth Path', why: 'Organizing and problem solving combined', transfers: ['Organization & Coordination', 'Problem Solving'], gaps: ['systems'], transition: 'Moderate', workEnvironment: 'Process-driven' },
    ],
  };

  assert(
    'scenario A: named-career-only paths fail when evidence supports alternatives',
    hasEvidenceSupportedAlternativeDirections(adminNamedStory, adminNamedSkills, adminNamedCareers) &&
      !validatePathsResult(allAdminNamedPaths, adminNamedStory, adminNamedSkills).ok &&
      validatePathsResult(mixedNamedPaths, adminNamedStory, adminNamedSkills).ok
  );

  const caregiverStory =
    'I worked as a caregiver for my aunt and want to become a caregiver. I helped with meals, appointments, medication reminders, and daily routines.';
  const caregiverSkills = [
    { name: 'Caregiving & People Support', strength: 'Strong', evidence: 'You described providing personal care to your aunt.' },
    { name: 'Organization', strength: 'Moderate', evidence: 'You described keeping routines on track.' },
  ];
  const caregiverNamedCareers = ['caregiver'];
  const allCaregiverPaths = {
    paths: [
      { title: 'Caregiver', entryPoint: 'Caregiver', progression: 'Senior Caregiver', category: 'Strong Evidence', why: 'Direct caregiving experience', transfers: ['Caregiving & People Support'], gaps: ['cert'], transition: 'Strong', workEnvironment: 'Hands-on' },
    ],
  };
  const paddedAdminPaths = {
    paths: [
      { title: 'Administrative Coordinator', entryPoint: 'Admin Coordinator', progression: 'Office Manager', category: 'Strong Evidence', why: 'Organizing evidence', transfers: ['Organization & Coordination'], gaps: ['tools'], transition: 'Strong', workEnvironment: 'Office pace' },
      { title: 'Senior Administrative Coordinator', entryPoint: 'Admin Coordinator', progression: 'Office Manager', category: 'Strong Evidence', why: 'Scheduling evidence', transfers: ['Organization & Coordination'], gaps: ['software'], transition: 'Strong', workEnvironment: 'Team-based' },
      { title: 'Entry Administrative Coordinator', entryPoint: 'Admin Coordinator', progression: 'Coordinator', category: 'Worth Exploring', why: 'Listening evidence', transfers: ['Active Listening'], gaps: ['experience'], transition: 'Moderate', workEnvironment: 'Desk-based' },
    ],
  };

  assert(
    'scenario B: single named-direction path passes when no responsible alternative is supported',
    !hasEvidenceSupportedAlternativeDirections(caregiverStory, caregiverSkills, caregiverNamedCareers) &&
      validatePathsResult(allCaregiverPaths, caregiverStory, caregiverSkills).ok
  );

  assert(
    'scenario B: near-duplicate caregiver title variants are rejected as separate discoveries',
    !validatePathsResult(
      {
        paths: [
          { title: 'Caregiver', entryPoint: 'Caregiver', progression: 'Senior Caregiver', category: 'Strong Evidence', why: 'Direct caregiving experience', transfers: ['Caregiving & People Support'], gaps: ['cert'], transition: 'Strong', workEnvironment: 'Hands-on' },
          { title: 'Family Caregiver', entryPoint: 'Family Caregiver', progression: 'Care Coordinator', category: 'Strong Evidence', why: 'Medication and routine support', transfers: ['Caregiving & People Support'], gaps: ['formal'], transition: 'Strong', workEnvironment: 'Home-based' },
          { title: 'Senior Caregiver', entryPoint: 'Senior Caregiver', progression: 'Lead Caregiver', category: 'Worth Exploring', why: 'Daily routine support', transfers: ['Organization'], gaps: ['training'], transition: 'Moderate', workEnvironment: 'Client homes' },
        ],
      },
      caregiverStory,
      caregiverSkills
    ).ok
  );

  assert(
    'padded near-duplicate admin coordinator paths are rejected',
    !validatePathsResult(paddedAdminPaths, adminNamedStory, adminNamedSkills).ok
  );

  const downgraded = enforcePathDiscoveryBalance(mixedNamedPaths.paths, adminNamedStory, adminNamedSkills);
  assert(
    'enforcePathDiscoveryBalance does not downgrade paths to force artificial variety',
    downgraded.length === mixedNamedPaths.paths.length &&
      downgraded.every((path, idx) => path.transition === mixedNamedPaths.paths[idx].transition)
  );

  const annotated = annotatePathsWithEvidenceNotes(allCaregiverPaths.paths, caregiverStory, caregiverSkills);
  assert(
    'single-direction support adds evidence-based explanation note',
    annotated.some((path) => /most clearly supports this direction right now/i.test(path.evidenceNote || ''))
  );

  assert(
    'deriveApplicationKitSearchTerms prefers roadmap direction terms',
    deriveApplicationKitSearchTerms({
      roadmapSearchTerms: ['Office Coordinator', 'Administrative Assistant', 'Scheduling Coordinator'],
      chosenPath: { title: 'Administrative Coordinator', entryPoint: 'Admin Coordinator', progression: 'Office Manager' },
      retainedSkills: adminNamedSkills,
    }).join('|') === 'Office Coordinator|Administrative Assistant|Scheduling Coordinator'
  );

  assert(
    'deriveApplicationKitSearchTerms falls back to chosen path titles without roadmap direction',
    deriveApplicationKitSearchTerms({
      chosenPath: { title: 'Administrative Coordinator', entryPoint: 'Admin Coordinator', progression: 'Office Manager' },
      retainedSkills: adminNamedSkills,
    }).includes('Administrative Coordinator') &&
      deriveApplicationKitSearchTerms({
        chosenPath: { title: 'Administrative Coordinator', entryPoint: 'Admin Coordinator', progression: 'Office Manager' },
        retainedSkills: adminNamedSkills,
      }).includes('Office Manager')
  );

  assert(
    'deriveApplicationKitSearchTerms adds skill-grounded titles when path alone is insufficient',
    deriveApplicationKitSearchTerms({
      chosenPath: { title: 'Support Path', entryPoint: 'Support Path', progression: 'Lead Support' },
      retainedSkills: adminNamedSkills,
    }).some((term) => /Customer Service Representative|Office Coordinator|Administrative Assistant|Help Desk Support/i.test(term))
  );

  assert(
    'kit render and download use resilient search term resolver',
    INDEX_HTML.includes('kitSearchTermsForDisplay') &&
      INDEX_HTML.includes('refreshApplicationKitSearchTerms') &&
      /downloadApplicationKit[\s\S]*kitSearchTermsForDisplay/.test(INDEX_HTML)
  );

  assert(
    'findPathClaimViolations flags unsupported salary claims',
    findPathClaimViolations({ title: 'Coordinator', why: 'Earns $60k salary range', entryPoint: 'Coordinator', progression: 'Lead', workEnvironment: 'Office' }).length > 0
  );

  assert(
    'kit render includes summary block and search terms section',
    INDEX_HTML.includes('kit-summary') &&
      INDEX_HTML.includes('What you received') &&
      INDEX_HTML.includes('search-terms-row')
  );

  assert(
    'demo unlock language removed from paywall and roadmap errors',
    !INDEX_HTML.includes('Demo Already Unlocked') &&
      !INDEX_HTML.includes('demo unlock is complete') &&
      INDEX_HTML.includes('Starter Already Unlocked')
  );

  assert(
    'validateKitResult rejects helped manage over direct evidence',
    /function validateKitResult[\s\S]*helped manage/.test(INDEX_HTML)
  );

  assert(
    'resume bullet indirectness violation flags helped manage over direct source',
    findResumeBulletIndirectnessViolation({
      text: 'Helped manage scheduling and appointments for the team.',
      sourceQuote: 'I scheduled appointments for my manager.',
    }) === 'helped-manage-over-direct-evidence'
  );

  assert(
    'resume bullet directness passes when phrasing matches evidence',
    validateResumeBulletDirectness([
      {
        text: 'Scheduled appointments for my manager and coordinated follow-ups.',
        sourceQuote: 'I scheduled appointments for my manager.',
      },
    ]).ok
  );

  assert(
    'landing pricing removes planned one-time price copy',
    !INDEX_HTML.includes('Planned one-time price')
  );

  assert(
    'landing pricing uses premium outcome-focused unlock list',
    INDEX_HTML.includes('unlock-list premium') &&
      INDEX_HTML.includes('Know which roles to pursue') &&
      INDEX_HTML.includes('Follow a focused 90 day plan')
  );

  assert(
    'validateKitResult enforces minimum resume bullets for rich evidence',
    /function validateKitResult[\s\S]*concreteCount >= 3/.test(INDEX_HTML)
  );

  assert(
    'user-facing index copy has no em or en dashes in landing pricing block',
    (() => {
      const block = INDEX_HTML.match(/price-card featured[\s\S]*?<\/ul>/);
      return block && !/[—–]/.test(block[0]);
    })()
  );

  assert(
    'xray user-facing copy has no em or en dashes',
    !/<title>[^<]*—[^<]*<\/title>/.test(XRAY_HTML) &&
      !XRAY_HTML.includes('Ready to go deeper —') &&
      !XRAY_HTML.includes('bit more detail —')
  );

  const RICH_STORY =
    'I organized church events. I scheduled appointments for my manager. I trained new staff at my sister\'s shop.';
  const richGate = gateRetainedEvidence(RICH_STORY, []);
  assert(
    'rich evidence gate finds at least three concrete past actions',
    richGate.concretePastActions.length >= 3
  );
  assert(
    'required resume bullet count is three when three or more sources exist',
    getRequiredResumeBulletCount(richGate) === 3
  );
  assert(
    'validateResumeBulletCount rejects fewer than three bullets for rich evidence',
    !validateResumeBulletCount(
      {
        resumeBullets: richGate.concretePastActions.slice(0, 2).map((item) => ({
          text: 'Supported action.',
          sourceQuote: item.source,
        })),
      },
      richGate
    ).ok
  );
  assert(
    'validateResumeBulletCount accepts three distinct grounded bullets',
    validateResumeBulletCount(
      {
        resumeBullets: richGate.concretePastActions.slice(0, 3).map((item) => ({
          text: 'Supported action.',
          sourceQuote: item.source,
        })),
      },
      richGate
    ).ok
  );

  const richOrganizeSource = richGate.concretePastActions.find((i) =>
    /organized church events/i.test(i.source)
  )?.source;
  const gatedRich = applyResumeBulletGate(
    {
      resumeBullets: richOrganizeSource
        ? [{ text: 'Organized church events.', sourceQuote: richOrganizeSource }]
        : [],
      linkedinHeadlines: [{ style: 'x', text: 'y' }, { style: 'x', text: 'y' }, { style: 'x', text: 'y' }],
      linkedinAbout: 'About',
    },
    richGate
  );
  assert(
    'applyResumeBulletGate adds strengthen gaps instead of fabricating missing bullets',
    gatedRich.resumeBullets.length === 1 &&
      Array.isArray(gatedRich.resumeBulletGaps) &&
      gatedRich.resumeBulletGaps.length >= 2 &&
      gatedRich.resumeBulletGaps.every((g) => typeof g.strengthen === 'string' && g.strengthen.length > 0)
  );

  assert(
    'uncovered concrete sources exclude quotes already used by bullets',
    getUncoveredConcreteSources(
      [{ sourceQuote: richGate.concretePastActions[0].source }],
      richGate
    ).every((item) => item.source !== richGate.concretePastActions[0].source)
  );

  assert(
    'strengthen question for uncovered source stays deterministic and non-fabricating',
    /What measurable detail can you add about:/.test(
      strengthenQuestionForUncoveredSource('I organized church events.')
    )
  );

  assert(
    'evidence prompt adds resume bullet minimum when three or more concrete sources exist',
    formatEvidenceGateForPrompt(richGate).includes('RESUME BULLET MINIMUM')
  );

  const richPathGate = gateRetainedEvidence(RICH_STORY, adminNamedSkills);
  const richAdminStory =
    `${RICH_STORY} I want to become an administrative coordinator.`;
  assert(
    'rich evidence requires at least three credible paths',
    getRequiredPathCount(richAdminStory, adminNamedSkills, richPathGate) === 3 &&
      !validatePathsResult({ paths: mixedNamedPaths.paths.slice(0, 2) }, richAdminStory, adminNamedSkills, richPathGate).ok &&
      validatePathsResult(mixedNamedPaths, richAdminStory, adminNamedSkills, richPathGate).ok
  );

  const twoPathStory =
    'I organized church events. People reach out to me to fix things.';
  const twoPathSkills = [
    { name: 'Organization & Coordination', strength: 'Strong', evidence: 'You described organizing church events.' },
    { name: 'Active Listening', strength: 'Moderate', evidence: 'You described listening carefully when helping people.' },
  ];
  const twoPathGate = gateRetainedEvidence(twoPathStory, twoPathSkills);
  const twoDistinctPaths = {
    paths: [
      { title: 'Office Coordinator', entryPoint: 'Office Coordinator', progression: 'Office Manager', category: 'Strong Evidence', why: 'Organizing church events', transfers: ['Organization & Coordination'], gaps: ['tools'], transition: 'Strong', workEnvironment: 'Office pace' },
      { title: 'Customer Service Representative', entryPoint: 'Customer Service Rep', progression: 'Support Lead', category: 'Worth Exploring', why: 'Listening when helping people', transfers: ['Active Listening'], gaps: ['metrics'], transition: 'Moderate', workEnvironment: 'People-facing' },
    ],
  };
  assert(
    'moderate evidence allows exactly two credible paths',
    getRequiredPathCount(twoPathStory, twoPathSkills, twoPathGate) === 2 &&
      validatePathsResult(twoDistinctPaths, twoPathStory, twoPathSkills, twoPathGate).ok &&
      !validatePathsResult({ paths: [twoDistinctPaths.paths[0]] }, twoPathStory, twoPathSkills, twoPathGate).ok
  );

  assert(
    'single-direction evidence allows one strong path',
    getRequiredPathCount(caregiverStory, caregiverSkills) === 1 &&
      validatePathsResult(allCaregiverPaths, caregiverStory, caregiverSkills).ok
  );

  assert(
    'formatEvidencePathCountInstruction reflects bounds and anti-padding rules',
    (() => {
      const richBounds = getEvidencePathBounds(RICH_STORY, adminNamedSkills);
      const richInstruction = formatEvidencePathCountInstruction(richBounds);
      const singleBounds = getEvidencePathBounds(caregiverStory, caregiverSkills);
      const singleInstruction = formatEvidencePathCountInstruction(singleBounds);
      return (
        richInstruction.includes('exactly 3 distinct') &&
        richInstruction.includes('Never pad to a fixed count') &&
        singleInstruction.includes('exactly 1 distinct') &&
        appendEvidencePathCountBlock('base', richInstruction).includes('EVIDENCE-SUPPORTED PATH COUNT')
      );
    })()
  );

  assert(
    'near-duplicate administrative coordinator titles are detected',
    pathTitlesAreNearDuplicate('Administrative Coordinator', 'Senior Administrative Coordinator') &&
      pathTitlesAreNearDuplicate('Administrative Coordinator', 'Entry Administrative Coordinator')
  );

  assert(
    'application kit search terms work with a single chosen path',
    (() => {
      const terms = deriveApplicationKitSearchTerms({
        chosenPath: allCaregiverPaths.paths[0],
        retainedSkills: caregiverSkills,
      });
      return terms.length >= 1 && terms.includes('Caregiver');
    })()
  );

  assert(
    'index.html hides empty discovery tier sections',
    INDEX_HTML.includes('if(!paths || !paths.length) return') &&
      !/donorTier/.test(INDEX_HTML)
  );

  assert(
    'domain coordinator titles classify by domain, not generic admin',
    pathOccupationalFamily('Operations Coordinator') === 'operations' &&
      pathOccupationalFamily('Event Coordinator') === 'events' &&
      pathOccupationalFamily('Inventory Coordinator') === 'operations' &&
      pathOccupationalFamily('Vendor Coordinator') === 'sales' &&
      pathOccupationalFamily('Administrative Coordinator') === 'admin' &&
      pathOccupationalFamily('Office Coordinator') === 'admin'
  );

  const sevenSkillStory =
    'I helped run a small clothing business. I answered customer messages, handled complaints, ordered products from vendors, tracked inventory, organized deliveries, coordinated pop-up events, trained new staff, and handled day-to-day business problems.';
  const sevenSkills = [
    { name: 'Customer Service', strength: 'Strong', evidence: 'You described answering customer messages and handling complaints.' },
    { name: 'Vendor Coordination', strength: 'Strong', evidence: 'You described ordering products from vendors.' },
    { name: 'Inventory Tracking', strength: 'Moderate', evidence: 'You described tracking inventory for the clothing business.' },
    { name: 'Event Coordination', strength: 'Moderate', evidence: 'You described coordinating pop-up events.' },
    { name: 'Staff Training', strength: 'Moderate', evidence: 'You described training new staff.' },
    { name: 'Problem Solving', strength: 'Strong', evidence: 'You described handling day-to-day business problems.' },
    { name: 'Organization', strength: 'Moderate', evidence: 'You described organizing deliveries and keeping operations moving.' },
  ];
  const rejectedTraining = [sevenSkills[4]];
  const retainedSix = sevenSkills.filter((s) => s.name !== 'Staff Training');
  const sevenGate = gateRetainedEvidence(sevenSkillStory, retainedSix, rejectedTraining);
  const sevenPrompt = buildPathPromptStoryContext(sevenSkillStory, retainedSix, rejectedTraining);
  const sevenBounds = getEvidencePathBounds(sevenSkillStory, retainedSix, sevenGate);
  const diverseSevenPaths = {
    paths: [
      { title: 'Customer Service Representative', entryPoint: 'Customer Service Rep', progression: 'Support Lead', category: 'Strong Evidence', why: 'Complaint handling and customer messages', transfers: ['Customer Service'], gaps: ['metrics'], transition: 'Strong', workEnvironment: 'People-facing' },
      { title: 'Operations Coordinator', entryPoint: 'Operations Coordinator', progression: 'Operations Lead', category: 'Worth Exploring', why: 'Inventory and delivery organization', transfers: ['Inventory Tracking', 'Organization'], gaps: ['systems'], transition: 'Moderate', workEnvironment: 'Process-driven' },
      { title: 'Event Coordinator', entryPoint: 'Event Coordinator', progression: 'Events Lead', category: 'Growth Path', why: 'Pop-up event coordination', transfers: ['Event Coordination'], gaps: ['budgeting'], transition: 'Moderate', workEnvironment: 'On-site events' },
    ],
  };
  const sameFamilyOpsOnly = {
    paths: [
      { title: 'Operations Coordinator', entryPoint: 'Operations Coordinator', progression: 'Operations Lead', category: 'Strong Evidence', why: 'Inventory and delivery organization', transfers: ['Organization'], gaps: ['systems'], transition: 'Strong', workEnvironment: 'Process-driven' },
      { title: 'Inventory Specialist', entryPoint: 'Inventory Specialist', progression: 'Inventory Lead', category: 'Worth Exploring', why: 'Tracked clothing inventory', transfers: ['Inventory Tracking'], gaps: ['software'], transition: 'Moderate', workEnvironment: 'Warehouse pace' },
      { title: 'Logistics Coordinator', entryPoint: 'Logistics Coordinator', progression: 'Logistics Lead', category: 'Growth Path', why: 'Organized deliveries', transfers: ['Organization'], gaps: ['routing'], transition: 'Moderate', workEnvironment: 'Dispatch desk' },
    ],
  };

  assert(
    '7 skills + one Not Quite still produces a valid downstream prompt',
    sevenSkills.length === 7 &&
      rejectedTraining.length === 1 &&
      retainedSix.length === 6 &&
      typeof sevenPrompt === 'string' &&
      sevenPrompt.length > 40 &&
      sevenBounds.min >= 1 &&
      !sevenPrompt.startsWith('(no story evidence after rejected-skill filtering)')
  );

  assert(
    'semantic path failures are tagged semantic and do not loosen diversity',
    validatePathsResult({}, sevenSkillStory, retainedSix, sevenGate).kind === 'structural' &&
      !validatePathsResult(paddedAdminPaths, adminNamedStory, adminNamedSkills).ok &&
      validatePathsResult(paddedAdminPaths, adminNamedStory, adminNamedSkills).kind === 'semantic' &&
      validatePathsResult(diverseSevenPaths, sevenSkillStory, retainedSix, sevenGate).ok
  );

  assert(
    'same-family operations variants still fail the diversity requirement',
    richPathGate &&
      getEvidencePathBounds(richAdminStory, adminNamedSkills, richPathGate).richEvidence &&
      !validatePathsResult(sameFamilyOpsOnly, richAdminStory, adminNamedSkills, richPathGate).ok &&
      validatePathsResult(sameFamilyOpsOnly, richAdminStory, adminNamedSkills, richPathGate).kind === 'semantic'
  );

  const activityList =
    'I answered customer messages, handled complaints, ordered products from vendors, tracked inventory, organized deliveries, handled business events and social media promotion, trained new staff, and handled day-to-day business problems.';
  const activityClauses = extractClauses(activityList);
  assert(
    'parallel activity lists split into separate action clauses',
    activityClauses.some((c) => /answered customer messages/i.test(c)) &&
      activityClauses.some((c) => /^handled complaints$/i.test(c)) &&
      activityClauses.some((c) => /ordered products from vendors/i.test(c)) &&
      activityClauses.some((c) => /tracked inventory/i.test(c)) &&
      activityClauses.some((c) => /handled business events and social media promotion/i.test(c)) &&
      activityClauses.some((c) => /trained new staff/i.test(c))
  );

  const intactCommaSentences = [
    'On May 3, 2024 I started volunteering at the pantry.',
    'In Austin, Texas I managed a clothing shop.',
    'After the meeting, I updated the inventory spreadsheet.',
    'I worked at a large, busy store.',
    'I live in Chicago, Illinois.',
  ];
  assert(
    'normal comma-containing sentences are not incorrectly broken',
    intactCommaSentences.every((sentence) => extractClauses(sentence).length === 1) &&
      splitParallelActivityList('After the meeting, I updated the inventory spreadsheet.').length === 1 &&
      splitParallelActivityList('On May 3, 2024 I started volunteering at the pantry.').length === 1
  );

  const previewStory =
    'I helped run a small clothing business. I answered customer messages, handled complaints, ordered products from vendors, tracked inventory, organized deliveries, handled business events and social media promotion, trained new staff, and handled day-to-day business problems.';
  const previewRejectedName = 'Social Media & Event Marketing';
  const previewSkills = [
    { name: 'Customer Service', strength: 'Strong', evidence: 'You described answering customer messages and handling complaints.' },
    { name: 'Vendor Coordination', strength: 'Strong', evidence: 'You described ordering products from vendors.' },
    { name: 'Inventory Tracking', strength: 'Moderate', evidence: 'You described tracking inventory for the clothing business.' },
    { name: previewRejectedName, strength: 'Moderate', evidence: 'You described handling business events and social media promotion.' },
    { name: 'Staff Training', strength: 'Moderate', evidence: 'You described training new staff.' },
    { name: 'Problem Solving', strength: 'Strong', evidence: 'You described handling day-to-day business problems.' },
    { name: 'Organization', strength: 'Moderate', evidence: 'You described organizing deliveries and keeping operations moving.' },
  ];
  const previewValidation = {
    'Customer Service': 'yes',
    [previewRejectedName]: 'no',
  };
  const previewConfirmed = getConfirmedSkills(previewSkills, previewValidation);
  const previewUnmarked = getUnconfirmedStorySkills(previewSkills, previewValidation);
  const previewRetained = getRetainedStorySkills(previewSkills, previewValidation);
  const previewRejectedNames = getRejectedSkillNames(previewSkills, previewValidation);
  const previewRejected = previewSkills.filter((s) => previewRejectedNames.includes(s.name));
  const previewGate = gateRetainedEvidence(previewStory, previewRetained, previewRejected);
  const previewPrompt = buildPathPromptStoryContext(previewStory, previewRetained, previewRejected);

  assert(
    'preview fixture is 1 yes + 1 not quite + 5 unmarked',
    previewSkills.length === 7 &&
      previewConfirmed.map((s) => s.name).join() === 'Customer Service' &&
      previewRejectedNames.join() === previewRejectedName &&
      previewUnmarked.length === 5 &&
      previewRetained.length === 6 &&
      previewUnmarked.every((s) => previewRetained.includes(s))
  );

  assert(
    'unmarked skills remain eligible after rejected-skill filtering',
    previewRetained.some((s) => s.name === 'Vendor Coordination') &&
      previewRetained.some((s) => s.name === 'Inventory Tracking') &&
      previewRetained.some((s) => s.name === 'Organization') &&
      !previewRetained.some((s) => s.name === previewRejectedName)
  );

  assert(
    'rejected skill name never appears in downstream path prompt',
    !previewPrompt.includes(previewRejectedName)
  );

  assert(
    'rejected-only event/social-media evidence is removed from path prompt',
    !/social media promotion/i.test(previewPrompt) &&
      !/business events and social media/i.test(previewPrompt) &&
      previewGate.rejectedOnlyStory.some((item) => /social media promotion/i.test(item.source))
  );

  assert(
    'retained customer/orders/inventory evidence from the same sentence is preserved',
    /customer messages/i.test(previewPrompt) &&
      /ordered products from vendors/i.test(previewPrompt) &&
      /tracked inventory/i.test(previewPrompt)
  );

  const rawRejectedTransferPath = {
    title: 'Event Coordinator',
    entryPoint: 'Event Coordinator',
    progression: 'Events Lead',
    category: 'Growth Path',
    why: 'Handling business events and social media promotion for the shop.',
    transfers: [previewRejectedName, 'Customer Service'],
    gaps: ['budgeting'],
    transition: 'Moderate',
    workEnvironment: 'On-site events',
  };
  const cleanEventPath = {
    title: 'Event Coordinator',
    entryPoint: 'Event Coordinator',
    progression: 'Events Lead',
    category: 'Growth Path',
    why: 'Inventory tracking and vendor orders support shop-day coordination.',
    transfers: ['Inventory Tracking', 'Vendor Coordination'],
    gaps: ['budgeting'],
    transition: 'Moderate',
    workEnvironment: 'On-site events',
  };
  const previewValidPaths = {
    paths: [
      {
        title: 'Customer Service Representative',
        entryPoint: 'Customer Service Rep',
        progression: 'Support Lead',
        category: 'Strong Evidence',
        why: 'Answered customer messages and handled complaints.',
        transfers: ['Customer Service'],
        gaps: ['metrics'],
        transition: 'Strong',
        workEnvironment: 'People-facing',
      },
      {
        title: 'Operations Coordinator',
        entryPoint: 'Operations Coordinator',
        progression: 'Operations Lead',
        category: 'Worth Exploring',
        why: 'Tracked inventory and organized deliveries.',
        transfers: ['Inventory Tracking', 'Organization'],
        gaps: ['systems'],
        transition: 'Moderate',
        workEnvironment: 'Process-driven',
      },
      cleanEventPath,
    ],
  };

  assert(
    'raw path using rejected skill transfer fails integrity before apply',
    findRejectedSkillIntegrityViolations(rawRejectedTransferPath, previewGate, previewRejected).some((v) =>
      v.startsWith('rejected-skill-transfer')
    ) &&
      !validatePathsResult(
        { paths: [rawRejectedTransferPath, previewValidPaths.paths[0], previewValidPaths.paths[1]] },
        previewStory,
        previewRetained,
        previewGate,
        previewRejected
      ).ok &&
      validatePathsResult(
        { paths: [rawRejectedTransferPath, previewValidPaths.paths[0], previewValidPaths.paths[1]] },
        previewStory,
        previewRetained,
        previewGate,
        previewRejected
      ).kind === 'semantic'
  );

  const rejectedEvidenceWhyPath = {
    ...cleanEventPath,
    why: 'Handling business events and social media promotion for the shop.',
    transfers: ['Customer Service'],
  };
  assert(
    'raw path citing rejected-only source evidence fails integrity',
    findRejectedSkillIntegrityViolations(rejectedEvidenceWhyPath, previewGate, previewRejected).includes(
      'rejected-only-source-cite'
    ) &&
      !validatePathsResult(
        { paths: [rejectedEvidenceWhyPath, previewValidPaths.paths[0], previewValidPaths.paths[1]] },
        previewStory,
        previewRetained,
        previewGate,
        previewRejected
      ).ok
  );

  assert(
    'generic event wording without rejected identity still validates',
    findRejectedSkillIntegrityViolations(cleanEventPath, previewGate, previewRejected).length === 0 &&
      validatePathsResult(previewValidPaths, previewStory, previewRetained, previewGate, previewRejected).ok
  );

  const annotatedPreview = annotatePathsWithEvidenceNotes(
    [{ ...rawRejectedTransferPath }],
    previewStory,
    previewRetained
  );
  const filteredPreview = filterTransfersToRetainedSkills(
    [{ ...rawRejectedTransferPath }],
    previewRetained
  );
  assert(
    'support text is never constructed from an explicitly rejected skill',
    filteredPreview[0].transfers.includes('Customer Service') &&
      !filteredPreview[0].transfers.includes(previewRejectedName) &&
      !annotatedPreview[0].evidenceNote.includes(previewRejectedName) &&
      /Customer Service/.test(annotatedPreview[0].evidenceNote)
  );

  assert(
    'index.html validates raw paths against rejected skills before apply',
    INDEX_HTML.includes('filterTransfersToRetainedSkills') &&
      INDEX_HTML.includes('getRejectedSkills()') &&
      INDEX_HTML.indexOf('filterTransfersToRetainedSkills') <
        INDEX_HTML.indexOf('annotatePathsWithEvidenceNotes')
  );

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
