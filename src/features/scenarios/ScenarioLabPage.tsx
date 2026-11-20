import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Badge, Button, Card, Checkbox, ConfirmButton, EmptyState, Field, Input, MoneyInput, Notice, NumberInput, PageHeader, Select, Spinner } from '@/ui/components';
import { db } from '@/data/db';
import { getDefaultAssumptions } from '@/data/settings';
import type { ScenarioSet, ScenarioVariant } from '@/domain/types';
import { compareVariants, validateAssumptions } from '@/engine/projection';
import { finalRealMetric, realDifferenceMetric, tornado } from '@/engine/sensitivity';
import { formatMoney } from '@/domain/money';
import { addMonths, formatMonth } from '@/domain/dates';
import { newId, nowTimestamp } from '@/domain/ids';
import { AssumptionsEditor } from './AssumptionsEditor';
import { ProjectionChart } from './ProjectionChart';
import { Tornado } from './Tornado';
import { TEMPLATES, newScenarioSet } from './templates';

export function ScenarioLabPage() {
  const sets = useLiveQuery(() => db.scenarioSets.orderBy('updatedAt').reverse().toArray(), []);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ScenarioSet | null>(null);

  useEffect(() => {
    if (!sets) return;
    if (!activeId && sets.length) setActiveId(sets[0]!.id);
  }, [sets, activeId]);
  useEffect(() => {
    const s = sets?.find((x) => x.id === activeId);
    if (s && (!draft || draft.id !== s.id)) setDraft(s);
    if (!s && draft && !sets?.some((x) => x.id === draft.id)) setDraft(null);
  }, [sets, activeId, draft]);
  // Debounced persistence
  useEffect(() => {
    if (!draft) return;
    const stored = sets?.find((x) => x.id === draft.id);
    if (stored === draft) return;
    const t = setTimeout(() => db.scenarioSets.put({ ...draft, updatedAt: nowTimestamp() }), 500);
    return () => clearTimeout(t);
  }, [draft, sets]);

  async function create(templateKey: string) {
    const s = newScenarioSet(templateKey, await getDefaultAssumptions());
    await db.scenarioSets.add(s);
    setActiveId(s.id);
    setDraft(s);
  }

  if (!sets) return <Spinner />;
  return (
    <div className="grid gap-5">
      <PageHeader
        title="Scenario Lab"
        description="Explore the financial consequences of choices with transparent, deterministic projections. Results are illustrative, not forecasts."
      />
      <Card title="Start a scenario" description="Pick a template, then edit every assumption.">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {TEMPLATES.map((t) => (
            <button key={t.key} onClick={() => create(t.key)} className="rounded-lg border border-border p-3 text-left text-sm hover:border-accent">
              <span className="font-semibold">{t.label}</span>
              <span className="mt-1 block text-xs text-ink-2">{t.description}</span>
            </button>
          ))}
        </div>
      </Card>
      {sets.length === 0 || !draft ? (
        <EmptyState title="No scenarios yet">Choose a template above to create your first scenario.</EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Scenario" htmlFor="scn-select" className="w-64">
              <Select id="scn-select" value={draft.id} onChange={(e) => setActiveId(e.target.value)}>
                {sets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Name" htmlFor="scn-name" className="w-64">
              <Input id="scn-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <ConfirmButton
              title="Delete scenario?"
              confirmText="This permanently deletes the scenario."
              onConfirm={async () => {
                await db.scenarioSets.delete(draft.id);
                setActiveId(null);
                setDraft(null);
              }}
            >
              Delete
            </ConfirmButton>
          </div>
          <ScenarioEditor set={draft} onChange={setDraft} />
        </>
      )}
    </div>
  );
}

function ScenarioEditor({ set, onChange }: { set: ScenarioSet; onChange: (s: ScenarioSet) => void }) {
  const errors = validateAssumptions(set.base);
  const comparison = useMemo(() => (errors.length || set.variants.length === 0 ? [] : compareVariants(set.base, set.variants)), [set, errors.length]);
  const [focus, setFocus] = useState<string>('');
  const drivers = useMemo(() => {
    if (errors.length || set.variants.length === 0) return [];
    const a = set.variants.find((v) => v.id === focus) ?? set.variants[0]!;
    const b = set.variants.find((v) => v.id !== a.id);
    return tornado(set.base, b ? realDifferenceMetric(a, b) : finalRealMetric(a));
  }, [set, focus, errors.length]);
  const focusVariant = set.variants.find((v) => v.id === focus) ?? set.variants[0];
  const other = set.variants.find((v) => v.id !== focusVariant?.id);

  const setVariant = (id: string, patch: Partial<ScenarioVariant>) => onChange({ ...set, variants: set.variants.map((v) => (v.id === id ? { ...v, ...patch } : v)) });

  return (
    <div className="grid gap-5">
      <Card title="Shared assumptions" description="Apply to every variant. Each variant then adds its own changes.">
        <AssumptionsEditor idPrefix="scn" value={set.base} onChange={(base) => onChange({ ...set, base })} />
        {errors.length > 0 && (
          <div className="mt-3">
            <Notice tone="bad">{errors.join(' ')}</Notice>
          </div>
        )}
      </Card>

      <Card
        title="Variants"
        description="Negative amounts take money out of the modelled balance (spending); positive amounts add to it."
        actions={
          <Button size="sm" disabled={set.variants.length >= 6} onClick={() => onChange({ ...set, variants: [...set.variants, { id: newId('var'), name: `Variant ${set.variants.length + 1}`, oneOffs: [], recurring: [], contributionDelta: 0 }] })}>
            Add variant
          </Button>
        }
      >
        <div className="grid gap-3 lg:grid-cols-2">
          {set.variants.map((v) => (
            <div key={v.id} className="grid gap-3 rounded-lg border border-border p-3">
              <div className="flex items-end gap-2">
                <Field label="Variant name" htmlFor={`v-name-${v.id}`} className="flex-1">
                  <Input id={`v-name-${v.id}`} value={v.name} onChange={(e) => setVariant(v.id, { name: e.target.value })} />
                </Field>
                <Field label="Contribution change / month" htmlFor={`v-cd-${v.id}`} className="w-44">
                  <MoneyInput id={`v-cd-${v.id}`} allowNegative value={v.contributionDelta} onChange={(x) => setVariant(v.id, { contributionDelta: x ?? 0 })} />
                </Field>
                <Button size="sm" variant="ghost" disabled={set.variants.length <= 1} onClick={() => onChange({ ...set, variants: set.variants.filter((x) => x.id !== v.id) })}>
                  Remove
                </Button>
              </div>
              <div className="grid gap-2">
                <p className="text-xs font-semibold text-ink-2">One-off cash flows</p>
                {v.oneOffs.map((o) => (
                  <div key={o.id} className="grid grid-cols-[1fr_6rem_8rem_auto] items-end gap-2">
                    <Input aria-label="Label" value={o.label} onChange={(e) => setVariant(v.id, { oneOffs: v.oneOffs.map((x) => (x.id === o.id ? { ...x, label: e.target.value } : x)) })} />
                    <NumberInput ariaLabel="Month offset" min={0} max={set.base.horizonMonths - 1} value={o.month} onChange={(m) => setVariant(v.id, { oneOffs: v.oneOffs.map((x) => (x.id === o.id ? { ...x, month: Math.round(m ?? 0) } : x)) })} />
                    <MoneyInput ariaLabel="Amount" allowNegative value={o.amount} onChange={(a) => setVariant(v.id, { oneOffs: v.oneOffs.map((x) => (x.id === o.id ? { ...x, amount: a ?? 0 } : x)) })} />
                    <Button size="sm" variant="ghost" aria-label="Remove one-off" onClick={() => setVariant(v.id, { oneOffs: v.oneOffs.filter((x) => x.id !== o.id) })}>
                      ✕
                    </Button>
                  </div>
                ))}
                <Button size="sm" variant="ghost" className="justify-self-start" onClick={() => setVariant(v.id, { oneOffs: [...v.oneOffs, { id: newId('flow'), label: 'One-off', month: 0, amount: -100_000 }] })}>
                  + One-off (label · month · amount)
                </Button>
                <p className="text-xs font-semibold text-ink-2">Recurring monthly cash flows</p>
                {v.recurring.map((r) => (
                  <div key={r.id} className="grid gap-2 rounded border border-border/70 p-2 sm:grid-cols-[1fr_5rem_5rem_7rem_auto] sm:items-end">
                    <Input aria-label="Label" value={r.label} onChange={(e) => setVariant(v.id, { recurring: v.recurring.map((x) => (x.id === r.id ? { ...x, label: e.target.value } : x)) })} />
                    <NumberInput ariaLabel="Start month" min={0} value={r.startMonth} onChange={(m) => setVariant(v.id, { recurring: v.recurring.map((x) => (x.id === r.id ? { ...x, startMonth: Math.round(m ?? 0) } : x)) })} />
                    <NumberInput ariaLabel="End month (blank = horizon)" min={0} value={r.endMonth ?? null} onChange={(m) => setVariant(v.id, { recurring: v.recurring.map((x) => (x.id === r.id ? { ...x, endMonth: m === null ? undefined : Math.round(m) } : x)) })} />
                    <MoneyInput ariaLabel="Monthly amount" allowNegative value={r.monthlyAmount} onChange={(a) => setVariant(v.id, { recurring: v.recurring.map((x) => (x.id === r.id ? { ...x, monthlyAmount: a ?? 0 } : x)) })} />
                    <Button size="sm" variant="ghost" aria-label="Remove recurring flow" onClick={() => setVariant(v.id, { recurring: v.recurring.filter((x) => x.id !== r.id) })}>
                      ✕
                    </Button>
                    <div className="sm:col-span-5">
                      <Checkbox label="Grows with inflation" checked={r.inflationIndexed} onChange={(c) => setVariant(v.id, { recurring: v.recurring.map((x) => (x.id === r.id ? { ...x, inflationIndexed: c } : x)) })} />
                    </div>
                  </div>
                ))}
                <Button size="sm" variant="ghost" className="justify-self-start" onClick={() => setVariant(v.id, { recurring: [...v.recurring, { id: newId('flow'), label: 'Recurring', startMonth: 0, monthlyAmount: -5_000, inflationIndexed: false }] })}>
                  + Recurring (label · start · end · amount)
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {comparison.length > 0 && (
        <>
          <Card title="Projected balances" description={`${formatMonth(set.base.startMonth)} – ${formatMonth(addMonths(set.base.startMonth, set.base.horizonMonths - 1))}`}>
            <ProjectionChart series={comparison.map((c) => ({ id: c.variantId, name: c.name, result: c.result }))} target={set.base.targetAmount} />
          </Card>
          <Card title="Results at the horizon">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="px-2 py-1.5 font-medium">Variant</th>
                    <th className="px-2 py-1.5 text-right font-medium">Net cash flows</th>
                    <th className="px-2 py-1.5 text-right font-medium">Growth</th>
                    <th className="px-2 py-1.5 text-right font-medium">Fees + tax</th>
                    <th className="px-2 py-1.5 text-right font-medium">Final (nominal)</th>
                    <th className="px-2 py-1.5 text-right font-medium">Final (today’s $)</th>
                    <th className="px-2 py-1.5 text-right font-medium">vs best</th>
                    <th className="px-2 py-1.5 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {comparison.map((c) => (
                    <tr key={c.variantId} className="border-b border-border/60">
                      <td className="px-2 py-1.5">{c.name}</td>
                      <td className="px-2 py-1.5 text-right tabular">{formatMoney(c.result.totalFlows)}</td>
                      <td className="px-2 py-1.5 text-right tabular">{formatMoney(c.result.totalGrowth)}</td>
                      <td className="px-2 py-1.5 text-right tabular">{formatMoney(-(c.result.totalFees + c.result.totalTax))}</td>
                      <td className="px-2 py-1.5 text-right tabular">{formatMoney(c.result.finalNominal)}</td>
                      <td className="px-2 py-1.5 text-right tabular">{formatMoney(c.result.finalReal)}</td>
                      <td className="px-2 py-1.5 text-right font-medium tabular">{c.vsBestReal === 0 ? '—' : formatMoney(c.vsBestReal)}</td>
                      <td className="px-2 py-1.5">
                        {c.result.shortfallMonths.length > 0 && <Badge tone="bad">Shortfall</Badge>}
                        {set.base.targetAmount !== undefined && c.result.targetReachedAt !== null && (
                          <Badge tone="good">Target {formatMonth(addMonths(set.base.startMonth, c.result.targetReachedAt), true)}</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted">
              Identity check: final nominal = starting balance + net cash flows + growth − fees − tax (± rounding). “vs best” compares inflation-adjusted values.
            </p>
          </Card>
          <Card
            title="Sensitivity"
            description={other ? `How the gap “${focusVariant?.name} − ${other.name}” responds to each assumption.` : `How “${focusVariant?.name}” responds to each assumption.`}
            actions={
              <Select aria-label="Variant to analyse" value={focusVariant?.id ?? ''} onChange={(e) => setFocus(e.target.value)} className="h-8 w-48">
                {set.variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            }
          >
            <Tornado drivers={drivers} valueLabel={other ? 'difference in final balance, today’s dollars' : 'final balance, today’s dollars'} />
          </Card>
        </>
      )}
    </div>
  );
}
