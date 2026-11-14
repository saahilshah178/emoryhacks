"""Harbor Home Care, the sample agency: the data that scripts/seed_sample.py loads.

This is the former front-end mock data (frontend/landing/src/nurse/lib/mock-data.ts and
frontend/landing/src/caregiver/data/*.ts) merged into one dataset:

  * one skill library of 9 skills shared by the nurse dashboard and the caregiver portal;
  * one canonical step list per skill (the nurse mock's detected steps and the caregiver
    mock's steps merged; "s1".."sN");
  * every attempt the mock implies, so that the states the API derives from stored rows
    (app/progress.py, app/routers/people.py) match what the mock showed.

Times are written as mock wall-clock strings ("2026-11-13T14:14"); the mock's "now" is
MOCK_NOW. The loader shifts every one of them by (real now - MOCK_NOW).

Statuses inside this file use the mock's words (passed / needs_review / failed /
needs_improvement, critical / moderate); STATUS and SEVERITY map them to the database's.
"""
from __future__ import annotations

import datetime as dt
import uuid

NAMESPACE = uuid.UUID("6f1c3a52-7d4e-5b8a-9c21-4e0d8b7a1f30")
MOCK_NOW = dt.datetime(2026, 11, 13, 14, 32)
ORG_NAME = "Harbor Home Care"
ORG_CREATED = "2024-06-01T09:00"
DOMAIN = "harborhomecare.example"

STATUS = {"passed": "passed", "needs_review": "unverified", "needs_improvement": "unverified",
          "failed": "failed"}
AI_STATUS = {"passed": "passed", "needs_review": "unverified", "safety_concern": "failed"}
SEVERITY = {"critical": "high", "moderate": "medium", "minor": "low"}
CONFIDENCE = {"passed": 0.9, "unverified": 0.6, "failed": 0.85}


def uid(key: str) -> uuid.UUID:
    """The stable id of a sample row."""
    return uuid.uuid5(NAMESPACE, key)


def mock_time(text: str) -> dt.datetime:
    return dt.datetime.fromisoformat(text)


# --- people -----------------------------------------------------------------------
NURSES = [
    {"key": "p.chen", "name": "Patricia Chen", "email": f"p.chen@{DOMAIN}", "credentials": "RN, BSN",
     "title": "Clinical Supervisor", "prefs": {"safety": True, "submissions": True, "digest": True},
     "created": "2024-06-03T09:00"},
    {"key": "d.okoye", "name": "Daniel Okoye", "email": f"d.okoye@{DOMAIN}", "credentials": "RN",
     "title": "Registered Nurse", "prefs": {}, "created": "2025-01-13T09:00"},
]
# How the mock names an approver -> nurse key.
APPROVERS = {"Patricia Chen, RN": "p.chen", "Daniel Okoye, RN": "d.okoye"}

# The caregiver-portal account. hire_date and location are not in the mock (see report).
SARAH_CHEN = {"key": "s.chen", "name": "Sarah Chen", "email": f"s.chen@{DOMAIN}", "title": "Home-care caregiver",
              "next_shift": "Saturday, 8:00 AM", "employment": "onboarding", "hire_date": "2026-10-20",
              "location": ""}

# The nurse mock's roster. employment is the mock status, except "restricted", which the
# API derives from open safety concerns, so it is stored as "onboarding".
ROSTER = [
    {"key": "cg-sarah", "name": "Sarah Johnson", "title": "Home Health Aide", "hire_date": "2026-09-08",
     "location": "Decatur East", "employment": "onboarding", "skills_completed": 4},
    {"key": "cg-michael", "name": "Michael Brown", "title": "Certified Nursing Assistant", "hire_date": "2026-04-21",
     "location": "Midtown", "employment": "active", "skills_completed": 7},
    {"key": "cg-emily", "name": "Emily Davis", "title": "Home Health Aide", "hire_date": "2026-10-02",
     "location": "Sandy Springs", "employment": "onboarding", "skills_completed": 3},
    {"key": "cg-james", "name": "James Wilson", "title": "Home Health Aide", "hire_date": "2026-08-14",
     "location": "East Point", "employment": "onboarding", "skills_completed": 5},
    {"key": "cg-aisha", "name": "Aisha Patel", "title": "Certified Nursing Assistant", "hire_date": "2025-11-18",
     "location": "Brookhaven", "employment": "active", "skills_completed": 8},
    {"key": "cg-carlos", "name": "Carlos Ramirez", "title": "Home Health Aide", "hire_date": "2026-07-30",
     "location": "College Park", "employment": "onboarding", "skills_completed": 4},
    {"key": "cg-priya", "name": "Priya Nair", "title": "Physical Therapy Aide", "hire_date": "2026-03-11",
     "location": "Decatur East", "employment": "active", "skills_completed": 6},
    {"key": "cg-david", "name": "David Chen", "title": "Certified Nursing Assistant", "hire_date": "2025-06-02",
     "location": "Midtown", "employment": "active", "skills_completed": 8},
    {"key": "cg-marcus", "name": "Marcus Lee", "title": "Home Health Aide", "hire_date": "2026-11-04",
     "location": "East Point", "employment": "onboarding", "skills_completed": 1},
    {"key": "cg-helena", "name": "Helena Brooks", "title": "Certified Nursing Assistant", "hire_date": "2024-09-16",
     "location": "Sandy Springs", "employment": "active", "skills_completed": 8},
    {"key": "cg-nina", "name": "Nina Okonkwo", "title": "Home Health Aide", "hire_date": "2026-05-27",
     "location": "Brookhaven", "employment": "active", "skills_completed": 6},
    {"key": "cg-owen", "name": "Owen Gallagher", "title": "Home Health Aide", "hire_date": "2026-02-19",
     "location": "College Park", "employment": "active", "skills_completed": 7},
]


def email_for(name: str) -> str:
    first, last = name.lower().split(" ", 1)
    return f"{first}.{last.replace(' ', '')}@{DOMAIN}"


# --- skills -----------------------------------------------------------------------
def _evals(passed: list[str], failed: list[str], unverified: list[str]) -> dict:
    return {"pass_criteria": passed, "fail_criteria": failed, "unverified_when": unverified, "visual_cues": []}


def _step(title, description, critical, seen, missed, evals) -> dict:
    """seen: what a clean performance of the step looks like (text for passed rows).
    missed: what a failed one looks like (text for the retraining history)."""
    return {"title": title, "description": description, "critical": critical, "seen": seen, "missed": missed,
            "evals": evals}


SKILLS_CREATED = "2024-09-02T09:00"

SKILLS = [
    {
        "key": "skill-transfer", "slug": "bed_to_wheelchair_transfer", "name": "Bed-to-Wheelchair Transfer",
        "category": "transfer",
        "summary": "Help a client move safely from bed into a wheelchair.",
        "reference_file": "Vehicle Transfer Primary (1).mp4",
        "guide": {
            "description": "Help a client move safely from bed into a wheelchair.",
            "explanation": "You will show how you prepare the space, support the client, and complete a calm, "
                           "controlled transfer into the wheelchair.",
            "safety_reminder": "Practice with a colleague or training dummy — never ask a real client to help you record.",
            "estimated_minutes": 2,
            "cues": [
                {"at_s": 3, "message": "Lock both wheelchair brakes before you start the transfer."},
                {"at_s": 8, "message": "Remember to bend your knees and maintain a neutral back."},
                {"at_s": 14, "message": "Keep the client close as you pivot — you're doing great."},
            ],
        },
        "steps": [
            _step("Explain the transfer", "Greet the client and explain the transfer plan before touching them.", False,
                  "Transfer plan explained before touching the client.",
                  "The transfer starts without telling the client the plan.",
                  _evals(["Caregiver faces the client and speaks before touching them"],
                         ["Caregiver starts moving the client without speaking first"],
                         ["The caregiver or the client is out of frame at the start"])),
            _step("Lock wheelchair brakes", "Place the chair close to the bed and lock both brakes before you begin.", True,
                  "Both brakes locked before the stand.",
                  "Brake levers stay up through the stand and the pivot.",
                  _evals(["Both brake levers are pushed down before the client stands"],
                         ["A brake lever is still up when the client stands or pivots",
                          "The wheelchair rolls during the transfer"],
                         ["The wheels are out of frame before the stand"])),
            _step("Secure the gait belt",
                  "Place the belt snugly around the client's waist and check that it is comfortable.", True,
                  "Belt snug at the waist with the buckle clear of the abdomen.",
                  "Gait belt is loose at the waist and slides up as the client stands.",
                  _evals(["Belt is fastened snugly at the waist before the stand"],
                         ["No gait belt is used", "Belt is loose or rides up toward the chest"],
                         ["The client's waist is hidden when the belt is fastened"])),
            _step("Plant feet and count to three",
                  "Make sure the client's feet are flat on the floor, then count to three together before the stand.",
                  False,
                  "Feet planted and a full three-count before the stand.",
                  "Stand starts before the client's feet are planted.",
                  _evals(["Client's feet are flat on the floor before the count", "The stand starts on 'three'"],
                         ["The stand starts with a foot off the floor or tucked under the bed"],
                         ["The client's feet are out of frame"])),
            _step("Assist to stand with a safe stance", "Bend your knees, keep a neutral back, and hold the client close.",
                  False,
                  "Knees bent and back neutral through the lift.",
                  "Caregiver bends at the waist to lift the client.",
                  _evals(["Caregiver's knees bend and the back stays straight during the lift"],
                         ["Caregiver lifts by bending at the waist"],
                         ["The caregiver's back or legs are blocked from view"])),
            _step("Cue the client before the pivot", "Tell the client you are about to turn before you start the pivot.",
                  False,
                  "Client told before the turn starts.",
                  "The pivot starts without a word to the client.",
                  _evals(["Caregiver tells the client before the turn begins"],
                         ["The pivot starts without a word to the client"],
                         ["The recording has no audio"])),
            _step("Pivot with control", "Turn slowly with the client close to your body until the chair is behind them.",
                  False,
                  "Slow pivot with the client held close.",
                  "Client is swung quickly toward the chair.",
                  _evals(["The turn is slow with the client held close"],
                         ["The client is swung or twisted quickly toward the chair"],
                         ["The pivot happens out of frame"])),
            _step("Lower and confirm a safe sit",
                  "Lower the client gently into the chair and confirm they are sitting all the way back before you let go.",
                  False,
                  "Client lowered gently and seated all the way back.",
                  "Caregiver lets go before the client is fully seated.",
                  _evals(["Client is lowered slowly and sits all the way back before the caregiver lets go"],
                         ["Client drops into the seat", "Caregiver lets go before the client is seated"],
                         ["The seat is out of frame during the sit"])),
        ],
    },
    {
        "key": "skill-gait", "slug": "gait_belt_assistance", "name": "Gait Belt Assistance", "category": "mobility",
        "summary": "Place and use a gait belt to support a client while walking.",
        "reference_file": None,
        "guide": {
            "description": "Place and use a gait belt to support a client while walking.",
            "explanation": "You will demonstrate how you put on a gait belt, check the fit, and walk beside the client "
                           "with a steady, supportive hold.",
            "safety_reminder": "Keep one hand on the belt at all times during the walk, and stay on the client's weaker side.",
            "estimated_minutes": 2,
            "cues": [
                {"at_s": 4, "message": "Check that you can slide two fingers under the belt."},
                {"at_s": 10, "message": "Stay close and keep a relaxed, supportive hold."},
            ],
        },
        "steps": [
            _step("Explain the walk", "Tell the client what you are doing before you place the belt.", False,
                  "Walk explained before the belt goes on.",
                  "Belt is placed without telling the client the plan.",
                  _evals(["Caregiver tells the client the plan before placing the belt"],
                         ["The belt is placed without any explanation"],
                         ["The recording has no audio"])),
            _step("Place the gait belt", "Wrap the belt around the waist, over clothing, and fasten it snugly.", True,
                  "Belt around the waist over clothing and buckled.",
                  "Belt is fastened around the ribs instead of the waist.",
                  _evals(["Belt goes around the waist over clothing and is buckled"],
                         ["No belt is used", "The belt sits on the chest or the hips"],
                         ["The waist is out of frame"])),
            _step("Check the belt fit", "You should be able to slide two fingers under the belt.", True,
                  "Two-finger fit check done.",
                  "No fit check; a hand fits easily under the belt.",
                  _evals(["Caregiver slides two fingers under the belt"],
                         ["Belt is visibly loose, or no fit check is made"],
                         ["The caregiver's hands are hidden at the belt"])),
            _step("Stand with an underhand grip",
                  "Hold the belt with an underhand grip and have the client stand on a three-count.", False,
                  "Underhand grip on the belt; client stands on a three-count.",
                  "Client is pulled up by the arm.",
                  _evals(["Caregiver grips the belt from below and the client stands on a count"],
                         ["The client is pulled up by the arms or clothing"],
                         ["The grip is blocked from view"])),
            _step("Walk with support", "Stand slightly behind and to the side, holding the belt at the back.", False,
                  "Walks slightly behind on the weaker side with a hand on the belt.",
                  "Caregiver lets go of the belt during the walk.",
                  _evals(["Caregiver walks slightly behind on the weaker side with a hand on the belt"],
                         ["Caregiver lets go of the belt or walks in front"],
                         ["The walk leaves the frame"])),
        ],
    },
    {
        "key": "skill-standing", "slug": "assisted_standing", "name": "Assisted Standing", "category": "mobility",
        "summary": "Help a client stand from a seated position with good body mechanics.",
        "reference_file": "sittostand_primary.mp4",
        "guide": {
            "description": "Help a client stand from a seated position with good body mechanics.",
            "explanation": "You will show how you prepare the client, cue them to stand, and support them without "
                           "lifting from the arms.",
            "safety_reminder": "Never pull a client up by the arms or under the shoulders. Cue them to push from the chair.",
            "estimated_minutes": 2,
            "cues": [
                {"at_s": 5, "message": "Cue the client to lean forward before standing."},
                {"at_s": 11, "message": "Support at the waist — avoid pulling on the arms."},
            ],
        },
        "steps": [
            _step("Prepare the space",
                  "Place the client's feet flat on the floor and move the chair or bed into a stable position.", False,
                  "Feet flat and the chair stable before the stand.",
                  "Walking aid is left out of the client's reach.",
                  _evals(["Feet are flat and the chair or bed is stable before the stand"],
                         ["The chair moves, or the walking aid is out of reach"],
                         ["The floor and the chair are out of frame"])),
            _step("Apply the gait belt",
                  "Fasten a gait belt at the waist so you hold the client there, never by the arms.", True,
                  "Gait belt fastened at the waist.",
                  "No gait belt; the client is held under the arms.",
                  _evals(["A gait belt is fastened at the waist before the stand"],
                         ["No gait belt is used", "The caregiver holds the client under the arms"],
                         ["The client's waist is hidden"])),
            _step("Cue the stand", "Count together and ask the client to lean forward and push up.", False,
                  "Clear count; the client leans forward and pushes up.",
                  "Client is lifted without a cue to lean forward.",
                  _evals(["Caregiver counts and the client leans forward before rising"],
                         ["The client is lifted without a cue"],
                         ["The recording has no audio"])),
            _step("Stand with even weight",
                  "Support at the waist as the client rises so their weight stays even over both feet.", False,
                  "Client rises with weight even over both feet.",
                  "Client's weight shifts to one side during the stand.",
                  _evals(["Client rises with weight over both feet while the caregiver holds at the waist"],
                         ["The client sways or leans to one side during the stand",
                          "The caregiver pulls upward on the arms"],
                         ["The client's legs are out of frame"])),
            _step("Steady at the top", "Pause once standing so the client can find their balance.", False,
                  "Pause at the top until the client is steady.",
                  "Caregiver moves on while the client is still swaying.",
                  _evals(["Caregiver pauses with a hold until the client is steady"],
                         ["Caregiver lets go or moves on while the client sways"],
                         ["The recording ends right after the stand"])),
        ],
    },
    {
        "key": "skill-fall", "slug": "fall_recovery_positioning", "name": "Fall Recovery Positioning",
        "category": "emergency",
        "summary": "Respond to a client who has fallen: check for injury, protect the head, and call for help. "
                   "Keep the client comfortable on the floor and never lift them alone.",
        "reference_file": None, "guide": {},
        "steps": [
            _step("Check for injury",
                  "Ask how the client feels and look for bleeding, pain, or deformity before moving them.", True,
                  "Asked about pain and looked over the head and limbs.",
                  "Client is moved before any check for injury.",
                  _evals(["Caregiver asks about pain and looks over the head and limbs before moving the client"],
                         ["The client is moved before any check"],
                         ["The client's body is hidden from the camera"])),
            _step("Protect the head", "Kneel beside the client and cradle their head right away.", True,
                  "Head cradled within seconds.",
                  "Head is left unsupported on the floor.",
                  _evals(["Caregiver supports the client's head within a few seconds"],
                         ["The head is left on the floor unsupported"],
                         ["The client's head is out of frame"])),
            _step("Call for help", "Call a supervisor or emergency services before any attempt to move the client.",
                  False,
                  "Supervisor called before moving the client.",
                  "No call for help before moving the client.",
                  _evals(["Caregiver phones or calls out for a supervisor"],
                         ["No call for help is made before moving the client"],
                         ["The recording has no audio"])),
            _step("Do not lift alone",
                  "Wait for a second trained person or a lift device; never lift a client from the floor by yourself.",
                  True,
                  "Client kept on the floor until help arrived.",
                  "Caregiver tries to lift the client from the floor alone.",
                  _evals(["Client stays on the floor until a second helper or a lift arrives"],
                         ["Caregiver lifts the client from the floor alone"],
                         ["The recording ends before help arrives"])),
            _step("Position for comfort",
                  "Keep the client warm and supported in a comfortable position until help arrives.", False,
                  "Client covered and supported while waiting.",
                  "Client is left in an awkward position on the floor.",
                  _evals(["Client is covered and supported with a pillow or blanket"],
                         ["Client is left in an awkward position"],
                         ["The demonstration ends before this point"])),
        ],
    },
    {
        "key": "skill-meds", "slug": "oral_medication_assist", "name": "Oral Medication Assist", "category": "other",
        "summary": "Help a client take oral medication safely. Confirm who they are, check the dose, and record it.",
        "reference_file": None, "guide": {},
        "steps": [
            _step("Confirm identity", "Check the client's name and date of birth against the medication record (MAR).",
                  True,
                  "Name and date of birth checked against the MAR.",
                  "Medication is offered without an identity check.",
                  _evals(["Caregiver checks the client's name and date of birth against the MAR"],
                         ["Medication is given without an identity check"],
                         ["The MAR or the client is out of frame"])),
            _step("Review the dose", "State the medication, dose, time, and route aloud and match them to the MAR.", True,
                  "Medication, dose, time, and route read aloud.",
                  "Medication is given without reading the label.",
                  _evals(["Caregiver reads the medication, dose, time and route aloud from the label"],
                         ["Medication is given without checking the label"],
                         ["The label is not visible and there is no audio"])),
            _step("Assist with water", "Sit the client fully upright and offer water within easy reach.", False,
                  "Client upright with water within reach.",
                  "Client takes the tablet while leaning back.",
                  _evals(["Client sits fully upright with water within reach"],
                         ["Client takes medication lying back or without water"],
                         ["The client is out of frame while swallowing"])),
            _step("Document administration", "Complete the medication log before leaving the room.", False,
                  "Log completed before leaving the room.",
                  "Caregiver leaves without recording the dose.",
                  _evals(["Caregiver completes the log before leaving"],
                         ["Caregiver leaves without recording the dose"],
                         ["The log screen or sheet is not visible"])),
        ],
    },
    {
        "key": "skill-rom", "slug": "range_of_motion_exercises", "name": "Range of Motion Exercises",
        "category": "mobility",
        "summary": "Move a client's joints gently through the range in their care plan to keep them flexible. "
                   "Stop when the client shows pain.",
        "reference_file": None, "guide": {},
        "steps": [
            _step("Explain the exercise", "Name each joint and movement before you begin.", False,
                  "Each joint named before it is moved.",
                  "Joints are moved without explanation.",
                  _evals(["Caregiver names the joint and movement before starting"],
                         ["A joint is moved without explanation"],
                         ["The recording has no audio"])),
            _step("Support the shoulder through flexion",
                  "Support the arm at the elbow and wrist and raise it slowly within range.", False,
                  "Arm supported at elbow and wrist and raised slowly.",
                  "Arm is raised quickly without support at the elbow.",
                  _evals(["The arm is supported at the elbow and wrist and raised slowly"],
                         ["The arm is raised quickly or without support"],
                         ["The arm is out of frame"])),
            _step("Bend the elbow within range", "Flex the elbow slowly and stop at the care plan's limit.", False,
                  "Elbow flexed slowly and stopped at the care-plan limit.",
                  "Elbow is taken past the care-plan limit.",
                  _evals(["The elbow stops at the care-plan limit"],
                         ["The elbow is pushed past the care-plan limit"],
                         ["The elbow is hidden from view"])),
            _step("Stop at signs of discomfort", "Pause right away if the client winces or reports pain.", True,
                  "Movement paused at the first sign of discomfort.",
                  "Movement continues after the client winces.",
                  _evals(["Movement stops as soon as the client winces or says it hurts"],
                         ["Movement continues after a sign of pain"],
                         ["The client's face is out of frame and there is no audio"])),
        ],
    },
    {
        "key": "skill-bathing", "slug": "bed_bathing", "name": "Bed Bathing", "category": "hygiene",
        "summary": "Give a client a full wash in bed while keeping them warm, covered, and comfortable.",
        "reference_file": None, "guide": {},
        "steps": [
            _step("Explain and gather supplies",
                  "Tell the client what you will do and set out basins, washcloths, and towels within reach.", False,
                  "Plan explained and supplies within reach.",
                  "Caregiver leaves the bedside mid-bath to fetch supplies.",
                  _evals(["Supplies are within reach and the client is told the plan"],
                         ["Caregiver leaves the bedside to fetch supplies mid-bath"],
                         ["Setup happens off camera"])),
            _step("Check the water temperature", "Test the water on your inner wrist before it touches the client.", True,
                  "Water tested on the inner wrist first.",
                  "Water touches the client before it is tested.",
                  _evals(["Caregiver tests the water on the inner wrist first"],
                         ["Water touches the client untested"],
                         ["The basin is out of frame"])),
            _step("Drape for privacy", "Keep the client covered and uncover only the area you are washing.", False,
                  "Only the area being washed uncovered.",
                  "Client is left uncovered between areas.",
                  _evals(["Only the area being washed is uncovered"],
                         ["The client is left fully uncovered"],
                         ["The client's body is out of frame"])),
            _step("Wash clean to dirty, then dry",
                  "Wash from the cleanest areas to the dirtiest and pat each area dry, checking the skin for redness.",
                  False,
                  "Washed clean to dirty and patted dry.",
                  "Skin is left damp after washing.",
                  _evals(["Washing moves from the face toward the feet and each area is patted dry"],
                         ["Skin is left wet, or a used cloth goes back to a clean area"],
                         ["Washing happens out of frame"])),
        ],
    },
    {
        "key": "skill-positioning", "slug": "safe_client_positioning", "name": "Safe Client Positioning",
        "category": "positioning",
        "summary": "Reposition a client in bed while protecting skin and joints.",
        "reference_file": "bedrepositioning primary.mp4",
        "guide": {
            "description": "Reposition a client in bed while protecting skin and joints.",
            "explanation": "You will demonstrate how you turn and settle a client in bed, using pillows for support "
                           "and keeping movements slow.",
            "safety_reminder": "Raise the bed to a comfortable height for you, and keep the side rail up on the far side.",
            "estimated_minutes": 3,
            "cues": [
                {"at_s": 4, "message": "Raise the bed so you are not bending at the waist."},
                {"at_s": 12, "message": "Move slowly and keep the client close to your body."},
            ],
        },
        "steps": [
            _step("Adjust the bed height", "Bring the bed to your waist level so you are not bending over.", False,
                  "Bed raised to waist level.",
                  "Caregiver bends deeply over a low bed.",
                  _evals(["The bed is raised to the caregiver's waist before the turn"],
                         ["Caregiver bends deeply over a low bed"],
                         ["The bed controls are out of frame"])),
            _step("Turn with a draw sheet", "Use a draw sheet and a partner or friction-reducing aid when possible.",
                  False,
                  "Turned smoothly with the draw sheet.",
                  "Client is pulled over by the arm.",
                  _evals(["Client is turned using the draw sheet with a partner or aid"],
                         ["Client is pulled by an arm or a leg"],
                         ["The sheet is hidden"])),
            _step("Align the body", "Keep the head, shoulders, and hips in a comfortable line.", False,
                  "Head, shoulders, and hips in line.",
                  "Client is left twisted at the hips.",
                  _evals(["Head, shoulders and hips are in a straight line after the turn"],
                         ["Client is left twisted at the hips or the neck"],
                         ["Part of the client's body is out of frame"])),
            _step("Support with pillows",
                  "Place pillows to protect pressure points and keep the client comfortable.", False,
                  "Pillows placed behind the back and between the knees.",
                  "Knees and ankles are left resting on each other.",
                  _evals(["Pillows are placed behind the back and between the knees"],
                         ["Bony points are left pressing on each other or on the bed"],
                         ["Pillow placement is out of frame"])),
        ],
    },
    {
        "key": "skill-wheelchair", "slug": "wheelchair_safety", "name": "Wheelchair Safety", "category": "mobility",
        "summary": "Set up a wheelchair so a client can sit, ride, and transfer safely.",
        "reference_file": "wheelchairprimary.mp4",
        "guide": {
            "description": "Set up a wheelchair so a client can sit, ride, and transfer safely.",
            "explanation": "You will show how you inspect the chair, lock the brakes, place the footrests, and help "
                           "the client sit securely.",
            "safety_reminder": "Always lock the brakes before a client sits or stands, even for a short pause.",
            "estimated_minutes": 2,
            "cues": [
                {"at_s": 3, "message": "Lock both brakes before the client sits."},
                {"at_s": 9, "message": "Make sure the client is sitting all the way back."},
            ],
        },
        "steps": [
            _step("Inspect the chair", "Check tires, brakes, and that the seat is clear and dry.", False,
                  "Tires, brakes, and seat checked.",
                  "Client sits before the chair is checked.",
                  _evals(["Caregiver looks over the tires, brakes and seat before use"],
                         ["Client sits without any check of the chair"],
                         ["The chair is out of frame"])),
            _step("Lock the brakes", "Lock both brakes before anyone sits or stands.", True,
                  "Both brakes locked before the sit.",
                  "A brake is left unlocked as the client sits.",
                  _evals(["Both brakes are locked before the client sits or stands"],
                         ["A brake is unlocked as the client sits or stands"],
                         ["The wheels are out of frame"])),
            _step("Position the footrests",
                  "Swing footrests out of the way, then place the client's feet once seated.", False,
                  "Footrests swung away, then feet placed.",
                  "Client steps onto the footrests to sit.",
                  _evals(["Footrests are swung away for the sit and the feet placed on them after"],
                         ["Client steps onto or trips over the footrests"],
                         ["The footrests are out of frame"])),
            _step("Settle and secure", "Help the client sit all the way back and fasten a seatbelt if used.", False,
                  "Client seated all the way back.",
                  "Client is left perched on the front of the seat.",
                  _evals(["Client sits all the way back and the belt is fastened if used"],
                         ["Client is left perched on the front of the seat"],
                         ["The seat is hidden"])),
        ],
    },
]
SKILL_BY_KEY = {s["key"]: s for s in SKILLS}


def safety_criteria(skill: dict) -> list[str]:
    """One skill-level safety point: the caregiver reminder, or the critical steps."""
    if skill["guide"].get("safety_reminder"):
        return [skill["guide"]["safety_reminder"]]
    critical = [s["title"].lower() for s in skill["steps"] if s["critical"]]
    return [f"Never skip: {', '.join(critical)}."] if critical else []


# --- the nurse mock's 7 pending submissions ---------------------------------------------
# steps: (step_id, at_s, mock status, note, evidence or None for the note). Rows marked
# "filler" are canonical steps the mock submission did not mention.
_TRANSFER_CHECKLIST = {
    "position": "Feet staggered, hips close to the client, and spine aligned before the lift.",
    "brakes": "Both wheelchair brakes remain unlocked at 0:04 and through the pivot.",
    "belt": "Belt sits at the waist, buckle is centered, and two-finger tightness is confirmed.",
    "lift": "Initial lift uses legs, but trunk leans forward as the client stands.",
    "pivot": "Slow 90-degree turn with client’s hands on the caregiver’s upper arms.",
    "sit": "Descent is controlled until the last two seconds, when the client drops onto the seat.",
}

PENDING = [
    {
        "id": "rev-1001", "caregiver": "cg-sarah", "skill": "skill-transfer", "submitted_at": "2026-11-13T14:14",
        "ai_assessment": "needs_review", "duration": 38,
        "summary": "Sarah completes the transfer sequence in order, but the wheelchair is never locked. Client balance "
                   "dips during the stand and the final sit is slightly uncontrolled.",
        "recommendation": "Do not certify yet. Confirm brake technique and a slower sit-down before independent assignment.",
        "steps": [
            ("s1", 2, "passed", "Sarah greets the client and states the transfer plan before touching.", None),
            ("s2", 4, "failed", "Hands pass the wheelchair but neither brake lever is engaged.", _TRANSFER_CHECKLIST["brakes"]),
            ("s3", 9, "passed", "Belt is snug at the waist with the buckle clear of the abdomen.", _TRANSFER_CHECKLIST["belt"]),
            ("s4", 14, "passed", "Client’s feet are planted; caregiver counts to three before standing.",
             _TRANSFER_CHECKLIST["position"]),
            ("s5", 18, "needs_review", "Client leans left; Sarah corrects late but recovers without a loss of balance.",
             _TRANSFER_CHECKLIST["lift"]),
            ("s6", 24, "passed", "Client is told before the turn starts.", None),  # filler
            ("s7", 26, "passed", "Pivot is slow and the client remains close to the caregiver’s center of gravity.",
             _TRANSFER_CHECKLIST["pivot"]),
            ("s8", 32, "needs_review", "Sit starts controlled, then the last 8 inches drop rather than lower.",
             _TRANSFER_CHECKLIST["sit"]),
        ],
        "flags": [
            {"title": "Wheelchair brakes not locked", "t": 4, "severity": "critical", "kind": "environment_hazard",
             "detail": "Both brake levers stay up for the entire transfer. An unlocked wheelchair can roll during the "
                       "pivot or sit, creating a fall risk."},
        ],
        "balance": [(0, 92), (6, 90), (12, 88), (18, 64), (22, 71), (26, 78), (32, 58), (38, 84)],
        "movement": [
            {"label": "Hip alignment", "value": 72, "status": "needs_review",
             "note": "Hips drift away from the client at the start of the stand."},
            {"label": "Knee bend", "value": 88, "status": "passed",
             "note": "Knees stay flexed through the lift instead of using the back."},
            {"label": "Trunk control", "value": 64, "status": "needs_review",
             "note": "Forward flexion increases as the client reaches standing height."},
            {"label": "Client proximity", "value": 81, "status": "passed",
             "note": "Caregiver remains close enough to support if balance is lost."},
        ],
    },
    {
        "id": "rev-1002", "caregiver": "cg-michael", "skill": "skill-gait", "submitted_at": "2026-11-13T10:41",
        "ai_assessment": "passed", "duration": 32,
        "summary": "Gait belt application, stand, and short walk meet the reference standard. No safety flags detected.",
        "recommendation": "AI recommends approval. Nurse sign-off is still required before independent assignment.",
        "steps": [
            ("s1", 2, "passed", "Michael tells the client where they are walking and asks about dizziness.", None),
            ("s2", 7, "passed", "Belt is snug, buckle is centered, and excess strap is tucked.", None),
            ("s3", 9, "passed", "Two-finger fit check after fastening.", "Two-finger check completed at 0:09."),  # filler
            ("s4", 14, "passed", "Underhand grip on the belt; client stands on a three-count.",
             "Lift comes from the legs with a straight back."),
            ("s5", 22, "passed", "Michael stays slightly behind and to the weaker side.",
             "Staggered stance beside the weaker side."),
        ],
        "flags": [],
        "balance": [(0, 94), (10, 91), (18, 89), (26, 92), (32, 95)],
        "movement": [
            {"label": "Hip alignment", "value": 91, "status": "passed", "note": "Hips stay stacked over the base of support."},
            {"label": "Knee bend", "value": 90, "status": "passed", "note": "Consistent flexion during the stand."},
            {"label": "Trunk control", "value": 93, "status": "passed", "note": "Upright trunk throughout the walk."},
            {"label": "Client proximity", "value": 88, "status": "passed", "note": "One hand on the belt at all times."},
        ],
    },
    {
        "id": "rev-1003", "caregiver": "cg-emily", "skill": "skill-standing", "submitted_at": "2026-11-13T09:05",
        "ai_assessment": "safety_concern", "duration": 29,
        "summary": "Client loses lateral balance during the stand. No gait belt is applied, and Emily reaches under the "
                   "arms instead of using a secure hold.",
        "recommendation": "Reject for independent work. Request retraining on gait belt use and under-arm holds before "
                          "another attempt.",
        "steps": [
            ("s1", 3, "needs_review", "Walker is nearby but not placed within the client’s reach.", None),
            ("s2", 8, "failed", "Belt remains on the dresser. Emily lifts from the upper arms.",
             "Belt is never placed on the client."),
            ("s3", 12, "needs_review", "The cue before the stand cannot be confirmed from the video.", None),  # filler
            ("s4", 16, "failed", "Client sways left; Emily pulls upward instead of blocking the fall path.",
             "Lift is an upward pull under the arms."),
            ("s5", 24, "needs_review", "Client steadies on the dresser rather than a gait belt or walker.",
             "No pivot is completed; client holds the dresser."),
        ],
        "flags": [
            {"title": "Gait belt not applied", "t": 8, "severity": "critical", "kind": "unsafe_caregiver_posture",
             "detail": "Standing assist is performed without a gait belt, leaving no safe point of control if the "
                       "client falls."},
            {"title": "Client balance loss during stand", "t": 16, "severity": "critical", "kind": "patient_unsteady",
             "detail": "Lateral sway exceeds the safe threshold. Emily’s under-arm pull increases shoulder strain and "
                       "fall risk."},
        ],
        "balance": [(0, 86), (8, 80), (16, 38), (20, 44), (24, 61), (29, 70)],
        "movement": [
            {"label": "Hip alignment", "value": 41, "status": "failed",
             "note": "Hips stay behind the client instead of blocking a fall."},
            {"label": "Knee bend", "value": 55, "status": "needs_review", "note": "Knees lock during the pull-up."},
            {"label": "Trunk control", "value": 48, "status": "failed",
             "note": "Caregiver’s trunk rotates away as the client sways."},
            {"label": "Client proximity", "value": 36, "status": "failed",
             "note": "Gap at the torso is too wide for a safe catch."},
        ],
    },
    {
        "id": "rev-1004", "caregiver": "cg-james", "skill": "skill-transfer", "submitted_at": "2026-11-12T16:22",
        "ai_assessment": "needs_review", "duration": 41,
        "summary": "Brakes are locked and the gait belt is correct, but James rushes the count and the client’s feet are "
                   "not fully planted before standing.",
        "recommendation": "Review foot placement and the three-count. Likely a short coaching note rather than full "
                          "retraining.",
        "steps": [
            ("s1", 1, "passed", "The transfer plan is stated before starting.", None),  # filler
            ("s2", 5, "passed", "Both brakes click down before the belt is applied.", "Brakes locked at 0:05."),
            ("s3", 11, "passed", "Belt fit is correct.", "Belt tightness confirmed."),
            ("s4", 17, "needs_review", "Left foot remains slightly under the bed frame.",
             "Client’s left foot is not fully on the floor."),
            ("s5", 23, "needs_review", "Count is “one-two” instead of a full three-count.",
             "Stand is initiated before the client finishes the count."),
            ("s6", 28, "passed", "Client is told before the turn starts.", None),  # filler
            ("s7", 30, "passed", "Pivot is slow once standing.", None),  # filler, from the checklist
            ("s8", 35, "passed", "Client reaches back and sits with control.", None),  # filler, from the checklist
        ],
        "flags": [],
        "balance": [(0, 90), (17, 74), (24, 79), (41, 91)],
        "movement": [
            {"label": "Hip alignment", "value": 80, "status": "passed", "note": "Good proximity after the stand."},
            {"label": "Knee bend", "value": 77, "status": "needs_review", "note": "Slight early extension on the count."},
            {"label": "Trunk control", "value": 84, "status": "passed", "note": "Trunk stays upright."},
            {"label": "Client proximity", "value": 86, "status": "passed", "note": "Close support through the pivot."},
        ],
    },
    {
        "id": "rev-1005", "caregiver": "cg-aisha", "skill": "skill-meds", "submitted_at": "2026-11-12T13:10",
        "ai_assessment": "passed", "duration": 46,
        "summary": "Rights of medication assistance are followed. Water is offered, identity is confirmed, and the "
                   "record is completed.",
        "recommendation": "AI recommends approval after nurse confirmation of the medication log close-out.",
        "steps": [
            ("s1", 4, "passed", "Name and date of birth checked against the MAR.", None),
            ("s2", 12, "passed", "Medication, time, and route stated aloud.", None),
            ("s3", 28, "passed", "Client is upright; water is within reach.", "Client is fully upright in the chair."),
            ("s4", 40, "passed", "Electronic log completed before leaving the room.", None),
        ],
        "flags": [],
        "balance": [(0, 96), (46, 96)],
        "movement": [
            {"label": "Hip alignment", "value": 94, "status": "passed", "note": "Seated skill with stable posture."},
            {"label": "Knee bend", "value": 90, "status": "passed", "note": "Not a lift task."},
            {"label": "Trunk control", "value": 95, "status": "passed", "note": "Client remains upright."},
            {"label": "Client proximity", "value": 92, "status": "passed", "note": "Aisha stays within arm’s reach."},
        ],
    },
    {
        "id": "rev-1006", "caregiver": "cg-carlos", "skill": "skill-fall", "submitted_at": "2026-11-12T11:38",
        "ai_assessment": "safety_concern", "duration": 35,
        "summary": "Carlos tries to lift the client from the floor instead of stabilizing and calling for help. Head "
                   "support is delayed.",
        "recommendation": "Request retraining on fall recovery. Do not assign clients with fall risk until this is "
                          "signed off.",
        "steps": [
            ("s1", 3, "needs_review", "Verbal check occurs, but no scan for bleeding.", None),
            ("s2", 7, "failed", "Head is unsupported for the first seven seconds.",
             "Kneels on one knee, but client’s head is not cradled promptly."),
            ("s3", 14, "passed", "Supervisor is notified by phone.", None),
            ("s4", 22, "failed", "Carlos attempts a two-person lift without a second helper.", "Solo lift is attempted."),
            ("s5", 30, "needs_review", "Not reached; the demonstration stops mid-lift.",
             "Demonstration stops mid-lift."),  # filler, from the checklist
        ],
        "flags": [
            {"title": "Solo lift from the floor", "t": 22, "severity": "critical", "kind": "unsafe_caregiver_posture",
             "detail": "Policy requires two trained people and a clear injury check before any lift from the floor."},
        ],
        "balance": [(0, 50), (10, 42), (22, 33), (35, 48)],
        "movement": [
            {"label": "Hip alignment", "value": 52, "status": "needs_review",
             "note": "Stance is wide, but load is taken too early."},
            {"label": "Knee bend", "value": 60, "status": "needs_review",
             "note": "One knee is down; the lift still uses the back."},
            {"label": "Trunk control", "value": 44, "status": "failed",
             "note": "Rounding of the lumbar spine during the attempted lift."},
            {"label": "Client proximity", "value": 70, "status": "passed",
             "note": "Stays close to the client on the floor."},
        ],
    },
    {
        "id": "rev-1007", "caregiver": "cg-priya", "skill": "skill-rom", "submitted_at": "2026-11-11T15:50",
        "ai_assessment": "needs_review", "duration": 50,
        "summary": "Shoulder flexion is smooth, but Priya exceeds the prescribed range on the right elbow and does not "
                   "pause when the client winces.",
        "recommendation": "Coach on stopping at reported pain. Otherwise the sequence matches the reference video.",
        "steps": [
            ("s1", 3, "passed", "Priya names each joint before moving it.", None),
            ("s2", 12, "passed", "Slow, supported motion within range.", "Client is supine with joints supported."),
            ("s3", 28, "needs_review", "Right elbow is taken past the care-plan stop point.",
             "Support under the elbow is lost at end range."),
            ("s4", 31, "needs_review", "Client winces; motion continues for two seconds.", None),
        ],
        "flags": [],
        "balance": [(0, 98), (50, 98)],
        "movement": [
            {"label": "Hip alignment", "value": 90, "status": "passed", "note": "Bed-level skill."},
            {"label": "Knee bend", "value": 88, "status": "passed", "note": "Caregiver’s stance is stable."},
            {"label": "Trunk control", "value": 85, "status": "passed", "note": "Upright while supporting the limb."},
            {"label": "Client proximity", "value": 91, "status": "passed", "note": "Hands stay on the joint."},
        ],
    },
]

# --- the nurse mock's 6 verified records ------------------------------------------------
# submitted_at: the caregiver's lastSubmissionAt in the mock where that is this record
# (David, Helena, Nina, Owen); a few hours before approval otherwise (Aisha, Michael).
VERIFIED_RECORDS = [
    {"id": "ver-2001", "caregiver": "cg-david", "skill": "skill-gait", "submitted_at": "2026-11-13T08:12",
     "approved_at": "2026-11-13T08:20", "approver": "Patricia Chen, RN", "ai_assessment": "passed", "duration": 34,
     "notes": "Clean demonstration. Approved for independent gait belt assistance.",
     "summary": "Belt placement, fit check, stand, and walk all match the reference. No safety flags detected."},
    {"id": "ver-2002", "caregiver": "cg-helena", "skill": "skill-transfer", "submitted_at": "2026-11-10T09:18",
     "approved_at": "2026-11-12T15:04", "approver": "Patricia Chen, RN", "ai_assessment": "passed", "duration": 44,
     "notes": "Brakes, belt, and sit all matched the reference video.",
     "summary": "Brakes are locked first, the belt is snug, and the pivot and sit are slow and controlled."},
    {"id": "ver-2003", "caregiver": "cg-aisha", "skill": "skill-bathing", "submitted_at": "2026-11-11T08:30",
     "approved_at": "2026-11-11T11:42", "approver": "Daniel Okoye, RN", "ai_assessment": "needs_review",
     "duration": 48,
     "notes": "Privacy draping needed a reminder; technique was otherwise safe. Approved after live coaching.",
     "summary": "Water is tested and washing goes from clean to dirty. Privacy draping could not be confirmed for "
                "part of the bath.",
     "unverified": {"s3": ("Keep the client covered except for the area you are washing.",
                           "Client's legs stay uncovered while the arms are washed.")}},
    {"id": "ver-2004", "caregiver": "cg-nina", "skill": "skill-standing", "submitted_at": "2026-11-09T14:05",
     "approved_at": "2026-11-10T16:15", "approver": "Patricia Chen, RN", "ai_assessment": "passed", "duration": 31,
     "notes": "Excellent cueing. Client reported feeling steady.",
     "summary": "Clear cue, a secure hold at the waist, and a pause at the top. No safety flags detected."},
    {"id": "ver-2005", "caregiver": "cg-owen", "skill": "skill-meds", "submitted_at": "2026-11-08T11:22",
     "approved_at": "2026-11-09T09:50", "approver": "Daniel Okoye, RN", "ai_assessment": "passed", "duration": 42,
     "notes": "Rights of administration followed. Documentation complete.",
     "summary": "Identity and dose are checked aloud, water is offered upright, and the log is completed."},
    {"id": "ver-2006", "caregiver": "cg-michael", "skill": "skill-transfer", "submitted_at": "2026-11-08T10:05",
     "approved_at": "2026-11-08T13:28", "approver": "Patricia Chen, RN", "ai_assessment": "passed", "duration": 39,
     "notes": "Second attempt after prior coaching on brake order. Approved.",
     "summary": "Brakes are locked before the belt goes on, and the stand, pivot, and sit are controlled."},
]

# --- Sarah Chen, the caregiver-portal account -------------------------------------------
# steps: (step_id, at_s, mock status, feedback, evidence). Evidence is the mock's assessment
# label; rows marked "filler" are canonical steps the caregiver mock does not have.
SARAH_CHEN_ATTEMPTS = [
    {"id": "sc-gait", "skill": "skill-gait", "created": "2026-10-27T10:15", "duration": 24,
     "summary": "You placed the belt carefully and stayed close throughout the walk. Beautiful, steady work.",
     "reasons": [],
     "review": {"by": "p.chen", "at": "2026-10-27T16:40", "outcome": "passed",
                "note": "Belt placement and walking position matched the reference. Verified."},
     "steps": [
         ("s1", 1, "passed", "You told the client what you were doing first.", "Explained the step to the client"),
         ("s2", 2.5, "passed", "Belt went on over clothing at the waist.", "Belt placed over clothing"),
         ("s3", 4, "passed", "Good two-finger fit check.", "Fit checked with two fingers"),
         ("s4", 7, "passed", "Steady underhand grip as the client stood.", "Stood on a three-count with an underhand grip"),  # filler
         ("s5", 10, "passed", "You stayed close on the weaker side.", "Supportive walking position"),
     ]},
    {"id": "sc-wheelchair", "skill": "skill-wheelchair", "created": "2026-10-30T09:40", "duration": 20,
     "summary": "You checked the chair, locked the brakes, and helped the client sit securely. This was calm and complete.",
     "reasons": [],
     "review": {"by": "d.okoye", "at": "2026-10-30T15:10", "outcome": "passed",
                "note": "Chair check, brakes, and seating were all complete. Verified."},
     "steps": [
         ("s1", 1, "passed", "Chair checked before use.", "Chair inspected"),
         ("s2", 3, "passed", "Both brakes locked before the sit.", "Brakes locked"),
         ("s3", 6, "passed", "Footrests out of the way, then feet placed.", "Footrests positioned"),
         ("s4", 9, "passed", "Client sitting all the way back.", "Client seated securely"),
     ]},
    {"id": "sc-transfer", "skill": "skill-transfer", "created": "2026-11-08T15:00", "duration": 24,
     "summary": "You completed most of the transfer with care. One moment to keep practicing: lifting posture around 0:08.",
     "reasons": ["Lifting posture at 0:08 needs a nurse's review."],
     "review": {"by": "p.chen", "at": "2026-11-09T10:20", "outcome": "failed",
                "note": "Nice work locking the brakes and securing the belt first. At 0:08 you bend at the waist as "
                        "the client stands. Bend your knees, keep your back straight, and let your legs do the work. "
                        "Practise the stance with a colleague and record again."},
     "steps": [
         ("s1", 1, "passed", "Transfer plan explained first.", "Transfer plan explained"),  # filler
         ("s2", 3, "passed", "Both brakes locked before you began.", "Wheelchair brakes locked"),
         ("s3", 5, "passed", "Belt snug at the waist.", "Gait belt secured"),
         ("s4", 6.5, "passed", "Feet planted before the stand.", "Feet planted before the stand"),  # filler
         ("s5", 8, "needs_improvement", "Bend your knees and keep a neutral back as the client stands.",
          "Proper lifting posture"),
         ("s6", 12, "passed", "You told the client before turning.", "Turn announced before the pivot"),  # filler
         ("s7", 14, "passed", "Slow pivot with the client close.", "Controlled pivot"),
         ("s8", 18, "passed", "Client lowered gently and seated all the way back.", "Client seated all the way back"),  # filler
     ]},
    {"id": "sc-standing", "skill": "skill-standing", "created": "2026-11-11T10:30", "duration": 20,
     "summary": "Your cues were clear and you waited for the client to find their balance. Nice, unhurried pacing.",
     "reasons": ["The pause to find balance at 0:12 needs a nurse's review."],
     "review": None,
     "steps": [
         ("s1", 1, "passed", "Feet flat and the chair steady.", "Feet placed and space prepared"),
         ("s2", 3, "passed", "Belt fastened at the waist.", "Gait belt fastened at the waist"),  # filler
         ("s3", 5, "passed", "Clear count and a cue to lean forward.", "Clear standing cue"),
         ("s4", 8, "passed", "Secure hold at the waist, not the arms.", "Support at the waist"),
         ("s5", 12, "needs_improvement", "Pause a moment longer at the top so the client can find their balance.",
          "Pause to find balance"),
     ]},
]

# --- older history ------------------------------------------------------------------------
# Skills each roster caregiver had approved more than 30 days ago, on top of the verified
# records above. Together they give each caregiver the mock's skillsCompleted.
HISTORICAL_VERIFIED = {
    "cg-sarah": ["skill-wheelchair", "skill-bathing", "skill-meds", "skill-positioning"],
    "cg-michael": ["skill-wheelchair", "skill-bathing", "skill-meds", "skill-positioning", "skill-fall", "skill-rom"],
    "cg-emily": ["skill-bathing", "skill-meds", "skill-positioning"],
    "cg-james": ["skill-wheelchair", "skill-gait", "skill-bathing", "skill-meds", "skill-positioning"],
    "cg-aisha": ["skill-wheelchair", "skill-gait", "skill-standing", "skill-transfer", "skill-positioning",
                 "skill-fall", "skill-rom"],
    "cg-carlos": ["skill-wheelchair", "skill-bathing", "skill-meds", "skill-standing"],
    "cg-priya": ["skill-wheelchair", "skill-gait", "skill-standing", "skill-bathing", "skill-meds",
                 "skill-positioning"],
    "cg-david": ["skill-wheelchair", "skill-standing", "skill-bathing", "skill-meds", "skill-positioning",
                 "skill-fall", "skill-rom"],
    "cg-marcus": [],
    "cg-helena": ["skill-wheelchair", "skill-gait", "skill-standing", "skill-bathing", "skill-meds",
                  "skill-positioning", "skill-fall"],
    "cg-nina": ["skill-wheelchair", "skill-gait", "skill-bathing", "skill-meds", "skill-positioning"],
    "cg-owen": ["skill-wheelchair", "skill-gait", "skill-bathing", "skill-positioning", "skill-fall", "skill-rom"],
}
HISTORICAL_NOTES = [
    "Matches the reference. Approved.",
    "Safe and complete. Approved for independent work.",
    "All steps in order. Approved.",
    "Good technique throughout. Approved.",
]
HISTORY_END_DAYS = 36  # historical approvals are older than this many days (before MOCK_NOW)

# Marcus Lee's only approval: the mock's "finished Bed Bathing during onboarding", yesterday.
MARCUS_BATHING = {"id": "hist-marcus-bathing", "caregiver": "cg-marcus", "skill": "skill-bathing",
                  "created": "2026-11-12T17:40", "reviewed": "2026-11-12T18:05", "approver": "d.okoye",
                  "duration": 44, "note": "Good privacy draping and water check. Approved."}


def historical_schedule(caregiver_key: str, hire_date: str, skill_keys: list[str]) -> list[dict]:
    """Spread a caregiver's historical approvals evenly between their hire date and
    HISTORY_END_DAYS before MOCK_NOW. Returns mock-time attempts, oldest first."""
    start = mock_time(hire_date + "T00:00") + dt.timedelta(days=2)
    end = MOCK_NOW - dt.timedelta(days=HISTORY_END_DAYS)
    out = []
    n = len(skill_keys)
    for i, skill_key in enumerate(skill_keys):
        day = start + (end - start) * ((i + 0.5) / n)
        created = day.replace(hour=9 + (i * 3) % 7, minute=(i * 17 + len(caregiver_key) * 7) % 60, second=0,
                              microsecond=0)
        reviewed = created + dt.timedelta(hours=3 + (i % 3) * 6, minutes=(i * 11) % 50)
        out.append({"id": f"hist-{caregiver_key[3:]}-{skill_key[6:]}", "caregiver": caregiver_key, "skill": skill_key,
                    "created": created, "reviewed": reviewed, "approver": "p.chen" if i % 2 == 0 else "d.okoye",
                    "duration": 30 + (i * 7 + len(caregiver_key)) % 21,
                    "note": HISTORICAL_NOTES[(i + len(caregiver_key)) % len(HISTORICAL_NOTES)]})
    return out


# --- retraining history (the last 30 days' safety patterns) -----------------------------
# Each: a nurse (Patricia Chen) asked for retraining. failed: canonical step ids the AI
# failed. Together with the pending submissions these give the mock's missedSteps and
# flaggedSkills. Caregivers here never have the skill verified or pending.
_BRAKES = {"title": "Wheelchair brakes not locked", "severity": "critical", "kind": "environment_hazard",
           "detail": "Brake levers stay up during the stand and pivot, so the chair can roll away from the client."}
_PIVOT = {"title": "Client unsteady during pivot", "severity": "moderate", "kind": "patient_unsteady",
          "detail": "The client's knees buckle briefly during the turn before the caregiver steadies them."}
_DROP = {"title": "Uncontrolled drop into the chair", "severity": "moderate", "kind": "patient_unsteady",
         "detail": "The client drops the last few inches into the seat instead of being lowered."}
_ROLL = {"title": "Wheelchair rolled during the sit", "severity": "critical", "kind": "environment_hazard",
         "detail": "The unlocked chair slides backward as the client sits."}
_SWAY = {"title": "Client balance loss during stand", "severity": "critical", "kind": "patient_unsteady",
         "detail": "The client sways to one side as they rise and grabs the armrest to recover."}
_ARMS = {"title": "Pulled up under the arms", "severity": "moderate", "kind": "unsafe_caregiver_posture",
         "detail": "The caregiver lifts from under the client's arms, straining the shoulders of both."}
_LEAN = {"title": "Client leaned to one side", "severity": "moderate", "kind": "patient_off_center",
         "detail": "The client's weight shifts onto one leg as they reach standing height."}

RETRAINING = [
    # Bed-to-Wheelchair Transfer: s2 brakes x10, s3 belt x8, s6 cue x6, s8 sit x4; 8 flags.
    {"id": "rt-t01", "caregiver": "cg-emily", "skill": "skill-transfer", "created": "2026-10-17T10:20",
     "failed": ["s2", "s3", "s6", "s8"], "flags": [(4, _BRAKES)]},
    {"id": "rt-t02", "caregiver": "cg-carlos", "skill": "skill-transfer", "created": "2026-10-18T15:05",
     "failed": ["s2", "s3", "s6"], "flags": [(5, _BRAKES)]},
    {"id": "rt-t03", "caregiver": "cg-nina", "skill": "skill-transfer", "created": "2026-10-20T09:40",
     "failed": ["s2", "s3", "s8"], "flags": [(30, _DROP)]},
    {"id": "rt-t04", "caregiver": "cg-owen", "skill": "skill-transfer", "created": "2026-10-21T13:15",
     "failed": ["s2", "s6"], "flags": [(22, _PIVOT)]},
    {"id": "rt-t05", "caregiver": "cg-priya", "skill": "skill-transfer", "created": "2026-10-23T11:30",
     "failed": ["s2", "s3"], "flags": [(5, _BRAKES)]},
    {"id": "rt-t06", "caregiver": "cg-emily", "skill": "skill-transfer", "created": "2026-10-24T14:10",
     "failed": ["s2", "s3", "s6"], "flags": [(24, _PIVOT)]},
    {"id": "rt-t07", "caregiver": "cg-david", "skill": "skill-transfer", "created": "2026-10-26T08:55",
     "failed": ["s2", "s8"], "flags": [(31, _ROLL)]},
    {"id": "rt-t08", "caregiver": "cg-carlos", "skill": "skill-transfer", "created": "2026-10-27T16:20",
     "failed": ["s2", "s3"], "flags": [(4, _BRAKES)]},
    {"id": "rt-t09", "caregiver": "cg-nina", "skill": "skill-transfer", "created": "2026-10-29T10:05",
     "failed": ["s2", "s6"], "flags": []},
    {"id": "rt-t10", "caregiver": "cg-owen", "skill": "skill-transfer", "created": "2026-10-30T15:45",
     "failed": ["s2"], "flags": []},
    {"id": "rt-t11", "caregiver": "cg-emily", "skill": "skill-transfer", "created": "2026-11-02T09:25",
     "failed": ["s3", "s6"], "flags": []},
    {"id": "rt-t12", "caregiver": "cg-carlos", "skill": "skill-transfer", "created": "2026-11-04T13:50",
     "failed": ["s3", "s8"], "flags": []},
    # Assisted Standing: s4 even weight x4; 4 flags.
    {"id": "rt-s01", "caregiver": "cg-sarah", "skill": "skill-standing", "created": "2026-10-19T11:10",
     "failed": ["s4"], "flags": [(14, _SWAY)]},
    {"id": "rt-s02", "caregiver": "cg-james", "skill": "skill-standing", "created": "2026-10-25T14:40",
     "failed": ["s4"], "flags": [(13, _ARMS)]},
    {"id": "rt-s03", "caregiver": "cg-michael", "skill": "skill-standing", "created": "2026-10-28T10:30",
     "failed": ["s4"], "flags": [(15, _LEAN)]},
    {"id": "rt-s04", "caregiver": "cg-owen", "skill": "skill-standing", "created": "2026-11-03T12:00",
     "failed": ["s4"], "flags": [(14, _SWAY)]},
    # Fall Recovery Positioning: 3 flags, no step failed more than twice in total.
    {"id": "rt-f01", "caregiver": "cg-emily", "skill": "skill-fall", "created": "2026-10-22T09:50",
     "failed": ["s2"], "flags": [(6, {"title": "Head left unsupported", "severity": "critical", "kind": "other",
                                      "detail": "The client's head rests on the hard floor for several seconds."})]},
    {"id": "rt-f02", "caregiver": "cg-james", "skill": "skill-fall", "created": "2026-10-31T13:30",
     "failed": ["s4"], "flags": [(20, {"title": "Solo lift from the floor", "severity": "critical",
                                       "kind": "unsafe_caregiver_posture",
                                       "detail": "The caregiver tries to lift the client from the floor alone."})]},
    {"id": "rt-f03", "caregiver": "cg-nina", "skill": "skill-fall", "created": "2026-11-05T10:45",
     "failed": ["s1"], "flags": [(4, {"title": "Client moved before injury check", "severity": "moderate",
                                      "kind": "other",
                                      "detail": "The client is rolled onto their side before any check for injury."})]},
    # Gait Belt Assistance: 2 flags.
    {"id": "rt-g01", "caregiver": "cg-sarah", "skill": "skill-gait", "created": "2026-10-16T14:25",
     "failed": ["s3"], "flags": [(18, {"title": "Loose gait belt during walk", "severity": "moderate", "kind": "other",
                                       "detail": "The belt slides up toward the ribs during the walk."})]},
    {"id": "rt-g02", "caregiver": "cg-carlos", "skill": "skill-gait", "created": "2026-11-06T09:15",
     "failed": ["s2"], "flags": [(20, {"title": "Client stumbled on the turn", "severity": "moderate",
                                       "kind": "patient_unsteady",
                                       "detail": "The client catches a foot while turning and is steadied late."})]},
]
RETRAINING_REVIEW_HOURS = 22  # Patricia Chen decides about a day after each submission


# --- what the API must derive from all of the above -------------------------------------
TARGET_MISSED_STEPS = [  # (step title, skill name, failures in the last 30 days)
    ("Lock wheelchair brakes", "Bed-to-Wheelchair Transfer", 11),      # mock: Wheelchair brakes not locked
    ("Secure the gait belt", "Bed-to-Wheelchair Transfer", 8),         # mock: Gait belt not secured
    ("Cue the client before the pivot", "Bed-to-Wheelchair Transfer", 6),  # mock: Client not cued before pivot
    ("Stand with even weight", "Assisted Standing", 5),                # mock: Uneven weight during stand
    ("Lower and confirm a safe sit", "Bed-to-Wheelchair Transfer", 4),  # mock: Incomplete sit confirmation
]
TARGET_FLAGGED_SKILLS = [  # (skill name, counting flags in the last 30 days)
    ("Bed-to-Wheelchair Transfer", 9),
    ("Assisted Standing", 6),
    ("Fall Recovery Positioning", 4),
    ("Gait Belt Assistance", 2),
]
EXPECTED_PENDING = 8
EXPECTED_RESTRICTED = {"Emily Davis", "Carlos Ramirez"}
EXPECTED_SARAH_CHEN = {"verified": 2, "in_review": 1, "needs_practice": 1, "not_started": 5}
NEWEST_PENDING_MINUTES = 18
