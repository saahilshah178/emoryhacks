import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'reference_vids');

const FILES = {
  wheelchair_transfer: 'wheelchairprimary.mp4',
  sit_to_stand: 'sittostand_primary.mp4',
  vehicle_transfer: 'Vehicle Transfer Primary (1).mp4',
  bed_repositioning: 'bedrepositioning primary.mp4',
  assisted_walking: 'Assisted Walking Primary.mp4',
  stair_assistance: 'Stair Assistance Primary (1).mp4',
  fall_response: 'Fall Response Primary.mp4',
  shower_assistance: 'Shower Assistance Primary.mp4',
  glove_removal: 'Glove Removal Primary.mp4',
};

export async function demoPath(slug) {
  const name = FILES[slug];
  if (!name) return null;
  const path = join(root, name);
  try {
    await access(path);
    return path;
  } catch {
    return null;
  }
}
