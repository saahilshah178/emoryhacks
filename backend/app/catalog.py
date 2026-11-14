"""Known caregiving skills. The classifier is shown this list and should return one
of these slugs when a video fits; it may invent a new snake_case slug otherwise."""
from __future__ import annotations

import re

CATALOG: list[dict] = [
    {"slug": "wheelchair_transfer", "name": "Wheelchair transfer", "category": "transfer",
     "hint": "moving a person between a bed or chair and a wheelchair, often with a gait belt and a pivot"},
    {"slug": "sit_to_stand", "name": "Sit to stand", "category": "transfer",
     "hint": "helping a seated person rise to standing"},
    {"slug": "vehicle_transfer", "name": "Vehicle transfer", "category": "transfer",
     "hint": "moving a person between a wheelchair or walker and a car seat"},
    {"slug": "bed_repositioning", "name": "Bed repositioning", "category": "positioning",
     "hint": "turning or moving a person up in bed, using a draw sheet or pillows"},
    {"slug": "assisted_walking", "name": "Assisted walking", "category": "mobility",
     "hint": "walking with a person using a gait belt, walker or cane on level ground"},
    {"slug": "stair_assistance", "name": "Stair assistance", "category": "mobility",
     "hint": "helping a person go up or down stairs"},
    {"slug": "fall_response", "name": "Fall response", "category": "emergency",
     "hint": "controlling a fall in progress or helping a person who has fallen"},
    {"slug": "shower_assistance", "name": "Shower assistance", "category": "hygiene",
     "hint": "helping a person into, in or out of a shower or tub, including a transfer bench"},
    {"slug": "glove_removal", "name": "Glove removal", "category": "infection_control",
     "hint": "taking off contaminated disposable gloves without touching the outside"},
    {"slug": "hand_hygiene", "name": "Hand hygiene", "category": "infection_control",
     "hint": "washing hands with soap and water or using sanitizer"},
]

BY_SLUG = {c["slug"]: c for c in CATALOG}

# Reference videos in reference_vids/ mapped to their canonical skill.
REFERENCE_FILES: dict[str, dict[str, str | None]] = {
    "wheelchair_transfer": {"primary": "wheelchairprimary.mp4", "backup": "wheelchairbackup.mp4"},
    "sit_to_stand": {"primary": "sittostand_primary.mp4", "backup": None},
    "vehicle_transfer": {"primary": "Vehicle Transfer Primary (1).mp4", "backup": "Vehicle Transfer Backup.mp4"},
    "bed_repositioning": {"primary": "bedrepositioning primary.mp4", "backup": "Bed Repositioning Backup.mp4"},
    "assisted_walking": {"primary": "Assisted Walking Primary.mp4", "backup": "Assisted Walking Backup.mp4"},
    "stair_assistance": {"primary": "Stair Assistance Primary (1).mp4", "backup": "Stair Assistance Backup.mp4"},
    "fall_response": {"primary": "Fall Response Primary.mp4", "backup": "Fall Response Backup.mp4"},
    "shower_assistance": {"primary": "Shower Assistance Primary.mp4", "backup": "Shower Assistance Backup.mp4"},
    "glove_removal": {"primary": "Glove Removal Primary.mp4", "backup": None},
}


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", (text or "").lower()).strip("_")
    return slug or "unknown_skill"


def catalog_prompt() -> str:
    return "\n".join(f"- {c['slug']}: {c['name']} ({c['category']}). {c['hint']}" for c in CATALOG)
