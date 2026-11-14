-- FirstShift schema for Tiger Data (TimescaleDB).
-- Idempotent. Statements are separated by a marker line (two dashes, a space, two
-- at-signs) and are run one at a time in autocommit mode by app.db.migrate().

CREATE EXTENSION IF NOT EXISTS timescaledb;
-- @@
CREATE TABLE IF NOT EXISTS videos (
  id                   uuid PRIMARY KEY,
  kind                 text NOT NULL CHECK (kind IN ('reference', 'attempt')),
  original_name        text NOT NULL DEFAULT '',
  path                 text NOT NULL,
  mime                 text NOT NULL DEFAULT 'video/mp4',
  duration_s           real NOT NULL DEFAULT 0,
  width                integer NOT NULL DEFAULT 0,
  height               integer NOT NULL DEFAULT 0,
  fps                  real NOT NULL DEFAULT 0,
  recorded_at          timestamptz NOT NULL DEFAULT now(),
  gemini_file_name     text,
  gemini_file_uri      text,
  gemini_file_expires  timestamptz
);
-- @@
CREATE TABLE IF NOT EXISTS skills (
  id                  uuid PRIMARY KEY,
  slug                text NOT NULL,
  name                text NOT NULL,
  category            text NOT NULL DEFAULT 'other',
  summary             text NOT NULL DEFAULT '',
  version             integer NOT NULL DEFAULT 1,
  order_matters       boolean NOT NULL DEFAULT true,
  safety_criteria     jsonb NOT NULL DEFAULT '[]',
  people              jsonb NOT NULL DEFAULT '[]',
  classification      jsonb NOT NULL DEFAULT '{}',
  notes               text NOT NULL DEFAULT '',
  reference_video_id  uuid REFERENCES videos(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
-- @@
CREATE TABLE IF NOT EXISTS skill_steps (
  id               uuid PRIMARY KEY,
  skill_id         uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  step_id          text NOT NULL,
  ord              integer NOT NULL,
  title            text NOT NULL,
  description      text NOT NULL DEFAULT '',
  start_s          real NOT NULL DEFAULT 0,
  end_s            real NOT NULL DEFAULT 0,
  critical         boolean NOT NULL DEFAULT false,
  order_dependent  boolean NOT NULL DEFAULT true,
  must_follow      jsonb NOT NULL DEFAULT '[]',
  evals            jsonb NOT NULL DEFAULT '{}',
  UNIQUE (skill_id, step_id)
);
-- @@
CREATE TABLE IF NOT EXISTS attempts (
  id                uuid PRIMARY KEY,
  skill_id          uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  video_id          uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  caregiver_name    text NOT NULL DEFAULT '',
  status            text CHECK (status IN ('passed', 'failed', 'unverified')),
  score_pct         real,
  reasons           jsonb NOT NULL DEFAULT '[]',
  needs_review      boolean NOT NULL DEFAULT false,
  people            jsonb NOT NULL DEFAULT '[]',
  overall_feedback  text NOT NULL DEFAULT '',
  skill_match       boolean,
  skill_match_note  text NOT NULL DEFAULT '',
  nurse_status      text CHECK (nurse_status IN ('passed', 'failed', 'unverified')),
  nurse_note        text NOT NULL DEFAULT '',
  reviewed_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
-- @@
-- One row per rubric step per attempt.
-- Column ownership: the timeline stage writes found/start_s/end_s/performed_index/
-- timeline_confidence/timeline_note; the evaluate stage writes status/confidence/
-- feedback/evidence*/double_checked; the nurse review writes nurse_*.
CREATE TABLE IF NOT EXISTS attempt_steps (
  id                   uuid PRIMARY KEY,
  attempt_id           uuid NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  step_id              text NOT NULL,
  found                boolean,
  start_s              real,
  end_s                real,
  performed_index      integer,
  timeline_confidence  real,
  timeline_note        text NOT NULL DEFAULT '',
  status               text CHECK (status IN ('passed', 'failed', 'unverified')),
  confidence           real,
  feedback             text NOT NULL DEFAULT '',
  evidence             text NOT NULL DEFAULT '',
  evidence_start_s     real,
  evidence_end_s       real,
  double_checked       boolean NOT NULL DEFAULT false,
  nurse_status         text CHECK (nurse_status IN ('passed', 'failed', 'unverified')),
  nurse_note           text NOT NULL DEFAULT '',
  UNIQUE (attempt_id, step_id)
);
-- @@
CREATE TABLE IF NOT EXISTS order_violations (
  id              uuid PRIMARY KEY,
  attempt_id      uuid NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  step_id         text NOT NULL,
  expected_after  text NOT NULL,
  message         text NOT NULL DEFAULT '',
  at_s            real
);
-- @@
CREATE TABLE IF NOT EXISTS safety_flags (
  id                   uuid PRIMARY KEY,
  video_id             uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  attempt_id           uuid REFERENCES attempts(id) ON DELETE CASCADE,
  kind                 text NOT NULL,
  severity             text NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  start_s              real NOT NULL DEFAULT 0,
  end_s                real,
  person_label         text,
  description          text NOT NULL DEFAULT '',
  source               text NOT NULL CHECK (source IN ('gemini', 'pose', 'pose_confirmed')),
  counts_toward_score  boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now()
);
-- @@
CREATE TABLE IF NOT EXISTS jobs (
  id          uuid PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('reference', 'attempt')),
  video_id    uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  skill_id    uuid REFERENCES skills(id) ON DELETE SET NULL,
  attempt_id  uuid REFERENCES attempts(id) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'error')),
  stage       text NOT NULL DEFAULT '',
  stages      jsonb NOT NULL DEFAULT '[]',
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- @@
-- Every Gemini request and its raw response, for prompt debugging and spend tracking.
CREATE TABLE IF NOT EXISTS gemini_calls (
  id              uuid PRIMARY KEY,
  job_id          uuid,
  video_id        uuid,
  purpose         text NOT NULL,
  model           text NOT NULL,
  request         jsonb NOT NULL DEFAULT '{}',
  response_text   text,
  input_tokens    integer NOT NULL DEFAULT 0,
  output_tokens   integer NOT NULL DEFAULT 0,
  thought_tokens  integer NOT NULL DEFAULT 0,
  cost_usd        real NOT NULL DEFAULT 0,
  latency_ms      integer NOT NULL DEFAULT 0,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- @@
-- First 8 hex digits of the SHA-256 of the API key that made the call (never the key), so
-- GEMINI_BUDGET_USD applies to the key in use. NULL: logged before this existed (an older key).
ALTER TABLE gemini_calls ADD COLUMN IF NOT EXISTS key_id text;
-- @@
CREATE INDEX IF NOT EXISTS gemini_calls_key_idx ON gemini_calls (key_id);
-- @@
-- A job's own spend, and the replies a resumed job reuses instead of paying for them again.
CREATE INDEX IF NOT EXISTS gemini_calls_job_idx ON gemini_calls (job_id, purpose);
-- @@
-- Which key uploaded the cached Gemini file: a file uploaded with another key is not visible.
ALTER TABLE videos ADD COLUMN IF NOT EXISTS gemini_file_key text;
-- @@
-- How many times a job was resumed after a server restart, and what a resumed job needs that
-- is not stored elsewhere (the pose summary, a reference job's classification and rubric).
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS resumes integer NOT NULL DEFAULT 0;
-- @@
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS checkpoint jsonb NOT NULL DEFAULT '{}';
-- @@
-- One row per tracked person per video. person_idx is unique within a video
-- (a new track after a camera cut gets a new person_idx).
CREATE TABLE IF NOT EXISTS pose_tracks (
  video_id         uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  person_idx       smallint NOT NULL,
  segment_id       smallint NOT NULL DEFAULT 0,
  role             text NOT NULL DEFAULT 'unknown' CHECK (role IN ('caregiver', 'patient', 'other', 'unknown')),
  first_t          real NOT NULL DEFAULT 0,
  last_t           real NOT NULL DEFAULT 0,
  n_frames         integer NOT NULL DEFAULT 0,
  mean_visibility  real,
  PRIMARY KEY (video_id, person_idx)
);
-- @@
-- Time series: one row per sampled frame per tracked person.
-- ts = videos.recorded_at + t_offset seconds, and is the only timestamptz column.
-- Angles are in degrees. com_* and bos_* are in normalised image coordinates (0..1).
-- com_offset = (com_x - bos_center_x) / (bos_width / 2): |value| < 1 means the centre
-- of mass is over the base of support. balance_score = 1 - min(1, |com_offset|).
CREATE TABLE IF NOT EXISTS pose_frames (
  ts             timestamptz NOT NULL,
  video_id       uuid NOT NULL,
  person_idx     smallint NOT NULL,
  t_offset       real NOT NULL,
  segment_id     smallint NOT NULL DEFAULT 0,
  valid          boolean NOT NULL DEFAULT true,
  visibility     real,
  bbox_x0        real,
  bbox_y0        real,
  bbox_x1        real,
  bbox_y1        real,
  l_elbow        real,
  r_elbow        real,
  l_shoulder     real,
  r_shoulder     real,
  l_hip          real,
  r_hip          real,
  l_knee         real,
  r_knee         real,
  l_ankle        real,
  r_ankle        real,
  trunk_tilt     real,
  trunk_lateral  real,
  com_x          real,
  com_y          real,
  bos_center_x   real,
  bos_width      real,
  com_offset     real,
  sway_velocity  real,
  balance_score  real
) WITH (
  tsdb.hypertable,
  tsdb.partition_column = 'ts',
  tsdb.chunk_interval = '1 day',
  tsdb.segmentby = 'video_id',
  tsdb.orderby = 'ts DESC'
);
-- @@
CREATE INDEX IF NOT EXISTS pose_frames_video_idx ON pose_frames (video_id, person_idx, ts DESC);
-- @@
-- One-second rollup that the safety dashboard reads. Real-time aggregation is on,
-- so rows that are not materialised yet are still returned.
CREATE MATERIALIZED VIEW IF NOT EXISTS pose_1s
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  time_bucket(INTERVAL '1 second', ts)              AS bucket,
  video_id,
  person_idx,
  min(t_offset)                                     AS t_offset,
  count(*)                                          AS n_frames,
  count(*) FILTER (WHERE valid)                     AS n_valid,
  avg(trunk_tilt) FILTER (WHERE valid)              AS trunk_tilt_avg,
  max(trunk_tilt) FILTER (WHERE valid)              AS trunk_tilt_max,
  avg(l_elbow) FILTER (WHERE valid)                 AS l_elbow,
  avg(r_elbow) FILTER (WHERE valid)                 AS r_elbow,
  avg(l_shoulder) FILTER (WHERE valid)              AS l_shoulder,
  avg(r_shoulder) FILTER (WHERE valid)              AS r_shoulder,
  avg(l_hip) FILTER (WHERE valid)                   AS l_hip,
  avg(r_hip) FILTER (WHERE valid)                   AS r_hip,
  avg(l_knee) FILTER (WHERE valid)                  AS l_knee,
  avg(r_knee) FILTER (WHERE valid)                  AS r_knee,
  avg(balance_score) FILTER (WHERE valid)           AS balance_avg,
  min(balance_score) FILTER (WHERE valid)           AS balance_min,
  max(abs(com_offset)) FILTER (WHERE valid)         AS com_offset_max,
  avg(sway_velocity) FILTER (WHERE valid)           AS sway_avg,
  max(sway_velocity) FILTER (WHERE valid)           AS sway_max
FROM pose_frames
GROUP BY bucket, video_id, person_idx
WITH NO DATA;
-- @@
SELECT add_continuous_aggregate_policy('pose_1s',
  start_offset => INTERVAL '7 days',
  end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '5 minutes',
  if_not_exists => true);
-- @@
-- Which process is running a job ("host:pid"), so a restarted server only marks its own
-- dead jobs as interrupted and leaves jobs that a script is still running.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS runner text;
-- @@
-- Accounts. An org is an agency: its nurses and caregivers share one set of skills and
-- attempts. Everyone who signs up joins the default agency. The sample agency holds
-- showcase data (see scripts/seed_sample.py) and is only reached by its own accounts.
CREATE TABLE IF NOT EXISTS orgs (
  id          uuid PRIMARY KEY,
  name        text NOT NULL,
  is_sample   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- @@
INSERT INTO orgs (id, name) VALUES ('00000000-0000-0000-0000-000000000001', 'My agency')
ON CONFLICT (id) DO NOTHING;
-- @@
-- password_hash NULL means the person is on the roster but cannot log in.
CREATE TABLE IF NOT EXISTS users (
  id                     uuid PRIMARY KEY,
  org_id                 uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  role                   text NOT NULL CHECK (role IN ('nurse', 'caregiver')),
  name                   text NOT NULL,
  email                  text NOT NULL UNIQUE,
  password_hash          text,
  title                  text NOT NULL DEFAULT '',
  credentials            text NOT NULL DEFAULT '',
  location               text NOT NULL DEFAULT '',
  hire_date              date,
  next_shift             text NOT NULL DEFAULT '',
  employment             text NOT NULL DEFAULT 'onboarding' CHECK (employment IN ('onboarding', 'active')),
  prefs                  jsonb NOT NULL DEFAULT '{}',
  notifications_seen_at  timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);
-- @@
-- Only a hash of the session token is stored; the token itself lives in the browser cookie.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
-- @@
-- Ownership. A skill belongs to the org of its reference video; an attempt to the org of its skill.
ALTER TABLE videos ADD COLUMN IF NOT EXISTS org_id uuid NOT NULL
  DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id) ON DELETE CASCADE;
-- @@
ALTER TABLE videos ADD COLUMN IF NOT EXISTS uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL;
-- @@
ALTER TABLE skills ADD COLUMN IF NOT EXISTS org_id uuid NOT NULL
  DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES orgs(id) ON DELETE CASCADE;
-- @@
-- Caregiver-facing copy a nurse may set: description, explanation, safety_reminder,
-- estimated_minutes, cues [{at_s, message}]. Anything missing is derived from the rubric.
ALTER TABLE skills ADD COLUMN IF NOT EXISTS guide jsonb NOT NULL DEFAULT '{}';
-- @@
-- Versions are numbered per agency, so two agencies can each have a "sit_to_stand".
ALTER TABLE skills DROP CONSTRAINT IF EXISTS skills_slug_version_key;
-- @@
CREATE UNIQUE INDEX IF NOT EXISTS skills_org_slug_version_idx ON skills (org_id, slug, version);
-- @@
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS caregiver_id uuid REFERENCES users(id) ON DELETE SET NULL;
-- @@
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL;
-- @@
-- Optional extra notes shown with an attempt, e.g. {"movement": [{label, value, status, note}]}.
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS extras jsonb NOT NULL DEFAULT '{}';
-- @@
CREATE INDEX IF NOT EXISTS attempts_caregiver_idx ON attempts (caregiver_id, created_at DESC);
-- @@
-- A short heading for a flag. The pipeline leaves it NULL and the UI falls back to the kind.
ALTER TABLE safety_flags ADD COLUMN IF NOT EXISTS title text;
-- @@
-- The name a person signs in with; NULL means they cannot log in. The logins are a fixed set
-- made by scripts/logins.py: nobody signs up or changes a password in the app.
ALTER TABLE users ADD COLUMN IF NOT EXISTS username text;
-- @@
CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON users (lower(username));
-- @@
-- What a nurse decides per skill, keyed by slug so it carries over to new versions of the
-- skill. No row means the defaults: unlimited attempts, send at 80%, send anyway with a note
-- from 50%, assigned to every caregiver of the agency.
CREATE TABLE IF NOT EXISTS skill_policies (
  org_id        uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  slug          text NOT NULL,
  max_attempts  integer CHECK (max_attempts IS NULL OR max_attempts BETWEEN 1 AND 50),  -- NULL = unlimited
  submit_pct    real NOT NULL DEFAULT 80,
  force_pct     real NOT NULL DEFAULT 50,
  assign_all    boolean NOT NULL DEFAULT true,
  updated_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, slug),
  CHECK (0 <= force_pct AND force_pct <= submit_pct AND submit_pct <= 100)
);
-- @@
-- One caregiver's assignment to a skill (read only when the policy's assign_all is false) and
-- their own attempt limit: 'inherit' takes the policy's, 'limited' uses max_attempts here.
CREATE TABLE IF NOT EXISTS skill_assignments (
  org_id        uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  slug          text NOT NULL,
  caregiver_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned      boolean NOT NULL DEFAULT true,
  limit_mode    text NOT NULL DEFAULT 'inherit' CHECK (limit_mode IN ('inherit', 'limited', 'unlimited')),
  max_attempts  integer,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, slug, caregiver_id)
);
-- @@
-- When an attempt was sent to a nurse, and how. A caregiver's recording is stored with these
-- NULL and stays with them until they send it (repo.create_attempt); anything else, such as an
-- upload by a nurse or a row a script inserts, counts as sent when it is created.
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS submitted_at timestamptz DEFAULT now();
-- @@
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS submit_kind text DEFAULT 'standard'
  CHECK (submit_kind IN ('standard', 'forced'));
-- @@
-- The caregiver's reason for sending a recording the automatic check scored under the bar.
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS submit_note text NOT NULL DEFAULT '';
-- @@
-- NULL for an ordinary login. 'upload' marks a short-lived ticket that may only send videos
-- (auth.create_upload_ticket), used when the browser uploads straight to the API's address.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS scope text;
-- @@
-- How many attempts this caregiver gets on each skill, unless a nurse set a different number
-- on one skill (skill_assignments.limit_mode). NULL means each skill's own limit.
ALTER TABLE users ADD COLUMN IF NOT EXISTS skill_attempt_limit integer
  CHECK (skill_attempt_limit IS NULL OR skill_attempt_limit BETWEEN 1 AND 50);
