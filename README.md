# Caregiver skills verification

Video-based training and verification for caregiver skills such as wheelchair transfers, glove removal and sit-to-stand. The product name is not final: the web app shows the placeholder set in `frontend/src/shared/brand.ts`.

- **Nurse:** records a reference video. Gemini names the maneuver, splits it into timestamped steps, and writes pass / fail / cannot-verify criteria for each step. Every criterion is something that can be seen, and a step can be marked as only needed in a certain situation.
- **Caregiver:** picks a skill and records an attempt. Gemini watches it without sound, finds each step, flags steps done out of order, grades every step with feedback, identifies patient and caregiver, and flags visible patient distress or loss of balance, which feed the result. The graded recording stays with the caregiver until they choose to send it to a nurse, which needs a high enough score. Nothing is ever sent by itself.
- **Attempts:** the nurse decides how many attempts each caregiver gets at a skill (a number, or unlimited), who a skill is assigned to, and the score needed to send a recording.
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

There is no sample agency and no invented data: the only data is what real people record. Every database starts with the nine standard skills (steps, criteria and step times kept in `backend/app/builtin_skills.json`, reference videos in `reference_vids/`). The API adds any that are missing when it starts; `make skills` does the same without starting it and prints what it changed, `make skills ARGS=check` checks the file (sight-only text, numbering, prerequisites, a condition field on every step), and `make skills ARGS=export` rewrites it from this database, raising the revision of any skill that changed. A standard skill is an ordinary skill once installed: a nurse can edit it, rebuild it or record a new reference for it, but cannot delete its last version.

Each standard skill in the file has a revision. When the file's revision of a skill is newer than the one a database holds, the API installs the revised rubric as a new version of that skill at startup, provided the newest version there is the earlier revision exactly as it was installed. A version a nurse edited, rebuilt or recorded a new reference for is left alone, a revised version a nurse deleted is not put back, and attempts keep the version they were graded against. Revision 2 made the nine rubrics gradable by sight and marked the steps that are only needed in some situations.

`make reset-data` prepares a database for real use, so that caregivers start with nothing recorded. By default it only prints what it would delete. `make reset-data ARGS="--yes"` does it, in one transaction. It deletes every agency other than the default one with everything in it; every attempt in the default agency with its recording, steps, flags, jobs and pose rows; and default-agency accounts that have no username (left over from the old sign-up flow). It clears everyone's "notifications seen" time. It keeps the default agency, the logins and their passwords, every skill with its steps and reference video, the pose data of reference videos and the log of Gemini calls. Add `--files` to also delete video and thumbnail files under the data directory that no video refers to any more (it prints how many and how many megabytes). This is destructive and cannot be undone; run it without `--yes` first.

### Attempts and sending

A nurse sets these per skill, under "Attempts and sending" on the skill's page; they apply to every version of the skill.

- **Attempts allowed:** a number from 1 to 50, or unlimited (the default). Every recording that gets graded uses one, whether or not it is sent to the nurse; a recording whose processing failed does not. When the nurse asks for retraining, the caregiver gets a fresh set. The nurse can give one caregiver their own number, make them unlimited, or grant more. A number set on a caregiver's page ("Attempts per skill") applies to every skill they have, unless a skill gives them its own.
- **Assigned to:** a checklist of the agency's caregivers, with an Assign all button. With everyone picked (the default) the skill also goes to caregivers who join later. A caregiver only sees and records skills assigned to them.
- **Score needed to send:** a graded recording is never sent to the nurse by itself. At or above this score (default 80%) the result page says the score is good enough to send, suggests sending, and offers recording again instead while attempts remain; a recording that is not sent is kept and can be sent later. Between the lower "send anyway" score (default 50%) and this one, they can still send it with a note saying what the automatic check got wrong; the nurse sees that it was sent that way, with the note. Below the lower score, or when the video does not show the skill, it cannot be sent and they record again.

A caregiver sees all their attempts at a skill. The nurse's queue, counts and notifications show only the most recent recording a caregiver sent for each skill; a recording replaced by a newer one, and practice runs that were never sent, are in the history on the review page and the caregiver's page. The rules are written out at the top of `backend/app/progress.py`.

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
| `make cost` | Gemini spend recorded for the current API key (`ARGS="--jobs 10"` adds the last jobs, one line each) |

### Gemini spend

A caregiver's recording costs about 4 to 9 cents to grade and a reference video about 8 to 20 cents (measured on recordings of up to four minutes). Three limits keep it there:

- `GEMINI_BUDGET_USD` (default 10) is the most the **current API key** may spend, as recorded in this database. Each logged call carries a short fingerprint of the key, so a new key starts from zero and an old key's spend is not counted. When it is reached, new videos are refused with a message saying so. A nurse's Settings page and `/api/health` show how much is used.
- `GEMINI_JOB_BUDGET_USD` (default 0.15) is one attempt's allowance, and `GEMINI_REFERENCE_BUDGET_USD` (default 0.20) one reference video's. The required calls always run; the optional ones (second looks at unclear steps, confirming pose flags, tightening step times, rewriting the summary) are skipped once a job has used its allowance.
- No job may spend more than 1.5 times its allowance, whatever the video does. A job that reaches that fails with a readable message instead of sending more.

A request that grades an attempt is given up on and retried after 240 seconds for the whole-video look and 90 seconds or less for the others, because a request has been seen to hang until the default ten-minute timeout and then answer in 20 seconds on the retry.

## Where each backend function lives in the web app

| Backend function | Screen |
| --- | --- |
| Log in, log out | `/login`, the account menu |
| Record or upload a reference video; detect the skill; write steps and criteria | Dashboard → Skills → New skill |
| Skill with timestamped steps, criteria, each step's "only needed when" condition, versions, the notes from building the steps, and a warning beside any criterion the check will skip because it is about something said | Dashboard → Skills → a skill |
| Edit a skill, its steps, criteria, prerequisites, "only needed when" conditions and caregiver-facing text | "Edit skill" on a skill |
| Rebuild steps as a new version, add a new reference, delete a version | Actions on a skill |
| Attempts allowed, who a skill is assigned to, the scores needed to send a recording | "Attempts and sending" on a skill |
| Record or upload an attempt; grading progress; attempts left | Portal → a skill → the practice flow |
| A caregiver's result: score against the bar, send or send anyway, step feedback, time ranges, safety notes, earlier attempts, nurse decision | Portal → a skill → results |
| Review queue: the latest recording each caregiver sent for each skill | Dashboard → Overview and Pending reviews |
| Review an attempt: video, reference, step timeline, per-step override (passed, failed, needs review or not needed), decision, the caregiver's other recordings, and which version of the skill it was graded against | Dashboard → a review |
| Roster with progress; a caregiver's skills, attempts used and allowed, and history | Dashboard → Caregivers |
| Approved competencies | Dashboard → Verified skills |
| Safety patterns, open safety issues | Dashboard → Overview and Safety reports |
| Pose time series, per-person readings, trends, Tiger Data storage facts | Dashboard → Safety reports → Movement data, and Movement detail |
| Notifications and activity | The bell and the Overview |
| Profile, agency name, notification preferences, database and Gemini spend | Dashboard → Settings; Portal → Profile |

## How it works

**Reference video (nurse).** Every upload is converted to a seekable H.264 MP4, then:

1. `classify`: which maneuver it is, who is in it, whether order matters.
2. `rubric`: an outline of the steps, then a second pass on clips at a higher frame rate to pin each step's start and end. Each step gets pass criteria, fail criteria, conditions under which it must be marked unverified, a critical flag, its prerequisites and, for a step that is not part of every correct performance, the situation it is needed in ("only needed when the patient cannot get up unaided"). Gemini hears the reference video's narration and uses it to understand the steps, but the rubric must be gradable by sight alone: text that depends on something said is sent back once for a sight-only rewrite, and whatever still depends on speech is dropped in code (`stages/sight.py`). What was changed is listed in the rubric's notes.
3. `pose`: joint angles and balance readings into Tiger Data.

**Attempt (caregiver).**

The recording is graded by sight only, because what is said, and how well a microphone picks it up, varies too much between recordings to grade fairly. Gemini gets a copy with the audio track removed (made without re-encoding and deleted after the upload; if it cannot be made, the job fails rather than grade with sound). The stored recording keeps its sound, and the nurse hears it when reviewing. Criteria that depend on speech in a rubric written before this, or typed in by a nurse, are left out before the model sees them, and a step that is only about something said is not checked at all: it is left out of the score for the nurse to hear, and a critical one is flagged.

1. One Gemini call watches the whole recording (`stages/assess.py`) and answers both of the next two stages, so the video is paid for once.
2. `timeline`: where each rubric step happens in the attempt, to a tenth of a second. Order violations are computed in code from the rubric's prerequisites, not asked of the model.
3. `evaluate`: a status, feedback and evidence for each step; the people and their roles; patient-safety flags. Up to three steps that are unverified, low-confidence or failed-and-critical get a second look on just their clip, while the job's allowance lasts. Three rules keep the grading fair to a recording that differs from the demonstration:
   - A step with an "only needed when" condition is **not needed** when that situation does not come up and the caregiver does not do it. It is left out of the score and the step counts. If the caregiver does it anyway it is graded as usual, and if the situation comes up and it is skipped it fails. Whether the situation came up is asked of the model as its own answer and the result is settled in code, so the recording ending before such a step does not fail it. Only a step with a condition can be found not needed, none is when the video does not show the skill, and a critical one goes to the nurse to confirm. A nurse can set any step to not needed when reviewing.
   - A recording that starts part-way through: a step done before it began is judged on its result when that is in view (the caregiver is already holding the patient the way the step requires), and is unverified, not failed, when nothing of it can be seen. This is the model's judgement from the prompt; code never overrides a step the model failed. A step the recording stops before is still failed, unless it has a condition whose situation had not come up.
   - The criteria come from one demonstration. What they describe must be achieved, but details incidental to that video (which side or hand, the exact furniture or equipment, the people) are not requirements.
4. `pose`, then pose-derived flags about a patient are shown to Gemini on their clip. Only confirmed ones count.
5. `score`: a deterministic function of the above. The exact rules are in the docstring of `backend/app/stages/scoring.py`. The caregiver may send the recording to a nurse depending on this score (see Attempts and sending).

**Restarts.** A job that a server restart cuts short carries on when the server starts again, from the last stage it finished: each stage's output is saved as it completes, and a Gemini request the job already paid for is answered from the call log instead of being sent again. After three resumes a job is failed with a message saying so.

**What the screens call a state.** The database stores the AI's result, the nurse's decision, the flags and the job. Everything shown as a state is derived from those in one place, `backend/app/progress.py`, so the two portals cannot disagree: an attempt is processing, failed processing, not sent yet, awaiting a nurse, replaced by a newer one, approved or sent back for retraining; a skill is not started, in progress, in review, to practise again, or verified for a caregiver.

**Accounts.** The logins are a fixed set of six with generated passwords (`make logins`); there is no sign-up and no password change in the app. A new caregiver login starts as onboarding until a nurse marks them active. Passwords are stored as scrypt hashes. A login sets an HttpOnly session cookie; only its hash is stored. Every route checks the session, the role (nurse or caregiver) and the agency: a caregiver sees the skills assigned to them and only their own attempts, and one agency never sees another's data.

**Tiger Data.** `pose_frames` is a hypertable with one row per measured frame per tracked person (12 joint angles, centre of mass, base of support, balance score, sway). `pose_1s` is a continuous aggregate the dashboard reads, alongside toolkit aggregates on the raw frames. Accounts, skills, steps, criteria, attempts, flags, jobs and a log of every Gemini call are ordinary tables in the same database. Schema: `backend/app/schema.sql`.

Pose is measured on every frame up to 30 fps for videos of up to about 100 seconds; longer videos are sampled down to 3,000 frames. Balance readings exist only while a person is standing with both feet in view.

## API

All routes are under `/api`, return JSON, and need a session (cookie, or `Authorization: Bearer <token>`) except `/health`, `/auth/login` and `/auth/session`. Times are seconds from the start of the video. Statuses are `passed`, `failed` or `unverified`; one step of an attempt may also be `not_applicable` (not needed), as the AI's result or the nurse's.

| Route | Purpose |
| --- | --- |
| `POST /auth/login`, `/auth/logout` | Log in with `{username, password}`; log out. There is no sign-up. |
| `GET /auth/session`, `GET /auth/me`, `PATCH /auth/me` | Who is signed in; edit name, title, credentials, notification preferences |
| `PATCH /org` | Rename the agency (nurse) |
| `GET /videos/upload-target` | Where to send a video: `{url, token, max_bytes}`. `url` and `token` are null when it goes to `POST /videos` on this origin; otherwise post to `url` with `Authorization: Bearer <token>` (see Hosting) |
| `POST /videos` | Multipart upload: `file`, `kind` (`reference`, nurses only, or `attempt`), and for an attempt `skill_id`. Returns `{video_id, job_id, attempt_id}`. A caregiver is refused when the skill is not assigned to them (403) or they have no attempts left (409). |
| `GET /jobs/{id}` | Pipeline progress: `status` (`queued`, `running`, `done`, `error`), `stages[]`, `error`, `skill_id`, `attempt_id`. Poll until done. |
| `GET /skills` | Newest version of each skill. `?all=1` for every version. |
| `GET /skills/{id}` | The skill with `steps[]` (each with `applies_when`, and `unheard`: the criteria the check will skip because they are about something said), `people`, `safety_criteria`, `notes`, `guide` (caregiver-facing text and recording prompts), `video`, `versions[]` and `latest_id` |
| `PATCH /skills/{id}`, `PATCH /skills/{id}/steps/{step_id}` | Edit a skill or a step, including its criteria, `must_follow` and `applies_when`, the situation the step is needed in (an empty string makes it always needed) (nurse) |
| `POST /skills/{id}/regenerate`, `DELETE /skills/{id}` | Rebuild the rubric as a new version; delete a version (nurse) |
| `GET /skills/{id}/policy`, `PUT /skills/{id}/policy` | Attempts allowed, the two scores and the assignment for a skill, with every caregiver's standing: `{max_attempts, submit_pct, force_pct, assign_all, assigned_ids}` (nurse) |
| `GET /my/skills` | The signed-in caregiver's assigned skills with their standing on each, attempts used, allowed and left, a recording that is good enough to send (`ready_attempt_id`) and one that is still being checked (`checking_attempt_id`) |
| `GET /attempts?skill_id=&caregiver_id=&state=&all=`, `GET /attempts/{id}` | Attempts with `review_state`, `ai_assessment`, `final_status`, `submitted_at`, `submit_kind`, `submission`. A nurse's list holds only recordings sent to a nurse unless `all=1`. One attempt adds `skill_latest_version`, `steps[]`, `order_violations[]`, `safety_flags[]`, `people`, `video`, `reference_video`, `job`, `policy`, `attempts {used, allowed, left}` and `history[]` |
| `POST /attempts/{id}/submit` | The caregiver sends their recording to a nurse: `{force, note}`. Refused with a sentence saying why when the score is too low |
| `POST /attempts/{id}/review` | Nurse decision on a recording that was sent: `{overall, note, steps: [{step_id, status, note}]}` |
| `GET /caregivers`, `GET /caregivers/{id}`, `PATCH /caregivers/{id}` | Roster with progress; one caregiver's skills, attempts and history; the PATCH sets `{employment, title, location, skill_attempt_limit}`, where `skill_attempt_limit` is their attempts on every skill (1 to 50, or null for each skill's own number) (nurse) |
| `PATCH /caregivers/{id}/skills/{skill_id}` | One caregiver's assignment and attempts for a skill: `{assigned, limit_mode, max_attempts, grant}` (nurse) |
| `GET /overview`, `POST /notifications/seen` | Counts, safety patterns, activity and notifications for the nurse's agency |
| `GET /videos/{id}/file`, `GET /videos/{id}/thumb?t=12.5` | The MP4, with Range support for seeking; a JPEG frame |
| `GET /safety/overview`, `/safety/trends`, `/safety/storage` | Movement-data tables across videos, and hypertable facts (nurse) |
| `GET /safety/videos/{id}/series`, `/frames`, `/summary` | Per-person pose series over video time, and per-track statistics (nurse) |
| `GET /health` | Database, model names, and the current key's Gemini spend, budget and per-job allowances |

## Hosting

The web app can be hosted apart from the API (for example the web app on Vercel and the API as the container in `Dockerfile`; `fly.toml` is one such setup). Set `API_URL` for the web app's build to the API's address; the web app forwards `/api` to it, so the browser still sees one origin and the login cookie works.

Hosts such as Vercel refuse forwarded request bodies above about 20 MB. So that longer recordings and uploaded files still work, give the API two settings: `FIRSTSHIFT_PUBLIC_API_URL`, the address browsers can reach it at, and `FIRSTSHIFT_WEB_ORIGINS`, the web app's origin. `GET /videos/upload-target` then hands the browser that address and an upload ticket, a token that is accepted only by `POST /videos` and lasts 30 minutes, and the file goes straight to the API. Without the settings, uploads go through the web app. Recordings made in the browser are kept under 19 MB either way (854x480, about 0.5 Mbit/s, four minutes at most).

## Layout

| Path | What it is |
| --- | --- |
| `frontend/` | The web app (Next.js): marketing, login, caregiver portal, nurse dashboard. See its README. |
| `backend/app/models.py` | Shared data contracts between stages, database and UI |
| `backend/app/schema.sql` | Tiger Data schema |
| `backend/app/auth.py`, `progress.py` | Accounts and sessions; the states derived from attempts, and the attempt and sending rules |
| `backend/app/builtin.py`, `builtin_skills.json` | The nine standard skills |
| `backend/app/jobs.py` | Pipeline runner, the stage contract, and resuming jobs after a restart |
| `backend/app/stages/` | `classify`, `rubric`, `assess` (the one call behind `timeline` and `evaluate`), `timeline`, `evaluate`, `scoring`, `pose`, and `sight` (finds rubric text that depends on speech) |
| `backend/app/gemini.py` | Gemini wrapper: upload cache, structured output, retries, output cap, call log, per-key budget, per-job allowance and ceiling |
| `backend/app/media.py` | ffmpeg-based conversion, thumbnails and cutting (bundled binary, no system install) |
| `backend/app/routers/` | HTTP API |
| `backend/scripts/` | Starting both halves, the standard skills, logins, resetting the data, end-to-end runs, pose re-measurement, spend report |
| `reference_vids/` | Reference videos for nine skills |

## Limits worth knowing

- Video files live on the machine that uploaded them; only the database is shared. A reference video missing on your machine is rebuilt from `reference_vids/` on first use. Attempts recorded on another machine cannot be played; the screens say so and still show the results.
- Pose comes from a single camera. When two people overlap, the pose model can merge them into one skeleton, so per-person readings are unreliable for those moments and some tracks are left without a role. Pose flags are advisory unless Gemini confirms them on video.
- The nine standard rubrics were built from edited instructional videos. Their step times refer to those videos.
- The automatic check does not listen. Something a caregiver only says (asking how the patient feels, counting before a lift) is not graded; the nurse hears it when reviewing. The check for speech in rubric text is a word list, so an unusual phrasing can slip through, and it drops a whole criterion when part of it is about speech.
- Whether a conditional step was needed is the AI's reading of the recording. A critical step found not needed is flagged for the nurse, who can change any step's result.
- The attempts-left check when a recording is uploaded is not atomic: two uploads sent at the same instant could both be accepted.
- A job that is running when the server stops resumes at the next start, but only on the machine that has the video file.
- The logins are shared, fixed accounts. There is no sign-up, password change or invitation flow; adding a login means editing `backend/scripts/logins.py` and running `make logins`, and a forgotten password is replaced with `make logins ARGS="--reset <name>"`.
- Notifications appear in the app only. No emails are sent.
