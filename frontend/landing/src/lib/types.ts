// Shapes returned by the API (backend/app). Times are seconds from the start of a video.
// Derived states (review_state, ai_assessment, skill state) are computed by the server in
// backend/app/progress.py; the UI never works them out for itself.

export type Role = "nurse" | "caregiver";
export type Status = "passed" | "failed" | "unverified";
export type ReviewState = "processing" | "error" | "pending" | "approved" | "retraining";
export type AiAssessment = "passed" | "needs_review" | "not_passed" | "safety_concern";
export type SkillState = "not_started" | "in_review" | "needs_practice" | "verified";

export type Prefs = { safety: boolean; submissions: boolean; digest: boolean };

export type User = {
  id: string;
  role: Role;
  name: string;
  email: string;
  title: string;
  credentials: string;
  location: string;
  hire_date: string | null;
  next_shift: string;
  employment: "onboarding" | "active";
  prefs: Prefs;
  created_at: string;
  org: { id: string; name: string; is_sample: boolean };
};

export type Person = { label: string; role: "caregiver" | "patient" | "other"; description: string };

export type Video = {
  id: string;
  kind: "reference" | "attempt";
  original_name: string;
  duration_s: number;
  width: number;
  height: number;
  fps: number;
  recorded_at: string;
  /** False when the file is not on this server (sample data, or recorded on another machine). */
  available: boolean;
};

export type StepEvals = {
  pass_criteria: string[];
  fail_criteria: string[];
  unverified_when: string[];
  visual_cues: string[];
};

export type SkillStep = {
  step_id: string;
  ord: number;
  title: string;
  description: string;
  /** Where the step happens in the reference video. start_s === end_s means it is not timed. */
  start_s: number;
  end_s: number;
  critical: boolean;
  order_dependent: boolean;
  must_follow: string[];
  evals: StepEvals;
};

export type SkillGuide = {
  description: string;
  explanation: string;
  safety_reminder: string;
  estimated_minutes: number;
  /** Prompts shown while recording. Present on a single skill, absent in lists. */
  cues?: Array<{ at_s: number; message: string }>;
};

export type SkillSummary = {
  id: string;
  slug: string;
  name: string;
  category: string;
  summary: string;
  version: number;
  order_matters: boolean;
  guide: SkillGuide;
  reference_video_id: string | null;
  created_at: string;
  updated_at: string;
  duration_s: number | null;
  step_count: number;
  attempt_count: number;
};

export type SkillVersion = {
  id: string;
  version: number;
  created_at: string;
  step_count: number;
  attempt_count: number;
};

export type Skill = Omit<SkillSummary, "duration_s" | "step_count" | "attempt_count"> & {
  safety_criteria: string[];
  people: Person[];
  notes: string;
  steps: SkillStep[];
  video: Video | null;
  /** The newest version of this skill. Differs from id when this is an older version. */
  latest_id: string;
  versions: SkillVersion[];
};

/** A caregiver's own view of a skill (GET /my/skills). */
export type MySkill = SkillSummary & {
  state: SkillState;
  /** The attempt whose result explains the state; null when not started. */
  attempt_id: string | null;
  latest_attempt_id: string | null;
  attempts: number;
};

export type MySkills = {
  skills: MySkill[];
  counts: Record<SkillState, number> & { total: number };
};

export type JobStage = { name: string; status: "pending" | "running" | "done" | "error"; seconds?: number; error?: string | null };

export type Job = {
  id: string;
  kind: "reference" | "attempt";
  status: "queued" | "running" | "done" | "error";
  stage: string;
  stages: JobStage[];
  error: string | null;
  video_id: string;
  skill_id: string | null;
  attempt_id: string | null;
};

export type AttemptSummary = {
  id: string;
  skill_id: string;
  video_id: string;
  caregiver_id: string | null;
  caregiver_name: string;
  caregiver_title: string | null;
  skill_name: string;
  skill_slug: string;
  skill_version: number;
  /** The AI's result. Null until grading finishes. */
  status: Status | null;
  score_pct: number | null;
  nurse_status: Status | null;
  nurse_note: string;
  reviewed_at: string | null;
  reviewer_name: string | null;
  reviewer_credentials: string | null;
  created_at: string;
  overall_feedback: string;
  duration_s: number;
  /** Safety flags that count toward the result. */
  flag_count: number;
  /** Those flags in brief, ordered by time (lists only; a single attempt has safety_flags). */
  flags?: Array<Pick<SafetyFlag, "id" | "kind" | "title" | "description" | "severity" | "start_s" | "end_s">>;
  job_status: Job["status"] | null;
  review_state: ReviewState;
  ai_assessment: AiAssessment | null;
  /** The nurse's decision when there is one, otherwise the AI's result. */
  final_status: Status | null;
};

export type AttemptStep = Omit<SkillStep, "start_s" | "end_s"> & {
  /** Where the step is in the reference video. */
  ref_start_s: number;
  ref_end_s: number;
  /** Where the step was found in this attempt. Null when it was not found. */
  found: boolean | null;
  start_s: number | null;
  end_s: number | null;
  /** 1-based order in which the caregiver actually did the step. */
  performed_index: number | null;
  timeline_note: string;
  status: Status | null;
  confidence: number | null;
  /** Written for the caregiver. */
  feedback: string;
  /** What was seen. */
  evidence: string;
  evidence_start_s: number | null;
  evidence_end_s: number | null;
  /** The stronger model looked at this step a second time. */
  double_checked: boolean;
  nurse_status: Status | null;
  nurse_note: string;
};

export type OrderViolation = { step_id: string; expected_after: string; message: string; at_s: number | null };

export type SafetyFlag = {
  id: string;
  kind:
    | "patient_distress"
    | "patient_off_center"
    | "patient_unsteady"
    | "unsafe_caregiver_posture"
    | "environment_hazard"
    | "other";
  severity: "low" | "medium" | "high";
  start_s: number;
  end_s: number | null;
  person_label: string | null;
  /** A short heading. Null for flags raised by the pipeline; fall back to the kind's label. */
  title: string | null;
  description: string;
  /** "pose" flags are body-tracking readings nobody confirmed on video. */
  source: "gemini" | "pose" | "pose_confirmed";
  counts_toward_score: boolean;
};

export type MovementNote = { label: string; value: number; status: Status; note: string };

export type Attempt = AttemptSummary & {
  reasons: string[];
  people: Person[];
  /** False when the recording does not show the skill it was submitted for. */
  skill_match: boolean | null;
  skill_match_note: string;
  order_matters: boolean;
  reference_video_id: string | null;
  steps: AttemptStep[];
  order_violations: OrderViolation[];
  safety_flags: SafetyFlag[];
  video: Video;
  reference_video: Video | null;
  job: Pick<Job, "id" | "status" | "stage" | "stages" | "error"> | null;
  extras: { movement?: MovementNote[] };
};

export type CaregiverRow = {
  id: string;
  name: string;
  email: string;
  title: string;
  location: string;
  hire_date: string | null;
  employment: "onboarding" | "active";
  /** "restricted" while an attempt with a safety concern is waiting for a nurse. */
  status: "onboarding" | "active" | "restricted";
  next_shift: string;
  skills_total: number;
  skills_verified: number;
  skills_in_review: number;
  open_flags: number;
  last_submission_at: string | null;
  pending_attempt_id: string | null;
  attempt_count: number;
};

export type CaregiverDetail = CaregiverRow & {
  skills: Array<{
    skill_id: string;
    slug: string;
    name: string;
    category: string;
    state: SkillState;
    attempt_id: string | null;
    latest_attempt_id: string | null;
    attempts: number;
  }>;
  attempts: AttemptSummary[];
};

export type ActivityEvent = {
  id: string;
  type: "submission" | "safety" | "approval" | "retraining" | "first_assessment";
  message: string;
  detail: string;
  time: string;
  attempt_id: string;
  caregiver_id: string | null;
};

export type AppNotification = {
  id: string;
  kind: "safety" | "submission" | "digest";
  title: string;
  body: string;
  time: string;
  unread: boolean;
  attempt_id: string | null;
};

export type Overview = {
  agency: string;
  counts: {
    caregivers: number;
    skills: number;
    pending: number;
    verified: number;
    /** Pending attempts that carry a safety flag. */
    safety_flags: number;
    processing: number;
  };
  /** Share of all caregiver-skill pairs a nurse has approved. Null with no caregivers or skills. */
  verification_rate: number | null;
  pattern_days: number;
  missed_steps: Array<{ label: string; skill_name: string; count: number }>;
  flagged_skills: Array<{ skill_id: string | null; slug: string; name: string; flags: number }>;
  activity: ActivityEvent[];
  notifications: AppNotification[];
  unread: number;
};

export type Health = {
  ok: boolean;
  database: { source: string; tiger_cloud: boolean; timescaledb: string; skills: number; attempts: number; pose_frames: number };
  gemini: {
    key_set: boolean;
    model_main: string;
    model_strong: string;
    fake_ai: boolean;
    spent_usd: number;
    budget_usd: number;
    /** Set when the most recent video failed because of the AI account (out of credit, over budget, key rejected). */
    problem: string | null;
  };
};

// --- movement data (pose time series in Tiger Data) ---------------------------------------

export type TrackRole = "caregiver" | "patient" | "other" | "unknown";

/** One bucket of one person's readings. Angles in degrees; balance 0..1 (1 = centred). */
export type PoseBucket = {
  person_idx: number;
  role: TrackRole;
  t_offset: number;
  n_valid: number | null;
  trunk_tilt_avg: number | null;
  trunk_tilt_max: number | null;
  l_knee: number | null;
  r_knee: number | null;
  l_hip: number | null;
  r_hip: number | null;
  l_elbow: number | null;
  r_elbow: number | null;
  l_shoulder: number | null;
  r_shoulder: number | null;
  balance_avg: number | null;
  balance_min: number | null;
  com_offset_max: number | null;
  sway_avg: number | null;
  sway_max: number | null;
};

export type PoseSeries = {
  video_id: string;
  bucket_s: number;
  duration_s: number;
  source: "pose_1s" | "pose_frames";
  rows: PoseBucket[];
};

export type PoseFrames = {
  video_id: string;
  points: number;
  series: Array<{ metric: string; person_idx: number; role: TrackRole; t: number[]; v: Array<number | null> }>;
};

export type PoseTrack = {
  person_idx: number;
  segment_id: number;
  role: TrackRole;
  first_t: number;
  last_t: number;
  n_frames: number;
  mean_visibility: number | null;
  valid_share: number | null;
  /** Balance figures are null unless the person was seen standing for long enough. */
  balance_avg: number | null;
  balance_min: number | null;
  off_center_share: number | null;
  standing_s: number | null;
  tilt_avg: number | null;
  tilt_sd: number | null;
  tilt_p95: number | null;
  bent_share: number | null;
  knee_min: number | null;
  sway_avg: number | null;
};

export type PoseSummary = {
  video: Pick<Video, "id" | "kind" | "original_name" | "duration_s" | "width" | "height" | "recorded_at">;
  attempt: { id: string; caregiver_name: string; status: Status | null; score_pct: number | null; skill_name: string; skill_slug: string } | null;
  skill: { skill_name: string; skill_slug: string } | null;
  segments: number;
  sampling: { sample_fps: number | null; video_fps: number | null; every_frame: boolean };
  tracks: PoseTrack[];
  flags: SafetyFlag[];
  thresholds: {
    off_center_offset: number;
    balance_low: number;
    tilt_caution: number;
    tilt_bent: number;
    flag_tilt: number;
    lying_tilt: number;
    flag_min_seconds: number;
    min_standing_s: number;
  };
};

/** One row per video that has movement data (GET /safety/overview). */
export type PoseOverviewRow = {
  video_id: string;
  kind: "reference" | "attempt";
  original_name: string;
  duration_s: number;
  recorded_at: string;
  video_fps: number | null;
  sample_fps: number | null;
  every_frame: boolean;
  attempt_id: string | null;
  caregiver_name: string | null;
  attempt_status: Status | null;
  score_pct: number | null;
  skill_match: boolean | null;
  skill_name: string | null;
  skill_slug: string | null;
  seconds_tracked: number | null;
  tracks: number | null;
  person_frames: number | null;
  trunk_tilt_max: number | null;
  patient_tracked_s: number | null;
  patient_standing_s: number | null;
  patient_off_center_s: number | null;
  patient_off_center_share: number | null;
  patient_balance_min: number | null;
  patient_balance_avg: number | null;
  caregiver_tracked_s: number | null;
  caregiver_bent_share: number | null;
  caregiver_tilt_avg: number | null;
  caregiver_tilt_peak: number | null;
  role_share: number | null;
  flag_count: number;
  scored_flag_count: number;
  high_flag_count: number;
};

export type PoseTrends = {
  bucket: string;
  attempts: Array<{
    attempt_id: string;
    recorded_at: string;
    caregiver_name: string | null;
    status: Status | null;
    score_pct: number | null;
    skill_slug: string;
    skill_name: string;
    patient_balance_avg: number | null;
    patient_balance_min: number | null;
    patient_off_center_share: number | null;
    patient_standing_s: number | null;
    caregiver_tilt_avg: number | null;
    caregiver_tilt_peak: number | null;
    caregiver_bent_share: number | null;
  }>;
  buckets: Array<{
    bucket: string;
    skill_slug: string;
    skill_name: string;
    attempts: number;
    patient_attempts: number;
    patient_standing_s: number;
    patient_balance_avg: number | null;
    patient_balance_min: number | null;
    patient_off_center_share: number | null;
    caregiver_tilt_avg: number | null;
    caregiver_tilt_peak: number | null;
    caregiver_bent_share: number | null;
  }>;
};

/** rows counts this agency's readings; the hypertable, chunk and size figures are for the whole table. */
export type PoseStorage = {
  database: { name?: string; timescaledb?: string; toolkit?: string | null; error?: string };
  rows: { pose_frames?: number; videos?: number; first_ts?: string | null; last_ts?: string | null; error?: string };
  hypertable: { hypertable_name?: string; num_chunks?: number; columnstore_enabled?: boolean; error?: string } | null;
  size: { table_bytes?: number; index_bytes?: number; toast_bytes?: number; total_bytes?: number; total?: string; error?: string } | null;
  columnstore: { segmentby?: string; orderby?: string; error?: string } | null;
  chunks: Array<{ chunk_name?: string; range_start?: string; range_end?: string; in_columnstore?: boolean; error?: string }>;
  rollup: { view_name?: string; materialized_only?: boolean; rows?: number; watermark?: string | null; error?: string } | null;
  jobs: Array<{
    job_id?: number;
    application_name?: string;
    schedule_interval?: number | string | null;
    last_run_status?: string | null;
    last_successful_finish?: string | null;
    next_start?: string | null;
    total_runs?: number;
    error?: string;
  }>;
};
