"""Classify stage: post-processing of the model reply, the request it builds, and the fake path.
No Gemini calls: run() is exercised with a stub context."""
from app import config
from app.models import Classification
from app.stages import classify
from app.stages.classify import _Person, _Reply


def _reply(**overrides) -> _Reply:
    fields = dict(
        observed="A caregiver helps a seated person stand.",
        skill_slug="sit_to_stand", skill_name="Sit to stand", category="transfer", confidence=0.9,
        alternatives=[], summary="A caregiver helps a seated person stand up.", order_matters=True,
        people=[_Person(label="P1", role="caregiver", description="Adult in navy scrubs"),
                _Person(label="P2", role="patient", description="Older adult in a grey cardigan")],
    )
    fields.update(overrides)
    return _Reply(**fields)


class _StubCtx:
    """Just enough of jobs.StageContext for classify.run."""

    def __init__(self, duration: float, reply: _Reply, slug_hint: str | None = None):
        self.duration = duration
        self.slug_hint = slug_hint
        self.reply = reply
        self.calls: list[dict] = []
        self.logs: list[str] = []

    def video_part(self, **kwargs) -> dict:
        return {"type": "video", **kwargs}

    def generate_json(self, purpose, parts, schema, **kwargs):
        self.calls.append({"purpose": purpose, "parts": parts, "schema": schema, **kwargs})
        return self.reply

    def log(self, message: str) -> None:
        self.logs.append(message)


def test_aliases_map_near_misses_onto_catalog_slugs():
    assert classify.canonical_slug("Bed-to-Wheelchair Transfer") == "wheelchair_transfer"
    assert classify.canonical_slug("gait_belt_ambulation") == "assisted_walking"
    assert classify.canonical_slug("controlled fall") == "fall_response"
    assert classify.canonical_slug("glove_removal") == "glove_removal"
    assert classify.canonical_slug("Hoyer Lift Transfer") == "hoyer_lift_transfer"
    assert all(target in classify.catalog.BY_SLUG for target in classify.ALIASES.values())


def test_alias_takes_catalog_name_and_category():
    c = classify.postprocess(_reply(skill_slug="controlled_fall", skill_name="Controlled fall", category="safety"))
    assert (c.skill_slug, c.skill_name, c.category) == ("fall_response", "Fall response", "emergency")


def test_new_slug_keeps_model_name_and_normalises_category():
    c = classify.postprocess(_reply(skill_slug="Hoyer lift transfer", skill_name="Hoyer lift transfer",
                                    category="Infection Control"))
    assert (c.skill_slug, c.skill_name, c.category) == ("hoyer_lift_transfer", "Hoyer lift transfer", "infection_control")
    assert classify.postprocess(_reply(skill_slug="feeding", category="nutrition")).category == "other"


def test_confidence_is_clamped():
    assert classify.clamp_confidence(1.7) == 1.0
    assert classify.clamp_confidence(-0.3) == 0.0
    assert classify.clamp_confidence(0.734) == 0.73


def test_alternatives_are_aliased_deduplicated_and_exclude_the_choice():
    c = classify.postprocess(_reply(
        skill_slug="wheelchair_transfer",
        alternatives=["bed_to_wheelchair_transfer", "Sit to stand", "sit_to_stand", "gait_belt_ambulation",
                      "", "vehicle_transfer"],
    ))
    assert c.alternatives == ["sit_to_stand", "assisted_walking", "vehicle_transfer"]


def test_person_labels_are_made_unique():
    people = [_Person(label="p1", role="caregiver", description=" Navy scrubs "),
              _Person(label="P1", role="patient", description="Grey cardigan"),
              _Person(label="", role="other", description="Narrator"),
              _Person(label="P2", role="other", description="Bystander")]
    out = classify.unique_people(people)
    assert [p.label for p in out] == ["P1", "P2", "P3", "P4"]
    assert [p.role for p in out] == ["caregiver", "patient", "other", "other"]
    assert out[0].description == "Navy scrubs"


def test_sample_fps_caps_frames_on_long_videos():
    assert classify.sample_fps(90) is None
    assert classify.sample_fps(150) is None
    assert classify.sample_fps(300) == 0.5
    assert classify.sample_fps(876) * 876 <= classify.MAX_FRAMES + 1


def test_run_builds_one_main_model_call_without_the_hint(monkeypatch):
    monkeypatch.setattr(config, "FAKE_AI", False)
    ctx = _StubCtx(400, _reply(skill_slug="stand_pivot_transfer"), slug_hint="sit_to_stand")
    result = classify.run(ctx)

    assert isinstance(result, Classification) and result.skill_slug == "wheelchair_transfer"
    (call,) = ctx.calls
    assert call["model"] == "main" and call["schema"] is _Reply
    video, prompt = call["parts"]
    assert video["type"] == "video" and video["resolution"] == "low" and video["fps"] == 0.375
    assert "400 seconds" in prompt["text"] and "glove_removal" in prompt["text"]
    assert "sit_to_stand" in prompt["text"]  # listed in the catalog, but never singled out as the answer
    assert "expected" not in prompt["text"].lower()
    assert ctx.logs and "expected sit_to_stand" in ctx.logs[0]


def test_fake_path_makes_no_call(monkeypatch):
    monkeypatch.setattr(config, "FAKE_AI", True)
    ctx = _StubCtx(60, _reply(), slug_hint="glove_removal")
    result = classify.run(ctx)
    assert result.skill_slug == "glove_removal" and ctx.calls == []
