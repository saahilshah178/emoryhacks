import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyRecordingEnd,
  assessPrompt,
  buildTimeline,
  rubricFor,
  sampleFps,
  scoreAttempt,
} from './assess-grade.mjs';

const PLACEHOLDER = /^(YOUR_|changeme)/i;
const filled = value => Boolean(value) && !PLACEHOLDER.test(String(value));

async function ensureGeminiEnv() {
  const parent = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');
  const wanted = ['GEMINI_API_KEY', 'GEMINI_MODEL_MAIN'];
  if (wanted.every(name => filled(process.env[name]))) return;
  try {
    for (const line of (await readFile(parent, 'utf8')).split(/\r?\n/)) {
      const match = line.match(/^(GEMINI_API_KEY|GEMINI_MODEL_MAIN)=(.*)$/);
      if (!match) continue;
      const value = match[2].trim().replace(/^["']|["']$/g, '');
      if (filled(value) && !filled(process.env[match[1]])) process.env[match[1]] = value;
    }
  } catch { /* no parent env */ }
}

function extractJson(text) {
  const block = text.match(/\{[\s\S]*\}/);
  if (!block) return null;
  try { return JSON.parse(block[0]); } catch { return null; }
}

async function geminiGenerate(key, parts, model) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 9000 },
    }),
    signal: AbortSignal.timeout(120000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.error?.message || `gemini ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }
  return body.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
}

function statusOf(value) {
  const status = String(value || '').toLowerCase();
  return status === 'passed' || status === 'failed' ? status : 'unverified';
}

function normalizeGemini(parsed, skill, rubric, duration) {
  const byId = new Map((parsed.steps || []).map(step => [step.step_id || step.id, step]));
  const evaluation = {
    skill_match: parsed.skill_match !== false,
    skill_match_note: parsed.skill_match_note || '',
    steps: rubric.steps.map(step => {
      const hit = byId.get(step.step_id);
      const pct = Number(hit?.confidence_pct);
      return {
        id: step.step_id,
        title: step.title,
        status: statusOf(hit?.status),
        confidence: Number.isFinite(pct) ? pct / 100 : 0,
        feedback: hit?.feedback || 'This step was hard to see in the recording.',
      };
    }),
  };
  const timeline = buildTimeline(rubric, parsed.steps || [], duration);
  applyRecordingEnd(rubric, timeline, evaluation, duration);
  const flags = (parsed.safety_flags || []).map(flag => ({
    kind: flag.kind,
    severity: flag.severity,
    start_s: Number(flag.start_s) || 0,
    end_s: flag.end_s == null ? null : Number(flag.end_s),
    description: flag.description || '',
    counts_toward_score: true,
  }));
  const scored = scoreAttempt(rubric, timeline, evaluation, flags);
  const titles = new Map(skill.steps.map(step => [step.id, step.title]));
  return {
    source: 'gemini',
    overall: scored.overall,
    score_pct: scored.score_pct,
    skill_match: evaluation.skill_match,
    overall_feedback: [parsed.overall_feedback, ...scored.reasons].filter(Boolean).join(' '),
    reasons: scored.reasons,
    steps: evaluation.steps.map(step => ({
      ...step,
      title: titles.get(step.id) || step.title,
    })),
  };
}

async function gradeViaGemini(skill, capture) {
  await ensureGeminiEnv();
  const key = process.env.GEMINI_API_KEY;
  if (!filled(key)) return null;
  const rubric = rubricFor(skill);
  const duration = Number(capture.duration_s) || 0;
  const fps = sampleFps(duration || 60);
  const parts = [{ text: assessPrompt(skill, rubric, duration || 60) }];
  if (capture.path) {
    const bytes = await readFile(capture.path);
    parts.push({
      inline_data: { mime_type: 'video/mp4', data: bytes.toString('base64') },
      video_metadata: { fps },
    });
  } else if (capture.stills?.length) {
    for (const still of capture.stills) {
      parts.push({ inline_data: { mime_type: 'image/png', data: still.toString('base64') } });
    }
  } else {
    return null;
  }
  const models = [
    process.env.GEMINI_MODEL_MAIN,
    'gemini-4-hydrogen',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
  ].filter(filled);
  let lastError = '';
  for (const model of models) {
    try {
      console.log(`[grade] Gemini assesses the recording against the home steps (${model})`);
      const text = await geminiGenerate(key, parts, model);
      const parsed = extractJson(text);
      if (parsed) return normalizeGemini(parsed, skill, rubric, duration);
    } catch (error) {
      lastError = error.message;
      if (error.status === 401 || error.status === 403) break;
    }
  }
  if (lastError) console.warn('[grade] Gemini could not finish:', lastError);
  return null;
}

export async function gradeRecording(skill, capture) {
  const viaGemini = await gradeViaGemini(skill, capture).catch(error => {
    console.warn('[grade] Gemini grading failed:', error.message);
    return null;
  });
  if (viaGemini) return viaGemini;
  return {
    source: 'none',
    overall: 'unverified',
    score_pct: null,
    skill_match: true,
    overall_feedback: 'I could not grade that recording automatically. Look over the steps and try again. If it keeps happening, check GEMINI_API_KEY in .env.local.',
    steps: skill.steps.map(step => ({
      id: step.id,
      title: step.title,
      status: 'unverified',
      feedback: step.how,
    })),
  };
}
