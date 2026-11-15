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

function parseSkill(raw, file) {
  const text = raw.replace(/\r\n/g, '\n');
  const slug = file.replace(/\.md$/, '');
  const nameMatch = text.match(/^#\s+(.+)$/m);
  const setup = section(text, 'Setup');
  const safety = section(text, 'Safety');
  const stepsBlock = section(text, 'Steps');
  const steps = [];
  const stepRe = /###\s+(s\d+)\.\s+(.+)\n([\s\S]*?)(?=\n###\s+s\d+\.|\s*$)/g;
  let match;
  while ((match = stepRe.exec(stepsBlock))) {
    const body = match[3].trim();
    const done = (body.match(/Say "done" when:\s*(.+)/i) || [])[1] || 'the action is finished';
    const how = body.replace(/Say "done" when:[\s\S]*/i, '').trim();
    steps.push({ id: match[1], title: match[2].trim(), how, done: done.trim() });
  }
  return {
    slug,
    name: nameMatch ? nameMatch[1].trim() : slug,
    setup: bullets(setup),
    safety: bullets(safety),
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

Safety, always:
- This is practice, not certification. A nurse still certifies skills.
- Never have the caller lift, catch, or lower a real person who needs care. Use a pillow, stuffed animal, willing uninjured roommate, or talk-through.
- Stop if anything hurts, feels unsafe, or the space is cluttered or wet.
- For falls: never practice a real fall. Use pillows on the floor.
- For stairs and showers: skip the physical move if there is no railing, the floor is wet, or they live alone with no spotter. Talk through the step instead.

How you run the call:
1. Greet and ask which one skill they want. Do not name any skill yourself. Do not call choose_skill until the caller has clearly said a skill name. Never guess, never pick a default, never use an example from this prompt as their choice.
2. When they name it, call choose_skill. That starts the nurse demonstration. Tell them to watch, then say they are done when they have seen enough. Do not wait for the video to finish on its own.
3. When they say they are done, finished, or stop during the demonstration, call caller_done. That stops the video and its audio, then starts recording. Tell them to stay in FaceTime Video and do the skill, then say they are done.
4. When they say they are done during recording, call caller_done again. That grades the recording the same way as the web app (Gemini) and shows suggestions on the picture. Summarize the suggestions in spoken words.
5. Then offer exactly three choices: end the call, record again, or practice another skill.
6. End the call: call end_call. Record again: call rerecord. Another skill: call choose_skill with the new name.
7. Coach only one skill at a time. Never walk through all nine.

Available skills:
${list}

Skill scripts:

${body}`;
}
