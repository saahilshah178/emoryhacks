# FirstShift

Video-based training and verification for caregiver skills such as wheelchair transfers, glove removal and sit-to-stand.

- **Nurse:** records a reference video. Gemini names the maneuver, splits it into timestamped steps, and writes pass / fail / unverified criteria for each step.
- **Caregiver:** picks a skill and records an attempt. Gemini finds each step in the attempt, flags steps done out of order, grades every step with feedback, identifies patient and caregiver, and flags visible patient distress or loss of balance, which feed the result.
- **Nurse review:** a video player with a clickable step timeline, so a nurse can jump straight to any step and override the result.
- **Safety dashboard:** joint angles and balance readings for each frame, stored in Tiger Data and charted over video time.

## Run it

```bash
cp .env.example .env      # add GEMINI_API_KEY and the Tiger Data DATABASE_URL
uv sync
make dev                  # http://localhost:8000
```

Use the Nurse / Caregiver switch at the top right. There is no login.

If `DATABASE_URL` is empty or is not a `postgres://` URL, the app falls back to a local TimescaleDB container (`make db`).

| Command | What it does |
| --- | --- |
| `make dev` | Start the API and the test UI on port 8000. Do not use `--reload`: a restart interrupts running jobs. |
| `make test` | Run the tests (canned AI, local TimescaleDB container, no Gemini calls) |
| `make seed` | Build rubrics from the primary videos in `reference_vids/`, falling back to a backup if a primary fails |
| `make e2e ARGS="--skills sit_to_stand --cases self,truncated"` | Run stand-in caregiver attempts against seeded skills |
| `make repose` | Re-measure pose for every skill's reference video |
| `make fake-demo` | Create a sample skill and attempt with canned AI output |
| `make cost` | Recorded Gemini spend for the current database |

Gemini calls stop when the spend recorded in the database reaches `GEMINI_BUDGET_USD` (default 14). The home page shows how much is used.

## Web app

The product UI is a Next.js app in `frontend/landing`: marketing page, login, caregiver portal and nurse dashboard on one port.

```bash
npm install --prefix frontend/landing
npm run dev               # http://localhost:3000
```

- Landing: `/`
- Caregiver portal: `/portal`
- Nurse dashboard: `/dashboard`

## How it works

**Reference video (nurse).** Every upload is converted to a seekable H.264 MP4, then:

1. `classify`: which maneuver it is, who is in it, whether order matters.
2. `rubric`: an outline of the steps, then a second pass on clips at a higher frame rate to pin each step's start and end. Each step gets pass criteria, fail criteria, conditions under which it must be marked unverified, a critical flag and its prerequisites.
3. `pose`: joint angles and balance readings into Tiger Data.

**Attempt (caregiver).**

1. `timeline`: where each rubric step happens in the attempt. Order violations are computed in code from the rubric's prerequisites, not asked of the model.
2. `evaluate`: a status, feedback and evidence for each step; the people and their roles; patient-safety flags. Steps that are unverified, low-confidence or failed-and-critical get a second look on just their clip with the stronger model.
3. `pose`, then pose-derived flags about a patient are shown to Gemini on their clip. Only confirmed ones count.
4. `score`: a deterministic function of the above. The exact rules are in the docstring of `backend/app/stages/scoring.py`.

**Tiger Data.** `pose_frames` is a hypertable with one row per measured frame per tracked person (12 joint angles, centre of mass, base of support, balance score, sway). `pose_1s` is a continuous aggregate the dashboard reads, alongside toolkit aggregates on the raw frames. Skills, steps, evals, attempts, flags, jobs and a log of every Gemini call are ordinary tables in the same database. Schema: `backend/app/schema.sql`.

Pose is measured on every frame up to 30 fps for videos of up to about 100 seconds; longer videos are sampled down to 3,000 frames. Balance readings exist only while a person is standing with both feet in view.

## API

All routes are under `/api` and return JSON. CORS is open to `localhost` origins, so the Next.js apps can call it directly. Times are seconds from the start of the video. Statuses are `passed`, `failed` or `unverified`.

| Route | Purpose |
| --- | --- |
| `POST /videos` | Multipart upload: `file`, `kind` (`reference` or `attempt`), and for an attempt `skill_id` and `caregiver_name`. Returns `{video_id, job_id, attempt_id}`. |
| `GET /jobs/{id}` | Pipeline progress: `status` (`queued`, `running`, `done`, `error`), `stages[]`, `error`, `skill_id`, `attempt_id`. Poll until done. |
| `GET /skills` | Newest version of each skill. `?all=1` for every version. |
| `GET /skills/{id}` | The skill with `steps[]` (`step_id`, `title`, `description`, `start_s`, `end_s`, `critical`, `must_follow`, `evals`), `people`, `safety_criteria`, `classification`, `video` and `latest_id`. |
| `PATCH /skills/{id}`, `PATCH /skills/{id}/steps/{step_id}` | Edit a skill or a step, including its evals and `must_follow`. |
| `POST /skills/{id}/regenerate` | Rebuild the rubric as a new version. Returns `{job_id}`; the finished job's `skill_id` is the new version. |
| `GET /attempts`, `GET /attempts/{id}` | An attempt has `status`, `score_pct`, `reasons`, `needs_review`, `final_status`, `people`, `steps[]` (rubric fields plus `found`, `start_s`, `end_s`, `performed_index`, `status`, `confidence`, `feedback`, `evidence`, `double_checked`, `nurse_status`), `order_violations[]`, `safety_flags[]`, `video` and `job`. |
| `POST /attempts/{id}/review` | Nurse decision: `{overall, note, steps: [{step_id, status, note}]}`. |
| `GET /videos/{id}/file` | The MP4, with Range support for seeking. |
| `GET /videos/{id}/thumb?t=12.5` | A JPEG frame at `t` seconds. |
| `GET /safety/overview`, `/safety/trends`, `/safety/storage` | Dashboard tables across videos, and hypertable facts. |
| `GET /safety/videos/{id}/series`, `/frames`, `/summary` | Per-person pose series over video time, and per-track statistics. |
| `GET /health` | Database, model names and recorded Gemini spend. |

## Layout

| Path | What it is |
| --- | --- |
| `backend/app/models.py` | Shared data contracts between stages, database and UI |
| `backend/app/schema.sql` | Tiger Data schema |
| `backend/app/jobs.py` | Pipeline runner and the stage contract |
| `backend/app/stages/` | `classify`, `rubric`, `timeline`, `evaluate`, `scoring`, `pose` |
| `backend/app/gemini.py` | Gemini wrapper: upload cache, structured output, retries, output cap, call log, spend cap |
| `backend/app/media.py` | ffmpeg-based conversion, thumbnails and cutting (bundled binary, no system install) |
| `backend/app/routers/` | HTTP API |
| `backend/scripts/` | Seeding, end-to-end runs, pose re-measurement, spend report |
| `testui/` | Built-in test UI: static pages served at `/`, one per screen, no build step |
| `reference_vids/` | Reference videos for nine skills |

## Limits worth knowing

- Video files live on the machine that uploaded them; only the database is shared. A reference video missing on your machine is rebuilt from `reference_vids/` on first use. Attempts recorded on another machine cannot be played.
- Pose comes from a single camera. When two people overlap, the pose model can merge them into one skeleton, so per-person readings are unreliable for those moments and some tracks are left without a role. Pose flags are advisory unless Gemini confirms them on video.
- The nine seeded rubrics were built from edited instructional videos. Their step times refer to those videos.
- The Nurse / Caregiver switch only changes the navigation. Nothing stops a caregiver opening a nurse page by URL.
