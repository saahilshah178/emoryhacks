"""Prompt text for the classify stage, kept apart from the post-processing code."""
from __future__ import annotations

CLASSIFY_PROMPT = """\
You are a clinical skills instructor. The video above shows someone performing a caregiving skill.
It is {duration:.0f} seconds long. It may be an edited instructional video (title cards, captions,
narration, camera cuts, close-ups) or a plain single-take webcam recording with no captions or speech.

Decide which caregiving skill the video teaches or shows.

Known skills (slug: name (category). what it looks like):
{catalog}

How to decide:
- Base the decision mainly on what is physically happening: where the people are, what furniture or
  equipment is used (bed, wheelchair, car, stairs, shower, walker, gait belt, gloves) and how bodies move.
  Captions and narration may confirm it, but your answer must still be right if they were absent.
- Pick the skill that the whole video is about, not a brief preparatory or closing moment. Many videos
  start with the person sitting up on the edge of a bed and standing; what happens after standing decides
  the skill:
  * wheelchair_transfer: the chair is placed right beside the bed or seat, and the person turns or pivots
    with only one or two steps before sitting down in it.
  * assisted_walking: the person walks several steps across the room with the caregiver alongside
    (usually holding a gait belt), even if the walk starts at a bed and ends by sitting in a wheelchair.
  * vehicle_transfer and shower_assistance: a car, or a shower, tub or transfer bench, defines the skill
    even when the person walks or is wheeled there first.
  * fall_response: may include walking before the fall and getting the person back up afterwards.
- Use a known slug whenever the video fits it. Only if none fits, invent a short new snake_case slug
  (for example hoyer_lift_transfer) and give it a plain-English name.
- confidence (0 to 1): how sure you are. Lower it when several skills are shown with similar emphasis,
  when the people or the key movement are hard to see, or when the video is very short.
- alternatives: other slugs that are plausible, best first. Leave it empty if nothing else fits.
- summary: one or two sentences saying what is physically done, in plain words. Do not mention captions,
  on-screen text, the narrator, camera work or what anyone is wearing.
- order_matters: true when the steps must happen in a fixed sequence for safety or correctness (for
  example locking wheelchair brakes before standing the person, or removing the first glove before the
  second). False only when the parts can be done in any order.
- category: one of transfer, mobility, positioning, hygiene, infection_control, emergency, other.

People: list every distinct person who appears on camera, once each, labelled P1, P2, ... in order of
first appearance.
- role "caregiver": whoever performs the skill, including an instructor demonstrating it.
- role "patient": whoever is being assisted, including an actor or colleague playing that part.
- role "other": anyone else, such as a narrator speaking to camera who does not take part, or a bystander.
- A solo skill such as glove removal or hand hygiene has one caregiver and no patient. If only hands or
  forearms are visible, still list that one person as the caregiver.
- description: enough for someone to pick the person out of a single still frame: clothing and colours,
  hair, build or approximate age, where they usually are in the frame, and what they do.
- Do not list people who appear only in a photo, poster or title card.
"""
