import { Button, Card, Field, Input, MoneyInput, Notice, NumberInput, Select, Textarea } from '@/ui/components';
import type { Criterion, Decision, DecisionCategory, DecisionOption } from '@/domain/types';
import { newId } from '@/domain/ids';
import { formatMoney } from '@/domain/money';
import { CATEGORY_LABEL } from './labels';
import { RATING_MAX, RATING_MIN } from '@/engine/scoring';
import { useState } from 'react';
import { PairwiseWeights } from './PairwiseWeights';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { BUILT_IN_TEMPLATES, criteriaFromHistory, type DecisionTemplate, type TemplateCriterion } from '@/engine/templates';

const SUGGESTED_CRITERIA = ['Enjoyment', 'Long-term usefulness', 'Stress / hassle', 'Learning', 'Time cost'];

export function SetupTab({ decision: d, onChange, errors, onNext }: { decision: Decision; onChange: (d: Decision) => void; errors: string[]; onNext: () => void }) {
  const set = (patch: Partial<Decision>) => onChange({ ...d, ...patch });
  const [pairwiseOpen, setPairwiseOpen] = useState(false);
  const others = useLiveQuery(() => db.decisions.filter((x) => x.id !== d.id && x.criteria.length > 0).toArray(), [d.id]) ?? [];
  const reused = criteriaFromHistory(others).filter((h) => !d.criteria.some((c) => c.name.trim().toLowerCase() === h.name.toLowerCase()));
  const toCriterion = (t: TemplateCriterion) => ({ id: newId('crit'), name: t.name, type: t.type, direction: t.direction, weight: t.weight, unit: t.unit });
  const isFresh = d.criteria.length === 0 && d.options.every((o) => /^Option [A-Z]$/.test(o.name) && o.upfrontCost === 0 && o.monthlyCost === 0);
  const applyTemplate = (t: DecisionTemplate) => {
    const options = t.options.map((name) => ({ id: newId('opt'), name, upfrontCost: 0, costMonth: 0, monthlyCost: 0 }));
    set({ category: t.category, options, criteria: t.criteria.map(toCriterion), scores: Object.fromEntries(options.map((o) => [o.id, {}])), selectedOptionId: null, pairwise: undefined });
  };
  const setOption = (id: string, patch: Partial<DecisionOption>) => set({ options: d.options.map((o) => (o.id === id ? { ...o, ...patch } : o)) });
  const setCriterion = (id: string, patch: Partial<Criterion>) => set({ criteria: d.criteria.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const setScore = (optionId: string, criterionId: string, value: number | null) =>
    set({ scores: { ...d.scores, [optionId]: { ...(d.scores[optionId] ?? {}), [criterionId]: value } } });

  const addOption = () => {
    const id = newId('opt');
    set({ options: [...d.options, { id, name: `Option ${String.fromCharCode(65 + d.options.length)}`, upfrontCost: 0, costMonth: 0, monthlyCost: 0 }], scores: { ...d.scores, [id]: {} } });
  };
  const removeOption = (id: string) => {
    const scores = { ...d.scores };
    delete scores[id];
    set({ options: d.options.filter((o) => o.id !== id), scores, selectedOptionId: d.selectedOptionId === id ? null : d.selectedOptionId });
  };
  const addCriterion = (preset?: Partial<Criterion>) =>
    set({ criteria: [...d.criteria, { id: newId('crit'), name: '', type: 'rating', direction: 'higher', weight: 3, ...preset }] });

  const unusedSuggestions = SUGGESTED_CRITERIA.filter((n) => !d.criteria.some((c) => c.name.trim().toLowerCase() === n.toLowerCase()));
  const totalWeight = d.criteria.reduce((a, c) => a + Math.max(0, c.weight), 0);

  return (
    <div className="grid gap-5">
      {isFresh && (
        <Card title="Start from…" description="Optional. Pre-fills alternatives and criteria; you can change everything afterwards.">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {BUILT_IN_TEMPLATES.map((t) => (
              <button key={t.id} onClick={() => applyTemplate(t)} className="rounded-lg border border-border p-3 text-left text-sm hover:border-accent">
                <span className="font-semibold">{t.label}</span>
                <span className="mt-1 block text-xs text-ink-2">{t.hint}</span>
              </button>
            ))}
          </div>
          {others.length > 0 && (
            <div className="mt-3 max-w-md">
              <Field label="…or copy the criteria and weights from a past decision" htmlFor="copy-from">
                <Select
                  id="copy-from"
                  value=""
                  onChange={(e) => {
                    const src = others.find((o) => o.id === e.target.value);
                    if (src) set({ criteria: src.criteria.map((c) => ({ ...c, id: newId('crit') })), pairwise: undefined });
                  }}
                >
                  <option value="">Choose a decision…</option>
                  {others.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.title || 'Untitled'} ({o.criteria.length} criteria)
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
        </Card>
      )}

      <Card title="The decision">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Title" htmlFor="d-title" className="sm:col-span-2">
            <Input id="d-title" value={d.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Japan trip or invest the money?" autoFocus={!d.title} />
          </Field>
          <Field label="Category" htmlFor="d-cat">
            <Select id="d-cat" value={d.category} onChange={(e) => set({ category: e.target.value as DecisionCategory })}>
              {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date" htmlFor="d-date">
            <Input id="d-date" type="date" value={d.date} onChange={(e) => e.target.value && set({ date: e.target.value })} />
          </Field>
          <Field label="Description" htmlFor="d-desc" className="sm:col-span-2 lg:col-span-4">
            <Textarea id="d-desc" value={d.description} onChange={(e) => set({ description: e.target.value })} placeholder="What are you deciding, and why now?" />
          </Field>
        </div>
      </Card>

      <Card
        title="Alternatives"
        description="Costs are entered as positive amounts. They are modelled as reductions to your savings in the Financial impact tab."
        actions={
          <Button size="sm" onClick={addOption}>
            Add alternative
          </Button>
        }
      >
        <div className="grid gap-3">
          {d.options.map((o, i) => (
            <div key={o.id} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2 lg:grid-cols-6">
              <Field label={`Alternative ${i + 1}`} htmlFor={`o-name-${o.id}`} className="lg:col-span-2">
                <Input id={`o-name-${o.id}`} value={o.name} onChange={(e) => setOption(o.id, { name: e.target.value })} />
              </Field>
              <Field label="Upfront cost" htmlFor={`o-up-${o.id}`}>
                <MoneyInput id={`o-up-${o.id}`} value={o.upfrontCost} onChange={(v) => setOption(o.id, { upfrontCost: v ?? 0 })} />
              </Field>
              <Field label="Paid in month" htmlFor={`o-month-${o.id}`} hint="0 = now">
                <NumberInput id={`o-month-${o.id}`} min={0} max={600} value={o.costMonth} onChange={(v) => setOption(o.id, { costMonth: Math.round(v ?? 0) })} />
              </Field>
              <Field label="Ongoing cost / month" htmlFor={`o-mo-${o.id}`} hint="Negative = ongoing saving">
                <MoneyInput id={`o-mo-${o.id}`} allowNegative value={o.monthlyCost} onChange={(v) => setOption(o.id, { monthlyCost: v ?? 0 })} />
              </Field>
              <Field label="For months" htmlFor={`o-dur-${o.id}`} hint="Blank = whole horizon">
                <NumberInput id={`o-dur-${o.id}`} min={1} max={600} value={o.monthlyCostMonths ?? null} onChange={(v) => setOption(o.id, { monthlyCostMonths: v === null ? undefined : Math.round(v) })} />
              </Field>
              <Field label="Expected benefits" htmlFor={`o-ben-${o.id}`} className="sm:col-span-1 lg:col-span-3">
                <Input id={`o-ben-${o.id}`} value={o.expectedBenefits ?? ''} onChange={(e) => setOption(o.id, { expectedBenefits: e.target.value })} />
              </Field>
              <Field label="Risks and uncertainty" htmlFor={`o-risk-${o.id}`} className="sm:col-span-1 lg:col-span-2">
                <Input id={`o-risk-${o.id}`} value={o.risks ?? ''} onChange={(e) => setOption(o.id, { risks: e.target.value })} />
              </Field>
              {o.extraFlows && (
                <div className="flex flex-wrap items-center gap-2 rounded bg-surface-2 px-2 py-1.5 text-xs text-ink-2 sm:col-span-2 lg:col-span-5">
                  <span>
                    Also includes {o.extraFlows.oneOffs.length + o.extraFlows.recurring.length} cash flow(s) from the Scenario Lab
                    {o.extraFlows.contributionDelta ? ` and a contribution change of ${formatMoney(o.extraFlows.contributionDelta, { signed: true })}/month` : ''}:{' '}
                    {[...o.extraFlows.oneOffs.map((f) => `${f.label} ${formatMoney(f.amount, { signed: true })} (month ${f.month})`), ...o.extraFlows.recurring.map((f) => `${f.label} ${formatMoney(f.monthlyAmount, { signed: true })}/mo`)].join(' · ')}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setOption(o.id, { extraFlows: undefined })}>
                    Remove
                  </Button>
                </div>
              )}
              <div className="flex items-end justify-end">
                <Button size="sm" variant="ghost" disabled={d.options.length <= 2} onClick={() => removeOption(o.id)}>
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card
        title="Criteria"
        description="What matters to you, and how much. Weights are relative (they are normalised to 100%). Money is handled separately — don't add cost here unless you deliberately want it inside the score."
        actions={
          <>
            <Button size="sm" onClick={() => addCriterion()}>
              Add rating criterion
            </Button>
            <Button size="sm" variant="ghost" onClick={() => addCriterion({ type: 'measure', direction: 'lower', unit: '' })}>
              Add measured criterion
            </Button>
            {d.criteria.length >= 2 && (
              <Button size="sm" variant="ghost" onClick={() => setPairwiseOpen(true)}>
                Compare in pairs…
              </Button>
            )}
          </>
        }
      >
        {d.criteria.length > 0 && (
          <div className="grid gap-2">
            {d.criteria.map((c) => (
              <div key={c.id} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_9rem_9rem_7rem_6rem_auto] sm:items-end">
                <Field label="Criterion" htmlFor={`c-name-${c.id}`}>
                  <Input id={`c-name-${c.id}`} value={c.name} onChange={(e) => setCriterion(c.id, { name: e.target.value })} placeholder="e.g. Enjoyment" />
                </Field>
                <Field label="Type" htmlFor={`c-type-${c.id}`}>
                  <Select id={`c-type-${c.id}`} value={c.type} onChange={(e) => setCriterion(c.id, { type: e.target.value as Criterion['type'] })}>
                    <option value="rating">Rating 0–10</option>
                    <option value="measure">Measured value</option>
                  </Select>
                </Field>
                <Field label="Better when" htmlFor={`c-dir-${c.id}`}>
                  <Select id={`c-dir-${c.id}`} value={c.direction} onChange={(e) => setCriterion(c.id, { direction: e.target.value as Criterion['direction'] })}>
                    <option value="higher">Higher</option>
                    <option value="lower">Lower</option>
                  </Select>
                </Field>
                <Field label="Weight" htmlFor={`c-w-${c.id}`} hint={totalWeight > 0 ? `${Math.round((Math.max(0, c.weight) / totalWeight) * 100)}%` : undefined}>
                  <NumberInput id={`c-w-${c.id}`} min={0} max={100} step={1} value={c.weight} onChange={(v) => setCriterion(c.id, { weight: v ?? 0 })} />
                </Field>
                {c.type === 'measure' ? (
                  <Field label="Unit" htmlFor={`c-unit-${c.id}`}>
                    <Input id={`c-unit-${c.id}`} value={c.unit ?? ''} onChange={(e) => setCriterion(c.id, { unit: e.target.value })} placeholder="kg, hrs" />
                  </Field>
                ) : (
                  <span />
                )}
                <Button size="sm" variant="ghost" onClick={() => set({ criteria: d.criteria.filter((x) => x.id !== c.id) })}>
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
        <PairwiseWeights
          open={pairwiseOpen}
          onClose={() => setPairwiseOpen(false)}
          decision={d}
          onApply={(pairwise, weights) =>
            // Weights are stored as whole-number percentages so they stay readable and editable.
            set({ pairwise, criteria: d.criteria.map((c) => ({ ...c, weight: Math.max(0, Math.round((weights[c.id] ?? 0) * 1000) / 10) })) })
          }
        />
        {d.pairwise && Object.keys(d.pairwise).length > 0 && d.criteria.length >= 2 && (
          <p className="mt-2 text-xs text-muted">Weights were last derived from pairwise comparisons; editing a weight directly overrides them.</p>
        )}
        {reused.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-ink-2">You often use:</span>
            {reused.slice(0, 8).map((h) => (
              <Button key={h.name} size="sm" variant="ghost" title={`Used in ${h.uses} decisions`} onClick={() => set({ criteria: [...d.criteria, toCriterion(h)] })}>
                + {h.name} <span className="text-xs text-muted">×{h.uses}</span>
              </Button>
            ))}
          </div>
        )}
        {unusedSuggestions.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-ink-2">Suggestions:</span>
            {unusedSuggestions.map((name) => (
              <Button key={name} size="sm" variant="ghost" onClick={() => addCriterion({ name, direction: name.startsWith('Stress') || name.startsWith('Time') ? 'lower' : 'higher' })}>
                + {name}
              </Button>
            ))}
          </div>
        )}
      </Card>

      {d.criteria.length > 0 && (
        <Card title="Scores" description={`Rate each alternative ${RATING_MIN}–${RATING_MAX} on rating criteria, or enter the measured value. Leave blank if unknown.`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-2 py-1.5 font-medium">Criterion</th>
                  {d.options.map((o) => (
                    <th key={o.id} className="px-2 py-1.5 font-medium">
                      {o.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.criteria.map((c) => (
                  <tr key={c.id} className="border-b border-border/60">
                    <td className="px-2 py-1.5">
                      {c.name || <em className="text-muted">unnamed</em>}
                      <span className="block text-xs text-muted">
                        {c.type === 'rating' ? '0–10' : c.unit || 'value'} · {c.direction} is better
                      </span>
                    </td>
                    {d.options.map((o) => (
                      <td key={o.id} className="px-2 py-1.5">
                        <NumberInput
                          ariaLabel={`${c.name} score for ${o.name}`}
                          min={c.type === 'rating' ? RATING_MIN : undefined}
                          max={c.type === 'rating' ? RATING_MAX : undefined}
                          step={c.type === 'rating' ? 1 : 'any' as unknown as number}
                          value={d.scores[o.id]?.[c.id] ?? null}
                          onChange={(v) => setScore(o.id, c.id, v)}
                          className="w-24"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title="Notes and links">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Notes" htmlFor="d-notes">
            <Textarea id="d-notes" value={d.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
          <Field label="Links (one per line)" htmlFor="d-links" hint="Stored as text only; DecisionLab never fetches them.">
            <Textarea id="d-links" value={d.links.join('\n')} onChange={(e) => set({ links: e.target.value.split('\n') })} />
          </Field>
        </div>
      </Card>

      {errors.length > 0 && <Notice tone="warn">{errors.join(' ')}</Notice>}
      <div className="flex justify-end">
        <Button variant="primary" onClick={onNext}>
          Compare alternatives →
        </Button>
      </div>
    </div>
  );
}
