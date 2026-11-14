import { Card, CardBody, CardHeader, CardTitle } from "@/nurse/components/ui/Card";
import { ProgressBar } from "@/nurse/components/ui/ProgressBar";
import { flaggedSkills, getSkill, missedSteps, VERIFICATION_COMPLETION_RATE } from "@/nurse/lib/mock-data";

export function SafetyOverview() {
  const maxMissed = Math.max(...missedSteps.map((item) => item.count));
  const maxFlags = Math.max(...flaggedSkills.map((item) => item.flags));

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Safety overview</CardTitle>
          <p className="mt-1 text-sm text-ink-secondary">
            Patterns from the last 30 days of AI-assisted reviews.
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-ink-muted">Verification completion</p>
          <p className="text-lg font-semibold text-navy">
            {Math.round(VERIFICATION_COMPLETION_RATE * 100)}%
          </p>
        </div>
      </CardHeader>
      <CardBody className="grid gap-8 lg:grid-cols-3">
        <div>
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-muted">
            Most frequently missed steps
          </p>
          <ul className="space-y-3">
            {missedSteps.map((item) => (
              <li key={item.label}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="text-ink">{item.label}</span>
                  <span className="text-ink-secondary">{item.count}</span>
                </div>
                <ProgressBar
                  value={(item.count / maxMissed) * 100}
                  barClassName="bg-warning"
                />
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-muted">
            Skills with the most safety flags
          </p>
          <ul className="space-y-3">
            {flaggedSkills.map((item) => (
              <li key={item.skillId}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="text-ink">{getSkill(item.skillId)?.name}</span>
                  <span className="text-danger">{item.flags}</span>
                </div>
                <ProgressBar
                  value={(item.flags / maxFlags) * 100}
                  barClassName="bg-danger"
                />
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-[12px] bg-teal-soft p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-teal">
            Overall verification
          </p>
          <p className="mt-3 text-3xl font-semibold text-navy">
            {Math.round(VERIFICATION_COMPLETION_RATE * 100)}%
          </p>
          <p className="mt-2 text-sm text-ink-secondary">
            Caregivers with all required skills nurse-approved. AI findings never auto-certify.
          </p>
          <div className="mt-4">
            <ProgressBar value={VERIFICATION_COMPLETION_RATE * 100} />
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
