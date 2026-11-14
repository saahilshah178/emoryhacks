"""Hand-written rubrics and timelines for evaluate-stage tests and backend/scripts/try_evaluate.py.

The rubric and timeline stages are built on other branches, so these stand in for them.
Step times were read off frames of the reference videos. The evals describe only what a
plain webcam recording would show (no captions, cuts or instructor details)."""
from __future__ import annotations

from app.models import Rubric, RubricStep, StepEval, Timeline, TimelineStep

OUT_OF_VIEW = "The caregiver's hands or the patient's feet are out of frame or blocked from view."


def _step(i, title, description, start, end, critical, passes, fails, unverified, cues) -> RubricStep:
    return RubricStep(
        step_id=f"s{i}", order=i, title=title, description=description, start_s=start, end_s=end,
        critical=critical, order_dependent=True, must_follow=[f"s{i - 1}"] if i > 1 else [],
        evals=StepEval(pass_criteria=passes, fail_criteria=fails, unverified_when=unverified, visual_cues=cues),
    )


# sittostand_primary.mp4 (62 s): 0-5 title card, 5-50 the transfer, 50-62 a replay from another angle.
SIT_TO_STAND_SKILL = {"name": "Sit to stand", "slug": "sit_to_stand",
                      "summary": "One caregiver helps a seated person rise from a chair to standing."}
SIT_TO_STAND = Rubric(
    order_matters=True,
    safety_criteria=[
        "The patient stays centred over their feet while rising and standing.",
        "The patient does not lean sideways, slide forward off the chair, or have their knees buckle.",
        "The caregiver does not pull the patient up by the arms.",
    ],
    steps=[
        _step(1, "Greet and explain", "Face the patient, greet them and explain that you will help them stand.",
              5, 10, False,
              ["The caregiver faces the patient and speaks to them before any physical help begins."],
              ["The caregiver starts moving the patient without saying anything to them."],
              ["There is no audio and the caregiver's face is not visible."],
              ["Caregiver standing beside or in front of the seated patient, talking."]),
        _step(2, "Hands on the armrests", "Ask the patient to place their hands on the chair's armrests.",
              10, 13, False,
              ["The patient's hands rest on the armrests before rising."],
              ["The patient rises with their hands on the caregiver, in their lap or around the caregiver's neck."],
              ["The patient's hands are out of frame."],
              ["Patient's hands moving to the armrests."]),
        _step(3, "Shuffle to the front of the seat", "Have the patient move their bottom forward to the front edge of the chair.",
              13, 20, False,
              ["The patient shifts forward so they sit near the front edge of the seat."],
              ["The patient tries to stand while sitting at the back of the seat."],
              ["The chair seat and the patient's hips are not visible."],
              ["Patient wriggling forward on the seat."]),
        _step(4, "Feet back and hip-width apart", "Have the patient tuck their feet back under their knees, hip-width apart.",
              20, 28, True,
              ["The patient's feet are flat on the floor, tucked back under or slightly behind the knees, about hip-width apart."],
              ["The patient rises with feet stretched out in front of the knees or pressed together."],
              [OUT_OF_VIEW],
              ["Caregiver pointing to or guiding the patient's feet; patient sliding feet back."]),
        _step(5, "Supportive hand placement", "Stand beside the patient, one hand in front of their shoulder and the other around their back or hip.",
              28, 33, True,
              ["The caregiver stands close beside the patient with one hand at the front of the near shoulder and the other across the back or at the hip."],
              ["The caregiver holds the patient's arms or hands to pull them up.",
               "The caregiver stands directly in front of the patient blocking them from rising."],
              [OUT_OF_VIEW],
              ["Caregiver moving to the patient's side and placing both hands."]),
        _step(6, "Rock and stand on a count", "Ask the patient to look ahead and lean forward, then rise on a 'ready, steady, stand' count.",
              33, 47, True,
              ["The caregiver gives a count or cue and the patient leans forward and rises to standing in one controlled movement with the caregiver supporting."],
              ["The patient is lifted or pulled up without leaning forward.",
               "The caregiver lets go during the rise or the patient drops back into the chair."],
              ["The rise is not visible because the patient or caregiver is out of frame."],
              ["Patient leaning forward, then rising from the chair."]),
        _step(7, "Check balance once standing", "Keep a supporting hand on the patient and check they are steady before moving on.",
              47, 50, False,
              ["Once upright, the caregiver keeps a hand on the patient for a moment while the patient stands steady."],
              ["The caregiver lets go immediately and steps away while the patient is still unsteady."],
              ["The video ends as the patient reaches standing."],
              ["Both standing, caregiver's hand still on the patient's shoulder or back."]),
    ],
)

SIT_TO_STAND_TIMELINE = Timeline(steps=[
    TimelineStep(step_id=s.step_id, found=True, start_s=s.start_s, end_s=s.end_s, performed_index=s.order, confidence=0.8)
    for s in SIT_TO_STAND.steps
])

# Glove Removal Primary.mp4 (70 s): 0-10 intro, 10-24 putting gloves on, 24-60 taking them off,
# 60-62 hand washing (a cut-away), 62-70 outro.
GLOVE_SKILL = {"name": "Glove removal", "slug": "glove_removal",
               "summary": "Taking off contaminated disposable gloves without touching their outside with bare skin."}
GLOVE_REMOVAL = Rubric(
    order_matters=True,
    safety_criteria=["Bare skin never touches the outside of a used glove."],
    steps=[
        _step(1, "Pinch the first glove at the wrist", "With one gloved hand, pinch the outside of the other glove at the palm or wrist.",
              29, 36, True,
              ["Gloved fingers grip only the outside of the other glove near the wrist or palm."],
              ["The caregiver pulls the first glove off by its fingertips or touches skin above the cuff."],
              ["The hands are out of frame or hidden behind the body."],
              ["One gloved hand pinching the other at the wrist."]),
        _step(2, "Peel the first glove off inside out", "Peel the first glove away from the wrist toward the fingers so it turns inside out.",
              36, 41, True,
              ["The first glove comes off turned inside out, and is held in the remaining gloved hand."],
              ["The glove is snapped or flicked off, or the now-bare hand touches its outside."],
              ["The hands are out of frame or hidden behind the body."],
              ["A glove rolling off inside out."]),
        _step(3, "Hold the removed glove in the gloved hand", "Ball the removed glove up in the palm of the hand that is still gloved.",
              41, 47, False,
              ["The removed glove is held balled up in the gloved hand's palm."],
              ["The removed glove is dropped, put down on a surface, or held in the bare hand."],
              ["The hands are out of frame or hidden behind the body."],
              ["A gloved fist holding the removed glove."]),
        _step(4, "Slide bare fingers inside the second cuff", "Slide the bare fingers under the cuff of the remaining glove, touching only its inside.",
              47, 53, True,
              ["Bare fingers slip under the cuff of the remaining glove at the wrist without touching its outside."],
              ["The bare hand grabs the outside of the remaining glove."],
              ["The wrists are out of frame or the view of the cuff is blocked."],
              ["Bare finger hooking inside the wrist of the remaining glove."]),
        _step(5, "Peel the second glove over the first", "Peel the second glove off inside out so it encloses the first, then discard both.",
              53, 60, True,
              ["The second glove is peeled off inside out over the balled first glove, leaving both in one bundle that is discarded."],
              ["The second glove is pulled off by the fingertips, or the bare hand touches its outside."],
              ["The hands are out of frame or hidden behind the body."],
              ["Second glove turning inside out around the first."]),
        _step(6, "Hand hygiene", "Wash hands or use hand sanitiser straight after removing the gloves.",
              60, 62, False,
              ["The caregiver washes their hands at a sink or rubs in hand sanitiser after the gloves are off."],
              ["The caregiver moves on to other tasks without cleaning their hands."],
              ["The recording ends right after the gloves come off."],
              ["Hands under running water or rubbing sanitiser."]),
    ],
)

GLOVE_TIMELINE = Timeline(steps=[
    TimelineStep(step_id=s.step_id, found=True, start_s=s.start_s, end_s=s.end_s, performed_index=s.order, confidence=0.8)
    for s in GLOVE_REMOVAL.steps
])

# A glove attempt cut from the reference that stops after the first glove and jumps to the
# hand washing: steps s4 and s5 (both critical) are never performed.
GLOVE_MISSING_SEGMENTS = [(24.0, 47.0), (60.5, 62.5)]
GLOVE_MISSING_TIMELINE = Timeline(
    steps=[
        TimelineStep(step_id="s1", found=True, start_s=5, end_s=12, performed_index=1, confidence=0.8),
        TimelineStep(step_id="s2", found=True, start_s=12, end_s=17, performed_index=2, confidence=0.8),
        TimelineStep(step_id="s3", found=True, start_s=17, end_s=23, performed_index=3, confidence=0.8),
        TimelineStep(step_id="s4", found=False, confidence=0.6, note="not seen"),
        TimelineStep(step_id="s5", found=False, confidence=0.6, note="not seen"),
        TimelineStep(step_id="s6", found=True, start_s=23, end_s=25, performed_index=4, confidence=0.7),
    ],
    missing_step_ids=["s4", "s5"],
)
