# FirstShift

Video-based training and verification for caregiver skills (wheelchair transfers, glove removal, sit-to-stand and more).

- **Nurse:** records a reference video. Gemini names the maneuver, splits it into timestamped steps and writes pass / fail / unverified criteria for each step.
- **Caregiver:** picks a skill and records an attempt. Gemini finds each step in the attempt, flags steps done out of order, grades every step with feedback, identifies patient and caregiver, and flags visible patient distress or off-centre posture.
- **Nurse review:** a video player with a clickable step timeline, so a nurse can jump straight to any step and override the result.
- **Safety dashboard:** per-frame joint angles and balance readings stored in Tiger Data and charted over time.

## Run it

```bash
cp .env.example .env      # add GEMINI_API_KEY and the Tiger Data DATABASE_URL
uv sync
make dev                  # http://localhost:8000
```

If `DATABASE_URL` is empty the app uses a local TimescaleDB container instead: `make db`.

Other commands: `make test`, `make seed` (build rubrics from `reference_vids/`), `make fake-demo` (sample data without calling Gemini), `make cost` (recorded Gemini spend).

## Layout

| Path | What it is |
| --- | --- |
| `backend/app/models.py` | Shared data contracts between stages, database and UI |
| `backend/app/schema.sql` | Tiger Data schema: tables, the `pose_frames` hypertable, the `pose_1s` rollup |
| `backend/app/jobs.py` | Pipeline runner and the stage contract |
| `backend/app/stages/` | AI stages: `classify`, `rubric`, `timeline`, `evaluate`, `scoring`, `pose` |
| `backend/app/gemini.py` | Gemini wrapper: upload cache, structured output, retries, call log, spend cap |
| `backend/app/routers/` | HTTP API under `/api` |
| `frontend/` | Static pages, one per screen, no build step |
| `reference_vids/` | Reference videos for nine skills |
