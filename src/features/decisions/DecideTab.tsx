import { useMemo, useState } from 'react';
import { Badge, Button, Card, ConfirmButton, Field, Input, Notice, NumberInput, Select, Textarea, cx } from '@/ui/components';
import type { Decision, DecisionSnapshot } from '@/domain/types';
import { recordChoice, reopenDecision } from '@/data/decisions';
import { scoreOptions } from '@/engine/scoring';
import { compareVariants, optionToVariant, totalOptionCost, validateAssumptions } from '@/engine/projection';
import type { FlexibilityEstimate } from '@/engine/flexibility';
import { addDays, formatDate, formatMonth } from '@/domain/dates';
import { formatMoney, formatPercent } from '@/domain/money';
import { useToast } from '@/ui/toast';
import { STATUS_LABEL } from './labels';

export function DecideTab({ decision: d, onChange, onReplace, errors, flex }: {
  decision: Decision;
  onChange: (d: Decision) => void;
  onReplace: (d: Decision) => void;
  errors: string[];
  flex?: FlexibilityEstimate;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const scoring = useMemo(() => scoreOptions(d.options, d.criteria, d.scores), [d.options, d.criteria, d.scores]);
  const assumptionErrors = validateAssumptions(d.assumptions);
  const comparison = useMemo(() => (assumptionErrors.length ? [] : compareVariants(d.assumptions, d.options.map(optionToVariant))), [d.assumptions, d.options, assumptionErrors.length]);
  const set = (patch: Partial<Decision>) => onChange({ ...d, ...patch });

  if (d.snapshot) {
    return (
      <div className="grid gap-5">
        <SnapshotView snapshot={d.snapshot} decision={d} title="Your recorded choice" />
        <Card title="Status and follow-up">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Status" htmlFor="dec-status">
              <Select
                id="dec-status"
                value={d.status}
                disabled={d.status === 'reviewed'}
                onChange={(e) => set({ status: e.target.value as Decision['status'] })}
              >
                <option value="decided">{STATUS_LABEL.decided}</option>
                <option value="completed">{STATUS_LABEL.completed} (acted on it)</option>
                {d.status === 'reviewed' && <option value="reviewed">{STATUS_LABEL.reviewed}</option>}
              </Select>
            </Field>
            <Field label="Review date" htmlFor="dec-review-date">
              <Input id="dec-review-date" type="date" value={d.reviewDate ?? ''} onChange={(e) => set({ reviewDate: e.target.value || null })} />
            </Field>
            {!d.review && (
              <div className="flex items-end">
                <ConfirmButton
                  variant="primary"
                  title="Reopen this decision?"
                  confirmText="The current recorded choice is kept in the decision's history, and you can choose again."
                  onConfirm={async () => onReplace(await reopenDecision(d))}
                >
                  Reopen and change choice
                </ConfirmButton>
              </div>
            )}
          </div>
        </Card>
        {(d.snapshotHistory ?? []).length > 0 && (
          <Card title="Earlier recorded choices">
            <ul className="grid gap-1 text-sm">
              {d.snapshotHistory!.map((s) => (
                <li key={s.capturedAt}>
                  {new Date(s.capturedAt).toLocaleDateString('en-NZ')}: chose “{s.options.find((o) => o.id === s.selectedOptionId)?.name}” — {s.reasoning || 'no reasoning recorded'}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    );
  }

  const selected = d.options.find((o) => o.id === d.selectedOptionId);
  return (
    <div className="grid gap-5">
      <Card title="Choose an alternative" description="Your preference score and the financial projection are shown side by side. Neither decides for you.">
        <div role="radiogroup" aria-label="Chosen alternative" className="grid gap-2">
          {d.options.map((o) => {
            const r = scoring.results.find((x) => x.optionId === o.id);
            const c = comparison.find((x) => x.variantId === o.id);
            const checked = d.selectedOptionId === o.id;
            return (
              <label
                key={o.id}
                className={cx('flex cursor-pointer flex-wrap items-center gap-3 rounded-lg border p-3 text-sm', checked ? 'border-accent bg-accent-soft' : 'border-border')}
              >
                <input type="radio" name="chosen" checked={checked} onChange={() => set({ selectedOptionId: o.id })} className="accent-[var(--accent)]" />
                <span className="font-semibold">{o.name}</span>
                {r && d.criteria.length > 0 && <Badge>Preference {r.score.toFixed(0)}/100 · #{r.rank}</Badge>}
                <span className="ml-auto text-ink-2 tabular">
                  Cost {formatMoney(totalOptionCost(o, d.assumptions.horizonMonths), { whole: true })}
                  {c && c.vsBestReal !== 0 && ` · ${formatMoney(c.vsBestReal, { whole: true })} vs best at horizon (today’s $)`}
                </span>
              </label>
            );
          })}
        </div>
      </Card>

      <Card title="Record your reasoning and predictions" description="These are frozen when you record the choice, so you can compare them with reality later.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Why this choice?" htmlFor="dec-reason" className="sm:col-span-3">
            <Textarea id="dec-reason" value={d.reasoning} onChange={(e) => set({ reasoning: e.target.value })} placeholder="What tipped it? What are you assuming?" />
          </Field>
          <Field label="Predicted satisfaction (1–10)" htmlFor="dec-sat">
            <NumberInput id="dec-sat" min={1} max={10} value={d.predictedSatisfaction} onChange={(v) => set({ predictedSatisfaction: v === null ? null : Math.round(v) })} />
          </Field>
          <Field label="Confidence (1–5)" htmlFor="dec-conf" hint="How sure are you this is right?">
            <NumberInput id="dec-conf" min={1} max={5} value={d.confidence} onChange={(v) => set({ confidence: v === null ? null : Math.round(v) })} />
          </Field>
          <Field label="Review on" htmlFor="dec-rev">
            <Input id="dec-rev" type="date" value={d.reviewDate ?? ''} onChange={(e) => set({ reviewDate: e.target.value || null })} />
          </Field>
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {[1, 3, 6, 12].map((m) => (
            <Button key={m} size="sm" variant="ghost" onClick={() => set({ reviewDate: addDays(d.date, Math.round(m * 30.44)) })}>
              Review in {m} month{m > 1 ? 's' : ''}
            </Button>
          ))}
        </div>
      </Card>

      {errors.length > 0 && <Notice tone="warn">{errors.join(' ')}</Notice>}
      {assumptionErrors.length > 0 && <Notice tone="bad">Fix the financial assumptions first: {assumptionErrors.join(' ')}</Notice>}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {selected && flex?.availableNow !== null && flex?.availableNow !== undefined && selected.upfrontCost > flex.availableNow && (
          <span className="text-sm text-warn">⚠ The upfront cost exceeds your estimated available funds.</span>
        )}
        <Button
          variant="primary"
          disabled={!selected || errors.length > 0 || assumptionErrors.length > 0 || busy}
          onClick={async () => {
            if (!selected) return;
            setBusy(true);
            try {
              onReplace(await recordChoice(d, selected.id, flex?.availableNow ?? null));
              toast({ message: 'Choice recorded. A snapshot of your reasoning and assumptions has been saved.', tone: 'good' });
            } catch (e) {
              toast({ message: e instanceof Error ? e.message : 'Could not record the choice.', tone: 'bad' });
            } finally {
              setBusy(false);
            }
          }}
        >
          {selected ? `Record choice: ${selected.name}` : 'Select an alternative'}
        </Button>
      </div>
    </div>
  );
}

export function SnapshotView({ snapshot: s, decision: d, title }: { snapshot: DecisionSnapshot; decision: Decision; title: string }) {
  const chosen = s.options.find((o) => o.id === s.selectedOptionId);
  const name = (id: string) => s.options.find((o) => o.id === id)?.name ?? '';
  return (
    <Card title={title} description={`Snapshot taken ${new Date(s.capturedAt).toLocaleString('en-NZ')} — never rewritten.`}>
      <div className="grid gap-4 text-sm lg:grid-cols-2">
        <dl className="grid grid-cols-[10rem_1fr] gap-y-1.5">
          <dt className="text-muted">Chosen</dt>
          <dd className="font-semibold">{chosen?.name}</dd>
          <dt className="text-muted">Reasoning</dt>
          <dd>{s.reasoning || <em className="text-muted">none recorded</em>}</dd>
          <dt className="text-muted">Predicted cost</dt>
          <dd className="tabular">{formatMoney(s.predictedCost)} over {s.assumptions.horizonMonths} months</dd>
          <dt className="text-muted">Predicted satisfaction</dt>
          <dd>{s.predictedSatisfaction ?? '—'}/10</dd>
          <dt className="text-muted">Confidence</dt>
          <dd>{s.confidence ?? '—'}/5</dd>
          <dt className="text-muted">Available funds then</dt>
          <dd className="tabular">{s.availableNow === undefined ? 'not estimated' : formatMoney(s.availableNow)}</dd>
          <dt className="text-muted">Review date</dt>
          <dd>{d.reviewDate ? formatDate(d.reviewDate) : 'not set'}</dd>
        </dl>
        <div className="grid gap-3">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="py-1 font-medium">Alternative</th>
                <th className="py-1 text-right font-medium">Preference</th>
                <th className="py-1 text-right font-medium">vs best (today’s $)</th>
              </tr>
            </thead>
            <tbody>
              {s.ranking.map((r) => (
                <tr key={r.optionId} className="border-b border-border/60">
                  <td className="py-1">
                    {name(r.optionId)} {r.optionId === s.selectedOptionId && <Badge tone="accent">chosen</Badge>}
                  </td>
                  <td className="py-1 text-right tabular">{s.criteria.length ? `${r.score.toFixed(0)} (#${r.rank})` : '—'}</td>
                  <td className="py-1 text-right tabular">{formatMoney(s.financials.find((f) => f.optionId === r.optionId)?.differenceVsBest ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {s.monteCarlo && (
            <p className="text-xs text-muted">
              Simulated range then (today’s $, P10–P90, {s.monteCarlo.settings.runs.toLocaleString()} runs at {formatPercent(s.monteCarlo.settings.annualVolatility)} volatility):{' '}
              {s.monteCarlo.options.map((o) => `${name(o.optionId)} ${formatMoney(o.p10, { whole: true })}–${formatMoney(o.p90, { whole: true })}`).join(' · ')}
            </p>
          )}
          <p className="text-xs text-muted">
            Assumptions then: {formatPercent(s.assumptions.annualReturn)} return, {formatPercent(s.assumptions.annualFee, 2)} fees,{' '}
            {formatPercent(s.assumptions.taxRateOnReturns, 1)} tax, {formatPercent(s.assumptions.annualInflation)} inflation, from {formatMonth(s.assumptions.startMonth)}.
          </p>
        </div>
      </div>
    </Card>
  );
}
