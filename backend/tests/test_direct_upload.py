"""Uploads that go straight to the API's own address, with an upload ticket instead of the
login cookie (for hosts whose proxy caps request bodies)."""
import re

from fastapi.testclient import TestClient

from app import auth, config, db
from app.main import allowed_origin_regex, app


def test_without_a_public_address_uploads_go_through_the_web_app(migrated, monkeypatch):
    monkeypatch.setattr(config, "PUBLIC_API_URL", "")
    monkeypatch.setattr(config, "PROXY_MAX_UPLOAD_MB", 0.0)
    target = TestClient(app).get("/api/videos/upload-target").json()
    assert target == {"url": None, "token": None, "max_bytes": config.MAX_UPLOAD_MB * (1 << 20)}

    monkeypatch.setattr(config, "PROXY_MAX_UPLOAD_MB", 19.0)
    assert TestClient(app).get("/api/videos/upload-target").json()["max_bytes"] == 19_000_000


def test_the_target_needs_a_login(migrated):
    client = TestClient(app)
    client.headers.pop("authorization")
    assert client.get("/api/videos/upload-target").status_code == 401


def test_a_ticket_uploads_a_video_and_does_nothing_else(migrated, monkeypatch, sample_video):
    monkeypatch.setattr(config, "PUBLIC_API_URL", "https://api.example.test")
    target = TestClient(app).get("/api/videos/upload-target").json()
    assert target["url"] == "https://api.example.test/api/videos"
    assert target["max_bytes"] == config.MAX_UPLOAD_MB * (1 << 20)

    ticket = TestClient(app)
    ticket.headers["authorization"] = f"Bearer {target['token']}"
    # Not a login: every other route refuses it.
    for path in ("/api/auth/me", "/api/skills", "/api/attempts", "/api/videos/upload-target"):
        assert ticket.get(path).status_code == 401, path
    assert ticket.get("/api/auth/session").json() == {"user": None}

    with sample_video.open("rb") as handle:
        sent = ticket.post("/api/videos", data={"kind": "reference"},
                           files={"file": ("sittostand_primary.mp4", handle, "video/mp4")})
    assert sent.status_code == 200, sent.text
    video = db.fetch_one("SELECT uploaded_by FROM videos WHERE id=%s", (sent.json()["video_id"],))
    signed_in = TestClient(app).get("/api/auth/me").json()
    assert str(video["uploaded_by"]) == signed_in["id"]  # recorded under the person the ticket was made for


def test_an_expired_or_unknown_ticket_is_refused(migrated):
    user = db.fetch_one("SELECT id FROM users WHERE email='test.nurse@example.test'")
    token = auth.create_upload_ticket(user["id"])
    assert auth.user_for_token(token, scope=auth.UPLOAD_SCOPE)["id"] == user["id"]
    assert auth.user_for_token(token) is None
    db.execute("UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE scope='upload'")
    assert auth.user_for_token(token, scope=auth.UPLOAD_SCOPE) is None

    client = TestClient(app)
    client.headers["authorization"] = f"Bearer {token}"
    assert client.post("/api/videos", data={"kind": "reference"},
                       files={"file": ("x.mp4", b"not a video", "video/mp4")}).status_code == 401
    # The next ticket made clears the expired ones.
    auth.create_upload_ticket(user["id"])
    assert db.fetch_one("SELECT count(*) AS n FROM sessions WHERE scope='upload' AND expires_at < now()")["n"] == 0


def test_only_the_web_apps_origins_and_local_addresses_may_call_the_api():
    pattern = re.compile(allowed_origin_regex(["https://app.example.test", "https://app-*.example.test"]))
    for origin in ("http://localhost:3000", "http://127.0.0.1:3100", "https://app.example.test",
                   "https://app-git-main-team.example.test"):
        assert pattern.fullmatch(origin), origin
    for origin in ("https://evil.example.test", "https://app.example.test.evil.io", "https://appx.example.test",
                   "https://app-a.b.example.test", "http://app.example.test"):
        assert not pattern.fullmatch(origin), origin


def test_a_browser_on_another_origin_may_post_a_video_from_a_local_address(migrated):
    preflight = TestClient(app).options("/api/videos", headers={
        "Origin": "http://localhost:3100", "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization"})
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == "http://localhost:3100"
    refused = TestClient(app).options("/api/videos", headers={
        "Origin": "https://somewhere-else.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in refused.headers
