export type AiAssessment = "passed" | "needs_review" | "safety_concern";
export type ReviewStatus = "pending" | "approved" | "retraining_requested";
export type StepStatus = "passed" | "needs_review" | "failed";
export type CaregiverStatus = "active" | "onboarding" | "restricted";

export type Caregiver = {
  id: string;
  name: string;
  initials: string;
  role: string;
  hireDate: string;
  skillsCompleted: number;
  skillsRequired: number;
  lastSubmissionAt: string;
  openFlags: number;
  status: CaregiverStatus;
  location: string;
};

export type Skill = {
  id: string;
  name: string;
  category: string;
};

export type DetectedStep = {
  id: string;
  label: string;
  timestamp: number;
  status: StepStatus;
  note: string;
};

export type SafetyIssue = {
  id: string;
  title: string;
  timestamp: number;
  severity: "critical" | "moderate";
  detail: string;
};

export type ChecklistItem = {
  id: string;
  label: string;
  status: StepStatus;
  evidence: string;
};

export type BalancePoint = {
  time: number;
  score: number;
};

export type MovementIndicator = {
  label: string;
  value: number;
  status: StepStatus;
  note: string;
};

export type Submission = {
  id: string;
  caregiverId: string;
  skillId: string;
  submittedAt: string;
  aiAssessment: AiAssessment;
  reviewStatus: ReviewStatus;
  durationSeconds: number;
  aiSummary: string;
  aiRecommendation: string;
  detectedSteps: DetectedStep[];
  safetyIssues: SafetyIssue[];
  checklist: ChecklistItem[];
  balance: BalancePoint[];
  movement: MovementIndicator[];
  reviewedBy?: string;
  reviewedAt?: string;
  notes?: string;
};

export type ActivityEvent = {
  id: string;
  type: "submission" | "safety" | "approval" | "first_assessment";
  message: string;
  detail: string;
  time: string;
  relativeLabel: string;
  href?: string;
};

export type AppNotification = {
  id: string;
  title: string;
  body: string;
  time: string;
  relativeLabel: string;
  unread: boolean;
  href?: string;
};

export type VerifiedRecord = {
  id: string;
  caregiverId: string;
  skillId: string;
  approvedAt: string;
  approvedBy: string;
  aiAssessment: AiAssessment;
  notes: string;
};

export type MissedStepStat = {
  label: string;
  count: number;
};

export type FlaggedSkillStat = {
  skillId: string;
  flags: number;
};
