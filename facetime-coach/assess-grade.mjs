/** Web-app grading framework: builtin rubric, assess prompt, order check, score. */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUILTIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'backend', 'app', 'builtin_skills.json');

const DENSE_FPS = 2;
const MAX_FRAMES = 240;
const MIN_FPS = 0.5;
const MIN_SPAN_S = 1;
const ORDER_TOLERANCE_S = 1;
const RECORDING_END_SLACK_S = 4;
const MAX_FAILED_FRACTION = 0.25;
const MAX_UNVERIFIED_FRACTION = 0.25;
const MAX_NOT_PASSED_FRACTION = 0.25;
const ORDER_CONFIDENCE = 0.5;
const CRITICAL_PASS_CONFIDENCE = 0.5;
const ORDER_PENALTY = 15;
const FLAG_PENALTY = { high: 25, medium: 10, low: 5 };
const PATIENT_FLAG_KINDS = new Set(['patient_distress', 'patient_off_center', 'patient_unsteady']);

const GROUND_RULES = duration => `Ground rules:
- Judge only what the people in the recording do and say. Ignore captions, on-screen text,
  graphics, title cards and camera work; a caregiver's real attempt is a plain single-take
  webcam recording without any of these.
- You can hear the audio. Speech counts as evidence (an explanation to the patient, a patient
  saying something hurts or that they feel dizzy).
- Give times as whole seconds from the start of the whole video, never past ${duration.toFixed(0)}.
`;

const WHOLE_VIDEO_RULES = [
  '- passed: the pass criteria are observed and no fail criterion is.',
  '- failed: a fail criterion is observed, or the step was not performed in this attempt: the',
  '  caregiver moved on without doing it, or the recording ends before it.',
  '- unverified: only when the step may have been performed but the camera or microphone could',
  '  not show it (out of frame, blocked from view, too dark, inaudible). A step the recording',
  '  ends before is failed, not unverified, even if an "unverified when" condition mentions',
  '  the recording ending.',
];

let builtinCache;

export async function loadRubric(skill) {
  if (!builtinCache) {
    try {
      builtinCache = JSON.parse(await readFile(BUILTIN, 'utf8')).skills || [];
    } catch {
      builtinCache = [];
    }
  }
  const row = builtinCache.find(item => item.slug === skill.slug);
  if (row) {
    return {
      name: row.name,
      summary: row.summary || '',
      order_matters: row.order_matters !== false,
      safety_criteria: row.safety_criteria || [],
      steps: (row.steps || []).map(step => ({
        step_id: step.step_id,
        order: step.ord ?? step.order,
        title: step.title,
        description: step.description || '',
        critical: Boolean(step.critical),
        order_dependent: step.order_dependent !== false,
        must_follow: step.must_follow || [],
        evals: step.evals || { pass_criteria: [], fail_criteria: [], unverified_when: [], visual_cues: [] },
      })),
    };
  }
  return {
    name: skill.name,
    summary: '',
    order_matters: true,
    safety_criteria: skill.safety || [],
    steps: (skill.steps || []).map((step, index) => ({
      step_id: step.id,
      order: index + 1,
      title: step.title,
      description: step.how || '',
      critical: false,
      order_dependent: true,
      must_follow: index ? [skill.steps[index - 1].id] : [],
      evals: {
        pass_criteria: [step.how || step.title],
        fail_criteria: ['The step is skipped or done unsafely.'],
        unverified_when: ['The camera cannot show this step.'],
        visual_cues: [],
      },
    })),
  };
}

function fmtList(items) {
  return items?.length ? items.join('; ') : '(none given)';
}

function stepBlock(step) {
  const ev = step.evals || {};
  return `[${step.step_id}] "${step.title}"${step.critical ? ' (CRITICAL)' : ''}
  What it is: ${step.description}
  Passed when: ${fmtList(ev.pass_criteria)}
  Failed when: ${fmtList(ev.fail_criteria)}
  Unverified when: ${fmtList(ev.unverified_when)}
  Look for: ${fmtList(ev.visual_cues)}`;
}

export function sampleFps(duration) {
  if (duration <= MAX_FRAMES / DENSE_FPS) return DENSE_FPS;
  return Math.round(Math.max(MIN_FPS, MAX_FRAMES / duration) * 100) / 100;
}

export function assessPrompt(skill, rubric, duration) {
  const steps = [...rubric.steps].sort((a, b) => a.order - b.order);
  const safety = (rubric.safety_criteria || []).map(item => `  - ${item}`).join('\n')
    || '  (none listed; use general patient safety)';
  const rules = WHOLE_VIDEO_RULES.map(line => `   ${line}`).join('\n');
  return `You are a clinical skills assessor reviewing a caregiver's practice recording. A nurse will use
your answer to jump straight to each step and to see how it went.
The caregiver is practising the skill "${skill.name || rubric.name}": ${rubric.summary || ''}
The recording is ${duration.toFixed(0)} seconds long.

${GROUND_RULES(duration)}
Work through these in order.

1. observed: what actually happens in the recording, in order, one entry per distinct action
   (a few words each) with its start and end time. Start a new entry whenever the caregiver
   moves on to a different action, even when it flows straight on from the last one. Use what
   you see and what you hear people say.

2. people: every person you see, labelled P1, P2, ... Role "caregiver" is the trainee
   performing the skill, "patient" is whoever is being assisted (it may be a colleague or an
   actor playing the part), "other" is anyone else. There may be more than one of each, and a
   solo skill (for example glove removal) may have no patient. Describe each so a nurse can
   tell them apart: clothing, position, what they do.

3. skill_match: whether the recording shows the caregiver attempting this skill at all. If it
   shows something else, set it false and say in skill_match_note what it shows instead.

4. steps: one entry for every step below, in the order given, exactly once, reusing its step id.
   Where it happens:
   - performed is true only if that action clearly happens in this recording. start_s is when
     the caregiver begins doing it (its first movement, or for a spoken step the moment they
     say it) and end_s is when it is complete; null for both when it is not performed.
     Announcing a plan in advance ("I'll lock the brakes, then help you up") is not the start
     of those steps.
   - Steps can be done in any order, skipped, or repeated. Report each step where it really
     happens, even out of the listed order. If a step happens more than once, report its first
     complete performance and mention the repeat in note.
   - Give each step the span of its own action only. Where one step flows into the next, the
     first ends where the next begins, so the spans of different steps rarely overlap. Do not
     stretch a step to fill a gap, and do not mark a step performed because a related step
     was. If the recording does not show this skill at all, no step is performed.
   - The people, room and camera angle may differ from any example of this skill. Judge the actions.
   - timing_confidence_pct (0 to 100): how sure you are that it happened at the time you gave.
   How well it was done:
   - evidence: one sentence on what you actually saw or heard, written before the status.
${rules}
   - confidence_pct (0 to 100): how sure you are of the status.
   - feedback speaks to the caregiver as "you", in one or two plain, encouraging sentences:
     for a pass, what you did well; for a failure, what went wrong and what to do instead;
     for unverified, what could not be seen and how to record it so it can be.
   - note: a few words for the nurse only when useful (a repeat, why a step was not found),
     otherwise empty. Refer to other steps by their title, never by their id.

Steps:
${steps.map(stepBlock).join('\n')}

5. safety_flags. Watch the patient throughout. Flag only what is actually seen or heard, with
   its time span and the person's label:
   - patient_distress: grimacing, crying out, saying it hurts or that they are dizzy
   - patient_off_center: the patient off-centre, leaning to one side or sliding
   - patient_unsteady: unsteadiness, buckling knees or a near fall
   - unsafe_caregiver_posture: unsafe handling, such as pulling on arms or letting go mid-move
   - environment_hazard: hazards such as clutter, an unlocked wheelchair, a wet floor
   Severity: high = imminent risk of injury, medium = a concerning posture or instability,
   low = a minor point. Return an empty list when nothing is wrong.
   Judge against what this skill expects. When the skill is a response to the patient's
   instability (in a fall-response drill the patient losing balance and being lowered to the
   floor is the scenario), do not flag that instability itself; flag only what the caregiver's
   handling adds to it, such as the patient dropping hard, twisting or hitting their head.
   Skill-specific points to watch:
${safety}

6. overall_feedback: two or three encouraging, plain sentences to the caregiver: what went
   well and the one or two most important things to work on. If a step was done out of the
   listed order or you raised a medium or high safety flag, mention the most important of these.
`;
}

function clampSpan(start, end, duration) {
  const cap = Math.max(duration, 0);
  const s = Math.min(Math.max(0, Number(start)), Math.max(0, cap - MIN_SPAN_S));
  let e = end == null ? s + MIN_SPAN_S : Number(end);
  e = cap > s ? Math.min(Math.max(e, s + MIN_SPAN_S), cap) : s;
  return [Math.round(s * 10) / 10, Math.round(e * 10) / 10];
}

function foundPrerequisites(step, byId, found) {
  const out = [];
  const pending = [...(step.must_follow || [])];
  const seen = new Set([step.step_id]);
  while (pending.length) {
    const id = pending.shift();
    if (seen.has(id) || !byId[id]) continue;
    seen.add(id);
    if (found[id]) out.push(id);
    else pending.push(...(byId[id].must_follow || []));
  }
  return out;
}

export function buildTimeline(rubric, located, duration) {
  const first = new Map();
  for (const item of located || []) {
    const id = String(item.step_id || '').trim();
    if (id && !first.has(id)) first.set(id, item);
  }
  const steps = rubric.steps.map(rs => {
    const item = first.get(rs.step_id);
    if (!item) return { step_id: rs.step_id, found: false, confidence: 0, note: 'Not reported by the model.' };
    const confidence = Math.round(Math.min(Math.max(Number(item.timing_confidence_pct || 0) / 100, 0), 1) * 100) / 100;
    const performed = item.performed && item.start_s != null && !(duration > 0 && item.start_s > duration + 1);
    if (!performed) return { step_id: rs.step_id, found: false, confidence, note: item.note || '' };
    const [start, end] = clampSpan(item.start_s, item.end_s, duration);
    return { step_id: rs.step_id, found: true, start_s: start, end_s: end, confidence, note: item.note || '' };
  });
  const order = Object.fromEntries(rubric.steps.map((s, i) => [s.step_id, i]));
  const foundList = steps.filter(s => s.found).sort((a, b) => a.start_s - b.start_s || order[a.step_id] - order[b.step_id]);
  const rank = Object.fromEntries(foundList.map((s, i) => [s.step_id, i + 1]));
  const withIndex = steps.map(s => ({ ...s, performed_index: rank[s.step_id] }));
  return {
    steps: withIndex,
    order_violations: orderViolations(rubric, withIndex),
    missing_step_ids: withIndex.filter(s => !s.found).map(s => s.step_id),
  };
}

function orderViolations(rubric, steps) {
  if (!rubric.order_matters) return [];
  const byId = Object.fromEntries(rubric.steps.map(s => [s.step_id, s]));
  const found = Object.fromEntries(steps.filter(s => s.found && s.start_s != null).map(s => [s.step_id, s]));
  const violations = [];
  for (const [stepId, s] of Object.entries(found)) {
    const rs = byId[stepId];
    if (!rs || !rs.order_dependent) continue;
    for (const mId of foundPrerequisites(rs, byId, found)) {
      const m = found[mId];
      if (s.start_s < m.start_s - ORDER_TOLERANCE_S) {
        violations.push({
          step_id: stepId,
          expected_after: mId,
          at_s: s.start_s,
          message: `"${rs.title}" was performed before "${byId[mId].title}".`,
        });
      }
    }
  }
  return violations.sort((a, b) => a.at_s - b.at_s || a.step_id.localeCompare(b.step_id));
}

function stepsAfterRecordingEnd(rubric, timeline, duration) {
  const located = timeline.steps.filter(t => t.found && t.start_s != null);
  const order = [...rubric.steps].sort((a, b) => a.order - b.order).map(s => s.step_id);
  const positions = located.map(t => order.indexOf(t.step_id)).filter(i => i >= 0);
  if (duration <= 0 || !positions.length) return [];
  const lastEnd = Math.max(...located.map(t => t.end_s ?? t.start_s));
  if (lastEnd < duration - RECORDING_END_SLACK_S) return [];
  return order.slice(Math.max(...positions) + 1);
}

export function applyRecordingEnd(rubric, timeline, evaluation, duration) {
  const titles = Object.fromEntries(rubric.steps.map(s => [s.step_id, s.title]));
  const tail = new Set(stepsAfterRecordingEnd(rubric, timeline, duration));
  for (const step of evaluation.steps) {
    if (tail.has(step.id) && step.status === 'unverified') {
      step.status = 'failed';
      step.confidence = 0.9;
      step.feedback = `The recording stopped before you did "${titles[step.id]}". Keep recording until you have finished every step.`;
    }
  }
}

function countedViolations(rubric, timeline) {
  if (!rubric.order_matters) return { confident: [], unsure: [] };
  const steps = Object.fromEntries(rubric.steps.map(s => [s.step_id, s]));
  const confidence = Object.fromEntries(timeline.steps.filter(t => t.found).map(t => [t.step_id, t.confidence]));
  const confident = [];
  const unsure = [];
  const seen = new Set();
  for (const v of timeline.order_violations) {
    const step = steps[v.step_id];
    const key = `${v.step_id}|${v.expected_after}`;
    if (!step || !step.order_dependent || seen.has(key)) continue;
    seen.add(key);
    const sure = Math.min(confidence[v.step_id] || 0, confidence[v.expected_after] || 0) >= ORDER_CONFIDENCE;
    (sure ? confident : unsure).push(v);
  }
  return { confident, unsure };
}

function sameEvent(a, b) {
  if (a.description === b.description) return true;
  const aEnd = a.end_s ?? a.start_s;
  const bEnd = b.end_s ?? b.start_s;
  return a.kind === b.kind && a.start_s <= bEnd && b.start_s <= aEnd;
}

function mergeFlags(flags) {
  const rank = { high: 0, medium: 1, low: 2 };
  const events = [];
  for (const flag of [...flags].sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3) || a.start_s - b.start_s)) {
    if (!events.some(event => sameEvent(flag, event))) events.push(flag);
  }
  return events.sort((a, b) => a.start_s - b.start_s);
}

function flagPenalty(flag) {
  if (flag.severity === 'low' && !PATIENT_FLAG_KINDS.has(flag.kind)) return 0;
  return FLAG_PENALTY[flag.severity] || 0;
}

export function scoreAttempt(rubric, timeline, evaluation, flags) {
  const steps = Object.fromEntries(rubric.steps.map(s => [s.step_id, s]));
  const titles = Object.fromEntries(rubric.steps.map(s => [s.step_id, s.title]));
  const results = Object.fromEntries(evaluation.steps.filter(r => steps[r.id]).map(r => [r.id, r]));
  const total = Math.max(rubric.steps.length, 1);
  const passed = rubric.steps.filter(s => results[s.step_id]?.status === 'passed').map(s => s.step_id);
  const failed = rubric.steps.filter(s => results[s.step_id]?.status === 'failed').map(s => s.step_id);
  const unverified = rubric.steps.filter(s => !results[s.step_id] || results[s.step_id].status === 'unverified').map(s => s.step_id);

  if (!evaluation.skill_match) {
    const note = String(evaluation.skill_match_note || '').trim();
    const reason = 'The video does not appear to show this skill.' + (note ? ` ${note}` : '');
    return { overall: 'failed', score_pct: 0, reasons: [reason], needs_nurse_review: true };
  }

  const { confident, unsure } = countedViolations(rubric, timeline);
  const events = mergeFlags((flags || []).filter(f => f.counts_toward_score !== false));
  const penalty = ORDER_PENALTY * confident.length + events.reduce((sum, flag) => sum + flagPenalty(flag), 0);
  const scorePct = Math.round(Math.max(0, 100 * (passed.length + 0.5 * unverified.length) / total - penalty) * 10) / 10;

  const failReasons = [];
  const reviewReasons = [];
  const notes = [];
  for (const id of failed) {
    if (steps[id].critical) failReasons.push(`A critical step was not done correctly: "${titles[id]}".`);
  }
  if (failed.length / total > MAX_FAILED_FRACTION) {
    failReasons.push(`${failed.length} of ${total} steps were not done correctly.`);
  }
  failReasons.push(...confident.map(v => `Steps out of order: ${v.message}`));
  failReasons.push(...events.filter(f => f.severity === 'high').map(f => `Safety risk: ${f.description}`));

  for (const id of unverified) {
    if (steps[id].critical) reviewReasons.push(`A critical step could not be seen clearly: "${titles[id]}".`);
  }
  for (const id of passed) {
    if (steps[id].critical && (results[id].confidence ?? 1) < CRITICAL_PASS_CONFIDENCE) {
      reviewReasons.push(`A critical step may have been done but it was hard to be sure: "${titles[id]}".`);
    }
  }
  if (unverified.length / total > MAX_UNVERIFIED_FRACTION) {
    reviewReasons.push(`${unverified.length} of ${total} steps could not be checked from the video.`);
  } else if (failed.length / total <= MAX_FAILED_FRACTION
    && (failed.length + unverified.length) / total > MAX_NOT_PASSED_FRACTION) {
    reviewReasons.push(`${failed.length + unverified.length} of ${total} steps were not done correctly or could not be seen.`);
  }
  reviewReasons.push(...unsure.map(v => `Steps may be out of order: ${v.message}`));
  reviewReasons.push(...events.filter(f => f.severity === 'medium' && PATIENT_FLAG_KINDS.has(f.kind))
    .map(f => `Patient safety concern for a nurse to review: ${f.description}`));
  notes.push(...events.filter(f => f.severity === 'medium' && !PATIENT_FLAG_KINDS.has(f.kind))
    .map(f => `Safety point for a nurse to review: ${f.description}`));
  notes.push(...events.filter(f => f.severity === 'low' && PATIENT_FLAG_KINDS.has(f.kind))
    .map(f => `Minor safety point: ${f.description}`));

  if (failReasons.length) {
    return { overall: 'failed', score_pct: scorePct, reasons: [...failReasons, ...reviewReasons, ...notes], needs_nurse_review: true };
  }
  if (reviewReasons.length) {
    return { overall: 'unverified', score_pct: scorePct, reasons: [...reviewReasons, ...notes], needs_nurse_review: true };
  }
  const summary = failed.length || unverified.length
    ? `Every critical step met the criteria; ${failed.length + unverified.length} of ${total} other steps need another try or a clearer view.`
    : 'All steps met the criteria.';
  const needsReview = Boolean(unverified.length) || events.some(f => f.severity === 'medium');
  return { overall: 'passed', score_pct: scorePct, reasons: [summary, ...notes], needs_nurse_review: needsReview };
}
