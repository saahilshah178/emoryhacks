import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessPrompt, buildTimeline, rubricFor, scoreAttempt } from '../assess-grade.mjs';
import { findSkill, instructionsFor, loadSkills, parseSkill } from '../skills.mjs';

const skills = await loadSkills();
const slugs = ['assisted_walking', 'bed_repositioning', 'fall_response', 'glove_removal', 'shower_assistance', 'sit_to_stand', 'stair_assistance', 'vehicle_transfer', 'wheelchair_transfer'];

test('all nine skills load', () => {
  assert.deepEqual(skills.map(skill => skill.slug), slugs);
});

for (const skill of skills) {
  test(`${skill.slug} can be done and graded at home`, () => {
    assert.ok(skill.summary, 'says what the practice is');
    assert.ok(skill.setup.length >= 2, 'lists what to gather');
    assert.ok(skill.camera, 'says where to put the phone');
    assert.ok(skill.safety.length >= 2, 'lists safety points');
    assert.ok(skill.steps.length >= 5 && skill.steps.length <= 6, 'short enough to finish inside one call');
    assert.ok(skill.steps.some(step => step.key), 'has at least one key step');
    assert.ok(skill.steps.filter(step => step.key).length <= 3, 'not every step is a key step');
    for (const step of skill.steps) {
      assert.ok(step.how && step.pass && step.retry, `${step.id} says how, what passes and what to retry`);
      assert.ok(step.title.length <= 36, `${step.id} title fits one line on the phone: "${step.title}"`);
      assert.ok(step.how.length <= 140, `${step.id} instruction is short enough to read mid-practice (${step.how.length})`);
    }
  });

  test(`${skill.slug} asks for nothing a home does not have`, () => {
    // Equipment may be named only as what a household thing stands in for ("a dining chair, as the wheelchair").
    const equipment = /gait belt|transfer belt|walker|crutch|call light|call bell|bed rail|hospital bed|footrest|tub bench|transfer bench|gown|sanitiz(e|er) dispenser/i;
    for (const step of skill.steps) {
      assert.doesNotMatch(`${step.title} ${step.how}`, equipment, `${step.id}`);
      assert.doesNotMatch(`${step.title} ${step.how} ${step.pass}`, /\b(say|tell|ask|explain|greet)\b/i, `${step.id} must be something a silent recording can show`);
    }
    for (const item of skill.setup) assert.doesNotMatch(item, equipment);
  });
}

test('a step with no pass line stops the coach at start-up', () => {
  const broken = '# Demo\n\n## Steps\n\n### s1. Do it\nJust do it.\n';
  assert.throws(() => parseSkill(broken, 'demo.md'), /skills\/demo\.md: s1 has no "Pass when:" line/);
});

test('an "After" that points at a later step is rejected', () => {
  const broken = '# Demo\n\n## Steps\n\n### s1. First\nDo it.\nPass when: done.\nAfter: s2\n\n### s2. Second\nDo it.\nPass when: done.\n';
  assert.throws(() => parseSkill(broken, 'demo.md'), /s1 comes "After: s2"/);
});

test('callers can name a skill the way people talk', () => {
  assert.equal(findSkill(skills, 'I want to practice sit to stand')?.slug, 'sit_to_stand');
  assert.equal(findSkill(skills, 'gloves')?.slug, 'glove_removal');
  assert.equal(findSkill(skills, 'the car one')?.slug ?? null, null);
  assert.equal(findSkill(skills, 'car')?.slug, 'vehicle_transfer');
});

test('the coach is told the camera is the signal, not the word "done"', () => {
  const text = instructionsFor(skills);
  assert.match(text, /camera is the signal/);
  assert.match(text, /Never ask the caller to say they are done/);
  assert.doesNotMatch(text, /caller_done|rerecord|Say "done" when/);
});

test('the rubric is the home skill, with order only where it matters', () => {
  const skill = skills.find(item => item.slug === 'wheelchair_transfer');
  const rubric = rubricFor(skill);
  assert.equal(rubric.steps.length, skill.steps.length);
  const byId = Object.fromEntries(rubric.steps.map(step => [step.step_id, step]));
  assert.equal(byId.s2.title, 'Lock the brakes');
  assert.equal(byId.s2.critical, true);
  assert.deepEqual(byId.s2.must_follow, ['s1']);
  assert.equal(byId.s3.order_dependent, false, 'clearing the floor can happen at any time');
  assert.deepEqual(byId.s3.must_follow, []);
});

test('the grader is told the recording is silent and made at home', () => {
  const skill = skills.find(item => item.slug === 'sit_to_stand');
  const prompt = assessPrompt(skill, rubricFor(skill), 42);
  assert.match(prompt, /The recording has no sound/);
  assert.match(prompt, /Household things stand in/);
  assert.match(prompt, /\[s1\] "Brace the chair" \(CRITICAL\)/);
  assert.doesNotMatch(prompt, /You can hear the audio/);
});

test('scoring: tidying out of order costs nothing, a skipped key step fails the attempt', () => {
  const skill = skills.find(item => item.slug === 'wheelchair_transfer');
  const rubric = rubricFor(skill);
  const at = { s1: 2, s2: 6, s3: 0, s4: 12, s5: 16, s6: 22 }; // the floor is cleared first, before the chair is set
  const located = rubric.steps.map(step => ({ step_id: step.step_id, performed: true, start_s: at[step.step_id], end_s: at[step.step_id] + 3, timing_confidence_pct: 90 }));
  const allPassed = { skill_match: true, steps: rubric.steps.map(step => ({ id: step.step_id, status: 'passed', confidence: 0.9 })) };
  const timeline = buildTimeline(rubric, located, 30);
  assert.deepEqual(timeline.order_violations, []);
  assert.equal(scoreAttempt(rubric, timeline, allPassed, []).overall, 'passed');

  const noBrakes = { ...allPassed, steps: allPassed.steps.map(step => (step.id === 's2' ? { ...step, status: 'failed' } : step)) };
  const scored = scoreAttempt(rubric, timeline, noBrakes, []);
  assert.equal(scored.overall, 'failed');
  assert.match(scored.reasons[0], /critical step was not done correctly: "Lock the brakes"/);
});

test('scoring: sitting down before the chair is tested is out of order', () => {
  const skill = skills.find(item => item.slug === 'sit_to_stand');
  const rubric = rubricFor(skill);
  const at = { s1: 10, s2: 2, s3: 14, s4: 17, s5: 20, s6: 23 }; // sat down, then got up to brace the chair
  const located = rubric.steps.map(step => ({ step_id: step.step_id, performed: true, start_s: at[step.step_id], end_s: at[step.step_id] + 2, timing_confidence_pct: 90 }));
  const timeline = buildTimeline(rubric, located, 30);
  assert.equal(timeline.order_violations.length, 1);
  assert.match(timeline.order_violations[0].message, /"Sit and hold the chair" was performed before "Brace the chair"/);
});
