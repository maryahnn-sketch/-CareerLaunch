/**
 * JD Analyzer regressions for youAlreadyHave normalize/validation and gap wording.
 * Run: node scripts/test-jd-analysis.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getServerSystemPromptForTest } from '../api/claude-operations.mjs';
import {
  formatJdRetainedSkillNames,
  stripTrailingConfidenceLabel,
  normalizeYouAlreadyHave,
  normalizeJdResult,
  validateJdAnalysis,
  applyJdYouAlreadyHaveFilter,
} from '../js/jd-analysis.mjs';
import {
  getRetainedStorySkills,
  getRejectedSkillNames,
  getConfirmedSkills,
  getUnconfirmedStorySkills,
} from './skill-state.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = readFileSync(join(__dirname, '../index.html'), 'utf8');

const CONTROLLED_OPS_COORDINATOR_JD = `Operations Coordinator

We are hiring an Operations Coordinator to keep customer orders moving and vendors on schedule.

You will:
- Build customer relationships and resolve order issues
- Manage day-to-day operations and order management
- Coordinate with suppliers and vendors
- Stay organized, prioritize, and solve problems as they come up
- Track inventory and keep stock accurate
- Use Excel or Google Sheets for trackers and lists
- Work in ERP or order-management software
- Provide reporting and status updates to the team
`;

const REJECTED_NAME = 'Social Media & Event Marketing';
const PARENTHETICAL_NAME = 'Project & People Coordination (Informal Leadership)';

const CONTROLLED_SKILLS = [
  { name: 'Customer Relationship Management', strength: 'Strong', evidence: 'You described answering customer messages and handling complaints.' },
  { name: 'Operations & Order Management', strength: 'Strong', evidence: 'You described ordering products and handling day-to-day business problems.' },
  { name: 'Supplier & Vendor Coordination', strength: 'Strong', evidence: 'You described ordering products from vendors.' },
  { name: REJECTED_NAME, strength: 'Moderate', evidence: 'You described handling business events and social media promotion.' },
  { name: 'Organization', strength: 'Moderate', evidence: 'You described organizing deliveries and keeping operations moving.' },
  { name: 'Problem Solving', strength: 'Strong', evidence: 'You described handling day-to-day business problems.' },
  { name: 'Inventory Tracking', strength: 'Moderate', evidence: 'You described tracking inventory for the clothing business.' },
];

const skillValidation = {
  'Customer Relationship Management': 'yes',
  [REJECTED_NAME]: 'no',
};

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

function main() {
  const confirmed = getConfirmedSkills(CONTROLLED_SKILLS, skillValidation);
  const unmarked = getUnconfirmedStorySkills(CONTROLLED_SKILLS, skillValidation);
  const retained = getRetainedStorySkills(CONTROLLED_SKILLS, skillValidation);
  const rejectedNames = getRejectedSkillNames(CONTROLLED_SKILLS, skillValidation);
  const retainedNames = retained.map((s) => s.name);

  assert(
    'controlled fixture is 1 yes + 1 not quite + 5 unmarked',
    CONTROLLED_SKILLS.length === 7 &&
      confirmed.map((s) => s.name).join() === 'Customer Relationship Management' &&
      rejectedNames.join() === REJECTED_NAME &&
      unmarked.length === 5 &&
      retained.length === 6
  );

  const nameList = formatJdRetainedSkillNames(retained);
  assert(
    'JD allowed list is names only without confidence labels',
    nameList.includes('Customer Relationship Management') &&
      nameList.includes('Inventory Tracking') &&
      !nameList.includes('(Strong)') &&
      !nameList.includes('(Moderate)') &&
      !nameList.includes(REJECTED_NAME)
  );

  assert(
    'global skillsSummaryStr in index.html is unchanged for other flows',
    INDEX_HTML.includes("function skillsSummaryStr(skills){ return skills.map(s=>`${s.name} (${s.strength})`).join(', '); }") &&
      /async function analyzeJd\(\)[\s\S]*formatJdRetainedSkillNames\(retainedStorySkills\)/.test(INDEX_HTML) &&
      !/async function analyzeJd\(\)[\s\S]*skillsSummaryStr\(retainedStorySkills\)/.test(INDEX_HTML)
  );

  assert(
    'confidence suffixes normalize and parenthetical skill names stay intact',
    stripTrailingConfidenceLabel('Customer Relationship Management (Strong)') ===
      'Customer Relationship Management' &&
      stripTrailingConfidenceLabel('Organization (Moderate)') === 'Organization' &&
      stripTrailingConfidenceLabel('Problem Solving (Developing)') === 'Problem Solving' &&
      stripTrailingConfidenceLabel('Inventory Tracking (Needs More Information)') ===
        'Inventory Tracking' &&
      stripTrailingConfidenceLabel(PARENTHETICAL_NAME) === PARENTHETICAL_NAME &&
      normalizeYouAlreadyHave([
        'Customer Relationship Management (Strong)',
        PARENTHETICAL_NAME,
      ]).join('|') === `Customer Relationship Management|${PARENTHETICAL_NAME}`
  );

  const buggyModelResult = normalizeJdResult({
    marketAsks: [
      'Customer relationships',
      'Order management',
      'Vendor coordination',
      'Inventory tracking',
      'Excel or Google Sheets',
      'ERP or order-management software',
    ],
    youAlreadyHave: [
      'Customer Relationship Management (Strong)',
      'Operations & Order Management (Moderate)',
      'Supplier & Vendor Coordination (Strong)',
      'Organization (Strong)',
      'Problem Solving (Moderate)',
      `${REJECTED_NAME} (Developing)`,
    ],
    shouldStrengthen: [
      'Excel or Google Sheets',
      'ERP or order-management software familiarity',
      'Reporting and status updates',
    ],
    overallFit: 'Strong Match',
  });

  const applied = applyJdYouAlreadyHaveFilter(buggyModelResult, retainedNames, rejectedNames);

  assert(
    'youAlreadyHave keeps retained CRM / operations / vendor / organization / problem-solving matches',
    applied.youAlreadyHave.includes('Customer Relationship Management') &&
      applied.youAlreadyHave.includes('Operations & Order Management') &&
      applied.youAlreadyHave.includes('Supplier & Vendor Coordination') &&
      applied.youAlreadyHave.includes('Organization') &&
      applied.youAlreadyHave.includes('Problem Solving')
  );

  assert(
    'rejected Social Media/Event Marketing never appears after JD filter',
    !applied.youAlreadyHave.includes(REJECTED_NAME) &&
      !applied.youAlreadyHave.some((name) => /social media|event marketing/i.test(name))
  );

  assert(
    'Strong Match with normalized retained matches validates',
    validateJdAnalysis(buggyModelResult, retainedNames).ok
  );

  assert(
    'Strong Match with empty youAlreadyHave fails instead of inventing a match',
    !validateJdAnalysis(
      {
        marketAsks: ['Order management'],
        youAlreadyHave: [],
        shouldStrengthen: ['Excel or Google Sheets'],
        overallFit: 'Strong Match',
      },
      retainedNames
    ).ok &&
      validateJdAnalysis(
        {
          marketAsks: ['Order management'],
          youAlreadyHave: [],
          shouldStrengthen: ['Excel or Google Sheets'],
          overallFit: 'Strong Match',
        },
        retainedNames
      ).kind === 'semantic'
  );

  assert(
    'Worth Considering with no claimed strengths does not invent a match',
    validateJdAnalysis(
      {
        marketAsks: ['Order management'],
        youAlreadyHave: [],
        shouldStrengthen: ['Excel or Google Sheets'],
        overallFit: 'Worth Considering',
      },
      retainedNames
    ).ok
  );

  assert(
    'Worth Considering that claims invalid transferable strengths fails',
    !validateJdAnalysis(
      {
        marketAsks: ['Order management'],
        youAlreadyHave: ['Client success experience'],
        shouldStrengthen: ['Excel or Google Sheets'],
        overallFit: 'Worth Considering',
      },
      retainedNames
    ).ok
  );

  assert(
    'normalize never invents a matched skill',
    normalizeYouAlreadyHave([]).length === 0 &&
      normalizeJdResult({ youAlreadyHave: [] }).youAlreadyHave.length === 0 &&
      applyJdYouAlreadyHaveFilter(
        { youAlreadyHave: [] },
        retainedNames,
        rejectedNames
      ).youAlreadyHave.length === 0
  );

  const goodGaps = buggyModelResult.shouldStrengthen.join(' | ');
  assert(
    'Excel/Google Sheets stays a gap',
    /excel or google sheets/i.test(goodGaps)
  );
  assert(
    'ERP/order-management software stays a gap',
    /erp or order-management software/i.test(goodGaps)
  );
  assert(
    'reporting/status updates stays a gap',
    /reporting and status updates/i.test(goodGaps)
  );
  assert(
    'inventory itself is not presented as missing',
    !/experience with inventory/i.test(goodGaps) &&
      !/(?:^|\|\s*)inventory(?:\s|\||$)/i.test(goodGaps)
  );

  const jdPrompt = getServerSystemPromptForTest('analyzeJd');
  assert(
    'server JD prompt requires names-only youAlreadyHave and software-only inventory gaps',
    jdPrompt.includes('Retained story skills') &&
      jdPrompt.includes('never a strength label in parentheses') &&
      jdPrompt.includes('ERP or order-management software familiarity') &&
      jdPrompt.includes('Experience with inventory, ERP, or order-management software') &&
      jdPrompt.includes('Strong Match requires at least one exact retained skill name')
  );

  const analyzeJdFn = INDEX_HTML.match(/async function analyzeJd\(\)[\s\S]*?function applyEntryRoute/)?.[0] || '';
  assert(
    'index.html analyzeJd uses JD module validate/normalize and names-only list',
    analyzeJdFn.includes('formatJdRetainedSkillNames') &&
      analyzeJdFn.includes('validateJdAnalysis') &&
      analyzeJdFn.includes('normalizeJdResult') &&
      analyzeJdFn.includes('ERP or order-management software familiarity') &&
      !analyzeJdFn.includes('skillsSummaryStr(retainedStorySkills)')
  );

  assert(
    'controlled Operations Coordinator JD includes inventory plus software and reporting asks',
    /track inventory/i.test(CONTROLLED_OPS_COORDINATOR_JD) &&
      /excel or google sheets/i.test(CONTROLLED_OPS_COORDINATOR_JD) &&
      /erp or order-management software/i.test(CONTROLLED_OPS_COORDINATOR_JD) &&
      /reporting and status updates/i.test(CONTROLLED_OPS_COORDINATOR_JD) &&
      /customer relationships/i.test(CONTROLLED_OPS_COORDINATOR_JD) &&
      /suppliers and vendors/i.test(CONTROLLED_OPS_COORDINATOR_JD)
  );

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
