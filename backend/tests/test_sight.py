"""The sight-only check for rubric text (app/stages/sight.py). No database needed."""
import pytest

from app.stages import sight


@pytest.mark.parametrize("text, words", [
    ("Caregiver verbally asks the patient if they are feeling okay.", ["verbally", "asks"]),
    ("Caregiver does not ask the patient how they feel.", ["ask"]),
    ("The recording has no audio or the caregiver's speech is inaudible.", ["audio", "speech", "inaudible"]),
    ("Caregiver counts out loud before the patient stands.", ["counts", "out loud"]),
    ("Greet patient and explain transfer", ["greet", "explain"]),
    ("Instruct patient to hold armrests", ["instruct"]),
    ("Cue and assist patient to stand", ["cue"]),
    ("Caregiver tells the patient to look forward, then says \"1, 2, 3\".", ["tells", "says"]),
    ("Caregiver calls out for a colleague.", ["calls out"]),
])
def test_speech_is_found(text, words):
    assert sight.spoken_words(text) == words


@pytest.mark.parametrize("text", [
    "Use call bell to summon help",
    "Place the call light within the resident's reach.",
    "Caregiver moves promptly to the unsteady patient and places hands on their upper arms.",
    "Caregiver stands directly behind the patient.",
    "Fall response",
    "Caregiver kneels beside the seated patient with a reassuring hand on their shoulder.",
    "Avoids direct contact between bare skin and the outside of the glove.",
    "Patient slides slowly down the caregiver's leg to a seated position on the floor.",
    "The patient is hurt or cannot get up unaided after being lowered.",
    "Caregiver looks at the patient's face and checks them over before moving them.",
    "",
])
def test_actions_that_are_not_speech_pass(text):
    assert sight.spoken_words(text) == []


def test_speech_problems_names_the_step_and_the_place():
    steps = [
        {"step_id": "s1", "title": "Steady the patient", "description": "Hands on the upper arms.",
         "applies_when": "",
         "evals": {"pass_criteria": ["Caregiver places hands on the patient's upper arms."],
                   "fail_criteria": ["Caregiver does not ask the patient how they feel."],
                   "unverified_when": ["The patient is out of frame."], "visual_cues": []}},
        {"step_id": "s2", "title": "Explain the move", "description": "Say what will happen.", "evals": {}},
    ]
    problems = sight.speech_problems(steps)
    assert [(p["step_id"], p["where"]) for p in problems] == [
        ("s1", "fail_criteria[0]"), ("s2", "title"), ("s2", "description")]
    assert problems[0]["words"] == ["ask"]
    assert sight.speech_problems(steps[:1])[0]["text"] == "Caregiver does not ask the patient how they feel."


def test_a_sight_only_rubric_has_no_problems():
    steps = [{"step_id": "s1", "title": "Lock the wheelchair brakes", "description": "Push both brake levers on.",
              "applies_when": "The chair has brakes.",
              "evals": {"pass_criteria": ["Both brake levers are pushed to the locked position."],
                        "fail_criteria": ["A brake lever is left off."],
                        "unverified_when": ["The wheels are out of frame."],
                        "visual_cues": ["Caregiver reaches down to the wheels."]}}]
    assert sight.speech_problems(steps) == []
