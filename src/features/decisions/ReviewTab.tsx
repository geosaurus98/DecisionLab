import { useState } from 'react';
import { Badge, Button, Card, EmptyState, Field, MoneyInput, Select, Textarea } from '@/ui/components';
import type { Decision, OutcomeReview } from '@/domain/types';
import { saveReview } from '@/data/decisions';
import { formatMoney, formatPercent } from '@/domain/money';
import { nowTimestamp } from '@/domain/ids';
import { useToast } from '@/ui/toast';
import { EXPECTATIONS_LABEL } from './labels';
import { SnapshotView } from './DecideTab';

export function ReviewTab({ decision: d, onReplace }: { decision: Decision; onReplace: (d: Decision) => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(!d.review);
  const [form, setForm] = useState<OutcomeReview>(
    d.review ?? {
      reviewedAt: '',
      actualCost: d.snapshot?.predictedCost ?? null,
      actualBenefits: '',
      satisfaction: 7,
      expectationsMet: 'met',
      wouldRepeat: 'yes',
      unexpected: '',
      lessons: '',
    },
  );
  if (!d.snapshot) {
    return <EmptyState title="No choice recorded yet">Record your choice in the Decide tab first. You can then come back to review how it turned out.</EmptyState>;
  }
  const s = d.snapshot;
  const r = d.review;
  const costError = r && r.actualCost !== null && s.predictedCost > 0 ? (r.actualCost - s.predictedCost) / s.predictedCost : null;

  return (
    <div className="grid gap-5">
      {r && !editing && (
        <Card title="Predicted vs actual" actions={<Button size="sm" onClick={() => setEditing(true)}>Edit review</Button>}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="px-2 py-1.5 font-medium" />
                <th className="px-2 py-1.5 text-right font-medium">Predicted (at decision)</th>
                <th className="px-2 py-1.5 text-right font-medium">Actual</th>
                <th className="px-2 py-1.5 text-right font-medium">Difference</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/60">
                <td className="px-2 py-1.5">Cost</td>
                <td className="px-2 py-1.5 text-right tabular">{formatMoney(s.predictedCost)}</td>
                <td className="px-2 py-1.5 text-right tabular">{r.actualCost === null ? '—' : formatMoney(r.actualCost)}</td>
                <td className="px-2 py-1.5 text-right tabular">
                  {r.actualCost === null ? '—' : formatMoney(r.actualCost - s.predictedCost, { signed: true })}
                  {costError !== null && (
                    <Badge tone={costError > 0.1 ? 'bad' : costError < -0.1 ? 'good' : 'neutral'}>
                      {costError > 0 ? '+' : ''}
                      {formatPercent(costError, 0)}
                    </Badge>
                  )}
                </td>
              </tr>
              <tr className="border-b border-border/60">
                <td className="px-2 py-1.5">Satisfaction</td>
                <td className="px-2 py-1.5 text-right tabular">{s.predictedSatisfaction ?? '—'}/10</td>
                <td className="px-2 py-1.5 text-right tabular">{r.satisfaction}/10</td>
                <td className="px-2 py-1.5 text-right tabular">{s.predictedSatisfaction === null ? '—' : r.satisfaction - s.predictedSatisfaction > 0 ? `+${r.satisfaction - s.predictedSatisfaction}` : r.satisfaction - s.predictedSatisfaction}</td>
              </tr>
            </tbody>
          </table>
          <dl className="mt-4 grid gap-y-1.5 text-sm sm:grid-cols-[12rem_1fr]">
            <dt className="text-muted">Expectations</dt>
            <dd>{EXPECTATIONS_LABEL[r.expectationsMet]}</dd>
            <dt className="text-muted">Would choose again</dt>
            <dd className="capitalize">{r.wouldRepeat}</dd>
            <dt className="text-muted">Actual benefits</dt>
            <dd>{r.actualBenefits || '—'}</dd>
            <dt className="text-muted">Unexpected consequences</dt>
            <dd>{r.unexpected || '—'}</dd>
            <dt className="text-muted">Lessons</dt>
            <dd>{r.lessons || '—'}</dd>
          </dl>
        </Card>
      )}

      {editing && (
        <Card title="How did it turn out?" description="Be honest — this is only for you, and it is what makes future insights useful.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Actual total cost" htmlFor="rv-cost" hint={`Predicted ${formatMoney(s.predictedCost)}`}>
              <MoneyInput id="rv-cost" allowNegative value={form.actualCost} onChange={(v) => setForm({ ...form, actualCost: v })} />
            </Field>
            <Field label={`Satisfaction: ${form.satisfaction}/10`} htmlFor="rv-sat" hint={`Predicted ${s.predictedSatisfaction ?? '—'}/10`}>
              <input id="rv-sat" type="range" min={1} max={10} value={form.satisfaction} onChange={(e) => setForm({ ...form, satisfaction: Number(e.target.value) })} className="h-10 accent-[var(--accent)]" />
            </Field>
            <Field label="Expectations" htmlFor="rv-exp">
              <Select id="rv-exp" value={form.expectationsMet} onChange={(e) => setForm({ ...form, expectationsMet: e.target.value as OutcomeReview['expectationsMet'] })}>
                {Object.entries(EXPECTATIONS_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Would you choose the same again?" htmlFor="rv-rep">
              <Select id="rv-rep" value={form.wouldRepeat} onChange={(e) => setForm({ ...form, wouldRepeat: e.target.value as OutcomeReview['wouldRepeat'] })}>
                <option value="yes">Yes</option>
                <option value="unsure">Unsure</option>
                <option value="no">No</option>
              </Select>
            </Field>
            <Field label="Actual benefits" htmlFor="rv-ben" className="sm:col-span-2">
              <Textarea id="rv-ben" value={form.actualBenefits} onChange={(e) => setForm({ ...form, actualBenefits: e.target.value })} />
            </Field>
            <Field label="Unexpected consequences" htmlFor="rv-unexp" className="sm:col-span-2">
              <Textarea id="rv-unexp" value={form.unexpected} onChange={(e) => setForm({ ...form, unexpected: e.target.value })} />
            </Field>
            <Field label="Lessons learned" htmlFor="rv-less" className="sm:col-span-2 lg:col-span-4">
              <Textarea id="rv-less" value={form.lessons} onChange={(e) => setForm({ ...form, lessons: e.target.value })} />
            </Field>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            {r && <Button onClick={() => setEditing(false)}>Cancel</Button>}
            <Button
              variant="primary"
              onClick={async () => {
                onReplace(await saveReview(d, { ...form, reviewedAt: r?.reviewedAt ?? nowTimestamp() }));
                setEditing(false);
                toast({ message: 'Outcome review saved.', tone: 'good' });
              }}
            >
              Save review
            </Button>
          </div>
        </Card>
      )}
      <SnapshotView snapshot={s} decision={d} title="What you expected at the time" />
    </div>
  );
}
