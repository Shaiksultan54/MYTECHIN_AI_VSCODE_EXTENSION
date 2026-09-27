import { useState, type JSX } from 'react';
import type { PlanView } from '../../../../src/shared/types.js';
import { post } from '../../vscode.js';

export function PlanCard({ plan }: { plan: PlanView }): JSX.Element {
  const [text, setText] = useState(plan.text);
  return (
    <section className="plan-card" role="dialog" aria-label="Review execution plan">
      <h3>Review execution plan</h3>
      <textarea value={text} onChange={(event) => setText(event.target.value)} rows={7} />
      <div className="approval-actions">
        <button type="button" className="button-secondary" onClick={() => post({ type: 'planDecision', planId: plan.planId, decision: 'cancel' })}>
          Cancel
        </button>
        <span className="spacer" />
        <button type="button" className="button-primary" onClick={() => post({ type: 'planDecision', planId: plan.planId, decision: 'edit', text })}>
          Save &amp; run
        </button>
        <button type="button" className="button-primary" onClick={() => post({ type: 'planDecision', planId: plan.planId, decision: 'approve' })}>
          Approve
        </button>
      </div>
    </section>
  );
}
