/**
 * Measure real discoverPaths synchronous prep (evidence gate + path bounds + prompt).
 * Run: node scripts/test-discover-paths-sync-prep.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gateRetainedEvidence, formatDownstreamStoryForPaths } from '../js/evidence-gate.mjs';
import {
  getEvidencePathBounds,
  formatEvidencePathCountInstruction,
  appendEvidencePathCountBlock,
} from '../js/path-validation.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeSeedProfile() {
  const skills = [
    { name: 'Team Coordination', evidence: 'Coordinated volunteer schedules at the food pantry.', strength: 'Strong' },
    { name: 'Inventory Management', evidence: 'Tracked pantry donations and restock levels weekly.', strength: 'Moderate' },
    { name: 'Customer Service', evidence: 'Greeted visitors and answered questions at intake.', strength: 'Strong' },
    { name: 'Record Keeping', evidence: 'Maintained sign-in logs and donation records.', strength: 'Moderate' },
    { name: 'Event Planning', evidence: 'Helped plan monthly community distribution events.', strength: 'Developing' },
    { name: 'Problem Solving', evidence: 'Resolved supply shortages by contacting alternate donors.', strength: 'Moderate' },
    { name: 'Communication', evidence: 'Sent weekly updates to volunteer team leads.', strength: 'Strong' },
  ];
  return {
    story:
      'For three years I managed a church food pantry volunteer team, tracked inventory, planned monthly distribution events, and kept donation records organized.',
    skills,
    rejected: [],
  };
}

function skillsSummaryStr(skills) {
  return skills.map((s) => `${s.name} (${s.strength})`).join(', ');
}

function runSyncPrep(storyText, retainedStorySkills, rejectedSkills) {
  const evidenceGate = gateRetainedEvidence(storyText, retainedStorySkills, rejectedSkills);
  const pathBounds = getEvidencePathBounds(storyText, retainedStorySkills, evidenceGate);
  const pathCountRule = formatEvidencePathCountInstruction(pathBounds);
  const filteredStoryContext = formatDownstreamStoryForPaths(evidenceGate);
  const userPrompt = appendEvidencePathCountBlock(
    `User's story:\n${filteredStoryContext}\n\nRetained story skills (supported by the user's story — the only names allowed in "transfers"):\n${skillsSummaryStr(retainedStorySkills)}`,
    pathCountRule
  );
  return { evidenceGate, pathBounds, userPrompt };
}

function main() {
  const indexHtml = readFileSync(join(__dirname, '../index.html'), 'utf8');
  const hasYield =
    /function yieldToMainThread\(\)/.test(indexHtml) &&
    /await yieldToMainThread\(\)/.test(indexHtml);

  const { story, skills, rejected } = makeSeedProfile();
  const iterations = 50;
  let total = 0;
  let max = 0;

  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    const result = runSyncPrep(story, skills, rejected);
    const elapsed = performance.now() - t0;
    total += elapsed;
    if (elapsed > max) max = elapsed;
    if (i === 0) {
      console.log(`pathBounds: min=${result.pathBounds.min} max=${result.pathBounds.max}`);
      console.log(`userPrompt length: ${result.userPrompt.length} chars`);
    }
  }

  const avg = total / iterations;
  console.log(`\nSync prep (${iterations} runs, 7 skills): avg=${avg.toFixed(2)}ms max=${max.toFixed(2)}ms`);
  console.log(`yieldToMainThread wired in index.html: ${hasYield ? 'yes' : 'NO'}`);

  if (!hasYield) process.exit(1);
  if (max > 500) {
    console.warn('WARN: sync prep exceeded 500ms — timers need yields before this block');
  }
  process.exit(0);
}

main();
