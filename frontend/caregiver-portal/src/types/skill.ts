export type SkillStatus =
  | "not_started"
  | "ready_to_record"
  | "in_review"
  | "verified";

export type StepResultStatus = "passed" | "needs_improvement";

export type SkillStep = {
  id: string;
  label: string;
  detail: string;
};

export type AssessmentStep = {
  id: string;
  label: string;
  status: StepResultStatus;
  timestamp?: string;
};

export type SkillAssessment = {
  summary: string;
  encouragement: string;
  steps: AssessmentStep[];
};

export type CoachingCue = {
  atSeconds: number;
  message: string;
};

export type Skill = {
  id: string;
  name: string;
  description: string;
  explanation: string;
  estimatedMinutes: number;
  safetyReminder: string;
  steps: SkillStep[];
  status: SkillStatus;
  referenceVideo?: string;
  coachingCues: CoachingCue[];
  assessment?: SkillAssessment;
};

export type CaregiverProfile = {
  firstName: string;
  lastName: string;
  role: string;
  agency: string;
  nextShift: string;
  avatarInitials: string;
};
