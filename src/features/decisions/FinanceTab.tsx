import { useMemo, useState } from 'react';
import { Badge, Card, InfoTip, Notice, Select } from '@/ui/components';
import { AssumptionsEditor } from '../scenarios/AssumptionsEditor';
import { ProjectionChart } from '../scenarios/ProjectionChart';
import { Tornado } from '../scenarios/Tornado';
import type { Decision } from '@/domain/types';
import { compareVariants, optionToVariant, totalOptionCost, validateAssumptions } from '@/engine/projection';
import { realDifferenceMetric, tornado } from '@/engine/sensitivity';
import type { FlexibilityEstimate } from '@/engine/flexibility';
import { formatMoney, formatPercent } from '@/domain/money';
import { DEFINITIONS } from '@/ui/definitions';
import { formatMonth, addMonths } from '@/domain/dates';

export function FinanceTab({ decision: d, onChange, flex }: { decision: Decision; onChange: (d: Decision) => void; flex?: FlexibilityEstimate }) {
  const errors = validateAssumptions(d.assumptions);
  const variants = useMemo(() => d.options.map(optionToVariant), [d.options]);
  const comparison = useMemo(() => (errors.length ? [] : compareVariants(d.assumptions, variants)), [d.assumptions, variants, errors.length]);
  const [pair, setPair] = useState<[string, string] | null>(null);
  const [aId, bId] = pair ?? [d.options[0]?.id ?? '', d.options[1]?.id ?? ''];
  const drivers = useMemo(() => {
    const a = variants.find((v) => v.id === aId);
    const b = variants.find((v) => v.id === bId);
    if (!a || !b || errors.length || a.id === b.id) return [];
    return tornado(d.assumptions, realDifferenceMetric(a, b));
  }, [variants, aId, bId, d.assumptions, errors.length]);
  const name = (id: string) => d.options.find((o) => o.id === id)?.name ?? '';

  return (
    <div className="grid gap-5">
      <Notice>
        These projections are <strong>illustrative</strong>: they show what happens to a savings/investment balance under the assumptions below, with each
        alternative’s costs taken out of that balance. Returns are uncertain and not guaranteed. Satisfaction and other non-financial criteria are kept in
        the Compare tab.
      </Notice>

      <Card title="Immediate cash-flow implications" description="Compared with your flexibility estimate today.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="px-2 py-1.5 font-medium">Alternative</th>
                <th className="px-2 py-1.5 text-right font-medium">Upfront</th>
                <th className="px-2 py-1.5 text-right font-medium">Share of “available now”</th>
                <th className="px-2 py-1.5 text-right font-medium">Monthly</th>
                <th className="px-2 py-1.5 text-right font-medium">Share of monthly capacity</th>
              </tr>
            </thead>
            <tbody>
              {d.options.map((o) => {
                const nowShare = flex?.availableNow && flex.availableNow > 0 ? o.upfrontCost / flex.availableNow : null;
                const moShare = flex?.monthlyCapacity && flex.monthlyCapacity > 0 ? o.monthlyCost / flex.monthlyCapacity : null;
                return (
                  <tr key={o.id} className="border-b border-border/60">
                    <td className="px-2 py-1.5">{o.name}</td>
                    <td className="px-2 py-1.5 text-right tabular">{formatMoney(o.upfrontCost)}</td>
                    <td className="px-2 py-1.5 text-right tabular">
                      {o.upfrontCost === 0 ? '—' : nowShare === null ? <span className="text-muted">no estimate</span> : (
                        <span className={nowShare > 1 ? 'text-bad' : nowShare > 0.5 ? 'text-warn' : ''}>
                          {formatPercent(nowShare, 0)} {nowShare > 1 && <Badge tone="bad">Exceeds</Badge>}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular">{formatMoney(o.monthlyCost)}</td>
                    <td className="px-2 py-1.5 text-right tabular">
                      {o.monthlyCost === 0 ? '—' : moShare === null ? <span className="text-muted">no estimate</span> : formatPercent(moShare, 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {flex && (
          <p className="mt-2 text-xs text-muted">
            Available now: {flex.availableNow === null ? 'not estimated' : formatMoney(flex.availableNow)} · Monthly capacity:{' '}
            {flex.monthlyCapacity === null ? 'not estimated' : formatMoney(flex.monthlyCapacity)} (see Overview for the breakdown).
          </p>
        )}
      </Card>

      <Card title="Assumptions" description="Saved with this decision. Changing your global defaults later does not change them.">
        <AssumptionsEditor idPrefix="dec" value={d.assumptions} onChange={(assumptions) => onChange({ ...d, assumptions })} />
        {errors.length > 0 && (
          <div className="mt-3">
            <Notice tone="bad">{errors.join(' ')}</Notice>
          </div>
        )}
      </Card>

      {comparison.length > 0 && (
        <>
          <Card
            title="Projected balance by alternative"
            description={`From ${formatMonth(d.assumptions.startMonth)} to ${formatMonth(addMonths(d.assumptions.startMonth, d.assumptions.horizonMonths - 1))}.`}
          >
            <ProjectionChart series={comparison.map((c) => ({ id: c.variantId, name: c.name, result: c.result }))} target={d.assumptions.targetAmount} />
          </Card>
          <Card
            title={
              <span className="inline-flex items-center gap-2">
                Opportunity cost at the horizon <InfoTip>{DEFINITIONS.opportunityCost}</InfoTip>
              </span>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="px-2 py-1.5 font-medium">Alternative</th>
                    <th className="px-2 py-1.5 text-right font-medium">Total cost</th>
                    <th className="px-2 py-1.5 text-right font-medium">Final balance (nominal)</th>
                    <th className="px-2 py-1.5 text-right font-medium">Final balance (today’s $)</th>
                    <th className="px-2 py-1.5 text-right font-medium">vs best (today’s $)</th>
                    <th className="px-2 py-1.5 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.map((c) => {
                    const o = d.options.find((x) => x.id === c.variantId)!;
                    return (
                      <tr key={c.variantId} className="border-b border-border/60">
                        <td className="px-2 py-1.5">{c.name}</td>
                        <td className="px-2 py-1.5 text-right tabular">{formatMoney(totalOptionCost(o, d.assumptions.horizonMonths))}</td>
                        <td className="px-2 py-1.5 text-right tabular">{formatMoney(c.result.finalNominal)}</td>
                        <td className="px-2 py-1.5 text-right tabular">{formatMoney(c.result.finalReal)}</td>
                        <td className="px-2 py-1.5 text-right font-medium tabular">{c.vsBestReal === 0 ? '—' : formatMoney(c.vsBestReal)}</td>
                        <td className="px-2 py-1.5 text-xs">
                          {c.result.shortfallMonths.length > 0 && <Badge tone="bad">Balance negative in {c.result.shortfallMonths.length} months</Badge>}
                          {d.assumptions.targetAmount !== undefined &&
                            (c.result.targetReachedAt !== null ? (
                              <Badge tone="good">Target by {formatMonth(addMonths(d.assumptions.startMonth, c.result.targetReachedAt), true)}</Badge>
                            ) : (
                              <Badge>Target not reached</Badge>
                            ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted">
              Growth, fees and tax are included. A negative balance means the alternative cannot be funded from this pool alone; no borrowing cost is modelled.
            </p>
          </Card>

          {d.options.length >= 2 && (
            <Card
              title="Which assumptions matter most?"
              description="How the gap between two alternatives (in today’s dollars) changes when one assumption moves."
              actions={
                <div className="flex items-center gap-1 text-sm">
                  <Select aria-label="First alternative" value={aId} onChange={(e) => setPair([e.target.value, bId])} className="h-8 w-36">
                    {d.options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </Select>
                  <span>minus</span>
                  <Select aria-label="Second alternative" value={bId} onChange={(e) => setPair([aId, e.target.value])} className="h-8 w-36">
                    {d.options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </Select>
                </div>
              }
            >
              {drivers.length > 0 ? (
                <Tornado drivers={drivers} valueLabel={`${name(aId)} − ${name(bId)}, today’s dollars`} />
              ) : (
                <p className="text-sm text-ink-2">Choose two different alternatives.</p>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
