import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'skills');

const ALIASES = {
  sts: 'sit_to_stand',
  sitstand: 'sit_to_stand',
  standing: 'sit_to_stand',
  wheelchair: 'wheelchair_transfer',
  wc: 'wheelchair_transfer',
  car: 'vehicle_transfer',
  vehicle: 'vehicle_transfer',
  cartransfer: 'vehicle_transfer',
  bed: 'bed_repositioning',
  reposition: 'bed_repositioning',
  repositioning: 'bed_repositioning',
  walking: 'assisted_walking',
  gait: 'assisted_walking',
  walk: 'assisted_walking',
  stairs: 'stair_assistance',
  stair: 'stair_assistance',
  fall: 'fall_response',
  falls: 'fall_response',
  falling: 'fall_response',
  shower: 'shower_assistance',
  bath: 'shower_assistance',
  gloves: 'glove_removal',
  glove: 'glove_removal',
  ppe: 'glove_removal',
};

const LABELS = {
  pass: /^Pass when:\s*(.+)$/i,
  retry: /^Try again when:\s*(.+)$/i,
  key: /^Key step:\s*(.+)$/i,
  after: /^After:\s*(.+)$/i,
};

function parseStep(id, title, body) {
  const step = { id, title: title.trim(), how: '', pass: '', retry: '', key: false, after: [] };
  const how = [];
  for (const line of body.split('\n').map(item => item.trim()).filter(Boolean)) {
    const label = Object.keys(LABELS).find(name => LABELS[name].test(line));
    if (!label) { how.push(line); continue; }
    const value = line.match(LABELS[label])[1].trim();
    if (label === 'key') step.key = /^(yes|true)$/i.test(value);
    else if (label === 'after') step.after = value.split(/[,\s]+/).filter(Boolean);
    else step[label] = value;
  }
  step.how = how.join(' ');
  return step;
}

/**
 * One skill file. A skill is a home version of a caregiving skill: the steps need no equipment,
 * every step is something a phone camera can see, and each step says what passes it.
 * A file that cannot be graded (a step with no instruction or no pass line, an "After" that points
 * nowhere) stops the coach at start-up, with the file's name.
 */
export function parseSkill(raw, file) {
  const text = raw.replace(/\r\n/g, '\n');
  const slug = file.replace(/\.md$/, '');
  const nameMatch = text.match(/^#\s+(.+)$/m);
  const summary = (text.match(/^#\s+.+\n([\s\S]*?)(?=\n##\s+|$)/) || ['', ''])[1].replace(/\s+/g, ' ').trim();
  const steps = [];
  const stepRe = /###\s+(s\d+)\.\s+(.+)\n([\s\S]*?)(?=\n###\s+s\d+\.|\s*$)/g;
  const stepsBlock = section(text, 'Steps');
  let match;
  while ((match = stepRe.exec(stepsBlock))) steps.push(parseStep(match[1], match[2], match[3]));

  const fail = problem => { throw new Error(`skills/${file}: ${problem}`); };
  if (!nameMatch) fail('no "# Name" heading');
  if (!steps.length) fail('no steps');
  const seen = new Set();
  for (const step of steps) {
    if (!step.how) fail(`${step.id} has no instruction`);
    if (!step.pass) fail(`${step.id} has no "Pass when:" line`);
    for (const id of step.after) if (!seen.has(id)) fail(`${step.id} comes "After: ${id}", which is not an earlier step`);
    seen.add(step.id);
  }
  return {
    slug,
    name: nameMatch[1].trim(),
    summary,
    setup: bullets(section(text, 'You need')),
    camera: section(text, 'Camera').replace(/\s+/g, ' '),
    safety: bullets(section(text, 'Safety')),
    steps,
    text,
  };
}

function section(text, heading) {
  const re = new RegExp(`##\\s+${heading}\\n([\\s\\S]*?)(?=\\n##\\s+|$)`);
  return (text.match(re) || ['', ''])[1].trim();
}

function bullets(block) {
  return block
    .split('\n')
    .map(line => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean);
}

export function normalizeSkillText(query) {
  return String(query || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function strippedPracticeText(normalized) {
  return normalized
    .replace(/^(hey|hi|hello|yo)\s+/, '')
    .replace(/^(i want to|i would like to|id like to|i wanna|can we|can i|lets|let us|please)\s+/, '')
    .replace(/^(practice|practise|train|do|learn|coach|coaching|work on|help (me )?with|the skill)\s+/, '')
    .replace(/\s+(please|now|today|thanks|thank you)$/, '')
    .trim();
}

export async function loadSkills() {
  const files = (await readdir(dir)).filter(name => name.endsWith('.md')).sort();
  const skills = [];
  for (const file of files) {
    skills.push(parseSkill(await readFile(join(dir, file), 'utf8'), file));
  }
  return skills;
}

export function findSkills(skills, query) {
  const raw = String(query || '').trim();
  if (!raw) return [];
  const normalized = normalizeSkillText(raw);
  const compact = normalized.replace(/\s+/g, '_');
  const stripped = strippedPracticeText(normalized);
  const strippedCompact = stripped.replace(/\s+/g, '_');

  const matches = [];
  const add = skill => {
    if (!matches.some(item => item.slug === skill.slug)) matches.push(skill);
  };

  for (const skill of skills) {
    if (skill.slug === compact || skill.slug === strippedCompact) add(skill);
    if (normalizeSkillText(skill.name) === normalized || normalizeSkillText(skill.name) === stripped) add(skill);
  }

  const alias = ALIASES[strippedCompact] || ALIASES[compact] || ALIASES[stripped] || ALIASES[normalized];
  if (alias) {
    const skill = skills.find(item => item.slug === alias);
    if (skill) add(skill);
  }

  const ranked = [...skills].sort((a, b) => normalizeSkillText(b.name).length - normalizeSkillText(a.name).length);
  for (const skill of ranked) {
    const name = normalizeSkillText(skill.name);
    const slugWords = skill.slug.replace(/_/g, ' ');
    if (name && (normalized.includes(name) || stripped.includes(name))) add(skill);
    else if (normalized.includes(slugWords) || stripped.includes(slugWords) || compact.includes(skill.slug) || strippedCompact.includes(skill.slug)) add(skill);
  }

  return matches;
}

export function findSkill(skills, query) {
  const matches = findSkills(skills, query);
  if (matches.length === 1) return matches[0];
  if (!matches.length) return null;
  const stripped = strippedPracticeText(normalizeSkillText(query));
  return matches.find(skill => normalizeSkillText(skill.name) === stripped || skill.slug === stripped.replace(/\s+/g, '_')) || matches[0];
}

export function instructionsFor(skills) {
  const list = skills.map(skill => `- ${skill.name} (${skill.slug}), ${skill.steps.length} steps`).join('\n');
  const body = skills.map(skill => skill.text).join('\n\n---\n\n');
  return `You are an AI caregiver-skills coach on a FaceTime video call. Be clear that you are an AI.
Always speak English. Every spoken reply must be in English, even if the caller talks in another language. Do not switch languages.
The caller FaceTimes in and tells you which activity they want. Do not mention iMessage, texting, or calling them back.
Keep each reply to one or two short sentences.

These are home versions of the skills. The caller practices alone, with no wheelchair, gait belt or other equipment: a dining chair, pillows, a strip of tape. In most skills they play the person being helped themselves. The nurse in the demonstration uses clinical equipment; the caller does the home steps shown on the screen.

Safety, always:
- This is practice, not certification. A nurse still certifies skills.
- Never have the caller lift, catch, or lower a real person who needs care.
- Stop if anything hurts, feels unsafe, or the space is cluttered or wet.
- For falls: never practice a real fall. A big pillow plays the person.
- For stairs: the bottom step only, with a hand on the rail. With no rail, a strip of tape on the floor is the step.

The caller's camera is the signal. Never ask the caller to say they are done, and never decide for them that a part is finished:
- During the demonstration they turn their camera off when they have seen enough. The demonstration stops and the screen shows what to set up.
- When they are set up they turn their camera on. Recording starts by itself.
- When they have finished the steps they turn their camera off. Recording stops and grading starts by itself.
- After the results, turning the camera on again records another try.
Each time this happens you are told what happened and what to say. Say that, briefly, and nothing more.
You do not hear the caller during the demonstration or while they are being recorded.
If the caller says "I'm done" or asks what to do next, tell them to use the camera button in FaceTime.
If the caller says they already turned their camera off or on and nothing happened, call camera_not_noticed.

How you run the call:
1. Greet and ask which one skill they want. Do not name any skill yourself. Do not call choose_skill until the caller has clearly said a skill name. Never guess, never pick a default, never use an example from this prompt as their choice.
2. When they name it, call choose_skill. That starts the nurse demonstration. Say what the tool tells you to say.
3. The camera runs the rest: demonstration, set-up, recording, grading. You do not grade; the results are given to you to summarize.
4. After the results there are three choices: turn the camera on to try again, name another skill (call choose_skill), or end the call (call end_call).
5. Coach only one skill at a time. Never walk through all nine.

Available skills:
${list}

Skill scripts:

${body}`;
}
