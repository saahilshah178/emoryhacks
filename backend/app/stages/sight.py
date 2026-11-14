"""Checks that a rubric can be graded by sight alone.

A caregiver's recording is graded with its sound removed (gemini.ensure_file), because what
is said, and how well a microphone picks it up, varies too much between recordings to grade
fairly. So nothing in a rubric may depend on speech: no step that is only something said, and
no criterion about asking, telling, explaining, counting aloud or what can be heard.

  spoken_words(text)       the speech-dependent words in one piece of rubric text
  speech_problems(steps)   every piece of text in a rubric's steps that has any

The word list is deliberately plain. It catches a criterion like "Caregiver asks the patient
how they feel" and leaves alone the things a caregiver does that only sound similar: "call
bell", "call light", "directly behind", "promptly", "fall response", "a reassuring hand",
"the care plan calls for a gait belt". Calling for help is speech; pressing a call bell is not.
The rubric stage uses it to send a draft back for rewriting, and `make skills ARGS=check`
uses it to keep the standard skills clean.
"""
from __future__ import annotations

import re
from collections.abc import Iterable

_SPEECH = re.compile(
    r"""\b(?:
        ask(?:s|ed|ing)? | say(?:s|ing)? | said | tell(?:s|ing)? | told
      | explain(?:s|ed|ing)? | explanations?
      | verbal(?:ly|ise[sd]?|ize[sd]?)? | speak(?:s|ing)? | spoken? | speech | talk(?:s|ed|ing)?
      | instruct(?:s|ed|ing)? | instructions?
      | greet(?:s|ed|ing|ings?)? | introduc(?:e|es|ed|ing|tions?)
      | announc(?:e|es|ed|ing) | inform(?:s|ed|ing)? | remind(?:s|ed|ing)?
      | answer(?:s|ed|ing)? | repl(?:y|ies|ied|ying) | questions?
      | discuss(?:es|ed|ing)? | conversations?
      | stat(?:es|ed|ing) | prompt(?:s|ed|ing)? | cue(?:s|d|ing)?
      | count(?:s|ed|ing)? | aloud | out\s+loud | call(?:s|ed|ing)?\s+out | shout(?:s|ed|ing)? | yell(?:s|ed|ing)?
      | call(?:s|ed|ing)?\s+for\s+(?:help|assistance|backup)
      | communicat(?:e|es|ed|ing|ion) | consent(?:s|ed|ing)? | permission
      | encourag(?:e|es|ed|ing|ement) | reassur(?:e|es|ed|ance)
      | hear(?:s|d|ing)? | listen(?:s|ed|ing)? | audio | (?:in)?audibl[ey] | microphone
      | voic(?:e|es|ed|ing) | words? | narrat(?:e|es|ed|ing|ion|or)
    )\b""",
    re.IGNORECASE | re.VERBOSE,
)

# Where a step's text lives, in the order problems are reported.
_LISTS = ("pass_criteria", "fail_criteria", "unverified_when", "visual_cues")


def spoken_words(text: str) -> list[str]:
    """The speech-dependent words in text, lowercased, each once, in the order they appear."""
    found: list[str] = []
    for match in _SPEECH.finditer(text or ""):
        word = " ".join(match.group(0).lower().split())
        if word not in found:
            found.append(word)
    return found


def step_texts(step: dict) -> Iterable[tuple[str, str]]:
    """(where, text) for every piece of text in a rubric step. step is a RubricStep as a dict
    (model_dump(), a skill_steps row, or an entry of builtin_skills.json)."""
    for field in ("title", "description", "applies_when"):
        if step.get(field):
            yield field, step[field]
    evals = step.get("evals") or {}
    for field in _LISTS:
        for i, text in enumerate(evals.get(field) or []):
            yield f"{field}[{i}]", text


def speech_problems(steps: Iterable[dict]) -> list[dict]:
    """Every piece of text in steps that depends on speech:
    [{step_id, where, text, words}], in step order. Empty when the rubric is sight-only."""
    out = []
    for step in steps:
        for where, text in step_texts(step):
            words = spoken_words(text)
            if words:
                out.append({"step_id": step.get("step_id") or str(step.get("number", "")), "where": where,
                            "text": text, "words": words})
    return out
