import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { placePracticeCall, chertHeaders, resolveCallbackDestination, extractPhoneFromText, maskOf, rememberSender, learnFromRecentCalls, reloadCallbackEnv } from './call.mjs';
import { findSkill, findSkills, loadSkills } from './skills.mjs';
import { peekPendingSkill, setPendingSkill } from './pending.mjs';

const API = (process.env.CHERT_API_BASE || 'https://app.trychert.com').replace(/\/$/, '');
const LINE = process.env.CHERT_LINE_ID || '9f048001-c57b-494c-b28c-358bcaa23fa3';
const NUMBER = process.env.CHERT_LINE_NUMBER || '+16282787200';
const seenFile = join(dirname(fileURLToPath(import.meta.url)), '.state', 'seen-messages.json');

function headers() {
  return chertHeaders();
}

function asMessageList(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.messages)) return body.messages;
  if (Array.isArray(body?.data?.items)) return body.data.items;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.items)) return body.items;
  return [];
}

async function listMessages() {
  const auth = headers();
  if (!auth) return [];
  const response = await fetch(`${API}/api/v1/shared-messages`, { headers: auth, signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    await response.body?.cancel();
    return [];
  }
  const body = await response.json().catch(() => ({}));
  return asMessageList(body);
}

async function sendText(recipient, text) {
  const auth = headers();
  if (!auth || !recipient || /[*•]/.test(recipient)) return;
  await fetch(`${API}/api/v1/shared-messages`, {
    method: 'POST',
    headers: { ...auth, 'idempotency-key': randomUUID() },
    body: JSON.stringify({ line_id: LINE, recipient, text }),
    signal: AbortSignal.timeout(15000),
  }).then(res => res.body?.cancel(), () => {});
}

function senderOf(message) {
  return message.sender || message.from || message.recipient || message.phone || message.peer || message.to || '';
}

function textOf(message) {
  const direct = message.text || message.body || message.content || message.value;
  if (direct) return String(direct).trim();
  const parts = message.message?.parts || message.parts || [];
  return parts.map(part => part.value || part.text || '').join(' ').trim();
}

function idOf(message) {
  return String(message.id || message.message_id || `${senderOf(message)}:${textOf(message)}:${message.created_at || ''}`);
}

function isInbound(message) {
  const direction = String(message.direction || '').toLowerCase();
  const state = String(message.state || message.send || '').toLowerCase();
  if (direction === 'outbound' || direction === 'sent') return false;
  if (state === 'sent' || state === 'outbound') return false;
  return direction === 'inbound' || state === 'received' || state === 'inbound';
}

function isOurReply(text) {
  return /^(got it|i can practice|which skill\?|i am facetiming|you are next|to facetime you)/i.test(text.trim());
}

function isPhoneOnly(text) {
  return Boolean(extractPhoneFromText(text) && !/[a-z]/i.test(text.replace(/[\d+\s().-]/g, '')));
}

function namesList(skills) {
  return skills.map(item => item.name).join(', ');
}

async function loadSeen() {
  try {
    const ids = JSON.parse(await readFile(seenFile, 'utf8'));
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

async function saveSeen(seen) {
  await mkdir(dirname(seenFile), { recursive: true });
  await writeFile(seenFile, JSON.stringify([...seen].slice(-300)));
}

export async function watchInbox(skills) {
  const seen = await loadSeen();
  const first = await listMessages();
  const inbound = first.filter(isInbound).sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const latest = inbound[inbound.length - 1];
  const recent = latest && Date.now() - Date.parse(latest.created_at || 0) < 30 * 60 * 1000;
  for (const message of first) {
    const id = idOf(message);
    if (recent && isInbound(message) && id === idOf(latest) && !seen.has(id)) continue;
    seen.add(id);
  }
  await saveSeen(seen);
  if (!headers()) {
    console.log(`[inbox] No CHERT_API_KEY. Texting the line will not queue a skill until a project API key is in .env.local. People can still FaceTime ${NUMBER} and name a skill on the call.`);
    return;
  }
  console.log(`[inbox] Watching iMessage on ${NUMBER}. Text "I want to practice sit to stand" (or another skill); the coach FaceTimes back.`);
  let warnedMissingPhone = false;
  for (;;) {
    await reloadCallbackEnv();
    const messages = await listMessages();
    for (const message of [...messages].reverse()) {
      const id = idOf(message);
      if (seen.has(id)) continue;
      seen.add(id);
      await saveSeen(seen);
      if (!isInbound(message)) continue;
      const text = textOf(message);
      if (!text || isOurReply(text)) continue;
      const mask = maskOf(message);
      if (isPhoneOnly(text)) {
        const phone = extractPhoneFromText(text);
        if (phone) await rememberSender(mask, phone);
        const pending = await peekPendingSkill();
        if (pending) await dialSkill(skills, pending, phone, message);
        continue;
      }
      const dest = await resolveCallbackDestination(senderOf(message), message) || await learnFromRecentCalls(mask);
      const matches = findSkills(skills, text);
      const skill = findSkill(skills, text);
      if (matches.length > 1 && skill && !text.toLowerCase().includes(skill.name.toLowerCase()) && !text.toLowerCase().includes(skill.slug.replace(/_/g, ' '))) {
        await sendText(dest?.destination, `Which skill? Text one of: ${matches.map(item => item.name).join(', ')}`);
        continue;
      }
      if (!skill) {
        await sendText(dest?.destination, `I can practice one skill at a time. Text something like "I want to practice sit to stand". Skills: ${namesList(skills)}`);
        continue;
      }
      await dialSkill(skills, skill, dest, message);
    }
    const pending = await peekPendingSkill();
    if (pending) {
      const dest = await resolveCallbackDestination(pending.from, { masked_recipient: pending.mask }) || await learnFromRecentCalls(pending.mask);
      if (dest) await dialSkill(skills, pending, dest, { masked_recipient: pending.mask }, { once: true });
      else if (!warnedMissingPhone) {
        warnedMissingPhone = true;
        console.log('[inbox] Skill is queued for the number that texted. Chert masks that number on the API. FaceTime this line once from that iPhone so we can learn it, then text the skill again.');
      }
    }
    await pause(4000);
  }
}

let lastDialKey = '';

async function dialSkill(skills, requested, dest, message, { once = false } = {}) {
  const skill = findSkill(skills, requested.slug || requested.name) || requested;
  if (!skill?.slug) return;
  const mask = maskOf(message) || requested.mask;
  const resolved = dest?.destination_type === 'phone'
    ? dest
    : await resolveCallbackDestination(dest?.destination || dest, message);
  if (!resolved) {
    await setPendingSkill({ slug: skill.slug, name: skill.name, mask });
    console.log(`[inbox] Queued ${skill.slug} for the number that texted; waiting until that phone is known.`);
    return;
  }
  await rememberSender(mask, resolved);
  const dialKey = `${skill.slug}:${mask || resolved.destination}`;
  if (once && dialKey === lastDialKey) return;
  lastDialKey = dialKey;
  try {
    const call = await placePracticeCall({
      skill,
      from: resolved,
      message,
      onRoom: room => setPendingSkill({ slug: skill.slug, name: skill.name, from: resolved.destination, mask, room }),
    });
    await sendText(resolved.destination, `Got it — ${skill.name}. I am FaceTiming you now with the demonstration.`);
    console.log(`[inbox] FaceTiming the number that texted for ${skill.slug}`);
  } catch (error) {
    await setPendingSkill({ slug: skill.slug, name: skill.name, from: resolved.destination, mask });
    await sendText(resolved.destination, `Got it — ${skill.name}. I could not place the FaceTime just now. FaceTime ${NUMBER} and I will coach that skill.`);
    console.log(`[inbox] Queued ${skill.slug}; outbound call failed: ${error.message}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('inbox.mjs')) {
  const skills = await loadSkills();
  await watchInbox(skills);
}
