// The words and colours for every state the product shows. Both the nurse dashboard and the
// caregiver portal read from here, so one state never has two names.
import type { AiAssessment, ReviewState, SafetyFlag, SkillState, StepStatus, TrackRole } from "./types";

export type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "teal";

export const toneClass: Record<Tone, string> = {
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  danger: "bg-danger-bg text-danger",
  info: "bg-info-bg text-info",
  neutral: "bg-secondary text-ink-secondary",
  teal: "bg-teal-soft text-teal",
};

/** A solid colour for dots, bars and timeline segments. */
export const toneSolid: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-ink-secondary",
  teal: "bg-teal",
};

type Entry = { label: string; tone: Tone };

/**
 * How the AI (or the nurse) read one step, in the nurse's words. not_applicable: the step is
 * only needed in a situation that did not come up, so it is neither a pass nor a problem.
 */
export const stepStatus: Record<StepStatus, Entry> = {
  passed: { label: "Passed", tone: "success" },
  unverified: { label: "Needs review", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
  not_applicable: { label: "Not needed", tone: "neutral" },
};

/** The same results in the caregiver's words: encouraging, never a verdict. */
export const stepStatusForCaregiver: Record<StepStatus, Entry> = {
  passed: { label: "Looking strong", tone: "success" },
  unverified: { label: "Couldn't see clearly", tone: "warning" },
  failed: { label: "Needs improvement", tone: "danger" },
  not_applicable: { label: "Not needed this time", tone: "neutral" },
};

export const aiAssessment: Record<AiAssessment, Entry> = {
  passed: { label: "AI: Passed", tone: "success" },
  needs_review: { label: "AI: Needs review", tone: "warning" },
  not_passed: { label: "AI: Not passed", tone: "danger" },
  safety_concern: { label: "AI: Safety concern", tone: "danger" },
};

export const reviewState: Record<ReviewState, Entry> = {
  processing: { label: "Processing", tone: "info" },
  error: { label: "Processing failed", tone: "danger" },
  unsubmitted: { label: "Not sent yet", tone: "neutral" },
  pending: { label: "Awaiting nurse", tone: "warning" },
  superseded: { label: "Replaced by a newer one", tone: "neutral" },
  approved: { label: "Approved", tone: "success" },
  retraining: { label: "Retraining requested", tone: "danger" },
};

/** A caregiver's standing on a skill. */
export const skillState: Record<SkillState, Entry & { action: string }> = {
  not_started: { label: "Not started", tone: "neutral", action: "Start practice" },
  practicing: { label: "In progress", tone: "teal", action: "Continue practice" },
  in_review: { label: "In review", tone: "warning", action: "View results" },
  needs_practice: { label: "Practice again", tone: "info", action: "View feedback" },
  verified: { label: "Verified", tone: "success", action: "View results" },
};

export const caregiverStatus: Record<"onboarding" | "active" | "restricted", Entry> = {
  active: { label: "Active", tone: "success" },
  onboarding: { label: "Onboarding", tone: "info" },
  restricted: { label: "Restricted", tone: "danger" },
};

export const flagKind: Record<SafetyFlag["kind"], string> = {
  patient_distress: "Patient distress",
  patient_off_center: "Patient off-centre",
  patient_unsteady: "Patient unsteady",
  unsafe_caregiver_posture: "Unsafe handling",
  environment_hazard: "Hazard nearby",
  other: "Safety note",
};

export const flagSeverity: Record<SafetyFlag["severity"], Entry> = {
  high: { label: "Critical", tone: "danger" },
  medium: { label: "Moderate", tone: "warning" },
  low: { label: "Minor", tone: "neutral" },
};

/** The heading to show for a flag: its own title, or its kind. */
export function flagTitle(flag: Pick<SafetyFlag, "title" | "kind">) {
  return flag.title?.trim() || flagKind[flag.kind] || "Safety note";
}

export const personRole: Record<TrackRole, string> = {
  caregiver: "Caregiver",
  patient: "Patient",
  other: "Other person",
  unknown: "Unidentified",
};

/** Names of the pipeline stages, as shown while a video is processed. */
export const stageLabel: Record<string, string> = {
  gemini_upload: "Sending the video for analysis",
  classify: "Recognising the skill",
  rubric: "Writing the steps and criteria",
  timeline: "Finding each step in the recording",
  evaluate: "Checking each step",
  pose: "Measuring movement and balance",
  roles: "Telling caregiver and patient apart",
  confirm_flags: "Double-checking safety readings",
  score: "Working out the result",
};

export const categoryLabel: Record<string, string> = {
  transfer: "Transfer",
  mobility: "Mobility",
  positioning: "Positioning",
  hygiene: "Personal care",
  infection_control: "Infection control",
  emergency: "Safety",
  other: "Clinical",
};
