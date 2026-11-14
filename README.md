# Caregiver skills verification

Video-based training and verification for caregiver skills such as wheelchair transfers, glove removal and sit-to-stand. The product name is not final: the web app shows the placeholder set in `frontend/src/shared/brand.ts`.

- **Nurse:** records a reference video. Gemini names the maneuver, splits it into timestamped steps, and writes pass / fail / cannot-verify criteria for each step.
- **Caregiver:** picks a skill and records an attempt. Gemini finds each step in the attempt, flags steps done out of order, grades every step with feedback, identifies patient and caregiver, and flags visible patient distress or loss of balance, which feed the result.
- **Nurse review:** the attempt next to the reference, with a clickable step timeline. Every time range plays that stretch and stops at its end. The nurse can override any step and makes the final decision; the AI never certifies anyone.
- **Movement data:** joint angles and balance readings for each frame, stored in Tiger Data and charted over video time.

## Run it

```bash
cp .env.example .env      # add GEMINI_API_KEY and the Tiger Data DATABASE_URL
uv sync
make run                  # the API and the web app; open the address it prints (http://localhost:3000)
```

`make run` starts both halves and Ctrl-C stops both. The web app is the only thing you open. The API runs behind it on whichever local port is free, so nothing depends on port 8000; the web app forwards `/api` to it.

### Logins

Nobody signs up. The accounts that can log in are a fixed set of six, listed in `backend/scripts/logins.py`, and all of them belong to the one agency (the default agency), so they share its skills and submissions:

| Username | Person | Role |
| --- | --- | --- |
| `nurse` | Morgan Reyes | Nurse |
| `nurse2` | Dana Whitfield | Nurse |
| `caregiver` | Jamie Carter | Caregiver |
| `caregiver2` | Riley Nguyen | Caregiver |
| `caregiver3` | Sam Okafor | Caregiver |
| `caregiver4` | Alex Moreno | Caregiver |

`make logins` writes the usernames and passwords to `LOGINS.md` in the repository root. That file is gitignored and is the only copy of the passwords: the database keeps hashes. Running it again leaves what exists alone:

- A login that already has a password keeps it and stays signed in. Its line in `LOGINS.md` is carried over as long as it still matches the stored hash; otherwise the file says "unchanged (not recorded here)".
- A login that does not exist yet gets a new random password. Adding a login means adding a line to `LOGINS` and running `make logins`; nobody else's password changes.
- Anyone else who has a username loses it, and their sessions. Taking a line out of `LOGINS` and running `make logins` removes that login.
- `make logins ARGS="--reset nurse,caregiver2"` gives only those logins a new password and signs only them out. `make logins ARGS="--reset-all"` does it for every login. An unknown name is an error and changes nothing.

The top of `LOGINS.md` says which accounts changed in the last run. There is no password change in the app.

If port 3000 is taken, the web app starts on the next free port and prints it. If `DATABASE_URL` is empty or is not a `postgres://` URL, the API falls back to a local TimescaleDB container (`make db`).

### Standard skills and starting from scratch

There is no sample agency and no invented data: the only data is what real people record. Every database starts with the nine standard skills (steps, criteria and step times kept in `backend/app/builtin_skills.json`, reference videos in `reference_vids/`). The API adds any that are missing when it starts; `make skills` does the same without starting it, `make skills ARGS=check` checks the file, and `make skills ARGS=export` rewrites it from this database. A standard skill is an ordinary skill once installed: a nurse can edit it, rebuild it or record a new reference for it, but cannot delete its last version.

`make reset-data` prepares a database for real use, so that caregivers start with nothing recorded. By default it only prints what it would delete. `make reset-data ARGS="--yes"` does it, in one transaction. It deletes every agency other than the default one with everything in it; every attempt in the default agency with its recording, steps, flags, jobs and pose rows; and default-agency accounts that have no username (left over from the old sign-up flow). It clears everyone's "notifications seen" time. It keeps the default agency, the logins and their passwords, every skill with its steps and reference video, the pose data of reference videos and the log of Gemini calls. Add `--files` to also delete video and thumbnail files under the data directory that no video refers to any more (it prints how many and how many megabytes). This is destructive and cannot be undone; run it without `--yes` first.

### Commands

| Command | What it does |
| --- | --- |
| `make run` | Start the API and the web app together (`PORT=3100 make run` for another web port, `API_PORT=8000 make run` to pin the API's port) |
| `make dev` | Start only the API, on port 8000. Do not use `--reload`: a restart interrupts running jobs. |
| `make web` | Start only the web app. It expects the API from `make dev`; point it elsewhere with `API_URL`. |
| `make test` | Run the tests (canned AI, local TimescaleDB container, no Gemini calls) |
| `make logins` | Make the six logins; existing ones keep their passwords (`ARGS="--reset nurse"`, `ARGS="--reset-all"`). Writes `LOGINS.md` |
| `make reset-data` | Show what would be deleted to start from scratch; `ARGS="--yes"` deletes it, `--files` also removes unused video files |
| `make skills` | Add any of the nine standard skills this database lacks (no Gemini calls) |
| `make seed` | Build rubrics from the primary videos in `reference_vids/`, falling back to a backup if a primary fails |
| `make e2e ARGS="--skills sit_to_stand --cases self,truncated"` | Run stand-in caregiver attempts against seeded skills |
| `make repose` | Re-measure pose for every skill's reference video |
| `make cost` | Recorded Gemini spend for the current database |

Gemini calls stop when the spend recorded in the database reaches `GEMINI_BUDGET_USD` (default 14). A nurse's Settings page shows how much is used.

## Where each backend function lives in the web app

| Backend function | Screen |
| --- | --- |
| Log in, log out | `/login`, the account menu |
| Record or upload a reference video; detect the skill; write steps and criteria | Dashboard → Skills → New skill |
| Skill with timestamped steps, criteria, versions | Dashboard → Skills → a skill |
| Edit a skill, its steps, criteria, prerequisites and caregiver-facing text | "Edit skill" on a skill |
| Rebuild steps as a new version, add a new reference, delete a version | Actions on a skill |
| Record or upload an attempt; grading progress | Portal → a skill → the practice flow |
| A caregiver's result: step feedback, time ranges, safety notes, nurse decision | Portal → a skill → results |
| Review queue, including attempts still processing or that failed | Dashboard → Overview and Pending reviews |
| Review an attempt: video, reference, step timeline, per-step override, decision | Dashboard → a review |
| Roster with progress; a caregiver's history and status | Dashboard → Caregivers |
| Approved competencies | Dashboard → Verified skills |
| Safety patterns, open safety issues | Dashboard → Overview and Safety reports |
| Pose time series, per-person readings, trends, Tiger Data storage facts | Dashboard → Safety reports → Movement data, and Movement detail |
| Notifications and activity | The bell and the Overview |
| Profile, agency name, notification preferences, database and Gemini spend | Dashboard → Settings; Portal → Profile |

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

**What the screens call a state.** The database stores the AI's result, the nurse's decision, the flags and the job. Everything shown as a state is derived from those in one place, `backend/app/progress.py`, so the two portals cannot disagree: an attempt is processing, failed processing, awaiting a nurse, approved or sent back for retraining; a skill is not started, in review, to practise again, or verified for a caregiver.

**Accounts.** The logins are a fixed set of six with generated passwords (`make logins`); there is no sign-up and no password change in the app. Passwords are stored as scrypt hashes. A login sets an HttpOnly session cookie; only its hash is stored. Every route checks the session, the role (nurse or caregiver) and the agency: a caregiver sees the agency's skills and only their own attempts, and one agency never sees another's data.

**Tiger Data.** `pose_frames` is a hypertable with one row per measured frame per tracked person (12 joint angles, centre of mass, base of support, balance score, sway). `pose_1s` is a continuous aggregate the dashboard reads, alongside toolkit aggregates on the raw frames. Accounts, skills, steps, criteria, attempts, flags, jobs and a log of every Gemini call are ordinary tables in the same database. Schema: `backend/app/schema.sql`.

Pose is measured on every frame up to 30 fps for videos of up to about 100 seconds; longer videos are sampled down to 3,000 frames. Balance readings exist only while a person is standing with both feet in view.

## API

All routes are under `/api`, return JSON, and need a session (cookie, or `Authorization: Bearer <token>`) except `/health`, `/auth/login` and `/auth/session`. Times are seconds from the start of the video. Statuses are `passed`, `failed` or `unverified`.

| Route | Purpose |
| --- | --- |
| `POST /auth/login`, `/auth/logout` | Log in with `{username, password}`; log out. There is no sign-up. |
| `GET /auth/session`, `GET /auth/me`, `PATCH /auth/me` | Who is signed in; edit name, title, credentials, notification preferences |
| `PATCH /org` | Rename the agency (nurse) |
| `POST /videos` | Multipart upload: `file`, `kind` (`reference`, nurses only, or `attempt`), and for an attempt `skill_id`. Returns `{video_id, job_id, attempt_id}`. |
| `GET /jobs/{id}` | Pipeline progress: `status` (`queued`, `running`, `done`, `error`), `stages[]`, `error`, `skill_id`, `attempt_id`. Poll until done. |
| `GET /skills` | Newest version of each skill. `?all=1` for every version. |
| `GET /skills/{id}` | The skill with `steps[]`, `people`, `safety_criteria`, `guide` (caregiver-facing text and recording prompts), `video`, `versions[]` and `latest_id` |
| `PATCH /skills/{id}`, `PATCH /skills/{id}/steps/{step_id}` | Edit a skill or a step, including its criteria and `must_follow` (nurse) |
| `POST /skills/{id}/regenerate`, `DELETE /skills/{id}` | Rebuild the rubric as a new version; delete a version (nurse) |
| `GET /my/skills` | The signed-in caregiver's skills with their standing on each |
| `GET /attempts?skill_id=&caregiver_id=&state=`, `GET /attempts/{id}` | Attempts with `review_state`, `ai_assessment`, `final_status`; one attempt adds `steps[]`, `order_violations[]`, `safety_flags[]`, `people`, `video`, `reference_video`, `job` |
| `POST /attempts/{id}/review` | Nurse decision: `{overall, note, steps: [{step_id, status, note}]}` |
| `GET /caregivers`, `GET /caregivers/{id}`, `PATCH /caregivers/{id}` | Roster with progress; one caregiver's skills and history (nurse) |
| `GET /overview`, `POST /notifications/seen` | Counts, safety patterns, activity and notifications for the nurse's agency |
| `GET /videos/{id}/file`, `GET /videos/{id}/thumb?t=12.5` | The MP4, with Range support for seeking; a JPEG frame |
| `GET /safety/overview`, `/safety/trends`, `/safety/storage` | Movement-data tables across videos, and hypertable facts (nurse) |
| `GET /safety/videos/{id}/series`, `/frames`, `/summary` | Per-person pose series over video time, and per-track statistics (nurse) |
| `GET /health` | Database, model names and recorded Gemini spend |

## Layout

| Path | What it is |
| --- | --- |
| `frontend/` | The web app (Next.js): marketing, login, caregiver portal, nurse dashboard. See its README. |
| `backend/app/models.py` | Shared data contracts between stages, database and UI |
| `backend/app/schema.sql` | Tiger Data schema |
| `backend/app/auth.py`, `progress.py` | Accounts and sessions; the states derived from attempts |
| `backend/app/jobs.py` | Pipeline runner and the stage contract |
| `backend/app/stages/` | `classify`, `rubric`, `timeline`, `evaluate`, `scoring`, `pose` |
| `backend/app/gemini.py` | Gemini wrapper: upload cache, structured output, retries, output cap, call log, spend cap |
| `backend/app/media.py` | ffmpeg-based conversion, thumbnails and cutting (bundled binary, no system install) |
| `backend/app/routers/` | HTTP API |
| `backend/scripts/` | Starting both halves, the standard skills, logins, resetting the data, end-to-end runs, pose re-measurement, spend report |
| `reference_vids/` | Reference videos for nine skills |

## Limits worth knowing

- Video files live on the machine that uploaded them; only the database is shared. A reference video missing on your machine is rebuilt from `reference_vids/` on first use. Attempts recorded on another machine cannot be played; the screens say so and still show the results.
- Pose comes from a single camera. When two people overlap, the pose model can merge them into one skeleton, so per-person readings are unreliable for those moments and some tracks are left without a role. Pose flags are advisory unless Gemini confirms them on video.
- The nine seeded rubrics were built from edited instructional videos. Their step times refer to those videos.
- The logins are shared, fixed accounts. There is no sign-up, password change or invitation flow; adding a login means editing `backend/scripts/logins.py` and running `make logins`, and a forgotten password is replaced with `make logins ARGS="--reset <name>"`.
- Notifications appear in the app only. No emails are sent.
