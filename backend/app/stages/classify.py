"""Stage: classify. Decide which caregiving maneuver a video shows.

One Gemini call on the main model returns the skill, a short summary and the people
in the video. Everything the model returns is then normalised in code: slugs are
mapped onto the catalog, confidence is clamped and person labels are made unique,
because structured output does not enforce ranges or uniqueness.
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from .. import catalog, config, gemini
from ..models import Classification, PersonObs, Role
from . import _fake
from .classify_prompts import CLASSIFY_PROMPT

CATEGORIES = {"transfer", "mobility", "positioning", "hygiene", "infection_control", "emergency", "other"}

# Near-miss slugs the model may invent, mapped onto the catalog slug they mean. Only names
# for the same skill belong here: a broader or different procedure (full PPE doffing, fall
# prevention) keeps its own slug, so it is not filed as a version of a narrower skill.
ALIASES: dict[str, str] = {
    # wheelchair_transfer
    "bed_to_wheelchair_transfer": "wheelchair_transfer",
    "wheelchair_to_bed_transfer": "wheelchair_transfer",
    "chair_to_wheelchair_transfer": "wheelchair_transfer",
    "stand_pivot_transfer": "wheelchair_transfer",
    "pivot_transfer": "wheelchair_transfer",
    "bed_to_chair_transfer": "wheelchair_transfer",
    "gait_belt_transfer": "wheelchair_transfer",
    # sit_to_stand
    "sit_to_stand_assist": "sit_to_stand",
    "sit_to_stand_transfer": "sit_to_stand",
    "assisted_sit_to_stand": "sit_to_stand",
    "chair_rise": "sit_to_stand",
    "stand_up_assistance": "sit_to_stand",
    # vehicle_transfer
    "car_transfer": "vehicle_transfer",
    "wheelchair_to_car_transfer": "vehicle_transfer",
    "car_to_wheelchair_transfer": "vehicle_transfer",
    # bed_repositioning
    "repositioning_in_bed": "bed_repositioning",
    "bed_positioning": "bed_repositioning",
    "turning_in_bed": "bed_repositioning",
    "moving_up_in_bed": "bed_repositioning",
    "draw_sheet_repositioning": "bed_repositioning",
    "log_roll": "bed_repositioning",
    # assisted_walking
    "gait_belt_ambulation": "assisted_walking",
    "assisted_ambulation": "assisted_walking",
    "ambulation_assistance": "assisted_walking",
    "walking_assistance": "assisted_walking",
    "ambulation": "assisted_walking",
    # stair_assistance
    "stair_climbing": "stair_assistance",
    "stair_negotiation": "stair_assistance",
    "assisted_stair_climbing": "stair_assistance",
    "stairs": "stair_assistance",
    # fall_response
    "controlled_fall": "fall_response",
    "fall_recovery": "fall_response",
    "assisting_a_falling_patient": "fall_response",
    "lowering_to_floor": "fall_response",
    # shower_assistance
    "shower_transfer": "shower_assistance",
    "tub_transfer": "shower_assistance",
    "transfer_bench": "shower_assistance",
    "bathing_assistance": "shower_assistance",
    # glove_removal
    "doffing_gloves": "glove_removal",
    "glove_doffing": "glove_removal",
    "removing_gloves": "glove_removal",
    # hand_hygiene
    "hand_washing": "hand_hygiene",
    "handwashing": "hand_hygiene",
    "hand_sanitizing": "hand_hygiene",
}

# Above this length the frame rate is lowered so a video costs at most this many frames.
MAX_FRAMES = 150


class _Person(BaseModel):
    label: str = Field(description="P1, P2, ... in order of first appearance")
    role: Role
    description: str = Field(description="clothing colours, hair, build, where they are, what they do")


class _Reply(BaseModel):
    """What the model is asked for. observed comes first so the choice is made after describing the video."""

    observed: str = Field(description="2 to 4 sentences: what physically happens, in order")
    skill_slug: str
    skill_name: str
    category: str
    confidence: float = Field(description="0 to 1")
    alternatives: list[str] = Field(description="other plausible slugs, best first")
    summary: str
    order_matters: bool
    people: list[_Person]


def run(ctx) -> Classification:
    """Classify ctx's video. ctx.slug_hint is never shown to the model; a mismatch is only logged."""
    if config.FAKE_AI:
        return _fake.classification(ctx)
    duration = ctx.duration
    prompt = CLASSIFY_PROMPT.format(duration=duration, catalog=catalog.catalog_prompt())
    parts = [ctx.video_part(resolution="low", fps=sample_fps(duration)), gemini.text_part(prompt)]
    reply = ctx.generate_json("classify", parts, _Reply, model="main", thinking="low")
    result = postprocess(reply)
    if ctx.slug_hint and ctx.slug_hint != result.skill_slug:
        ctx.log(f"classify: expected {ctx.slug_hint}, model said {result.skill_slug} ({result.confidence:.2f})")
    return result


def sample_fps(duration: float) -> float | None:
    """Frames per second to send. None keeps the default of 1; long videos get fewer frames."""
    if duration <= MAX_FRAMES:
        return None
    return round(MAX_FRAMES / duration, 3)


def canonical_slug(raw: str) -> str:
    """Slugify raw and map a known near-miss onto its catalog slug."""
    slug = catalog.slugify(raw)
    return ALIASES.get(slug, slug)


def clamp_confidence(value: float) -> float:
    """Clamp to 0..1 and round to two places."""
    return round(min(1.0, max(0.0, float(value))), 2)


def unique_people(people: list[_Person]) -> list[PersonObs]:
    """Keep each person, giving a fresh P<n> label to any blank or repeated one."""
    used: set[str] = set()
    out = []
    for p in people:
        label = p.label.strip().upper()
        if not label or label in used:
            n = 1
            while f"P{n}" in used:
                n += 1
            label = f"P{n}"
        used.add(label)
        out.append(PersonObs(label=label, role=p.role, description=p.description.strip()))
    return out


def postprocess(reply: _Reply) -> Classification:
    """Turn the raw model reply into a Classification with catalog-aligned values."""
    slug = canonical_slug(reply.skill_slug)
    known = catalog.BY_SLUG.get(slug)
    if known:
        name, category = known["name"], known["category"]
    else:
        name = reply.skill_name.strip() or slug.replace("_", " ").capitalize()
        category = catalog.slugify(reply.category)
        category = category if category in CATEGORIES else "other"

    alternatives: list[str] = []
    for alt in reply.alternatives:
        alt = canonical_slug(alt)
        if alt != slug and alt not in alternatives and alt != "unknown_skill":
            alternatives.append(alt)

    return Classification(
        skill_slug=slug,
        skill_name=name,
        category=category,
        confidence=clamp_confidence(reply.confidence),
        summary=reply.summary.strip(),
        people=unique_people(reply.people),
        order_matters=reply.order_matters,
        alternatives=alternatives[:3],
    )
