import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = join(dirname(fileURLToPath(import.meta.url)), '.state', 'pending-skill.json');

export async function setPendingSkill(payload) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ ...payload, consumed: false, at: new Date().toISOString() }, null, 2));
}

export async function takePendingSkill(roomName) {
  const data = await peekPendingSkill(roomName);
  if (!data) return null;
  await writeFile(file, JSON.stringify({ ...data, consumed: true }, null, 2));
  return data;
}

export async function peekPendingSkill(roomName) {
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    if (data.consumed) return null;
    if (data.room && roomName && data.room !== roomName) return null;
    return data;
  } catch {
    return null;
  }
}
