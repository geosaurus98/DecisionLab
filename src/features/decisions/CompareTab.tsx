import { useMemo } from 'react';
import { Badge, Card, EmptyState, InfoTip, Notice } from '@/ui/components';
import { ChartWithTable, SERIES, SimpleTable, axisProps, moneyTick } from '@/ui/charts';
import { CartesianGrid, LabelList, Line, ComposedChart, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts';
import type { Decision } from '@/domain/types';
import { FRAGILE_MARGIN, FRAGILE_WEIGHT_SHIFT, paretoEfficient, scoreOptions, weightSensitivity } from '@/engine/scoring';
import { totalOptionCost } from '@/engine/projection';
import { formatMoney, formatPercent } from '@/domain/money';
import { DEFINITIONS } from '@/ui/definitions';

export function CompareTab({ decision: d }: { decision: Decision; onChange: (d: Decision) => void }) {
  const scoring = useMemo(() => scoreOptions(d.options, d.criteria, d.scores), [d.options, d.criteria, d.scores]);
  const sens = useMemo(() => weightSensitivity(d.options, d.criteria, d.scores), [d.options, d.criteria, d.scores]);
  const costs = useMemo(() => new Map(d.options.map((o) => [o.id, totalOptionCost(o, d.assumptions.horizonMonths, d.assumptions.annualInflation)])), [d.options, d.assumptions.horizonMonths, d.assumptions.annualInflation]);
  const pareto = useMemo(
    () => paretoEfficient(scoring.results.map((r) => ({ optionId: r.optionId, score: r.score, cost: costs.get(r.optionId) ?? 0 }))),
    [scoring, costs],
  );
  const points = useMemo(
    () =>
      scoring.results.map((r) => ({
        name: d.options.find((o) => o.id === r.optionId)?.name ?? '',
        cost: costs.get(r.optionId) ?? 0,
        score: r.score,
        efficient: pareto.has(r.optionId),
      })),
    [scoring, costs, pareto, d.options],
  );
  const frontier = useMemo(() => points.filter((p) => p.efficient).sort((a, b) => a.cost - b.cost), [points]);
  const optName = (id: string | null) => d.options.find((o) => o.id === id)?.name ?? '—';
  const critName = (id: string) => d.criteria.find((c) => c.id === id)?.name || 'unnamed';

  if (d.criteria.length === 0) {
    return <EmptyState title="Add criteria first">Go to “Options & criteria”, add what matters to you, and score each alternative.</EmptyState>;
  }
  const ranked = [...scoring.results].sort((a, b) => a.rank - b.rank);

  return (
    <div className="grid gap-5">
      <Card
        title={
          <span className="inline-flex items-center gap-2">
            Preference score <InfoTip>{DEFINITIONS.weightedScore}</InfoTip>
          </span>
        }
        description="How well each alternative fits your stated criteria and weights. Money is shown alongside, not inside, this score."
      >
        <div className="grid gap-4">
          {ranked.map((r) => (
            <div key={r.optionId}>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-semibold">
                  #{r.rank} {optName(r.optionId)}
                </span>
                <span className="text-lg font-semibold tabular">{r.score.toFixed(1)}</span>
                <span className="text-xs text-muted">/ 100</span>
                {r.incomplete && <Badge tone="warn">Missing scores</Badge>}
                {pareto.has(r.optionId) ? (
                  <Badge tone="good" title="No other option scores at least as well for less money.">Efficient</Badge>
                ) : (
                  <Badge title="Another option scores at least as well and costs no more.">Dominated</Badge>
                )}
                <span className="ml-auto text-sm text-ink-2 tabular">Total cost over horizon: {formatMoney(costs.get(r.optionId) ?? 0, { whole: true })}</span>
              </div>
              <div className="mt-1 flex h-5 w-full overflow-hidden rounded bg-surface-2" role="img" aria-label={`Score breakdown for ${optName(r.optionId)}`}>
                {r.contributions.map((c, i) => (
                  <div
                    key={c.criterionId}
                    title={`${critName(c.criterionId)}: ${(c.contribution * 100).toFixed(1)} points`}
                    style={{ width: `${c.contribution * 100}%`, background: SERIES[i % SERIES.length] }}
                    className="h-full border-r-2 border-surface last:border-r-0"
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-3 text-xs text-ink-2">
            {d.criteria.map((c, i) => (
              <span key={c.id} className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES[i % SERIES.length] }} />
                {critName(c.id)} ({formatPercent(scoring.normalisedWeights[c.id] ?? 0, 0)})
              </span>
            ))}
          </div>
        </div>
      </Card>

      {sens.fragile ? (
        <Notice tone="warn" title="This ranking depends heavily on your weights">
          {sens.margin < FRAGILE_MARGIN
            ? `The top two alternatives are only ${sens.margin.toFixed(1)} points apart. `
            : `Shifting a single criterion's weight by ${Math.round(FRAGILE_WEIGHT_SHIFT * 100)} percentage points or less changes the leader. `}
          Weights are judgement calls; treat the score as a prompt for reflection, not a verdict.
        </Notice>
      ) : (
        <Notice tone="good">The leading alternative stays first across reasonable changes to any single weight.</Notice>
      )}
      {sens.equalWeightsLeader && sens.equalWeightsLeader !== sens.leaderId && (
        <Notice tone="warn">With equal weights, “{optName(sens.equalWeightsLeader)}” would lead instead — your weighting is what decides this.</Notice>
      )}
      {scoring.warnings.map((w) => (
        <Notice key={w} tone="info">
          {w}
        </Notice>
      ))}

      <Card
        title="Cost versus preference"
        description="Each alternative’s preference score against its total cost over the horizon. The line joins efficient alternatives: moving along it, more preference costs more money. Dominated alternatives sit below/right of it."
      >
        <ChartWithTable
          label="Cost versus preference"
          height={280}
          chart={
            <ResponsiveContainer>
              <ComposedChart margin={{ top: 16, right: 24, left: 0, bottom: 8 }}>
                <CartesianGrid />
                <XAxis type="number" dataKey="cost" name="Total cost" tickFormatter={moneyTick} domain={['auto', 'auto']} padding={{ left: 40, right: 40 }} {...axisProps} />
                <YAxis type="number" dataKey="score" name="Preference" domain={[0, 100]} width={40} {...axisProps} />
                <Tooltip
                  content={({ active, payload }) => {
                    const p = payload?.[0]?.payload as { name: string; cost: number; score: number; efficient: boolean } | undefined;
                    if (!active || !p?.name) return null;
                    return (
                      <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
                        <p className="font-semibold">{p.name}</p>
                        <p>Total cost {formatMoney(p.cost, { whole: true })}</p>
                        <p>Preference {p.score.toFixed(1)}/100 · {p.efficient ? 'efficient' : 'dominated'}</p>
                      </div>
                    );
                  }}
                />
                <Line data={frontier} dataKey="score" stroke="var(--ink-2)" strokeDasharray="4 4" dot={false} isAnimationActive={false} legendType="none" />
                <Scatter data={points} fill={SERIES[0]} isAnimationActive={false}>
                  <LabelList dataKey="name" position="top" style={{ fill: 'var(--ink-2)', fontSize: 12 }} />
                </Scatter>
              </ComposedChart>
            </ResponsiveContainer>
          }
          table={
            <SimpleTable
              headers={['Alternative', 'Total cost', 'Preference', 'Status']}
              align={['left', 'right', 'right', 'left']}
              rows={points.map((p) => [p.name, formatMoney(p.cost, { whole: true }), p.score.toFixed(1), p.efficient ? 'Efficient' : 'Dominated'])}
            />
          }
        />
      </Card>

      <Card title="How the score is calculated" description="Every number below can be traced: normalised score × normalised weight = points.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="px-2 py-1.5 font-medium">Criterion (weight)</th>
                {d.options.map((o) => (
                  <th key={o.id} className="px-2 py-1.5 text-right font-medium">
                    {o.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.criteria.map((c) => (
                <tr key={c.id} className="border-b border-border/60">
                  <td className="px-2 py-1.5">
                    {critName(c.id)} <span className="text-muted">({formatPercent(scoring.normalisedWeights[c.id] ?? 0, 0)})</span>
                    <span className="block text-xs text-muted">{c.type === 'rating' ? 'rating ÷ 10' : 'min–max across options'}, {c.direction} is better</span>
                  </td>
                  {d.options.map((o) => {
                    const r = scoring.results.find((x) => x.optionId === o.id)!;
                    const cc = r.contributions.find((x) => x.criterionId === c.id)!;
                    return (
                      <td key={o.id} className="px-2 py-1.5 text-right tabular">
                        <span className="text-ink-2">{cc.raw ?? '—'}</span> → {cc.normalised.toFixed(2)} → <strong>{(cc.contribution * 100).toFixed(1)}</strong>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Weight sensitivity" description="For each criterion, the range of its weight (as a share of the total) over which the current leader stays first, holding the other weights in proportion.">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="px-2 py-1.5 font-medium">Criterion</th>
              <th className="px-2 py-1.5 text-right font-medium">Current weight</th>
              <th className="px-2 py-1.5 text-right font-medium">Leader unchanged between</th>
              <th className="px-2 py-1.5 font-medium">First change</th>
            </tr>
          </thead>
          <tbody>
            {sens.items.map((i) => (
              <tr key={i.criterionId} className="border-b border-border/60">
                <td className="px-2 py-1.5">{critName(i.criterionId)}</td>
                <td className="px-2 py-1.5 text-right tabular">{formatPercent(i.currentWeight, 0)}</td>
                <td className="px-2 py-1.5 text-right tabular">
                  {formatPercent(i.stableRange[0], 0)} – {formatPercent(i.stableRange[1], 0)}
                </td>
                <td className="px-2 py-1.5">
                  {i.flipDistance === null ? (
                    <span className="text-good">Never</span>
                  ) : (
                    <span className={i.flipDistance <= FRAGILE_WEIGHT_SHIFT ? 'text-warn' : ''}>
                      “{optName(i.flipTo)}” leads after a {Math.round(i.flipDistance * 100)} pp shift
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
