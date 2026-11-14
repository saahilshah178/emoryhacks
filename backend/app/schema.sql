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
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slug, version)
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
