import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AccessToken, AgentDispatchClient, RoomServiceClient } from 'livekit-server-sdk';

const PROJECT = process.env.CHERT_PROJECT_ID || '2e897612-3ffd-4f01-bdf8-27f60d3c8981';
const LINE = process.env.CHERT_LINE_ID || '9f048001-c57b-494c-b28c-358bcaa23fa3';
const AGENT = process.env.AGENT_NAME || 'caregiver-coach';
const MESSAGES = (process.env.CHERT_API_BASE || 'https://app.trychert.com').replace(/\/$/, '');
const CALLS = (process.env.CHERT_CALLS_BASE || 'https://facetime.trychert.com').replace(/\/$/, '');

const filled = value => Boolean(value) && !/^(wss:\/\/)?YOUR_|changeme/i.test(String(value));
const here = dirname(fileURLToPath(import.meta.url));
const callbackFile = join(here, '.state', 'callback.json');
const sendersFile = join(here, '.state', 'senders.json');
const envFile = join(here, '.env.local');

export function chertHeaders() {
  const key = process.env.CHERT_API_KEY;
  if (!filled(key)) return null;
  return {
    authorization: `Bearer ${key}`,
    'x-chert-project-id': PROJECT,
    'content-type': 'application/json',
  };
}

function livekitHttpUrl(url) {
  return String(url).replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
}

export function destinationFromSender(sender) {
  const value = String(sender || '').trim();
  if (!value || /[*•]/.test(value)) return null;
  if (value.includes('@')) return { destination: value, destination_type: 'email' };
  const digits = value.replace(/[^\d+]/g, '');
  if (digits.startsWith('+') && digits.length >= 11) return { destination: digits, destination_type: 'phone' };
  const justDigits = value.replace(/\D/g, '');
  if (justDigits.length === 11 && justDigits.startsWith('1')) return { destination: `+${justDigits}`, destination_type: 'phone' };
  if (justDigits.length === 10) return { destination: `+1${justDigits}`, destination_type: 'phone' };
  return null;
}

export async function reloadCallbackEnv() {
  try {
    const text = await readFile(envFile, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq);
      let value = trimmed.slice(eq + 1);
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key === 'CHERT_CALLBACK_NUMBER') process.env[key] = value;
    }
  } catch {
    /* .env.local is optional after process start */
  }
}

export function extractPhoneFromText(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const direct = destinationFromSender(raw);
  if (direct?.destination_type === 'phone') return direct;
  const match = raw.match(/(?:\+|00)?1?[\s().-]*\d{3}[\s().-]*\d{3}[\s().-]*\d{4}/);
  const fromMatch = destinationFromSender(match?.[0] || '');
  return fromMatch?.destination_type === 'phone' ? fromMatch : null;
}

async function loadSavedCallback() {
  try {
    const data = JSON.parse(await readFile(callbackFile, 'utf8'));
    const dest = destinationFromSender(data.destination);
    return dest?.destination_type === 'phone' ? dest : null;
  } catch {
    return null;
  }
}

export async function saveCallback(dest) {
  if (!dest || dest.destination_type !== 'phone') return dest;
  await mkdir(dirname(callbackFile), { recursive: true });
  await writeFile(callbackFile, JSON.stringify({ destination_type: 'phone', destination: dest.destination }));
  return dest;
}

async function loadSenders() {
  try {
    const data = JSON.parse(await readFile(sendersFile, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

export async function rememberSender(mask, dest) {
  const phone = dest?.destination_type === 'phone' ? dest : destinationFromSender(dest) || extractPhoneFromText(dest);
  if (!phone || phone.destination_type !== 'phone') return null;
  await saveCallback(phone);
  const key = String(mask || '').trim();
  if (key) {
    const senders = await loadSenders();
    senders[key] = phone.destination;
    await mkdir(dirname(sendersFile), { recursive: true });
    await writeFile(sendersFile, JSON.stringify(senders));
  }
  return phone;
}

export async function rememberCallerIdentity(mask, participant) {
  const values = [
    participant?.identity,
    participant?.attributes?.phone,
    participant?.attributes?.from,
    participant?.metadata,
  ];
  for (const value of values) {
    const dest = destinationFromSender(value) || extractPhoneFromText(value);
    if (dest?.destination_type === 'phone') return rememberSender(mask, dest);
  }
  return null;
}

export async function learnFromRecentCalls(mask) {
  const auth = chertHeaders();
  if (!auth) return null;
  for (const base of [CALLS, MESSAGES]) {
    const response = await fetch(`${base}/api/v1/calls?limit=20`, { headers: auth, signal: AbortSignal.timeout(15000) });
    const payload = await response.json().catch(() => ({}));
    const items = payload?.data?.items || payload?.items || [];
    for (const item of items) {
      const dest = destinationFromMessage(item) || destinationFromSender(item?.from?.value || item?.from);
      if (dest?.destination_type === 'phone') return rememberSender(mask || maskOf(item), dest);
    }
    if (response.ok) break;
  }
  return null;
}

export function maskOf(message) {
  return String(message?.masked_recipient || message?.masked_identity || '').trim();
}

export function destinationFromMessage(message, text = '') {
  const values = [
    message?.sender,
    message?.from?.value,
    message?.from,
    message?.recipient,
    message?.phone,
    message?.peer,
    message?.to,
    message?.handle,
    message?.unmasked_recipient,
    message?.sender_handle?.handle,
    message?.from_handle,
    ...(Array.isArray(message?.handles) ? message.handles.map(item => item?.handle || item?.value || item) : []),
  ];
  for (const value of values) {
    const dest = destinationFromSender(value);
    if (dest?.destination_type === 'phone') return dest;
  }
  return extractPhoneFromText(text) || extractPhoneFromText(values.filter(Boolean).join(' '));
}

export async function resolveCallbackDestination(sender, message) {
  await reloadCallbackEnv();
  const fromThisText = destinationFromMessage(message, sender) || destinationFromSender(sender) || extractPhoneFromText(sender);
  if (fromThisText?.destination_type === 'phone') return rememberSender(maskOf(message), fromThisText);
  const mask = maskOf(message);
  if (mask) {
    const senders = await loadSenders();
    const remembered = destinationFromSender(senders[mask]);
    if (remembered?.destination_type === 'phone') return remembered;
  }
  const fromEnv = destinationFromSender(process.env.CHERT_CALLBACK_NUMBER || '');
  if (fromEnv?.destination_type === 'phone') return rememberSender(mask, fromEnv);
  return loadSavedCallback();
}

async function mintBridgeToken(roomName, identity) {
  const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity,
    ttl: '90m',
  });
  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  return token.toJwt();
}

async function waitForAgent(rooms, roomName) {
  for (let i = 0; i < 40; i++) {
    const participants = await rooms.listParticipants(roomName).catch(() => []);
    const agent = participants.find(item => item.kind === 4 || String(item.kind).toUpperCase() === 'AGENT' || item.identity === AGENT);
    if (agent?.identity) return agent.identity;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return AGENT;
}

export async function placePracticeCall({ skill, from, message, onRoom }) {
  const auth = chertHeaders();
  if (!auth) throw new Error('CHERT_API_KEY is missing. Put a project API key in .env.local; do not paste it into chat.');
  if (!['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'].every(key => filled(process.env[key]))) {
    throw new Error('LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET are required to FaceTime someone back.');
  }
  const dest = from?.destination_type === 'phone'
    ? from
    : await resolveCallbackDestination(from, message);
  if (!dest || dest.destination_type !== 'phone') {
    throw new Error('Chert hid the texter’s number. FaceTime the line once so we can learn it, or put that iPhone number in .env.local as CHERT_CALLBACK_NUMBER. Do not paste it into chat.');
  }
  await rememberSender(maskOf(message), dest);

  const roomName = `practice-${skill.slug}-${randomUUID()}`;
  const bridgeIdentity = `chert-bridge-${roomName}`;
  if (onRoom) await onRoom(roomName);
  const rooms = new RoomServiceClient(livekitHttpUrl(process.env.LIVEKIT_URL), process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
  const dispatch = new AgentDispatchClient(livekitHttpUrl(process.env.LIVEKIT_URL), process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);

  await rooms.createRoom({ name: roomName, emptyTimeout: 300, maxParticipants: 8 });
  await dispatch.createDispatch(roomName, AGENT, { metadata: JSON.stringify({ skill: skill.slug, from: dest.destination_type }) });
  const agentIdentity = await waitForAgent(rooms, roomName);
  const participantToken = await mintBridgeToken(roomName, bridgeIdentity);

  const body = {
    direction: 'outbound',
    mode: 'customer_managed',
    line_id: LINE,
    destination: dest.destination,
    destination_type: dest.destination_type,
    media: { audio: true, video: true },
    livekit_url: process.env.LIVEKIT_URL,
    participant_token: participantToken,
    remote_participant_identity: agentIdentity,
    when_busy: 'queue',
  };
  const key = `call-${roomName}`.slice(0, 200);
  const { response, payload } = await createCall(auth, key, body);
  if (!response.ok) {
    const detail = payload?.error?.code || payload?.error?.message || `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return { room: roomName, callId: payload?.data?.id || payload?.id || null, queued: false, agentIdentity, destinationType: dest.destination_type };
}

async function postCall(url, auth, key, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...auth, 'idempotency-key': key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function queueIdOf(payload) {
  return payload?.data?.queue_id || payload?.queue_id || payload?.data?.id || payload?.id || null;
}

async function readQueue(auth, id) {
  for (const base of [CALLS, MESSAGES]) {
    const response = await fetch(`${base}/api/v1/calls/queue/${id}`, { headers: auth, signal: AbortSignal.timeout(15000) });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) return payload?.data || payload;
  }
  return null;
}

async function waitForBusyQueue(auth, key, body, first) {
  const id = queueIdOf(first.payload);
  console.log(`[call] Line busy${id ? '' : ` (HTTP ${first.response.status})`}; waiting, then placing the FaceTime.`);
  const deadline = Date.now() + 130000;
  while (Date.now() < deadline) {
    if (id) {
      const place = await readQueue(auth, id);
      const state = String(place?.state || '').toLowerCase();
      if (state === 'ready') return postCall(`${CALLS}/api/v1/calls`, auth, key, body);
      if (['expired', 'cancelled', 'failed', 'ended'].includes(state)) {
        throw new Error(place?.error?.code || `queue_${state}`);
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
      continue;
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
    const retry = await postCall(`${CALLS}/api/v1/calls`, auth, key, body);
    if (retry.response.ok && retry.response.status !== 202) return retry;
    const code = retry.payload?.error?.code;
    if (!retry.response.ok && retry.response.status !== 202 && code && !/line_(in_use|busy)|call_queue/i.test(String(code))) {
      return retry;
    }
  }
  throw new Error('queue_timeout');
}

async function createCall(auth, key, body) {
  let result = await postCall(`${CALLS}/api/v1/calls`, auth, key, body);
  if (result.response.status === 404) {
    result = await postCall(`${MESSAGES}/api/v1/calls`, auth, key, body);
  }
  if (result.response.status === 202) {
    result = await waitForBusyQueue(auth, key, body, result);
  }
  return result;
}
